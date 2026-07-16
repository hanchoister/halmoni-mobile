import { router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { palette, spacing } from '@/lib/theme';

export function HeaderBackButton() {
  const canGoBack = router.canGoBack();
  return (
    <Pressable
      onPress={() => (canGoBack ? router.back() : router.replace('/'))}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={canGoBack ? 'Go back' : 'Go home'}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Text style={styles.chevron}>‹</Text>
      <Text style={styles.label}>{canGoBack ? 'Back' : 'Home'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: 2,
  },
  pressed: { opacity: 0.5 },
  chevron: {
    fontSize: 26,
    lineHeight: 26,
    color: palette.sage600,
    fontWeight: '400',
    marginTop: -2,
  },
  label: {
    fontSize: 16,
    color: palette.sage600,
    fontWeight: '600',
  },
});
