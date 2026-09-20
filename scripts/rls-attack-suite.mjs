#!/usr/bin/env node
// The RLS attack suite, run with real user JWTs (G1-03 / G1-30).
//
// Why this exists, and why the checks we already had could not replace it:
//
//   verify-schema.mjs   compares columns. Blind to policies.
//   verify-policies.mjs compares pg_policies to the migrations. It proves the
//                       policy TEXT is what we meant to write. It cannot prove
//                       the policy BEHAVES that way, and it needs a direct
//                       database connection, which bypasses RLS entirely.
//
// Every previous check of this system ran either through the SQL editor or
// through an MCP connection. Both connect as a privileged role, and RLS is not
// applied to them. So every "the policies look right" result to date was
// produced by a path on which RLS is switched off — a test that can only pass.
//
// This suite does the opposite. It holds two real accounts, each in their own
// family, signs them in through GoTrue like the app does, and then tries to
// make one of them read and write the other's health data through PostgREST
// with a genuine user JWT. That is the path an attacker actually has.
//
// USAGE
//
//   PROBE_A_EMAIL=… PROBE_A_PASSWORD=… \
//   PROBE_B_EMAIL=… PROBE_B_PASSWORD=… \
//   node scripts/rls-attack-suite.mjs
//
// The two accounts must already exist and be confirmed. Creating them is a
// deliberate manual step: this script never provisions accounts on production
// by itself, because a script that can create users is a script that can be
// run carelessly against real data.
//
// Exit 0 = every attack was repelled. Exit 1 = at least one got through, or
// the suite could not run. It never exits 0 on "skipped" — a security check
// that quietly skips reports "fine" forever, which is exactly how CI went
// unwatched for a month (G0-11).

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://wyovvbnlhyqfmnvsgket.supabase.co';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? 'sb_publishable_P2L_Trg6gFipDixjIPH5qA_wXEKVRsW';

// Every table whose rows are scoped to a family by a family_id column. These
// are the ones where a leak means one family reading another's health record.
const FAMILY_SCOPED = [
  'parents', 'medications', 'med_doses', 'appointments', 'visit_notes',
  'symptoms', 'handoffs', 'on_duty', 'thread_messages', 'notes',
  'attachments', 'check_ins', 'appointment_questions', 'voice_notes',
  'shared_er_cards', 'audit_log', 'parent_consent_events', 'family_invites',
  'presence',
];

const results = [];
let failures = 0;

function record(area, name, outcome, detail) {
  results.push({ area, name, outcome, detail });
  if (outcome === 'LEAK' || outcome === 'ERROR') failures++;
}

async function rest(path, { token, method = 'GET', body, prefer } = {}) {
  const headers = { apikey: KEY, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  return { status: res.status, json, text };
}

async function signIn(email, password) {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!body.access_token) {
    throw new Error(`sign-in failed for ${email}: ${body.error_description ?? body.msg ?? res.status}`);
  }
  return { token: body.access_token, userId: body.user.id };
}

// ---------------------------------------------------------------------------

async function main() {
  const need = ['PROBE_A_EMAIL', 'PROBE_A_PASSWORD', 'PROBE_B_EMAIL', 'PROBE_B_PASSWORD'];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Cannot run: missing ${missing.join(', ')}.`);
    console.error('This suite refuses to skip. See the header for how to provision probe accounts.');
    process.exit(1);
  }

  const A = await signIn(process.env.PROBE_A_EMAIL, process.env.PROBE_A_PASSWORD);
  const B = await signIn(process.env.PROBE_B_EMAIL, process.env.PROBE_B_PASSWORD);
  console.log(`Signed in as two distinct users (${A.userId.slice(0, 8)}…, ${B.userId.slice(0, 8)}…)\n`);

  // Each probe's own family. Both must already have one; create_family is the
  // app's own path, so using it keeps the fixture honest.
  const famA = await rest(`family_members?user_id=eq.${A.userId}&select=family_id,id,is_owner&limit=1`, { token: A.token });
  const famB = await rest(`family_members?user_id=eq.${B.userId}&select=family_id,id&limit=1`, { token: B.token });
  const familyA = famA.json?.[0]?.family_id;
  const familyB = famB.json?.[0]?.family_id;
  const memberIdA = famA.json?.[0]?.id;
  if (!familyA || !familyB) throw new Error('each probe account needs its own family before the suite runs');
  if (familyA === familyB) throw new Error('probes share a family — the suite would prove nothing');

  // -- 1. Cross-family reads -------------------------------------------------
  // A asks, explicitly, for rows belonging to B's family.
  // presence is keyed by (member_id, family_id) and has no id column, so asking
  // for `id` there returns 42703 and proves nothing. Select a column that exists.
  for (const table of FAMILY_SCOPED) {
    const col = table === 'presence' ? 'family_id' : 'id';
    const r = await rest(`${table}?family_id=eq.${familyB}&select=${col}`, { token: A.token });
    if (r.status >= 400) {
      record('read', table, 'ERROR', `HTTP ${r.status} ${r.text.slice(0, 120)}`);
    } else if (Array.isArray(r.json) && r.json.length === 0) {
      record('read', table, 'REPELLED', '0 rows');
    } else {
      record('read', table, 'LEAK', `${r.json?.length} row(s) of another family returned`);
    }
  }

  // -- 2. Cross-family writes ------------------------------------------------
  // Insert attempts carry B's family_id. A 42501 is RLS refusing. A constraint
  // error (23502 etc.) is NOT counted as a pass: the row was stopped by a NOT
  // NULL rule that happens to fire first, which tells us nothing about RLS, so
  // it is reported as INCONCLUSIVE rather than quietly banked as a win.
  // parents additionally carries parents_consent_shape, a CHECK that fires
  // before RLS and would mask the result, so that probe sends a consent-complete
  // row — the point is to learn what RLS does, not to re-prove the constraint.
  const now = new Date().toISOString();
  const consentComplete = {
    name: 'RLS probe', consent_basis: 'parent_agreed', consent_attested_at: now,
    consent_notice_version: '2026-09-11', consent_sharing_at: now,
  };

  for (const table of FAMILY_SCOPED) {
    const body = { family_id: familyB };
    if (table === 'parents') Object.assign(body, consentComplete, { consent_attested_by: memberIdA });
    const r = await rest(table, {
      token: A.token, method: 'POST', body, prefer: 'return=representation',
    });
    const code = r.json?.code ?? '';
    if (r.status === 201) {
      record('write', table, 'LEAK', 'insert into another family succeeded');
    } else if (code === '42501' || r.status === 403) {
      record('write', table, 'REPELLED', 'RLS refused (42501)');
    } else {
      record('write', table, 'INCONCLUSIVE', `HTTP ${r.status} ${code || r.text.slice(0, 60)}`);
    }
  }

  // -- 3. Cross-family update and delete ------------------------------------
  // PostgREST reports 0 rows when RLS hides the target, which is the same shape
  // as "no such row" — so these prove absence of effect, not absence of rows.
  for (const table of ['medications', 'parents', 'med_doses', 'notes']) {
    const upd = await rest(`${table}?family_id=eq.${familyB}`, {
      token: A.token, method: 'PATCH', body: { updated_at: new Date().toISOString() }, prefer: 'return=representation',
    });
    const touched = Array.isArray(upd.json) ? upd.json.length : -1;
    record('update', table, touched === 0 ? 'REPELLED' : touched > 0 ? 'LEAK' : 'INCONCLUSIVE',
      touched >= 0 ? `${touched} row(s) affected` : `HTTP ${upd.status}`);

    const del = await rest(`${table}?family_id=eq.${familyB}`, {
      token: A.token, method: 'DELETE', prefer: 'return=representation',
    });
    const removed = Array.isArray(del.json) ? del.json.length : -1;
    record('delete', table, removed === 0 ? 'REPELLED' : removed > 0 ? 'LEAK' : 'INCONCLUSIVE',
      removed >= 0 ? `${removed} row(s) affected` : `HTTP ${del.status}`);
  }

  // -- 4. Privilege escalation ----------------------------------------------
  // The "members update" policy is USING (user_id = auth.uid()) with no WITH
  // CHECK, so on its own it would let a member rewrite their own row — is_owner
  // included — and an owner can rename the family. What stops it is a trigger,
  // enforce_owner_change_by_owner, not the policy. Worth proving the trigger is
  // actually attached on production rather than merely present in a migration.
  const selfRow = await rest(`family_members?user_id=eq.${A.userId}&select=id,is_owner`, { token: A.token });
  const memberId = selfRow.json?.[0]?.id;
  if (memberId) {
    const promote = await rest(`family_members?id=eq.${memberId}`, {
      token: A.token, method: 'PATCH', body: { is_owner: true }, prefer: 'return=representation',
    });
    const wasAlreadyOwner = selfRow.json[0].is_owner === true;
    if (wasAlreadyOwner) {
      record('escalate', 'self-promote to owner', 'INCONCLUSIVE', 'probe already owns its family');
    } else if (promote.status === 200 && promote.json?.[0]?.is_owner === true) {
      record('escalate', 'self-promote to owner', 'LEAK', 'a member promoted themselves');
    } else {
      record('escalate', 'self-promote to owner', 'REPELLED', `HTTP ${promote.status}`);
    }
  }

  // A tries to read B's membership rows, which carry user ids.
  const members = await rest(`family_members?family_id=eq.${familyB}&select=id`, { token: A.token });
  record('escalate', 'read another family\'s members',
    members.json?.length === 0 ? 'REPELLED' : 'LEAK', `${members.json?.length ?? '?'} row(s)`);

  // A tries to file a terms acceptance in B's name. The policy checks
  // user_id = auth.uid(), so this should be refused outright.
  const terms = await rest('terms_acceptances', {
    token: A.token, method: 'POST', body: { user_id: B.userId, version: 'probe' }, prefer: 'return=representation',
  });
  record('escalate', 'accept terms as another user',
    terms.status === 201 ? 'LEAK' : 'REPELLED', `HTTP ${terms.status} ${terms.json?.code ?? ''}`);

  // -- 5. Consent enforcement through the real path -------------------------
  // G1-28/G1-32 are enforced by both a WITH CHECK and a trigger. They have only
  // ever been exercised over a privileged connection.
  const noConsent = await rest('parents', {
    token: A.token, method: 'POST',
    body: { family_id: familyA, name: 'RLS probe parent' },
    prefer: 'return=representation',
  });
  record('consent', 'parent stored without a recorded basis',
    noConsent.status === 201 ? 'LEAK' : 'REPELLED', `HTTP ${noConsent.status} ${noConsent.json?.code ?? ''}`);

  // -- 6. Anonymous access ---------------------------------------------------
  // No token at all: the publishable key alone.
  for (const table of ['parents', 'medications', 'med_doses', 'families', 'family_members']) {
    const r = await rest(`${table}?select=id&limit=1`, {});
    const leaked = Array.isArray(r.json) && r.json.length > 0;
    record('anon', `read ${table}`, leaked ? 'LEAK' : 'REPELLED',
      leaked ? `${r.json.length} row(s) without any login` : `HTTP ${r.status}, 0 rows`);
  }

  // evergreen_metrics carries an INSERT policy for the anon role with a WITH
  // CHECK of `true` (G2-47). Anyone holding the publishable key — which ships
  // in the app binary and is therefore public — can write rows. It holds no
  // health data, so this is hygiene rather than exposure, but it is unbounded
  // and it lives in the same database as the health record.
  // No return=representation here, deliberately. Asking PostgREST to hand the
  // row back requires SELECT as well, and anon has no SELECT policy — so the
  // insert gets refused for the wrong reason and the probe reports a false
  // "repelled". The honest test writes and asks nothing back.
  const anonWrite = await rest('evergreen_metrics', {
    method: 'POST',
    body: { install_id: crypto.randomUUID(), iso_week: '2026-W38' },
  });
  record('anon', 'write evergreen_metrics',
    (anonWrite.status === 201 || anonWrite.status === 204) ? 'OPEN-BY-DESIGN' : 'REPELLED',
    `HTTP ${anonWrite.status} ${anonWrite.json?.code ?? ''}`);

  // ---------------------------------------------------------------------------

  const width = Math.max(...results.map((r) => r.name.length)) + 2;
  let area = '';
  for (const r of results) {
    if (r.area !== area) { area = r.area; console.log(`\n${area.toUpperCase()}`); }
    const mark = { REPELLED: '  ok  ', LEAK: ' LEAK ', ERROR: ' ERR  ', INCONCLUSIVE: ' ??   ', 'OPEN-BY-DESIGN': ' note ' }[r.outcome];
    console.log(`[${mark}] ${r.name.padEnd(width)} ${r.detail}`);
  }

  const leaks = results.filter((r) => r.outcome === 'LEAK');
  const unclear = results.filter((r) => r.outcome === 'INCONCLUSIVE');
  console.log(`\n${results.length} probes — ${results.filter(r => r.outcome === 'REPELLED').length} repelled, ${leaks.length} leaked, ${unclear.length} inconclusive`);

  if (leaks.length) {
    console.log('\nLEAKS:');
    for (const l of leaks) console.log(`  ${l.area}/${l.name}: ${l.detail}`);
  }
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(`\nSuite could not run: ${err.message}`);
  process.exit(1);
});
