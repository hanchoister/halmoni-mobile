// Write-path helpers: the canonical way for the app to mutate data.
// Every write hits the local SQLite mirror instantly (optimistic UI),
// stages a pending_writes queue entry, and asks the sync engine to drain.
// Screens can migrate to these helpers incrementally — call sites still using
// supabase.from() directly continue to work, they just skip the offline layer.

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
