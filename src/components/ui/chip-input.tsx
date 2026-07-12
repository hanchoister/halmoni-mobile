import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Field, Input } from '@/components/ui/field';
import { palette, radius } from '@/lib/theme';

export function ChipInput({
  label,
  placeholder,
  chips,
  setChips,
}: {
  label: string;
  placeholder: string;
  chips: string[];
  setChips: (next: string[]) => void;
}) {
  const [text, setText] = useState('');

  function add() {
    const v = text.trim();
    if (!v) return;
    if (chips.includes(v)) {
      setText('');
      return;
    }
    setChips([...chips, v]);
    setText('');
  }

  return (
    <Field label={label}>
      {chips.length > 0 && (
        <View style={styles.chipRow}>
          {chips.map((c) => (
            <Pressable key={c} onPress={() => setChips(chips.filter((x) => x !== c))} style={styles.chip}>
              <Text style={styles.chipText}>{c} ✕</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Input
        placeholder={placeholder}
        value={text}
        onChangeText={setText}
        onSubmitEditing={add}
        onBlur={add}
        returnKeyType="done"
      />
    </Field>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  chip: {
    backgroundColor: palette.cream200,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { fontSize: 12, color: palette.ink900 },
});
