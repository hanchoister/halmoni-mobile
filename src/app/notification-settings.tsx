// Notification settings. Unlike diagnostics, this screen IS for caregivers —
// it is reachable from Account as an ordinary row.
//
// The explanation of "only my shifts" sits at the TOP, directly under the
// per-phone note, rather than at the bottom as a footnote. It is the one thing
// on this screen someone could get dangerously wrong: a caregiver who believes
// "only my shifts" means "silence whenever I am not on duty" would reasonably
// conclude that a forgotten hand-over means nobody is reminded. It does not,
// and that has to be said before the switches, not after them.

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { useMe } from '@/lib/me';
import {
  APPOINTMENT_LEAD_CHOICES,
  CADENCES,
  CADENCE_HELP,
  CADENCE_LABELS,
  DEFAULT_PREFS,
  DOSE_FOLLOW_UP_CHOICES,
  DOSE_LEAD_CHOICES,
  REFILL_DAY_CHOICES,
  humanDays,
  humanMinutes,
  loadPrefs,
  savePrefs,
  toggleOffset,
  type Cadence,
  type NotificationPrefs,
} from '@/lib/notification-prefs';
import { syncDoseAndRefillNotifications } from '@/lib/notifications';
import { color, palette, radius, spacing, typography } from '@/lib/theme';

function Chip({
  label,
  selected,
  onPress,
  wide,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  wide?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, wide && styles.chipWide, selected && styles.chipOn]}>
      <Text style={[styles.chipLabel, selected && styles.chipLabelOn]}>{label}</Text>
    </Pressable>
  );
}

/** A row of multi-select offsets — "which of these, any number". */
function Offsets({
  title,
  choices,
  selected,
  format,
  onToggle,
  emptyNote,
}: {
  title: string;
  choices: number[];
  selected: number[];
  format: (n: number) => string;
  onToggle: (value: number) => void;
  emptyNote: string;
}) {
  return (
    <View style={{ marginTop: spacing.md }}>
      <Text style={styles.offsetTitle}>{title}</Text>
      <View style={styles.wrap}>
        {choices.map((c) => (
          <Chip
            key={c}
            label={format(c)}
            selected={selected.includes(c)}
            onPress={() => onToggle(c)}
          />
        ))}
      </View>
      {selected.length === 0 && <Text style={styles.help}>{emptyNote}</Text>}
    </View>
  );
}

function Group({
  title,
  description,
  value,
  options,
  onChange,
  help,
  children,
}: {
  title: string;
  description: string;
  value: Cadence;
  options: Cadence[];
  onChange: (next: Cadence) => void;
  help?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <Text style={styles.sectionLabel}>{title}</Text>
      <Text style={styles.sub}>{description}</Text>
      <View style={styles.row} accessibilityRole="radiogroup">
        {options.map((option) => (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === option }}
            style={[styles.choice, value === option && styles.choiceOn]}>
            <Text style={[styles.choiceLabel, value === option && styles.choiceLabelOn]}>
              {CADENCE_LABELS[option]}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.help}>{help ?? CADENCE_HELP[value]}</Text>
      {/* Timing controls are pointless when the category is off, and showing
          them anyway invites someone to set a reminder that will never fire. */}
      {value !== 'off' && children}
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

  // Save and reschedule together. A setting that does not take effect until
  // some later sync is the kind of thing that makes people distrust the whole
  // feature, so the reminders are rebuilt on the spot.
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
          These settings belong to this phone (not your account). Change them here and your
          sister&apos;s reminders stay exactly as she set them — and if you sign in on a
          second device, that one keeps its own settings too.
        </Text>
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>WHAT &ldquo;ONLY MY SHIFTS&rdquo; MEANS</Text>
        <Text style={styles.sub}>
          You are told while you are on duty — and whenever nobody is on duty at all.
          Families forget to hand over more often than they forget the medication, so a
          reminder is never lost just because no one has taken the shift. You only go quiet
          when someone else is actually holding it.
        </Text>
      </Card>

      {loaded && (
        <>
          <Group
            title="MEDICATION REMINDERS"
            description="When a dose is due."
            value={prefs.doses}
            options={CADENCES}
            onChange={(doses) => update({ doses })}>
            <Offsets
              title="Also remind me before"
              choices={DOSE_LEAD_CHOICES}
              selected={prefs.doseLeadMinutes}
              format={humanMinutes}
              onToggle={(v) => update({ doseLeadMinutes: toggleOffset(prefs.doseLeadMinutes, v) })}
              emptyNote="Just the reminder at dose time."
            />
            <Offsets
              title="Nudge me after, if it is still not logged"
              choices={DOSE_FOLLOW_UP_CHOICES}
              selected={prefs.doseFollowUpMinutes}
              format={humanMinutes}
              onToggle={(v) =>
                update({ doseFollowUpMinutes: toggleOffset(prefs.doseFollowUpMinutes, v) })
              }
              emptyNote="No follow-up — you will not be told if a dose goes unlogged."
            />
          </Group>

          <Group
            title="REFILLS"
            description="Before a prescription runs out."
            value={prefs.refills}
            options={CADENCES}
            onChange={(refills) => update({ refills })}>
            <Offsets
              title="Warn me this far ahead"
              choices={REFILL_DAY_CHOICES}
              selected={prefs.refillDays}
              format={humanDays}
              onToggle={(v) => update({ refillDays: toggleOffset(prefs.refillDays, v) })}
              emptyNote="No refill warnings, even though refills are switched on."
            />
          </Group>

          <Group
            title="APPOINTMENTS"
            description="Before an appointment starts. Shown in your own local time, since you have to travel to it."
            value={prefs.appointments}
            options={CADENCES}
            onChange={(appointments) => update({ appointments })}>
            <Offsets
              title="Remind me this far ahead"
              choices={APPOINTMENT_LEAD_CHOICES}
              selected={prefs.appointmentLeadMinutes}
              format={humanMinutes}
              onToggle={(v) =>
                update({ appointmentLeadMinutes: toggleOffset(prefs.appointmentLeadMinutes, v) })
              }
              emptyNote="No appointment reminders, even though appointments are switched on."
            />
          </Group>

          <Group
            title="NOBODY ON DUTY"
            description="When a dose is coming up and no one has taken the shift. Once a day per person, so it is a prompt rather than a drumbeat."
            value={prefs.unattended}
            options={CADENCES}
            onChange={(unattended) => update({ unattended })}
            help={
              prefs.unattended === 'off'
                ? 'Nothing for this, on this phone. Nobody will be told when a shift goes uncovered.'
                : 'You are told when a shift is uncovered and something is due.'
            }
          />

          <Group
            title="HAND-OFFS"
            description="When someone hands the shift to you. These are addressed to you by name, so there is no shift option."
            value={prefs.handoffs}
            options={['always', 'off']}
            onChange={(handoffs) => update({ handoffs: handoffs === 'off' ? 'off' : 'always' })}
            help={
              prefs.handoffs === 'off'
                ? 'Nothing for this, on this phone.'
                : 'You are told when the shift becomes yours.'
            }
          />
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
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
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
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.sage300,
  },
  chipWide: { flexGrow: 1, alignItems: 'center' },
  chipOn: { backgroundColor: color.confirm, borderColor: color.confirm },
  chipLabel: { ...typography.body, fontSize: 13, color: palette.ink700 },
  chipLabelOn: { color: palette.cream50, fontWeight: '600' },
  offsetTitle: {
    ...typography.meta,
    fontSize: 12,
    color: palette.ink700,
  },
  help: {
    ...typography.meta,
    fontSize: 12,
    color: palette.sage700,
    marginTop: spacing.sm,
  },
});
