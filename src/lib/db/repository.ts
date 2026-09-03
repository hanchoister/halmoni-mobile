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
 * trips through SQLite-compiled-to-WebAssembly left halmoni.uk/demo showing
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

export async function enqueueWrite(
  table: SyncableTable,
  op: PendingOp,
  row: Row,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO pending_writes (table_name, op, row_id, payload, enqueued_at) ` +
      `VALUES (?, ?, ?, ?, ?)`,
    table,
    op,
    row.id,
    JSON.stringify(row),
    new Date().toISOString(),
  );
}

// A write that has failed this many times is quarantined: left in the queue for
// diagnosis but no longer retried, so one permanently-rejected row cannot block
// its table's queue forever.
export const MAX_PUSH_ATTEMPTS = 5;

export async function listPendingWrites(): Promise<
  Array<{ id: number; table_name: SyncableTable; op: PendingOp; row_id: string; payload: string; attempts: number }>
> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT id, table_name, op, row_id, payload, attempts FROM pending_writes ` +
      `WHERE attempts < ? ORDER BY id`,
    MAX_PUSH_ATTEMPTS,
  );
}

/** Writes that have exhausted their retries. Surfaced in diagnostics. */
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

export async function recordKnownId(table: SyncableTable, id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO known_ids (table_name, row_id, seen_at) VALUES (?, ?, ?) ` +
      `ON CONFLICT(table_name, row_id) DO UPDATE SET seen_at = excluded.seen_at`,
    table,
    id,
    new Date().toISOString(),
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
