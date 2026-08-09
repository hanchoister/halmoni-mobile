// SQLite client. Single lazily-opened handle for the app process.
// Runs schema migrations on first open (CREATE TABLE IF NOT EXISTS style —
// idempotent, so re-runs are safe).

import * as SQLite from 'expo-sqlite';

import { CREATE_TABLE_SQL, SCHEMA_VERSION } from '@/lib/db/schema';

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
    for (const stmt of CREATE_TABLE_SQL) {
      await db.execAsync(stmt);
    }
    // Version metadata for future migrations.
    await db.execAsync(
      `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`,
    );
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
