import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { analyzeSymptoms, type Finding } from '@/lib/detective';
import { daysBetween, formatDateShort } from '@/lib/format';
import { palette, spacing } from '@/lib/theme';

type Med = {
  id: string;
  name: string;
  refill_by: string | null;
  started_at: string | null;
};

type Symptom = {
  id: string;
  description: string;
  observed_at: string;
  possible_med_links?: string[] | null;
};

type Handoff = {
  id: string;
  from_member_id: string | null;
  to_member_id: string;
  summary: string;
  personal_message: string | null;
  accepted_at: string | null;
};

type Sibling = { id: string; name: string };

type Item =
  | { key: string; kind: 'refill'; medName: string; daysLeft: number }
  | { key: string; kind: 'finding'; finding: Finding }
  | {
      key: string;
      kind: 'handoff';
      handoffId: string;
      from: string;
      summary: string;
      personalMessage: string | null;
    };

export function HeadsUp({
  meds,
  symptoms,
  handoffs,
  siblings,
  meId,
  onAcceptHandoff,
}: {
  meds: Med[];
  symptoms: Symptom[];
  handoffs: Handoff[];
  siblings: Sibling[];
  meId: string | null;
  onAcceptHandoff: (handoffId: string) => Promise<void>;
}) {
  const nowIso = new Date().toISOString();
  const items: Item[] = [];

  handoffs
    .filter((h) => h.to_member_id === meId && !h.accepted_at)
    .forEach((h) => {
      const from = siblings.find((s) => s.id === h.from_member_id)?.name ?? 'A sibling';
      items.push({
        key: `ho-${h.id}`,
        kind: 'handoff',
        handoffId: h.id,
        from,
        summary: h.summary,
        personalMessage: h.personal_message,
      });
    });

  meds.forEach((m) => {
    if (!m.refill_by) return;
    const days = daysBetween(nowIso, m.refill_by);
    if (days <= 7) {
      items.push({
        key: `refill-${m.id}`,
        kind: 'refill',
        medName: m.name,
        daysLeft: days,
      });
    }
  });

  const findings = analyzeSymptoms(meds, symptoms);
  const urgentFindings = findings.filter((f) => f.tier === 'urgent');
  const highFindings = findings.filter((f) => f.tier === 'high');
  const lowFindings = findings.filter((f) => f.tier === 'low');

  const rankedFindings = [...urgentFindings, ...highFindings];
  rankedFindings.forEach((f) => {
    items.push({ key: `find-${f.medId}`, kind: 'finding', finding: f });
  });

  const nothingUrgent = items.length === 0;

  if (nothingUrgent && lowFindings.length === 0) {
    return (
      <Card>
        <Text style={styles.sectionLabel}>HEADS UP</Text>
        <Text style={styles.quiet}>
          All quiet — no urgent refills, side effects, or pending hand-offs.
        </Text>
      </Card>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.groupLabel}>HEADS UP</Text>
      {nothingUrgent && (
        <Card>
          <Text style={styles.quiet}>
            All quiet — no urgent refills, side effects, or pending hand-offs.
          </Text>
        </Card>
      )}
      {items.slice(0, 4).map((it) => {
        if (it.kind === 'refill') {
          return (
            <Card key={it.key} tint="warm">
              <Pressable
                onPress={() => router.push('/(tabs)/meds')}
                style={styles.row}>
                <Text style={styles.emoji}>🔄</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>
                    {it.medName} runs out{' '}
                    {it.daysLeft <= 0
                      ? 'today'
                      : it.daysLeft === 1
                        ? 'tomorrow'
                        : `in ${it.daysLeft} days`}
                  </Text>
                  <Text style={styles.hint}>Refill at the pharmacy or have it delivered.</Text>
                </View>
              </Pressable>
            </Card>
          );
        }
        if (it.kind === 'finding') {
          const f = it.finding;
          const isUrgent = f.tier === 'urgent';
          const emoji = isUrgent ? '🚨' : '📝';
          const title = isUrgent
            ? `Call the doctor today about ${f.medName}`
            : `Mention at the next ${f.medName} visit`;
          return (
            <Card
              key={it.key}
              tint="warm"
              style={isUrgent ? { borderColor: palette.terracotta600, borderWidth: 2 } : undefined}>
              <View style={styles.row}>
                <Text style={styles.emoji}>{emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{title}</Text>
                  {f.symptoms.slice(0, 3).map((s) => (
                    <Text key={s.id} style={styles.hint}>
                      · &ldquo;{s.description}&rdquo; ({formatDateShort(s.observedAt)}
                      {s.daysAfter != null
                        ? `, ${s.daysAfter} day${s.daysAfter === 1 ? '' : 's'} after starting`
                        : ''}
                      {s.matchedKeyword ? ` · matches known "${s.matchedKeyword}"` : ''}
                      )
                    </Text>
                  ))}
                  {f.symptoms.length > 3 && (
                    <Text style={styles.hint}>· +{f.symptoms.length - 3} more</Text>
                  )}
                </View>
              </View>
            </Card>
          );
        }
        return (
          <Card key={it.key} tint="sage">
            <View style={{ gap: spacing.sm }}>
              <View style={styles.row}>
                <Text style={styles.emoji}>💬</Text>
                <Text style={styles.title}>Hand-off from {it.from}</Text>
              </View>
              <Text style={styles.body}>{it.summary}</Text>
              {it.personalMessage && (
                <Text style={styles.italic}>&ldquo;{it.personalMessage}&rdquo;</Text>
              )}
              <Button
                title="Got it — I've got them"
                onPress={async () => {
                  try {
                    await onAcceptHandoff(it.handoffId);
                  } catch (e: any) {
                    Alert.alert('Could not accept', e?.message ?? 'Unknown error.');
                  }
                }}
              />
            </View>
          </Card>
        );
      })}
      {lowFindings.length > 0 && (
        <Pressable onPress={() => router.push('/patterns')} style={styles.patternsLink}>
          <Text style={styles.patternsText}>
            See {lowFindings.length} possible pattern{lowFindings.length === 1 ? '' : 's'} →
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.ink500,
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  groupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.ink500,
    letterSpacing: 1,
    paddingHorizontal: 4,
  },
  quiet: { fontSize: 13, color: palette.ink500 },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  emoji: { fontSize: 22 },
  title: { fontSize: 14, fontWeight: '700', color: palette.ink900 },
  hint: { fontSize: 12, color: palette.ink500, marginTop: 4, lineHeight: 16 },
  body: { fontSize: 13, color: palette.ink700, lineHeight: 18 },
  italic: { fontSize: 12, color: palette.sage700, fontStyle: 'italic' },
  patternsLink: { paddingVertical: spacing.sm, paddingHorizontal: 4 },
  patternsText: { fontSize: 13, color: palette.sage600, fontWeight: '600' },
});
