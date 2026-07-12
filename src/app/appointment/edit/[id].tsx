import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Screen } from '@/components/ui/screen';
import { supabase } from '@/lib/supabase';
import { palette, spacing } from '@/lib/theme';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export default function EditAppointmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [providerName, setProviderName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [durationMin, setDurationMin] = useState('30');
  const [prepNotes, setPrepNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) return;
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error || !data) {
        Alert.alert('Could not load appointment', error?.message ?? 'Not found.');
        setLoading(false);
        return;
      }
      setProviderName(data.provider_name ?? '');
      setSpecialty(data.specialty ?? '');
      setLocation(data.location ?? '');
      const d = new Date(data.starts_at);
      setDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
      setTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
      setDurationMin(String(data.duration_min ?? 30));
      setPrepNotes(data.prep_notes ?? '');
      setLoading(false);
    })();
  }, [id]);

  async function save() {
    if (!id || !providerName.trim() || !date.trim()) return;
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
    const { error } = await supabase
      .from('appointments')
      .update({
        provider_name: providerName.trim(),
        specialty: specialty.trim() || null,
        location: location.trim() || null,
        starts_at: parsed.toISOString(),
        duration_min: Number(durationMin) || 30,
        prep_notes: prepNotes.trim() || null,
      })
      .eq('id', id);
    setSaving(false);
    if (error) {
      Alert.alert('Could not save', error.message);
      return;
    }
    router.back();
  }

  if (loading) {
    return (
      <Screen>
        <Text>Loading…</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.heading}>Edit appointment</Text>

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
        title="Save changes"
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
