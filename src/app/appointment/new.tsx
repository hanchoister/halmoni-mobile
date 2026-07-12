import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Screen } from '@/components/ui/screen';
import { useParents } from '@/lib/parent';
import { supabase } from '@/lib/supabase';
import { palette, spacing } from '@/lib/theme';

export default function AddAppointmentScreen() {
  const { currentParent } = useParents();
  const [providerName, setProviderName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [durationMin, setDurationMin] = useState('30');
  const [prepNotes, setPrepNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!currentParent || !providerName.trim() || !date.trim()) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      Alert.alert('Bad date', 'Use YYYY-MM-DD.');
      return;
    }
    const t = (time || '09:00').trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) {
      Alert.alert('Bad time', 'Use 24-hour HH:MM.');
      return;
    }
    const parsed = new Date(`${date.trim()}T${t}`);
    if (Number.isNaN(parsed.getTime())) {
      Alert.alert('Bad date/time', 'Please double-check the date.');
      return;
    }
    setSaving(true);
    const startsAt = parsed.toISOString();
    const { error } = await supabase.from('appointments').insert({
      parent_id: currentParent.id,
      family_id: currentParent.family_id,
      provider_name: providerName.trim(),
      specialty: specialty.trim() || null,
      location: location.trim() || null,
      starts_at: startsAt,
      duration_min: Number(durationMin) || 30,
      status: 'upcoming',
      prep_notes: prepNotes.trim() || null,
    });
    setSaving(false);
    if (error) {
      Alert.alert('Could not save', error.message);
      return;
    }
    router.back();
  }

  return (
    <Screen>
      <Text style={styles.heading}>Add appointment</Text>

      <Field label="Provider" required>
        <Input value={providerName} onChangeText={setProviderName} placeholder="Dr. Patel" autoFocus />
      </Field>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field label="Specialty">
            <Input value={specialty} onChangeText={setSpecialty} placeholder="Cardiology" />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Location">
            <Input value={location} onChangeText={setLocation} placeholder="Clinic or address" />
          </Field>
        </View>
      </View>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field label="Date" required>
            <Input value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Time">
            <Input value={time} onChangeText={setTime} placeholder="HH:MM" />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Min">
            <Input
              value={durationMin}
              onChangeText={setDurationMin}
              placeholder="30"
              keyboardType="number-pad"
            />
          </Field>
        </View>
      </View>

      <Field label="Prep notes">
        <Input
          value={prepNotes}
          onChangeText={setPrepNotes}
          placeholder="What to ask, what to bring."
          multiline
        />
      </Field>

      <Button
        title="Save appointment"
        onPress={save}
        disabled={!providerName.trim() || !date.trim()}
        busy={saving}
      />
      <Button title="Cancel" onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 22, fontWeight: '800', color: palette.ink900 },
  row: { flexDirection: 'row', gap: spacing.md },
});
