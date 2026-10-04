// Write-path helpers: the canonical way for the app to mutate data.
// Every write hits the local SQLite mirror instantly (optimistic UI),
// stages a pending_writes queue entry, and asks the sync engine to drain.
// Screens can migrate to these helpers incrementally — call sites still using
// supabase.from() directly continue to work, they just skip the offline layer.

import { validateConsent } from '@/lib/consent';
import { firstUnsyncableId } from '@/lib/sync/ids';
import { getDb } from '@/lib/db/client';
import {
  enqueueWrite,
  getById,
  getKnownServerVersions,
  purgeLocalRow,
  softDelete,
  upsertRow,
} from '@/lib/db/repository';
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

/**
 * The last thing standing between a `parents` write and the mirror.
 *
 * Every layer below this one already refuses an unattested parent — the CHECK
 * constraint, the trigger and the RLS policy on the server (G1-28) — but they
 * all live on the far side of the network, and this app writes offline first.
 * Without this guard a parent could be created on a plane, be shown on every
 * screen for a week, and only fail on sync, by which point the family has
 * entered a medication list against it.
 *
 * It is also the check a future screen cannot forget: writeRow is the only way
 * into the mirror, so a new call site that omits the attestation throws here
 * rather than discovering it in TestFlight.
 */
function guardParentConsent(table: SyncableTable, row: Record<string, any>) {
  if (table !== 'parents') return;
  const problem = validateConsent(row);
  if (problem) throw new Error(problem);
}

/**
 * The backstop for demo residue (see sync/ids.ts). Runs only on the way OUT to
 * the server: demo rows are perfectly valid in the local mirror, and blocking
 * them there would break demo mode itself.
 *
 * Throws rather than skipping quietly. A write that is accepted locally and
 * silently never sent is the exact failure this app has shipped twice already.
 */
function guardOutboundIds(table: SyncableTable, row: Record<string, any>) {
  const bad = firstUnsyncableId(row);
  if (bad) {
    throw new Error(
      `Refusing to sync ${table}.${bad.column} = ${JSON.stringify(bad.value)}: not a uuid. ` +
        'This row looks like demo data left in the local mirror; sign out and back in to clear it.',
    );
  }
}

/** Create or update a row. Row MUST include id. */
export async function writeRow(
  table: SyncableTable,
  row: Record<string, any>,
): Promise<void> {
  guardParentConsent(table, row);

  // G2-28: record which SERVER version this edit was made against, captured
  // here because a pull between now and the push would otherwise overwrite the
  // evidence — known_ids would read as current and the engine would conclude
  // nobody else had touched the row.
  //
  // It comes from known_ids rather than from the mirror's own updated_at on
  // purpose: the server's set_updated_at trigger replaces whatever this device
  // sends, so the mirror's local stamp is a value the server has never held and
  // would never match. Null means the server has never shown us this row — an
  // insert, where there is nothing to contest.
  const demo = isDemoMode();
  const base = demo
    ? null
    : (await getKnownServerVersions(table, [String(row.id)])).get(String(row.id)) ?? null;

  const stamped = stampWrite(row);
  await upsertRow(table, stamped);
  // Demo mode never talks to Supabase — skip the outbound queue so demo
  // writes stay self-contained and don't leak into a real account later.
  if (!demo) {
    guardOutboundIds(table, stamped);
    await enqueueWrite(table, 'update', stamped, base);
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
  for (const r of rows) guardParentConsent(table, r);
  const stamped = rows.map(stampWrite);
  const db = await getDb();
  const demo = isDemoMode();

  // G2-28, as one query rather than one per row: a schedule change can rewrite
  // ninety doses, and this has to happen before the upserts stamp new versions.
  const bases = demo
    ? new Map<string, string>()
    : await getKnownServerVersions(table, stamped.map((r) => String(r.id)));

  await db.withTransactionAsync(async () => {
    for (const r of stamped) await upsertRow(table, r);
    if (!demo) {
      for (const r of stamped) {
        guardOutboundIds(table, r);
        await enqueueWrite(table, 'update', r, bases.get(String(r.id)) ?? null);
      }
    }
  });
  if (!demo) nudge();
  bumpDataVersion();
}

/**
 * Batched deleteRow. One transaction for the local tombstones, one enqueue
 * each, one nudge at the end — a schedule change can invalidate ninety
 * upcoming doses at once, and ninety separate fsyncs is a visible stall.
 */
export async function deleteRows(table: SyncableTable, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  // Read before tombstoning: getById filters out deleted rows, and the outbound
  // tombstone has to carry the full row or Postgres rejects it on NOT NULL
  // before it ever notices the conflict.
  const rows = await Promise.all(ids.map((id) => getById(table, id)));
  const db = await getDb();
  const demo = isDemoMode();
  const deleteBases = demo ? new Map<string, string>() : await getKnownServerVersions(table, ids);
  await db.withTransactionAsync(async () => {
    for (const id of ids) await softDelete(table, id);
    if (!demo) {
      for (let i = 0; i < ids.length; i++) {
        const tombstone = {
          ...(rows[i] ?? {}),
          id: ids[i],
          deleted_at: now,
          updated_at: now,
        };
        guardOutboundIds(table, tombstone);
        // G2-28: a delete is contestable too — somebody editing a medication
        // while a sibling removes it is the same class of conflict. Base from
        // known_ids for the same reason as writeRow.
        await enqueueWrite(table, 'delete', tombstone, deleteBases.get(ids[i]) ?? null);
        // G2-61, same reasoning as deleteRow: the queue has the payload, so the
        // local content can go now instead of on the next pull.
        await purgeLocalRow(table, ids[i]);
      }
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
    const tombstone = {
      ...(existing ?? {}),
      id,
      deleted_at: now,
      updated_at: now,
    };
    guardOutboundIds(table, tombstone);
    // G2-28: base from known_ids — the server version this delete was decided
    // against — for the same reason as writeRow.
    const base = (await getKnownServerVersions(table, [id])).get(id) ?? null;
    await enqueueWrite(table, 'delete', tombstone, base);
    // G2-61: the outbound copy is queued, so the local one has no further job.
    // Dropping it now means this device stops holding the content immediately
    // rather than waiting for the blanked row to come back on the next pull.
    await purgeLocalRow(table, id);
    nudge();
  }
  bumpDataVersion();
}
