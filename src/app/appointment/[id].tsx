import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { Screen } from '@/components/ui/screen';
import { formatDate, formatRelative, formatTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { palette, spacing } from '@/lib/theme';

type Appt = {
  id: string;
  parent_id: string;
  provider_name: string;
  specialty: string | null;
  location: string | null;
  starts_at: string;
  status: 'upcoming' | 'completed' | 'cancelled';
  summary: string | null;
  prep_notes: string | null;
};

type VisitNote = {
  id: string;
  kind: string;
  body: string;
  captured_at: string;
};

const kindLabel: Record<string, string> = {
  voice: 'Voice memo',
  diagnosis: 'Diagnosis',
  'new-med': 'New med',
  'stop-med': 'Stop med',
  'follow-up': 'Follow-up',
  instruction: 'Instruction',
  other: 'Note',
};

export default function AppointmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [appt, setAppt] = useState<Appt | null>(null);
  const [notes, setNotes] = useState<VisitNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [apptRes, notesRes] = await Promise.all([
      supabase.from('appointments').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('visit_notes')
        .select('*')
        .eq('appointment_id', id)
        .order('captured_at', { ascending: true }),
    ]);
    setAppt((apptRes.data as Appt | null) ?? null);
    setNotes((notesRes.data as VisitNote[] | null) ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function confirmDelete() {
    if (!appt) return;
    Alert.alert(
      `Delete this appointment?`,
      `Removes the visit with ${appt.provider_name} and any visit notes captured.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const { error } = await supabase.from('appointments').delete().eq('id', appt.id);
            setBusy(false);
            if (error) {
              Alert.alert('Could not delete', error.message);
              return;
            }
            router.back();
          },
        },
      ],
    );
  }

  async function markCompleted() {
    if (!appt) return;
    setBusy(true);
    const { error } = await supabase
      .from('appointments')
      .update({ status: 'completed' })
      .eq('id', appt.id);
    setBusy(false);
    if (error) {
      Alert.alert('Could not update', error.message);
      return;
    }
    await load();
  }

  if (loading) {
    return (
      <Screen>
        <Text style={styles.muted}>Loading…</Text>
      </Screen>
    );
  }

  if (!appt) {
    return (
      <Screen>
        <EmptyState emoji="🩺" title="Not found" message="This appointment may have been removed." />
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <View style={styles.pillRow}>
          <Pill
            label={appt.status === 'upcoming' ? 'Upcoming' : 'Completed'}
            tone={appt.status === 'upcoming' ? 'terracotta' : 'sage'}
          />
          <Pill label={formatDate(appt.starts_at)} tone="cream" />
          <Pill label={formatTime(appt.starts_at)} tone="cream" />
        </View>
        <Text style={styles.heading}>{appt.provider_name}</Text>
        {appt.specialty && <Text style={styles.sub}>🩺 {appt.specialty}</Text>}
        {appt.location && <Text style={styles.sub}>📍 {appt.location}</Text>}
        <View style={{ height: spacing.md }} />
        <Button
          title={appt.status === 'upcoming' ? 'Start Visit Mode' : 'Reopen visit notes'}
          onPress={() => router.push(`/visit/${appt.id}`)}
          variant={appt.status === 'upcoming' ? 'primary' : 'secondary'}
        />
      </Card>

      {appt.summary && (
        <Card tint="sage">
          <Text style={styles.sectionLabel}>SUMMARY</Text>
          <Text style={styles.body}>{appt.summary}</Text>
        </Card>
      )}

      {notes.length > 0 && (
        <Card>
          <Text style={styles.sectionLabel}>CAPTURED DURING THE VISIT</Text>
          {notes.map((vn) => (
            <View key={vn.id} style={styles.noteRow}>
              <Text style={styles.noteKind}>
                {kindLabel[vn.kind] ?? 'Note'} · {formatRelative(vn.captured_at)}
              </Text>
              <Text style={styles.body}>{vn.body}</Text>
            </View>
          ))}
        </Card>
      )}

      {appt.prep_notes && (
        <Card>
          <Text style={styles.sectionLabel}>PREP NOTES</Text>
          <Text style={styles.body}>{appt.prep_notes}</Text>
        </Card>
      )}

      {appt.status === 'upcoming' && (
        <Button
          title="Mark completed"
          variant="secondary"
          onPress={markCompleted}
          busy={busy}
        />
      )}
      <Button
        title="Edit appointment"
        variant="secondary"
        onPress={() => router.push(`/appointment/edit/${appt.id}`)}
      />
      <Button title="Delete appointment" variant="danger" onPress={confirmDelete} busy={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm },
  heading: { fontSize: 22, fontWeight: '800', color: palette.ink900 },
  sub: { fontSize: 13, color: palette.ink500, marginTop: 4 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.ink500,
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  body: { fontSize: 13, color: palette.ink900, lineHeight: 19 },
  muted: { fontSize: 13, color: palette.ink500 },
  noteRow: {
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.cream100,
  },
  noteKind: {
    fontSize: 11,
    color: palette.ink500,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
});
