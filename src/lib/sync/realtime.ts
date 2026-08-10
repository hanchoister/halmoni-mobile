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
}

/** Open (or replace) the realtime channel scoped to a family. */
export function startRealtime(familyId: string) {
  if (_channel && _channelFamilyId === familyId) return;
  stopRealtime();

  const ch = supabase.channel(`halmoni-family-${familyId}`);
  for (const table of LIVE_TABLES) {
    ch.on(
      'postgres_changes' as any,
      {
        event: '*',
        schema: 'public',
        table,
        filter: `family_id=eq.${familyId}`,
      },
      (payload: RealtimePostgresChangesPayload<Record<string, any>>) => {
        void handleEvent(table, payload);
      },
    );
  }
  ch.subscribe((status) => {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[realtime]', status, 'family', familyId);
    }
  });
  _channel = ch;
  _channelFamilyId = familyId;
}

export function stopRealtime() {
  if (_channel) {
    void supabase.removeChannel(_channel);
    _channel = null;
    _channelFamilyId = null;
  }
}
