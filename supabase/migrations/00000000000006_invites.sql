-- Family invites: table, RPCs, and RLS.
--
-- ⚠️  DOCUMENTATION-ONLY MIGRATION — DO NOT APPLY TO halmoni-prod.
--
-- These objects already exist on prod. They were created by hand in the
-- Supabase dashboard and, until this file, lived in no migration anywhere —
-- meaning prod had behaviour that no source file described. This file closes
-- that gap. Definitions are transcribed verbatim from
-- `~/tend/supabase/schema.sql` (the single source of truth for prod), so
-- re-running it against prod is a no-op at best and a clobber at worst.
--
-- Two deliberate deviations from the other files in this directory:
--   1. Objects are `public.`-qualified, matching prod rather than the
--      unqualified style of migrations 00-05.
--   2. The RPCs take `member_color` (a Postgres enum on prod). Mobile's own
--      `family_members.color` is plain `text` — an unreconciled divergence.
--      Applying this file to a DB without that enum will fail on the RPCs.
--
-- Invite model: a family member generates a short code; anyone holding the
-- code can join that family. Codes expire after 14 days and can be revoked.

-- ─── TABLE ──────────────────────────────────────────────────────

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

-- Note: family_invites intentionally has no updated_at/deleted_at. It is not
-- one of the 12 mobile-synced tables, so the sync-column patch skipped it.

-- ─── RPCs ───────────────────────────────────────────────────────

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

-- Members can list and revoke their family's invites. Creation goes through
-- create_invite (SECURITY DEFINER), so there is deliberately no INSERT policy.
alter table public.family_invites enable row level security;

drop policy if exists "invites read"   on public.family_invites;
drop policy if exists "invites update" on public.family_invites;
create policy "invites read"   on public.family_invites for select using (public.is_family_member(family_id));
create policy "invites update" on public.family_invites for update using (public.is_family_member(family_id));
