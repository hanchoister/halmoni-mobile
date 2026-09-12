/**
 * A checkbox, for the two places where someone is agreeing to something rather
 * than choosing between options: the terms at sign-in (G1-33) and the separate
 * sharing answer when a parent is added (G1-32).
 *
 * Never rendered pre-ticked anywhere. A pre-ticked box is not a clear
 * affirmative act, which is what both Washington's consent definition and the
 * clickwrap case law are asking for, and it is the exact pattern the statute
 * calls a deceptive design.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, palette, radius, spacing, typography } from '@/lib/theme';

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** The small print under the label. Still part of what they are agreeing to. */
  description?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={label}
      accessibilityHint={description}
      style={[styles.row, disabled && styles.disabled]}>
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked && <Text style={styles.tick}>✓</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  disabled: { opacity: 0.5 },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: palette.cream200,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxChecked: { backgroundColor: color.confirm, borderColor: color.confirm },
  tick: { color: palette.cream50, fontSize: 15, fontWeight: '700', lineHeight: 18 },
  label: { ...typography.body, color: color.text },
  description: { ...typography.meta, color: color.textMuted, marginTop: 2 },
});
