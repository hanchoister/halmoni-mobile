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

if (import.meta.url === `file://${process.argv[1]}`) {
  const { problems, notes } = checkPolicies(loadPolicies());
  for (const n of notes) console.log(`note: ${n}`);
  if (problems.length === 0) {
    console.log('OK: production policies match the migrations.');
    process.exit(0);
  }
  console.log(`\nFAIL: ${problems.length} policy problem(s)`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
