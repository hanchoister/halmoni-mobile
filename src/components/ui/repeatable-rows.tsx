// A list of structured rows you can add to and remove from.
//
// Built generic rather than hard-wired to ICE contacts because the same shape
// keeps recurring in the features still to come: appointment questions, document
// lists, attachment lists. Porting those should be a matter of supplying a blank
// row and a renderer, not rebuilding add/remove/empty-state each time.
//
// The caller owns the row type entirely; this component only knows how to keep a
// list of them.

import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette, radius, spacing } from '@/lib/theme';

export function RepeatableRows<T>({
  label,
  hint,
  rows,
  setRows,
  blank,
  addLabel,
  renderRow,
}: {
  label: string;
  hint?: string;
  rows: T[];
  setRows: (next: T[]) => void;
  /** A fresh empty row. Called on every add, so it must not be shared state. */
  blank: () => T;
  addLabel: string;
  /** Render the editable fields for one row. `update` replaces that row. */
  renderRow: (row: T, update: (next: T) => void, index: number) => ReactNode;
}) {
  function updateAt(index: number, next: T) {
    setRows(rows.map((r, i) => (i === index ? next : r)));
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      {rows.map((row, i) => (
        <View key={i} style={styles.row}>
          <View style={{ flex: 1, gap: spacing.xs }}>
            {renderRow(row, (next) => updateAt(i, next), i)}
          </View>
          <Pressable
            onPress={() => setRows(rows.filter((_, j) => j !== i))}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${label} ${i + 1}`}>
            <Text style={styles.remove}>Remove</Text>
          </Pressable>
        </View>
      ))}

      <Pressable onPress={() => setRows([...rows, blank()])} hitSlop={8}>
        <Text style={styles.add}>{addLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.ink500,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  hint: { fontSize: 12, color: palette.ink500 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: palette.cream100,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  remove: { fontSize: 12, color: palette.terracotta500, fontWeight: '600', paddingTop: 8 },
  add: {
    fontSize: 13,
    color: palette.sage700,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
});
