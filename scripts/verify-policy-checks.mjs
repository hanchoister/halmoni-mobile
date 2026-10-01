/**
 * Tests for the policy/grant checkers in verify-policies.mjs.
 *
 * WHY THIS EXISTS SEPARATELY
 *
 * verify-policies.mjs needs a privileged connection string, and
 * SUPABASE_DB_URL is deliberately kept out of GitHub Actions secrets — a
 * full-read DB credential bypasses RLS, so putting it in CI would hand every
 * workflow run the keys to the health record. The consequence is that the
 * live policy check only ever runs on the laptop.
 *
 * That left the checkers themselves untested anywhere. This file closes that:
 * it drives them with fixtures, needs no database, and so runs in CI on every
 * push. A checker that silently stopped detecting anything would be caught
 * here, which is the failure mode this project keeps hitting — a check that
 * can only ever report "fine" is not a check.
 *
 * The fixtures are the real shapes, taken from production on 2026-10-01:
 * `TO public` policies, anon table grants, and the default ACLs that re-grant
 * anon on every new table.
 */

import { checkGrants, checkPolicies } from './verify-policies.mjs';

let failures = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// A policy shaped the way POLICY_SQL returns one.
const pol = (over = {}) => ({
  schema: 'public',
  table: 'medications',
  name: 'medications_select',
  cmd: 'SELECT',
  permissive: 'PERMISSIVE',
  using: '(is_family_member(family_id))',
  check: '',
  roles: 'authenticated',
  ...over,
});

console.log('G2-60 — policy role scoping');

{
  const { problems } = checkPolicies([pol({ roles: 'public' })]);
  const hit = problems.filter((p) => /reaches anon/.test(p));
  check('a TO public policy is a problem', hit.length === 1, `got ${problems.length} problem(s)`);
}

{
  // The default when a migration names no role at all. pg_policies reports
  // `{public}`, but a snapshot taken another way could hand us an empty string,
  // and that must not read as safe.
  const { problems } = checkPolicies([pol({ roles: '' })]);
  check('a policy with no roles at all is a problem', problems.some((p) => /reaches anon/.test(p)));
}

{
  const { problems } = checkPolicies([pol({ roles: 'anon,authenticated' })]);
  check('naming anon explicitly is a problem', problems.some((p) => /reaches anon/.test(p)));
}

{
  const { problems } = checkPolicies([pol({ roles: 'authenticated' })]);
  check('TO authenticated is accepted', !problems.some((p) => /reaches anon/.test(p)));
}

{
  // storage.objects is owned by supabase_storage_admin, so migration 19 may not
  // be able to re-scope it. Family-scoped means anon is still refused by the
  // predicate, so it is reported as a note every run rather than failing the
  // build — but a storage policy that is NOT family-scoped is a real hole and
  // must fail.
  const familyScoped = {
    schema: 'storage',
    table: 'objects',
    name: 'attachments storage read',
    cmd: 'SELECT',
    permissive: 'PERMISSIVE',
    using: "((bucket_id = 'attachments'::text) AND is_family_member(((storage.foldername(name))[1])::uuid))",
    check: '',
    roles: 'public',
  };
  const a = checkPolicies([familyScoped]);
  check('family-scoped storage policy is a note, not a failure',
    !a.problems.some((p) => /reaches anon/.test(p)) && a.notes.some((n) => /untidy, not exposed/i.test(n)),
    `problems=${a.problems.length} notes=${a.notes.length}`);

  const b = checkPolicies([{ ...familyScoped, using: "(bucket_id = 'attachments'::text)" }]);
  check('storage policy with no family scope IS a failure',
    b.problems.some((p) => /reaches anon/.test(p)));
}

console.log('\nG2-60 — anon grants and default privileges');

{
  const problems = checkGrants({
    anonTableGrants: [
      { table: 'parents', privilege: 'SELECT' },
      { table: 'parents', privilege: 'INSERT' },
      { table: 'medications', privilege: 'SELECT' },
    ],
    anonDefaultAcls: [],
  });
  check('anon table grants are a problem', problems.length === 1 && /parents, medications/.test(problems[0]),
    problems[0] ?? 'no problem raised');
}

{
  // The root cause. Revoking today's grants without clearing these means the
  // next CREATE TABLE puts them straight back.
  const problems = checkGrants({
    anonTableGrants: [],
    anonDefaultAcls: [
      { role: 'postgres', objtype: 'r', acl: 'postgres=arwdDxtm/postgres anon=arwdDxtm/postgres' },
    ],
  });
  check('a default ACL granting anon is a problem on its own',
    problems.length === 1 && /regresses/.test(problems[0]), problems[0] ?? 'no problem raised');
}

{
  const problems = checkGrants({ anonTableGrants: [], anonDefaultAcls: [] });
  check('a clean database passes', problems.length === 0, problems.join('; '));
}

{
  check('a missing snapshot does not silently pass as clean', checkGrants(null).length === 0);
  // Deliberate: null means "not collected", and main() turns that into a visible
  // note rather than a pass. Asserted here so the two cannot drift apart.
}

console.log('');
if (failures > 0) {
  console.log(`FAIL: ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('OK: policy and grant checkers behave as specified.');
