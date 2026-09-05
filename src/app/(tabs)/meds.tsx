import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { Icon } from '@/components/ui/icon';
import { list } from '@/lib/db/repository';
import { useDataVersion } from '@/lib/db/signal';
import { analyzeSymptoms } from '@/lib/detective';
import { loadDismissedPairs } from '@/lib/detective-dismissals';
import { useFamily } from '@/lib/family';
import { formatDateShort } from '@/lib/format';
import { useParents } from '@/lib/parent';
import { color, fontFamily, palette, radius, spacing, typography } from '@/lib/theme';

type MedRow = {
  id: string;
  name: string;
  dose: string | null;
  purpose: string | null;
  schedule: { time: string; withFood?: boolean }[];
  refill_by: string | null;
  pills_left: number | null;
  started_at: string | null;
};

type SymptomRow = {
  id: string;
  description: string;
  observed_at: string;
  possible_med_links: string[] | null;
};

export default function MedsScreen() {
  const { familyId } = useFamily();
  const { currentParent } = useParents();
  const dataVersion = useDataVersion();
  const [meds, setMeds] = useState<MedRow[]>([]);
  const [patternCount, setPatternCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!familyId || !currentParent) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const since = new Date();
    since.setDate(since.getDate() - 60);
    const [rows, symptomRows, dismissed] = await Promise.all([
      list(
        'medications',
        { parent_id: currentParent.id },
        { orderBy: 'name ASC' },
      ) as Promise<MedRow[]>,
      list(
        'symptoms',
        { parent_id: currentParent.id },
        {
          gte: { observed_at: since.toISOString() },
          orderBy: 'observed_at DESC',
          limit: 100,
        },
      ) as Promise<SymptomRow[]>,
      loadDismissedPairs(familyId),
    ]);
    setMeds(rows);
    setPatternCount(analyzeSymptoms(rows, symptomRows, dismissed).length);
    setLoading(false);
  }, [familyId, currentParent]);

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
        <EmptyState
          icon="leaf"
          title="No parent yet"
          message="Add a parent on the Today tab to start tracking medications."
        />
      </Screen>
    );
  }

  function daysUntil(iso: string): number {
    const ms = new Date(iso).getTime() - Date.now();
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  }

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Pressable
        onPress={() => router.push('/medication/new')}
        accessibilityRole="button"
        accessibilityLabel="Add a medication"
        style={styles.addRow}>
        <View style={styles.addPlus}>
          <Icon name="plus" size={16} color={color.onHero} strokeWidth={2.2} />
        </View>
        <Text style={styles.addLabel}>Add a medication</Text>
      </Pressable>

      {patternCount > 0 && (
        <Pressable onPress={() => router.push('/patterns')} style={styles.detectiveBanner}>
          <Icon name="search" size={20} color={color.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.detectiveTitle}>
              {patternCount === 1
                ? '1 question worth asking'
                : `${patternCount} questions worth asking`}
            </Text>
            <Text style={styles.detectiveSub}>Symptoms logged soon after a medication started →</Text>
          </View>
        </Pressable>
      )}

      {meds.length === 0 ? (
        <EmptyState
          icon="meds"
          title="No medications yet"
          message="Add the first medication and we'll start tracking doses."
        />
      ) : (
        meds.map((m) => {
          const refillDays = m.refill_by ? daysUntil(m.refill_by) : null;
          const refillSoon = refillDays != null && refillDays <= 7;
          const scheduleText = m.schedule
            .map((s) => s.time)
            .join(' · ');
          return (
            <Pressable key={m.id} onPress={() => router.push(`/medication/${m.id}`)}>
              <Card>
                <View style={styles.row}>
                  <View style={styles.pillIcon}>
                    <View style={styles.pillIcon}>
                    <Icon name="meds" size={19} color={color.confirm} strokeWidth={2} />
                  </View>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{m.name}</Text>
                    {m.dose && <Text style={styles.sub}>{m.dose}</Text>}
                    {m.purpose && <Text style={styles.sub}>For {m.purpose}</Text>}
                    {scheduleText && <Text style={styles.schedule}>{scheduleText}</Text>}
                    {m.refill_by && (
                      <Text style={[styles.refill, refillSoon && styles.refillSoon]}>
                        Refill by {formatDateShort(m.refill_by)}
                        {refillDays != null && ` (${refillDays}d)`}
                      </Text>
                    )}
                  </View>
                </View>
              </Card>
            </Pressable>
          );
        })
      )}
    </Screen>
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
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  pillIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: palette.sage100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { ...typography.title, fontSize: 16, color: palette.ink900 },
  sub: { ...typography.meta, color: palette.ink500, marginTop: 2 },
  schedule: { ...typography.meta, fontSize: 12, color: palette.sage700, marginTop: 6 },
  refill: { fontFamily: fontFamily.sans, fontSize: 11, color: palette.ink500, marginTop: 4 },
  refillSoon: { color: palette.terracotta700, fontFamily: fontFamily.sansBold },
  detectiveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.sage500,
    backgroundColor: palette.sage50,
  },
  detectiveTitle: { ...typography.bodyStrong, color: palette.ink900 },
  detectiveSub: { ...typography.meta, fontSize: 12, color: palette.ink500, marginTop: 2 },
});
