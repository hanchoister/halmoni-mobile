-- Patch: add the `presence` table to halmoni-prod.
--
-- The mobile app heartbeats presence (powering the "Priya active 2h ago"
-- indicator) but the table only ever existed in the mobile migrations, never
-- on prod. Every beat fails with:
--     Could not find the table 'public.presence' in the schema cache
-- It's non-fatal — the heartbeat swallows it — but it fires on an interval,
-- so it floods the logs and masks real errors during testing.
--
-- Transcribed from ~/halmoni-mobile/supabase/migrations/00000000000004_presence.sql,
-- adapted to prod conventions (public.-qualified; reuses prod's existing
-- public.set_updated_at() and public.is_family_member()).
--
-- Run once in the Supabase SQL Editor against halmoni-prod. Idempotent.

create table if not exists public.presence (
  member_id     uuid primary key references public.family_members(id) on delete cascade,
  family_id     uuid not null references public.families(id) on delete cascade,
  last_seen_at  timestamptz not null default now(),
  device_info   text,
  updated_at    timestamptz not null default now()
);
create index if not exists presence_family_idx on public.presence (family_id, last_seen_at desc);

drop trigger if exists presence_set_updated_at on public.presence;
create trigger presence_set_updated_at before update on public.presence
  for each row execute function public.set_updated_at();

alter table public.presence enable row level security;

-- Any family member can see who's active.
drop policy if exists presence_select on public.presence;
create policy presence_select on public.presence
  for select using (public.is_family_member(family_id));

-- You may only write your OWN presence row, and only into your own family.
drop policy if exists presence_upsert_insert on public.presence;
create policy presence_upsert_insert on public.presence
  for insert with check (
    public.is_family_member(family_id)
    and exists (
      select 1 from public.family_members
      where id = presence.member_id and user_id = auth.uid()
    )
  );

drop policy if exists presence_upsert_update on public.presence;
create policy presence_upsert_update on public.presence
  for update using (
    exists (
      select 1 from public.family_members
      where id = presence.member_id and user_id = auth.uid()
    )
  );

-- Verify (expect one row, rls_enabled = true):
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies where tablename = 'presence') as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'presence';
