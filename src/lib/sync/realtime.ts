// Realtime bridge: Supabase postgres_changes events → local SQLite mirror.
// One channel per family_id, subscribed to the tables where inbound family
// activity should show up instantly (dose given, new symptom, handoff sent,
// etc.). RLS already filters what the subscription is allowed to deliver.
//
// On every event we upsert into the local mirror (including tombstones — the
// server sends the whole row with deleted_at set on soft-deletes). UI screens
// reading via useLiveTable/read hooks will pick up the change on the next
// render.

import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import { recordKnownId, upsertRow } from '@/lib/db/repository';
import type { SyncableTable } from '@/lib/db/schema';
import { bumpDataVersion } from '@/lib/db/signal';

const LIVE_TABLES: SyncableTable[] = [
  'families',
  'family_members',
  'parents',
  'medications',
  'med_doses',
  'appointments',
  'visit_notes',
  'symptoms',
  'handoffs',
  'on_duty',
  'thread_messages',
  'notes',
];

let _channel: RealtimeChannel | null = null;
let _channelFamilyId: string | null = null;
let _lastStatus: string | null = null;

/** Last realtime subscription status, for diagnostics. */
export function realtimeStatus(): string | null {
  return _lastStatus;
}

async function handleEvent(
  table: SyncableTable,
  payload: RealtimePostgresChangesPayload<Record<string, any>>,
) {
  const row = (payload.new ?? payload.old) as Record<string, any> | null;
  if (!row?.id) return;
  // For DELETE events, the row won't carry updated_at; stamp one so local
  // comparisons still work.
  const stamped =
    payload.eventType === 'DELETE'
      ? {
          ...row,
          deleted_at: row.deleted_at ?? new Date().toISOString(),
          updated_at: row.updated_at ?? new Date().toISOString(),
        }
      : row;
  await upsertRow(table, stamped);
  await recordKnownId(table, stamped.id as string);
  bumpDataVersion();
}

/** Open (or replace) the realtime channel scoped to a family. */
export function startRealtime(familyId: string) {
  if (_channel && _channelFamilyId === familyId) return;
  stopRealtime();

  const ch = supabase.channel(`halmoni-family-${familyId}`);
  for (const table of LIVE_TABLES) {
    // `families` is keyed by `id`; every other table carries `family_id`.
    // Filtering families on a column it does not have made that one binding
    // invalid, which errors the whole channel — taking live updates down for
    // all twelve tables, not just this one.
    const filter =
      table === 'families' ? `id=eq.${familyId}` : `family_id=eq.${familyId}`;
    ch.on(
      'postgres_changes' as any,
      {
        event: '*',
        schema: 'public',
        table,
        filter,
      },
      (payload: RealtimePostgresChangesPayload<Record<string, any>>) => {
        void handleEvent(table, payload);
      },
    );
  }
  ch.subscribe((status, err) => {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[realtime]', status, 'family', familyId, err ?? '');
    }
    // A dead channel is silent by design, which is how a broken filter went
    // unnoticed. Record it so the diagnostics screen can say "live updates off"
    // rather than the app just feeling slow.
    _lastStatus = status;
  });
  _channel = ch;
  _channelFamilyId = familyId;
}

export function stopRealtime() {
  if (_channel) {
    void supabase.removeChannel(_channel);
    _channel = null;
    _channelFamilyId = null;
    _lastStatus = null;
  }
}
