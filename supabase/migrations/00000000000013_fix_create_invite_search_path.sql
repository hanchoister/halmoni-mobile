-- create_invite has been broken on production: nobody can invite a sibling.
--
-- Found 2026-09-20 by the RLS attack suite (G1-03), which tried to add a second
-- member to a family the way a real user would and got:
--
--   42883  function gen_random_bytes(integer) does not exist
--
-- gen_random_bytes comes from pgcrypto, and on Supabase pgcrypto is installed
-- into the `extensions` schema, not `public`. create_invite is declared
--
--   SECURITY DEFINER SET search_path TO 'public'
--
-- so the function cannot see it. The pinned search_path is correct and must
-- stay — an unpinned search_path on a SECURITY DEFINER function is a privilege
-- escalation waiting to happen, because the caller controls resolution. The fix
-- is to schema-qualify the call instead of widening the path.
--
-- Why nothing caught this: the two family_invites rows on production predate
-- the hardening that pinned search_path, and every check since has run over a
-- privileged connection that never called this function. It is a regression
-- introduced by a security fix, which is the kind only an end-to-end test on
-- the real path can find.
--
-- Only the gen_random_bytes call changes. The body is otherwise identical to
-- what is deployed, including the membership check and the 14-day expiry.

create or replace function public.create_invite(fid uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  new_code text := '';
  b bytea;
  i int;
begin
  if not public.is_family_member(fid) then
    raise exception 'Not a member of this family';
  end if;
  b := extensions.gen_random_bytes(10);
  for i in 0..9 loop
    new_code := new_code || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  insert into public.family_invites (family_id, code, created_by, expires_at)
    values (fid, new_code, auth.uid(), now() + interval '14 days');
  return new_code;
end;
$function$;
