import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { analyzeSymptoms, type Finding } from '@/lib/detective';
import { daysBetween, formatDateShort } from '@/lib/format';
import { Icon, IconName } from '@/components/ui/icon';
import { color, palette, spacing, typography } from '@/lib/theme';

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

function Eyebrow({ tone, label, icon }: { tone: string; label: string; icon?: IconName }) {
  return (
    <View style={styles.eyebrow}>
      {icon ? (
        <Icon name={icon} size={13} color={tone} strokeWidth={2.1} />
      ) : (
        <View style={[styles.dot, { backgroundColor: tone }]} />
      )}
      <Text style={[styles.eyebrowText, { color: tone }]}>{label}</Text>
    </View>
  );
}

export function HeadsUp({
  meds,
  symptoms,
  handoffs,
  siblings,
  meId,
  dismissedFindings,
  onAcceptHandoff,
}: {
  meds: Med[];
  symptoms: Symptom[];
  handoffs: Handoff[];
  siblings: Sibling[];
  meId: string | null;
  dismissedFindings?: Set<string>;
  onAcceptHandoff: (handoffId: string) => Promise<void>;
}) {
  const nowIso = new Date().toISOString();

  // Urgent findings lead everything else — safety first, before handoffs and refills.
  const findings = analyzeSymptoms(meds, symptoms, dismissedFindings);
  const urgentFindings = findings.filter((f) => f.tier === 'urgent');
  const highFindings = findings.filter((f) => f.tier === 'high');
  const lowFindings = findings.filter((f) => f.tier === 'low');

  const items: Item[] = [];

  urgentFindings.forEach((f) => {
    items.push({ key: `find-${f.medId}`, kind: 'finding', finding: f });
  });

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

  highFindings.forEach((f) => {
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
              <Pressable onPress={() => router.push('/(tabs)/meds')}>
                <Eyebrow tone={color.accent} label="NEEDS YOU" icon="meds" />
                <Text style={styles.title}>
                  {it.medName} runs out{' '}
                  {it.daysLeft <= 0
                    ? 'today'
                    : it.daysLeft === 1
                      ? 'tomorrow'
                      : `in ${it.daysLeft} days`}
                </Text>
                <Text style={styles.hint}>Refill at the pharmacy, or have it delivered.</Text>
              </Pressable>
            </Card>
          );
        }
        if (it.kind === 'finding') {
          const f = it.finding;
          const isUrgent = f.tier === 'urgent';
          const title = isUrgent
            ? `Call the doctor today about ${f.medName}`
            : `Mention at the next ${f.medName} visit`;
          return (
            <Card
              key={it.key}
              tint="warm"
              style={isUrgent ? { borderColor: palette.terracotta600, borderWidth: 2 } : undefined}>
              <Pressable onPress={() => router.push(`/medication/${f.medId}`)}>
                <Eyebrow
                  tone={color.accent}
                  label={isUrgent ? 'CALL TODAY' : 'WORTH ASKING ABOUT'}
                  icon={isUrgent ? 'alert' : undefined}
                />
                <View>
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
              </Pressable>
            </Card>
          );
        }
        return (
          <Card key={it.key} tint="sage">
            <View style={{ gap: spacing.sm }}>
              <View>
                <Eyebrow tone={color.onConfirmSoft} label={`HAND-OFF FROM ${it.from.toUpperCase()}`} />
                <Text style={styles.title}>Over to you</Text>
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
  sectionLabel: { ...typography.label, color: color.textMuted, marginBottom: spacing.sm },
  groupLabel: { ...typography.label, color: color.textFaint, paddingHorizontal: 4 },
  quiet: { ...typography.meta, color: color.textMuted },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3 },
  eyebrowText: { ...typography.label, fontSize: 10 },
  // The headline is the serif. These cards are the app talking to you about
  // your mother — the one place a display face earns its keep.
  title: { ...typography.displaySm, color: color.text },
  hint: { ...typography.meta, color: color.textMuted, marginTop: 5 },
  body: { ...typography.body, color: color.text },
  italic: {
    ...typography.meta,
    fontFamily: undefined,
    color: color.onConfirmSoft,
    fontStyle: 'italic',
  },
  patternsLink: { paddingVertical: spacing.sm, paddingHorizontal: 4 },
  patternsText: { ...typography.bodyStrong, fontSize: 13, color: color.accent },
});
