-- Heartbeat table for the "Sarah active 2h ago" indicator. One row per
-- (family_member) — upserted whenever the app comes to foreground.

create table if not exists presence (
  member_id     uuid primary key references family_members(id) on delete cascade,
  family_id     uuid not null references families(id) on delete cascade,
  last_seen_at  timestamptz not null default now(),
  device_info   text,                     -- 'ios 17.4', 'web', etc. — optional
  updated_at    timestamptz not null default now()
);
create index if not exists presence_family_idx on presence (family_id, last_seen_at desc);

drop trigger if exists presence_set_updated_at on presence;
create trigger presence_set_updated_at before update on presence
  for each row execute function set_updated_at();

alter table presence enable row level security;

drop policy if exists presence_select on presence;
create policy presence_select on presence
  for select using (is_family_member(family_id));

drop policy if exists presence_upsert_insert on presence;
create policy presence_upsert_insert on presence
  for insert with check (
    is_family_member(family_id)
    and exists (
      select 1 from family_members
      where id = presence.member_id and user_id = auth.uid()
    )
  );

drop policy if exists presence_upsert_update on presence;
create policy presence_upsert_update on presence
  for update using (
    exists (
      select 1 from family_members
      where id = presence.member_id and user_id = auth.uid()
    )
  );
