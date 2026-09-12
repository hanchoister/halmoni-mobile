/**
 * Withdrawing permission — G1-32.
 *
 * The notice handed to the parent says, in the largest words on the page, that
 * they can change their mind: tell any family member to delete your record and
 * everything goes. Until 2026-09-11 no screen in the app could do that. A
 * medication could be deleted, an appointment could be deleted, and the person
 * the whole record is about could not.
 *
 * That made three things untrue at once: the notice, the privacy policy, and
 * Apple 5.1.1(ii), which wants "an easily accessible and understandable way to
 * withdraw consent". Consent you cannot withdraw is not really consent, and a
 * promise of deletion is the one promise this product cannot afford to break.
 *
 * Deleting the parent row alone is not enough. Their medications, doses,
 * appointments, notes and symptoms all hang off it by parent_id and would
 * otherwise stay on every device and on the server, orphaned but intact —
 * exactly the data the parent asked to have removed.
 */
import type { SyncableTable } from '@/lib/db/schema';
import { list } from '@/lib/db/repository';
import { deleteRow, deleteRows } from '@/lib/sync/write-path';

/**
 * Every synced table with a parent_id. visit_notes is missing on purpose: it
 * hangs off an appointment instead, and is handled first below.
 */
export const PARENT_SCOPED_TABLES: SyncableTable[] = [
  'med_doses',
  'medications',
  'appointments',
  'symptoms',
  'handoffs',
  'on_duty',
  'thread_messages',
  'notes',
];

/**
 * Tombstone everything about this person, then the person.
 *
 * Children first, so that an interruption halfway through leaves a parent with
 * missing records rather than records with no parent: the first is visible in
 * the app and can be finished, the second is invisible and cannot.
 *
 * Every delete goes through the normal write path, so each one is a tombstone
 * in the outbox and reaches the other phones the same way any other change
 * does. Nothing here is a hard delete — that is what makes it recoverable if
 * someone taps it by mistake, and it is also why the notice says the data
 * disappears from the app straight away and from backups within 30 days.
 */
export async function removeParent(parentId: string): Promise<Record<string, number>> {
  const removed: Record<string, number> = {};

  const appointments = await list('appointments', { parent_id: parentId });
  const visitNotes = (
    await Promise.all(
      appointments.map((a) => list('visit_notes', { appointment_id: String(a.id) })),
    )
  ).flat();
  if (visitNotes.length) {
    await deleteRows('visit_notes', visitNotes.map((r) => String(r.id)));
    removed.visit_notes = visitNotes.length;
  }

  for (const table of PARENT_SCOPED_TABLES) {
    const rows = await list(table, { parent_id: parentId });
    if (rows.length === 0) continue;
    await deleteRows(table, rows.map((r) => String(r.id)));
    removed[table] = rows.length;
  }

  await deleteRow('parents', parentId);
  removed.parents = 1;
  return removed;
}

/** "3 medications, 90 doses and 2 appointments" — for the confirmation dialog. */
export function describeRemoval(counts: Record<string, number>): string {
  const names: Record<string, [string, string]> = {
    medications: ['medication', 'medications'],
    med_doses: ['dose', 'doses'],
    appointments: ['appointment', 'appointments'],
    visit_notes: ['visit note', 'visit notes'],
    symptoms: ['symptom', 'symptoms'],
    handoffs: ['handoff', 'handoffs'],
    on_duty: ['duty record', 'duty records'],
    thread_messages: ['message', 'messages'],
    notes: ['note', 'notes'],
  };
  const parts = Object.entries(counts)
    .filter(([table, n]) => table !== 'parents' && n > 0)
    .map(([table, n]) => `${n} ${names[table]?.[n === 1 ? 0 : 1] ?? table}`);
  if (parts.length === 0) return 'their record';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** What the confirmation asks, before anything is deleted. */
export async function previewRemoval(parentId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const appointments = await list('appointments', { parent_id: parentId });
  const visitNotes = (
    await Promise.all(
      appointments.map((a) => list('visit_notes', { appointment_id: String(a.id) })),
    )
  ).flat();
  if (visitNotes.length) counts.visit_notes = visitNotes.length;
  for (const table of PARENT_SCOPED_TABLES) {
    const rows = await list(table, { parent_id: parentId });
    if (rows.length) counts[table] = rows.length;
  }
  return counts;
}
