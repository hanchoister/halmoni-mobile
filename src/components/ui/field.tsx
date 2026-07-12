import { ReactNode } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

import { palette, radius, spacing } from '@/lib/theme';

export function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required && <Text style={styles.required}> *</Text>}
      </Text>
      <View style={{ marginTop: 4 }}>{children}</View>
    </View>
  );
}

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={palette.ink300}
      {...props}
      style={[styles.input, props.multiline && styles.multiline, props.style]}
    />
  );
}

const styles = StyleSheet.create({
  field: { gap: 2 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.ink500,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  required: { color: palette.terracotta500 },
  input: {
    borderWidth: 1,
    borderColor: palette.cream200,
    backgroundColor: palette.white,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
    color: palette.ink900,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
});
