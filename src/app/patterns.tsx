import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { analyzeSymptoms, isKnownMed, type Finding } from '@/lib/detective';
import { formatDateShort } from '@/lib/format';
import { useParents } from '@/lib/parent';
import { supabase } from '@/lib/supabase';
import { palette, spacing } from '@/lib/theme';

type MedRow = { id: string; name: string; started_at: string | null };
type SymptomRow = {
  id: string;
  description: string;
  observed_at: string;
  possible_med_links: string[] | null;
};

export default function PatternsScreen() {
  const { currentParent } = useParents();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentParent) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const since = new Date();
    since.setDate(since.getDate() - 60);
    const [medsRes, sympRes] = await Promise.all([
      supabase
        .from('medications')
        .select('id,name,started_at')
        .eq('parent_id', currentParent.id),
      supabase
        .from('symptoms')
        .select('id,description,observed_at,possible_med_links')
        .eq('parent_id', currentParent.id)
        .gte('observed_at', since.toISOString())
        .order('observed_at', { ascending: false })
        .limit(100),
    ]);
    const meds = (medsRes.data as MedRow[] | null) ?? [];
    const symptoms = (sympRes.data as SymptomRow[] | null) ?? [];
    const all = analyzeSymptoms(meds, symptoms);
    setFindings(all.filter((f) => f.tier === 'low'));
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
        <EmptyState emoji="🌿" title="No parent yet" message="Add a parent first." />
      </Screen>
    );
  }

  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Card tint="cream">
        <Text style={styles.disclaimer}>
          These are timing patterns, not medical advice. Each symptom below was logged near the
          start of a medication or was linked to it by a family member. Halmoni doesn&apos;t have
          established side-effect data for these matches — the doctor is the one who can tell
          you if there&apos;s really a connection.
        </Text>
      </Card>

      {findings.length === 0 ? (
        <EmptyState
          emoji="🌿"
          title="No possible patterns"
          message="Nothing to review right now."
        />
      ) : (
        findings.map((f) => {
          const inKb = isKnownMed(f.medName);
          return (
            <Card key={f.medId}>
              <Text style={styles.medName}>{f.medName}</Text>
              <Text style={styles.reason}>
                {inKb
                  ? 'Timing overlap — but the symptoms below are not established side effects.'
                  : 'Timing overlap — no side-effect data for this medication in Halmoni.'}
              </Text>
              <View style={styles.symptomList}>
                {f.symptoms.map((s) => (
                  <View key={s.id} style={styles.symptomRow}>
                    <Text style={styles.symptomText}>&ldquo;{s.description}&rdquo;</Text>
                    <Text style={styles.symptomMeta}>
                      {formatDateShort(s.observedAt)}
                      {s.daysAfter != null
                        ? ` · ${s.daysAfter} day${s.daysAfter === 1 ? '' : 's'} after starting`
                        : ''}
                      {s.explicitLink ? ' · linked by a family member' : ''}
                      {s.environmentalContext
                        ? ` · noted with "${s.environmentalContext}"`
                        : ''}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  disclaimer: { fontSize: 13, color: palette.ink700, lineHeight: 19 },
  medName: { fontSize: 16, fontWeight: '700', color: palette.ink900 },
  reason: { fontSize: 12, color: palette.ink500, marginTop: 4, fontStyle: 'italic' },
  symptomList: { marginTop: spacing.md, gap: spacing.sm },
  symptomRow: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: palette.cream100 },
  symptomText: { fontSize: 13, color: palette.ink900 },
  symptomMeta: { fontSize: 11, color: palette.ink500, marginTop: 4 },
});
