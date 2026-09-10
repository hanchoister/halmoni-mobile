#!/usr/bin/env node
/**
 * Consent check: can a parent's health data still be stored without a recorded
 * basis for holding it? (G1-28)
 *
 * This exists for the same reason verify-contracts.js does. The care kit was
 * advertised for months and had never worked; the Sentry scrub leaked a
 * medication the first time anyone looked. Both were things everyone assumed
 * were true. "We ask for permission" is now a claim in the app's privacy
 * policy, in an App Store review answer, and — under Washington's My Health My
 * Data Act — in a statement a private plaintiff can sue over. A claim that size
 * needs a machine watching it.
 *
 * Static and dependency-free: reads the source and the SQL, no database, no
 * network. It checks that all four enforcement layers are still wired and that
 * they still agree with each other, because the failure mode here is not a
 * layer vanishing — it is two layers quietly disagreeing about what counts.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const MIGRATION = path.join(ROOT, 'supabase', 'migrations', '00000000000008_parent_consent.sql');
const CONSENT_TS = path.join(SRC, 'lib', 'consent.ts');
const WRITE_PATH = path.join(SRC, 'lib', 'sync', 'write-path.ts');

const failures = [];
const fail = (msg) => failures.push(msg);
const read = (p) => fs.readFileSync(p, 'utf8');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

// --- layer 1: the database ---------------------------------------------------
if (!fs.existsSync(MIGRATION)) {
  fail('the parent-consent migration is gone — supabase/migrations/00000000000008_parent_consent.sql');
}
const sql = fs.existsSync(MIGRATION) ? read(MIGRATION) : '';
const sqlFlat = sql.toLowerCase().replace(/\s+/g, ' ');

for (const col of [
  'consent_basis',
  'consent_attested_at',
  'consent_attested_by',
  'consent_notice_version',
]) {
  if (!sqlFlat.includes(`add column if not exists ${col}`)) {
    fail(`the migration no longer adds parents.${col}`);
  }
}

// The presence constraint is the actual guarantee: a live parent row without a
// basis cannot be written. Everything else is a better error message.
if (!sqlFlat.includes('constraint parents_consent_required')) {
  fail('the parents_consent_required constraint is missing — nothing stops an unattested parent row');
}
if (!sqlFlat.includes('deleted_at is not null or consent_basis is not null')) {
  fail('parents_consent_required no longer requires a basis on live rows');
}
if (!sqlFlat.includes('constraint parents_consent_shape')) {
  fail('the parents_consent_shape constraint is missing — a half-filled attestation could be stored');
}
if (!sqlFlat.includes('trigger parents_enforce_consent')) {
  fail('the parents_enforce_consent trigger is missing');
}
if (!sqlFlat.includes('trigger parents_record_consent')) {
  fail('the parents_record_consent trigger is missing — no evidence trail is written');
}
if (!sqlFlat.includes('create table if not exists parent_consent_events')) {
  fail('parent_consent_events is missing — there is nothing to produce if consent is ever questioned');
}
// The trail is only evidence if the people it is evidence about cannot edit it.
if (!/revoke\s+(all|insert[\s\S]{0,40}?)\s+on\s+parent_consent_events\s+from[^;]*authenticated/i.test(sql)) {
  fail('parent_consent_events no longer revokes write access from authenticated — the audit trail is editable by clients');
}
if (/grant[^;]*\b(insert|update|delete)\b[^;]*on\s+parent_consent_events/i.test(sql)) {
  fail('parent_consent_events grants a write privilege — the audit trail must be append-only from outside');
}
if (/create policy parent_consent_events_(insert|update|delete)/i.test(sql)) {
  fail('parent_consent_events has a write policy — the audit trail must be append-only from outside');
}
// RLS repeats the rule so it survives a dropped trigger.
const insertPolicy = /create policy parents_insert on parents[\s\S]*?;/i.exec(sql);
if (!insertPolicy || !/consent_basis is not null/i.test(insertPolicy[0])) {
  fail('the parents_insert RLS policy no longer requires a consent basis');
}
const updatePolicy = /create policy parents_update on parents[\s\S]*?;/i.exec(sql);
if (!updatePolicy || !/consent_basis is not null/i.test(updatePolicy[0])) {
  fail('the parents_update RLS policy no longer requires a consent basis');
}

// --- layer 2: the two lists of allowed bases must not drift ------------------
const ts = read(CONSENT_TS);
const tsListMatch = /export const CONSENT_BASES: ConsentBasis\[\] = \[([\s\S]*?)\];/.exec(ts);
if (!tsListMatch) {
  fail('CONSENT_BASES could not be read out of src/lib/consent.ts');
}
const tsBases = tsListMatch
  ? [...tsListMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
  : [];

const sqlListMatch = /consent_basis in \(([\s\S]*?)\)/i.exec(sql);
const sqlBases = sqlListMatch
  ? [...sqlListMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
  : [];

if (tsBases.length === 0) fail('no consent bases found in src/lib/consent.ts');
if (sqlBases.length === 0) fail('no consent bases found in the migration CHECK constraint');
if (tsBases.join(',') !== sqlBases.join(',')) {
  fail(
    `the app and the database disagree about which bases are valid:\n` +
      `      app: ${tsBases.join(', ') || '(none)'}\n` +
      `      db:  ${sqlBases.join(', ') || '(none)'}\n` +
      `      A basis the app offers and the database rejects fails at sync, after the user believes they are done.`,
  );
}

// Every basis the app offers needs the wording that goes with it, or the screen
// renders an empty option and the printed notice says nothing.
for (const b of tsBases) {
  if (!new RegExp(`\\b${b}:\\s*\\{`).test(ts)) {
    fail(`consent basis '${b}' has no entry in CONSENT_BASIS_COPY`);
  }
}

// --- layer 3: the version stored on the row must resolve to real words -------
const versionMatch = /export const CONSENT_NOTICE_VERSION = '([^']+)'/.exec(ts);
if (!versionMatch) {
  fail('CONSENT_NOTICE_VERSION is missing from src/lib/consent.ts');
} else if (!new RegExp(`'${versionMatch[1]}':\\s*\\{`).test(ts)) {
  fail(
    `CONSENT_NOTICE_VERSION is '${versionMatch[1]}' but NOTICE_ARCHIVE has no entry for it — ` +
      'the app would store a pointer to wording nobody can produce',
  );
}

// --- layer 4: the client write path -----------------------------------------
const wp = read(WRITE_PATH);
if (!/validateConsent/.test(wp) || !/guardParentConsent/.test(wp)) {
  fail('src/lib/sync/write-path.ts no longer guards parent writes');
}
if (!/writeRow\([\s\S]{0,400}?guardParentConsent/.test(wp)) {
  fail('guardParentConsent is defined but writeRow no longer calls it');
}

// Nothing may reach the `parents` table except through the guarded write path.
// The sync engine's generic .from(table) push is exempt: those rows already
// passed the guard on their way into the mirror.
const files = walk(SRC);
for (const f of files) {
  const rel = path.relative(ROOT, f);
  const text = read(f);
  if (rel.includes('supabase-demo') || rel.includes('demo-fixtures')) continue;
  if (/\.from\('parents'\)\s*\.\s*(insert|upsert|update)/.test(text)) {
    fail(`${rel} writes to the parents table directly, bypassing the consent guard`);
  }
  // Any call site that creates a parent has to carry an attestation. Spreading
  // an existing row (`...parent`) carries the one already stored.
  for (const m of text.matchAll(/writeRow\('parents',\s*\{/g)) {
    const block = text.slice(m.index, m.index + 1200);
    if (!/buildConsent\(/.test(block) && !/\.\.\.parent\b/.test(block)) {
      fail(
        `${rel} writes a parents row without an attestation — call buildConsent() or spread the existing row`,
      );
    }
  }
}

console.log(
  `checked 4 enforcement layers, ${tsBases.length} consent bases and ${files.length} source files`,
);
if (failures.length) {
  console.log('\nFAIL');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('PASS: a parent\'s health data cannot be stored without a recorded basis for holding it');
