// Visible sync failure banner.
//
// Silent staleness is the worst thing this app can do: a caregiver looking at a
// dose list has no way to tell "nothing logged" from "your phone stopped
// talking to the server an hour ago". The status bar in the app was previously
// the only signal, and a failing table left no trace on screen at all.
//
// Tapping expands the underlying error. That is deliberately not hidden behind a
// dev flag — when something goes wrong on a real device, the error text is the
// one thing worth having, and asking someone to read a laptop terminal is not a
// support workflow.

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useSyncStatus } from '@/lib/sync/state';
import { palette, radius, spacing } from '@/lib/theme';

function since(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
}

export function SyncBanner() {
  const { status, lastError, lastSyncAt, requestSync } = useSyncStatus();
  const [open, setOpen] = useState(false);

  if (status !== 'error' && status !== 'offline') return null;

  const offline = status === 'offline';
  return (
    <Pressable
      onPress={() => setOpen((v) => !v)}
      style={[styles.wrap, offline ? styles.offline : styles.error]}>
      <View style={styles.row}>
        <Text style={styles.title}>
          {offline ? "Can't reach the server" : 'Some changes have not saved'}
        </Text>
        <Pressable onPress={requestSync} hitSlop={8}>
          <Text style={styles.retry}>Retry</Text>
        </Pressable>
      </View>
      <Text style={styles.sub}>Last synced {since(lastSyncAt)}. Tap for details.</Text>
      {open && lastError ? <Text style={styles.detail}>{lastError}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  error: { backgroundColor: '#fbeee6', borderWidth: 1, borderColor: palette.terracotta500 },
  offline: { backgroundColor: palette.cream100, borderWidth: 1, borderColor: palette.cream200 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 14, fontWeight: '700', color: palette.ink900, flex: 1 },
  retry: { fontSize: 13, fontWeight: '700', color: palette.sage700 },
  sub: { fontSize: 12, color: palette.ink500, marginTop: 2 },
  detail: {
    fontSize: 11,
    color: palette.ink700,
    marginTop: spacing.sm,
    fontFamily: 'Menlo',
  },
});
