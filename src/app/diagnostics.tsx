// Diagnostics screen (G1-09). Reachable from Account. Nothing here is
// destructive — it exists so a support conversation ("it says my changes
// aren't saving") has something more specific to point at than "try
// reinstalling", and so the answer to "which backend am I even talking to"
// doesn't require reading a .env file over the phone.

import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { getDb } from '@/lib/db/client';
import { deviceZone, zoneSupported } from '@/lib/dose-plan';
import { useDemoMode } from '@/lib/demo-mode';
import { useFamily } from '@/lib/family';
import { useMe } from '@/lib/me';
import { getPrefsStorageNote } from '@/lib/notification-prefs';
import { getNotificationHealth, type NotificationHealth } from '@/lib/notifications';
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
  const { familyId } = useFamily();
  const { me } = useMe();
  const [notif, setNotif] = useState<NotificationHealth | null>(null);
  const [rows, setRows] = useState<string | null>(null);
  const [storageNote, setStorageNote] = useState<string | null>(null);
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
        // Row counts answer "is anything actually down there" without asking
        // the caregiver to describe what they can see.
        const counts: string[] = [];
        for (const t of ['parents', 'medications', 'med_doses', 'appointments']) {
          const r = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) as n FROM ${t}`);
          counts.push(`${t.replace('_', ' ')} ${r?.n ?? 0}`);
        }
        if (!cancelled) {
          setQueue({ pending: total?.n ?? 0, quarantined: quarantined?.n ?? 0 });
          setRows(counts.join(' · '));
          setNotif(getNotificationHealth());
          setStorageNote(getPrefsStorageNote());
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
        <Text style={styles.sectionLabel}>REMINDERS</Text>
        {/*
          G2-09 shipped, compiled, mounted — and did nothing observable on a
          real device. The caller voids the sync, so a failure inside was
          invisible. For a medication reminder that is the worst failure mode
          there is: present, silent, and only discovered when a dose is missed.
          These four lines are the difference between "not set up" and "broken".
        */}
        <Row label="Permission" value={notif?.permission ?? 'reading…'} />
        <Row
          label="Reminders set"
          value={notif?.scheduled == null ? '—' : String(notif.scheduled)}
        />
        <Row
          label="Repeating daily"
          value={notif?.repeating == null ? '—' : String(notif.repeating)}
        />
        <Row
          label="Set for the next"
          value={notif?.horizonDays == null ? '—' : `${notif.horizonDays} days`}
        />
        {Boolean(notif?.dropped) && (
          <Row label="Dropped (iOS limit)" value={String(notif?.dropped)} />
        )}
        <Row label="Last checked" value={since(notif?.lastRunAt ?? null)} />
        {notif?.skippedReason && <Row label="Nothing set because" value={notif.skippedReason} />}
        {notif?.lastError && <Row label="Last error" value={notif.lastError} />}
        {/* Settings live in the keychain so they survive a reinstall. If that
            ever fails we fall back to ordinary storage, and this is where that
            shows — a preference that silently fails to save is the same shape
            of bug as a reminder that silently fails to schedule. */}
        <Row label="Settings saved to" value={storageNote ?? 'keychain'} />
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>THIS ACCOUNT</Text>
        {/*
          Short ids, not full ones: enough for support to find the right rows,
          not enough to be mistaken for something a caregiver should act on.
        */}
        <Row label="Family" value={familyId ? `${familyId.slice(0, 8)}…` : 'none'} />
        <Row label="Member" value={me?.id ? `${me.id.slice(0, 8)}…` : 'none'} />
        <Row label="On this device" value={rows ?? 'reading…'} />
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>DEVICE</Text>
        <Row label="System" value={`${Platform.OS} ${String(Platform.Version)}`} />
        <Row label="Model" value={Constants.deviceName ?? 'unknown'} />
        <Row label="Install" value={Constants.executionEnvironment ?? 'unknown'} />
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>APP</Text>
        <Row label="Version" value={appVersion} />
        <Row label="Build" value={buildNumber} />
        <Row label="Runtime" value={runtimeVersion} />
      </Card>

      {/*
        The whole page as text, in one tap. Reading twenty fields down a phone
        line is how details get transcribed wrong; this is how support gets the
        real thing. No health data is included — ids are truncated and no name,
        medication or date ever appears on this screen.
      */}
      <Button
        title="Copy this page"
        variant="secondary"
        onPress={async () => {
          const lines = [
            `Halmoni ${appVersion} (build ${buildNumber}, runtime ${runtimeVersion})`,
            `${Platform.OS} ${String(Platform.Version)} · ${Constants.deviceName ?? 'unknown'} · ${Constants.executionEnvironment ?? 'unknown'}`,
            `backend ${backendRef()} · ${demo ? 'demo' : 'live'}`,
            `sync ${status} · last ${since(lastSyncAt)} · pending ${queue?.pending ?? '?'} · quarantined ${queue?.quarantined ?? '?'}`,
            lastError ? `sync error ${lastError}` : null,
            `timezone ${deviceZone() ?? 'unavailable'} · zones ${zoneSupported('America/New_York') ? 'ok' : 'UNSUPPORTED'}`,
            `reminders permission ${notif?.permission ?? '?'} · set ${notif?.scheduled ?? '?'} (${notif?.repeating ?? '?'} repeating) · horizon ${notif?.horizonDays ?? '?'}d · dropped ${notif?.dropped ?? 0} · checked ${since(notif?.lastRunAt ?? null)}`,
            notif?.skippedReason ? `reminders skipped: ${notif.skippedReason}` : null,
            notif?.lastError ? `reminders error: ${notif.lastError}` : null,
            `settings storage ${storageNote ?? 'keychain'}`,
            `family ${familyId?.slice(0, 8) ?? 'none'} · member ${me?.id?.slice(0, 8) ?? 'none'}`,
            `local rows ${rows ?? '?'}`,
          ].filter(Boolean);
          await Clipboard.setStringAsync(lines.join('\n'));
          Alert.alert('Copied', 'Paste this into your message to support.');
        }}
      />
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
