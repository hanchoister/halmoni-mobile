#!/usr/bin/env node
/**
 * Pure-logic checks for the rules that failed silently in production.
 *
 * Each case here is a bug that actually shipped, not a hypothetical:
 *  - validateDob accepted "9999-99-99", which quarantined 186 writes
 *  - the demo client's IS NULL matched nothing, so the demo showed empty tabs
 *
 * Dependency-free: modules are compiled with tsc and required directly, so this
 * runs in CI without a test framework.
 */
const assert = require('node:assert');
const path = require('path');

const fs = require('node:fs');
const OUT = path.resolve(process.argv[2] || '.verify-build');

// tsc mirrors the source tree under outDir, so a module's path depends on where
// it lives in src/. Find it rather than hardcoding a layout that changes when a
// file moves.
function findModule(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const hit = findModule(p, name);
      if (hit) return hit;
    } else if (e.name === name) return p;
  }
  return null;
}
const load = (m) => {
  const found = findModule(OUT, m);
  if (!found) throw new Error(`compiled module ${m} not found under ${OUT} — did tsc run?`);
  return require(found);
};

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ok    ' + name);
  } catch (err) {
    failures++;
    console.log('  FAIL  ' + name + '\n        ' + err.message.split('\n')[0]);
  }
}

console.log('validateDob — the bug that quarantined 186 writes');
{
  const { validateDob } = load('validate-dob.js');
  const rejects = ['9999-99-99', '2026-02-31', '2026-13-01', '2026-00-10', '1800-01-01', '3000-01-01', 'yesterday', '14-03-1950'];
  for (const v of rejects) check(`rejects ${JSON.stringify(v)}`, () => assert.ok(validateDob(v), 'should be rejected'));
  const accepts = ['1950-03-14', '2024-02-29', ''];
  for (const v of accepts) check(`accepts ${JSON.stringify(v)}`, () => assert.strictEqual(validateDob(v), null));
  check('future date is rejected', () => {
    const d = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    assert.ok(validateDob(d));
  });
}

console.log('\nsentry scrubbing — health data must not reach a third party');
{
  const { scrubEvent, scrubBreadcrumb } = load('sentry-scrub.js');
  check('error messages are dropped entirely', () => {
    const e = scrubEvent({ message: 'Donepezil for Elena', exception: { values: [{ value: 'Elena Smith' }] } });
    assert.ok(!JSON.stringify(e).includes('Elena'), 'name survived');
    assert.ok(!JSON.stringify(e).includes('Donepezil'), 'medication survived');
  });
  check('console breadcrumbs are dropped', () => {
    assert.strictEqual(scrubBreadcrumb({ category: 'console', message: 'Elena' }), null);
  });
  check('query strings are stripped from http breadcrumbs', () => {
    const b = scrubBreadcrumb({ category: 'fetch', data: { url: 'https://x/rest/v1/parents?name=eq.Elena' } });
    assert.ok(!b.data.url.includes('Elena'), 'PostgREST filter survived');
  });
  check('request, extra and state are removed', () => {
    const e = scrubEvent({ request: { cookie: 'x' }, extra: { parent: 'Elena' }, contexts: { state: { meds: ['Donepezil'] }, device: { model: 'iPhone' } } });
    assert.ok(!e.request && !e.extra && !e.contexts.state, 'a PHI carrier survived');
    assert.ok(e.contexts.device, 'device context should be kept');
  });
  check('user is reduced to an id', () => {
    const e = scrubEvent({ user: { id: 'i', email: 'a@b.c', ip_address: '1.2.3.4' } });
    assert.deepStrictEqual(Object.keys(e.user), ['id']);
  });
}

console.log('\nparent consent — health data about someone who never signed up');
{
  const {
    validateConsent,
    buildConsent,
    isConsentBasis,
    CONSENT_BASES,
    CONSENT_NOTICE_VERSION,
    NOTICE_ARCHIVE,
  } = load('consent.js');

  const good = buildConsent('parent_agreed', 'user-1');
  check('a complete attestation passes', () => {
    assert.strictEqual(validateConsent(good), null);
  });
  check('a parent row with no basis is refused', () => {
    assert.ok(validateConsent({ name: 'Elena' }), 'unattested row was accepted');
  });
  check('a made-up basis is refused', () => {
    assert.ok(validateConsent({ ...good, consent_basis: 'she_probably_would' }));
  });
  for (const field of ['consent_attested_at', 'consent_attested_by', 'consent_notice_version']) {
    check(`a half-filled attestation is refused (${field} missing)`, () => {
      assert.ok(validateConsent({ ...good, [field]: null }), `${field} was allowed to be blank`);
    });
  }
  check('an attestation dated in the future is refused', () => {
    const soon = new Date(Date.now() + 5 * 86400000).toISOString();
    assert.ok(validateConsent({ ...good, consent_attested_at: soon }));
  });
  // Deleting an unattested record left over from before this existed has to
  // stay possible, or the data is trapped in the app forever.
  check('a tombstone is exempt', () => {
    assert.strictEqual(validateConsent({ deleted_at: new Date().toISOString() }), null);
  });
  check('buildConsent refuses an anonymous attestation', () => {
    assert.throws(() => buildConsent('parent_agreed', ''));
  });
  check('every offered basis is a real one', () => {
    for (const b of CONSENT_BASES) assert.ok(isConsentBasis(b), b);
  });
  check('the stored notice version resolves to actual wording', () => {
    assert.ok(NOTICE_ARCHIVE[CONSENT_NOTICE_VERSION], 'no archived text for the current version');
  });
}

console.log('\ndose horizon — the medication that vanished on day 91');
{
  const {
    planTopUp,
    planReschedule,
    daysOfRunway,
    doseId,
    uuidv5,
    DOSE_HORIZON_DAYS,
  } = load('dose-plan.js');

  const MED = 'med-1';
  const now = new Date('2026-06-15T09:30:00.000Z');
  const at = (iso) => ({ id: doseId(MED, iso), scheduled_at: iso });

  // Ids are derived, not random: two phones extending the same horizon before
  // they have seen each other's rows must land on one dose, not two.
  check('dose ids are deterministic', () => {
    assert.strictEqual(doseId(MED, '2026-06-16T12:00:00.000Z'), doseId(MED, '2026-06-16T12:00:00.000Z'));
  });
  check('a different instant is a different dose', () => {
    assert.notStrictEqual(doseId(MED, '2026-06-16T12:00:00.000Z'), doseId(MED, '2026-06-17T12:00:00.000Z'));
  });
  check('a different medication is a different dose', () => {
    assert.notStrictEqual(doseId('med-1', '2026-06-16T12:00:00.000Z'), doseId('med-2', '2026-06-16T12:00:00.000Z'));
  });
  // Vectors from python's uuid.uuid5 — an implementation nobody here wrote.
  check('uuidv5 matches the reference implementation', () => {
    assert.strictEqual(
      uuidv5('example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'),
      'cfbff0d1-9375-5685-968c-48ce8b15ae17',
    );
    assert.strictEqual(
      uuidv5('med-1|2026-09-10T12:00:00.000Z', '6b2f4b2e-9a1e-5c7a-9a3e-2f1c7d4b8e10'),
      'a1a6280d-9385-56e3-ac4f-a1e1ec939628',
    );
    assert.strictEqual(
      uuidv5('메드-1|2026-09-10T12:00:00.000Z', '6b2f4b2e-9a1e-5c7a-9a3e-2f1c7d4b8e10'),
      '96e632ce-56d2-51c0-8765-d884e47f7708',
    );
  });

  const daily = [{ time: '08:00' }];

  check('a brand-new medication gets a full horizon', () => {
    const plan = planTopUp({ medicationId: MED, schedule: daily, existing: [], now });
    assert.ok(plan.create.length >= DOSE_HORIZON_DAYS - 1, `only ${plan.create.length} doses`);
    assert.strictEqual(plan.remove.length, 0);
  });
  check('no dose is ever created in the past', () => {
    const plan = planTopUp({ medicationId: MED, schedule: daily, existing: [], now });
    for (const d of plan.create) assert.ok(Date.parse(d.scheduled_at) > now.getTime(), d.scheduled_at);
  });

  // The bug itself: doses were written once, 90 days out, and never again.
  check('the day-91 cliff is refilled', () => {
    const existing = [];
    for (let i = -100; i < -1; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      d.setHours(8, 0, 0, 0);
      existing.push({ ...at(d.toISOString()), given_at: d.toISOString() });
    }
    assert.strictEqual(daysOfRunway(existing, now), 0, 'a run-out medication should show no runway');
    const plan = planTopUp({ medicationId: MED, schedule: daily, existing, now });
    assert.ok(plan.create.length >= DOSE_HORIZON_DAYS - 1, `refilled only ${plan.create.length}`);
    assert.strictEqual(plan.remove.length, 0, 'history must not be touched');
  });

  check('a topped-up medication is left alone', () => {
    const first = planTopUp({ medicationId: MED, schedule: daily, existing: [], now });
    const second = planTopUp({ medicationId: MED, schedule: daily, existing: first.create, now });
    assert.strictEqual(second.create.length, 0, 'top-up is not idempotent');
  });

  check('the unattended path never removes anything', () => {
    const stale = [at('2026-06-16T12:00:00.000Z'), at('2026-06-17T12:00:00.000Z')];
    const plan = planTopUp({ medicationId: MED, schedule: daily, existing: stale, now });
    assert.strictEqual(plan.remove.length, 0);
  });

  // G2-25: changing a dose time is the most common medication edit there is.
  const before = planTopUp({ medicationId: MED, schedule: daily, existing: [], now }).create;
  check('moving 08:00 to 09:00 rewrites the upcoming doses', () => {
    const plan = planReschedule({
      medicationId: MED,
      schedule: [{ time: '09:00' }],
      existing: before,
      now,
    });
    assert.ok(plan.create.length > 80, `created ${plan.create.length}`);
    assert.ok(plan.remove.length > 80, `removed ${plan.remove.length}`);
    for (const d of plan.create) assert.strictEqual(new Date(d.scheduled_at).getHours(), 9);
  });

  check('a dose already given survives the edit', () => {
    const given = { ...before[0], given_at: '2026-06-16T08:05:00.000Z' };
    const skipped = { ...before[1], skipped: true };
    const plan = planReschedule({
      medicationId: MED,
      schedule: [{ time: '09:00' }],
      existing: [given, skipped, ...before.slice(2)],
      now,
    });
    assert.ok(!plan.remove.includes(given.id), 'a given dose was deleted');
    assert.ok(!plan.remove.includes(skipped.id), 'a skipped dose was deleted');
  });

  check('the past is never rewritten', () => {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const old = { ...at(yesterday.toISOString()), given_at: null };
    const plan = planReschedule({
      medicationId: MED,
      schedule: [{ time: '09:00' }],
      existing: [old, ...before],
      now,
    });
    assert.ok(!plan.remove.includes(old.id), 'a past dose was deleted');
  });

  check('saving without changing the times changes nothing', () => {
    const plan = planReschedule({ medicationId: MED, schedule: daily, existing: before, now });
    assert.strictEqual(plan.create.length, 0, `created ${plan.create.length}`);
    assert.strictEqual(plan.remove.length, 0, `removed ${plan.remove.length}`);
  });

  check('adding a second time only adds', () => {
    const plan = planReschedule({
      medicationId: MED,
      schedule: [{ time: '08:00' }, { time: '20:00' }],
      existing: before,
      now,
    });
    assert.strictEqual(plan.remove.length, 0);
    for (const d of plan.create) assert.strictEqual(new Date(d.scheduled_at).getHours(), 20);
  });

  check('a malformed time never becomes a dose', () => {
    const plan = planTopUp({ medicationId: MED, schedule: [{ time: '8am' }], existing: [], now });
    assert.strictEqual(plan.create.length, 0);
  });

  // Stepping by 24 hours walks an 8am dose to 7am (or 9am) at a DST boundary
  // and leaves it there. Building each calendar day and then applying the
  // wall-clock time does not.
  check('8am stays 8am across daylight saving', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const march = new Date('2026-03-01T12:00:00.000Z'); // DST starts 8 March 2026
      const plan = planTopUp({ medicationId: MED, schedule: daily, existing: [], now: march, horizonDays: 20 });
      const hours = new Set(plan.create.map((d) => new Date(d.scheduled_at).getHours()));
      assert.deepStrictEqual([...hours], [8], `hours seen: ${[...hours].join(',')}`);
    } finally {
      process.env.TZ = tz;
    }
  });
}

console.log(failures === 0 ? '\nPASS: all logic checks' : `\nFAIL: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
