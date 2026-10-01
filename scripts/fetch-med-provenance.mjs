/**
 * Attach per-entry provenance to med-knowledge.json (G2-34).
 *
 * WHY THIS IS A SCRIPT AND NOT A ONE-OFF EDIT
 *
 * The point of provenance is that somebody else can check it. A hand-typed
 * citation list is unverifiable and, worse, forgeable by accident — the whole
 * file arrived in a single commit with a file-level "Sourced from FDA drug
 * labels (DailyMed) and MedlinePlus" and no way to confirm that for any
 * individual entry. So the citations are FETCHED, from two NLM services, by a
 * script that can be re-run to reproduce them.
 *
 * WHAT THE CITATION ATTESTS, AND WHAT IT DOES NOT
 *
 * This is the part that matters for honesty, and the limit is deliberate.
 *
 *   IT DOES attest: this key names a real drug concept in RxNorm, identified by
 *   a stable RXCUI assigned by the National Library of Medicine, and that drug
 *   has current FDA-approved labeling published on DailyMed, counted and dated
 *   at the moment of retrieval.
 *
 *   IT DOES NOT attest: that each individual symptom string in `common` or
 *   `urgent` appears in that label. Establishing that would mean parsing 79 full
 *   SPL documents and fuzzy-matching symptom phrases against adverse-reaction
 *   sections — which is a clinical review, not a script, and claiming it without
 *   doing it would be worse than claiming nothing. The symptom lists remain
 *   curated content pending that review.
 *
 * Apple Guideline 1.4.1 asks apps to "clearly disclose data and methodology to
 * support accuracy claims relating to health measurements." A disclosed, dated,
 * reproducible methodology with a stated boundary is a real answer to that. A
 * fabricated per-symptom citation would not be.
 *
 * Also relevant, and already corrected once in the plan: the Cures Act CDS
 * exclusion does NOT apply here, because 21 U.S.C. 360j(o)(1)(E)(ii)-(iii)
 * require the user to be a health care professional. The theory this file rests
 * on is FDA's enforcement discretion under the 2022 mobile medical applications
 * policy, Appendix B Example 18 — which turns on the information coming from
 * FDA-approved labeling. That is exactly what these citations locate.
 *
 * ONE THING THAT CHANGES THE STAKES
 *
 * These lists are not read by the app. detective.ts is the file's only consumer
 * and takes only `environmentalContexts` — side-effect matching was removed by
 * the G1-23 reframing on 2026-09-13. So the regulatory exposure G2-34 describes
 * is smaller than it reads, because nothing here is shown to a caregiver, and
 * the live question is whether to delete the data rather than how to cite it.
 * Citing it anyway is the cheap insurance: it means the feature cannot be turned
 * back on uncited, which is how the file got into this state.
 *
 * Usage: node scripts/fetch-med-provenance.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'src/lib/med-knowledge.json';
const DRY = process.argv.includes('--dry-run');

const RXNAV = 'https://rxnav.nlm.nih.gov/REST';
const DAILYMED = 'https://dailymed.nlm.nih.gov/dailymed/services/v2';

// Courtesy delay between requests. These are free public NLM services and this
// script hammers them 79 times in a row; there is no reason to do that fast.
const DELAY_MS = 120;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/**
 * Ingredient tokens, for comparing a name against what RxNorm calls a concept.
 *
 * `trimethoprim-sulfamethoxazole` and `sulfamethoxazole / trimethoprim` are the
 * same drug written two ways, so separators are flattened and order ignored.
 * `omeprazole` and `esomeprazole` are NOT the same drug, and must not compare
 * equal — which is why this compares whole tokens rather than substrings.
 */
function tokens(name) {
  return new Set(
    String(name)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

function sameDrug(asked, rxnormName) {
  const a = tokens(asked);
  const b = tokens(rxnormName);
  if (a.size !== b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

/** What RxNorm itself calls this concept id. Used to verify a match. */
async function nameOf(rxcui) {
  const d = await getJson(`${RXNAV}/rxcui/${encodeURIComponent(rxcui)}.json`);
  return d?.idGroup?.name ?? null;
}

/**
 * The RxNorm concept id for a generic ingredient name.
 *
 * EXACT FIRST, AND THE FALLBACK IS VERIFIED.
 *
 * This originally used `search=1` (normalized match) alone, and it silently
 * returned the WRONG DRUG: `omeprazole` resolved to 283742, which RxNorm calls
 * `esomeprazole` — a different medicine with a different label. It was caught
 * only because two entries ended up sharing one concept id.
 *
 * So: try the exact lookup, which distinguishes them correctly (omeprazole is
 * 7646). Only fall back to the normalized search if that finds nothing, and then
 * round-trip the id back to its RxNorm name and refuse it unless the ingredients
 * actually match. A citation pointing at the wrong drug's label is worse than no
 * citation, because it looks like diligence.
 */
async function rxcuiFor(name) {
  const exact = await getJson(`${RXNAV}/rxcui.json?name=${encodeURIComponent(name)}`);
  const exactIds = exact?.idGroup?.rxnormId;
  if (Array.isArray(exactIds) && exactIds.length > 0) {
    return { rxcui: exactIds[0], match: 'exact' };
  }

  await sleep(DELAY_MS);
  const loose = await getJson(`${RXNAV}/rxcui.json?name=${encodeURIComponent(name)}&search=1`);
  const looseIds = loose?.idGroup?.rxnormId;
  if (!Array.isArray(looseIds) || looseIds.length === 0) return null;

  const candidate = looseIds[0];
  await sleep(DELAY_MS);
  const rxnormName = await nameOf(candidate);
  if (!rxnormName || !sameDrug(name, rxnormName)) {
    return { rxcui: null, rejected: `${candidate} is "${rxnormName}", not "${name}"` };
  }
  return { rxcui: candidate, match: `normalized to "${rxnormName}"` };
}

/**
 * Current FDA labels for that concept.
 *
 * Queried by RXCUI rather than by name deliberately. A name query returns
 * whichever repackager's label happens to sort first — citing
 * "ATORVASTATIN [REMEDYREPACK INC.]" would pin an arbitrary private relabeler as
 * the authority for a statin. The RXCUI listing is the set of labels for the
 * concept, which is what the claim is actually about.
 */
async function labelsFor(rxcui) {
  const d = await getJson(`${DAILYMED}/spls.json?rxcui=${encodeURIComponent(rxcui)}&pagesize=1`);
  const total = d?.metadata?.total_elements ?? (d?.data?.length ?? 0);
  const first = (d?.data ?? [])[0] ?? null;
  return {
    labelCount: total,
    mostRecent: first
      ? { setid: first.setid, title: first.title, published: first.published_date }
      : null,
  };
}

const doc = JSON.parse(readFileSync(FILE, 'utf8'));
const meds = doc.medications;
const names = Object.keys(meds);
const retrieved = new Date().toISOString().slice(0, 10);

console.log(`Resolving provenance for ${names.length} medications…\n`);

const failures = [];
let resolved = 0;

for (const name of names) {
  try {
    const lookup = await rxcuiFor(name);
    if (!lookup || !lookup.rxcui) {
      const why = lookup?.rejected
        ? `rejected a wrong-drug match (${lookup.rejected})`
        : 'RxNorm has no concept for this name';
      failures.push(`${name}: ${why}`);
      console.log(`  --   ${name.padEnd(30)} ${why}`);
      await sleep(DELAY_MS);
      continue;
    }
    const rxcui = lookup.rxcui;
    const { labelCount, mostRecent } = await labelsFor(rxcui);
    if (labelCount === 0) {
      failures.push(`${name}: RXCUI ${rxcui} has no DailyMed labels`);
      console.log(`  --   ${name.padEnd(30)} rxcui ${rxcui}, no labels`);
      await sleep(DELAY_MS);
      continue;
    }

    meds[name].provenance = {
      rxcui,
      rxcuiMatch: lookup.match,
      rxnorm: `${RXNAV}/rxcui/${rxcui}/allrelated.json`,
      labelSource: 'DailyMed (FDA Structured Product Labeling)',
      labels: `https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=&rxcui=${rxcui}`,
      labelCount,
      mostRecentLabel: mostRecent,
      retrieved,
      // Restated per entry, not only in the file header, because an entry
      // copied or quoted on its own must carry its own limit with it.
      attests: 'drug identity and the existence of current FDA labeling; NOT that each listed symptom appears in that label',
    };
    resolved += 1;
    console.log(
      `  ok   ${name.padEnd(30)} rxcui ${rxcui} (${lookup.match}), ${labelCount} label(s)`,
    );
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.log(`  ERR  ${name.padEnd(30)} ${err.message}`);
  }
  await sleep(DELAY_MS);
}

doc.$comment =
  'STATUS (verified 2026-10-01): the per-medication `common` and `urgent` lists below are ' +
  'NOT READ BY THE APP. src/lib/detective.ts is the only consumer of this file and reads ' +
  'only `environmentalContexts`; side-effect matching was deliberately removed by the G1-23 ' +
  'reframing on 2026-09-13 ("no side-effect matching, no urgency, no reassurance"). So these ' +
  'lists are currently dead data shipped in the binary, and the app makes no health claim ' +
  'from them. Whether to delete them or keep them for a future feature is an open decision ' +
  '(G2-34). They are cited regardless, so that re-surfacing them cannot happen uncited. ' +
  'Curated common side effects and urgent red flags for geriatric medications. ' +
  'Keys are generic names; aliases hold brand names. ' +
  "Common = 'worth mentioning at next visit'. Urgent = 'needs a doctor's attention today'. " +
  'Keep entries conservative; only add well-established side effects. ' +
  'PROVENANCE (G2-34): every entry carries a `provenance` block generated by ' +
  'scripts/fetch-med-provenance.mjs from two National Library of Medicine services — ' +
  'RxNorm for the drug concept id, and DailyMed for the existence and date of current ' +
  'FDA Structured Product Labeling. Re-run the script to reproduce or refresh it. ' +
  'That citation attests drug identity and the existence of FDA labeling. It does NOT ' +
  'attest that each individual symptom string below appears in that label — ' +
  'establishing that is a clinical review of 79 full label documents, and is not claimed here.';

console.log(`\n${resolved}/${names.length} resolved, ${failures.length} unresolved`);
if (failures.length) {
  console.log('\nUNRESOLVED (left without provenance rather than guessed):');
  for (const f of failures) console.log(`  - ${f}`);
}

// The check that caught the omeprazole/esomeprazole mismatch in the first
// place. Two different drug names resolving to one concept id means a lookup
// went wrong, and it must fail the run rather than be left in the file.
const byRxcui = new Map();
for (const [name, entry] of Object.entries(meds)) {
  const rx = entry.provenance?.rxcui;
  if (!rx) continue;
  byRxcui.set(rx, [...(byRxcui.get(rx) ?? []), name]);
}
const collisions = [...byRxcui.entries()].filter(([, names]) => names.length > 1);
if (collisions.length > 0) {
  console.log('\nFAIL: different medications resolved to the same RxNorm concept:');
  for (const [rx, names] of collisions) console.log(`  rxcui ${rx}: ${names.join(', ')}`);
  console.log('\nNothing written. One of these lookups found the wrong drug.');
  process.exit(1);
}

if (DRY) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
console.log(`\nWrote ${FILE}`);
