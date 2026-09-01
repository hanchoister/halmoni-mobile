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
import { bumpDataVersion } from '@/lib/db/signal';
import { withRetry } from '@/lib/reliability/retry';

const PULL_BATCH_LIMIT = 500;

export interface SyncResult {
  pushed: number;
  pulled: Partial<Record<SyncableTable, number>>;
  /** Per-table failures. Non-empty means some data did not move. */
  errors: string[];
  durationMs: number;
}

async function pushOnce(): Promise<{ pushed: number; errors: string[] }> {
  const pending = await listPendingWrites();
  if (pending.length === 0) return { pushed: 0, errors: [] };

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
  const errors: string[] = [];
  for (const [table, writes] of byTable) {
    const rows = writes.map((w) => JSON.parse(w.payload));
    const { error } = await withRetry(async () =>
      await supabase.from(table).upsert(rows, { onConflict: 'id' }),
    );
    if (error) {
      // Isolate the failure to this table. Previously this threw, which meant a
      // single rejected row stopped every other table from pushing AND — because
      // syncOnce awaited push before pull — stopped the device pulling anything
      // at all. One bad write froze the whole device in both directions.
      for (const w of writes) await markWriteAttempted(w.id, error.message);
      errors.push(`${table}: ${error.message}`);
      continue;
    }
    // Success — drop every queue entry for these rows (including coalesced older ones).
    for (const w of writes) {
      const key = `${table}:${w.row_id}`;
      const ids = allIdsByKey.get(key) ?? [];
      for (const id of ids) await deleteWrite(id);
    }
    pushedCount += writes.length;
  }
  return { pushed: pushedCount, errors };
}

async function pullOnce(): Promise<{
  pulled: Partial<Record<SyncableTable, number>>;
  errors: string[];
}> {
  const pulled: Partial<Record<SyncableTable, number>> = {};
  const errors: string[] = [];

  for (const table of SYNCABLE_TABLES) {
    const last = await getLastPulledAt(table);
    // No deleted_at filter — we want tombstones so the local mirror can mark
    // them as deleted (repository.list() already filters deleted rows out of
    // UI reads).
    const { data, error } = await withRetry(async () =>
      await supabase
        .from(table)
        .select('*')
        .gt('updated_at', last)
        .order('updated_at', { ascending: true })
        .limit(PULL_BATCH_LIMIT),
    );

    if (error) {
      // Same reasoning as push: one table's failure must not stop the others.
      errors.push(`${table}: ${error.message}`);
      continue;
    }
    if (!data || data.length === 0) continue;

    // Writing to the local mirror can fail on its own terms — a column the
    // mirror declares NOT NULL that Postgres allows to be null, for instance.
    // That is still this table's problem, not every table's, and crucially not
    // a reason to abandon the whole sync: an unwrapped throw here left
    // lastSyncAt permanently null and stopped every later table cold.
    try {
      await upsertRows(table, data);
      for (const row of data) await recordKnownId(table, row.id as string);

      const newest = data[data.length - 1].updated_at as string;
      await setLastPulledAt(table, newest);
      pulled[table] = data.length;
    } catch (err) {
      errors.push(`${table}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    // If we hit the batch limit, another pull cycle will pick up the rest.
  }

  return { pulled, errors };
}

/** One full sync cycle: push local changes, then pull remote deltas. */
export async function syncOnce(): Promise<SyncResult> {
  const t0 = Date.now();
  // Pull runs unconditionally. It used to sit behind `await pushOnce()`, so any
  // push failure meant the device also stopped receiving everyone else's
  // changes — the worst possible failure mode for a shared care record.
  const push = await pushOnce();
  const pull = await pullOnce();
  const totalPulled = Object.values(pull.pulled).reduce((a, b) => a + (b ?? 0), 0);
  if (totalPulled > 0) bumpDataVersion();
  const errors = [...push.errors, ...pull.errors];
  return {
    pushed: push.pushed,
    pulled: pull.pulled,
    errors,
    durationMs: Date.now() - t0,
  };
}
