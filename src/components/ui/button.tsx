import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

import { color, palette, radius, spacing, typography } from '@/lib/theme';

/**
 * `primary` is the deep sage anchor — the one filled, unmissable action on a
 * screen. `accent` is terracotta and means "this is asking something of you"
 * (add a finding to visit prep, refill a prescription); it is deliberately
 * scarce, because a colour that appears everywhere stops meaning anything.
 */
type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

const fill: Record<Variant, string> = {
  primary: color.hero,
  accent: color.accent,
  secondary: color.surface,
  ghost: 'transparent',
  danger: color.accent,
};

const label: Record<Variant, string> = {
  primary: color.onHero,
  accent: color.onFill,
  secondary: color.text,
  ghost: color.textMuted,
  danger: color.onFill,
};

export function Button({
  title,
  onPress,
  disabled,
  busy,
  variant = 'primary',
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: Variant;
  style?: ViewStyle;
}) {
  const bg = fill[variant];
  const fg = label[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg },
        variant === 'secondary' && styles.outlined,
        pressed && styles.pressed,
        (disabled || busy) && styles.disabled,
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.text, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.pill,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlined: {
    borderWidth: 1,
    borderColor: palette.cream200,
  },
  // Custom families carry their own weight, so `fontWeight` is deliberately
  // absent — setting both makes Android synthesise a second, wrong bold.
  text: { ...typography.bodyStrong },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.45 },
});
