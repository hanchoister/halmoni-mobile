// SQLite client. Single lazily-opened handle for the app process.
// Runs schema migrations on first open (CREATE TABLE IF NOT EXISTS style —
// idempotent, so re-runs are safe).

import * as SQLite from 'expo-sqlite';

import { CREATE_TABLE_SQL, SCHEMA_VERSION, SYNCABLE_TABLES } from '@/lib/db/schema';

// Everything rebuildable from the server. Dropping sync_meta resets the
// per-table high-water marks, which is what forces the full re-pull.
const REBUILDABLE_TABLES: string[] = [...SYNCABLE_TABLES, 'sync_meta', 'known_ids'];

const DB_NAME = 'halmoni.db';

let _db: SQLite.SQLiteDatabase | null = null;
let _initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    // Enable FK checks + WAL for concurrent readers.
    await db.execAsync('PRAGMA journal_mode = WAL');
    await db.execAsync('PRAGMA foreign_keys = ON');
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`,
    );

    // CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so
    // a changed column definition would never reach an installed device — and
    // SQLite cannot drop a NOT NULL in place anyway. The mirror is a cache of the
    // server, so the honest migration is to discard it and re-pull rather than
    // hand-write an ALTER path for every future shape change.
    //
    // pending_writes is deliberately kept: those are the user's own edits that
    // have not reached the server yet, and the one thing here that syncing
    // cannot recover.
    const existing = await db.getFirstAsync<{ version: number }>(
      `SELECT version FROM schema_version LIMIT 1`,
    );
    if (existing && existing.version < SCHEMA_VERSION) {
      for (const table of REBUILDABLE_TABLES) {
        await db.execAsync(`DROP TABLE IF EXISTS ${table}`);
      }
      await db.runAsync(`DELETE FROM schema_version`);
    }

    for (const stmt of CREATE_TABLE_SQL) {
      await db.execAsync(stmt);
    }
    await db.runAsync(
      `INSERT OR IGNORE INTO schema_version (version) VALUES (?)`,
      SCHEMA_VERSION,
    );
    _db = db;
    return db;
  })();

  return _initPromise;
}

// Test helper — closes the handle and wipes the DB file. Not for prod use.
export async function _resetDb(): Promise<void> {
  if (_db) {
    await _db.closeAsync();
    _db = null;
  }
  _initPromise = null;
  await SQLite.deleteDatabaseAsync(DB_NAME);
}
