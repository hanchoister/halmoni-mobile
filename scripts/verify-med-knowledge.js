/**
 * Keep unreviewed clinical content out of med-knowledge.json (G2-34, G1-23).
 *
 * WHAT THIS FILE IS NOW
 *
 * Twenty everyday phrases — "after yard work", "from the heat" — that
 * detective.ts uses to avoid implying a medication link the person has already
 * explained themselves. Plain English, not medical claims.
 *
 * WHAT IT USED TO BE, AND WHY THAT MATTERS HERE
 *
 * It carried common/urgent side-effect lists for 79 medications and 53 name
 * synonyms. The G1-23 reframing on 2026-09-13 deliberately stopped the app
 * judging symptoms — "no side-effect matching, no urgency, no reassurance" —
 * which left all of it unread by any code while still shipping inside the app
 * binary. Unreviewed clinical content, written by an AI in one commit, with
 * nothing surfacing it. Deleted 2026-10-01.
 *
 * WHY A CHECK RATHER THAN A COMMENT
 *
 * The decision that made that data dead was a product decision, and product
 * decisions get forgotten or quietly reversed — this one already survived three
 * weeks as 25KB of dormant clinical claims because nobody noticed it had been
 * orphaned. A comment would not have caught that. This fails the build instead.
 *
 * It is not a ban on rebuilding the feature. It is a requirement that rebuilding
 * it be a deliberate act: whoever does it has to delete this check and say why,
 * which means confronting the two things that make it a real piece of work —
 * a clinician reviewing the symptom lists, and per-entry provenance tying them
 * to FDA labelling (Apple 1.4.1; FDA enforcement discretion under the 2022
 * mobile medical applications policy, Appendix B Example 18, which turns on the
 * information coming from approved labeling). Re-importing the old lists from
 * git would satisfy neither.
 */

const assert = require('node:assert');
const { readFileSync } = require('node:fs');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

const doc = JSON.parse(readFileSync('src/lib/med-knowledge.json', 'utf8'));

console.log('med-knowledge.json\n');

// An allow-list, not a deny-list. A deny-list would need to predict what the
// next well-meaning addition is called — `sideEffects`, `redFlags`, `warnings` —
// and would miss it. Anything new has to be added here on purpose.
const ALLOWED_KEYS = new Set(['$comment', 'environmentalContexts']);

check('the file holds nothing but the keys the app actually reads', () => {
  const unexpected = Object.keys(doc).filter((k) => !ALLOWED_KEYS.has(k));
  assert.deepStrictEqual(
    unexpected,
    [],
    `unexpected key(s): ${unexpected.join(', ')}. If this is a deliberate ` +
      'rebuild of the side-effect feature, read this script\'s header first — ' +
      'it needs a clinical review and per-entry provenance, not a re-import.',
  );
});

check('environmentalContexts is a non-empty list of plain phrases', () => {
  assert.ok(Array.isArray(doc.environmentalContexts), 'not an array');
  assert.ok(doc.environmentalContexts.length > 0, 'empty');
  const bad = doc.environmentalContexts.filter((p) => typeof p !== 'string' || !p.trim());
  assert.deepStrictEqual(bad, [], `not usable phrases: ${JSON.stringify(bad)}`);
});

// detective.ts matches these against free text a caregiver typed, so an entry
// with capitals or padding silently never matches — a dead phrase that looks fine.
check('every phrase is lowercase and trimmed, so it can actually match', () => {
  const bad = doc.environmentalContexts.filter((p) => p !== p.toLowerCase().trim());
  assert.deepStrictEqual(bad, [], `would never match: ${JSON.stringify(bad)}`);
});

// G1-23 again, from the other direction: these phrases end up near symptom text
// in the UI, and an imperative here would put the app back to instructing.
check('no phrase is phrased as an instruction', () => {
  const directive = /^(call|go to|take|stop|start|give|visit|dial|see)\b/i;
  const bad = doc.environmentalContexts.filter((p) => directive.test(p));
  assert.deepStrictEqual(bad, [], `directives: ${JSON.stringify(bad)}`);
});

check('the header records why the medication data was removed', () => {
  assert.match(doc.$comment, /G1-23/, 'header does not cite the decision that orphaned it');
  assert.match(doc.$comment, /clinical review/, 'header does not say what a rebuild would need');
});

console.log(
  failures === 0
    ? '\nPASS: no unreviewed clinical content, and the phrases can match'
    : `\nFAIL: ${failures} check(s)`,
);
process.exit(failures === 0 ? 0 : 1);
