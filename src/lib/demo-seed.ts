// Populate the local SQLite mirror from the demo fixtures so screens (which
// read from the mirror) render immediately when a user taps "Try demo".
// Idempotent: wipes the syncable tables first so re-entering demo starts fresh.

import { getDb } from '@/lib/db/client';
import { upsertRows } from '@/lib/db/repository';
import { SYNCABLE_TABLES } from '@/lib/db/schema';
import { buildDemoStore } from '@/lib/demo-fixtures';
import { bumpDataVersion } from '@/lib/db/signal';

let seeded = false;

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
      updated_at: r.updated_at ?? r.created_at ?? now,
      ...r,
    }));
    await upsertRows(t, rows);
  }
  seeded = true;
  bumpDataVersion();
}

export function hasSeededDemo(): boolean {
  return seeded;
}

export function resetDemoSeedFlag(): void {
  seeded = false;
}
