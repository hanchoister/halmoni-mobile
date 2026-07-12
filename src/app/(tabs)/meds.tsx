import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { formatDateShort } from '@/lib/format';
import { useParents } from '@/lib/parent';
import { supabase } from '@/lib/supabase';
import { palette, spacing } from '@/lib/theme';

type MedRow = {
  id: string;
  name: string;
  dose: string | null;
  purpose: string | null;
  schedule: { time: string; withFood?: boolean }[];
  refill_by: string | null;
  pills_left: number | null;
};

export default function MedsScreen() {
  const { currentParent } = useParents();
  const [meds, setMeds] = useState<MedRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentParent) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('medications')
      .select('*')
      .eq('parent_id', currentParent.id)
      .order('name', { ascending: true });
    setMeds((data as MedRow[] | null) ?? []);
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
});
