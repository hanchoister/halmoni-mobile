// Write-path helpers: the canonical way for the app to mutate data.
// Every write hits the local SQLite mirror instantly (optimistic UI),
// stages a pending_writes queue entry, and asks the sync engine to drain.
// Screens can migrate to these helpers incrementally — call sites still using
// supabase.from() directly continue to work, they just skip the offline layer.

import { getDb } from '@/lib/db/client';
import { enqueueWrite, softDelete, upsertRow } from '@/lib/db/repository';
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
  return { ...row, updated_at: now };
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
  await softDelete(table, id);
  if (!isDemoMode()) {
    await enqueueWrite(table, 'delete', {
      id,
      deleted_at: now,
      updated_at: now,
    });
    nudge();
  }
  bumpDataVersion();
}
