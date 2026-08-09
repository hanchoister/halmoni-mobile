-- Append-only audit log: who did what, when. Powers the Timeline "recent
-- activity" strip and answers "did Marcus give the morning dose?" months later.

create table if not exists audit_log (
  id                uuid primary key default gen_random_uuid(),
  family_id         uuid not null references families(id) on delete cascade,
  actor_member_id   uuid references family_members(id) on delete set null,
  actor_user_id     uuid,                 -- auth.uid() at time of write
  entity_type       text not null,        -- 'medication' | 'med_dose' | 'handoff' | 'appointment' | 'symptom' | 'note' | 'visit_note'
  entity_id         uuid,
  action            text not null,        -- 'created' | 'updated' | 'deleted' | 'given' | 'accepted' | 'completed'
  meta              jsonb,                -- optional context (old/new value, etc.)
  at                timestamptz not null default now()
);
create index if not exists audit_log_family_at_idx on audit_log (family_id, at desc);
create index if not exists audit_log_entity_idx on audit_log (entity_type, entity_id);

alter table audit_log enable row level security;

drop policy if exists audit_log_select on audit_log;
create policy audit_log_select on audit_log
  for select using (is_family_member(family_id));

-- Members can insert; server-side default fills actor_user_id if left null.
drop policy if exists audit_log_insert on audit_log;
create policy audit_log_insert on audit_log
  for insert with check (is_family_member(family_id));

-- No updates, no deletes. Append-only.
