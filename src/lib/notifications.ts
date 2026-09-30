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
 * worst thing this app can do" (see sync-banner.tsx), so this only ever
 * schedules within a short rolling window (NOTIFICATION_WINDOW_DAYS) rather
 * than the full 90-day dose horizon, and caps the total it will schedule,
 * soonest first, so a family with many medications degrades by dropping the
 * furthest-out reminders rather than by silently dropping random ones.
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

import { loadPrefs, shouldNotify } from '@/lib/notification-prefs';
import { Platform } from 'react-native';

import { getDb } from '@/lib/db/client';
import { list } from '@/lib/db/repository';
import type { Slot } from '@/lib/dose-plan';
import { scheduleZone } from '@/lib/dose-plan';
import { isDemoMode } from '@/lib/demo-mode';
import { formatDoseTime } from '@/lib/format';

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
const NOTIFICATION_WINDOW_DAYS = 3;
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
};

let health: NotificationHealth = {
  lastRunAt: null,
  permission: 'unknown',
  canAskAgain: null,
  scheduled: null,
  lastError: null,
  skippedReason: 'has not run yet',
  prefs: null,
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

type Candidate = { at: Date; schedule: () => Promise<void> };

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

  health.prefs = `doses ${prefs.doses}, refills ${prefs.refills}`;

  const candidates: Candidate[] = [];
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
      for (const daysBefore of REFILL_REMINDER_DAYS) {
        const at = new Date(refillDate);
        at.setDate(at.getDate() - daysBefore);
        at.setHours(REFILL_REMINDER_HOUR, 0, 0, 0);
        if (at <= now) continue;
        const label = daysBefore === 1 ? 'tomorrow' : `in ${daysBefore} days`;
        candidates.push({
          at,
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
    const doses = (await list('med_doses', { medication_id: med.id })) as unknown as DoseRow[];
    for (const dose of doses) {
      if (dose.deleted_at) continue;
      const at = new Date(dose.scheduled_at);
      if (Number.isNaN(at.getTime())) continue;
      if (at <= now || at > windowEnd) continue; // outside the rolling window
      if (dose.given_at || dose.skipped) continue; // already handled

      candidates.push({
        at,
        schedule: () =>
          scheduleAt(at, {
            title: `${med.name} is due`,
            body: `${parentLabel}'s ${med.name}${med.name.endsWith('due') ? '' : ' dose'} is due now.`,
            data: { type: 'dose-due', doseId: dose.id, medicationId: med.id },
          }),
      });

      const followUp = new Date(at.getTime() + UNLOGGED_FOLLOWUP_MINUTES * 60_000);
      if (followUp > now && followUp <= windowEnd) {
        candidates.push({
          at: followUp,
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

  await cancelAllOwn();

  // Soonest first: if there are more candidates than the ceiling, the ones
  // dropped are the furthest away, which is also the ones most likely to be
  // superseded by the next sync's reschedule before they would have mattered.
  candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
  const due = candidates.slice(0, MAX_SCHEDULED);
  for (const c of due) {
    await c.schedule();
  }

  health.scheduled = due.length;
  if (due.length === 0) {
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
