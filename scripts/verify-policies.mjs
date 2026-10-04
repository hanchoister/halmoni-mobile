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
  'permissive', permissive, 'using', coalesce(qual, ''), 'check', coalesce(with_check, ''),
  'roles', array_to_string(roles, ',')
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

// Run verbatim against production alongside POLICY_SQL. G2-60: policies are
// only half of the answer — a role also needs a GRANT to reach a table at all,
// and `pg_default_acl` decides what the NEXT table will grant. The default ACLs
// are the part that made this regress-by-default: they carried `anon=arwdDxtm`,
// so every new table was granted to anon automatically.
export const GRANT_SQL = `
select json_build_object(
  'anonTableGrants', coalesce((
    select json_agg(json_build_object('table', table_name, 'privilege', privilege_type)
                    order by table_name, privilege_type)
    from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'), '[]'::json),
  'anonDefaultAcls', coalesce((
    select json_agg(json_build_object('role', pg_get_userbyid(d.defaclrole),
                                      'objtype', d.defaclobjtype::text,
                                      'acl', array_to_string(d.defaclacl, ' '))
                    order by pg_get_userbyid(d.defaclrole), d.defaclobjtype::text)
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    where n.nspname = 'public'
      and array_to_string(d.defaclacl, ' ') like '%anon=%'), '[]'::json)
) ;
`;

/**
 * G2-60. Nothing may reach a `public` table as `anon`.
 *
 * Both halves matter. The grants are today's state; the default ACLs are
 * tomorrow's, and leaving those alone is how the problem comes back on its own
 * the next time anyone adds a table.
 */
export function checkGrants(grants) {
  const problems = [];
  if (!grants) return problems;

  const tableGrants = grants.anonTableGrants ?? [];
  if (tableGrants.length > 0) {
    const tables = [...new Set(tableGrants.map((g) => g.table))];
    problems.push(
      `anon holds ${tableGrants.length} grant(s) on ${tables.length} public table(s): ${tables.join(', ')}. ` +
        'The publishable key ships in the app binary, so anon is public. Migration 19 revokes these (G2-60).',
    );
  }

  for (const d of grants.anonDefaultAcls ?? []) {
    problems.push(
      `default privileges for role ${d.role} on ${d.objtype} in public still grant anon (${d.acl}). ` +
        'The next table created here would be granted to anon automatically, which is how this regresses ' +
        'without anyone making a mistake (G2-60, migration 19 section 4).',
    );
  }

  return problems;
}

// Run verbatim against production alongside the others. G2-61: the blanking of
// a deleted record's content lives in triggers, and a trigger is the easiest
// kind of protection to lose — `create or replace` on the function leaves it,
// but a later migration that recreates the TABLE drops every trigger on it
// silently, and nothing else would notice.
export const TRIGGER_SQL = `
select coalesce(json_agg(json_build_object(
  'table', c.relname, 'name', t.tgname, 'enabled', t.tgenabled <> 'D'
) order by c.relname, t.tgname), '[]')
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal;
`;

// Tables whose tombstones must be blanked (migration 20). on_duty, families and
// family_members are deliberately absent — see the migration's header for why.
const BLANKED_TABLES = [
  'parents', 'medications', 'med_doses', 'appointments', 'visit_notes',
  'symptoms', 'handoffs', 'thread_messages', 'notes',
];

/**
 * G2-61. A deleted record must stop containing anything.
 *
 * Checked here rather than trusted because of what it protects: before
 * migration 20, "delete" left 805 tombstoned med_doses, 4 medications and 2
 * parents fully intact on production, with names, conditions and DNR status, and
 * no purge job anywhere — while the privacy policy told families deletion
 * reached every phone.
 *
 * Also asserts the trigger is ENABLED. `ALTER TABLE ... DISABLE TRIGGER` leaves
 * it present in pg_trigger, so existence alone is not the question.
 */
export function checkTriggers(triggers) {
  const problems = [];
  if (!triggers) return problems;

  for (const table of BLANKED_TABLES) {
    const want = `${table}_blank_deleted_content`;
    const t = triggers.find((x) => x.table === table && x.name === want);
    if (!t) {
      problems.push(
        `${table}: missing trigger ${want}. A deleted ${table} row would keep its content ` +
          'on the server and on every phone, which the privacy policy says it does not (G2-61, migration 20).',
      );
    } else if (!t.enabled) {
      problems.push(`${table}: trigger ${want} exists but is DISABLED (G2-61).`);
    }
  }

  // The escalation guard the attack suite's probe D tests. Same reasoning: it is
  // the only thing stopping a member making themselves owner, since the
  // "members update" policy has no WITH CHECK.
  for (const [table, name] of [
    ['family_members', 'enforce_owner_change_by_owner'],
    ['family_members', 'zz_enforce_member_self_edit_allowlist'],
  ]) {
    const t = triggers.find((x) => x.table === table && x.name === name);
    if (!t) problems.push(`${table}: missing trigger ${name} (G2-52 / G2-54).`);
    else if (!t.enabled) problems.push(`${table}: trigger ${name} is DISABLED.`);
  }

  return problems;
}

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

  // G2-60: a policy naming no role is `TO public`, and `public` includes `anon`.
  // Nothing leaked when this was found — every predicate dereferenced
  // auth.uid(), which is NULL for anon — but that made confidentiality depend on
  // all 66 predicates being written correctly forever, and one had already not
  // been (evergreen_metrics_insert_anon, WITH CHECK true, HTTP 201 with nothing
  // but the publishable key). Scoped to `authenticated`, an unauthenticated
  // request is refused by role before any predicate runs, so the next sloppy
  // predicate fails closed.
  for (const p of policies) {
    const roles = (p.roles ?? '').split(',').map((r) => r.trim()).filter(Boolean);
    const reachesAnon = roles.length === 0 || roles.includes('public') || roles.includes('anon');
    if (!reachesAnon) continue;

    const scope = roles.length ? roles.join('+') : 'no role (= public)';

    // storage.objects is owned by supabase_storage_admin, so migration 19 may
    // not have had the privilege to re-scope these. A family-scoped one is
    // untidy rather than exposed, so it is reported every run as a note instead
    // of being silently allowed. One that is NOT family-scoped is a real hole.
    if (p.schema === 'storage') {
      const text = `${p.using} ${p.check}`;
      if (/is_family_member/.test(text)) {
        notes.push(
          `storage.${p.table}: "${p.name}" [${p.cmd}] is still TO ${scope}, but is family-scoped via ` +
            'is_family_member so anon is refused by the predicate. Migration 19 could not re-scope it ' +
            '(ALTER POLICY needs table ownership). Untidy, not exposed (G2-60).',
        );
        continue;
      }
    }

    problems.push(
      `${p.schema}.${p.table}: policy "${p.name}" [${p.cmd}] is scoped TO ${scope}, which reaches anon. ` +
        'Scope it TO authenticated (G2-60).',
    );
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

function loadTriggers() {
  const i = process.argv.indexOf('--triggers-from-file');
  if (i !== -1) return JSON.parse(readFileSync(process.argv[i + 1], 'utf8'));
  if (process.argv.includes('--from-file')) return null; // offline policy-only run

  const out = execFileSync(findPsql(), [process.env.SUPABASE_DB_URL, '-At', '-v', 'ON_ERROR_STOP=1', '-c', TRIGGER_SQL], {
    encoding: 'utf8',
  });
  return JSON.parse(out.trim());
}

function loadGrants() {
  const i = process.argv.indexOf('--grants-from-file');
  if (i !== -1) return JSON.parse(readFileSync(process.argv[i + 1], 'utf8'));
  if (process.argv.includes('--from-file')) return null; // offline policy-only run

  const out = execFileSync(findPsql(), [process.env.SUPABASE_DB_URL, '-At', '-v', 'ON_ERROR_STOP=1', '-c', GRANT_SQL], {
    encoding: 'utf8',
  });
  return JSON.parse(out.trim());
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

  const grants = loadGrants();
  const grantProblems = grants ? checkGrants(grants) : [];
  if (!grants) notes.push('grant checks skipped: offline --from-file run without --grants-from-file.');

  const triggers = loadTriggers();
  const triggerProblems = triggers ? checkTriggers(triggers) : [];
  if (!triggers) notes.push('trigger checks skipped: offline --from-file run without --triggers-from-file.');

  const all = [...problems, ...fnProblems, ...grantProblems, ...triggerProblems];
  for (const n of notes) console.log(`note: ${n}`);
  if (all.length === 0) {
    console.log(
      'OK: production policies match the migrations, the function invariants hold, ' +
        'nothing reaches a public table as anon, and a deleted record keeps no content.',
    );
    process.exit(0);
  }
  console.log(`\nFAIL: ${all.length} problem(s)`);
  for (const p of all) console.log(`  - ${p}`);
  process.exit(1);
}
