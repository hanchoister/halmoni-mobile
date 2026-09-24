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
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getDb } from '@/lib/db/client';
import { list } from '@/lib/db/repository';
import type { Slot } from '@/lib/dose-plan';
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

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (permissionAsked && !current.canAskAgain) return false;
  permissionAsked = true;
  const req = await Notifications.requestPermissionsAsync();
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

type Candidate = { at: Date; schedule: () => Promise<void> };

/**
 * Rebuild every dose-related and refill-related notification from the
 * current local mirror. Safe to call often; it is a full replace, not an
 * incremental patch.
 */
export async function syncDoseAndRefillNotifications(): Promise<void> {
  if (isDemoMode()) return; // demo fixtures are not real reminders
  const granted = await ensurePermission();
  if (!granted) return;

  const now = new Date();
  const windowEnd = new Date(now.getTime() + NOTIFICATION_WINDOW_DAYS * 86_400_000);

  const [meds, parents] = await Promise.all([
    list('medications') as unknown as Promise<MedRow[]>,
    list('parents') as unknown as Promise<ParentRow[]>,
  ]);
  const parentById = new Map(parents.map((p) => [p.id, p]));

  const candidates: Candidate[] = [];

  for (const med of meds) {
    if (med.deleted_at) continue;
    const parent = parentById.get(med.parent_id);
    const parentLabel = parent ? displayName(parent) : 'them';

    // --- refill reminders: at most two, tied to a specific calendar date ---
    if (med.refill_by && /^\d{4}-\d{2}-\d{2}$/.test(med.refill_by)) {
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
              body: `${parentLabel}'s ${med.name} dose from ${at.toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
              })} hasn't been logged yet.`,
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
  for (const c of candidates.slice(0, MAX_SCHEDULED)) {
    await c.schedule();
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
