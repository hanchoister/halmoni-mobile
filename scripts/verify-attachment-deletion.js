/**
 * If the app starts storing attachment files, it must also delete them (G2-70).
 *
 * THE GAP THIS GUARDS
 *
 * Migration 20 blanks a deleted record's content in the database. It cannot
 * touch FILES in the `attachments` storage bucket — a Postgres trigger has no
 * reach into object storage. Today that is harmless: 0 files in the bucket, 0
 * rows in public.attachments, and no attachment code in the app at all
 * (attachments are Track P, not built).
 *
 * But the privacy policy now promises in plain words that deleting a record
 * erases everything attached to it, and a reader would reasonably include a
 * photo of a prescription label in that. The moment someone builds uploads, the
 * promise quietly becomes false again — in a commit about building a feature,
 * where nobody is thinking about deletion.
 *
 * WHY A CHECK AND NOT JUST THE PLAN ITEM
 *
 * G2-70 exists. Plan items here have a record: G2-34 sat for three weeks as 25KB
 * of orphaned clinical data, and the schema counts were stale for a fortnight.
 * A check fires at the moment the gap opens, at the hands of whoever opens it.
 *
 * FIRST VERSION OF THIS FILE WAS BROKEN, WHICH IS WORTH RECORDING
 *
 * It searched for `.remove(` anywhere in src, and "passed" because it found
 * three `sub.remove()` event-unsubscribe calls in unrelated files. It reported
 * a storage deletion path that did not exist. Caught only by deliberately
 * planting an upload and checking the check failed — which it did not.
 *
 * So the matching is now anchored to the bucket: a `.remove(` only counts when
 * it is called on a `from('attachments')` expression. Same lesson as G0-11 and
 * the attack suite's missing positive control — a check that cannot fail is not
 * a check, and the only way to know is to make it fail on purpose.
 */

const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');

const BUCKET = /from\(\s*['"`]attachments['"`]\s*\)/;
// Bounded window so a `.remove(` elsewhere in a large file cannot be credited to
// the bucket, while still allowing the fluent call to be wrapped over lines.
const BUCKET_REMOVE = /from\(\s*['"`]attachments['"`]\s*\)[\s\S]{0,200}?\.\s*remove\s*\(/;
const BUCKET_WRITE =
  /from\(\s*['"`]attachments['"`]\s*\)[\s\S]{0,200}?\.\s*(upload|insert|upsert|copy|move|createSignedUploadUrl)\s*\(/;

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name) && p !== 'src/lib/db/schema.ts') out.push(p);
  }
  return out;
}

const files = sourceFiles('src');
const writers = [];
const deleters = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  if (!BUCKET.test(text)) continue;
  if (BUCKET_WRITE.test(text)) writers.push(f);
  if (BUCKET_REMOVE.test(text)) deleters.push(f);
}

console.log('G2-70 — attachment files must be deletable\n');

let failures = 0;

if (writers.length === 0) {
  console.log('  ok    nothing writes to the attachments bucket yet, so no file can be orphaned');
  console.log(`        (scanned ${files.length} source files; 0 files in the bucket as of 2026-10-04)`);
} else {
  console.log(`  note  the attachments bucket is written from: ${writers.join(', ')}`);
  if (deleters.length === 0) {
    failures += 1;
    console.log(
      '  FAIL  the app can store attachment files but nothing deletes them from the bucket.\n' +
        '        The privacy policy says deleting a record erases everything attached to it, and\n' +
        '        migration 20 only blanks database rows — it cannot reach object storage, so a\n' +
        '        tombstone on public.attachments is not enough: the file outlives the row.\n' +
        '        Add it in this same change — .remove([paths]) on the attachments bucket, wherever\n' +
        '        a record is deleted. See G2-70 and docs/erasure-limits.md.\n' +
        '        If deletion is genuinely handled another way (an edge function, say), update this\n' +
        '        check to look for that instead of deleting it.',
    );
  } else {
    console.log(`  ok    the bucket is also deleted from: ${deleters.join(', ')}`);
    console.log('  note  this cannot tell record-deletion from a "remove this file" button —');
    console.log('        confirm by hand that it runs when a RECORD is deleted.');
  }
}

console.log(
  failures === 0
    ? '\nPASS: no attachment file can outlive the record it belongs to'
    : `\nFAIL: ${failures} problem(s)`,
);
process.exit(failures === 0 ? 0 : 1);
