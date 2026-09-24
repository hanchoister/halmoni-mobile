-- A removed member can rejoin, if someone still in the family invites them.
--
-- Decided 2026-09-24 by Hana. The old behaviour was accidental rather than
-- chosen: accept_invite asked whether a membership row existed, without
-- filtering deleted_at — the same oversight as is_family_member had before
-- migration 14 — so a removed member hit the early return, got the family id
-- back, and no row was ever created or revived. They appeared to rejoin and
-- silently could not see anything.
--
-- The rule this implements: rejoining is not self-service. It needs a live
-- invite code, which only a current member can mint (create_invite checks
-- is_family_member). So a sibling who stepped back can come back when someone
-- still caring asks them to, and not otherwise.
--
-- Reviving rather than inserting is deliberate. family_members.id is referenced
-- by other rows — appointments.attending_member_id, notes.author_member_id,
-- consent attestations via parents.consent_attested_by — so a new row would
-- orphan that history and make a returning sibling look like a stranger who
-- never logged a dose. Their past work stays theirs.
--
-- This is the first user of migration 15's escape hatch. set_config's third
-- argument is is_local, so the permission to write deleted_at lasts for this
-- transaction only and cannot leak to a later statement on the same connection.

create or replace function public.accept_invite(code_in text, member_name text, member_color member_color default 'sage'::member_color)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  fid uuid;
  invite_id uuid;
  normalized text;
  existing record;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  normalized := translate(upper(trim(code_in)), 'ILOU', '1100');
  select i.id, i.family_id into invite_id, fid
    from public.family_invites i
    where (i.code = upper(trim(code_in)) or i.code = normalized)
      and i.revoked_at is null
      and (i.expires_at is null or i.expires_at > now())
    limit 1;
  if fid is null then
    raise exception 'Invite is invalid or expired';
  end if;

  select id, deleted_at into existing
    from public.family_members
    where family_id = fid and user_id = auth.uid()
    limit 1;

  if existing.id is not null then
    -- Already a live member: unchanged behaviour, idempotent.
    if existing.deleted_at is null then
      return fid;
    end if;

    -- Previously removed: revive the original row, keeping its history.
    perform set_config('halmoni.allow_member_removal', 'on', true);
    update public.family_members
       set deleted_at = null,
           name       = member_name,
           color      = member_color
     where id = existing.id;
    return fid;
  end if;

  insert into public.family_members (family_id, user_id, name, color)
    values (fid, auth.uid(), member_name, member_color);
  return fid;
end;
$function$;
