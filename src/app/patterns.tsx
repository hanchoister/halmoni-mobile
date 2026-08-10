import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen } from '@/components/ui/screen';
import { list } from '@/lib/db/repository';
import { useDataVersion } from '@/lib/db/signal';
import { analyzeSymptoms, isKnownMed, type Finding, type FindingTier } from '@/lib/detective';
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

const TIER_LABEL: Record<FindingTier, string> = {
  urgent: 'Call the doctor today',
  high: 'Mention at the next visit',
  low: 'Weak timing overlap',
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
      `Mark not related to ${medName}?`,
      'This will hide this symptom from the detective. Use after you\'ve discussed it with the doctor.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark reviewed',
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
        <EmptyState emoji="🌿" title="No parent yet" message="Add a parent first." />
      </Screen>
    );
  }

  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <Card tint="cream">
        <Text style={styles.disclaimer}>
          These are timing patterns, not medical advice. Halmoni flags symptoms that were logged
          near the start of a medication or linked to it by someone in the family. The doctor is
          the one who can tell you whether a match is real.
        </Text>
      </Card>

      {findings.length === 0 ? (
        <EmptyState
          emoji="🌿"
          title="No possible patterns"
          message="Nothing to review right now. Log symptoms as you notice them and they'll be matched here."
        />
      ) : (
        findings.map((f) => {
          const inKb = isKnownMed(f.medName);
          const tone: 'warm' | undefined =
            f.tier === 'urgent' || f.tier === 'high' ? 'warm' : undefined;
          return (
            <Card
              key={f.medId}
              tint={tone}
              style={
                f.tier === 'urgent'
                  ? { borderColor: palette.terracotta600, borderWidth: 2 }
                  : undefined
              }>
              <Pressable onPress={() => router.push(`/medication/${f.medId}`)}>
                <Text style={styles.tierLabel}>{TIER_LABEL[f.tier]}</Text>
                <Text style={styles.medName}>{f.medName}</Text>
                <Text style={styles.reason}>
                  {inKb
                    ? f.tier === 'low'
                      ? 'Timing overlap — but the symptoms below aren\'t established side effects.'
                      : f.tier === 'high'
                      ? 'Matches known side effects for this medication.'
                      : 'Matches a serious side effect. Contact the doctor promptly.'
                    : 'Timing overlap — no side-effect data for this medication in Halmoni.'}
                </Text>
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
                        {s.matchedKeyword ? ` · matches "${s.matchedKeyword}"` : ''}
                        {s.environmentalContext
                          ? ` · noted with "${s.environmentalContext}"`
                          : ''}
                      </Text>
                    </View>
                    <Button
                      title="Not related"
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
