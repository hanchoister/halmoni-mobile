-- G2-60: make unauthenticated access fail closed instead of incidentally.
--
-- THE PROBLEM
--
-- All 66 policies in `public` were scoped `TO public`. That is the PostgreSQL
-- default when a policy names no role, and the `public` role includes `anon` —
-- so every policy on every table holding the health record was reachable with
-- the publishable key, which ships inside the app binary and sits in eas.json.
--
-- Nothing leaked. Checked on 2026-10-01 rather than assumed: anonymous reads of
-- parents, medications, med_doses, family_members, notes and audit_log each
-- returned HTTP 200 with `[]`, and a sweep of every INSERT/UPDATE/ALL policy in
-- `public` found none whose WITH CHECK or USING omits auth.uid() or a
-- membership function. For `anon`, auth.uid() is NULL, so each predicate
-- evaluates false and the row is filtered out.
--
-- The problem is WHY it held. Confidentiality rested on all 66 predicates being
-- written correctly, and on every future one being written correctly too. That
-- has already failed exactly once, in exactly this way:
-- `evergreen_metrics_insert_anon` carried a WITH CHECK of `true` and handed
-- anyone holding the publishable key HTTP 201 into the production database
-- (G2-51, migration 17). One future policy written without an identity check is
-- an immediate hole.
--
-- Scoping policies to `authenticated` moves the guarantee from "every predicate
-- is correct" to "an unauthenticated request is refused by role, before any
-- predicate runs". A future sloppy predicate then fails closed.
--
-- WHY THIS IS SAFE — each of these was verified, not assumed
--
--   * Nothing in the app needs anon access to a `public` table. Sign-in goes
--     through GoTrue at /auth/v1, not PostgREST, so revoking PostgREST grants
--     cannot affect it. All five RPC call sites (create_invite x2,
--     create_family, accept_invite, delete_my_account) run after sign-in, and
--     anon already has no EXECUTE on any of them. Demo mode is an in-memory
--     impersonator (src/lib/supabase-demo.ts) that never touches a real table.
--     The waitlist posts to Formspree.
--   * `service_role` has BYPASSRLS (pg_roles.rolbypassrls = true), so it is not
--     subject to policies at all and nothing server-side is narrowed by this.
--     Same for `postgres`, which is how the backup job connects.
--   * evergreen_metrics already has zero anon grants and zero rows.
--
-- THE DEFAULT PRIVILEGES ARE THE ACTUAL ROOT CAUSE
--
-- Revoking today's grants is not enough. `pg_default_acl` carries
-- `anon=arwdDxtm` for tables in `public`, from both `postgres` and
-- `supabase_admin` — so the next table anyone creates is granted to anon again,
-- automatically, and the problem returns without anybody doing anything wrong.
-- Section 4 fixes that, and is the part that makes this stick.

begin;

-- 1. Every policy in `public` -> TO authenticated.
--
-- Done as a loop rather than 66 hand-written statements so it cannot miss one,
-- and quote_ident because several policy names contain spaces ("families read",
-- "members update"). ALTER POLICY changes only the role list; USING and
-- WITH CHECK are left exactly as they are, so this cannot alter who among
-- signed-in users can see what.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and (roles = '{public}'::name[] or 'anon' = any(roles))
  loop
    execute format(
      'alter policy %I on %I.%I to authenticated',
      r.policyname, r.schemaname, r.tablename
    );
    n := n + 1;
  end loop;
  raise notice 'G2-60: re-scoped % policies in public to authenticated', n;
end $$;

-- 2. Revoke anon's grants in `public`.
--
-- Belt and braces: with the policies scoped to `authenticated`, anon has no
-- policy to satisfy and is already refused. Revoking the grants means the
-- refusal happens at the permission layer, before RLS is consulted at all.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- 3. Revoke anon's EXECUTE in `public`.
--
-- Tidiness rather than a fix, stated honestly. The four user-facing RPCs
-- already deny anon. What is left executable is is_family_member (SECURITY
-- DEFINER, but it reads auth.uid(), so it returns false for anon) and five
-- trigger functions, which PostgreSQL refuses to call directly in any case
-- ("trigger functions can only be called as triggers"). Neither is reachable
-- as an attack; both are surface that does not need to exist.
revoke all on all functions in schema public from anon;

-- 4. Stop future objects from granting anon all over again.
--
-- This is the part that keeps the fix from decaying. ALTER DEFAULT PRIVILEGES
-- applies per creating role, so it has to be set for each role that creates
-- objects here. `postgres` is the one migrations run as. `supabase_admin` is
-- platform-owned and this may not have the privilege to change it — that is
-- caught and reported rather than failing the migration, because sections 1–4
-- are worth having even if the last line cannot be set.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;

do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on functions from anon';
  raise notice 'G2-60: default privileges cleared for supabase_admin too';
exception
  when insufficient_privilege then
    raise notice 'G2-60: could NOT clear supabase_admin default privileges (not a member of that role). A table created BY supabase_admin would still be granted to anon. verify-policies.mjs will catch it if that ever happens.';
end $$;

-- 5. The storage policies have the same shape.
--
-- All three attachments policies are family-scoped through is_family_member, so
-- like the public ones they do not leak today. They are `TO public` for the same
-- reason and get the same treatment.
--
-- Separate block with its own handler because storage.objects is owned by
-- supabase_storage_admin, and ALTER POLICY needs table ownership — this may not
-- have it. Blast radius today is nil either way: the attachments bucket is a
-- Track P parity feature that the mobile app does not yet use.
--
-- Supabase's own grants on storage.objects are deliberately NOT revoked. That
-- schema is platform-managed, the storage API's own roles depend on them, and
-- the policies are what actually decide access.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'storage'
      and (roles = '{public}'::name[] or 'anon' = any(roles))
  loop
    execute format(
      'alter policy %I on %I.%I to authenticated',
      r.policyname, r.schemaname, r.tablename
    );
    n := n + 1;
  end loop;
  raise notice 'G2-60: re-scoped % policies in storage to authenticated', n;
exception
  when insufficient_privilege then
    raise notice 'G2-60: could NOT re-scope storage policies (storage.objects is owned by supabase_storage_admin). They stay TO public; all three are family-scoped via is_family_member, so this is untidy rather than exposed.';
end $$;

commit;

-- VERIFY — this should print zero rows in both results.
--
-- Run it after the commit. Anything returned here is a policy or grant that
-- escaped, which means the migration did not fully apply.
select 'policy still open to anon' as problem, schemaname, tablename, policyname
from pg_policies
where schemaname in ('public', 'storage')
  and (roles = '{public}'::name[] or 'anon' = any(roles));

select 'grant still held by anon' as problem, table_schema, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public';
