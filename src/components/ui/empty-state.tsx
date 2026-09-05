import { StyleSheet, Text, View } from 'react-native';

import { Icon, IconName } from '@/components/ui/icon';
import { color, spacing, typography } from '@/lib/theme';

/**
 * `emoji` is kept so existing call sites still compile, but prefer `icon` —
 * an emoji renders as a different picture on every OS and matches the brand on
 * none of them. Passing both prefers the icon.
 */
export function EmptyState({
  emoji,
  icon,
  title,
  message,
}: {
  emoji?: string;
  icon?: IconName;
  title: string;
  message?: string;
}) {
  return (
    <View style={styles.wrap}>
      {icon ? (
        <View style={styles.iconWell}>
          <Icon name={icon} size={26} color={color.textFaint} />
        </View>
      ) : (
        emoji && <Text style={styles.emoji}>{emoji}</Text>
      )}
      <Text style={styles.title}>{title}</Text>
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: 6 },
  iconWell: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: color.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emoji: { fontSize: 36, marginBottom: 4 },
  title: { ...typography.title, color: color.text, textAlign: 'center' },
  message: { ...typography.meta, color: color.textMuted, textAlign: 'center', maxWidth: 280 },
});
