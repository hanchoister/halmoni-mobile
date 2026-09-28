#!/usr/bin/env node
/**
 * The timezone database we ship must agree with a known-good one (G2-27).
 *
 * src/lib/intl-timezones.ts replaces Intl.DateTimeFormat with the FormatJS
 * polyfill and the full IANA dataset, so that dose times stop depending on
 * whatever zone data the phone happens to have. That removes a dependency on
 * the platform — and replaces it with a dependency on a file in node_modules,
 * which is only an improvement if the file is right.
 *
 * So this compares the bundled data against Node's own ICU, which is the
 * best independent reference available offline. Every case is a real boundary
 * rather than a round number:
 *
 *   - summer and winter, to catch a fixed offset masquerading as a zone
 *   - both US DST transitions, in both directions
 *   - the hour that does not exist (spring forward) and the one that happens
 *     twice (fall back)
 *   - America/Indiana/Indianapolis, which is the entire reason we ship
 *     `add-all-tz` rather than the 500KB-smaller `add-golden-tz` that omits it
 *   - America/Phoenix, which does not observe DST at all
 *
 * Runs in `npm run verify`: offline, no credentials, no network.
 *
 * A caveat this check cannot escape, and which is why the diagnostics TIME
 * card and the Sentry tag still exist: it proves the DATA is correct, in Node.
 * It cannot prove the polyfill installs correctly under Hermes on a real
 * phone. Only the device pass (G2-56) answers that.
 */

const assert = require('node:assert');

const ZONE = 'America/New_York';

function formatter(tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// [utc instant, what it is]
const CASES = [
  [Date.UTC(2026, 5, 16, 12, 0), 'summer, 08:00 EDT'],
  [Date.UTC(2026, 0, 16, 13, 0), 'winter, 08:00 EST'],
  [Date.UTC(2026, 2, 7, 13, 0), 'day before spring-forward'],
  [Date.UTC(2026, 2, 8, 7, 30), 'inside the hour that does not exist'],
  [Date.UTC(2026, 2, 9, 12, 0), 'day after spring-forward'],
  [Date.UTC(2026, 10, 1, 5, 30), 'the hour that happens twice'],
];

const OTHER_ZONES = [
  ['America/Indiana/Indianapolis', 'omitted by add-golden-tz — the reason for add-all-tz'],
  ['America/Phoenix', 'does not observe DST'],
  ['America/Anchorage', 'Alaska'],
  ['Pacific/Honolulu', 'Hawaii, no DST'],
  ['America/Los_Angeles', 'Pacific'],
  ['America/Chicago', 'Central'],
  ['America/Denver', 'Mountain'],
];

// Read the reference BEFORE the polyfill replaces the implementation.
const reference = CASES.map(([ts]) => formatter(ZONE).format(new Date(ts)));
const referenceOther = OTHER_ZONES.map(([tz]) => {
  try {
    return formatter(tz).format(new Date(CASES[0][0]));
  } catch {
    return null; // this Node lacks the zone; nothing to compare against
  }
});

require('@formatjs/intl-datetimeformat/polyfill-force.js');
require('@formatjs/intl-datetimeformat/locale-data/en.js');
require('@formatjs/intl-datetimeformat/add-all-tz.js');

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

console.log('bundled timezone data vs the platform (G2-27)');

check('the polyfill actually replaced the implementation', () => {
  assert.ok(
    '__setDefaultTimeZone' in Intl.DateTimeFormat,
    'Intl.DateTimeFormat is still the built-in one — the polyfill did not take',
  );
});

CASES.forEach(([ts, what], i) => {
  check(`${what} matches the platform`, () => {
    assert.strictEqual(formatter(ZONE).format(new Date(ts)), reference[i]);
  });
});

OTHER_ZONES.forEach(([tz, why], i) => {
  check(`${tz} resolves (${why})`, () => {
    const got = formatter(tz).format(new Date(CASES[0][0]));
    assert.ok(got && got.length > 0, 'produced nothing');
    if (referenceOther[i]) assert.strictEqual(got, referenceOther[i]);
  });
});

check('an unknown zone still throws rather than silently returning UTC', () => {
  assert.throws(() => formatter('Not/AZone').format(new Date(0)));
});

console.log(
  failures === 0
    ? '\nPASS: the bundled timezone data agrees with the platform'
    : `\nFAIL: ${failures} check(s)`,
);
process.exit(failures === 0 ? 0 : 1);
