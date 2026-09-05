import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import { Screen } from '@/components/ui/screen';
import { Icon } from '@/components/ui/icon';
import { list } from '@/lib/db/repository';
import { useDataVersion } from '@/lib/db/signal';
import { formatRelative, formatTime } from '@/lib/format';
import { useParents } from '@/lib/parent';
import { color, fontFamily, palette, radius, spacing, typography } from '@/lib/theme';

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
  const dataVersion = useDataVersion();
  const [appts, setAppts] = useState<ApptRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentParent) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const rows = (await list(
      'appointments',
      { parent_id: currentParent.id },
      { orderBy: 'starts_at DESC' },
    )) as ApptRow[];
    setAppts(rows);
    setLoading(false);
  }, [currentParent]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (dataVersion > 0) void load();
  }, [dataVersion, load]);

  if (!currentParent) {
    return (
      <Screen>
        <EmptyState icon="leaf" title="No parent yet" message="Add a parent to track visits." />
      </Screen>
    );
  }

  const now = new Date().toISOString();
  const upcoming = appts.filter((a) => a.starts_at >= now && a.status !== 'cancelled');
  const past = appts.filter((a) => a.starts_at < now || a.status === 'completed');

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Pressable
        onPress={() => router.push('/appointment/new')}
        accessibilityRole="button"
        accessibilityLabel="Add an appointment"
        style={styles.addRow}>
        <View style={styles.addPlus}>
          <Icon name="plus" size={16} color={color.onHero} strokeWidth={2.2} />
        </View>
        <Text style={styles.addLabel}>Add an appointment</Text>
      </Pressable>

      {appts.length === 0 ? (
        <EmptyState
          icon="visits"
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
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  addPlus: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: color.hero,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: { ...typography.bodyStrong, color: color.text },
  sectionTitle: {
    ...typography.label,
    color: color.textMuted,
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
  dateDay: { ...typography.title, fontSize: 22, color: palette.terracotta700 },
  dateMonth: { fontFamily: fontFamily.sans, fontSize: 10, color: palette.terracotta700, textTransform: 'uppercase' },
  provider: { ...typography.bodyStrong, color: palette.ink900 },
  sub: { ...typography.meta, fontSize: 12, color: palette.ink500, marginTop: 2 },
  summary: { ...typography.meta, fontSize: 12, color: palette.ink700, marginTop: 6, lineHeight: 16 },
});
