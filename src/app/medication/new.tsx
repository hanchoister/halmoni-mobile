import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Screen } from '@/components/ui/screen';
import { useParents } from '@/lib/parent';
import { supabase } from '@/lib/supabase';
import { palette, radius, spacing } from '@/lib/theme';

export default function AddMedicationScreen() {
  const { currentParent } = useParents();
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [purpose, setPurpose] = useState('');
  const [times, setTimes] = useState<string[]>(['08:00']);
  const [timeInput, setTimeInput] = useState('');
  const [withFood, setWithFood] = useState(false);
  const [prescriber, setPrescriber] = useState('');
  const [pharmacy, setPharmacy] = useState('');
  const [refillBy, setRefillBy] = useState('');
  const [pillsLeft, setPillsLeft] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

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

  function buildDoseRows(medId: string, familyId: string, schedule: { time: string }[]) {
    const rows: Record<string, unknown>[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let dayOffset = 0; dayOffset < 90; dayOffset++) {
      const day = new Date(today);
      day.setDate(today.getDate() + dayOffset);
      for (const slot of schedule) {
        const [h, m] = slot.time.split(':').map((n) => parseInt(n, 10));
        const sched = new Date(day);
        sched.setHours(h, m, 0, 0);
        rows.push({
          family_id: familyId,
          medication_id: medId,
          scheduled_at: sched.toISOString(),
          given_at: null,
          given_by_member_id: null,
          skipped: false,
          skip_reason: null,
        });
      }
    }
    return rows;
  }

  async function save() {
    if (!currentParent || !name.trim() || times.length === 0) return;
    if (refillBy.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(refillBy.trim())) {
      Alert.alert('Bad refill date', 'Use YYYY-MM-DD or leave blank.');
      return;
    }
    setSaving(true);
    const schedule = times.map((t) => ({ time: t, withFood: withFood || undefined }));
    const today = new Date().toISOString().slice(0, 10);
    const { data: med, error } = await supabase
      .from('medications')
      .insert({
        parent_id: currentParent.id,
        family_id: currentParent.family_id,
        name: name.trim(),
        dose: dose.trim() || null,
        purpose: purpose.trim() || null,
        schedule,
        prescriber: prescriber.trim() || null,
        pharmacy: pharmacy.trim() || null,
        refill_by: refillBy.trim() || null,
        pills_left: pillsLeft ? parseInt(pillsLeft, 10) : null,
        notes: notes.trim() || null,
        started_at: today,
      })
      .select('id')
      .single();
    if (error || !med) {
      setSaving(false);
      Alert.alert('Could not save', error?.message ?? 'Unknown error.');
      return;
    }
    const doseRows = buildDoseRows(med.id as string, currentParent.family_id, schedule);
    const { error: doseErr } = await supabase.from('med_doses').insert(doseRows);
    setSaving(false);
    if (doseErr) {
      Alert.alert('Saved med, but doses failed', doseErr.message);
      return;
    }
    router.back();
  }

  return (
    <Screen>
      <Text style={styles.heading}>Add a medication</Text>

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
        <Input
          value={notes}
          onChangeText={setNotes}
          placeholder="Anything to remember…"
          multiline
        />
      </Field>

      <Button
        title="Save medication"
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
