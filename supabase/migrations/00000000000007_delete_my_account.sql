-- Account deletion.
--
-- This function was live on prod but its definition lived only in the retired
-- web repo (~/tend/supabase/patch_add_delete_my_account.sql). Rebuilding the
-- database from this repo's migrations alone would have produced an app whose
-- "Delete my account" button called a function that did not exist — and App
-- Store guideline 5.1.1(v) requires in-app account deletion to work.
--
-- Captured from the live definition on halmoni-prod, 2026-09-07.

create or replace function public.delete_my_account()
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  fam record;
  families_deleted int := 0;
  memberships_removed int := 0;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  for fam in
    select distinct fm.family_id
    from public.family_members fm
    where fm.user_id = uid
  loop
    -- Is anyone else still live in this family?
    if not exists (
      select 1
      from public.family_members other
      where other.family_id = fam.family_id
        and other.deleted_at is null
        and other.user_id is distinct from uid
    ) then
      delete from public.families where id = fam.family_id;
      families_deleted := families_deleted + 1;
    else
      delete from public.family_members
       where family_id = fam.family_id
         and user_id = uid;
      memberships_removed := memberships_removed + 1;
    end if;
  end loop;

  -- Belt and braces: drop any membership row still pointing at this user
  -- before removing the account itself.
  delete from public.family_members where user_id = uid;

  delete from auth.users where id = uid;

  return json_build_object(
    'families_deleted',    families_deleted,
    'memberships_removed', memberships_removed
  );
end;
$function$;

grant execute on function public.delete_my_account() to authenticated;
