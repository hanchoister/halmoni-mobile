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

console.log(failures === 0 ? '\nPASS: all logic checks' : `\nFAIL: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
