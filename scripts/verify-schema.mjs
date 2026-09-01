#!/usr/bin/env node
// Asserts that production has every column the local SQLite mirror expects.
//
// This is the check that would have caught the two worst bugs of 2026-08-31:
// `created_at` missing from five tables (so every push to them failed), and
// `med_doses.parent_id` / `on_duty.id` missing (the long-deferred conflicts).
// Both were invisible until a device tried to sync.
//
// Deliberately runs on the PUBLISHABLE key alone, so it needs no secret and can
// run in CI. The trick: ask PostgREST for an explicit column list. If a column
// does not exist it answers 400 and names it; RLS only affects which ROWS come
// back, and we do not care about rows. `limit=0` keeps it free.
//
// What it cannot see: nullability and types. PostgREST will not report those,
// so the handoffs.from_member_id class of bug — mirror stricter than Postgres —
// is not covered here. That gap is real and tracked separately.
//
//   node scripts/verify-schema.mjs
//
// Exit 0 = clean, 1 = drift found.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function loadEnv() {
  const out = {};
  for (const file of ['.env.local', '.env']) {
    let text;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

/** Column names per table, parsed from the mirror's own CREATE TABLE statements. */
function mirrorColumns() {
  const src = readFileSync(join(root, 'src/lib/db/schema.ts'), 'utf8');
  const tables = {};
  const re = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\)`/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, table, body] = m;
    const cols = [];
    for (const line of body.split('\n')) {
      const c = /^\s*([a-z_]+)\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)\b/i.exec(line);
      if (c) cols.push(c[1]);
    }
    tables[table] = cols;
  }
  return tables;
}

// Local-only bookkeeping; these have no server counterpart by design.
const LOCAL_ONLY = new Set(['pending_writes', 'sync_meta', 'known_ids', 'schema_version']);

const env = loadEnv();
const url = env.EXPO_PUBLIC_SUPABASE_URL;
const key = env.EXPO_PUBLIC_SUPABASE_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY in .env.local');
  process.exit(1);
}

const tables = mirrorColumns();
const problems = [];
let checked = 0;

for (const [table, cols] of Object.entries(tables)) {
  if (LOCAL_ONLY.has(table) || cols.length === 0) continue;
  checked++;
  const res = await fetch(
    `${url}/rest/v1/${table}?select=${cols.join(',')}&limit=0`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (res.ok) continue;

  const body = await res.text();
  // Narrow it down to the exact column(s) rather than reporting the whole table.
  const missing = [];
  for (const col of cols) {
    const one = await fetch(`${url}/rest/v1/${table}?select=${col}&limit=0`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!one.ok) missing.push(col);
  }
  problems.push({ table, missing, status: res.status, body: body.slice(0, 200) });
}

console.log(`verify-schema: checked ${checked} tables against ${new URL(url).host}`);

if (problems.length === 0) {
  console.log('OK — production has every column the local mirror expects.');
  process.exit(0);
}

console.error('\nDRIFT FOUND:\n');
for (const p of problems) {
  if (p.missing.length) {
    console.error(`  ${p.table}: missing on server -> ${p.missing.join(', ')}`);
  } else {
    console.error(`  ${p.table}: HTTP ${p.status} — ${p.body}`);
  }
}
console.error('\nEvery push to the tables above will fail until this is fixed.');
process.exit(1);
