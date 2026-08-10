// Zero-knowledge care-kit share.
//
// Flow: caller supplies passphrase → we snapshot parent+meds+ICE+etc. as JSON,
// encrypt with AES-GCM-256 (PBKDF2-SHA256 key derivation), upload ciphertext
// to the public share-kits Storage bucket, insert a share_kits row holding
// only salt/iv/iteration count, and return a short URL.
//
// The passphrase never leaves the device. Server + Storage see only opaque
// bytes. Recipient opens the URL in the halmoni-landing /view page and enters
// the passphrase to decrypt in-browser via WebCrypto.

import { encryptWithPassphrase } from '@/lib/crypto/encrypt';
import { shortSlug } from '@/lib/crypto/slug';
import { logAudit } from '@/lib/audit';
import type { ParentRow } from '@/lib/parent';
import { supabase } from '@/lib/supabase';

const LANDING_URL =
  process.env.EXPO_PUBLIC_LANDING_URL?.replace(/\/$/, '') ?? 'https://halmoni.uk';
const BUCKET = 'share-kits';

export interface ShareKitPayload {
  version: 1;
  generatedAt: string;
  generatedBy?: string | null;
  parent: {
    name: string;
    nickname: string | null;
    dob: string | null;
    blood_type: string | null;
    conditions: string[];
    allergies: string[];
    preferences: string | null;
    ice_contacts: Array<{ name: string; relation: string; phone: string }>;
    pharmacy: Record<string, unknown> | null;
    primary_doctor: Record<string, unknown> | null;
    insurance: Record<string, unknown> | null;
  };
  medications: Array<{
    name: string;
    dose: string | null;
    purpose: string | null;
    schedule: Array<{ time: string; withFood?: boolean }>;
    prescriber: string | null;
    pharmacy: string | null;
    notes: string | null;
  }>;
}

async function buildPayload(
  parent: ParentRow,
  generatedByName?: string | null,
): Promise<ShareKitPayload> {
  const { data: medsData } = await supabase
    .from('medications')
    .select('name,dose,purpose,schedule,prescriber,pharmacy,notes')
    .eq('parent_id', parent.id)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: generatedByName ?? null,
    parent: {
      name: parent.name,
      nickname: parent.nickname,
      dob: parent.dob,
      blood_type: (parent as any).blood_type ?? null,
      conditions: parent.conditions ?? [],
      allergies: parent.allergies ?? [],
      preferences: (parent as any).preferences ?? null,
      ice_contacts: parent.ice_contacts ?? [],
      pharmacy: (parent as any).pharmacy ?? null,
      primary_doctor: (parent as any).primary_doctor ?? null,
      insurance: (parent as any).insurance ?? null,
    },
    medications: (medsData ?? []) as ShareKitPayload['medications'],
  };
}

export interface ShareKitResult {
  id: string;
  url: string;
  expiresAt: string | null;
}

export interface CreateShareOpts {
  passphrase: string;
  familyId: string;
  createdByMemberId?: string | null;
  createdByName?: string | null;
  ttlDays?: number;                // default 7; null = no expiry
}

/** Encrypt + upload + register. Returns the short URL to hand to the recipient. */
export async function createEncryptedCareKitShare(
  parent: ParentRow,
  opts: CreateShareOpts,
): Promise<ShareKitResult> {
  const { passphrase, familyId } = opts;
  if (!passphrase || passphrase.length < 6) {
    throw new Error('Passphrase must be at least 6 characters.');
  }

  const payload = await buildPayload(parent, opts.createdByName);
  const encrypted = await encryptWithPassphrase(payload, passphrase);

  const id = await shortSlug(8);
  const storagePath = `${familyId}/${id}.bin`;

  // Upload ciphertext as raw bytes. base64-decode first because supabase-js
  // accepts Uint8Array only in RN (not the strings encoded by encryptWithPassphrase).
  const { base64ToBytes } = await import('@/lib/crypto/encrypt');
  const bytes = base64ToBytes(encrypted.ciphertextB64);
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: 'application/octet-stream',
      upsert: false,
    });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const ttlDays = opts.ttlDays ?? 7;
  const expiresAt =
    ttlDays == null ? null : new Date(Date.now() + ttlDays * 86_400_000).toISOString();

  const { error: insertError } = await supabase.from('share_kits').insert({
    id,
    family_id: familyId,
    created_by: opts.createdByMemberId ?? null,
    storage_path: storagePath,
    salt_b64: encrypted.saltB64,
    iv_b64: encrypted.ivB64,
    kdf_iterations: encrypted.kdfIterations,
    ciphertext_bytes: bytes.length,
    expires_at: expiresAt,
  });
  if (insertError) {
    // Best-effort cleanup: remove the orphaned blob so we don't leak Storage bytes.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw new Error(`Registering share failed: ${insertError.message}`);
  }

  void logAudit({
    familyId,
    actorMemberId: opts.createdByMemberId,
    entityType: 'parent',
    entityId: parent.id,
    action: 'shared',
    meta: { kind: 'care-kit', share_id: id, expires_at: expiresAt },
  });

  return {
    id,
    url: `${LANDING_URL}/view/${id}`,
    expiresAt,
  };
}

/** Owner-side revoke: drops the share_kits row and removes the ciphertext blob. */
export async function revokeShareKit(id: string): Promise<void> {
  const { data } = await supabase
    .from('share_kits')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle();
  if (data?.storage_path) {
    await supabase.storage.from(BUCKET).remove([data.storage_path]);
  }
  await supabase.from('share_kits').update({ revoked_at: new Date().toISOString() }).eq('id', id);
}
