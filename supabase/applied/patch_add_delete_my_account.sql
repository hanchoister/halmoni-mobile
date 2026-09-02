-- Patch: in-app account deletion.
--
-- App Store Review Guideline 5.1.1(v) requires any app that lets you create an
-- account to also let you delete it from inside the app. Halmoni had no such
-- path — no RPC, no UI — which is an automatic rejection.
--
-- The hard part is not deleting the user; it is deciding what happens to the
-- family's data. A family is shared, so one member leaving must NOT destroy
-- the other members' records. The rule implemented here:
--
--   * Family still has other live members  -> remove only this membership.
--     Their siblings keep every medication, dose and note.
--   * This user was the last live member   -> delete the whole family, which
--     cascades to parents, medications, doses, appointments, notes, invites
--     and everything else FK'd to it. Nothing is left orphaned.
--
-- Then the auth.users row is deleted. Every FK into auth.users already carries
-- an ON DELETE clause (family_members.user_id cascades; families.created_by and
-- family_invites.created_by set null), so that delete is safe and needs no
-- extra cleanup.
--
-- Returns a small JSON receipt so the client can show what happened and so a
-- support conversation has something concrete to reference.
--
-- Run once in the Supabase SQL Editor against halmoni-prod. Idempotent.

create or replace function public.delete_my_account()
returns json
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- Only a signed-in user may delete their own account. Nothing for anon here.
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Verify (should return true, true, false):
select
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_my_account'
  ) as function_exists,
  has_function_privilege('authenticated', 'public.delete_my_account()', 'execute') as authenticated_can_run,
  has_function_privilege('anon', 'public.delete_my_account()', 'execute') as anon_can_run;
