// Presence heartbeat: "Sarah active 2h ago". Client upserts a row into the
// presence table on app foreground and once every heartbeat interval while
// active. Family screens read those rows to render relative-time last-seen.
//
// Reads bypass SQLite deliberately — presence is only useful when live, and
// realtime delivery of its updates is a straight postgres_changes subscribe.

import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

const DEVICE_INFO = `${Platform.OS} ${Platform.Version ?? ''}`.trim();

export async function beatPresence(memberId: string, familyId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('presence').upsert(
    {
      member_id: memberId,
      family_id: familyId,
      last_seen_at: now,
      device_info: DEVICE_INFO,
    },
    { onConflict: 'member_id' },
  );
  if (error && __DEV__) {
    // eslint-disable-next-line no-console
    console.log('[presence] beat error', error.message);
  }
}

export interface PresenceRow {
  member_id: string;
  family_id: string;
  last_seen_at: string;
  device_info: string | null;
}

export async function getFamilyPresence(familyId: string): Promise<PresenceRow[]> {
  const { data, error } = await supabase
    .from('presence')
    .select('member_id, family_id, last_seen_at, device_info')
    .eq('family_id', familyId);
  if (error) return [];
  return (data ?? []) as PresenceRow[];
}

/** Human-friendly "active 2h ago". Returns null if never seen or < 60s old. */
export function formatLastSeen(iso: string | null | undefined, nowMs = Date.now()): string | null {
  if (!iso) return null;
  const diffMs = nowMs - new Date(iso).getTime();
  if (diffMs < 60_000) return 'active now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `active ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `active ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `active ${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `active ${weeks}w ago`;
  return null;
}
