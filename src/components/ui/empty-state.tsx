import { StyleSheet, Text, View } from 'react-native';

import { palette, spacing } from '@/lib/theme';

export function EmptyState({
  emoji,
  title,
  message,
}: {
  emoji?: string;
  title: string;
  message?: string;
}) {
  return (
    <View style={styles.wrap}>
      {emoji && <Text style={styles.emoji}>{emoji}</Text>}
      <Text style={styles.title}>{title}</Text>
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: 6 },
  emoji: { fontSize: 36, marginBottom: 4 },
  title: { fontSize: 16, fontWeight: '600', color: palette.ink900, textAlign: 'center' },
  message: { fontSize: 13, color: palette.ink500, textAlign: 'center', lineHeight: 18 },
});
