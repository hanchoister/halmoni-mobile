import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { ChipInput } from '@/components/ui/chip-input';
import { Field, Input } from '@/components/ui/field';
import { Screen } from '@/components/ui/screen';
import { useFamily } from '@/lib/family';
import { newId } from '@/lib/newid';
import { writeRow } from '@/lib/sync/write-path';
import { palette, spacing } from '@/lib/theme';

export default function AddParentScreen() {
  const { familyId } = useFamily();
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [dob, setDob] = useState('');
  const [bloodType, setBloodType] = useState('');
  const [conditions, setConditions] = useState<string[]>([]);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [preferences, setPreferences] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!familyId || !name.trim()) return;
    if (dob.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(dob.trim())) {
      Alert.alert('Bad date of birth', 'Use YYYY-MM-DD or leave blank.');
      return;
    }
    setSaving(true);
    try {
      await writeRow('parents', {
        id: newId(),
        family_id: familyId,
        name: name.trim(),
        nickname: nickname.trim() || name.trim(),
        dob: dob.trim() || null,
        blood_type: bloodType.trim() || null,
        conditions,
        allergies,
        preferences: preferences.trim() || null,
        ice_contacts: [],
        created_at: new Date().toISOString(),
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
      <Text style={styles.heading}>Add a parent</Text>
      <Text style={styles.sub}>The person you&apos;re caring for together.</Text>

      <Field label="Full name" required>
        <Input value={name} onChangeText={setName} placeholder="Eleanor Park" autoFocus />
      </Field>

      <Field label="Nickname (what your family calls them)">
        <Input value={nickname} onChangeText={setNickname} placeholder="Mom" />
      </Field>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field label="Date of birth">
            <Input value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Blood type">
            <Input value={bloodType} onChangeText={setBloodType} placeholder="O+" />
          </Field>
        </View>
      </View>

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

      <Field label="What to know about them">
        <Input
          value={preferences}
          onChangeText={setPreferences}
          placeholder="Personality, preferences, things to remember…"
          multiline
        />
      </Field>

      <Button title="Save parent" onPress={save} disabled={!name.trim()} busy={saving} />
      <Button title="Cancel" onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 22, fontWeight: '800', color: palette.ink900 },
  sub: { fontSize: 13, color: palette.ink500, marginTop: -spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md },
});
