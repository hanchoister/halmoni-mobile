// Append-only audit log helper. Writes a row into audit_log every time an
// action worth remembering happens (dose given, handoff accepted, med added,
// visit summary edited). Timeline tab renders recent entries.
//
// Fire-and-forget: audit logging never blocks user-facing writes.

import { supabase } from '@/lib/supabase';

export type AuditEntity =
  | 'medication'
  | 'med_dose'
  | 'appointment'
  | 'visit_note'
  | 'symptom'
  | 'handoff'
  | 'note'
  | 'parent'
  | 'family_member';

export type AuditAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'given'
  | 'skipped'
  | 'accepted'
  | 'completed'
  | 'shared';

export interface AuditEntry {
  familyId: string;
  actorMemberId?: string | null;
  actorUserId?: string | null;
  entityType: AuditEntity;
  entityId?: string | null;
  action: AuditAction;
  meta?: Record<string, unknown>;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  const { error } = await supabase.from('audit_log').insert({
    family_id: entry.familyId,
    actor_member_id: entry.actorMemberId ?? null,
    actor_user_id: entry.actorUserId ?? null,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    action: entry.action,
    meta: entry.meta ?? null,
  });
  if (error && __DEV__) {
    // eslint-disable-next-line no-console
    console.log('[audit] insert error', error.message);
  }
}

export interface AuditRow {
  id: string;
  family_id: string;
  actor_member_id: string | null;
  actor_user_id: string | null;
  entity_type: AuditEntity;
  entity_id: string | null;
  action: AuditAction;
  meta: Record<string, unknown> | null;
  at: string;
}

export async function getRecentAudit(familyId: string, limit = 50): Promise<AuditRow[]> {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .eq('family_id', familyId)
    .order('at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as AuditRow[];
}
