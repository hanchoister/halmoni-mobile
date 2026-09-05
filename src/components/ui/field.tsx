import { ReactNode } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

import { color, palette, radius, spacing, typography } from '@/lib/theme';

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
      placeholderTextColor={color.textFaint}
      {...props}
      style={[styles.input, props.multiline && styles.multiline, props.style]}
    />
  );
}

const styles = StyleSheet.create({
  field: { gap: 2 },
  label: {
    ...typography.label,
    color: color.textMuted,
    textTransform: 'uppercase',
  },
  required: { color: color.accent },
  input: {
    borderWidth: 1,
    borderColor: palette.cream200,
    backgroundColor: color.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.body,
    color: color.text,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
});
