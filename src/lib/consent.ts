/**
 * Parent consent — the one screen that answers Washington, Apple and California
 * at once (G1-28).
 *
 * This module is deliberately pure: no React, no react-native, no expo. It is
 * compiled on its own by `npm run verify:logic` and required from a plain node
 * script in CI, the same way validate-dob.ts is, so the rules here are checked
 * by a machine on every push rather than by whoever last read the screen.
 *
 * The database enforces the same rules independently (see
 * supabase/migrations/00000000000008_parent_consent.sql). That duplication is
 * on purpose — a client-side check protects the user experience, a server-side
 * check protects the parent — but it means the two lists of allowed bases must
 * not drift. scripts/verify-consent.js fails the build if they do.
 */

/** Why this family may hold this person's health data. */
export type ConsentBasis =
  | 'parent_agreed'
  | 'healthcare_proxy'
  | 'power_of_attorney'
  | 'guardianship';

/** Order matters: this is the order the options appear on the screen. */
export const CONSENT_BASES: ConsentBasis[] = [
  'parent_agreed',
  'healthcare_proxy',
  'power_of_attorney',
  'guardianship',
];

/**
 * The wording shown at the moment of attestation, and the wording that goes on
 * the parent's printed notice.
 *
 * `attestation` is written in the first person because that is what the user is
 * signing: not a checkbox agreeing to a policy, a statement about a fact.
 */
export const CONSENT_BASIS_COPY: Record<
  ConsentBasis,
  { label: string; attestation: string; noticeLine: string }
> = {
  parent_agreed: {
    label: 'They know, and they agreed',
    attestation:
      'I have told them Halmoni holds their health information, and they agreed to it.',
    noticeLine: 'They told us you agreed to this.',
  },
  healthcare_proxy: {
    label: "I'm their healthcare proxy",
    attestation:
      'I am the healthcare proxy or healthcare agent named in their advance directive.',
    noticeLine: 'They are acting as your named healthcare proxy.',
  },
  power_of_attorney: {
    label: 'I hold power of attorney',
    attestation:
      'I hold a power of attorney covering their health or personal decisions.',
    noticeLine: 'They are acting under a power of attorney you granted.',
  },
  guardianship: {
    label: "I'm their legal guardian",
    attestation:
      'I am their court-appointed guardian or conservator.',
    noticeLine: 'They are acting as your court-appointed guardian.',
  },
};

/**
 * Bump this whenever the wording above or the notice text below changes, and
 * leave the old entry in NOTICE_ARCHIVE. What a user agreed to is only
 * meaningful if you can still produce the exact words they were shown, and the
 * version stored on the row is the pointer back to them.
 */
export const CONSENT_NOTICE_VERSION = '2026-09-10';

/**
 * Every version of the notice, kept forever. Never edit an entry in place —
 * add a new version. verify-consent.js checks that CONSENT_NOTICE_VERSION has
 * an entry here.
 */
export const NOTICE_ARCHIVE: Record<
  string,
  { heading: string; paragraphs: string[] }
> = {
  '2026-09-10': {
    heading: 'Someone is keeping track of your care in an app called Halmoni',
    paragraphs: [
      'Halmoni is a private app your family uses to keep your medications, appointments and health notes in one place, so the people helping you are not working from memory or from four different text threads.',
      'What it holds: your name and date of birth, the medications you take and when they are due, your allergies and conditions, your appointments and what was said at them, your pharmacy, doctor and insurance details, and the people to call in an emergency.',
      'Who can see it: only the family members who have been invited into your care circle. Halmoni does not sell this information, does not advertise against it, and does not share it with anyone outside your family unless you ask us to.',
      'You can change your mind at any time. Tell any family member listed below to delete your record, and everything above is removed from the app — on their phones as well as on our servers.',
      'Questions, or want your information removed directly? Email privacy@halmoni.app.',
    ],
  },
};

/** The four columns stored on the parent row. */
export type ParentConsent = {
  consent_basis: ConsentBasis;
  consent_attested_at: string;
  consent_attested_by: string;
  consent_notice_version: string;
};

/** What a stored parent row looks like to the checks below. */
type MaybeConsent = {
  consent_basis?: string | null;
  consent_attested_at?: string | null;
  consent_attested_by?: string | null;
  consent_notice_version?: string | null;
  deleted_at?: string | null;
};

export function isConsentBasis(v: unknown): v is ConsentBasis {
  return typeof v === 'string' && (CONSENT_BASES as string[]).includes(v);
}

/** Build the four columns for a new attestation. */
export function buildConsent(
  basis: ConsentBasis,
  attestedByUserId: string,
  now: Date = new Date(),
): ParentConsent {
  if (!isConsentBasis(basis)) {
    throw new Error(`Unknown consent basis: ${String(basis)}`);
  }
  if (!attestedByUserId) {
    throw new Error('An attestation must name who made it.');
  }
  return {
    consent_basis: basis,
    consent_attested_at: now.toISOString(),
    consent_attested_by: attestedByUserId,
    consent_notice_version: CONSENT_NOTICE_VERSION,
  };
}

/**
 * The gate the write path calls before any `parents` row reaches the mirror.
 * Returns an error message, or null when the row may be written.
 *
 * Tombstones are exempt for the same reason the database constraint exempts
 * them: deleting an unattested record left over from before this existed is the
 * correct outcome, and a check that blocked it would trap the data in the app.
 */
export function validateConsent(row: MaybeConsent): string | null {
  if (row.deleted_at) return null;

  if (!row.consent_basis) {
    return 'A parent record cannot be saved without recording why this family may hold their health data.';
  }
  if (!isConsentBasis(row.consent_basis)) {
    return `Unknown consent basis: ${String(row.consent_basis)}`;
  }
  if (!row.consent_attested_at) return 'An attestation must carry the time it was made.';
  if (!row.consent_attested_by) return 'An attestation must name who made it.';
  if (!row.consent_notice_version) {
    return 'An attestation must record which version of the notice was shown.';
  }

  const at = Date.parse(row.consent_attested_at);
  if (Number.isNaN(at)) return 'consent_attested_at is not a usable timestamp.';
  // Matches the database trigger, which allows a day of clock skew and no more.
  if (at > Date.now() + 24 * 60 * 60 * 1000) {
    return 'consent_attested_at cannot be in the future.';
  }
  return null;
}

/** One line for the profile screen: what was attested, and when. */
export function describeConsent(row: MaybeConsent): string | null {
  if (!isConsentBasis(row.consent_basis) || !row.consent_attested_at) return null;
  const when = new Date(row.consent_attested_at);
  const date = Number.isNaN(when.getTime())
    ? ''
    : when.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
  return `${CONSENT_BASIS_COPY[row.consent_basis].attestation}${date ? ` Recorded ${date}.` : ''}`;
}
