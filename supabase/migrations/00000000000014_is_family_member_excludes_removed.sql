-- A removed member keeps full read AND write access to the family's medical
-- record, for ever.
--
-- Found 2026-09-20 by the RLS attack suite (G1-03), with a real user JWT:
-- set a member's deleted_at, then ask for the family's data. The member read
-- every parent and medication, and successfully renamed a medication.
--
-- The cause is one missing condition. is_family_member() is the single
-- predicate behind every policy on all 26 public tables:
--
--     select auth.uid() is not null
--        and exists (select 1 from public.family_members
--                     where family_id = fid and user_id = auth.uid());
--
-- It asks whether a membership row exists. It never asks whether that
-- membership is still live. So soft-deleting a member revokes nothing.
--
-- That the intent was the opposite is already visible next door:
-- enforce_owner_change_by_owner() filters `and deleted_at is null` when it
-- checks whether the caller owns the family. This function was simply never
-- updated to match when family_members gained deleted_at.
--
-- How exposed is it today? Not very, and that is luck rather than design.
-- The app has no "remove a sibling" flow, and the members policies only let a
-- user soft-delete their own row — so nobody is currently in the removed state.
-- But the state is reachable through the API right now, and the day a beta
-- family asks to remove a brother who has stepped back, the feature that
-- answers them will silently grant him permanent access to a parent's
-- medications, DNR status and insurance details. Fixing the predicate is one
-- line; fixing it after that feature ships is an incident.
--
-- STABLE and SECURITY DEFINER are preserved, as is the pinned search_path.

create or replace function public.is_family_member(fid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null
     and exists (
       select 1 from public.family_members
        where family_id = fid
          and user_id = auth.uid()
          and deleted_at is null
     );
$function$;
