// Editing a parent. This screen did not exist until 2026-09-01: parent/new was
// the only code path that ever wrote a `parents` row, so every medical detail
// was write-once on mobile. That was survivable while the web app could still
// edit them, and became a hole the moment Halmoni went mobile-only.
//
// Includes dnr_status and healthcare_proxy, which the mirror previously pulled
// from the server and threw away for want of a column to store them in.

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { ChipInput } from '@/components/ui/chip-input';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/field';
import { Screen } from '@/components/ui/screen';
import type { DnrStatus } from '@/lib/parent';
import { useParents } from '@/lib/parent';
import { writeRow } from '@/lib/sync/write-path';
import { palette, radius, spacing } from '@/lib/theme';

const DNR_OPTIONS: { value: DnrStatus; label: string }[] = [
  { value: 'unknown', label: 'Not known' },
  { value: 'no', label: 'Full code' },
  { value: 'yes', label: 'DNR' },
  { value: 'see_document', label: 'See document' },
];

export default function EditParentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { parents } = useParents();
  const parent = parents.find((p) => p.id === id) ?? null;

  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [dob, setDob] = useState('');
  const [bloodType, setBloodType] = useState('');
  const [conditions, setConditions] = useState<string[]>([]);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [preferences, setPreferences] = useState('');
  const [dnr, setDnr] = useState<DnrStatus>('unknown');
  const [proxyName, setProxyName] = useState('');
  const [proxyPhone, setProxyPhone] = useState('');
  const [proxyRelation, setProxyRelation] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!parent) return;
    setName(parent.name ?? '');
    setNickname(parent.nickname ?? '');
    setDob(parent.dob ?? '');
    setBloodType(parent.blood_type ?? '');
    setConditions(parent.conditions ?? []);
    setAllergies(parent.allergies ?? []);
    setPreferences(parent.preferences ?? '');
    setDnr(parent.dnr_status ?? 'unknown');
    setProxyName(parent.healthcare_proxy?.name ?? '');
    setProxyPhone(parent.healthcare_proxy?.phone ?? '');
    setProxyRelation(parent.healthcare_proxy?.relation ?? '');
  }, [parent]);

  if (!parent) {
    return (
      <Screen>
        <EmptyState emoji="🌿" title="Not found" message="That parent no longer exists." />
        <Button title="Back" onPress={() => router.back()} variant="secondary" />
      </Screen>
    );
  }

  async function save() {
    if (!parent || !name.trim()) return;
    if (dob.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(dob.trim())) {
      Alert.alert('Bad date of birth', 'Use YYYY-MM-DD or leave blank.');
      return;
    }
    setSaving(true);
    try {
      // A proxy is only meaningful with a name — storing a phone number with
      // nobody attached to it would be worse than storing nothing.
      const proxy = proxyName.trim()
        ? {
            name: proxyName.trim(),
            phone: proxyPhone.trim(),
            relation: proxyRelation.trim(),
          }
        : null;

      await writeRow('parents', {
        ...parent,
        name: name.trim(),
        nickname: nickname.trim() || name.trim(),
        dob: dob.trim() || null,
        blood_type: bloodType.trim() || null,
        conditions,
        allergies,
        preferences: preferences.trim() || null,
        dnr_status: dnr,
        healthcare_proxy: proxy,
      });
      router.back();
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.heading}>Edit details</Text>
      <Text style={styles.sub}>Everything here is shared with your family.</Text>

      <Field label="Full name" required>
        <Input value={name} onChangeText={setName} placeholder="Eleanor Park" />
      </Field>
      <Field label="Goes by">
        <Input value={nickname} onChangeText={setNickname} placeholder="Mom" />
      </Field>
      <Field label="Date of birth">
        <Input value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" />
      </Field>
      <Field label="Blood type">
        <Input value={bloodType} onChangeText={setBloodType} placeholder="O+" />
      </Field>
      <ChipInput
        label="Conditions"
        placeholder="Add a condition and press enter"
        chips={conditions}
        setChips={setConditions}
      />
      <ChipInput
        label="Allergies"
        placeholder="Add an allergy and press enter"
        chips={allergies}
        setChips={setAllergies}
      />
      <Field label="Preferences">
        <Input
          value={preferences}
          onChangeText={setPreferences}
          placeholder="Anything a stand-in should know."
          multiline
        />
      </Field>

      <Text style={styles.sectionLabel}>IN AN EMERGENCY</Text>
      <Text style={styles.sub}>
        Shown first on the emergency card. Leave as &ldquo;Not known&rdquo; rather than
        guessing — a wrong answer here is worse than no answer.
      </Text>

      <Field label="Resuscitation">
        <View style={styles.dnrRow}>
          {DNR_OPTIONS.map((o) => (
            <Pressable
              key={o.value}
              onPress={() => setDnr(o.value)}
              style={[styles.dnrPill, dnr === o.value && styles.dnrPillActive]}>
              <Text style={[styles.dnrText, dnr === o.value && styles.dnrTextActive]}>
                {o.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Field>

      <Field label="Healthcare proxy — name">
        <Input value={proxyName} onChangeText={setProxyName} placeholder="Who decides for her" />
      </Field>
      <Field label="Healthcare proxy — phone">
        <Input
          value={proxyPhone}
          onChangeText={setProxyPhone}
          placeholder="+44 …"
          keyboardType="phone-pad"
        />
      </Field>
      <Field label="Healthcare proxy — relation">
        <Input value={proxyRelation} onChangeText={setProxyRelation} placeholder="Daughter" />
      </Field>

      <Button title="Save" onPress={save} busy={saving} disabled={!name.trim()} />
      <Button title="Cancel" onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 24, fontWeight: '700', color: palette.ink900 },
  sub: { fontSize: 13, color: palette.ink500, marginBottom: spacing.sm },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.ink500,
    letterSpacing: 1,
    marginTop: spacing.md,
  },
  dnrRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dnrPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: palette.cream100,
  },
  dnrPillActive: { backgroundColor: palette.sage500 },
  dnrText: { fontSize: 13, color: palette.ink700 },
  dnrTextActive: { color: palette.white, fontWeight: '700' },
});
