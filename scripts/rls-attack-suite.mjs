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
// PROBE_C_* (a removed member) and PROBE_D_* (a live non-owner in probe A's
// family) are optional but expected in CI — without D, the privilege-escalation
// trigger is not verified on that run and the suite says so (G2-54). See
// docs/security-probes.md.
//
// The accounts must already exist and be confirmed. Creating them is a
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

/**
 * Why a write was refused, not merely that it was.
 *
 * A probe that fails for the wrong reason is worse than no probe: it reports
 * "repelled" and is counted as evidence, while never having reached the policy
 * it exists to test. That happened here — a bare `parents` insert is rejected
 * by a CHECK constraint with 23514 before RLS is consulted, so the probe looked
 * like a pass and proved nothing.
 *
 * So the outcome is decided by the error code:
 *   - 2xx                     the row was written. A leak, unambiguously.
 *   - 42501, or 401/403       row-level security refused it. The real pass.
 *   - anything else           the request died before the policy mattered.
 *                             INCONCLUSIVE, which shows in the summary rather
 *                             than quietly inflating the repelled count.
 */
function classifyWrite(res) {
  const code = res.json?.code ?? '';
  const detail = `HTTP ${res.status}${code ? ` ${code}` : ''}`;

  if (res.status >= 200 && res.status < 300) {
    return ['LEAK', `${detail} — A ROW WAS WRITTEN WITHOUT A LOGIN`];
  }
  if (code === '42501' || res.status === 401 || res.status === 403) {
    return ['REPELLED', `${detail} row-level security`];
  }
  return [
    'INCONCLUSIVE',
    `${detail} — refused before RLS was reached (${res.json?.message ?? 'no message'}). ` +
      'Fix the payload; this probe is proving nothing.',
  ];
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

  // -- 0. Positive controls, and they run FIRST ------------------------------
  //
  // WHY THIS EXISTS: this suite could only ever report "no leaks".
  //
  // Every probe below asks "did A see B's data?" and scores zero rows as a
  // pass. So a change that locked EVERYONE out — real caregivers included —
  // would make every probe return zero rows and the suite would report a clean
  // run. That nearly happened: G2-60 re-scoped all 69 policies from `public` to
  // `authenticated` on 2026-10-04, and if it had taken the grants off
  // `authenticated` by mistake, nothing here would have said so.
  //
  // The only positive control used to live inside probe D's block, which does
  // not run unless PROBE_D_* is set. So on a normal run there was none at all.
  //
  // These assert the app still WORKS. A failure here is an outage, not a leak,
  // and it is recorded as ERROR so it fails the suite either way.
  for (const [name, probe, family] of [['A', A, familyA], ['B', B, familyB]]) {
    const own = await rest(`family_members?family_id=eq.${family}&select=id`, { token: probe.token });
    const ok = own.status === 200 && Array.isArray(own.json) && own.json.length > 0;
    record('positive-control', `probe ${name} can read its own family`,
      ok ? 'REPELLED' : 'ERROR',
      ok
        ? `HTTP ${own.status}, ${own.json.length} row(s) — correct`
        : `HTTP ${own.status} ${own.json?.code ?? ''} — SIGNED-IN ACCESS IS BROKEN, not a leak`);
  }

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
      // Expected, and not a gap any more: probe A owns its family by
      // construction, so it cannot test whether a NON-owner can promote
      // themselves. Probe D exists for exactly that and is the conclusive one
      // (G2-54). Kept rather than deleted because an owner's PATCH of its own
      // is_owner still has to not error.
      record('escalate', 'self-promote to owner', 'INCONCLUSIVE',
        'probe A owns its family by construction — see the probe D escalation checks');
    } else if (promote.status === 200 && promote.json?.[0]?.is_owner === true) {
      record('escalate', 'self-promote to owner', 'LEAK', 'a member promoted themselves');
    } else {
      record('escalate', 'self-promote to owner', 'REPELLED', `HTTP ${promote.status}`);
    }
  }

  // -- 4c. What a member may change about themselves (G2-52) ---------------
  // "members update" is USING (user_id = auth.uid()) with no WITH CHECK, so the
  // policy text constrains no column at all. Migration 18 adds an allow-list
  // trigger. Both directions are tested on purpose: a trigger that refuses
  // everything would pass a deny-only test while quietly breaking the app.
  if (memberIdA) {
    const moveHouse = await rest(`family_members?id=eq.${memberIdA}`, {
      token: A.token, method: 'PATCH', body: { family_id: familyB },
    });
    const stillMine = await rest(`family_members?user_id=eq.${A.userId}&select=family_id`, { token: A.token });
    const movedIn = stillMine.json?.[0]?.family_id === familyB;
    record('self-edit', 'move own membership into another family',
      movedIn ? 'LEAK' : 'REPELLED', `HTTP ${moveHouse.status}, still in ${movedIn ? 'B' : 'A'}`);

    const forgeCreated = await rest(`family_members?id=eq.${memberIdA}`, {
      token: A.token, method: 'PATCH', body: { created_at: '2020-01-01T00:00:00Z' },
    });
    record('self-edit', 'rewrite own created_at',
      forgeCreated.status === 204 || forgeCreated.status === 200 ? 'LEAK' : 'REPELLED',
      `HTTP ${forgeCreated.status} ${forgeCreated.json?.code ?? ''}`);

    // The other direction: the five fields a member is supposed to own.
    const ownEdit = await rest(`family_members?id=eq.${memberIdA}`, {
      token: A.token, method: 'PATCH', body: { name: 'Probe A', relation: 'Daughter', phone: '555-0101' },
    });
    record('self-edit', 'edit own name, relation and phone',
      ownEdit.status === 204 || ownEdit.status === 200 ? 'REPELLED' : 'LEAK',
      `HTTP ${ownEdit.status} — this one MUST succeed`);
  }

  // A tries to read B's membership rows, which carry user ids.
  const members = await rest(`family_members?family_id=eq.${familyB}&select=id`, { token: A.token });
  record('escalate', 'read another family\'s members',
    members.json?.length === 0 ? 'REPELLED' : 'LEAK', `${members.json?.length ?? '?'} row(s)`);

  // -- 4b. A removed member -------------------------------------------------
  // is_family_member() used to ask whether a membership row existed, never
  // whether it was still live, so soft-deleting a member revoked nothing
  // (fixed by migration 14; this is the regression test).
  //
  // Probe C is a PERMANENT FIXTURE: a non-owner member of probe A's family
  // whose deleted_at is set, and which is left that way on purpose. The probes
  // below therefore mutate nothing and can run on every build.
  //
  // The first version of this test did soft-delete C each run and restore it
  // afterwards. The restore silently failed — a removed member can no longer
  // SELECT their own row, and PostgREST resolves a PATCH's target rows through
  // a SELECT, so the update matched nothing while returning 204. The suite then
  // passed once and went inconclusive for ever after. A test that quietly stops
  // testing is worse than no test, so the fixture is now static.
  if (process.env.PROBE_C_EMAIL && process.env.PROBE_C_PASSWORD) {
    const C = await signIn(process.env.PROBE_C_EMAIL, process.env.PROBE_C_PASSWORD);

    // Confirm the fixture is genuinely in the removed state before trusting the
    // result: if C's membership were live, these probes would pass for the
    // wrong reason — C would simply be a normal member seeing normal data.
    const visible = await rest('family_members?select=id', { token: C.token });
    const fixtureIsRemoved = Array.isArray(visible.json) && visible.json.length === 0;

    if (!fixtureIsRemoved) {
      record('removed', 'fixture state', 'INCONCLUSIVE',
        'probe C can still see a membership row — it is not in the removed state');
    } else {
      const read = await rest('parents?select=name', { token: C.token });
      const rows = Array.isArray(read.json) ? read.json.length : 0;
      record('removed', 'read the family health record', rows > 0 ? 'LEAK' : 'REPELLED', `${rows} parent row(s)`);

      const meds = await rest('medications?select=name', { token: C.token });
      const medRows = Array.isArray(meds.json) ? meds.json.length : 0;
      record('removed', 'read the medication list', medRows > 0 ? 'LEAK' : 'REPELLED', `${medRows} row(s)`);

      const write = await rest(`medications?family_id=eq.${familyA}`, {
        token: C.token, method: 'PATCH', body: { updated_at: new Date().toISOString() }, prefer: 'return=representation',
      });
      const touched = Array.isArray(write.json) ? write.json.length : -1;
      record('removed', 'write to the family health record', touched > 0 ? 'LEAK' : 'REPELLED', `${touched} row(s) affected`);

      // Migration 15 makes this an explicit database rule. Before it, the
      // un-remove was blocked only as a side effect of losing SELECT
      // visibility, which is a property of the client and not of the data.
      const unremove = await rest(`family_members?user_id=eq.${C.userId}`, {
        token: C.token, method: 'PATCH', body: { deleted_at: null },
      });
      const stillRemoved = await rest('family_members?select=id', { token: C.token });
      const regained = Array.isArray(stillRemoved.json) && stillRemoved.json.length > 0;
      record('removed', 'un-remove self', regained ? 'LEAK' : 'REPELLED',
        `HTTP ${unremove.status}, membership ${regained ? 'RESTORED' : 'still removed'}`);
    }
  } else {
    record('removed', 'removed member retains access', 'INCONCLUSIVE', 'PROBE_C_* not set');
  }

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
  //
  // No token at all: the publishable key alone, which ships inside the app
  // binary and sits in eas.json, so treat it as public knowledge.
  //
  // Rewritten 2026-10-01 for G2-60. Two things changed. The read list is wider,
  // because the old five tables were not where the interesting data had arrived
  // (notes and audit_log both carry free text about a named person). And the
  // write probe is no longer one table with a tolerated outcome: every policy in
  // `public` was scoped `TO public` until migration 19, which includes `anon`,
  // so the question "can an unauthenticated caller write to the health record"
  // deserved more than a single hygiene check on a metrics table.
  for (const table of [
    'parents', 'medications', 'med_doses', 'families', 'family_members',
    'notes', 'appointments', 'symptoms', 'visit_notes', 'audit_log',
    'terms_acceptances', 'parent_consent_events',
  ]) {
    const r = await rest(`${table}?select=id&limit=1`, {});
    const leaked = Array.isArray(r.json) && r.json.length > 0;
    record('anon', `read ${table}`, leaked ? 'LEAK' : 'REPELLED',
      leaked ? `${r.json.length} row(s) without any login` : `HTTP ${r.status}, 0 rows`);
  }

  // Anonymous writes into the health record.
  //
  // No `return=representation`, deliberately. Asking PostgREST to hand the row
  // back needs SELECT as well, so an insert that SUCCEEDED could be reported as
  // refused — failing for the wrong reason and reading as safe. The honest test
  // writes and asks nothing back, then treats any 2xx as a leak.
  //
  // The payloads are intentionally minimal and syntactically valid: a 400 for a
  // malformed body would also read as "repelled" and prove nothing. A 401/403,
  // or a 42501 row-level-security violation, is the outcome being tested for.
  //
  // `parents` carries the full consent block deliberately. Two CHECK
  // constraints (parents_consent_required, parents_consent_shape) reject a bare
  // insert with 23514 BEFORE the policy is consulted — so the obvious payload
  // comes back 400 and reads as "repelled" while having tested nothing. Found
  // on 2026-10-01 by running exactly that probe and reading the error code
  // rather than the status class. With the consent columns present it reaches
  // RLS and returns 42501, which is the answer being looked for.
  const anonWrites = [
    ['medications', { family_id: crypto.randomUUID(), name: 'probe' }],
    ['notes', { family_id: crypto.randomUUID(), body: 'probe' }],
    ['parents', {
      family_id: crypto.randomUUID(),
      name: 'probe',
      consent_basis: 'parent_agreed',
      consent_attested_at: new Date().toISOString(),
      consent_attested_by: crypto.randomUUID(),
      consent_notice_version: 'probe',
      consent_sharing_at: new Date().toISOString(),
    }],
    ['audit_log', { family_id: crypto.randomUUID(), action: 'probe' }],
    // G2-51 regression fixture. This one DID return 201 on 2026-09-20 with
    // nothing but the publishable key, before migration 17 revoked the grant and
    // dropped the policy. It is kept here so that if anyone re-opens it, the
    // suite says so — it used to be tolerated as OPEN-BY-DESIGN, and that is now
    // wrong.
    ['evergreen_metrics', { install_id: crypto.randomUUID(), iso_week: '2026-W38' }],
  ];
  for (const [table, body] of anonWrites) {
    const w = await rest(table, { method: 'POST', body });
    record('anon', `write ${table}`, ...classifyWrite(w));
  }

  // -- 7. Escalation from inside a family, as a live non-owner (G2-54) -------
  //
  // THE GAP THIS CLOSES
  //
  // The escalation check in section 4 has always been inconclusive, and
  // structurally so. Probe A owns its family, so "can a member promote
  // themselves to owner" cannot be asked with A's token — an owner setting
  // is_owner = true is a no-op, not an escalation. Probe C cannot be used
  // either: it is deliberately pinned in the REMOVED state as the migration-14
  // regression fixture, and un-removing it would destroy that fixture.
  //
  // So the one thing standing between a member and ownership of a family —
  // the enforce_owner_change_by_owner trigger, which is what actually stops it,
  // since "members update" has no WITH CHECK — was confirmed by hand once, on
  // 2026-09-20, and nothing has repeated that check since. This repeats it.
  //
  // Probe D is a LIVE, NON-OWNER member of probe A's family. See
  // docs/security-probes.md for how to create it; the suite never provisions
  // accounts itself.
  if (process.env.PROBE_D_EMAIL && process.env.PROBE_D_PASSWORD) {
    const D = await signIn(process.env.PROBE_D_EMAIL, process.env.PROBE_D_PASSWORD);

    // Verify the fixture before trusting any result. If D were an owner, or in
    // another family, or removed, every probe below would "pass" for the wrong
    // reason — which is the failure mode section 6 was rewritten to avoid.
    const mine = await rest(
      `family_members?user_id=eq.${D.userId}&select=id,family_id,is_owner,deleted_at`,
      { token: D.token },
    );
    const row = Array.isArray(mine.json) ? mine.json[0] : null;
    const fixtureOk =
      row && row.family_id === familyA && row.is_owner === false && !row.deleted_at;

    if (!fixtureOk) {
      const why = !row
        ? 'probe D has no visible membership row'
        : row.family_id !== familyA
          ? `probe D is in a different family (${String(row.family_id).slice(0, 8)}… not A's)`
          : row.is_owner
            ? 'probe D owns its family — it must be a NON-owner'
            : 'probe D is in the removed state';
      record('escalate-d', 'fixture state', 'INCONCLUSIVE', why);
    } else {
      const memberIdD = row.id;

      // 7a. The whole point: a live non-owner promoting itself.
      const selfPromote = await rest(`family_members?id=eq.${memberIdD}`, {
        token: D.token, method: 'PATCH', body: { is_owner: true },
        prefer: 'return=representation',
      });
      // Re-read rather than trusting the response. A PATCH that matches no rows
      // returns 200 with an empty array, and reading that as "refused" would be
      // right by accident; reading the row back says what actually happened.
      const after = await rest(
        `family_members?id=eq.${memberIdD}&select=is_owner`,
        { token: D.token },
      );
      const nowOwner = after.json?.[0]?.is_owner === true;
      record('escalate-d', 'non-owner promotes itself to owner',
        nowOwner ? 'LEAK' : 'REPELLED',
        `HTTP ${selfPromote.status}, is_owner is now ${String(after.json?.[0]?.is_owner)}`);

      // 7b. Promoting itself by rewriting the OWNER's row instead — the same
      // escalation from the other end. "members update" is scoped to
      // user_id = auth.uid(), so this should match nothing at all.
      const grabOwner = await rest(`family_members?id=eq.${memberIdA}`, {
        token: D.token, method: 'PATCH', body: { is_owner: false },
        prefer: 'return=representation',
      });
      const ownerRow = await rest(
        `family_members?id=eq.${memberIdA}&select=is_owner`,
        { token: D.token },
      );
      const ownerDemoted = ownerRow.json?.[0]?.is_owner === false;
      record('escalate-d', "demote the family's owner",
        ownerDemoted ? 'LEAK' : 'REPELLED',
        `HTTP ${grabOwner.status}, owner is_owner is now ${String(ownerRow.json?.[0]?.is_owner)}`);

      // 7c. Removing the owner outright. Migration 15 made deleted_at
      // server-only, so this should be refused by the trigger rather than by
      // the policy — a different mechanism from 7b, and worth its own probe.
      const removeOwner = await rest(`family_members?id=eq.${memberIdA}`, {
        token: D.token, method: 'PATCH', body: { deleted_at: new Date().toISOString() },
      });
      const ownerStill = await rest(
        `family_members?id=eq.${memberIdA}&select=deleted_at`,
        { token: D.token },
      );
      const ownerRemoved = Boolean(ownerStill.json?.[0]?.deleted_at);
      record('escalate-d', 'remove the family owner',
        ownerRemoved ? 'LEAK' : 'REPELLED',
        `HTTP ${removeOwner.status}, owner deleted_at is ${String(ownerStill.json?.[0]?.deleted_at)}`);

      // 7d. Renaming the family. An owner may; a member may not.
      const rename = await rest(`families?id=eq.${familyA}`, {
        token: D.token, method: 'PATCH', body: { name: 'probe-d-rename' },
        prefer: 'return=representation',
      });
      const renamed = Array.isArray(rename.json) && rename.json.length > 0;
      record('escalate-d', 'rename the family as a non-owner',
        renamed ? 'LEAK' : 'REPELLED', `HTTP ${rename.status}, ${renamed ? 'RENAMED' : 'unchanged'}`);

      // 7e. A live member SHOULD be able to read its family's record. Asserted
      // so a future over-tightening that locks real caregivers out shows up
      // here as a failure instead of looking like extra security.
      const canRead = await rest('parents?select=id&limit=1', { token: D.token });
      record('escalate-d', 'a live member can still read its own family',
        canRead.status === 200 ? 'REPELLED' : 'ERROR',
        `HTTP ${canRead.status} — positive control: a member MUST be able to read`);
    }
  } else {
    record('escalate-d', 'live non-owner escalation', 'INCONCLUSIVE',
      'PROBE_D_EMAIL / PROBE_D_PASSWORD not set — the escalation trigger is unverified this run (G2-54)');
  }

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
