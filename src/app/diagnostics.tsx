// Diagnostics screen (G1-09). Reachable from Account. Nothing here is
// destructive — it exists so a support conversation ("it says my changes
// aren't saving") has something more specific to point at than "try
// reinstalling", and so the answer to "which backend am I even talking to"
// doesn't require reading a .env file over the phone.

import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { getDb } from '@/lib/db/client';
import { deviceZone, zoneSupported } from '@/lib/dose-plan';
import { useDemoMode } from '@/lib/demo-mode';
import { useSyncStatus } from '@/lib/sync/state';
import { palette, spacing } from '@/lib/theme';

function backendRef(): string {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!url) return 'not set';
  const match = /^https?:\/\/([^.]+)\./.exec(url);
  return match ? match[1] : url;
}

function since(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
}

interface QueueCounts {
  pending: number;
  quarantined: number;
}

// Mirrors the write-path's own quarantine threshold (G1-11): a write that
// has failed 5 times is parked rather than retried forever.
const QUARANTINE_ATTEMPTS = 5;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} selectable>
        {value}
      </Text>
    </View>
  );
}

export default function DiagnosticsScreen() {
  const demo = useDemoMode();
  const { status, lastSyncAt, lastError } = useSyncStatus();
  const [queue, setQueue] = useState<QueueCounts | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await getDb();
        const total = await db.getFirstAsync<{ n: number }>(
          `SELECT COUNT(*) as n FROM pending_writes`,
        );
        const quarantined = await db.getFirstAsync<{ n: number }>(
          `SELECT COUNT(*) as n FROM pending_writes WHERE attempts >= ?`,
          QUARANTINE_ATTEMPTS,
        );
        if (!cancelled) {
          setQueue({ pending: total?.n ?? 0, quarantined: quarantined?.n ?? 0 });
        }
      } catch (e) {
        if (!cancelled) setQueueError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const appVersion = Constants.expoConfig?.version ?? 'unknown';
  const buildNumber =
    Constants.expoConfig?.ios?.buildNumber ??
    Constants.expoConfig?.android?.versionCode?.toString() ??
    'unknown';
  const runtimeVersion =
    typeof Constants.expoConfig?.runtimeVersion === 'string'
      ? Constants.expoConfig.runtimeVersion
      : (Constants.expoConfig?.runtimeVersion?.policy ?? 'unknown');

  return (
    <Screen>
      <Card>
        <Text style={styles.sectionLabel}>BACKEND</Text>
        <Row label="Project" value={backendRef()} />
        <Row label="Mode" value={demo ? 'Demo (no account)' : 'Live account'} />
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>SYNC</Text>
        <Row label="Status" value={status} />
        <Row label="Last synced" value={since(lastSyncAt)} />
        {lastError && <Row label="Last error" value={lastError} />}
        {queueError ? (
          <Row label="Write queue" value={`Could not read: ${queueError}`} />
        ) : queue ? (
          <>
            <Row label="Pending writes" value={String(queue.pending)} />
            <Row label="Quarantined" value={String(queue.quarantined)} />
          </>
        ) : (
          <Row label="Write queue" value="Reading…" />
        )}
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>TIME</Text>
        {/*
          G2-27 stores the zone a medication's times are written in and honours
          it on every device. All of that rests on this runtime being able to
          resolve an IANA zone, and Hermes' Intl support is not a given — if it
          cannot, every schedule silently falls back to reader-local times,
          which is the bug. Node can do it, so CI will never tell us. This row
          is how the device pass (G2-56) answers it in one glance.
        */}
        <Row label="Device timezone" value={deviceZone() ?? 'unavailable'} />
        <Row
          label="Zone support"
          value={zoneSupported('America/New_York') ? 'yes — dose times are zone-correct' : 'NO — dose times fall back to this device'}
        />
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>APP</Text>
        <Row label="Version" value={appVersion} />
        <Row label="Build" value={buildNumber} />
        <Row label="Runtime" value={runtimeVersion} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.ink500,
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: 6,
  },
  rowLabel: { fontSize: 13, color: palette.ink500 },
  rowValue: { fontSize: 13, fontWeight: '600', color: palette.ink900, flexShrink: 1, textAlign: 'right' },
});
