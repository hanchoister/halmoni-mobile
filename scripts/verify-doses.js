#!/usr/bin/env node
/**
 * Dose horizon check: is anything still keeping the "dose due" promise? (G2-23, G2-25)
 *
 * The planner itself is tested by verify-logic.js. This checks the wiring —
 * which is where the original bug lived. Nothing was wrong with the dose rows
 * that were written; the problem was that the only code that ever wrote one ran
 * at creation, so on day 91 the medication silently left the Today screen.
 *
 * A planner nobody calls is exactly the same bug with more tests.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const failures = [];
const fail = (m) => failures.push(m);

const files = {
  plan: 'src/lib/dose-plan.ts',
  maintenance: 'src/lib/dose-maintenance.ts',
  create: 'src/app/medication/new.tsx',
  edit: 'src/app/medication/edit/[id].tsx',
  sync: 'src/lib/sync/state.tsx',
};
for (const [k, p] of Object.entries(files)) {
  if (!fs.existsSync(path.join(ROOT, p))) fail(`${p} is gone (${k})`);
}
if (failures.length) {
  console.log('FAIL');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}

const sync = read(files.sync);
if (!/topUpDoseHorizon/.test(sync)) {
  fail('nothing in the sync provider tops the dose horizon up — the day-91 cliff is back');
}

const edit = read(files.edit);
if (!/rescheduleDoses/.test(edit)) {
  fail('the medication edit screen no longer re-plans doses — a changed dose time would do nothing');
}
// The screen used to tell the user to delete the medication and re-add it,
// which threw away the adherence history.
if (/delete and re-?add/i.test(edit)) {
  fail('the edit screen still tells the user to delete and re-add the medication');
}

const create = read(files.create);
if (!/planTopUp/.test(create)) {
  fail('the add-medication screen builds dose rows by hand again instead of using the planner');
}

// The original shape of the bug: a hardcoded loop over a fixed number of days,
// run once, at creation.
for (const [k, p] of Object.entries(files)) {
  if (k === 'plan') continue;
  const text = read(p);
  const m = /for\s*\([^)]*dayOffset[^)]*<\s*\d+/.exec(text);
  if (m) fail(`${p} has a hand-rolled fixed-length dose loop again: ${m[0].trim()}`);
}

// Both write paths must clear deleted_at. Dose ids are derived from the
// medication and the instant, so a time removed and later restored would
// otherwise upsert straight onto its own tombstone and never appear.
for (const p of [files.create, files.maintenance]) {
  if (!/deleted_at:\s*null/.test(read(p))) {
    fail(`${p} writes dose rows without clearing deleted_at — a restored dose time would stay invisible`);
  }
}

console.log('checked the dose horizon wiring: creation, schedule edits, and the unattended top-up');
if (failures.length) {
  console.log('\nFAIL');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('PASS: doses are planned in one place and refreshed after creation');
