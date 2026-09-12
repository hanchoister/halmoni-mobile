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
  'consent_sharing_at',
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
if (!sqlFlat.includes('deleted_at is not null or (consent_basis is not null and consent_sharing_at is not null)')) {
  fail('parents_consent_required no longer requires BOTH a basis and the separate sharing answer on live rows');
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
// Production carries a hand-made permissive FOR ALL policy, "parents rw".
// Permissive policies OR, so while it exists the two above are decoration.
if (!/drop policy if exists "parents rw" on parents/i.test(sql)) {
  fail('the migration no longer drops "parents rw" — on production that permissive policy lets unattested inserts through RLS');
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
  const entry = new RegExp(`\\b${b}:\\s*\\{([\\s\\S]*?)\\n  \\},`).exec(ts);
  if (!entry) {
    fail(`consent basis '${b}' has no entry in CONSENT_BASIS_COPY`);
    continue;
  }
  // Every basis needs its own sharing sentence. A basis that falls back to
  // another one's wording is a basis whose second answer was never really
  // asked, which is the gap G1-32 exists to close.
  for (const key of ['label', 'attestation', 'sharing', 'noticeLine']) {
    if (!new RegExp(`${key}:`).test(entry[1])) {
      fail(`consent basis '${b}' has no ${key} in CONSENT_BASIS_COPY`);
    }
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

// --- layer 5: holding and sharing are two answers (G1-32) -------------------
// Washington wants consent to share "separate and distinct" from consent to
// collect. One timestamp doing both jobs would satisfy every check above and
// none of the statute.
if (!/consent_sharing_at is null/i.test(sql) || !/consent_sharing_at is not null/i.test(sql)) {
  fail('the migration no longer enforces consent_sharing_at in its shape constraint');
}
if (!/consent_sharing_at/.test(sql.split('enforce_parent_consent')[1] || '')) {
  fail('the enforce_parent_consent trigger no longer mentions consent_sharing_at');
}
for (const policy of ['parents_insert', 'parents_update']) {
  const m = new RegExp(`create policy ${policy} on parents[\\s\\S]*?;`, 'i').exec(sql);
  if (!m || !/consent_sharing_at is not null/i.test(m[0])) {
    fail(`the ${policy} RLS policy no longer requires the separate sharing answer`);
  }
}
if (!/sharingAgreed/.test(ts) || !/buildConsent\(\s*basis: ConsentBasis,\s*sharingAgreed: boolean/.test(ts)) {
  fail('buildConsent() no longer takes the sharing answer as a required argument');
}

const NEW_PARENT = path.join(SRC, 'app', 'parent', 'new.tsx');
const newParent = fs.existsSync(NEW_PARENT) ? read(NEW_PARENT) : '';
// The notice has to be on screen BEFORE the question. Attesting that someone
// agreed, and only then offering to show them what they agreed to, is consent
// in the wrong order.
if (!/NOTICE_ARCHIVE\[CONSENT_NOTICE_VERSION\]/.test(newParent)) {
  fail('the add-parent screen no longer shows the notice text before asking for the attestation');
}
if (!/CONSENT_BASIS_COPY\[basis\]\.sharing/.test(newParent)) {
  fail('the add-parent screen no longer asks the separate sharing question');
}
if (!/NO_AUTHORITY_ACKNOWLEDGEMENT/.test(newParent)) {
  fail('the add-parent screen no longer shows the extra acknowledgement for no_formal_authority');
}

// Withdrawal. The printed notice promises it and Apple 5.1.1(ii) requires it.
const REMOVE = path.join(SRC, 'lib', 'parent-remove.ts');
const remove = fs.existsSync(REMOVE) ? read(REMOVE) : '';
if (!remove) fail('src/lib/parent-remove.ts is gone — the notice promises deletion that nothing implements');
const PROFILE = path.join(SRC, 'app', 'profile.tsx');
if (!/removeParent/.test(fs.existsSync(PROFILE) ? read(PROFILE) : '')) {
  fail('no screen calls removeParent() — there is no way to withdraw permission');
}
// Anything hanging off a parent must be swept with them, or "deleted" leaves
// their medications and appointments on every phone.
const schema = read(path.join(SRC, 'lib', 'db', 'schema.ts'));
const parentScoped = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n  \)`/g)]
  .filter(([, , body]) => /\bparent_id\b/.test(body))
  .map(([, table]) => table)
  .filter((t) => t !== 'parents');
// Read the list itself, not the whole file: describeRemoval() also mentions
// every table by name, so a plain grep would find 'symptoms' in the label map
// and report all clear after the real entry was deleted. Caught by negative
// test, which is the only reason to write them.
const sweptMatch = /export const PARENT_SCOPED_TABLES: SyncableTable\[\] = \[([\s\S]*?)\];/.exec(remove);
const swept = sweptMatch ? [...sweptMatch[1].matchAll(/'(\w+)'/g)].map((m) => m[1]) : [];
if (!sweptMatch) fail('PARENT_SCOPED_TABLES could not be read out of src/lib/parent-remove.ts');
for (const t of parentScoped) {
  if (!swept.includes(t)) {
    fail(`${t} has a parent_id but is not in PARENT_SCOPED_TABLES — removing a parent would orphan it`);
  }
}

// --- layer 6: the terms the USER agrees to, for themselves (G1-33) ----------
const TERMS_TS = path.join(SRC, 'lib', 'terms.ts');
const terms = fs.existsSync(TERMS_TS) ? read(TERMS_TS) : '';
if (!terms) fail('src/lib/terms.ts is gone');
for (const v of ['TERMS_VERSION', 'PRIVACY_VERSION']) {
  if (!new RegExp(`export const ${v} = '[^']+'`).test(terms)) fail(`${v} is missing from src/lib/terms.ts`);
}
// "Agree to the Terms, read the Privacy Policy." Agreeing to a privacy policy
// turns it into a contract term, so every later deviation is a breach of
// contract on top of whatever the regulator thinks. Policies describe;
// contracts bind.
const labelMatch = /export const ACCEPTANCE_LABEL =\s*'([^']+)'/.exec(terms);
if (!labelMatch) {
  fail('ACCEPTANCE_LABEL is missing from src/lib/terms.ts');
} else {
  const label = labelMatch[1];
  if (/agree[^,;.]*privacy policy/i.test(label)) {
    fail(`the acceptance label asks users to AGREE to the privacy policy: "${label}"`);
  }
  if (!/read[^,;.]*privacy policy/i.test(label)) {
    fail(`the acceptance label does not say the privacy policy has been read: "${label}"`);
  }
  if (!/terms/i.test(label)) fail(`the acceptance label does not mention the Terms: "${label}"`);
}
const TERMS_MIGRATION = path.join(ROOT, 'supabase', 'migrations', '00000000000010_terms_acceptances.sql');
const termsSql = fs.existsSync(TERMS_MIGRATION) ? read(TERMS_MIGRATION) : '';
if (!termsSql) fail('the terms_acceptances migration is gone');
if (/create policy terms_acceptances_(update|delete)/i.test(termsSql)) {
  fail('terms_acceptances has an update or delete policy — the record of an agreement must not be editable by a party to it');
}
const LOGIN = path.join(SRC, 'components', 'login-screen.tsx');
const login = fs.existsSync(LOGIN) ? read(LOGIN) : '';
if (!/useState\(false\)/.test(login.split('accepted')[1] || '')) {
  fail('the terms checkbox is not guaranteed to start unticked — a pre-ticked box is not a clear affirmative act');
}
if (!/if \(!accepted\)/.test(login)) fail('the sign-in screen no longer requires the terms box before sending a code');
if (!/recordTermsAcceptance/.test(login)) fail('the sign-in screen no longer records the acceptance');

console.log(
  `checked 6 enforcement layers, ${tsBases.length} consent bases, ${parentScoped.length} parent-scoped tables and ${files.length} source files`,
);
if (failures.length) {
  console.log('\nFAIL');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('PASS: a parent\'s health data cannot be stored without a recorded basis for holding it');
