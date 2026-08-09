// Sync engine: drains local writes to Supabase, then pulls remote changes into
// the SQLite mirror. Timestamp-based last-write-wins with tombstone-aware
// merge — mirrors evergreen's approach adapted from Gist to Postgres.
//
// Push: coalesce pending_writes by (table, row_id) → latest wins, then upsert
// per-table in batches. Successful batches drain all queue entries for that
// row; failures leave them for retry.
//
// Pull: for each table, SELECT * WHERE updated_at > last_pulled_at (includes
// rows with deleted_at set — the local upsert copies the tombstone). Advance
// the per-table high-water mark to the newest updated_at we absorbed.

import { supabase } from '@/lib/supabase';
import {
  deleteWrite,
  getLastPulledAt,
  listPendingWrites,
  markWriteAttempted,
  recordKnownId,
  setLastPulledAt,
  SYNCABLE_TABLES,
  upsertRows,
} from '@/lib/db/repository';
import type { SyncableTable } from '@/lib/db/schema';

const PULL_BATCH_LIMIT = 500;

export interface SyncResult {
  pushed: number;
  pulled: Partial<Record<SyncableTable, number>>;
  durationMs: number;
}

async function pushOnce(): Promise<number> {
  const pending = await listPendingWrites();
  if (pending.length === 0) return 0;

  // Coalesce: multiple writes to the same row collapse to the latest payload.
  // Highest queue id wins (writes are inserted monotonically).
  type PW = (typeof pending)[number];
  const latestByKey = new Map<string, PW>();
  const allIdsByKey = new Map<string, number[]>();
  for (const w of pending) {
    const key = `${w.table_name}:${w.row_id}`;
    latestByKey.set(key, w);
    const ids = allIdsByKey.get(key) ?? [];
    ids.push(w.id);
    allIdsByKey.set(key, ids);
  }

  // Group by table so we can send one .upsert() per table.
  const byTable = new Map<SyncableTable, PW[]>();
  for (const w of latestByKey.values()) {
    const arr = byTable.get(w.table_name as SyncableTable) ?? [];
    arr.push(w);
    byTable.set(w.table_name as SyncableTable, arr);
  }

  let pushedCount = 0;
  for (const [table, writes] of byTable) {
    const rows = writes.map((w) => JSON.parse(w.payload));
    const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
    if (error) {
      for (const w of writes) await markWriteAttempted(w.id, error.message);
      throw new Error(`push failed for ${table}: ${error.message}`);
    }
    // Success — drop every queue entry for these rows (including coalesced older ones).
    for (const w of writes) {
      const key = `${table}:${w.row_id}`;
      const ids = allIdsByKey.get(key) ?? [];
      for (const id of ids) await deleteWrite(id);
    }
    pushedCount += writes.length;
  }
  return pushedCount;
}

async function pullOnce(): Promise<Partial<Record<SyncableTable, number>>> {
  const pulled: Partial<Record<SyncableTable, number>> = {};

  for (const table of SYNCABLE_TABLES) {
    const last = await getLastPulledAt(table);
    // No deleted_at filter — we want tombstones so the local mirror can mark
    // them as deleted (repository.list() already filters deleted rows out of
    // UI reads).
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .gt('updated_at', last)
      .order('updated_at', { ascending: true })
      .limit(PULL_BATCH_LIMIT);

    if (error) throw new Error(`pull failed for ${table}: ${error.message}`);
    if (!data || data.length === 0) continue;

    await upsertRows(table, data);
    for (const row of data) await recordKnownId(table, row.id as string);

    const newest = data[data.length - 1].updated_at as string;
    await setLastPulledAt(table, newest);
    pulled[table] = data.length;

    // If we hit the batch limit, another pull cycle will pick up the rest.
  }

  return pulled;
}

/** One full sync cycle: push local changes, then pull remote deltas. */
export async function syncOnce(): Promise<SyncResult> {
  const t0 = Date.now();
  const pushed = await pushOnce();
  const pulled = await pullOnce();
  return { pushed, pulled, durationMs: Date.now() - t0 };
}
