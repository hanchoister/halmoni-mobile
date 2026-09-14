import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { list } from '@/lib/db/repository';
import { useDataVersion } from '@/lib/db/signal';
import { analyzeSymptoms, type Finding } from '@/lib/detective';
import { dismissFinding, loadDismissedPairs } from '@/lib/detective-dismissals';
import { useFamily } from '@/lib/family';
import { formatDateShort } from '@/lib/format';
import { useMe } from '@/lib/me';
import { useParents } from '@/lib/parent';
import { palette, spacing } from '@/lib/theme';

type MedRow = { id: string; name: string; started_at: string | null };
type SymptomRow = {
  id: string;
  description: string;
  observed_at: string;
  possible_med_links: string[] | null;
};

export default function PatternsScreen() {
  const { familyId } = useFamily();
  const { currentParent } = useParents();
  const { me } = useMe();
  const dataVersion = useDataVersion();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!familyId || !currentParent) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const since = new Date();
    since.setDate(since.getDate() - 60);
    const [medRows, sympRows, dismissed] = await Promise.all([
      list('medications', { parent_id: currentParent.id }) as Promise<MedRow[]>,
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
    setFindings(analyzeSymptoms(medRows, sympRows, dismissed));
    setLoading(false);
  }, [familyId, currentParent]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Refetch on any local write (dismissals, new symptoms, sync pulls).
  useEffect(() => {
    if (dataVersion > 0) void load();
  }, [dataVersion, load]);

  async function onDismiss(symptomId: string, medId: string, medName: string) {
    if (!familyId || !currentParent) return;
    Alert.alert(
      'Mark as discussed with the doctor?',
      `This hides it from the ${medName} list. Use it after you have talked it over with the doctor.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark discussed',
          style: 'destructive',
          onPress: async () => {
            try {
              await dismissFinding({
                familyId,
                parentId: currentParent.id,
                authorMemberId: me?.id ?? null,
                symptomId,
                medId,
              });
              await load();
            } catch (err) {
              Alert.alert(
                'Could not save',
                err instanceof Error ? err.message : String(err),
              );
            }
          },
        },
      ],
    );
  }

  if (!currentParent) {
    return (
      <Screen>
        <EmptyState icon="leaf" title="No parent yet" message="Add a parent first." />
      </Screen>
    );
  }

  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Card tint="cream">
        <Text style={styles.disclaimer}>
          Halmoni is not telling you what caused anything, and cannot. All it does is notice
          that a symptom was logged soon after a medication started, or that someone in the
          family linked the two. That is a reason to ask a question, not an answer. Bring these
          to the doctor and let them judge. If something seems serious, call the doctor or 911.
        </Text>
      </Card>

      {findings.length === 0 ? (
        <EmptyState
          icon="leaf"
          title="Nothing logged yet"
          message="Symptoms you log after a medication starts are gathered here for the next appointment."
        />
      ) : (
        findings.map((f) => {
          return (
            <Card key={f.medId} tint="cream">
              <Pressable onPress={() => router.push(`/medication/${f.medId}`)}>
                <Text style={styles.tierLabel}>For the next appointment</Text>
                <Text style={styles.medName}>Since starting {f.medName}</Text>
              </Pressable>
              <View style={styles.symptomList}>
                {f.symptoms.map((s) => (
                  <View key={s.id} style={styles.symptomRow}>
                    <View style={{ flex: 1 }}>
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
                    <Button
                      title="Discussed"
                      variant="secondary"
                      onPress={() => onDismiss(s.id, f.medId, f.medName)}
                    />
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
  tierLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.ink500,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  medName: { fontSize: 16, fontWeight: '700', color: palette.ink900 },
  reason: { fontSize: 12, color: palette.ink500, marginTop: 4, fontStyle: 'italic' },
  symptomList: { marginTop: spacing.md, gap: spacing.sm },
  symptomRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.cream100,
  },
  symptomText: { fontSize: 13, color: palette.ink900 },
  symptomMeta: { fontSize: 11, color: palette.ink500, marginTop: 4 },
});
