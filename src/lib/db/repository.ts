// Generic repository over the local SQLite mirror. Handles JSON column
// serialization + boolean 0/1 <-> boolean conversion at the boundary so
// callers see the same shapes as Supabase returns.

import { getDb } from '@/lib/db/client';
import {
  BOOL_COLUMNS,
  JSON_COLUMNS,
  SYNCABLE_TABLES,
  TABLE_COLUMNS,
  SyncableTable,
} from '@/lib/db/schema';

type Row = Record<string, any>;

function encode(table: string, row: Row): Row {
  const jsonCols = JSON_COLUMNS[table] ?? [];
  const boolCols = BOOL_COLUMNS[table] ?? [];
  // Keep only columns this mirror actually has. Rows pulled from Supabase carry
  // the web app's extra columns too, and upsertRow builds its INSERT from the
  // row's own keys — so without this filter a pull of `parents` or `medications`
  // references a column SQLite doesn't have and aborts the whole transaction.
  const known = TABLE_COLUMNS[table];
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (!known || known.has(k)) out[k] = v;
  }
  for (const col of jsonCols) {
    if (out[col] !== undefined && out[col] !== null && typeof out[col] !== 'string') {
      out[col] = JSON.stringify(out[col]);
    }
  }
  for (const col of boolCols) {
    if (typeof out[col] === 'boolean') {
      out[col] = out[col] ? 1 : 0;
    }
  }
  return out;
}

function decode(table: string, row: Row | null): Row | null {
  if (!row) return null;
  const jsonCols = JSON_COLUMNS[table] ?? [];
  const boolCols = BOOL_COLUMNS[table] ?? [];
  const out: Row = { ...row };
  for (const col of jsonCols) {
    if (typeof out[col] === 'string') {
      try {
        out[col] = JSON.parse(out[col]);
      } catch {
        // leave as string if malformed — worst case UI shows raw text
      }
    }
  }
  for (const col of boolCols) {
    if (typeof out[col] === 'number') {
      out[col] = out[col] === 1;
    }
  }
  return out;
}

function decodeAll(table: string, rows: Row[]): Row[] {
  return rows.map((r) => decode(table, r) as Row);
}

/** Insert or overwrite (by id). Serializes JSON + boolean columns. */
export async function upsertRow(table: SyncableTable, row: Row): Promise<void> {
  const db = await getDb();
  const encoded = encode(table, row);
  const cols = Object.keys(encoded);
  const placeholders = cols.map(() => '?').join(', ');
  // created_at is immutable: it's written by the INSERT and must survive every
  // later upsert. Leaving it in the SET clause meant any caller that re-stamped
  // it — or omitted it and let a default fill in — silently reset the row's
  // creation time on update.
  const setClause = cols
    .filter((c) => c !== 'id' && c !== 'created_at')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  const sql =
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ` +
    `ON CONFLICT(id) DO UPDATE SET ${setClause}`;
  await db.runAsync(sql, ...cols.map((c) => encoded[c] ?? null));
}

/**
 * Chunked multi-row INSERT, for seeding a table in one go.
 *
 * upsertRows() issues one statement per row. That is right for a sync pull —
 * rows trickle in and each is independently recoverable — but it is the wrong
 * shape for loading a fixture set: the demo seeds ~380 rows, and 380 round
 * trips through SQLite-compiled-to-WebAssembly left halmoni.app/demo showing
 * "No parent yet" for 15-30 seconds while a visitor decided the product was
 * broken.
 *
 * Deliberately NOT used by the sync path, which keeps its per-row error
 * isolation. Assumes the caller has already cleared the table.
 */
export async function bulkInsertRows(table: SyncableTable, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  const encoded = rows.map((r) => encode(table, r));
  // Union of columns: fixture rows omit keys that others set, and every tuple
  // in one statement has to bind the same columns. Missing values become null.
  const cols = [...new Set(encoded.flatMap((r) => Object.keys(r)))];
  // SQLite caps bound parameters per statement (999 by default), so size each
  // chunk by column count and leave headroom.
  const perChunk = Math.max(1, Math.floor(900 / cols.length));
  const tuple = `(${cols.map(() => '?').join(', ')})`;
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < encoded.length; i += perChunk) {
      const chunk = encoded.slice(i, i + perChunk);
      const sql =
        `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) ` +
        `VALUES ${chunk.map(() => tuple).join(', ')}`;
      const args: unknown[] = [];
      for (const r of chunk) for (const c of cols) args.push(r[c] ?? null);
      await db.runAsync(sql, ...(args as any[]));
    }
  });
}

export async function upsertRows(table: SyncableTable, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      await upsertRow(table, row);
    }
  });
}

/**
 * Remove a deleted row's content from THIS device, now (G2-61).
 *
 * The server blanks a tombstoned row's content the moment deleted_at is set
 * (migration 20), and every device picks that up through the ordinary pull. This
 * closes the gap in between: on the device that did the deleting, the full
 * record sits in the mirror from the moment of deletion until the next
 * successful pull — which, offline, can be days.
 *
 * The whole row goes rather than its columns being blanked one by one. Blanking
 * would mean maintaining a second copy of migration 20's column lists here, in a
 * schema that is a SUBSET of production's, and the two would drift. Dropping the
 * row is safe because nothing reads a local tombstone: `list()` and `getById()`
 * both filter `deleted_at IS NULL`, the mirror declares no foreign keys, and
 * `known_ids` — not the row — is what tells the sync engine "the server deleted
 * this" apart from "we have never seen it". The pull re-inserts the blank shell
 * on the next cycle.
 *
 * Called AFTER the outbound tombstone is queued. The queue carries its own copy
 * of the payload, so the push is unaffected by the row going.
 */
export async function purgeLocalRow(table: SyncableTable, id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`, id);
}

/** Soft delete — writes deleted_at + bumps updated_at. */
export async function softDelete(table: SyncableTable, id: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`,
    now,
    now,
    id,
  );
}

export async function getById(table: SyncableTable, id: string): Promise<Row | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>(
    `SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`,
    id,
  );
  return decode(table, row ?? null);
}

/**
 * List rows matching an eq-filter map. Excludes soft-deleted rows.
 * orderBy: 'col ASC' | 'col DESC'
 * gte/lte: inclusive range filters — `{ scheduled_at: '2026-01-01' }`.
 * isNull/notNull: presence filters — `['accepted_at']`.
 */
export async function list(
  table: SyncableTable,
  filters: Record<string, any> = {},
  opts: {
    orderBy?: string;
    limit?: number;
    gte?: Record<string, any>;
    lte?: Record<string, any>;
    isNull?: string[];
    notNull?: string[];
  } = {},
): Promise<Row[]> {
  const db = await getDb();
  const wheres = ['deleted_at IS NULL'];
  const params: any[] = [];
  for (const [k, v] of Object.entries(filters)) {
    if (v === null) {
      wheres.push(`${k} IS NULL`);
    } else {
      wheres.push(`${k} = ?`);
      params.push(v);
    }
  }
  for (const [k, v] of Object.entries(opts.gte ?? {})) {
    wheres.push(`${k} >= ?`);
    params.push(v);
  }
  for (const [k, v] of Object.entries(opts.lte ?? {})) {
    wheres.push(`${k} <= ?`);
    params.push(v);
  }
  for (const k of opts.isNull ?? []) wheres.push(`${k} IS NULL`);
  for (const k of opts.notNull ?? []) wheres.push(`${k} IS NOT NULL`);
  let sql = `SELECT * FROM ${table} WHERE ${wheres.join(' AND ')}`;
  if (opts.orderBy) sql += ` ORDER BY ${opts.orderBy}`;
  if (opts.limit != null) sql += ` LIMIT ${opts.limit}`;
  const rows = await db.getAllAsync<Row>(sql, ...params);
  return decodeAll(table, rows);
}

/** Every row in a table, including tombstones. Used by the sync engine. */
export async function listRawWithTombstones(table: SyncableTable): Promise<Row[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(`SELECT * FROM ${table}`);
  return decodeAll(table, rows);
}

/** Max updated_at we've seen locally for a table. Anchor for delta pulls. */
/**
 * The last server version we were told about, for each of these ids (G2-28).
 *
 * This is the base an edit is measured against. One query rather than one per
 * row, because a schedule change can rewrite ninety doses.
 *
 * Ids absent from the result have no recorded server version — either the row
 * has never been pulled (a genuine insert, nothing to contest) or it predates
 * this bookkeeping. Both are treated as "push blind", which is the behaviour
 * that was there before, so neither becomes a false conflict.
 */
export async function getKnownServerVersions(
  table: SyncableTable,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const db = await getDb();
  const out = new Map<string, string>();
  // Chunked against SQLITE_MAX_VARIABLE_NUMBER, which a long schedule change
  // would otherwise exceed.
  const CHUNK = 400;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const rows = await db.getAllAsync<{ row_id: string; server_updated_at: string | null }>(
      `SELECT row_id, server_updated_at FROM known_ids ` +
        `WHERE table_name = ? AND row_id IN (${slice.map(() => '?').join(',')})`,
      table,
      ...slice,
    );
    for (const row of rows) {
      if (row.server_updated_at) out.set(row.row_id, row.server_updated_at);
    }
  }
  return out;
}

export async function maxUpdatedAt(table: SyncableTable): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ max_ua: string | null }>(
    `SELECT MAX(updated_at) AS max_ua FROM ${table}`,
  );
  return row?.max_ua ?? null;
}

// ---- sync_meta helpers -----------------------------------------------------

export async function getLastPulledAt(table: SyncableTable): Promise<string> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ last_pulled_at: string }>(
    `SELECT last_pulled_at FROM sync_meta WHERE table_name = ?`,
    table,
  );
  return row?.last_pulled_at ?? '1970-01-01T00:00:00Z';
}

export async function setLastPulledAt(table: SyncableTable, at: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO sync_meta (table_name, last_pulled_at) VALUES (?, ?) ` +
      `ON CONFLICT(table_name) DO UPDATE SET last_pulled_at = excluded.last_pulled_at`,
    table,
    at,
  );
}

// ---- pending_writes queue --------------------------------------------------

export type PendingOp = 'insert' | 'update' | 'delete';

/**
 * Queue a write for the server.
 *
 * `baseUpdatedAt` (G2-28) is the row's updated_at as it stood BEFORE this edit —
 * the version the user was actually looking at. The push path needs it to tell
 * an uncontested write from one that is about to overwrite somebody else's
 * change. Pass null for a genuine insert, where there is nothing to contest.
 */
export async function enqueueWrite(
  table: SyncableTable,
  op: PendingOp,
  row: Row,
  baseUpdatedAt: string | null = null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO pending_writes (table_name, op, row_id, payload, enqueued_at, base_updated_at) ` +
      `VALUES (?, ?, ?, ?, ?, ?)`,
    table,
    op,
    row.id,
    JSON.stringify(row),
    new Date().toISOString(),
    baseUpdatedAt,
  );
}

// A write that has failed this many times is quarantined: left in the queue for
// diagnosis but no longer retried, so one permanently-rejected row cannot block
// its table's queue forever.
export const MAX_PUSH_ATTEMPTS = 5;

export async function listPendingWrites(): Promise<
  Array<{
    id: number;
    table_name: SyncableTable;
    op: PendingOp;
    row_id: string;
    payload: string;
    attempts: number;
    base_updated_at: string | null;
  }>
> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT id, table_name, op, row_id, payload, attempts, base_updated_at FROM pending_writes ` +
      `WHERE attempts < ? ORDER BY id`,
    MAX_PUSH_ATTEMPTS,
  );
}

/** Writes that have exhausted their retries. Surfaced in diagnostics. */
/**
 * Edits made on this device that have not reached the server yet (G2-69).
 *
 * Asked before a sign-out, because signing out now wipes the local database —
 * and that database is where unsent edits live. Someone who logged three doses
 * on a plane and then signed out would lose them silently, which is a worse bug
 * than the one the wipe fixes.
 */
export async function countPendingWrites(): Promise<number> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) as n FROM pending_writes`);
  return r?.n ?? 0;
}

export async function countQuarantinedWrites(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT count(*) AS n FROM pending_writes WHERE attempts >= ?`,
    MAX_PUSH_ATTEMPTS,
  );
  return row?.n ?? 0;
}

/** The distinct errors behind quarantined writes, for the diagnostics screen. */
export async function listQuarantinedErrors(): Promise<
  Array<{ table_name: string; row_id: string; attempts: number; last_error: string | null }>
> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT table_name, row_id, attempts, last_error FROM pending_writes ` +
      `WHERE attempts >= ? ORDER BY id`,
    MAX_PUSH_ATTEMPTS,
  );
}

export async function markWriteAttempted(id: number, error?: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE pending_writes SET attempts = attempts + 1, last_error = ? WHERE id = ?`,
    error ?? null,
    id,
  );
}

export async function deleteWrite(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM pending_writes WHERE id = ?`, id);
}

// ---- known_ids -------------------------------------------------------------

/**
 * Remember that the server has this row, and which version of it we were told
 * about (G2-28).
 *
 * `serverUpdatedAt` must be a value that came FROM the server — a pulled row's
 * updated_at, or the one an upsert returned. Passing the mirror's own
 * locally-stamped updated_at would defeat the purpose: the server's
 * `set_updated_at` trigger overwrites whatever this device sends, so a local
 * stamp never matches and every update would look contested.
 */
export async function recordKnownId(
  table: SyncableTable,
  id: string,
  serverUpdatedAt?: string | null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO known_ids (table_name, row_id, seen_at, server_updated_at) VALUES (?, ?, ?, ?) ` +
      `ON CONFLICT(table_name, row_id) DO UPDATE SET seen_at = excluded.seen_at, ` +
      // COALESCE so a caller that does not know the version cannot blank a
      // version we already had — that would silently turn conflict detection
      // off for the row.
      `server_updated_at = COALESCE(excluded.server_updated_at, known_ids.server_updated_at)`,
    table,
    id,
    new Date().toISOString(),
    serverUpdatedAt ?? null,
  );
}

export async function isKnownId(table: SyncableTable, id: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM known_ids WHERE table_name = ? AND row_id = ?`,
    table,
    id,
  );
  return (row?.n ?? 0) > 0;
}

export { SYNCABLE_TABLES };

// ---------------------------------------------------------------------------
// Write conflicts (G2-28)
//
// An edit that was not applied because someone else had changed the same row
// first. Previously the engine merged by timestamp and the loser was never
// told, so one sibling's dosage change could vanish in silence.
//
// Both sides are kept. Nothing here is a resolution — it is the record that a
// choice is owed, and the data needed to make it.
// ---------------------------------------------------------------------------

export type WriteConflict = {
  id: number;
  table_name: SyncableTable;
  row_id: string;
  base_updated_at: string | null;
  server_updated_at: string;
  /** What this device tried to write. */
  mine: Row;
  /** What the server held instead. */
  theirs: Row;
  detected_at: string;
};

export async function recordConflict(args: {
  table: SyncableTable;
  rowId: string;
  baseUpdatedAt: string | null;
  serverUpdatedAt: string;
  mine: Row;
  theirs: Row;
}): Promise<void> {
  const db = await getDb();
  // One open conflict per row. A device that keeps syncing while a conflict is
  // unresolved would otherwise file the same one every cycle and bury the
  // original under duplicates.
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM write_conflicts WHERE table_name = ? AND row_id = ? AND resolved_at IS NULL`,
    args.table,
    args.rowId,
  );
  if (existing) {
    await db.runAsync(
      `UPDATE write_conflicts SET server_updated_at = ?, theirs = ?, detected_at = ? WHERE id = ?`,
      args.serverUpdatedAt,
      JSON.stringify(args.theirs),
      new Date().toISOString(),
      existing.id,
    );
    return;
  }
  await db.runAsync(
    `INSERT INTO write_conflicts
       (table_name, row_id, base_updated_at, server_updated_at, mine, theirs, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args.table,
    args.rowId,
    args.baseUpdatedAt,
    args.serverUpdatedAt,
    JSON.stringify(args.mine),
    JSON.stringify(args.theirs),
    new Date().toISOString(),
  );
}

export async function listOpenConflicts(): Promise<WriteConflict[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: number;
    table_name: SyncableTable;
    row_id: string;
    base_updated_at: string | null;
    server_updated_at: string;
    mine: string;
    theirs: string;
    detected_at: string;
  }>(
    `SELECT id, table_name, row_id, base_updated_at, server_updated_at, mine, theirs, detected_at
     FROM write_conflicts WHERE resolved_at IS NULL ORDER BY detected_at DESC`,
  );
  return rows.map((r) => ({
    ...r,
    mine: JSON.parse(r.mine) as Row,
    theirs: JSON.parse(r.theirs) as Row,
  }));
}

export async function countOpenConflicts(): Promise<number> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) as n FROM write_conflicts WHERE resolved_at IS NULL`,
  );
  return r?.n ?? 0;
}

/**
 * Close a conflict. `resolution` records WHICH way it went, so "I kept theirs"
 * is distinguishable later from "I never looked at it" — the row is kept rather
 * than deleted for exactly that reason.
 */
export async function resolveConflict(
  id: number,
  resolution: 'kept-mine' | 'kept-theirs',
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE write_conflicts SET resolved_at = ?, resolution = ? WHERE id = ?`,
    new Date().toISOString(),
    resolution,
    id,
  );
}
