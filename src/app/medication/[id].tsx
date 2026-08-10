import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/field';
import { Pill } from '@/components/ui/pill';
import { Screen } from '@/components/ui/screen';
import { getById, list } from '@/lib/db/repository';
import { useDataVersion } from '@/lib/db/signal';
import { formatDateShort, formatRelative } from '@/lib/format';
import { useMe } from '@/lib/me';
import { newId } from '@/lib/newid';
import { deleteRow, writeRow } from '@/lib/sync/write-path';
import { palette, radius, spacing } from '@/lib/theme';

type Med = {
  id: string;
  parent_id: string;
  family_id: string;
  name: string;
  dose: string | null;
  purpose: string | null;
  schedule: { time: string; withFood?: boolean }[];
  prescriber: string | null;
  pharmacy: string | null;
  refill_by: string | null;
  pills_left: number | null;
  notes: string | null;
  started_at: string | null;
};

type Dose = {
  id: string;
  scheduled_at: string;
  given_at: string | null;
  given_by_member_id: string | null;
};

type Symptom = {
  id: string;
  description: string;
  severity: string;
  observed_at: string;
  possible_med_links: string[] | null;
};

export default function MedicationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { siblings } = useMe();
  const dataVersion = useDataVersion();
  const [med, setMed] = useState<Med | null>(null);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [symptoms, setSymptoms] = useState<Symptom[]>([]);
  const [loading, setLoading] = useState(true);
  const [logBody, setLogBody] = useState('');
  const [severity, setSeverity] = useState<'mild' | 'moderate' | 'strong'>('mild');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const medRow = (await getById('medications', id)) as Med | null;
    const [doseRows, allSymps] = await Promise.all([
      list(
        'med_doses',
        { medication_id: id },
        { orderBy: 'scheduled_at DESC', limit: 20 },
      ) as Promise<Dose[]>,
      // SQLite doesn't index into a JSON array, so scope by parent then filter
      // in JS. Symptom volume per parent is small.
      medRow
        ? (list(
            'symptoms',
            { parent_id: medRow.parent_id },
            { orderBy: 'observed_at DESC', limit: 100 },
          ) as Promise<Symptom[]>)
        : Promise.resolve<Symptom[]>([]),
    ]);
    setMed(medRow);
    setDoses(doseRows);
    setSymptoms(
      allSymps
        .filter((s) => (s.possible_med_links ?? []).includes(id))
        .slice(0, 20),
    );
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (dataVersion > 0) void load();
  }, [dataVersion, load]);

  async function logSymptom() {
    if (!med || !logBody.trim()) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await writeRow('symptoms', {
        id: newId(),
        parent_id: med.parent_id,
        family_id: med.family_id,
        description: logBody.trim(),
        severity,
        observed_at: now,
        possible_med_links: [med.id],
        created_at: now,
      });
      setLogBody('');
    } catch (err) {
      Alert.alert('Could not log', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!med) return;
    Alert.alert(
      `Delete ${med.name}?`,
      'This removes the medication and all its scheduled doses. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              await deleteRow('medications', med.id);
              router.back();
            } catch (err) {
              Alert.alert(
                'Could not delete',
                err instanceof Error ? err.message : String(err),
              );
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <Screen>
        <Text style={styles.muted}>Loading…</Text>
      </Screen>
    );
  }

  if (!med) {
    return (
      <Screen>
        <EmptyState emoji="💊" title="Medication not found" message="It may have been removed." />
      </Screen>
    );
  }

  const givenDoses = doses.filter((d) => d.given_at);
  const lastGiven = givenDoses[0];
  const giver = lastGiven?.given_by_member_id
    ? siblings.find((s) => s.id === lastGiven.given_by_member_id)
    : null;

  return (
    <Screen>
      <Card>
        <View style={styles.headerRow}>
          <View style={styles.pillIcon}>
            <Text style={styles.pillEmoji}>💊</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{med.name}</Text>
            {(med.dose || med.purpose) && (
              <Text style={styles.sub}>
                {[med.dose, med.purpose].filter(Boolean).join(' · ')}
              </Text>
            )}
            <View style={styles.pillRow}>
              {med.schedule.map((s, i) => (
                <Pill
                  key={i}
                  label={`${s.time}${s.withFood ? ' · with food' : ''}`}
                  tone="cream"
                />
              ))}
              {med.prescriber && <Pill label={`Rx: ${med.prescriber}`} />}
              {med.refill_by && (
                <Pill
                  label={`Refill ${formatDateShort(med.refill_by)}`}
                  tone={
                    new Date(med.refill_by).getTime() - Date.now() <= 7 * 86400000
                      ? 'terracotta'
                      : undefined
                  }
                />
              )}
            </View>
            {med.notes && (
              <View style={styles.notesBox}>
                <Text style={styles.notesText}>{med.notes}</Text>
              </View>
            )}
          </View>
        </View>
      </Card>

      <View style={styles.statsRow}>
        <Card style={{ flex: 1 }}>
          <Text style={styles.statLabel}>Started</Text>
          <Text style={styles.statValue}>
            {med.started_at ? formatDateShort(med.started_at) : '—'}
          </Text>
        </Card>
        <Card style={{ flex: 1 }}>
          <Text style={styles.statLabel}>Last given</Text>
          <View style={styles.lastGivenRow}>
            {giver && <Avatar name={giver.name} color={giver.color} size={24} />}
            <Text style={styles.statValue}>
              {lastGiven ? formatRelative(lastGiven.given_at!) : '—'}
            </Text>
          </View>
          {giver && <Text style={styles.sub}>by {giver.name}</Text>}
        </Card>
      </View>

      <Card>
        <Text style={styles.sectionLabel}>SIDE EFFECTS</Text>
        <Input
          value={logBody}
          onChangeText={setLogBody}
          placeholder={`What did you notice with ${med.name}?`}
          multiline
        />
        <View style={styles.sevRow}>
          {(['mild', 'moderate', 'strong'] as const).map((s) => (
            <Pressable
              key={s}
              onPress={() => setSeverity(s)}
              style={[styles.sevPill, severity === s && styles.sevPillActive]}>
              <Text style={[styles.sevText, severity === s && styles.sevTextActive]}>{s}</Text>
            </Pressable>
          ))}
        </View>
        <Button title="Log it" onPress={logSymptom} disabled={!logBody.trim()} busy={saving} />

        {symptoms.length === 0 ? (
          <Text style={[styles.muted, { marginTop: spacing.md }]}>
            No side effects logged for {med.name} yet.
          </Text>
        ) : (
          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            {symptoms.map((s) => (
              <View key={s.id} style={styles.symptomRow}>
                <View style={styles.symptomDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.symptomText}>{s.description}</Text>
                  <Text style={styles.muted}>
                    {formatRelative(s.observed_at)} · {s.severity}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>RECENT DOSES</Text>
        {doses.length === 0 ? (
          <Text style={styles.muted}>No doses recorded.</Text>
        ) : (
          doses.slice(0, 10).map((d) => {
            const author = d.given_by_member_id
              ? siblings.find((s) => s.id === d.given_by_member_id)
              : null;
            return (
              <View key={d.id} style={styles.doseRow}>
                <Text style={styles.doseTime}>{formatDateShort(d.scheduled_at)}</Text>
                {d.given_at ? (
                  <Text style={styles.doseGiven}>
                    ✓ {formatRelative(d.given_at)}
                    {author ? ` · ${author.name}` : ''}
                  </Text>
                ) : (
                  <Text style={styles.doseSkipped}>not given</Text>
                )}
              </View>
            );
          })
        )}
      </Card>

      {med.pharmacy && (
        <Card>
          <Text style={styles.sectionLabel}>PHARMACY</Text>
          <Text style={styles.statValue}>{med.pharmacy}</Text>
          {med.refill_by && (
            <Text style={styles.sub}>Refill by {formatDateShort(med.refill_by)}</Text>
          )}
        </Card>
      )}

      <Button
        title="Edit medication"
        variant="secondary"
        onPress={() => router.push(`/medication/edit/${med.id}`)}
      />
      <Button title="Delete medication" variant="danger" onPress={confirmDelete} busy={saving} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  pillIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: palette.sage100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillEmoji: { fontSize: 24 },
  name: { fontSize: 22, fontWeight: '800', color: palette.ink900 },
  sub: { fontSize: 12, color: palette.ink500, marginTop: 2 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  notesBox: {
    backgroundColor: palette.cream50,
    borderWidth: 1,
    borderColor: palette.cream200,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  notesText: { fontSize: 13, color: palette.ink700 },
  statsRow: { flexDirection: 'row', gap: spacing.md },
  statLabel: { fontSize: 11, fontWeight: '700', color: palette.ink500, letterSpacing: 1 },
  statValue: { fontSize: 14, fontWeight: '600', color: palette.ink900, marginTop: 4 },
  lastGivenRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.ink500,
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  sevRow: { flexDirection: 'row', gap: 6, marginVertical: spacing.sm },
  sevPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.cream200,
  },
  sevPillActive: { backgroundColor: palette.terracotta500 },
  sevText: { fontSize: 12, fontWeight: '600', color: palette.ink700 },
  sevTextActive: { color: palette.white },
  muted: { fontSize: 13, color: palette.ink500 },
  symptomRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  symptomDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.terracotta400,
    marginTop: 8,
  },
  symptomText: { fontSize: 13, color: palette.ink900 },
  doseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: palette.cream100,
  },
  doseTime: { fontSize: 12, color: palette.ink700 },
  doseGiven: { fontSize: 12, color: palette.sage600, fontWeight: '600' },
  doseSkipped: { fontSize: 12, color: palette.ink500 },
});
