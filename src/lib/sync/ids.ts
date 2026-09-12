/**
 * Are these ids ones the server could possibly accept?
 *
 * Found on 2026-09-11, on a real device, by the only method that could have
 * found it: the outbox held 430 failing writes, every one of them
 * `invalid input syntax for type uuid: "demo-fam-1"`. The app was pushing demo
 * fixtures at production.
 *
 * Demo mode seeds the Smith family into the same SQLite tables a real account
 * syncs into, and `demoActive` is a module-level flag — it lives in memory,
 * while the seeded rows live on disk. Restart the app and the flag is false
 * again while the fixtures are still there, so the sync engine sees them as
 * ordinary local rows and tries to send them. Open the demo, force-quit, open
 * again, sign in, and it happens to anyone.
 *
 * demo-seed.ts now clears that residue before a real session starts, which is
 * the actual fix. This is the backstop: even if residue survives some path
 * nobody thought of, a fixture id cannot reach production.
 *
 * Columns are found by shape (`id`, `*_id`) rather than by a hand-written list,
 * because a hand-written list of columns is the thing this codebase keeps
 * getting wrong — SYNCABLE_TABLES and LIVE_TABLES have to agree by hand, and
 * the sync payload keys were hand-listed in four places in Evergreen.
 */

/** Canonical 8-4-4-4-12, any version. Postgres `uuid` accepts exactly this. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSyncableId(value: unknown): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Every column whose name says it holds an id. */
export function idColumns(row: Record<string, unknown>): string[] {
  return Object.keys(row).filter((k) => k === 'id' || k.endsWith('_id'));
}

/**
 * The first id column holding something the server cannot parse as a uuid, or
 * null when the row is safe to send. Null and undefined pass: plenty of id
 * columns are nullable, and "absent" is not "malformed".
 */
export function firstUnsyncableId(
  row: Record<string, unknown>,
): { column: string; value: unknown } | null {
  for (const column of idColumns(row)) {
    const value = row[column];
    if (value === null || value === undefined) continue;
    if (!isSyncableId(value)) return { column, value };
  }
  return null;
}
