import { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, ViewStyle } from 'react-native';

import { SyncBanner } from '@/components/ui/sync-banner';
import { palette, spacing } from '@/lib/theme';

export function Screen({
  children,
  scroll = true,
  refreshControl,
  style,
  padded = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshControl?: React.ReactElement<any>;
  style?: ViewStyle;
  padded?: boolean;
}) {
  if (!scroll) {
    return (
      <View style={[styles.container, padded && styles.padded, style]}>
        <SyncBanner />
        {children}
      </View>
    );
  }
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[padded && styles.padded, style]}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled">
        <SyncBanner />
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.cream50 },
  padded: { padding: spacing.lg, gap: spacing.md },
});
