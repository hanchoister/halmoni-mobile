-- A member may edit five things about themselves, and nothing else (G2-52).
--
-- The policy is `USING (user_id = auth.uid())` with no WITH CHECK, so Postgres
-- reuses the USING expression as the check and every column passes it. Two
-- columns have already needed bolting down after the fact — `is_owner` by
-- enforce_owner_change_by_owner, `deleted_at` by migration 15 — and both were
-- found by someone noticing, not by the system refusing.
--
-- That is the shape of the bug rather than two coincidences: the next column
-- added to family_members is writable by its owner until somebody thinks to
-- stop it. So this is an ALLOW-LIST. Anything not named here is denied,
-- including columns that do not exist yet.
--
-- What a member may change about themselves:
--   name, relation, phone, color, photo_url
--
-- Everything else is refused:
--   id, family_id, user_id, created_at
--
-- family_id is the one that matters. Rewriting it would walk a member straight
-- into another family's medical record. Tested 2026-09-24 through PostgREST and
-- it was refused with 42501 — but the policy text does not constrain it, so
-- that protection was coming from how the client happens to issue the
-- statement, exactly like the un-remove case in migration 15. Defence that
-- depends on the shape of the caller is not defence.
--
-- is_owner, deleted_at and updated_at are permitted HERE and governed
-- elsewhere: the first two by their own triggers, the last by set_updated_at.
-- Listing them keeps this trigger from fighting the ones that already work.
--
-- Trigger ordering note: BEFORE UPDATE triggers fire in alphabetical order by
-- name, so whether set_updated_at has already stamped updated_at depends on
-- the name. Allowing it either way is why this does not care.

create or replace function public.enforce_member_self_edit_allowlist()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  allowed constant text[] := array[
    'name', 'relation', 'phone', 'color', 'photo_url',
    -- governed by their own triggers, not by this one
    'is_owner', 'deleted_at', 'updated_at'
  ];
  changed text[];
begin
  select coalesce(array_agg(o.key), '{}')
    into changed
    from jsonb_each(to_jsonb(OLD)) o
    join jsonb_each(to_jsonb(NEW)) n on n.key = o.key
   where o.value is distinct from n.value;

  if changed <@ allowed then
    return NEW;
  end if;

  raise exception
    'A member may only change their own name, relation, phone, colour or photo. Refused: %',
    array_to_string(array(select unnest(changed) except select unnest(allowed)), ', ')
    using errcode = 'insufficient_privilege';
end;
$function$;

-- Both names dropped so a re-run is clean whichever one is already there.
drop trigger if exists enforce_member_self_edit_allowlist on public.family_members;
drop trigger if exists zz_enforce_member_self_edit_allowlist on public.family_members;

-- Named to sort AFTER family_members_enforce_owner_change and
-- family_members_set_updated_at, so those run first and this one sees the row
-- as it will actually be written.
create trigger zz_enforce_member_self_edit_allowlist
  before update on public.family_members
  for each row
  execute function public.enforce_member_self_edit_allowlist();
