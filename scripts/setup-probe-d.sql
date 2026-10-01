-- Probe D setup (G2-54). Run AFTER creating the account in the dashboard.
--
-- Probe D must end up as a LIVE, NON-OWNER member of probe A's family. That is
-- the one combination the escalation test needs and no existing probe has:
-- probe A owns its family (so promoting itself is a no-op, not an escalation),
-- and probe C must stay in the removed state as the migration-14 fixture.
--
-- Change this one line if you used a different address, then run the whole file.

-- NOTE: the address is written inline below rather than as a \set variable,
-- because \set and :'name' are psql meta-commands and the Supabase web SQL
-- editor is not psql — it sends this text straight to the server, so those
-- lines would fail with a syntax error. Change it on the two marked lines.

-- ---------------------------------------------------------------------------
-- 1. Add probe D to probe A's family as an ordinary member.
--
-- family_id is looked up from probe A's own membership rather than pasted, so a
-- typo cannot quietly put probe D in the wrong family — which would make every
-- escalation probe below pass for the wrong reason.
--
-- is_owner is left to its default (false) deliberately, and `color` defaults to
-- 'sage'. Only family_id, user_id and name are actually required.
-- ---------------------------------------------------------------------------
insert into public.family_members (family_id, user_id, name)
select
  (select fm.family_id
     from public.family_members fm
     join auth.users au on au.id = fm.user_id
    where au.email like 'rls-probe-%-a@halmoni-test.dev'
      and fm.is_owner = true
      and fm.deleted_at is null
    limit 1),
  u.id,
  'Probe D'
from auth.users u
where u.email = 'rls-probe-d@halmoni-test.dev'   -- <<< CHANGE HERE (1 of 2)
  -- Idempotent: running this twice must not create a second membership.
  and not exists (
    select 1 from public.family_members fm2 where fm2.user_id = u.id
  );

-- ---------------------------------------------------------------------------
-- 2. Verify the fixture. This is the part that matters.
--
-- Expect ONE row, reading: in_probe_a_family = true, is_owner = false,
-- removed = false. Anything else and the suite will report INCONCLUSIVE rather
-- than passing, which is the intended behaviour.
-- ---------------------------------------------------------------------------
select
  u.email,
  u.email_confirmed_at is not null          as confirmed,
  f.name                                    as family,
  fm.family_id = (
    select fm2.family_id
      from public.family_members fm2
      join auth.users au2 on au2.id = fm2.user_id
     where au2.email like 'rls-probe-%-a@halmoni-test.dev'
       and fm2.is_owner = true
       and fm2.deleted_at is null
     limit 1
  )                                         as in_probe_a_family,
  fm.is_owner,
  fm.deleted_at is not null                 as removed
from auth.users u
join public.family_members fm on fm.user_id = u.id
join public.families f on f.id = fm.family_id
where u.email = 'rls-probe-d@halmoni-test.dev';  -- <<< CHANGE HERE (2 of 2)
