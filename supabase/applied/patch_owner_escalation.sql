-- Patch: block family_members.is_owner self-escalation.
-- Run this once in the Supabase SQL Editor against halmoni-prod.
-- Idempotent — safe to re-run.

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
