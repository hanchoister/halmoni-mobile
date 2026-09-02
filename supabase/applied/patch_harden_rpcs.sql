-- Patch: close out the security-advisor findings from 2026-08-31.
--
-- S-02  Invite codes carry only ~32 bits of entropy.
-- S-03  anon holds EXECUTE on RPCs it should never call.
-- S-04  Two trigger functions have a mutable search_path.
--
-- None of these is a live hole today. They are the kind of thing that becomes
-- one quietly, as the number of families grows.
--
-- APPLIED to halmoni-prod 2026-08-31; all verification rows returned true.
--
-- Run once in the Supabase SQL Editor against halmoni-prod. Idempotent.


-- ── S-02 ── Invite code entropy ──────────────────────────────────────────
--
-- The old code was `upper(substring(replace(gen_random_uuid()::text,'-','')
-- from 1 for 8))` — the first 8 HEX characters of a UUID. The comment called it
-- "base32-ish"; it was base16, so 16^8 ≈ 4.3e9, about 32 bits.
--
-- Why that matters more than it looks: an attacker does not need to guess a
-- SPECIFIC family's code. Any live code gets them into some family's records,
-- so the expected work is 2^32 / (number of outstanding invites) — it gets
-- cheaper as Halmoni grows, which is precisely backwards. Codes also live for
-- 14 days, and accept_invite is reachable by any signed-up user.
--
-- Now 10 characters of Crockford base32 = 50 bits, ~250,000x harder, while
-- staying readable aloud: the alphabet omits I, L, O and U, so there is no
-- 1/I/l or 0/O confusion to mis-hear. 256 is an exact multiple of 32, so the
-- modulo introduces no bias.

create or replace function public.create_invite(fid uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  new_code text := '';
  b bytea;
  i int;
begin
  if not public.is_family_member(fid) then
    raise exception 'Not a member of this family';
  end if;

  b := gen_random_bytes(10);
  for i in 0..9 loop
    new_code := new_code || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;

  insert into public.family_invites (family_id, code, created_by, expires_at)
    values (fid, new_code, auth.uid(), now() + interval '14 days');
  return new_code;
end;
$$;

-- Accept the code the way a human would retype it: trim spaces, uppercase, and
-- fold the characters the alphabet deliberately excludes onto what the speaker
-- almost certainly meant. Existing 8-char hex codes still validate unchanged.
create or replace function public.accept_invite(
  code_in text,
  member_name text,
  member_color member_color default 'sage'::member_color
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  fid uuid;
  invite_id uuid;
  normalized text;
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

  if exists (select 1 from public.family_members
             where family_id = fid and user_id = auth.uid()) then
    return fid;
  end if;

  insert into public.family_members (family_id, user_id, name, color)
    values (fid, auth.uid(), member_name, member_color);
  return fid;
end;
$$;


-- ── S-03 ── Stop anon reaching RPCs meant for signed-in users ────────────
--
-- All three already refuse an anonymous caller internally (create_family and
-- accept_invite check auth.uid(); create_invite fails is_family_member), so
-- this is defence in depth rather than a fix. Removing the grant means a future
-- edit that drops an internal guard is not instantly exploitable.
--
-- get_er_card_by_token is deliberately NOT revoked: an EMT scanning the card
-- has no account. Its exposure is tracked separately as S-05.

-- NOTE: revoking from `anon` alone does nothing. Postgres grants EXECUTE on
-- every new function to PUBLIC, and anon inherits that, so the grant has to be
-- taken from PUBLIC and handed back to authenticated explicitly. Confirmed the
-- hard way on 2026-08-31: the anon-only revoke ran clean and changed nothing.
revoke execute on function public.create_family(text, text, member_color) from public, anon;
revoke execute on function public.create_invite(uuid) from public, anon;
revoke execute on function public.accept_invite(text, text, member_color) from public, anon;

grant execute on function public.create_family(text, text, member_color) to authenticated;
grant execute on function public.create_invite(uuid) to authenticated;
grant execute on function public.accept_invite(text, text, member_color) to authenticated;

-- Trigger functions are invoked by the trigger, not called over the API, and
-- trigger execution does not check EXECUTE. Nobody needs this grant.
revoke all on function public.enforce_owner_change_by_owner() from public, anon, authenticated;


-- ── S-04 ── Pin search_path on the remaining trigger functions ───────────
--
-- Without it, a SECURITY DEFINER function resolves unqualified names against
-- the caller's search_path, so a table shadowing one of ours changes what the
-- function touches. Both bodies are reset verbatim apart from the SET.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$;

create or replace function public.private_journal_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$;


-- ── Verify ── every row should read true ─────────────────────────────────
select 'invite codes use the 50-bit alphabet' as check,
       (select pg_get_functiondef(p.oid) like '%0123456789ABCDEFGHJKMNPQRSTVWXYZ%'
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname='create_invite') as ok
union all
select 'accept_invite folds I/L/O/U',
       (select pg_get_functiondef(p.oid) like '%translate(%'
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname='accept_invite')
union all
select 'anon cannot create_family',
       not has_function_privilege('anon', 'public.create_family(text, text, member_color)', 'execute')
union all
select 'anon cannot create_invite',
       not has_function_privilege('anon', 'public.create_invite(uuid)', 'execute')
union all
select 'anon cannot accept_invite',
       not has_function_privilege('anon', 'public.accept_invite(text, text, member_color)', 'execute')
union all
select 'authenticated CAN still accept_invite',
       has_function_privilege('authenticated', 'public.accept_invite(text, text, member_color)', 'execute')
union all
select 'authenticated CAN still create_invite',
       has_function_privilege('authenticated', 'public.create_invite(uuid)', 'execute')
union all
select 'set_updated_at has search_path',
       (select 'search_path=public' = any(proconfig)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname='set_updated_at')
union all
select 'journal touch has search_path',
       (select 'search_path=public' = any(proconfig)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname='private_journal_touch_updated_at');
