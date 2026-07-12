import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/field';
import { Screen } from '@/components/ui/screen';
import { useMe } from '@/lib/me';
import { useParents } from '@/lib/parent';
import { supabase } from '@/lib/supabase';
import { palette, radius, spacing } from '@/lib/theme';

const DURATIONS = [
  { label: '4 hours', hours: 4 },
  { label: '12 hours', hours: 12 },
  { label: '1 day', hours: 24 },
  { label: '2 days', hours: 48 },
  { label: '1 week', hours: 24 * 7 },
];

export default function HandoffScreen() {
  const { currentParent } = useParents();
  const { me, siblings } = useMe();
  const others = siblings.filter((s) => s.id !== me?.id);
  const [toId, setToId] = useState<string | null>(others[0]?.id ?? null);
  const [summary, setSummary] = useState('');
  const [personalMessage, setPersonalMessage] = useState('');
  const [hours, setHours] = useState(24);
  const [saving, setSaving] = useState(false);

  if (!currentParent || !me) {
    return (
      <Screen>
        <EmptyState emoji="🌿" title="Not ready" message="Add a parent and finish setup first." />
      </Screen>
    );
  }

  if (others.length === 0) {
    return (
      <Screen>
        <EmptyState
          emoji="🤝"
          title="No one to hand off to"
          message="Invite a sibling on the Family tab first."
        />
        <Button title="Back" onPress={() => router.back()} variant="secondary" />
      </Screen>
    );
  }

  async function send() {
    if (!toId || !summary.trim() || !currentParent || !me) return;
    setSaving(true);
    const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const { error: handoffErr } = await supabase.from('handoffs').insert({
      family_id: currentParent.family_id,
      parent_id: currentParent.id,
      from_member_id: me.id,
      to_member_id: toId,
      summary: summary.trim(),
      personal_message: personalMessage.trim() || null,
      until,
    });
    if (handoffErr) {
      setSaving(false);
      Alert.alert('Could not hand off', handoffErr.message);
      return;
    }
    await supabase.from('on_duty').upsert(
      {
        parent_id: currentParent.id,
        family_id: currentParent.family_id,
        member_id: toId,
        until,
      },
      { onConflict: 'parent_id' },
    );
    setSaving(false);
    router.back();
  }

  return (
    <Screen>
      <Card>
        <Text style={styles.sectionLabel}>HAND OFF TO</Text>
        <View style={styles.peopleRow}>
          {others.map((s) => {
            const selected = toId === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => setToId(s.id)}
                style={[styles.personCard, selected && styles.personCardActive]}>
                <Avatar name={s.name} color={s.color} size={36} />
                <Text style={styles.personName}>{s.name}</Text>
                {s.relation && <Text style={styles.personSub}>{s.relation}</Text>}
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card>
        <Field label="Summary" required>
          <Input
            value={summary}
            onChangeText={setSummary}
            placeholder="What they need to know to step in."
            multiline
            autoFocus
          />
        </Field>
        <View style={{ height: spacing.md }} />
        <Field label="Personal message">
          <Input
            value={personalMessage}
            onChangeText={setPersonalMessage}
            placeholder="Anything you'd say to them in person."
            multiline
          />
        </Field>
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>UNTIL</Text>
        <View style={styles.durationRow}>
          {DURATIONS.map((d) => (
            <Pressable
              key={d.hours}
              onPress={() => setHours(d.hours)}
              style={[styles.durPill, hours === d.hours && styles.durPillActive]}>
              <Text style={[styles.durText, hours === d.hours && styles.durTextActive]}>
                {d.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Button
        title="Hand off"
        onPress={send}
        disabled={!toId || !summary.trim()}
        busy={saving}
      />
      <Button title="Cancel" onPress={() => router.back()} variant="secondary" />
    </Screen>
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
  peopleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  personCard: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.cream200,
    backgroundColor: palette.white,
    minWidth: 90,
  },
  personCardActive: { borderColor: palette.sage500, backgroundColor: palette.sage50 },
  personName: { fontSize: 13, fontWeight: '600', color: palette.ink900 },
  personSub: { fontSize: 11, color: palette.ink500 },
  durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  durPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: palette.cream200,
  },
  durPillActive: { backgroundColor: palette.sage500 },
  durText: { fontSize: 12, fontWeight: '600', color: palette.ink700 },
  durTextActive: { color: palette.white },
});
