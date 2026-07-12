import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Screen } from '@/components/ui/screen';
import { supabase } from '@/lib/supabase';
import { palette, radius, spacing } from '@/lib/theme';

type Schedule = { time: string; withFood?: boolean };

export default function EditMedicationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [purpose, setPurpose] = useState('');
  const [times, setTimes] = useState<string[]>([]);
  const [timeInput, setTimeInput] = useState('');
  const [withFood, setWithFood] = useState(false);
  const [prescriber, setPrescriber] = useState('');
  const [pharmacy, setPharmacy] = useState('');
  const [refillBy, setRefillBy] = useState('');
  const [pillsLeft, setPillsLeft] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) return;
      const { data, error } = await supabase
        .from('medications')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error || !data) {
        Alert.alert('Could not load medication', error?.message ?? 'Not found.');
        setLoading(false);
        return;
      }
      setName(data.name ?? '');
      setDose(data.dose ?? '');
      setPurpose(data.purpose ?? '');
      const sched = (data.schedule ?? []) as Schedule[];
      setTimes(sched.map((s) => s.time));
      setWithFood(sched.some((s) => s.withFood));
      setPrescriber(data.prescriber ?? '');
      setPharmacy(data.pharmacy ?? '');
      setRefillBy(data.refill_by ?? '');
      setPillsLeft(data.pills_left != null ? String(data.pills_left) : '');
      setNotes(data.notes ?? '');
      setLoading(false);
    })();
  }, [id]);

  function addTime() {
    const v = timeInput.trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
      Alert.alert('Bad time', 'Use 24-hour HH:MM, e.g. 08:00 or 20:30.');
      return;
    }
    if (times.includes(v)) {
      setTimeInput('');
      return;
    }
    setTimes([...times, v].sort());
    setTimeInput('');
  }

  async function save() {
    if (!id || !name.trim() || times.length === 0) return;
    if (refillBy.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(refillBy.trim())) {
      Alert.alert('Bad refill date', 'Use YYYY-MM-DD or leave blank.');
      return;
    }
    setSaving(true);
    const schedule = times.map((t) => ({ time: t, withFood: withFood || undefined }));
    const { error } = await supabase
      .from('medications')
      .update({
        name: name.trim(),
        dose: dose.trim() || null,
        purpose: purpose.trim() || null,
        schedule,
        prescriber: prescriber.trim() || null,
        pharmacy: pharmacy.trim() || null,
        refill_by: refillBy.trim() || null,
        pills_left: pillsLeft ? parseInt(pillsLeft, 10) : null,
        notes: notes.trim() || null,
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
      <Text style={styles.heading}>Edit medication</Text>
      <Text style={styles.warn}>
        Changing the schedule does not update dose rows already created. Delete and re-add if you
        need a fresh schedule.
      </Text>

      <Field label="Name" required>
        <Input value={name} onChangeText={setName} placeholder="Lisinopril" autoFocus />
      </Field>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field label="Dose / strength">
            <Input value={dose} onChangeText={setDose} placeholder="10 mg tablet" />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="What it's for">
            <Input value={purpose} onChangeText={setPurpose} placeholder="Blood pressure" />
          </Field>
        </View>
      </View>

      <Field label="Times" required>
        <View style={styles.chipRow}>
          {times.map((t) => (
            <Pressable
              key={t}
              onPress={() => setTimes(times.filter((x) => x !== t))}
              style={styles.chip}>
              <Text style={styles.chipText}>{t} ✕</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Input
              value={timeInput}
              onChangeText={setTimeInput}
              placeholder="HH:MM"
              onSubmitEditing={addTime}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <Button title="Add time" variant="secondary" onPress={addTime} />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Take with food</Text>
          <Switch value={withFood} onValueChange={setWithFood} />
        </View>
      </Field>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field label="Prescriber">
            <Input value={prescriber} onChangeText={setPrescriber} placeholder="Dr. Patel" />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Pharmacy">
            <Input value={pharmacy} onChangeText={setPharmacy} placeholder="CVS Main St" />
          </Field>
        </View>
      </View>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field label="Refill by">
            <Input value={refillBy} onChangeText={setRefillBy} placeholder="YYYY-MM-DD" />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Pills left">
            <Input
              value={pillsLeft}
              onChangeText={setPillsLeft}
              placeholder="30"
              keyboardType="number-pad"
            />
          </Field>
        </View>
      </View>

      <Field label="Notes">
        <Input value={notes} onChangeText={setNotes} placeholder="Anything to remember…" multiline />
      </Field>

      <Button
        title="Save changes"
        onPress={save}
        disabled={!name.trim() || times.length === 0}
        busy={saving}
      />
      <Button title="Cancel" onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 22, fontWeight: '800', color: palette.ink900 },
  warn: {
    fontSize: 12,
    color: palette.ink500,
    marginTop: -spacing.sm,
    fontStyle: 'italic',
  },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-end' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  chip: {
    backgroundColor: palette.cream200,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { fontSize: 12, color: palette.ink900 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 8 },
  switchLabel: { fontSize: 13, color: palette.ink700 },
});
