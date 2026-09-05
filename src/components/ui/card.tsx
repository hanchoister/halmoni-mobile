import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { color, radius, shadow, spacing } from '@/lib/theme';

/**
 * A card lifts off the cream ground rather than being outlined on it.
 *
 * The previous version was a 14px box with a 1px cream hairline on a cream
 * background and no shadow — the detail that dated the interface fastest,
 * because at that contrast the edge reads as a smudge rather than an edge.
 * Separation now comes from elevation (white on cream, plus a soft shadow),
 * with the hairline kept only at 6% to hold the shape on a dim screen.
 */
export function Card({
  children,
  style,
  tint,
}: {
  children: ReactNode;
  style?: ViewStyle;
  tint?: 'sage' | 'cream' | 'white' | 'warm';
}) {
  const tintBg =
    tint === 'sage'
      ? color.confirmTint
      : tint === 'cream'
        ? color.surfaceAlt
        : tint === 'warm'
          ? color.accentSoft
          : color.surface;

  // A tinted card is already distinct from the ground, so it does not need the
  // shadow as well — stacking both reads as heavy.
  const flat = tint && tint !== 'white';

  return (
    <View style={[styles.card, { backgroundColor: tintBg }, !flat && styles.raised, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    padding: spacing.lg,
  },
  raised: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.hairline,
    ...shadow.card,
  },
});
