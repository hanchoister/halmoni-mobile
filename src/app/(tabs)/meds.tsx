import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { list } from '@/lib/db/repository';
import { useDataVersion } from '@/lib/db/signal';
import { analyzeSymptoms } from '@/lib/detective';
import { loadDismissedPairs } from '@/lib/detective-dismissals';
import { useFamily } from '@/lib/family';
import { formatDateShort } from '@/lib/format';
import { useParents } from '@/lib/parent';
import { palette, radius, spacing } from '@/lib/theme';

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
          emoji="🌿"
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
      <Button title="+ Add medication" onPress={() => router.push('/medication/new')} />

      {patternCount > 0 && (
        <Pressable onPress={() => router.push('/patterns')} style={styles.detectiveBanner}>
          <Text style={styles.detectiveEmoji}>🔎</Text>
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
          emoji="💊"
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
                    <Text style={styles.pillEmoji}>💊</Text>
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
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  pillIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: palette.sage100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillEmoji: { fontSize: 22 },
  name: { fontSize: 16, fontWeight: '700', color: palette.ink900 },
  sub: { fontSize: 13, color: palette.ink500, marginTop: 2 },
  schedule: { fontSize: 12, color: palette.sage700, marginTop: 6, fontWeight: '600' },
  refill: { fontSize: 11, color: palette.ink500, marginTop: 4 },
  refillSoon: { color: palette.terracotta700, fontWeight: '700' },
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
  detectiveEmoji: { fontSize: 22 },
  detectiveTitle: { fontSize: 14, fontWeight: '700', color: palette.ink900 },
  detectiveSub: { fontSize: 12, color: palette.ink500, marginTop: 2 },
});
