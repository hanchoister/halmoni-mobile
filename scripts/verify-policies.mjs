#!/usr/bin/env node
// Asserts that production's row-level security matches what the migrations say (G2-36).
//
// Production was built by hand, not from supabase/migrations. On 2026-09-10 ten of
// the twelve synced tables turned out to carry one permissive FOR ALL policy
// named "<table> rw" instead of the four per-command policies the repo creates.
// Nothing noticed, because verify-schema.mjs compares columns and nothing
// compared policies. It mattered the moment a migration tried to tighten one:
// permissive policies OR together, so the new parents_insert in migration 8
// would have done nothing on production while "parents rw" still existed.
// The share-kits storage hole (G2-35) has the same shape.
//
// This needs a real database connection. verify-schema.mjs gets away with the
// publishable key because PostgREST reports missing columns, but PostgREST
// cannot see pg_policies at all.
//
//   SUPABASE_DB_URL='postgresql://…' node scripts/verify-policies.mjs
//   node scripts/verify-policies.mjs --from-file policies.json   (offline, for testing the rules)
//
// With neither, it FAILS rather than skipping. A check that quietly skips when
// it cannot run reports "fine" forever, which is how CI went unwatched (G0-11).
//
// Exit 0 = clean, 1 = drift found or could not check.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// Run verbatim against production to produce a --from-file snapshot as well.
export const POLICY_SQL = `
select coalesce(json_agg(json_build_object(
  'schema', schemaname, 'table', tablename, 'name', policyname, 'cmd', cmd,
  'permissive', permissive, 'using', coalesce(qual, ''), 'check', coalesce(with_check, '')
) order by schemaname, tablename, policyname), '[]')
from pg_policies where schemaname in ('public', 'storage');
`;

// Every family-scoped synced table gets exactly the four policies that
// 00000000000002 creates. parents is here too; 00000000000008 replaces its insert
// and update policies with stricter ones of the same name.
const FAMILY_SCOPED = [
  'parents',
  'medications',
  'med_doses',
  'appointments',
  'visit_notes',
  'symptoms',
  'handoffs',
  'on_duty',
  'thread_messages',
  'notes',
];
const COMMANDS = [
  ['select', 'SELECT'],
  ['insert', 'INSERT'],
  ['update', 'UPDATE'],
  ['delete', 'DELETE'],
];

// Hand-built on production, with rules that really differ from 00000000000002
// (for example, only a non-owner may remove themselves). Aligning them changes
// who can do what, so it is a decision rather than a cleanup. They are listed
// so the difference shows on every run, and any further change to them fails.
const KNOWN_DIVERGENT = {
  families: ['families read', 'families update'],
  family_members: ['members delete', 'members read', 'members update'],
};

// Run verbatim against production alongside POLICY_SQL. Policies alone cannot
// catch the two worst bugs this project has had, because both lived inside
// functions rather than in policy text.
export const FUNCTION_SQL = `
select coalesce(json_agg(json_build_object(
  'name', p.proname, 'secdef', p.prosecdef,
  'config', coalesce(array_to_string(p.proconfig, ','), ''),
  'def', pg_get_functiondef(p.oid)
) order by p.proname), '[]')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public';
`;

// Functions that live in the `extensions` schema on Supabase. A function whose
// search_path is pinned to 'public' cannot see them unqualified — which is
// exactly how create_invite broke (migration 13).
const EXTENSION_FUNCTIONS = [
  'gen_random_bytes', 'crypt', 'gen_salt', 'digest', 'hmac',
  'encrypt', 'decrypt', 'uuid_generate_v4', 'uuid_generate_v1',
];

// Membership predicates. Any function that decides "is this caller allowed to
// see this family's rows" must exclude members whose membership has ended.
const MEMBERSHIP_PREDICATES = ['is_family_member'];

export function checkFunctions(functions) {
  const problems = [];

  for (const f of functions) {
    const pinned = /search_path/.test(f.config);

    // Class 1 — the migration 14 bug. A membership predicate that asks whether
    // a row EXISTS rather than whether it is still live. This one silently gave
    // removed members permanent read and write access to a family's health
    // record, across all 26 tables at once, because every policy calls it.
    if (MEMBERSHIP_PREDICATES.includes(f.name) && !/deleted_at\s+is\s+null/i.test(f.def)) {
      problems.push(
        `${f.name}(): does not exclude members whose deleted_at is set. Every policy on every family-scoped table calls this, so a removed member keeps full access (migration 14).`,
      );
    }

    // Class 2 — an unpinned search_path on a SECURITY DEFINER function lets the
    // caller control name resolution inside a privileged body.
    if (f.secdef && !pinned) {
      problems.push(`${f.name}(): SECURITY DEFINER with no pinned search_path.`);
    }

    // Class 3 — the migration 13 bug. Pinning search_path is correct, and it
    // silently broke every call to pgcrypto, because those functions live in
    // the extensions schema. Invites stopped working for ten days and no test
    // noticed, because nothing called the function on the real path.
    if (pinned && !/extensions/.test(f.config)) {
      for (const fn of EXTENSION_FUNCTIONS) {
        const unqualified = new RegExp(`(^|[^.\\w])${fn}\\s*\\(`);
        // Strip qualified uses first, so extensions.gen_random_bytes(...) is fine.
        const body = f.def.replace(new RegExp(`\\bextensions\\.${fn}`, 'g'), '');
        if (unqualified.test(body)) {
          problems.push(
            `${f.name}(): calls ${fn}() unqualified while search_path is pinned to '${f.config}'. ${fn} lives in the extensions schema, so this throws 42883 at runtime (migration 13).`,
          );
        }
      }
    }
  }

  for (const name of MEMBERSHIP_PREDICATES) {
    if (!functions.some((f) => f.name === name)) {
      problems.push(`${name}(): not found on the database at all.`);
    }
  }

  return problems;
}

function findPsql() {
  const candidates = [
    process.env.PSQL,
    '/opt/homebrew/opt/libpq/bin/psql',
    '/opt/homebrew/bin/psql',
    '/usr/local/bin/psql',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? 'psql';
}

function loadPolicies() {
  const i = process.argv.indexOf('--from-file');
  if (i !== -1) return JSON.parse(readFileSync(process.argv[i + 1], 'utf8'));

  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.log('Cannot check policies: SUPABASE_DB_URL is not set.');
    console.log('Get it from the Supabase dashboard (Connect → Session pooler) and run:');
    console.log("  SUPABASE_DB_URL='postgresql://…' node scripts/verify-policies.mjs");
    console.log('Failing rather than skipping, because a skipped check reads as a clean one.');
    process.exit(1);
  }
  const out = execFileSync(findPsql(), [url, '-At', '-v', 'ON_ERROR_STOP=1', '-c', POLICY_SQL], {
    encoding: 'utf8',
  });
  return JSON.parse(out.trim());
}

export function checkPolicies(policies) {
  const problems = [];
  const notes = [];
  const pub = policies.filter((p) => p.schema === 'public');
  const byTable = (t) => pub.filter((p) => p.table === t);

  for (const t of FAMILY_SCOPED) {
    const ps = byTable(t);
    const expected = new Set(COMMANDS.map(([s]) => `${t}_${s}`));
    for (const p of ps) {
      if (p.cmd === 'ALL' && p.permissive === 'PERMISSIVE') {
        problems.push(
          `${t}: permissive FOR ALL policy "${p.name}". It ORs with every per-command policy, so tightening any of them does nothing.`,
        );
      } else if (!expected.has(p.name)) {
        problems.push(`${t}: unexpected policy "${p.name}" [${p.cmd}]. It is not in any migration.`);
      }
    }
    for (const [suffix, cmd] of COMMANDS) {
      const want = `${t}_${suffix}`;
      const p = ps.find((x) => x.name === want);
      if (!p) problems.push(`${t}: missing ${want}`);
      else if (p.cmd !== cmd) problems.push(`${t}: ${want} is ${p.cmd}, expected ${cmd}`);
    }
  }

  // G1-28: the consent rule has to be in the RLS layer, not just the trigger.
  for (const name of ['parents_insert', 'parents_update']) {
    const p = pub.find((x) => x.table === 'parents' && x.name === name);
    if (p && !/consent_basis/.test(p.check)) {
      problems.push(`parents: ${name} does not require a consent basis (migration 8 not applied?)`);
    }
  }

  for (const [t, names] of Object.entries(KNOWN_DIVERGENT)) {
    const actual = byTable(t).map((p) => p.name).sort();
    if (JSON.stringify(actual) === JSON.stringify([...names].sort())) {
      notes.push(`${t}: known divergence from 00000000000002 (${names.join(', ')}). Needs a decision, not a cleanup.`);
    } else {
      problems.push(`${t}: policies changed from the recorded divergence. Now: ${actual.join(', ') || 'none'}`);
    }
  }

  // G2-35: every policy touching the share-kits bucket must be family-scoped.
  for (const p of policies.filter((x) => x.schema === 'storage')) {
    const text = `${p.using} ${p.check}`;
    if (text.includes("'share-kits'") && !text.includes('is_family_member')) {
      problems.push(
        `storage.objects: "${p.name}" [${p.cmd}] on share-kits is not family-scoped, so any signed-in user passes it (G2-35).`,
      );
    }
  }

  return { problems, notes };
}

function loadFunctions() {
  const i = process.argv.indexOf('--functions-from-file');
  if (i !== -1) return JSON.parse(readFileSync(process.argv[i + 1], 'utf8'));
  if (process.argv.includes('--from-file')) return null; // offline policy-only run

  const out = execFileSync(findPsql(), [process.env.SUPABASE_DB_URL, '-At', '-v', 'ON_ERROR_STOP=1', '-c', FUNCTION_SQL], {
    encoding: 'utf8',
  });
  return JSON.parse(out.trim());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { problems, notes } = checkPolicies(loadPolicies());
  const functions = loadFunctions();
  const fnProblems = functions ? checkFunctions(functions) : [];
  if (!functions) notes.push('function checks skipped: offline --from-file run without --functions-from-file.');

  const all = [...problems, ...fnProblems];
  for (const n of notes) console.log(`note: ${n}`);
  if (all.length === 0) {
    console.log('OK: production policies match the migrations, and the function invariants hold.');
    process.exit(0);
  }
  console.log(`\nFAIL: ${all.length} problem(s)`);
  for (const p of all) console.log(`  - ${p}`);
  process.exit(1);
}
