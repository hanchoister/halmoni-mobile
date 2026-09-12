/**
 * The agreement between Halmoni and the person using it — G1-33.
 *
 * Separate from consent.ts on purpose, because they are two different things
 * that a single "I agree" button would blur together:
 *
 *   terms.ts    the user, agreeing for themselves, to our terms.
 *   consent.ts  the user, stating something about their PARENT, who never
 *               installs the app and cannot agree to our terms at all.
 *
 * Washington's My Health My Data Act settles the question of whether one
 * button could do both: consent to collect health data cannot be obtained
 * through "acceptance of a general or broad terms of use agreement or a
 * similar document that contains descriptions of personal data processing
 * along with other unrelated information" (RCW 19.373.010). So the terms box
 * below is deliberately narrow — it is the contract, and nothing else.
 *
 * Two deliberate wording choices:
 *
 *   1. The user AGREES to the terms and has READ the privacy policy. A privacy
 *      policy you "agree" to becomes a contract term, which turns any future
 *      deviation into a breach-of-contract claim on top of whatever the
 *      regulator thinks. Policies describe; contracts bind.
 *   2. The version of each document is recorded with the acceptance. An
 *      agreement nobody can produce the text of is barely an agreement, and
 *      the enforceability cases turn on exactly that evidence.
 *
 * Pure by design: no react, no supabase. Compiled standalone by
 * `npm run verify:logic` and exercised from a plain node script in CI.
 * The database write lives in terms-record.ts.
 */

/**
 * Bump when the text of that document changes in a way a reasonable person
 * would want to know about. A new version means everyone accepts again — the
 * whole point of storing which one they saw.
 */
export const TERMS_VERSION = '2026-09-11';
export const PRIVACY_VERSION = '2026-09-11';

/**
 * Where the documents live. These must resolve before this ships: a checkbox
 * pointing at a 404, or at a policy describing only the website, is a fresh
 * false statement rather than a fix for the missing one (G2-01, G1-29).
 */
// No .html: the landing site sets cleanUrls, so /terms.html 308s to /terms.
//
// Terms points at the existing page, which already covers the app by name and
// carries 18+, the not-medical-advice wording, liability and governing law. A
// second app-only Terms would be two contracts for one product, and the
// question of which one governs would never come up until it mattered.
// Privacy needs its own page: /privacy describes the website only.
export const TERMS_URL = 'https://halmoni.app/terms';
export const PRIVACY_URL = 'https://halmoni.app/app-privacy';

/** The sentence beside the box. Short enough to read, specific enough to mean something. */
export const ACCEPTANCE_LABEL = 'I agree to the Terms, and I have read the Privacy Policy.';

/** Which document an acceptance row is about. */
export type TermsDocument = 'terms' | 'privacy';
export const TERMS_DOCUMENTS: TermsDocument[] = ['terms', 'privacy'];

export const DOCUMENT_VERSIONS: Record<TermsDocument, string> = {
  terms: TERMS_VERSION,
  privacy: PRIVACY_VERSION,
};

export type TermsAcceptance = {
  user_id: string;
  document: TermsDocument;
  version: string;
  accepted_at: string;
};

/**
 * One row per document rather than one row for both, so that bumping the
 * privacy policy alone does not make it look as though the terms were
 * re-accepted at the same moment. They are separate documents and they change
 * on separate days.
 */
export function buildTermsAcceptances(
  userId: string,
  now: Date = new Date(),
): TermsAcceptance[] {
  if (!userId) throw new Error('An acceptance must record who made it.');
  const accepted_at = now.toISOString();
  return TERMS_DOCUMENTS.map((document) => ({
    user_id: userId,
    document,
    version: DOCUMENT_VERSIONS[document],
    accepted_at,
  }));
}

/** Returns an error message, or null when the row is storable. */
export function validateAcceptance(row: Partial<TermsAcceptance>): string | null {
  if (!row.user_id) return 'An acceptance must record who made it.';
  if (!row.document || !(TERMS_DOCUMENTS as string[]).includes(row.document)) {
    return `Unknown document: ${String(row.document)}`;
  }
  if (!row.version) return 'An acceptance must record which version was shown.';
  if (!row.accepted_at) return 'An acceptance must record when it was made.';
  const at = Date.parse(row.accepted_at);
  if (Number.isNaN(at)) return 'accepted_at is not a usable timestamp.';
  if (at > Date.now() + 24 * 60 * 60 * 1000) return 'accepted_at cannot be in the future.';
  return null;
}

/**
 * True when this person has not accepted the versions currently shipping, and
 * so should be asked again. Absent history counts as not accepted.
 */
export function needsAcceptance(
  existing: Pick<TermsAcceptance, 'document' | 'version'>[],
): boolean {
  return TERMS_DOCUMENTS.some(
    (doc) => !existing.some((row) => row.document === doc && row.version === DOCUMENT_VERSIONS[doc]),
  );
}
