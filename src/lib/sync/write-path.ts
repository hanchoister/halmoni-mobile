// Write-path helpers: the canonical way for the app to mutate data.
// Every write hits the local SQLite mirror instantly (optimistic UI),
// stages a pending_writes queue entry, and asks the sync engine to drain.
// Screens can migrate to these helpers incrementally — call sites still using
// supabase.from() directly continue to work, they just skip the offline layer.

import { getDb } from '@/lib/db/client';
import { enqueueWrite, getById, softDelete, upsertRow } from '@/lib/db/repository';
import type { SyncableTable } from '@/lib/db/schema';
import { bumpDataVersion } from '@/lib/db/signal';
import { isDemoMode } from '@/lib/demo-mode';

// Registered by SyncProvider on mount so write helpers can nudge the engine
// without importing the React tree.
let _requestSync: (() => void) | null = null;

export function _registerSyncTrigger(fn: () => void) {
  _requestSync = fn;
}

function nudge() {
  if (_requestSync) _requestSync();
}

function stampWrite(row: Record<string, any>): Record<string, any> {
  const now = new Date().toISOString();
  // created_at is NOT NULL on every table but was left to each caller, so a
  // caller that forgot it crashed the write (SQLITE_CONSTRAINT). Default it
  // here. Safe because upsertRow excludes created_at from its ON CONFLICT SET
  // clause, so this default only ever applies to a genuine insert — an update
  // keeps whatever the row was first created with.
  return { created_at: now, ...row, updated_at: now };
}

/** Create or update a row. Row MUST include id. */
export async function writeRow(
  table: SyncableTable,
  row: Record<string, any>,
): Promise<void> {
  const stamped = stampWrite(row);
  await upsertRow(table, stamped);
  // Demo mode never talks to Supabase — skip the outbound queue so demo
  // writes stay self-contained and don't leak into a real account later.
  if (!isDemoMode()) {
    await enqueueWrite(table, 'update', stamped);
    nudge();
  }
  bumpDataVersion();
}

/**
 * Batched writeRow — a single SQLite transaction covers every upsert +
 * enqueue. Use this for bulk inserts (e.g. 90 days of medication doses)
 * so we don't fsync per row.
 */
export async function writeRows(
  table: SyncableTable,
  rows: Record<string, any>[],
): Promise<void> {
  if (rows.length === 0) return;
  const stamped = rows.map(stampWrite);
  const db = await getDb();
  const demo = isDemoMode();
  await db.withTransactionAsync(async () => {
    for (const r of stamped) await upsertRow(table, r);
    if (!demo) {
      for (const r of stamped) await enqueueWrite(table, 'update', r);
    }
  });
  if (!demo) nudge();
  bumpDataVersion();
}

/** Soft-delete a row (sets deleted_at locally and enqueues the tombstone). */
export async function deleteRow(table: SyncableTable, id: string): Promise<void> {
  const now = new Date().toISOString();

  // Read the row BEFORE soft-deleting it: getById filters out tombstoned rows,
  // and the whole row is needed for the tombstone push below.
  const existing = await getById(table, id);

  await softDelete(table, id);
  if (!isDemoMode()) {
    // The tombstone has to carry the FULL row, not just {id, deleted_at}.
    // Deletes go out through the same upsert as everything else, and PostgREST
    // turns that into INSERT ... ON CONFLICT DO UPDATE. Postgres validates NOT
    // NULL against the proposed INSERT row before it ever detects the conflict,
    // so a payload missing family_id was rejected with 23502 every time — which
    // is why deletes never reached other devices.
    await enqueueWrite(table, 'delete', {
      ...(existing ?? {}),
      id,
      deleted_at: now,
      updated_at: now,
    });
    nudge();
  }
  bumpDataVersion();
}
