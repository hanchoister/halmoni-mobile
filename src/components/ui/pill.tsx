import { StyleSheet, Text, View } from 'react-native';

import { color, palette, radius, typography } from '@/lib/theme';

export function Pill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'sage' | 'terracotta' | 'butter' | 'cream' | 'solid';
}) {
  const bg =
    tone === 'sage'
      ? color.confirmSoft
      : tone === 'terracotta'
        ? color.accentSoft
        : tone === 'butter'
          ? color.warnSoft
          : tone === 'cream'
            ? palette.cream200
            : tone === 'solid'
              ? color.accent
              : color.surfaceAlt;
  const fg =
    tone === 'sage'
      ? color.onConfirmSoft
      : tone === 'terracotta'
        ? color.onAccentSoft
        : tone === 'butter'
          ? '#6b5b18'
          : tone === 'solid'
            ? color.onFill
            : color.textMuted;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // flexShrink + maxWidth matter: pillRow wraps BETWEEN pills, but a single pill
  // wider than the row cannot wrap and used to run off the card — "Mild
  // cognitive impairment (dx Apr 2026)" was clipped by the screen edge on the
  // Today card. Shrinking lets the label wrap to a second line inside the pill
  // instead, which keeps the whole condition readable.
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
    flexShrink: 1,
    maxWidth: '100%',
  },
  text: {
    fontFamily: typography.label.fontFamily,
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 0.1,
  },
});
