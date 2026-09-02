-- Patch: the owner-authorization check must ignore soft-deleted owners.
--
-- patch_owner_escalation.sql (applied 2026-08-26) added a trigger requiring an
-- existing owner to authorize any is_owner change. But its check predates the
-- deleted_at column, so it counts soft-deleted rows as valid owners: a member
-- who has been removed from a family — deleted_at set, but the row still
-- present — could still authorize ownership changes in that family.
--
-- The mobile copy of this trigger already had the deleted_at guard. This
-- aligns prod and tend with it. Verified 2026-08-26: zero soft-deleted owners
-- on prod, so this changes no existing behaviour.
--
-- Run once in the Supabase SQL Editor against halmoni-prod. Idempotent.

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

-- The trigger itself is unchanged and already exists; no need to recreate it.

-- Verify the guard is present (should return true):
select pg_get_functiondef(p.oid) like '%deleted_at is null%' as has_deleted_at_guard
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'enforce_owner_change_by_owner';
