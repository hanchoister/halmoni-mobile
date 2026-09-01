#!/usr/bin/env node
// Writes scripts/schema-snapshot.json — the reviewed shape of the local mirror.
// Run this ONLY when a schema change is intentional, and commit the result in
// the same commit as the change, so the diff shows both together.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/lib/db/schema.ts'), 'utf8');

const tables = {};
const re = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\)`/g;
let m;
while ((m = re.exec(src)) !== null) {
  const [, table, body] = m;
  const cols = [];
  for (const line of body.split('\n')) {
    const c = /^\s*([a-z_]+)\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)\b(.*)$/i.exec(line);
    // Record nullability too: the handoffs.from_member_id bug was a NOT NULL
    // the mirror had and Postgres did not, which no server-side check can see.
    if (c) cols.push(`${c[1]}${/NOT NULL/i.test(c[3]) ? '!' : ''}`);
  }
  tables[table] = cols;
}
const version = /SCHEMA_VERSION\s*=\s*(\d+)/.exec(src)?.[1] ?? '?';
writeFileSync(
  join(root, 'scripts/schema-snapshot.json'),
  JSON.stringify({ schemaVersion: Number(version), tables }, null, 2) + '\n',
);
console.log(`snapshot written (schema version ${version}, ${Object.keys(tables).length} tables)`);
