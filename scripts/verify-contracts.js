#!/usr/bin/env node
/**
 * Contract check: does the code depend on anything the migrations do not define?
 *
 * This exists because of a specific failure. The encrypted care kit was
 * advertised on the landing page and had never once worked: the `share_kits`
 * table and the `get_share_kit_metadata` RPC existed in a migration file that
 * had never been applied, so every share link 404'd. Nothing in the codebase
 * noticed, because nothing checks that `.from('x')` and `.rpc('y')` refer to
 * things that exist.
 *
 * Static and dependency-free: it reads the source and the SQL, so it runs in CI
 * without database credentials. It cannot see whether prod matches the
 * migrations — that is verify-prod.js, which needs a key.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const source = files.map((f) => ({ f, text: fs.readFileSync(f, 'utf8') }));
const sql = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
  .join('\n')
  .toLowerCase()
  // Migrations qualify with `public.`; call sites do not. Normalise so the two
  // can be compared without every declaration reading as missing.
  .replace(/\bpublic\./g, '')
  .replace(/\s+/g, ' ');

// Tables and RPCs the demo client fakes rather than hitting Postgres.
const DEMO_ONLY = new Set(['share-kits']);

const failures = [];
const usedTables = new Map();
const usedRpcs = new Map();

for (const { f, text } of source) {
  if (f.includes('supabase-demo')) continue; // the fake client, not a consumer
  for (const m of text.matchAll(/\.from\('([a-z_]+)'\)/g)) {
    if (!usedTables.has(m[1])) usedTables.set(m[1], f);
  }
  for (const m of text.matchAll(/\.rpc\('([a-z_]+)'/g)) {
    if (!usedRpcs.has(m[1])) usedRpcs.set(m[1], f);
  }
}

for (const [table, where] of usedTables) {
  if (DEMO_ONLY.has(table)) continue;
  const defined =
    sql.includes(`create table if not exists ${table}`) ||
    sql.includes(`create table ${table}`);
  if (!defined) {
    failures.push(`table '${table}' is queried in ${path.relative(ROOT, where)} but no migration creates it`);
  }
}

for (const [rpc, where] of usedRpcs) {
  const defined =
    sql.includes(`function ${rpc}(`) || sql.includes(`function ${rpc} (`);
  if (!defined) {
    failures.push(`rpc '${rpc}' is called in ${path.relative(ROOT, where)} but no migration defines it`);
  }
}

console.log(`checked ${usedTables.size} tables and ${usedRpcs.size} rpcs against ${MIGRATIONS.replace(ROOT + '/', '')}`);
if (failures.length) {
  console.log('\nFAIL');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('PASS: every table and rpc the app uses is defined in a migration');
