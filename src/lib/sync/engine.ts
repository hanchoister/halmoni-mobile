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
  getKnownServerVersions,
  listPendingWrites,
  markWriteAttempted,
  recordConflict,
  recordKnownId,
  setLastPulledAt,
  SYNCABLE_TABLES,
  upsertRows,
} from '@/lib/db/repository';
import type { SyncableTable } from '@/lib/db/schema';
import { bumpDataVersion } from '@/lib/db/signal';
import { withRetry } from '@/lib/reliability/retry';
import { partitionWrites } from '@/lib/sync/conflict';

const PULL_BATCH_LIMIT = 500;

export interface SyncResult {
  pushed: number;
  /**
   * Edits that were NOT applied because someone else had changed the row first
   * (G2-28). Non-zero means somebody is owed a choice — the data is kept in
   * write_conflicts, not discarded.
   */
  conflicts: number;
  pulled: Partial<Record<SyncableTable, number>>;
  /** Per-table failures. Non-empty means some data did not move. */
  errors: string[];
  durationMs: number;
}

type QueuedWrite = {
  id: number;
  table_name: SyncableTable;
  op: string;
  row_id: string;
  payload: string;
  attempts: number;
  base_updated_at: string | null;
};

/**
 * Split a table's pending writes into the ones that are safe to push and the
 * ones that would erase somebody else's change (G2-28).
 *
 * HOW A CONFLICT IS RECOGNISED
 *
 * Each queued write carries `base_updated_at`: the server version the edit was
 * made against, captured at edit time from known_ids. If the server's current
 * updated_at still equals that, nothing has happened in between and the write
 * is uncontested. If it differs, somebody else wrote to the row after this edit
 * began, and the blind upsert would discard their change.
 *
 * Equality rather than "is newer" is deliberate: every synced table has a
 * `set_updated_at` trigger, so updated_at only ever moves forward under the
 * server's own clock, and any difference at all means a write landed. Comparing
 * with `>` would additionally depend on two clocks agreeing, which they do not.
 *
 * WHAT IS DELIBERATELY NOT TREATED AS A CONFLICT
 *
 *   - `base_updated_at === null`. Either the row has never been pulled (an
 *     insert — there is nothing to contest) or the entry was queued before this
 *     column existed. Both push exactly as they did before, so an upgrade
 *     cannot strand a queue full of the user's unsent edits.
 *   - A row the server does not have. The upsert will insert it.
 *
 * THE RACE THIS DOES NOT CLOSE, STATED PLAINLY
 *
 * Between this check and the upsert a few lines later, another device could
 * still write. That window is milliseconds; the one being closed here is the
 * minutes-to-days between someone opening an edit screen and their phone
 * reaching the network. Closing the last millisecond needs a guarded
 * conditional update per row (`PATCH ... ?updated_at=eq.<base>`), which would
 * give up the batched upsert — ninety requests for a schedule change instead of
 * one. Worth revisiting if conflicts turn out to be common; not worth paying
 * for up front.
 */
async function partitionByConflict(
  table: SyncableTable,
  writes: QueuedWrite[],
): Promise<{
  safe: QueuedWrite[];
  conflicted: Array<{ write: QueuedWrite; serverUpdatedAt: string; serverRow: Record<string, unknown> }>;
  error?: string;
}> {
  const contestable = writes.filter((w) => w.base_updated_at !== null);
  if (contestable.length === 0) return { safe: writes, conflicted: [] };

  // Full rows, not just updated_at: if this is a conflict, the other side's
  // values are the thing that must not be lost, and fetching them afterwards
  // would be a second request against a row we are about to overwrite.
  const { data, error } = await withRetry(async () =>
    await supabase
      .from(table)
      .select('*')
      .in('id', contestable.map((w) => w.row_id)),
  );
  if (error) return { safe: [], conflicted: [], error: error.message };

  const serverRows = new Map<string, Record<string, unknown>>();
  for (const row of data ?? []) serverRows.set(row.id as string, row);

  // The decision itself is in sync/conflict.ts, which has no imports and is
  // tested by verify:logic. This function only does the I/O.
  return partitionWrites(writes, serverRows);
}

async function pushOnce(): Promise<{ pushed: number; conflicts: number; errors: string[] }> {
  const pending = await listPendingWrites();
  if (pending.length === 0) return { pushed: 0, conflicts: 0, errors: [] };

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
  let conflictCount = 0;
  const errors: string[] = [];
  for (const [table, writes] of byTable) {
    // G2-28: find out what the server currently holds BEFORE overwriting it.
    //
    // The upsert below is unconditional — PostgREST turns it into
    // INSERT ... ON CONFLICT DO UPDATE, which replaces the server's row with
    // this device's payload whatever state it was in. That is what made a
    // sibling's dosage change disappear without anyone being told.
    //
    // One extra request per table per cycle, which keeps the batched upsert
    // exactly as it was rather than splitting it into a guarded write per row.
    const { safe, conflicted, error: checkError } = await partitionByConflict(table, writes);

    if (checkError) {
      // Could not read the server's state. Pushing anyway would be the old
      // behaviour — overwrite and hope — so the writes stay queued for the next
      // cycle instead. They are not marked as attempted: the write is not at
      // fault and should not be walked toward the quarantine ceiling by a
      // network failure.
      errors.push(`${table}: could not check for conflicts (${checkError}); push deferred`);
      continue;
    }

    for (const c of conflicted) {
      await recordConflict({
        table,
        rowId: c.write.row_id,
        baseUpdatedAt: c.write.base_updated_at,
        serverUpdatedAt: c.serverUpdatedAt,
        mine: JSON.parse(c.write.payload),
        theirs: c.serverRow,
      });
      // Drop it from the queue. It is preserved in write_conflicts, so nothing
      // is lost — and leaving it queued would mean refiling the same conflict
      // every cycle forever, with no way for the user to ever clear it.
      const key = `${table}:${c.write.row_id}`;
      for (const id of allIdsByKey.get(key) ?? []) await deleteWrite(id);
      conflictCount += 1;
    }

    if (safe.length === 0) continue;

    const rows = safe.map((w) => JSON.parse(w.payload));
    // .select() so the server's own updated_at comes back. known_ids has to be
    // advanced to the version the server actually stored, or the very next edit
    // to this row would compare against a stale base and report a conflict with
    // itself.
    const { data: returned, error } = await withRetry(async () =>
      await supabase.from(table).upsert(rows, { onConflict: 'id' }).select('id,updated_at'),
    );
    if (error) {
      // Isolate the failure to this table. Previously this threw, which meant a
      // single rejected row stopped every other table from pushing AND — because
      // syncOnce awaited push before pull — stopped the device pulling anything
      // at all. One bad write froze the whole device in both directions.
      for (const w of safe) await markWriteAttempted(w.id, error.message);
      errors.push(`${table}: ${error.message}`);
      continue;
    }
    // Record the version the server actually stored. Its set_updated_at trigger
    // replaced whatever we sent, so this is the only place that value exists.
    for (const row of returned ?? []) {
      await recordKnownId(table, row.id as string, row.updated_at as string);
    }
    // Success — drop every queue entry for these rows (including coalesced older ones).
    for (const w of safe) {
      const key = `${table}:${w.row_id}`;
      const ids = allIdsByKey.get(key) ?? [];
      for (const id of ids) await deleteWrite(id);
    }
    pushedCount += safe.length;
  }
  return { pushed: pushedCount, conflicts: conflictCount, errors };
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
      // G2-28: carry the server's updated_at into known_ids. This is the main
      // source of the base an edit is later measured against — without it,
      // conflict detection has nothing to compare and silently does nothing.
      for (const row of data) {
        await recordKnownId(table, row.id as string, row.updated_at as string);
      }

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
    conflicts: push.conflicts,
    pulled: pull.pulled,
    errors,
    durationMs: Date.now() - t0,
  };
}
