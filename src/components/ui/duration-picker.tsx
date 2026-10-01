// Pick a duration as a number plus a unit — "1 hr", "45 min", "2 days".
//
// Replaces a row of fixed chips. Chips were quicker to build and quietly
// decided for the caregiver what a reasonable reminder time is: if 45 minutes
// before a dose is what works for your mother's routine, a row of 15/30/60
// cannot say it.
//
// Built from a Modal and two lists rather than @react-native-picker/picker.
// That package would mean a native module, a pod install and a full rebuild —
// and this app's native toolchain has already cost a day this week — for a
// control that is two scrolling lists and a button. It also lets the picker
// match the rest of the app instead of looking like a system sheet dropped
// into it.

import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { color, palette, radius, spacing, typography } from '@/lib/theme';

export type DurationUnit = 'min' | 'hrs' | 'days' | 'weeks';

export const UNIT_MINUTES: Record<DurationUnit, number> = {
  min: 1,
  hrs: 60,
  days: 1440,
  weeks: 10080,
};

/** Numbers offered per unit. Bounded by what is sane, not by what is possible. */
const NUMBERS: Record<DurationUnit, number[]> = {
  min: [5, 10, 15, 20, 30, 45],
  hrs: [1, 2, 3, 4, 6, 8, 12],
  days: [1, 2, 3, 4, 5, 6, 7, 10, 14],
  weeks: [1, 2, 3, 4],
};

/** Largest sensible unit for a given number of minutes, for display. */
export function splitDuration(mins: number): { value: number; unit: DurationUnit } {
  if (mins % UNIT_MINUTES.weeks === 0 && mins >= UNIT_MINUTES.weeks) {
    return { value: mins / UNIT_MINUTES.weeks, unit: 'weeks' };
  }
  if (mins % UNIT_MINUTES.days === 0 && mins >= UNIT_MINUTES.days) {
    return { value: mins / UNIT_MINUTES.days, unit: 'days' };
  }
  if (mins % 60 === 0 && mins >= 60) return { value: mins / 60, unit: 'hrs' };
  return { value: mins, unit: 'min' };
}

export function formatDuration(mins: number): string {
  const { value, unit } = splitDuration(mins);
  if (unit === 'min') return `${value} min`;
  if (unit === 'hrs') return value === 1 ? '1 hr' : `${value} hrs`;
  if (unit === 'days') return value === 1 ? '1 day' : `${value} days`;
  return value === 1 ? '1 week' : `${value} weeks`;
}

export function DurationPicker({
  visible,
  units,
  title,
  onCancel,
  onAdd,
}: {
  visible: boolean;
  /** Which units make sense here. Refills are dated, so minutes are nonsense. */
  units: DurationUnit[];
  title: string;
  onCancel: () => void;
  onAdd: (minutes: number) => void;
}) {
  const [unit, setUnit] = useState<DurationUnit>(units[0]);
  const [value, setValue] = useState<number>(NUMBERS[units[0]][0]);

  // Changing the unit has to move the number to one that exists for it, or
  // "45" would survive a switch to days and offer a 45-day reminder.
  function pickUnit(next: DurationUnit) {
    setUnit(next);
    if (!NUMBERS[next].includes(value)) setValue(NUMBERS[next][0]);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        <Text style={styles.title}>{title}</Text>

        <Text style={styles.label}>HOW MANY</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip}>
          <View style={styles.stripRow}>
            {NUMBERS[unit].map((n) => (
              <Pressable
                key={n}
                onPress={() => setValue(n)}
                accessibilityRole="button"
                accessibilityState={{ selected: value === n }}
                style={[styles.cell, value === n && styles.cellOn]}>
                <Text style={[styles.cellText, value === n && styles.cellTextOn]}>{n}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <Text style={styles.label}>UNIT</Text>
        <View style={styles.unitRow}>
          {units.map((u) => (
            <Pressable
              key={u}
              onPress={() => pickUnit(u)}
              accessibilityRole="button"
              accessibilityState={{ selected: unit === u }}
              style={[styles.unit, unit === u && styles.unitOn]}>
              <Text style={[styles.unitText, unit === u && styles.unitTextOn]}>{u}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.preview}>{formatDuration(value * UNIT_MINUTES[unit])} before</Text>

        <Button title="Add" onPress={() => onAdd(value * UNIT_MINUTES[unit])} />
        <View style={{ height: spacing.xs }} />
        <Button title="Cancel" onPress={onCancel} variant="ghost" />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(34,31,27,0.35)' },
  sheet: {
    backgroundColor: palette.cream50,
    padding: spacing.lg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  title: { ...typography.title, fontSize: 18, marginBottom: spacing.md },
  label: {
    ...typography.meta,
    fontSize: 11,
    letterSpacing: 1.2,
    color: palette.sage700,
    marginBottom: spacing.xs,
  },
  strip: { marginBottom: spacing.md },
  stripRow: { flexDirection: 'row', gap: spacing.xs },
  cell: {
    minWidth: 54,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.sage300,
    alignItems: 'center',
  },
  cellOn: { backgroundColor: color.confirm, borderColor: color.confirm },
  cellText: { ...typography.body, fontSize: 16, color: palette.ink700 },
  cellTextOn: { color: palette.cream50, fontWeight: '700' },
  unitRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  unit: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.sage300,
    alignItems: 'center',
  },
  unitOn: { backgroundColor: color.confirm, borderColor: color.confirm },
  unitText: { ...typography.body, fontSize: 14, color: palette.ink700 },
  unitTextOn: { color: palette.cream50, fontWeight: '600' },
  preview: {
    ...typography.meta,
    fontSize: 13,
    color: palette.sage700,
    marginBottom: spacing.md,
  },
});
