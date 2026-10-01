// "Changes that didn't save" — the user-facing half of G2-28.
//
// The sync engine used to merge by row-level timestamp: last write wins, loser
// never told. Two siblings editing the same medication meant one of them
// silently lost a dosage change, on a medical record, with no trace anywhere.
//
// The engine now detects that before overwriting anything and keeps BOTH
// versions. This screen is where the person who lost finds out and decides.
//
// WHY A CHOICE RATHER THAN AN AUTOMATIC MERGE
//
// A field-level merge looks appealing and is wrong here. If one sibling changed
// the dose to 10mg while the other changed it to 5mg, there is no combination of
// the two that is safe to invent — and a medication record is the last place to
// guess. So the app shows exactly what differs and asks. The cost is an
// interruption; the alternative is a silent wrong dose.
//
// WHAT "KEEP MINE" ACTUALLY DOES
//
// It re-submits the edit as a fresh write against the version now on the
// server, so it goes out cleanly instead of being re-detected as the same
// conflict. "Keep theirs" needs no write at all: the pull that runs straight
// after the failed push brings the other side's row into the mirror, so it is
// already what every screen shows. (If that pull failed too, the mirror still
// has the local edit and the next successful sync corrects it — the conflict
// record is the durable part either way.)

import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import {
  listOpenConflicts,
  resolveConflict,
  type WriteConflict,
} from '@/lib/db/repository';
import { writeRow } from '@/lib/sync/write-path';
import { palette, radius, spacing, typography } from '@/lib/theme';

// Bookkeeping, not content. Showing these would bury the one field the person
// actually changed under six timestamps and a pair of uuids.
const HIDDEN_FIELDS = new Set([
  'id',
  'family_id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
]);

// Table names as a caregiver would say them.
const TABLE_LABELS: Record<string, string> = {
  medications: 'Medication',
  med_doses: 'Dose',
  parents: 'Parent details',
  appointments: 'Appointment',
  visit_notes: 'Visit note',
  symptoms: 'Symptom',
  notes: 'Note',
  handoffs: 'Hand-off',
  on_duty: 'Who is on duty',
  thread_messages: 'Message',
  families: 'Family',
  family_members: 'Family member',
};

function label(field: string): string {
  return field.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Readable without pretending a nested object is a sentence. */
function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '— empty —';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function differingFields(mine: Record<string, unknown>, theirs: Record<string, unknown>) {
  const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
  const out: Array<{ field: string; mine: unknown; theirs: unknown }> = [];
  for (const k of keys) {
    if (HIDDEN_FIELDS.has(k)) continue;
    // Compared as JSON so that a schedule array differing by one entry counts,
    // while an identical one re-serialised in another key order does not.
    if (JSON.stringify(mine[k] ?? null) === JSON.stringify(theirs[k] ?? null)) continue;
    out.push({ field: k, mine: mine[k], theirs: theirs[k] });
  }
  return out;
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** A name for the row, so the card is not just a uuid. */
function title(c: WriteConflict): string {
  const kind = TABLE_LABELS[c.table_name] ?? c.table_name;
  const name = (c.theirs.name ?? c.mine.name ?? c.theirs.title ?? c.mine.title) as
    | string
    | undefined;
  return name ? `${kind} — ${name}` : kind;
}

export default function ConflictsScreen() {
  const [conflicts, setConflicts] = useState<WriteConflict[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setConflicts(await listOpenConflicts());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function keepMine(c: WriteConflict) {
    setBusy(c.id);
    try {
      // Strip the stale timestamps so the write is stamped fresh. Sending the
      // old updated_at back would be harmless on the server — its trigger
      // overwrites it either way — but it would make the local mirror briefly
      // disagree with what was just saved.
      const { updated_at: _u, ...payload } = c.mine;
      await writeRow(c.table_name, payload as Record<string, any>);
      await resolveConflict(c.id, 'kept-mine');
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function keepTheirs(c: WriteConflict) {
    setBusy(c.id);
    try {
      // No write. The server's version is already in the mirror.
      await resolveConflict(c.id, 'kept-theirs');
      await reload();
    } finally {
      setBusy(null);
    }
  }

  if (conflicts === null) return <Screen><View /></Screen>;

  if (conflicts.length === 0) {
    return (
      <Screen>
        <EmptyState
          title="Nothing waiting"
          message="When two people change the same thing at once, the change that did not save shows up here instead of disappearing."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <Text style={styles.sectionLabel}>WHY YOU ARE SEEING THIS</Text>
        <Text style={styles.sub}>
          Someone else changed the same thing before your change reached the server. Nothing
          was thrown away — both versions are below. Pick the one that is right.
        </Text>
      </Card>

      {conflicts.map((c) => {
        const diffs = differingFields(c.mine, c.theirs);
        return (
          <Card key={c.id}>
            <Text style={styles.sectionLabel}>{title(c).toUpperCase()}</Text>
            <Text style={styles.meta}>Your change was made {when(c.detected_at)}</Text>

            {diffs.length === 0 ? (
              <Text style={styles.sub}>
                The two versions now match, so there is nothing to choose. Dismiss it.
              </Text>
            ) : (
              diffs.map((d) => (
                <View key={d.field} style={styles.diff}>
                  <Text style={styles.field}>{label(d.field)}</Text>
                  <View style={styles.side}>
                    <Text style={styles.sideLabel}>Yours</Text>
                    <Text style={styles.sideValue}>{show(d.mine)}</Text>
                  </View>
                  <View style={styles.side}>
                    <Text style={styles.sideLabel}>Theirs (saved)</Text>
                    <Text style={styles.sideValue}>{show(d.theirs)}</Text>
                  </View>
                </View>
              ))
            )}

            <View style={styles.actions}>
              <Button
                title={diffs.length === 0 ? 'Dismiss' : 'Keep theirs'}
                variant="secondary"
                onPress={() => void keepTheirs(c)}
                disabled={busy === c.id}
              />
              {diffs.length > 0 && (
                <Button
                  title="Use mine instead"
                  onPress={() => void keepMine(c)}
                  disabled={busy === c.id}
                />
              )}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    ...typography.meta,
    fontSize: 11,
    letterSpacing: 1.2,
    color: palette.sage700,
    marginBottom: spacing.xs,
  },
  sub: { ...typography.body, fontSize: 14, color: palette.ink700 },
  meta: { ...typography.meta, fontSize: 12, color: palette.ink500, marginBottom: spacing.sm },
  diff: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.cream200,
  },
  field: { ...typography.body, fontSize: 14, fontWeight: '600', color: palette.ink900 },
  side: {
    marginTop: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: palette.cream100,
  },
  sideLabel: { ...typography.meta, fontSize: 11, color: palette.sage700 },
  sideValue: { ...typography.body, fontSize: 14, color: palette.ink900 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
});
