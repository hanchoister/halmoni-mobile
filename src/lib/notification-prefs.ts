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
 * Three decisions worth writing down, because all three could reasonably have
 * gone the other way.
 *
 * ---------------------------------------------------------------------------
 * 1. Preferences live on the DEVICE, not on the server.
 *
 * A notification is a property of a phone, not of a person: carry a work phone
 * and a personal phone and "only buzz me on my shifts" may be true on one and
 * not the other. Keeping it local also stays out of the sync engine, whose
 * table list is hand-maintained in two places that must agree.
 *
 * `public.notification_preferences` does exist on production, but it is left
 * over from the retired web app — booleans for email and push per category —
 * so adopting it would mean a migration, not a reuse. The cost of staying local
 * is stated plainly in the UI: a reinstall resets to defaults. This module is
 * the single place that would change if that trade is ever revisited.
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
 *
 * ---------------------------------------------------------------------------
 * 3. Every timing is a list, not a boolean.
 *
 * "Remind me 30 minutes after" and "remind me an hour before" are the same kind
 * of thing — an offset from a known instant — so they are stored as offsets
 * rather than as named features. Adding "two hours before" later is then a new
 * entry in a list, not a new column, a new toggle and a new branch.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'halmoni.notification-prefs.v2';

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
  doses: Cadence;
  /** Minutes BEFORE a dose to give a heads-up. Empty means only at dose time. */
  doseLeadMinutes: number[];
  /** Minutes AFTER a dose to nudge, if it still has not been logged. */
  doseFollowUpMinutes: number[];

  refills: Cadence;
  /** Days before `refill_by` to warn. */
  refillDays: number[];

  appointments: Cadence;
  /** Minutes before an appointment starts. 1440 = the day before. */
  appointmentLeadMinutes: number[];

  /**
   * "Nobody is on duty." Its own category because the whole point is that it
   * fires when no other notification would — waiting for a dose reminder to
   * reveal that nobody is covering is exactly the failure this prevents.
   */
  unattended: Cadence;

  /**
   * Addressed to one person by name, so a duty filter would be incoherent —
   * someone handing the shift TO you is the moment you are not yet on it.
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
  doseLeadMinutes: [],
  doseFollowUpMinutes: [30],
  refills: 'always',
  refillDays: [7, 2],
  appointments: 'always',
  appointmentLeadMinutes: [1440, 120],
  unattended: 'always',
  handoffs: 'always',
};

/** The offsets offered in the UI. Not a limit on what the model can store. */
export const DOSE_LEAD_CHOICES = [15, 30, 60, 120];
export const DOSE_FOLLOW_UP_CHOICES = [15, 30, 60];
export const REFILL_DAY_CHOICES = [14, 7, 5, 3, 2, 1];
export const APPOINTMENT_LEAD_CHOICES = [2880, 1440, 240, 120, 60, 30];

export const CADENCE_LABELS: Record<Cadence, string> = {
  always: 'Every time',
  'on-duty': 'Only my shifts',
  off: 'Never',
};

export const CADENCE_HELP: Record<Cadence, string> = {
  always: 'You are told whoever is on duty.',
  'on-duty': 'Only while you are on duty — and whenever nobody is, so a reminder is never lost.',
  off: 'Nothing for this, on this phone.',
};

/** "1 hr", "30 min", "2 days" — the way a person would say it. */
export function humanMinutes(mins: number): string {
  if (mins % 1440 === 0) {
    const d = mins / 1440;
    return d === 1 ? '1 day' : `${d} days`;
  }
  if (mins % 60 === 0) {
    const h = mins / 60;
    return h === 1 ? '1 hr' : `${h} hrs`;
  }
  return `${mins} min`;
}

export function humanDays(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

function numberList(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return [...fallback];
  const cleaned = value
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
    .map((n) => Math.round(n));
  // Deduplicated and ordered, so the UI and the scheduler never disagree about
  // what "the same setting" looks like.
  return Array.from(new Set(cleaned)).sort((a, b) => a - b);
}

function coerce(value: unknown): NotificationPrefs {
  const raw = (value ?? {}) as Record<string, unknown>;
  const one = (v: unknown, fallback: Cadence): Cadence =>
    CADENCES.includes(v as Cadence) ? (v as Cadence) : fallback;
  return {
    doses: one(raw.doses, DEFAULT_PREFS.doses),
    doseLeadMinutes: numberList(raw.doseLeadMinutes, DEFAULT_PREFS.doseLeadMinutes),
    doseFollowUpMinutes: numberList(raw.doseFollowUpMinutes, DEFAULT_PREFS.doseFollowUpMinutes),
    refills: one(raw.refills, DEFAULT_PREFS.refills),
    refillDays: numberList(raw.refillDays, DEFAULT_PREFS.refillDays),
    appointments: one(raw.appointments, DEFAULT_PREFS.appointments),
    appointmentLeadMinutes: numberList(
      raw.appointmentLeadMinutes,
      DEFAULT_PREFS.appointmentLeadMinutes,
    ),
    unattended: one(raw.unattended, DEFAULT_PREFS.unattended),
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

/** Add or remove one offset, keeping the list sorted and deduplicated. */
export function toggleOffset(list: number[], value: number): number[] {
  const next = list.includes(value) ? list.filter((n) => n !== value) : [...list, value];
  return next.sort((a, b) => a - b);
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
