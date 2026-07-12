import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { palette, radius, spacing } from '@/lib/theme';

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
      ? palette.sage50
      : tint === 'cream'
        ? palette.cream50
        : tint === 'warm'
          ? palette.terracotta100
          : palette.white;
  return <View style={[styles.card, { backgroundColor: tintBg }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.cream200,
    padding: spacing.lg,
  },
});
