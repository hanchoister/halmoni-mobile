import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

import { palette, radius, spacing } from '@/lib/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

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
  const bg =
    variant === 'primary'
      ? palette.sage500
      : variant === 'secondary'
        ? palette.cream100
        : variant === 'danger'
          ? palette.terracotta500
          : 'transparent';
  const fg =
    variant === 'primary' || variant === 'danger'
      ? palette.white
      : variant === 'secondary'
        ? palette.ink900
        : palette.ink500;
  const border = variant === 'secondary' ? palette.cream200 : 'transparent';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={[
        styles.button,
        { backgroundColor: bg, borderColor: border, borderWidth: variant === 'secondary' ? 1 : 0 },
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
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.55 },
});
