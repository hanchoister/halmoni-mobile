// Populate the local SQLite mirror from the demo fixtures so screens (which
// read from the mirror) render immediately when a user taps "Try demo".
// Idempotent: wipes the syncable tables first so re-entering demo starts fresh.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { getDb } from '@/lib/db/client';
import { bulkInsertRows } from '@/lib/db/repository';
import { SYNCABLE_TABLES } from '@/lib/db/schema';
import { buildDemoStore } from '@/lib/demo-fixtures';
import { bumpDataVersion } from '@/lib/db/signal';

let seeded = false;

/**
 * Survives a restart, unlike `seeded` and unlike demo-mode's own `demoActive`.
 *
 * That difference is the whole bug (found 2026-09-11 on a device): the flag
 * saying "this mirror holds fixtures" lived in memory while the fixtures lived
 * on disk. Relaunch, and the app believed it was looking at real data — the
 * sync engine queued 430 med_dose updates at production, every one rejected
 * with `invalid input syntax for type uuid: "demo-fam-1"`.
 *
 * Prefixed `halmoni` so wipeLocalData()'s prefix sweep clears it too.
 */
const DEMO_RESIDUE_KEY = 'halmoni.demoSeeded';

export async function seedDemoDataIntoDb(): Promise<void> {
  const db = await getDb();
  // Reset every syncable table + the bookkeeping ones. Demo runs are
  // self-contained; nothing should leak from a prior real-account session.
  await db.withTransactionAsync(async () => {
    for (const t of SYNCABLE_TABLES) await db.runAsync(`DELETE FROM ${t}`);
    await db.runAsync(`DELETE FROM pending_writes`);
    await db.runAsync(`DELETE FROM known_ids`);
    await db.runAsync(`DELETE FROM sync_meta`);
  });

  const store = buildDemoStore();
  const now = new Date().toISOString();
  for (const t of SYNCABLE_TABLES) {
    const rows = (store[t] ?? []).map((r: any) => ({
      // Every mirror table declares created_at NOT NULL, but the generated
      // fixtures — med_doses especially, which are built in a loop — do not set
      // it. The insert then failed the constraint, wa-sqlite reported it as the
      // unhelpful "Error finalizing statement", and because the seed was called
      // as `void seedDemoDataIntoDb()` the rejection was swallowed. The demo
      // came up with an empty mirror and every tab showed its "nothing here
      // yet" state.
      created_at: r.created_at ?? r.scheduled_at ?? now,
      updated_at: r.updated_at ?? r.created_at ?? now,
      ...r,
    }));
    await bulkInsertRows(t, rows);
  }
  seeded = true;
  try {
    await AsyncStorage.setItem(DEMO_RESIDUE_KEY, new Date().toISOString());
  } catch {
    // Worst case the marker is missing and purgeDemoResidue() cannot tell the
    // mirror is fixtures. The id guard in sync/write-path.ts still stops any of
    // it reaching the server.
  }
  bumpDataVersion();
}

/**
 * Clear fixtures out of the mirror before a real account uses it.
 *
 * Called when a real session becomes active. Demo rows are not deleted through
 * the write path on purpose: they must not become tombstones in an outbox and
 * get pushed as deletes for rows the server has never heard of.
 *
 * Returns true when it actually cleared something, so the caller can log it
 * rather than wonder.
 */
export async function purgeDemoResidue(): Promise<boolean> {
  let marker: string | null = null;
  try {
    marker = await AsyncStorage.getItem(DEMO_RESIDUE_KEY);
  } catch {
    return false;
  }
  if (!marker) return false;

  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const t of SYNCABLE_TABLES) await db.runAsync(`DELETE FROM ${t}`);
    await db.runAsync(`DELETE FROM pending_writes`);
    await db.runAsync(`DELETE FROM known_ids`);
    await db.runAsync(`DELETE FROM sync_meta`);
  });
  try {
    await AsyncStorage.removeItem(DEMO_RESIDUE_KEY);
  } catch {
    // Leaving the marker only costs one extra purge on the next launch.
  }
  seeded = false;
  bumpDataVersion();
  return true;
}

export function hasSeededDemo(): boolean {
  return seeded;
}

export function resetDemoSeedFlag(): void {
  seeded = false;
}
