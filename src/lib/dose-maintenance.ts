/**
 * Keeping the dose horizon topped up (G2-23) and honouring schedule edits
 * (G2-25).
 *
 * The planning is in dose-plan.ts and is pure. This is the part that touches
 * the database: read what exists, ask the planner what should exist, write the
 * difference through the ordinary offline-first write path so it syncs like any
 * other change.
 */

import { list } from '@/lib/db/repository';
import type { ExistingDose, Slot } from '@/lib/dose-plan';
import {
  DOSE_HORIZON_DAYS,
  TOP_UP_THRESHOLD_DAYS,
  daysOfRunway,
  planReschedule,
  planTopUp,
} from '@/lib/dose-plan';
import { isDemoMode } from '@/lib/demo-mode';
import { deleteRows, writeRows } from '@/lib/sync/write-path';

type MedRow = {
  id: string;
  family_id: string;
  parent_id: string;
  schedule?: Slot[] | null;
};

function doseRowsFor(
  med: MedRow,
  planned: { id: string; scheduled_at: string }[],
): Record<string, unknown>[] {
  const nowIso = new Date().toISOString();
  return planned.map((d) => ({
    id: d.id,
    family_id: med.family_id,
    medication_id: med.id,
    parent_id: med.parent_id,
    scheduled_at: d.scheduled_at,
    given_at: null,
    given_by_member_id: null,
    skipped: false,
    // Cleared explicitly. Dose ids are derived from (medication, instant), so a
    // time that was removed from the schedule and later put back would otherwise
    // upsert onto its own tombstone and stay invisible.
    deleted_at: null,
    created_at: nowIso,
  }));
}

async function futureDoses(medicationId: string): Promise<ExistingDose[]> {
  const rows = await list('med_doses', { medication_id: medicationId });
  return rows as unknown as ExistingDose[];
}

/**
 * Extend every medication's horizon back out to 90 days.
 *
 * Additive only — see the note in dose-plan.ts about why the unattended path
 * never removes anything. Safe to call often: a medication with more than
 * TOP_UP_THRESHOLD_DAYS of runway is skipped without writing anything.
 */
export async function topUpDoseHorizon(): Promise<{ medications: number; created: number }> {
  // Demo data is a fixture regenerated on every seed; topping it up would write
  // rows into a store that is about to be thrown away.
  if (isDemoMode()) return { medications: 0, created: 0 };

  const meds = (await list('medications')) as unknown as MedRow[];
  const now = new Date();
  let touched = 0;
  let created = 0;

  for (const med of meds) {
    const schedule = (med.schedule ?? []) as Slot[];
    if (schedule.length === 0) continue;

    const existing = await futureDoses(med.id);
    if (daysOfRunway(existing, now) > TOP_UP_THRESHOLD_DAYS) continue;

    const plan = planTopUp({
      medicationId: med.id,
      schedule,
      existing,
      now,
      horizonDays: DOSE_HORIZON_DAYS,
    });
    if (plan.create.length === 0) continue;

    await writeRows('med_doses', doseRowsFor(med, plan.create));
    touched += 1;
    created += plan.create.length;
  }

  return { medications: touched, created };
}

/**
 * Someone just changed this medication's schedule on this device. Bring the
 * upcoming doses into line with it.
 *
 * Doses already marked given or skipped, and anything in the past, are left
 * exactly where they are — that is the adherence record, and destroying it is
 * what the old "delete the medication and re-add it" advice actually did.
 */
export async function rescheduleDoses(
  med: MedRow,
  schedule: Slot[],
): Promise<{ created: number; removed: number }> {
  const now = new Date();
  const existing = await futureDoses(med.id);
  const plan = planReschedule({
    medicationId: med.id,
    schedule,
    existing,
    now,
    horizonDays: DOSE_HORIZON_DAYS,
  });

  if (plan.remove.length) await deleteRows('med_doses', plan.remove);
  if (plan.create.length) await writeRows('med_doses', doseRowsFor(med, plan.create));

  return { created: plan.create.length, removed: plan.remove.length };
}
