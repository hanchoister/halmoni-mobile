/**
 * What this phone is allowed to interrupt you about.
 *
 * The problem this solves: four siblings sharing a parent's care all got every
 * dose reminder, every refill warning, every hand-off — around the clock,
 * whether or not they were the one looking after Mum that day. A medication
 * app that buzzes people who cannot act on it teaches them to swipe
 * notifications away without reading, which is precisely the habit that makes
 * the one reminder that mattered invisible.
 *
 * Two decisions worth writing down, because both could reasonably have gone
 * the other way.
 *
 * ---------------------------------------------------------------------------
 * 1. Preferences live on the DEVICE, not on the server.
 *
 * `public.notification_preferences` exists on production, keyed by member, with
 * RLS already written. It would have been easy to use. It is the wrong home for
 * this, for now: a notification is a property of a phone, not of a person. If
 * you carry a work phone and a personal phone, "only buzz me on my shifts" may
 * be true on one and not the other, and a server-side preference cannot express
 * that. Storing it locally also keeps this feature out of the sync engine,
 * whose table list is hand-maintained in two places that must agree.
 *
 * The cost is honest: reinstall the app, or get a new phone, and the defaults
 * come back. That is the right trade while the defaults are sensible. When push
 * notifications land (`P-10`) the server has to know who wants what — that is
 * when `notification_preferences` earns its place, and this module is where the
 * two would be reconciled.
 *
 * ---------------------------------------------------------------------------
 * 2. "Only my shifts" still notifies when NOBODY is on duty.
 *
 * The obvious reading of "only tell me during my shifts" is: if someone else is
 * on duty, stay quiet. But a family that has simply forgotten to hand over has
 * nobody on duty — and under the obvious reading, that is the moment every
 * phone goes silent at once. For a blood-pressure tablet that is the worst
 * possible behaviour, and it is a state that happens constantly in real
 * caregiving: people forget the app before they forget the pill.
 *
 * So "only my shifts" means: when I am on duty, or when no one is. Silence is
 * only ever the result of somebody else actively holding the shift.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'halmoni.notification-prefs.v1';

/** When a category is allowed to interrupt. */
export type Cadence =
  /** Every time, regardless of who is on duty. */
  | 'always'
  /** Only while I hold the shift — or while nobody does. See the header. */
  | 'on-duty'
  /** Never. */
  | 'off';

export const CADENCES: Cadence[] = ['always', 'on-duty', 'off'];

export type NotificationPrefs = {
  /** "Donepezil is due now", and the follow-up if it goes unlogged. */
  doses: Cadence;
  /** "Two days of Donepezil left." */
  refills: Cadence;
  /**
   * "Your sister handed over to you." Addressed to one person by name, so a
   * duty filter would be incoherent — it is on or off.
   */
  handoffs: Exclude<Cadence, 'on-duty'>;
};

/**
 * Doses default to every time, deliberately.
 *
 * A quieter default would be friendlier and wrong: someone who has not opened
 * this screen has not told us they are comfortable missing a dose reminder,
 * and the cost of an unwanted buzz is irritation while the cost of a missed one
 * is a missed medication. People who want less can say so; people who needed
 * the reminder cannot un-miss it.
 */
export const DEFAULT_PREFS: NotificationPrefs = {
  doses: 'always',
  refills: 'always',
  handoffs: 'always',
};

export const CADENCE_LABELS: Record<Cadence, string> = {
  always: 'Every time',
  'on-duty': 'Only my shifts',
  off: 'Never',
};

/** What each choice actually does, in the words a caregiver would use. */
export const CADENCE_HELP: Record<Cadence, string> = {
  always: 'You are told whoever is on duty.',
  'on-duty': 'Only while you are on duty — and whenever nobody is, so a reminder is never lost.',
  off: 'Nothing for this, on this phone.',
};

function coerce(value: unknown): NotificationPrefs {
  const raw = (value ?? {}) as Partial<Record<keyof NotificationPrefs, unknown>>;
  const one = (v: unknown, fallback: Cadence): Cadence =>
    CADENCES.includes(v as Cadence) ? (v as Cadence) : fallback;
  return {
    doses: one(raw.doses, DEFAULT_PREFS.doses),
    refills: one(raw.refills, DEFAULT_PREFS.refills),
    // handoffs has no on-duty option; anything unexpected falls back to always.
    handoffs: raw.handoffs === 'off' ? 'off' : 'always',
  };
}

export async function loadPrefs(): Promise<NotificationPrefs> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return coerce(JSON.parse(raw));
  } catch {
    // A corrupt or unreadable preference must never mean "no reminders".
    return { ...DEFAULT_PREFS };
  }
}

export async function savePrefs(prefs: NotificationPrefs): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

/**
 * Whether a category may interrupt, given who holds the shift right now.
 *
 * `onDutyMemberId` is null when nobody holds it — which, per the header, is
 * treated as "you are on" rather than as silence.
 */
export function shouldNotify(
  cadence: Cadence,
  myMemberId: string | null,
  onDutyMemberId: string | null,
): boolean {
  if (cadence === 'off') return false;
  if (cadence === 'always') return true;
  if (!onDutyMemberId) return true; // nobody on duty: everyone is told
  return Boolean(myMemberId) && onDutyMemberId === myMemberId;
}
