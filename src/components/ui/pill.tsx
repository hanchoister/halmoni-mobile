import { StyleSheet, Text, View } from 'react-native';

import { palette, radius } from '@/lib/theme';

export function Pill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'sage' | 'terracotta' | 'butter' | 'cream';
}) {
  const bg =
    tone === 'sage'
      ? palette.sage100
      : tone === 'terracotta'
        ? palette.terracotta100
        : tone === 'butter'
          ? palette.butter100
          : tone === 'cream'
            ? palette.cream200
            : palette.cream100;
  const fg =
    tone === 'sage'
      ? palette.sage700
      : tone === 'terracotta'
        ? palette.terracotta700
        : tone === 'butter'
          ? '#6b5b18'
          : palette.ink700;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  text: { fontSize: 11, fontWeight: '600' },
});
