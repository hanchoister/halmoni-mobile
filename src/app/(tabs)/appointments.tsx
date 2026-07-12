import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { Screen } from '@/components/ui/screen';
import { formatRelative, formatTime } from '@/lib/format';
import { useParents } from '@/lib/parent';
import { supabase } from '@/lib/supabase';
import { palette, radius, spacing } from '@/lib/theme';

type ApptRow = {
  id: string;
  provider_name: string;
  specialty: string | null;
  location: string | null;
  starts_at: string;
  status: 'upcoming' | 'completed' | 'cancelled';
  summary: string | null;
};

export default function AppointmentsScreen() {
  const { currentParent } = useParents();
  const [appts, setAppts] = useState<ApptRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentParent) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('appointments')
      .select('*')
      .eq('parent_id', currentParent.id)
      .order('starts_at', { ascending: false });
    setAppts((data as ApptRow[] | null) ?? []);
    setLoading(false);
  }, [currentParent]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!currentParent) {
    return (
      <Screen>
        <EmptyState emoji="🌿" title="No parent yet" message="Add a parent to track visits." />
      </Screen>
    );
  }

  const now = new Date().toISOString();
  const upcoming = appts.filter((a) => a.starts_at >= now && a.status !== 'cancelled');
  const past = appts.filter((a) => a.starts_at < now || a.status === 'completed');

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Button title="+ Add appointment" onPress={() => router.push('/appointment/new')} />

      {appts.length === 0 ? (
        <EmptyState
          emoji="🩺"
          title="No appointments yet"
          message="Add the first one and we'll help you prep for it."
        />
      ) : (
        <>
          {upcoming.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Upcoming</Text>
              {upcoming.map((a) => (
                <ApptCard key={a.id} appt={a} />
              ))}
            </>
          )}
          {past.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Past visits</Text>
              {past.map((a) => (
                <ApptCard key={a.id} appt={a} />
              ))}
            </>
          )}
        </>
      )}
    </Screen>
  );
}

function ApptCard({ appt }: { appt: ApptRow }) {
  const date = new Date(appt.starts_at);
  const isPast = appt.starts_at < new Date().toISOString();
  return (
    <Pressable onPress={() => router.push(`/appointment/${appt.id}`)}>
      <Card>
        <View style={styles.row}>
          <View style={styles.dateBox}>
            <Text style={styles.dateDay}>{date.getDate()}</Text>
            <Text style={styles.dateMonth}>{date.toLocaleDateString([], { month: 'short' })}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.provider}>{appt.provider_name}</Text>
            {appt.specialty && <Text style={styles.sub}>{appt.specialty}</Text>}
            <Text style={styles.sub}>
              {formatTime(appt.starts_at)}
              {appt.location ? ` · ${appt.location}` : ''}
            </Text>
            {isPast && appt.summary && (
              <Text style={styles.summary} numberOfLines={2}>
                {appt.summary}
              </Text>
            )}
          </View>
          {isPast && <Pill label={formatRelative(appt.starts_at)} />}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.ink500,
    letterSpacing: 1,
    marginTop: spacing.sm,
  },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  dateBox: {
    width: 50,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: palette.terracotta100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateDay: { fontSize: 20, fontWeight: '800', color: palette.terracotta700 },
  dateMonth: { fontSize: 10, color: palette.terracotta700, textTransform: 'uppercase' },
  provider: { fontSize: 15, fontWeight: '700', color: palette.ink900 },
  sub: { fontSize: 12, color: palette.ink500, marginTop: 2 },
  summary: { fontSize: 12, color: palette.ink700, marginTop: 6, lineHeight: 16 },
});
