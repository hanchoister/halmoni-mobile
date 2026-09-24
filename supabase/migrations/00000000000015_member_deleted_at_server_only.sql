-- Make family_members.deleted_at server-only, so "removed" cannot be undone
-- by the person who was removed.
--
-- Decision recorded 2026-09-24 (option D): Halmoni is NOT committing yet to a
-- rule about who may remove whom. There is no removal flow in the app, and
-- departure keeps using the existing self hard-delete path. This migration
-- only closes the hole and reserves the column.
--
-- What the hole was. "members update" is
--
--     USING (user_id = auth.uid())          -- and no WITH CHECK
--
-- so at SQL level a member may rewrite any column of their own row, deleted_at
-- included. Setting is_owner is already blocked by a trigger
-- (enforce_owner_change_by_owner); deleted_at was not.
--
-- Why it looks closed already, and why that is not good enough. After
-- migration 14 a removed member cannot SELECT their own row, and PostgREST
-- resolves the target rows of a PATCH through a SELECT — so the un-remove now
-- silently affects zero rows. Verified: HTTP 204, updated_at unchanged. That
-- protection is a property of the client library, not of the database. A
-- different client, a direct connection, or a change in how PostgREST plans
-- updates would reopen it. Defence that depends on the shape of the caller is
-- not defence.
--
-- The escape hatch is deliberate. A future removal flow will need to write this
-- column, and it should not need another migration to do it. Such a flow must
-- be a SECURITY DEFINER function that states its intent:
--
--     perform set_config('halmoni.allow_member_removal', 'on', true);
--
-- set_config's third argument is `is_local`, so the permission lasts for the
-- current transaction only and cannot leak into a later statement on the same
-- connection. Anything that has not said that sentence cannot touch the column.

create or replace function public.enforce_member_removal_server_only()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if NEW.deleted_at is distinct from OLD.deleted_at then
    if auth.uid() is not null
       and coalesce(current_setting('halmoni.allow_member_removal', true), '') <> 'on' then
      raise exception 'Membership removal is not something a client may write. See migration 15.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists enforce_member_removal_server_only on public.family_members;

create trigger enforce_member_removal_server_only
  before update on public.family_members
  for each row
  execute function public.enforce_member_removal_server_only();
