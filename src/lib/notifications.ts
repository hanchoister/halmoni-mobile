/**
 * Local notifications (G2-09): dose due, dose unlogged after 30 minutes,
 * refill running low, and a handoff addressed to this person.
 *
 * `expo-notifications` was not installed until this file existed — a
 * medication app whose entire pitch is "dose due" had no way to tell anyone
 * a dose was due.
 *
 * Strategy: cancel everything this app scheduled and reschedule from what is
 * true right now, every time a sync completes. That is simpler and more
 * robust against drift (edited schedules, deleted medications, doses already
 * logged) than surgically adding and removing individual notifications, and
 * it mirrors how the dose horizon itself is a projection recomputed rather
 * than minted once (see dose-plan.ts).
 *
 * iOS caps an app at 64 pending local notifications and silently drops
 * anything past that — there is no error, no event, nothing to catch in a
 * test, the 65th notification simply never fires. "Silent staleness is the
 * worst thing this app can do" (see sync-banner.tsx), so the ceiling is
 * treated as a budget and spent deliberately, in three parts:
 *
 *   1. REPEATING triggers for dose reminders. One per medication slot, daily,
 *      for ever — so four medications taken three times a day cost 12 pending
 *      notifications in total rather than ~36 a day. This is what takes the
 *      ceiling off the table for a realistic family, and the only mechanism
 *      here that keeps reminders arriving when nobody opens the app for weeks.
 *      Each carries the medication's own timezone, or it would quietly undo
 *      G2-27 by firing at the reader's clock.
 *
 *   2. A HORIZON for the one-offs that remain — unlogged nudges, refills,
 *      appointments, uncovered shifts — generated up to NOTIFICATION_WINDOW_DAYS
 *      and then trimmed to whatever budget the repeaters left. The horizon that
 *      results is reported in diagnostics, because "reminders are set for the
 *      next 9 days" is a different conversation from "reminders are set".
 *
 *   3. PRIORITY when it still does not fit. What gets dropped is the least
 *      important AND furthest away, never simply the furthest: a heads-up three
 *      days out must not survive while the dose reminder behind it is binned.
 *
 * Handoff notifications are a different shape — a one-time "this just
 * happened" alert, not a recurring reminder — so they are not part of the
 * cancel-and-reschedule sweep. A small local table (notified_handoffs) is the
 * record of which ones this device has already announced, so a handoff is
 * never announced twice and a fresh install never announces every handoff in
 * the family's history at once.
 */
import * as Sentry from '@sentry/react-native';
import * as Notifications from 'expo-notifications';

import { formatDate, formatDoseTime, formatTime } from '@/lib/format';
import { humanMinutes, loadPrefs, shouldNotify } from '@/lib/notification-prefs';
import { Platform } from 'react-native';

import { getDb } from '@/lib/db/client';
import { list } from '@/lib/db/repository';
import type { Slot } from '@/lib/dose-plan';
import { scheduleZone } from '@/lib/dose-plan';
import { isDemoMode } from '@/lib/demo-mode';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// How far ahead to schedule dose reminders. Short on purpose — see the
// module comment on the 64-pending-notification ceiling.
// How far ahead one-off reminders are generated. Was 3 days, when every dose
// cost a pending notification per day and the ceiling was reached in under
// two. Dose reminders are repeating triggers now, so the one-offs that remain
// — unlogged nudges, refills, appointments, uncovered shifts — are sparse
// enough to look much further ahead. The EFFECTIVE horizon is still decided by
// the budget below, not by this number: this is the maximum, not a promise.
const NOTIFICATION_WINDOW_DAYS = 14;
// Hard ceiling this module will ever ask the OS to hold, leaving headroom
// under Apple's 64 for anything else scheduled elsewhere (there is nothing
// else today, but a ceiling that assumes it owns 100% of the budget forever
// is the kind of assumption that breaks quietly).
const MAX_SCHEDULED = 56;
const UNLOGGED_FOLLOWUP_MINUTES = 30;
// refill_by minus these, at 9am local on that day.
const REFILL_REMINDER_DAYS = [7, 2];
const REFILL_REMINDER_HOUR = 9;

let permissionAsked = false;

/**
 * What the last notification sync actually did, for the diagnostics screen.
 *
 * This exists because G2-09 shipped, compiled, mounted, and then did nothing
 * observable on a real device — no permission prompt, no scheduled reminders,
 * nothing in the logs. The caller does `void syncDoseAndRefillNotifications()`,
 * so any rejection inside was swallowed in silence. For a medication reminder
 * that is the worst possible failure mode: the feature looks present and simply
 * never fires, and nobody finds out until a parent misses a dose.
 *
 * So the module now records what happened and the diagnostics screen shows it.
 * "Did the reminders get set" becomes a thing you can read, rather than a thing
 * you infer from their absence.
 */
export type NotificationHealth = {
  lastRunAt: string | null;
  permission: 'granted' | 'denied' | 'undetermined' | 'unknown';
  canAskAgain: boolean | null;
  scheduled: number | null;
  lastError: string | null;
  skippedReason: string | null;
  /** What this phone is set to, so support can see it without asking. */
  prefs: string | null;
  /** Daily repeating triggers — these cover every day, for ever. */
  repeating: number | null;
  /** How far ahead the one-off reminders actually reach, after the budget. */
  horizonDays: number | null;
  /** One-offs the iOS ceiling forced us to drop, lowest value first. */
  dropped: number | null;
};

let health: NotificationHealth = {
  lastRunAt: null,
  permission: 'unknown',
  canAskAgain: null,
  scheduled: null,
  lastError: null,
  skippedReason: 'has not run yet',
  prefs: null,
  repeating: null,
  horizonDays: null,
  dropped: null,
};

export function getNotificationHealth(): NotificationHealth {
  return { ...health };
}

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  health.permission = current.granted
    ? 'granted'
    : current.canAskAgain
      ? 'undetermined'
      : 'denied';
  health.canAskAgain = current.canAskAgain ?? null;
  if (current.granted) return true;
  if (permissionAsked && !current.canAskAgain) return false;
  permissionAsked = true;
  const req = await Notifications.requestPermissionsAsync();
  health.permission = req.granted ? 'granted' : req.canAskAgain ? 'undetermined' : 'denied';
  health.canAskAgain = req.canAskAgain ?? null;
  return req.granted;
}

type MedRow = {
  id: string;
  parent_id: string;
  name: string;
  schedule?: Slot[] | null;
  refill_by?: string | null;
  deleted_at?: string | null;
};

type ParentRow = { id: string; name: string; nickname?: string | null; deleted_at?: string | null };

type DoseRow = {
  id: string;
  medication_id: string;
  scheduled_at: string;
  given_at?: string | null;
  skipped?: boolean | number | null;
  deleted_at?: string | null;
};

function displayName(p: ParentRow): string {
  return p.nickname || p.name;
}

async function cancelAllOwn(): Promise<void> {
  // This app only ever schedules through this module, so cancelling
  // everything the OS is holding for it is safe and — unlike tracking
  // identifiers by hand — cannot drift out of sync with reality.
  await Notifications.cancelAllScheduledNotificationsAsync();
}

type OnDutyRow = {
  parent_id: string;
  member_id: string;
  until?: string | null;
  deleted_at?: string | null;
};

type ApptRow = {
  id: string;
  parent_id: string;
  provider_name?: string | null;
  specialty?: string | null;
  location?: string | null;
  starts_at: string;
  status?: string | null;
  deleted_at?: string | null;
};

/**
 * What gets dropped first when iOS's ceiling is reached.
 *
 * iOS keeps only the 64 soonest PENDING notifications and silently discards
 * the rest. Before this, the loser was simply whatever was furthest away,
 * which meant a lead reminder three days out could survive while the dose-due
 * reminder behind it did not. Now the order is importance first, time second:
 * if something has to go, it is the heads-up, never the dose itself.
 */
const PRIORITY = {
  'dose-due': 0,
  unattended: 1,
  'dose-unlogged': 2,
  appointment: 3,
  refill: 4,
  'dose-lead': 5,
} as const;

type Kind = keyof typeof PRIORITY;

type Candidate = {
  at: Date;
  kind: Kind;
  schedule: () => Promise<void>;
};

/**
 * One "nobody is on duty" alert per parent per day, timed to that day's first
 * dose. Scheduled rather than sent immediately, because the useful moment is
 * just before something is due, not the instant the app happens to sync.
 */
async function scheduleUnattendedAlerts(
  parentId: string,
  parentById: Map<string, ParentRow>,
  candidates: Candidate[],
  now: Date,
  windowEnd: Date,
  seenDays: Set<string>,
): Promise<void> {
  const parent = parentById.get(parentId);
  if (!parent || parent.deleted_at) return;
  const who = displayName(parent);

  const meds = (await list('medications', { parent_id: parentId })) as unknown as MedRow[];
  for (const med of meds) {
    if (med.deleted_at) continue;
    const doses = (await list('med_doses', { medication_id: med.id })) as unknown as DoseRow[];
    for (const dose of doses) {
      if (dose.deleted_at || dose.given_at || dose.skipped) continue;
      const at = new Date(dose.scheduled_at);
      if (Number.isNaN(at.getTime()) || at <= now || at > windowEnd) continue;
      const dayKey = `${parentId}:${at.toDateString()}`;
      if (seenDays.has(dayKey)) continue;
      seenDays.add(dayKey);
      candidates.push({
        at,
        kind: 'unattended',
        schedule: () =>
          scheduleAt(at, {
            title: `No one is on duty for ${who}`,
            body: `A dose is due now and nobody has taken the shift. Open Halmoni to take over.`,
            data: { type: 'unattended', parentId },
          }),
      });
    }
  }
}

/**
 * Rebuild every dose-related and refill-related notification from the
 * current local mirror. Safe to call often; it is a full replace, not an
 * incremental patch.
 */
export async function syncDoseAndRefillNotifications(myMemberId: string | null = null): Promise<void> {
  try {
    await runDoseAndRefillSync(myMemberId);
  } catch (err) {
    // Never rethrow: the caller voids this, so throwing here is the same as
    // failing silently. Record it where a human can see it instead.
    health.lastRunAt = new Date().toISOString();
    health.lastError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    health.scheduled = null;
    Sentry.captureException(err, { tags: { feature: 'notifications' } });
  }
}

async function runDoseAndRefillSync(myMemberId: string | null): Promise<void> {
  health.lastRunAt = new Date().toISOString();
  health.lastError = null;
  health.skippedReason = null;

  if (isDemoMode()) {
    health.skippedReason = 'demo mode';
    return; // demo fixtures are not real reminders
  }
  const granted = await ensurePermission();
  if (!granted) {
    health.skippedReason = 'notification permission not granted';
    health.scheduled = 0;
    return;
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + NOTIFICATION_WINDOW_DAYS * 86_400_000);

  const [meds, parents, duty, prefs] = await Promise.all([
    list('medications') as unknown as Promise<MedRow[]>,
    list('parents') as unknown as Promise<ParentRow[]>,
    list('on_duty') as unknown as Promise<OnDutyRow[]>,
    loadPrefs(),
  ]);
  const parentById = new Map(parents.map((p) => [p.id, p]));

  // Who holds the shift for each parent, right now. A row whose `until` has
  // passed is nobody — a shift that ended is not a shift, and treating it as
  // one would silence every other phone indefinitely.
  const onDutyByParent = new Map<string, string | null>();
  for (const row of duty) {
    if (row.deleted_at) continue;
    const expired = row.until ? new Date(row.until).getTime() <= now.getTime() : false;
    onDutyByParent.set(row.parent_id, expired ? null : row.member_id);
  }

  health.prefs = `doses ${prefs.doses}, refills ${prefs.refills}, appointments ${prefs.appointments}, unattended ${prefs.unattended}`;

  const candidates: Candidate[] = [];
  const repeaters: { kind: Kind; schedule: () => Promise<void> }[] = [];
  let mutedByPrefs = 0;

  for (const med of meds) {
    if (med.deleted_at) continue;
    const parent = parentById.get(med.parent_id);
    const parentLabel = parent ? displayName(parent) : 'them';
    const onDuty = onDutyByParent.get(med.parent_id) ?? null;
    const wantsDoses = shouldNotify(prefs.doses, myMemberId, onDuty);
    const wantsRefills = shouldNotify(prefs.refills, myMemberId, onDuty);
    if (!wantsDoses && !wantsRefills) mutedByPrefs++;

    // --- refill reminders: at most two, tied to a specific calendar date ---
    if (wantsRefills && med.refill_by && /^\d{4}-\d{2}-\d{2}$/.test(med.refill_by)) {
      const refillDate = new Date(`${med.refill_by}T00:00:00`);
      for (const daysBefore of prefs.refillDays) {
        const at = new Date(refillDate);
        at.setDate(at.getDate() - daysBefore);
        at.setHours(REFILL_REMINDER_HOUR, 0, 0, 0);
        if (at <= now) continue;
        const label = daysBefore === 1 ? 'tomorrow' : `in ${daysBefore} days`;
        candidates.push({
          at,
          kind: 'refill',
          schedule: () =>
            scheduleAt(at, {
              title: `${med.name} refill due ${label}`,
              body: `${parentLabel}'s ${med.name} needs a refill by ${med.refill_by}.`,
              data: { type: 'refill', medicationId: med.id },
            }),
        });
      }
    }

    // --- dose due + unlogged follow-up, within the rolling window ---
    if (!wantsDoses) continue;
    const schedule = (med.schedule ?? []) as Slot[];
    if (schedule.length === 0) continue;

    // --- the repeating part -------------------------------------------------
    // One daily trigger per slot, instead of one notification per dose per day.
    // 4 medications taken 3 times a day stop costing ~36 pending notifications
    // a day and cost 12 in total, for ever — which takes iOS's 64 ceiling off
    // the table for any realistic family, and keeps reminders arriving even if
    // nobody opens the app for a month.
    //
    // The trigger carries the medication's own timezone, so an 08:00 dose
    // entered in New York still fires at 08:00 New York on a phone in
    // California. Without that this would quietly undo G2-27.
    //
    // The trade, stated honestly: a repeating trigger cannot know whether today's
    // dose was already logged, so it fires regardless. That is barely a
    // regression — the one-off version only skipped a logged dose if a sync
    // happened between the logging and the dose time, which is not the common
    // case. Unlogged follow-ups stay one-off precisely because they DO need to
    // know.
    const zone = scheduleZone(schedule) ?? undefined;
    for (const slot of schedule) {
      const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(slot.time ?? '');
      if (!m) continue;
      const hour = parseInt(m[1], 10);
      const minute = parseInt(m[2], 10);

      repeaters.push({
        kind: 'dose-due',
        schedule: () =>
          scheduleDaily(hour, minute, zone, {
            title: `${med.name} is due`,
            body: `${parentLabel}'s ${med.name}${med.name.endsWith('due') ? '' : ' dose'} is due now.`,
            data: { type: 'dose-due', medicationId: med.id },
          }),
      });

      for (const lead of prefs.doseLeadMinutes) {
        // Subtracting can cross midnight — 15 minutes before 00:05 is 23:50 the
        // previous day. As a daily repeat that is simply a different time of
        // day, so the wrap is arithmetic rather than a special case.
        const total = (hour * 60 + minute - lead + 1440 * 2) % 1440;
        repeaters.push({
          kind: 'dose-lead',
          schedule: () =>
            scheduleDaily(Math.floor(total / 60), total % 60, zone, {
              title: `${med.name} in ${humanMinutes(lead)}`,
              body: `${parentLabel}'s ${med.name} is due at ${slot.time}.`,
              data: { type: 'dose-lead', medicationId: med.id },
            }),
        });
      }
    }

    const doses = (await list('med_doses', { medication_id: med.id })) as unknown as DoseRow[];
    for (const dose of doses) {
      if (dose.deleted_at) continue;
      const at = new Date(dose.scheduled_at);
      if (Number.isNaN(at.getTime())) continue;
      if (at <= now || at > windowEnd) continue; // outside the rolling window
      if (dose.given_at || dose.skipped) continue; // already handled

      // Dose-due and lead reminders are NOT scheduled here any more — they are
      // daily repeating triggers, created once per slot below. See `repeaters`.

      // Nudges after the dose, if it still has not been logged. A list rather
      // than a single value so "30 minutes and again at an hour" is a setting
      // rather than a code change.
      for (const after of prefs.doseFollowUpMinutes) {
        const followUp = new Date(at.getTime() + after * 60_000);
        if (followUp <= now || followUp > windowEnd) continue;
        candidates.push({
          at: followUp,
          kind: 'dose-unlogged',
          schedule: () =>
            scheduleAt(followUp, {
              title: `Still waiting on ${med.name}`,
              // The dose's own zone, not the reader's: a sibling in another
              // timezone must not be told the 08:00 dose was "from 5:00 AM".
              body: `${parentLabel}'s ${med.name} dose from ${formatDoseTime(
                dose.scheduled_at,
                scheduleZone(schedule),
              )} hasn't been logged yet.`,
              data: { type: 'dose-unlogged', doseId: dose.id, medicationId: med.id },
            }),
        });
      }
    }
  }

  // --- appointments -------------------------------------------------------
  // New in G2-58. Until now the app knew about appointments and never once
  // mentioned one, which is a strange thing for a caregiving app to do.
  const appts = (await list('appointments')) as unknown as ApptRow[];
  for (const appt of appts) {
    if (appt.deleted_at) continue;
    if (appt.status && appt.status !== 'upcoming') continue; // cancelled or done
    const startsAt = new Date(appt.starts_at);
    if (Number.isNaN(startsAt.getTime())) continue;

    const onDuty = onDutyByParent.get(appt.parent_id) ?? null;
    if (!shouldNotify(prefs.appointments, myMemberId, onDuty)) continue;

    const parent = parentById.get(appt.parent_id);
    const who = parent ? displayName(parent) : 'them';
    const what = appt.provider_name || appt.specialty || 'An appointment';

    for (const lead of prefs.appointmentLeadMinutes) {
      const at = new Date(startsAt.getTime() - lead * 60_000);
      if (at <= now || at > windowEnd) continue;
      candidates.push({
        at,
        kind: 'appointment',
        schedule: () =>
          scheduleAt(at, {
            title: `${what} in ${humanMinutes(lead)}`,
            // Appointments are attended in person, so the reader's own clock is
            // the right one here — unlike a dose, which belongs to the parent's
            // timezone. Someone travelling to this needs their own time.
            body: `${who}: ${what}${appt.location ? ` at ${appt.location}` : ''} on ${formatDate(
              appt.starts_at,
            )} at ${formatTime(appt.starts_at)}.`,
            data: { type: 'appointment', appointmentId: appt.id },
          }),
      });
    }
  }

  // --- nobody on duty -----------------------------------------------------
  // Asked for explicitly: do not wait for a dose reminder to be the thing that
  // reveals nobody is covering. One alert per parent per day, at the first
  // dose of that day, because a shift gap matters exactly when something is
  // about to be due — and because a standing "nobody is on duty" buzz every
  // hour would be noise nobody reads.
  if (prefs.unattended !== 'off') {
    const seenDays = new Set<string>();
    for (const [parentId, holder] of onDutyByParent.entries()) {
      if (holder) continue; // somebody has it
      await scheduleUnattendedAlerts(parentId, parentById, candidates, now, windowEnd, seenDays);
    }
    // A parent with no on_duty row at all never appears in the map, so it is
    // not enough to walk the map — walk the parents.
    for (const parent of parents) {
      if (parent.deleted_at) continue;
      if (onDutyByParent.has(parent.id)) continue;
      await scheduleUnattendedAlerts(parent.id, parentById, candidates, now, windowEnd, seenDays);
    }
  }

  await cancelAllOwn();

  // --- spending the ceiling ------------------------------------------------
  // iOS keeps the 64 soonest pending notifications and silently bins the rest,
  // so this is a budget, and how it is spent decides what a family actually
  // hears.
  //
  // Repeating triggers go first. Each costs one slot and covers every day for
  // ever, so they are both the cheapest and the most valuable thing here —
  // and they are what keeps reminders arriving when nobody opens the app.
  const repeatOrder = [...repeaters].sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
  const repeatDue = repeatOrder.slice(0, MAX_SCHEDULED);
  for (const r of repeatDue) {
    await r.schedule();
  }

  // Whatever is left goes to the one-offs.
  const budget = Math.max(0, MAX_SCHEDULED - repeatDue.length);

  // Kept in time order, because what arrives next is what matters. But when it
  // does not all fit, the things dropped are the LEAST important and furthest
  // away — not simply the furthest. Before this, a heads-up three days out
  // could survive while the dose reminder behind it was discarded.
  candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
  let due = candidates;
  if (candidates.length > budget) {
    const sacrificial = [...candidates].sort(
      (a, b) => PRIORITY[b.kind] - PRIORITY[a.kind] || b.at.getTime() - a.at.getTime(),
    );
    const dropped = new Set(sacrificial.slice(0, candidates.length - budget));
    due = candidates.filter((c) => !dropped.has(c));
  }

  for (const c of due) {
    await c.schedule();
  }

  // The horizon the budget actually bought, as opposed to the one asked for.
  // Worth surfacing: "reminders are set for the next 9 days" is a different
  // conversation from "reminders are set", and the number moves with how many
  // medications a family is tracking.
  const furthest = due.length ? due[due.length - 1].at : null;
  health.horizonDays = furthest
    ? Math.max(0, Math.round((furthest.getTime() - now.getTime()) / 86_400_000))
    : null;
  health.repeating = repeatDue.length;
  health.dropped = candidates.length - due.length;

  health.scheduled = repeatDue.length + due.length;
  if (repeatDue.length + due.length === 0) {
    // Not an error, but the difference between "nothing to remind about" and
    // "broken" is exactly what someone is trying to work out at 2am.
    health.skippedReason =
      candidates.length === 0
        ? mutedByPrefs > 0
          ? 'your notification settings mute these on this phone'
          : 'no doses or refills fall inside the next few days'
        : null;
  }
}

/**
 * A reminder that fires at the same wall-clock time every day, for ever.
 *
 * This is what takes iOS's 64-pending ceiling off the table: it costs ONE
 * pending notification regardless of how many days it covers, where a one-off
 * per dose costs one per day. It also means reminders keep arriving when the
 * app has not been opened in weeks, which the rolling-window approach could
 * never promise.
 *
 * `timezone` is the load-bearing argument. Without it iOS interprets the hour
 * in the DEVICE's zone, so a sibling in California would be reminded at 08:00
 * Pacific about an 08:00 New York dose — the exact bug G2-27 exists to prevent,
 * reintroduced through the back door.
 */
async function scheduleDaily(
  hour: number,
  minute: number,
  timezone: string | undefined,
  content: { title: string; body: string; data: Record<string, unknown> },
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      data: content.data,
      sound: Platform.OS === 'ios' ? 'default' : undefined,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
      repeats: true,
      hour,
      minute,
      timezone,
    },
  });
}

async function scheduleAt(
  at: Date,
  content: { title: string; body: string; data: Record<string, unknown> },
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      data: content.data,
      sound: Platform.OS === 'ios' ? 'default' : undefined,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
  });
}

// ---------------------------------------------------------------------------
// Handoff received — a one-time alert, not a recurring reminder, so it is not
// part of the cancel-and-reschedule sweep above.
// ---------------------------------------------------------------------------

async function seenHandoffIds(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>(`SELECT id FROM notified_handoffs`);
  return new Set(rows.map((r) => r.id));
}

async function markHandoffNotified(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO notified_handoffs (id, notified_at) VALUES (?, ?)`,
    id,
    new Date().toISOString(),
  );
}

type HandoffRow = {
  id: string;
  to_member_id: string;
  from_member_id: string | null;
  summary: string;
  accepted_at: string | null;
  deleted_at?: string | null;
};

/**
 * Announce any handoff addressed to `meId` that this device has not already
 * announced. Call after a sync that pulled new rows.
 *
 * First-run safe: a fresh install marks every already-existing handoff as
 * seen without notifying, rather than replaying the family's entire handoff
 * history the moment someone signs in on a new phone.
 */
export async function syncHandoffNotifications(meId: string | null): Promise<void> {
  if (isDemoMode() || !meId) return;

  const db = await getDb();
  const bootstrapped = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) as n FROM notified_handoffs`,
  );
  const seen = await seenHandoffIds();
  const handoffs = (await list('handoffs')) as unknown as HandoffRow[];
  const mine = handoffs.filter((h) => h.to_member_id === meId && !h.deleted_at && !h.accepted_at);

  // Nothing marked seen yet on this device: this is the first run since
  // install (or since the table was created), so record everything as seen
  // without alerting — see the doc comment above.
  if (!bootstrapped || bootstrapped.n === 0) {
    for (const h of mine) await markHandoffNotified(h.id);
    return;
  }

  const prefs = await loadPrefs();
  // Hand-offs are addressed to one person by name, so there is no duty filter
  // to apply — someone handing the shift TO you is precisely the moment you
  // are not yet on it.
  if (prefs.handoffs === 'off') return;
  const granted = mine.some((h) => !seen.has(h.id)) ? await ensurePermission() : true;

  for (const h of mine) {
    if (seen.has(h.id)) continue;
    if (granted) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'You were handed something',
          body: h.summary || 'Someone in your care circle sent you a hand-off.',
          data: { type: 'handoff', handoffId: h.id },
          sound: Platform.OS === 'ios' ? 'default' : undefined,
        },
        trigger: null, // fire immediately
      });
    }
    await markHandoffNotified(h.id);
  }
}
