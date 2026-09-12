/**
 * Parent consent — the one screen that answers Washington, Apple and California
 * at once (G1-28), rewritten 2026-09-11 after a legal review (G1-32).
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
 *
 * What the 09-11 review changed, and why:
 *
 *   1. Holding and sharing are now two separate recorded answers. Washington
 *      requires consent to share to be "separate and distinct" from consent to
 *      collect (RCW 19.373.030), and showing a parent's medications to their
 *      other children is sharing: the Act's exclusion for a recipient with a
 *      direct relationship runs to a service *the consumer* asked for, and the
 *      consumer here is the parent, who asked for nothing.
 *   2. A fifth basis, no_formal_authority, for the case this product exists
 *      for: the parent can no longer decide, and nobody holds paperwork. The
 *      four-option version forced those families to claim something untrue.
 *      A flow that manufactures false attestations is worse than no
 *      attestation, because it also devalues every true one. It is recorded as
 *      its own value so it can be counted, reported and revisited rather than
 *      hidden inside "they agreed".
 *   3. The authority wording was wrong in three places. In New York a power of
 *      attorney cannot carry health care decisions — that is what a health care
 *      proxy is for — so the old POA option invited a false answer from every
 *      NY user. A proxy's authority normally begins only once the person can no
 *      longer decide. And "conservator" on its own sweeps in a conservator of
 *      the estate, who has money authority and no health authority.
 */

/** Why this family may hold this person's health data. */
export type ConsentBasis =
  | 'parent_agreed'
  | 'healthcare_proxy'
  | 'power_of_attorney'
  | 'guardianship'
  | 'no_formal_authority';

/** Order matters: this is the order the options appear on the screen. */
export const CONSENT_BASES: ConsentBasis[] = [
  'parent_agreed',
  'healthcare_proxy',
  'power_of_attorney',
  'guardianship',
  'no_formal_authority',
];

/**
 * Bases that rest on the parent's own decision or on documented authority.
 * no_formal_authority is deliberately not one of them: it records care given in
 * someone's best interest, which is an honest answer to the question but not
 * the same kind of answer, and the difference should stay visible in the data.
 */
export const AUTHORISED_BASES: ConsentBasis[] = [
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
 * `sharing` is the second statement, about other people seeing it.
 */
export const CONSENT_BASIS_COPY: Record<
  ConsentBasis,
  { label: string; attestation: string; sharing: string; noticeLine: string }
> = {
  parent_agreed: {
    label: 'They know, and they agreed',
    attestation:
      'I have shown or read them the notice below, and they agreed to Halmoni holding their health information.',
    sharing:
      'They also agreed that everyone invited into this care circle can see it.',
    noticeLine: 'They told us you agreed to this.',
  },
  healthcare_proxy: {
    label: "I'm their health care agent, and it is in effect",
    attestation:
      'I am the health care agent or proxy named in their advance directive, and it has taken effect because they can no longer make these decisions themselves.',
    sharing:
      'As their health care agent, I am deciding that everyone invited into this care circle can see it.',
    noticeLine: 'They are acting as your named health care agent.',
  },
  power_of_attorney: {
    label: 'I hold a power of attorney that covers health information',
    attestation:
      'I hold a power of attorney that covers their health care or their health information. (In New York, health care decisions need a health care proxy instead — choose that option above.)',
    sharing:
      'Under that authority, I am deciding that everyone invited into this care circle can see it.',
    noticeLine: 'They are acting under a power of attorney you granted.',
  },
  guardianship: {
    label: "I'm their court-appointed guardian of the person",
    attestation:
      'I am their court-appointed guardian or conservator of the person, with authority over their care. (A conservator only of their money or property is not this.)',
    sharing:
      'Under that authority, I am deciding that everyone invited into this care circle can see it.',
    noticeLine: 'They are acting as your court-appointed guardian.',
  },
  no_formal_authority: {
    label: 'They cannot decide any more, and I have no paperwork',
    attestation:
      'They can no longer make this decision themselves, nobody holds a proxy, power of attorney or guardianship, and I am the family member managing their care in what I believe to be their best interest.',
    sharing:
      'On the same basis, I am deciding that everyone invited into this care circle can see it.',
    noticeLine: 'They are the family member managing your care.',
  },
};

/**
 * Extra wording for no_formal_authority. Shown as its own acknowledgement so
 * the honest answer is not also the frictionless one, and so the record says
 * what the user was told when they chose it.
 */
export const NO_AUTHORITY_ACKNOWLEDGEMENT =
  'I understand this is not their permission and is not legal authority. I will still give them the notice if they can read it, and I will sort out a proxy, power of attorney or guardianship when I can.';

/**
 * Bump this whenever the wording above or the notice text below changes, and
 * leave the old entry in NOTICE_ARCHIVE. What a user agreed to is only
 * meaningful if you can still produce the exact words they were shown, and the
 * version stored on the row is the pointer back to them.
 */
export const CONSENT_NOTICE_VERSION = '2026-09-11';

/**
 * Every version of the notice, kept forever. Never edit an entry in place —
 * add a new version. verify-consent.js checks that CONSENT_NOTICE_VERSION has
 * an entry here.
 */
export const NOTICE_ARCHIVE: Record<
  string,
  { heading: string; paragraphs: string[] }
> = {
  // Replaced on 2026-09-11 (G2-39). The 09-10 wording said Halmoni "does not
  // share it with anyone outside your family", which was not true — Supabase,
  // Sentry and Expo all process it — and said deleting removed everything from
  // our servers, which ignored backups. A notice that overstates is an FTC
  // Act §5 problem in its own right, and this one is handed to the person with
  // the most reason to rely on it.
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
  '2026-09-11': {
    heading: 'Someone is keeping track of your care in an app called Halmoni',
    paragraphs: [
      'Halmoni is a private app your family uses to keep your medications, appointments and health notes in one place, so the people helping you are not working from memory or from four different text threads.',
      'What it holds: your name and date of birth, the medications you take and when they are due, your allergies and conditions, your appointments and what was said at them, your pharmacy, doctor and insurance details, the people to call in an emergency, and anything your family writes about your care.',
      'Who can see it: the family members who have been invited into your care circle. They can all see everything in it.',
      'Who else touches it: the companies that run the app for us — the database and file storage it lives in, the crash-reporting service that tells us when the app breaks, and the app stores it is delivered through. They may only use it to run the app for us. Halmoni does not sell your information and does not advertise against it.',
      'You can change your mind at any time, and you do not have to give a reason. Tell any family member listed below to delete your record, or email us. It disappears from the app straight away, and from our backup copies within 30 days.',
      'Questions, or want your information removed without going through your family? Email privacy@halmoni.app and we will answer within 45 days. We may need to check with the family member named below that we are talking to the right person.',
    ],
  },
};

/** The columns stored on the parent row. */
export type ParentConsent = {
  consent_basis: ConsentBasis;
  consent_attested_at: string;
  consent_attested_by: string;
  consent_notice_version: string;
  /** Separate and distinct from the line above — see the module comment. */
  consent_sharing_at: string;
};

/** What a stored parent row looks like to the checks below. */
type MaybeConsent = {
  consent_basis?: string | null;
  consent_attested_at?: string | null;
  consent_attested_by?: string | null;
  consent_notice_version?: string | null;
  consent_sharing_at?: string | null;
  deleted_at?: string | null;
};

export function isConsentBasis(v: unknown): v is ConsentBasis {
  return typeof v === 'string' && (CONSENT_BASES as string[]).includes(v);
}

/**
 * Build the columns for a new attestation.
 *
 * sharingAgreed is a required argument rather than an option with a default,
 * so that a future call site cannot quietly skip the second question: the
 * compiler asks it, the same way the screen does.
 */
export function buildConsent(
  basis: ConsentBasis,
  sharingAgreed: boolean,
  attestedByUserId: string,
  now: Date = new Date(),
): ParentConsent {
  if (!isConsentBasis(basis)) {
    throw new Error(`Unknown consent basis: ${String(basis)}`);
  }
  if (!attestedByUserId) {
    throw new Error('An attestation must name who made it.');
  }
  if (!sharingAgreed) {
    throw new Error(
      'Holding their information and showing it to the rest of the circle are two separate answers, and the second one is missing.',
    );
  }
  const at = now.toISOString();
  return {
    consent_basis: basis,
    consent_attested_at: at,
    consent_attested_by: attestedByUserId,
    consent_notice_version: CONSENT_NOTICE_VERSION,
    consent_sharing_at: at,
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
  if (!row.consent_sharing_at) {
    return 'An attestation must record the separate answer about the rest of the care circle seeing it.';
  }

  const at = Date.parse(row.consent_attested_at);
  if (Number.isNaN(at)) return 'consent_attested_at is not a usable timestamp.';
  const shared = Date.parse(row.consent_sharing_at);
  if (Number.isNaN(shared)) return 'consent_sharing_at is not a usable timestamp.';
  // Matches the database trigger, which allows a day of clock skew and no more.
  const skew = 24 * 60 * 60 * 1000;
  if (at > Date.now() + skew) return 'consent_attested_at cannot be in the future.';
  if (shared > Date.now() + skew) return 'consent_sharing_at cannot be in the future.';
  return null;
}

/**
 * How old an attestation is, in days, or null if there isn't one.
 *
 * Nothing acts on this yet. It exists because New York's health privacy act
 * (S9269, passed both houses 2026-06-04, awaiting the governor — G2-40) would
 * expire an authorisation after a year, and the difference between "we can add
 * a reminder" and "we have to redesign" is whether the date was recorded and
 * reachable. It was, and this is the reach.
 */
export function attestationAgeDays(row: MaybeConsent, now: Date = new Date()): number | null {
  if (!row.consent_attested_at) return null;
  const at = Date.parse(row.consent_attested_at);
  if (Number.isNaN(at)) return null;
  return Math.floor((now.getTime() - at) / (24 * 60 * 60 * 1000));
}

/** True when an attestation is older than `maxDays` (default: a year). */
export function isAttestationStale(
  row: MaybeConsent,
  now: Date = new Date(),
  maxDays = 365,
): boolean {
  const age = attestationAgeDays(row, now);
  return age !== null && age > maxDays;
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
