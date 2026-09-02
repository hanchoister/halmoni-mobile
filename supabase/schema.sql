-- ─────────────────────────────────────────────────────────────────
-- Harmony · v1 schema
-- Run this in Supabase SQL Editor (or psql) on a fresh project.
-- Idempotent-ish: drops + recreates own enums/policies/tables.
-- ─────────────────────────────────────────────────────────────────

-- Extensions
create extension if not exists "pgcrypto";

-- ─── ENUMS ──────────────────────────────────────────────────────
do $$ begin
  create type member_color as enum ('sage','terracotta','butter','ink');
exception when duplicate_object then null; end $$;

do $$ begin
  create type appt_status as enum ('upcoming','completed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type visit_note_kind as enum
    ('voice','diagnosis','new-med','stop-med','follow-up','instruction','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type note_kind as enum ('note','symptom','mood','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type severity_level as enum ('mild','moderate','strong');
exception when duplicate_object then null; end $$;

do $$ begin
  create type pill_shape as enum ('round','oval','capsule');
exception when duplicate_object then null; end $$;

-- ─── TABLES ─────────────────────────────────────────────────────

-- A "family" is the tenant: one shared set of parents/meds/notes/etc.
create table if not exists public.families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- A sibling/caregiver inside a family. Tied to a Supabase auth user.
-- A user can belong to multiple families (one row per family).
create table if not exists public.family_members (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  relation    text,
  phone       text,
  color       member_color not null default 'sage',
  photo_url   text,
  is_owner    boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (family_id, user_id)
);
create index if not exists family_members_user_idx on public.family_members(user_id);
create index if not exists family_members_family_idx on public.family_members(family_id);

-- Shareable invite link with a short code. Anyone with the code can join.
create table if not exists public.family_invites (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families(id) on delete cascade,
  code        text not null unique,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked_at  timestamptz
);
create index if not exists family_invites_code_idx on public.family_invites(code);

-- The elder being cared for. (The app supports multiple parents per family.)
create table if not exists public.parents (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families(id) on delete cascade,
  name            text not null,
  nickname        text,
  photo_url       text,
  dob             date,
  conditions      text[] not null default '{}',
  allergies       text[] not null default '{}',
  preferences     text,
  blood_type      text,
  ice_contacts    jsonb not null default '[]'::jsonb,
  pharmacy        jsonb,
  primary_doctor  jsonb,
  insurance       jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists parents_family_idx on public.parents(family_id);

create table if not exists public.medications (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families(id) on delete cascade,
  parent_id     uuid not null references public.parents(id) on delete cascade,
  name          text not null,
  dose          text,
  purpose       text,
  schedule      jsonb not null default '[]'::jsonb,
  photo_color   text,
  shape         pill_shape,
  prescriber    text,
  pharmacy      text,
  refill_by     date,
  pills_left    integer,
  started_at    date,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists medications_parent_idx on public.medications(parent_id);
create index if not exists medications_family_idx on public.medications(family_id);

create table if not exists public.med_doses (
  id                    uuid primary key default gen_random_uuid(),
  family_id             uuid not null references public.families(id) on delete cascade,
  medication_id         uuid not null references public.medications(id) on delete cascade,
  scheduled_at          timestamptz not null,
  given_at              timestamptz,
  given_by_member_id    uuid references public.family_members(id) on delete set null,
  skipped               boolean not null default false,
  skip_reason           text
);
create index if not exists med_doses_med_idx on public.med_doses(medication_id);
create index if not exists med_doses_family_scheduled_idx on public.med_doses(family_id, scheduled_at);

create table if not exists public.symptoms (
  id                      uuid primary key default gen_random_uuid(),
  family_id               uuid not null references public.families(id) on delete cascade,
  parent_id               uuid not null references public.parents(id) on delete cascade,
  description             text not null,
  severity                severity_level not null,
  observed_at             timestamptz not null default now(),
  observed_by_member_id   uuid references public.family_members(id) on delete set null,
  possible_med_links      uuid[] not null default '{}',
  resolved                boolean not null default false
);
create index if not exists symptoms_parent_idx on public.symptoms(parent_id);

create table if not exists public.appointments (
  id                    uuid primary key default gen_random_uuid(),
  family_id             uuid not null references public.families(id) on delete cascade,
  parent_id             uuid not null references public.parents(id) on delete cascade,
  provider_name         text not null,
  specialty             text,
  location              text,
  starts_at             timestamptz not null,
  duration_min          integer,
  prep_notes            text,
  summary               text,
  attending_member_id   uuid references public.family_members(id) on delete set null,
  status                appt_status not null default 'upcoming',
  created_at            timestamptz not null default now()
);
create index if not exists appointments_parent_starts_idx on public.appointments(parent_id, starts_at);

create table if not exists public.visit_notes (
  id              uuid primary key default gen_random_uuid(),
  family_id       uuid not null references public.families(id) on delete cascade,
  appointment_id  uuid not null references public.appointments(id) on delete cascade,
  kind            visit_note_kind not null,
  body            text not null,
  captured_at     timestamptz not null default now()
);
create index if not exists visit_notes_appt_idx on public.visit_notes(appointment_id);

create table if not exists public.notes (
  id                  uuid primary key default gen_random_uuid(),
  family_id           uuid not null references public.families(id) on delete cascade,
  parent_id           uuid not null references public.parents(id) on delete cascade,
  body                text not null,
  kind                note_kind not null default 'note',
  linked_id           uuid,
  author_member_id    uuid references public.family_members(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists notes_parent_idx on public.notes(parent_id, created_at desc);

create table if not exists public.handoffs (
  id                  uuid primary key default gen_random_uuid(),
  family_id           uuid not null references public.families(id) on delete cascade,
  parent_id           uuid not null references public.parents(id) on delete cascade,
  from_member_id      uuid references public.family_members(id) on delete set null,
  to_member_id        uuid not null references public.family_members(id) on delete cascade,
  summary             text not null,
  personal_message    text,
  sent_at             timestamptz not null default now(),
  accepted_at         timestamptz,
  until               timestamptz not null
);
create index if not exists handoffs_parent_idx on public.handoffs(parent_id, sent_at desc);

create table if not exists public.thread_messages (
  id                  uuid primary key default gen_random_uuid(),
  family_id           uuid not null references public.families(id) on delete cascade,
  parent_id           uuid not null references public.parents(id) on delete cascade,
  body                text not null,
  is_digest           boolean not null default false,
  author_member_id    uuid references public.family_members(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists thread_messages_parent_idx on public.thread_messages(parent_id, created_at);

-- Single row per parent: who is currently on duty.
create table if not exists public.on_duty (
  parent_id   uuid primary key references public.parents(id) on delete cascade,
  family_id   uuid not null references public.families(id) on delete cascade,
  member_id   uuid not null references public.family_members(id) on delete cascade,
  until       timestamptz not null,
  updated_at  timestamptz not null default now()
);

-- ─── HELPER FUNCTIONS ───────────────────────────────────────────

-- True if the calling user is a member of the given family.
create or replace function public.is_family_member(fid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.family_members
    where family_id = fid and user_id = auth.uid()
  );
$$;
grant execute on function public.is_family_member(uuid) to authenticated;

-- Create a brand new family + put the caller in it as the owner.
create or replace function public.create_family(
  family_name text,
  member_name text,
  member_color member_color default 'sage'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_family_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  insert into public.families (name, created_by) values (family_name, auth.uid())
    returning id into new_family_id;
  insert into public.family_members (family_id, user_id, name, color, is_owner)
    values (new_family_id, auth.uid(), member_name, member_color, true);
  return new_family_id;
end;
$$;
grant execute on function public.create_family(text, text, member_color) to authenticated;

-- Generate a short shareable code for a family invite.
create or replace function public.create_invite(fid uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
begin
  if not public.is_family_member(fid) then
    raise exception 'Not a member of this family';
  end if;
  -- 8-char base32-ish code
  new_code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
  insert into public.family_invites (family_id, code, created_by, expires_at)
    values (fid, new_code, auth.uid(), now() + interval '14 days');
  return new_code;
end;
$$;
grant execute on function public.create_invite(uuid) to authenticated;

-- Accept an invite: caller joins the family the code points to.
create or replace function public.accept_invite(
  code_in text,
  member_name text,
  member_color member_color default 'sage'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  fid uuid;
  invite_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select i.id, i.family_id into invite_id, fid
    from public.family_invites i
    where i.code = upper(code_in)
      and i.revoked_at is null
      and (i.expires_at is null or i.expires_at > now())
    limit 1;
  if fid is null then
    raise exception 'Invite is invalid or expired';
  end if;
  -- Idempotent: if already a member, just return the family id.
  if exists (select 1 from public.family_members
             where family_id = fid and user_id = auth.uid()) then
    return fid;
  end if;
  insert into public.family_members (family_id, user_id, name, color)
    values (fid, auth.uid(), member_name, member_color);
  return fid;
end;
$$;
grant execute on function public.accept_invite(text, text, member_color) to authenticated;

-- ─── ROW-LEVEL SECURITY ─────────────────────────────────────────

alter table public.families         enable row level security;
alter table public.family_members   enable row level security;
alter table public.family_invites   enable row level security;
alter table public.parents          enable row level security;
alter table public.medications      enable row level security;
alter table public.med_doses        enable row level security;
alter table public.symptoms         enable row level security;
alter table public.appointments     enable row level security;
alter table public.visit_notes      enable row level security;
alter table public.notes            enable row level security;
alter table public.handoffs         enable row level security;
alter table public.thread_messages  enable row level security;
alter table public.on_duty          enable row level security;

-- families: members can read; only insert via create_family RPC.
drop policy if exists "families read"   on public.families;
drop policy if exists "families update" on public.families;
create policy "families read"   on public.families for select using (public.is_family_member(id));
create policy "families update" on public.families for update using (
  exists (
    select 1 from public.family_members
    where family_id = families.id
      and user_id   = auth.uid()
      and is_owner  = true
  )
);

-- family_members: visible to fellow members.
drop policy if exists "members read"   on public.family_members;
drop policy if exists "members update" on public.family_members;
drop policy if exists "members delete" on public.family_members;
create policy "members read"   on public.family_members for select using (public.is_family_member(family_id));
create policy "members update" on public.family_members for update using (user_id = auth.uid());
create policy "members delete" on public.family_members for delete using (is_owner = false and user_id = auth.uid());

-- Members can UPDATE their own row (policy above), but the UPDATE policy alone
-- doesn't stop them from setting is_owner=true on themselves. Enforce that
-- ownership changes require an existing owner via a BEFORE UPDATE trigger.
create or replace function public.enforce_owner_change_by_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.is_owner is distinct from OLD.is_owner then
    if not exists (
      select 1
      from public.family_members
      where family_id = OLD.family_id
        and user_id   = auth.uid()
        and is_owner  = true
        and deleted_at is null
    ) then
      raise exception 'Only family owners can change is_owner';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists family_members_enforce_owner_change on public.family_members;
create trigger family_members_enforce_owner_change
  before update on public.family_members
  for each row
  execute function public.enforce_owner_change_by_owner();

-- family_invites: members can list/revoke; creation goes through create_invite RPC.
drop policy if exists "invites read"   on public.family_invites;
drop policy if exists "invites update" on public.family_invites;
create policy "invites read"   on public.family_invites for select using (public.is_family_member(family_id));
create policy "invites update" on public.family_invites for update using (public.is_family_member(family_id));

-- All shared-data tables: members of the family can do everything.
do $$
declare t text;
begin
  for t in select unnest(array[
    'parents','medications','med_doses','symptoms','appointments',
    'visit_notes','notes','handoffs','thread_messages','on_duty'
  ]) loop
    execute format('drop policy if exists "%s rw" on public.%I', t, t);
    execute format(
      'create policy "%s rw" on public.%I for all using (public.is_family_member(family_id)) with check (public.is_family_member(family_id))',
      t, t
    );
  end loop;
end $$;

-- ─── REALTIME ───────────────────────────────────────────────────
-- Push changes to subscribed clients so multiple devices stay in sync.
do $$
declare t text;
begin
  for t in select unnest(array[
    'families','family_members','parents','medications','med_doses',
    'symptoms','appointments','visit_notes','notes','handoffs',
    'thread_messages','on_duty'
  ]) loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
