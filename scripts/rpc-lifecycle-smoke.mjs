#!/usr/bin/env node
// Call the family RPCs for real, as a signed-in user (G1-03 follow-on).
//
// Why this is separate from the attack suite: the attack suite proves nobody
// can reach another family's data. It says nothing about whether the app's own
// happy path works. On 2026-09-20 create_invite had been throwing 42883 on
// production — "function gen_random_bytes(integer) does not exist" — because
// the hardening that pinned search_path to 'public' hid pgcrypto, which lives
// in the extensions schema. Nobody could invite a sibling, in an app whose
// entire premise is siblings sharing a parent's care.
//
// Nothing caught it for ten days. verify-schema compares columns. verify-
// policies compares policy text. Both are blind to a function that parses fine
// and throws at runtime. Only calling it finds that, and only calling it as a
// real user over PostgREST calls it the way the app does.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//
// It never creates or deletes an account, and it never creates a family. Email
// confirmation is on, so a self-provisioning test cannot run unattended, and a
// test that destroys its own fixtures cannot run twice. So this exercises the
// RPCs reachable without either, and cleans up the one row it writes.
//
// create_family and delete_my_account are therefore NOT covered here. They are
// covered by the fixtures existing at all — every probe family was made by
// create_family — and delete_my_account stays a manual pre-release check,
// because a passing automated test of it would mean deleting a real account on
// every run.
//
//   PROBE_A_EMAIL=… PROBE_A_PASSWORD=… node scripts/rpc-lifecycle-smoke.mjs
//
// Exit 0 = the RPCs work. Exit 1 = one of them is broken, or it could not run.

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://wyovvbnlhyqfmnvsgket.supabase.co';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? 'sb_publishable_P2L_Trg6gFipDixjIPH5qA_wXEKVRsW';

const CODE_SHAPE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/; // create_invite's alphabet, I/L/O/U excluded

let failures = 0;
function check(name, ok, detail) {
  console.log(`[${ok ? '  ok  ' : ' FAIL '}] ${name.padEnd(46)} ${detail}`);
  if (!ok) failures++;
}

async function call(path, { token, method = 'GET', body, prefer } = {}) {
  const headers = { apikey: KEY, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, json, text };
}

async function main() {
  if (!process.env.PROBE_A_EMAIL || !process.env.PROBE_A_PASSWORD) {
    console.error('Cannot run: PROBE_A_EMAIL and PROBE_A_PASSWORD are required.');
    console.error('Failing rather than skipping — a skipped check reads as a clean one.');
    process.exit(1);
  }

  const auth = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.PROBE_A_EMAIL, password: process.env.PROBE_A_PASSWORD }),
  }).then((r) => r.json());
  if (!auth.access_token) {
    console.error(`Cannot run: sign-in failed (${auth.error_description ?? auth.msg ?? 'no token'})`);
    process.exit(1);
  }
  const token = auth.access_token;

  const me = await call('family_members?select=family_id&limit=1', { token });
  const familyId = me.json?.[0]?.family_id;
  if (!familyId) {
    console.error('Cannot run: probe A has no family.');
    process.exit(1);
  }

  // 1. create_invite — the one that was broken. A 42883 here is the regression.
  const made = await call('rpc/create_invite', { token, method: 'POST', body: { fid: familyId } });
  const code = typeof made.json === 'string' ? made.json : null;
  check('create_invite returns a code', made.status === 200 && CODE_SHAPE.test(code ?? ''),
    made.status === 200 ? `code ${code ? `${code.slice(0, 3)}…` : made.text.slice(0, 80)}` : `HTTP ${made.status} ${made.json?.message ?? ''}`);

  // 2. The invite must actually be on the table, with an expiry.
  let inviteId = null;
  if (code) {
    const row = await call(`family_invites?code=eq.${code}&select=id,expires_at,revoked_at`, { token });
    const invite = row.json?.[0];
    inviteId = invite?.id ?? null;
    check('the invite row persisted with an expiry',
      Boolean(invite?.expires_at) && invite?.revoked_at === null,
      invite ? `expires ${String(invite.expires_at).slice(0, 10)}` : 'no row found');
  }

  // 3. accept_invite must RUN. A bogus code should come back as the function's
  //    own error, which proves the body executed rather than failing to resolve
  //    a symbol. 42883 would surface here too.
  const bogus = await call('rpc/accept_invite', {
    token, method: 'POST', body: { code_in: 'ZZZZZZZZZZ', member_name: 'smoke' },
  });
  check('accept_invite rejects an unknown code', bogus.json?.code === 'P0001',
    `${bogus.json?.code ?? bogus.status}: ${(bogus.json?.message ?? '').slice(0, 44)}`);

  // 4. accept_invite on a real code, called by someone already in the family,
  //    must return the family id and NOT add a duplicate membership. This is
  //    the only non-destructive way to exercise the success path.
  if (code) {
    const before = await call('family_members?select=id', { token });
    const again = await call('rpc/accept_invite', {
      token, method: 'POST', body: { code_in: code, member_name: 'smoke' },
    });
    const after = await call('family_members?select=id', { token });
    const sameCount = before.json?.length === after.json?.length;
    check('accept_invite is idempotent for a member',
      again.status === 200 && again.json === familyId && sameCount,
      `HTTP ${again.status}, members ${before.json?.length} → ${after.json?.length}`);
  }

  // 5. Clean up: revoke the invite this run created, so the table does not grow
  //    by one row per build.
  if (inviteId) {
    const revoked = await call(`family_invites?id=eq.${inviteId}`, {
      token, method: 'PATCH', body: { revoked_at: new Date().toISOString() }, prefer: 'return=representation',
    });
    check('the test invite was revoked afterwards', Array.isArray(revoked.json) && revoked.json.length === 1,
      `${Array.isArray(revoked.json) ? revoked.json.length : '?'} row(s)`);
  }

  console.log(failures ? `\nFAIL: ${failures} broken RPC path(s)` : '\nOK: the family RPCs work on the real path.');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(`\nSmoke test could not run: ${err.message}`);
  process.exit(1);
});
