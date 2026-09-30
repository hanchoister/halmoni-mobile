// Notification settings. Unlike diagnostics, this screen IS for caregivers —
// it is reachable from Account as an ordinary row.
//
// The thing it has to get across, in a screen nobody wants to spend time on:
// "only my shifts" does not mean you can miss a dose. If nobody has taken the
// shift, everyone is still told. Families forget to hand over constantly — far
// more often than they forget the pill — and a setting that turned a forgotten
// hand-over into silence on every phone would be actively dangerous.
//
// So the explanation of each choice sits under it, in words a caregiver would
// use, rather than in a help article nobody opens.

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { useMe } from '@/lib/me';
import {
  CADENCES,
  CADENCE_HELP,
  CADENCE_LABELS,
  DEFAULT_PREFS,
  loadPrefs,
  savePrefs,
  type Cadence,
  type NotificationPrefs,
} from '@/lib/notification-prefs';
import { syncDoseAndRefillNotifications } from '@/lib/notifications';
import { color, palette, radius, spacing, typography } from '@/lib/theme';

function Choice({
  value,
  selected,
  onPress,
}: {
  value: Cadence;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.choice, selected && styles.choiceOn]}>
      <Text style={[styles.choiceLabel, selected && styles.choiceLabelOn]}>
        {CADENCE_LABELS[value]}
      </Text>
    </Pressable>
  );
}

function Group({
  title,
  description,
  value,
  options,
  onChange,
  help,
}: {
  title: string;
  description: string;
  value: Cadence;
  options: Cadence[];
  onChange: (next: Cadence) => void;
  /** Overrides the generic per-cadence copy where it would be wrong. */
  help?: string;
}) {
  return (
    <Card>
      <Text style={styles.sectionLabel}>{title}</Text>
      <Text style={styles.sub}>{description}</Text>
      <View style={styles.row} accessibilityRole="radiogroup">
        {options.map((option) => (
          <Choice
            key={option}
            value={option}
            selected={value === option}
            onPress={() => onChange(option)}
          />
        ))}
      </View>
      <Text style={styles.help}>{help ?? CADENCE_HELP[value]}</Text>
    </Card>
  );
}

export default function NotificationSettingsScreen() {
  const { me } = useMe();
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadPrefs().then((p) => {
      if (!cancelled) {
        setPrefs(p);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Save and reschedule together. Changing a setting that does not take effect
  // until some later sync is the kind of thing that makes people distrust the
  // whole feature, so the reminders are rebuilt on the spot.
  function update(patch: Partial<NotificationPrefs>) {
    const next = { ...prefs, ...patch } as NotificationPrefs;
    setPrefs(next);
    void savePrefs(next).then(() => syncDoseAndRefillNotifications(me?.id ?? null));
  }

  return (
    <Screen>
      <Card>
        <Text style={styles.sectionLabel}>ON THIS PHONE</Text>
        <Text style={styles.sub}>
          These settings are for this phone only. Change them here and your sister&apos;s
          reminders stay as she set them.
        </Text>
      </Card>

      {loaded && (
        <>
          <Group
            title="MEDICATION REMINDERS"
            description="When a dose is due, and a nudge if it has not been logged half an hour later."
            value={prefs.doses}
            options={CADENCES}
            onChange={(doses) => update({ doses })}
          />

          <Group
            title="REFILLS"
            description="A week before a prescription runs out, and again two days before."
            value={prefs.refills}
            options={CADENCES}
            onChange={(refills) => update({ refills })}
          />

          <Group
            title="HAND-OFFS"
            description="When someone hands the shift to you. These are addressed to you by name, so there is no shift option."
            value={prefs.handoffs}
            options={['always', 'off']}
            onChange={(handoffs) =>
              update({ handoffs: handoffs === 'off' ? 'off' : 'always' })
            }
            help={
              prefs.handoffs === 'off'
                ? 'Nothing for this, on this phone.'
                : 'You are told when the shift becomes yours.'
            }
          />

          <Card>
            <Text style={styles.sectionLabel}>WHAT &ldquo;ONLY MY SHIFTS&rdquo; MEANS</Text>
            <Text style={styles.sub}>
              You are told while you are on duty — and whenever nobody is on duty at all.
              Families forget to hand over more often than they forget the medication, so a
              reminder is never lost just because no one has taken the shift. You only go
              quiet when someone else is actually holding it.
            </Text>
          </Card>

          <Card>
            <Text style={styles.sectionLabel}>NOT YET COVERED</Text>
            <Text style={styles.sub}>
              Appointments do not send reminders yet, so there is nothing to configure here
              for them. When they do, this screen is where it will live.
            </Text>
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    ...typography.meta,
    fontSize: 11,
    letterSpacing: 1.2,
    color: palette.sage700,
    marginBottom: spacing.xs,
  },
  sub: { ...typography.body, fontSize: 14, color: palette.ink700 },
  row: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  choice: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.sage300,
    alignItems: 'center',
  },
  choiceOn: { backgroundColor: color.confirm, borderColor: color.confirm },
  choiceLabel: { ...typography.body, fontSize: 13, color: palette.ink700 },
  choiceLabelOn: { color: palette.cream50, fontWeight: '600' },
  help: {
    ...typography.meta,
    fontSize: 12,
    color: palette.sage700,
    marginTop: spacing.sm,
  },
});
