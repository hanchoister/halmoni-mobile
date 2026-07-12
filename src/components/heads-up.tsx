import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { daysBetween } from '@/lib/format';
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
  | {
      key: string;
      kind: 'detective';
      medName: string;
      count: number;
      sampleDesc: string;
      firstDaysAfter: number;
    }
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

  // Pending hand-offs come first — they need immediate action from the caregiver.
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

  // Refills within a week.
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

  // Aggregate symptoms per med: one detective card per suspect med with a count,
  // rather than one card per symptom (which drowned out other headlines).
  const detectiveByMed = new Map<
    string,
    { medName: string; count: number; sampleDesc: string; firstDaysAfter: number }
  >();
  symptoms.forEach((s) => {
    const link = meds.find((m) => {
      if (!m.started_at) return false;
      const d = daysBetween(m.started_at, s.observed_at);
      return d >= 0 && d <= 14;
    });
    if (!link || !link.started_at) return;
    const daysAfter = daysBetween(link.started_at, s.observed_at);
    const existing = detectiveByMed.get(link.id);
    if (existing) {
      existing.count += 1;
      if (daysAfter < existing.firstDaysAfter) {
        existing.firstDaysAfter = daysAfter;
      }
    } else {
      detectiveByMed.set(link.id, {
        medName: link.name,
        count: 1,
        sampleDesc: s.description,
        firstDaysAfter: daysAfter,
      });
    }
  });
  for (const [medId, det] of detectiveByMed) {
    items.push({
      key: `det-${medId}`,
      kind: 'detective',
      medName: det.medName,
      count: det.count,
      sampleDesc: det.sampleDesc,
      firstDaysAfter: det.firstDaysAfter,
    });
  }

  if (items.length === 0) {
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
        if (it.kind === 'detective') {
          return (
            <Card key={it.key} tint="warm">
              <View style={styles.row}>
                <Text style={styles.emoji}>✨</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>
                    Possible side effect — could {it.medName} be the cause?
                  </Text>
                  <Text style={styles.hint}>
                    {it.count} symptom{it.count === 1 ? '' : 's'} logged since starting{' '}
                    {it.medName} {it.firstDaysAfter} day
                    {it.firstDaysAfter === 1 ? '' : 's'} ago — e.g. &ldquo;{it.sampleDesc}
                    &rdquo;.
                  </Text>
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
});
