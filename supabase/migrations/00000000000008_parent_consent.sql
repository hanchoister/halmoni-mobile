-- Parent consent — G1-28.
--
-- Halmoni stores medications, doses, diagnoses, symptoms, insurance, emergency
-- contacts and resuscitation preferences about a person who never installs the
-- app, never signs up, and until this migration was never asked. A search of
-- src/ for the word "consent" returned zero hits.
--
-- Why the attestation lives ON the parent row rather than in a table beside it:
-- every other health table hangs off parents by foreign key (medications,
-- med_doses, symptoms, appointments -> visit_notes). If a parent row cannot
-- exist without a recorded basis, then no medication, dose, symptom or note can
-- either. A separate consent table would need a join to check, and anything
-- that needs a join to check is something a future code path can forget.
--
-- Three regimes, one attestation:
--   * Washington My Health My Data Act — a "consumer" is the person the data is
--     ABOUT, so the parent counts in their own right and the statute conditions
--     collection on their consent. No revenue or user-count threshold, and a
--     private right of action. Maxwell v. Amazon (filed 10 Feb 2025) was built
--     on consent-and-disclosure failures, not a breach.
--   * Apple 5.1.1(viii) and 5.1.2(i) — an app may not compile personal
--     information "without the user's explicit consent". Beta App Review
--     applies this to TestFlight, not just to release.
--   * California CMIA — deemed health-care-provider status at one California
--     user, $1,000 nominal damages, no proof of harm required.
--
-- The archived app privacy policy already told users this existed — "You
-- confirm you have it when you enter their information." This migration is what
-- makes that sentence true rather than a false statement of data practice.

-- ---------------------------------------------------------------------------
-- 1. The attestation itself.
-- ---------------------------------------------------------------------------
-- consent_attested_by holds auth.uid(), not a family_members.id. Membership
-- rows are soft-deletable and re-creatable; the point of an attestation is that
-- it still names someone after they leave the family.
alter table parents add column if not exists consent_basis          text;
alter table parents add column if not exists consent_attested_at    timestamptz;
alter table parents add column if not exists consent_attested_by    uuid;
alter table parents add column if not exists consent_notice_version text;

comment on column parents.consent_basis is
  'Why this family may hold this person''s health data: parent_agreed | healthcare_proxy | power_of_attorney | guardianship. Mirrored in src/lib/consent.ts and checked by scripts/verify-consent.js.';
comment on column parents.consent_notice_version is
  'Version of the wording the attesting user was shown. The text of every version is archived in src/lib/consent.ts so it can be produced later.';

-- Shape: either there is no attestation at all, or there is a complete one with
-- a basis from the known set. A half-filled attestation is not evidence of
-- anything, so the database refuses to store one.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'parents_consent_shape'
  ) then
    alter table parents add constraint parents_consent_shape check (
      (
        consent_basis is null
        and consent_attested_at is null
        and consent_attested_by is null
        and consent_notice_version is null
      )
      or (
        consent_basis in (
          'parent_agreed',
          'healthcare_proxy',
          'power_of_attorney',
          'guardianship'
        )
        and consent_attested_at is not null
        and consent_attested_by is not null
        and consent_notice_version is not null
      )
    );
  end if;
end $$;

-- Presence: a live parent row must carry one. Tombstoned rows are exempt so a
-- pre-migration row can still be deleted — deleting an unattested record is the
-- correct outcome, and a constraint that blocked it would trap the data here.
--
-- NOT VALID means "enforce on every insert and update from now on, don't
-- retroactively verify rows already here". The validation is attempted at the
-- bottom of this file and succeeds outright on any database that has no
-- pre-existing parent rows.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'parents_consent_required'
  ) then
    alter table parents add constraint parents_consent_required
      check (deleted_at is not null or consent_basis is not null) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The evidence trail.
-- ---------------------------------------------------------------------------
-- Washington and California both expect you to be able to produce the record of
-- consent, not merely assert it. This table is written only by the trigger
-- below, which means it records what actually reached the database rather than
-- what a client claimed to have done — offline creations included, since the
-- trigger fires when the row finally syncs.
--
-- recorded_by is auth.uid() at write time and claimed_by is what the row said.
-- They should always match; if they ever don't, that difference is the tell.
create table if not exists parent_consent_events (
  id                     uuid primary key default gen_random_uuid(),
  parent_id              uuid not null references parents(id) on delete cascade,
  family_id              uuid not null references families(id) on delete cascade,
  event                  text not null,   -- attested | re_attested | revoked_by_deletion
  consent_basis          text,
  consent_attested_at    timestamptz,
  consent_notice_version text,
  claimed_by             uuid,
  recorded_by            uuid,
  recorded_at            timestamptz not null default now()
);
create index if not exists parent_consent_events_parent_idx on parent_consent_events (parent_id);
create index if not exists parent_consent_events_family_idx on parent_consent_events (family_id, recorded_at desc);

-- Append-only from the outside: family members may read their own family's
-- trail, and nothing that speaks PostgREST may write, edit or erase it. The
-- trigger is SECURITY DEFINER, so it writes regardless.
alter table parent_consent_events enable row level security;
drop policy if exists parent_consent_events_select on parent_consent_events;
create policy parent_consent_events_select on parent_consent_events
  for select using (is_family_member(family_id));
revoke all on parent_consent_events from anon, authenticated;
grant select on parent_consent_events to authenticated;
-- Explicit, rather than leaning on Supabase's default privileges for new tables
-- in public: those defaults are the reason the revoke above is needed at all,
-- and a rule you rely on in one direction should not be relied on in the other.

-- ---------------------------------------------------------------------------
-- 3. Enforcement that can explain itself.
-- ---------------------------------------------------------------------------
-- The check constraint above is the guarantee; this trigger is the sentence a
-- human reads when it fires, plus the two rules a CHECK cannot express: a
-- timestamp is not allowed to be in the future (CHECK forbids now()), and an
-- attestation already on a row may not be quietly erased by a later write.
create or replace function enforce_parent_consent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.deleted_at is null and NEW.consent_basis is null then
    raise exception
      'A parent record needs a recorded basis for holding their health data (consent_basis). See G1-28.'
      using errcode = 'check_violation';
  end if;

  if NEW.consent_attested_at is not null
     and NEW.consent_attested_at > now() + interval '1 day' then
    raise exception 'consent_attested_at cannot be in the future'
      using errcode = 'check_violation';
  end if;

  if TG_OP = 'UPDATE'
     and OLD.consent_basis is not null
     and NEW.consent_basis is null
     and NEW.deleted_at is null then
    raise exception
      'An attestation cannot be erased. Delete the parent record instead — that is what withdrawing permission means.'
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

drop trigger if exists parents_enforce_consent on parents;
create trigger parents_enforce_consent
  before insert or update on parents
  for each row
  execute function enforce_parent_consent();

create or replace function record_parent_consent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text;
begin
  if TG_OP = 'INSERT' then
    kind := 'attested';
  elsif NEW.deleted_at is not null and OLD.deleted_at is null then
    kind := 'revoked_by_deletion';
  elsif NEW.consent_basis is distinct from OLD.consent_basis
     or NEW.consent_attested_at is distinct from OLD.consent_attested_at then
    kind := 're_attested';
  else
    return NEW;   -- an ordinary edit: nothing about consent changed
  end if;

  insert into parent_consent_events (
    parent_id, family_id, event, consent_basis, consent_attested_at,
    consent_notice_version, claimed_by, recorded_by
  ) values (
    NEW.id, NEW.family_id, kind, NEW.consent_basis, NEW.consent_attested_at,
    NEW.consent_notice_version, NEW.consent_attested_by, auth.uid()
  );
  return NEW;
end;
$$;

drop trigger if exists parents_record_consent on parents;
create trigger parents_record_consent
  after insert or update on parents
  for each row
  execute function record_parent_consent();

-- ---------------------------------------------------------------------------
-- 4. Row-level security carries the same rule.
-- ---------------------------------------------------------------------------
-- The generic family-scoped policies in 00000000000002 allow any member to
-- insert any parent row. Repeat the consent condition here so it holds even if
-- a trigger is ever dropped: three independent layers, and a write has to pass
-- all three.
--
-- The predicate matches the constraint exactly (tombstones exempt) because the
-- sync engine deletes by upserting the whole row with deleted_at set, which
-- PostgREST evaluates against the INSERT policy's WITH CHECK.
--
-- Production does not have the four policies 00000000000002 creates. Its
-- tables were built by hand, and each carries a single permissive FOR ALL
-- policy named "<table> rw" instead. Permissive policies OR together, so
-- adding parents_insert beside "parents rw" would change nothing: any family
-- member could still insert an unattested row through the older policy. Drop
-- it, and restate select and delete exactly as 00000000000002 does, so the
-- result is the same four policies on every database. On one built from these
-- migrations, the drop is a no-op.
drop policy if exists "parents rw" on parents;

drop policy if exists parents_select on parents;
create policy parents_select on parents
  for select using (is_family_member(family_id));

drop policy if exists parents_delete on parents;
create policy parents_delete on parents
  for delete using (is_family_member(family_id));

drop policy if exists parents_insert on parents;
create policy parents_insert on parents
  for insert with check (
    is_family_member(family_id)
    and (deleted_at is not null or consent_basis is not null)
  );

drop policy if exists parents_update on parents;
create policy parents_update on parents
  for update using (is_family_member(family_id))
  with check (
    is_family_member(family_id)
    and (deleted_at is not null or consent_basis is not null)
  );

-- ---------------------------------------------------------------------------
-- 5. Promote the constraint if this database has nothing left to fix.
-- ---------------------------------------------------------------------------
-- On a fresh database this validates immediately and the guarantee is total.
-- Where rows predate the migration it says so rather than pretending: those
-- rows cannot be edited (any update re-checks the row) and cannot be joined by
-- new ones, but they are still here until someone attests or deletes them.
do $$
declare
  unattested int;
begin
  select count(*) into unattested
    from parents where deleted_at is null and consent_basis is null;

  if unattested = 0 then
    execute 'alter table parents validate constraint parents_consent_required';
    raise notice 'parents_consent_required is VALIDATED — every parent row carries an attestation.';
  else
    raise notice
      'parents_consent_required is enforced for new writes but NOT VALIDATED: % pre-existing row(s) carry no attestation. Attest or delete them, then run: alter table parents validate constraint parents_consent_required;',
      unattested;
  end if;
end $$;
