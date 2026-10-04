-- G2-61 part 2: a deleted record stops containing anything.
--
-- THE PROBLEM, AND IT WAS WORSE THAN THE ITEM SAID
--
-- "Delete" has never deleted anything, on either side.
--
-- On the SERVER, delete is a soft delete: deleted_at is set and the row stays
-- intact. Measured on production 2026-10-04, before this migration: 805
-- tombstoned med_doses, 4 medications, and 2 parents — two people whose records
-- had been "deleted" and whose names, conditions, allergies and DNR status were
-- still sitting in Postgres. There is no purge job of any kind.
--
-- On each PHONE, the same: the app filters tombstoned rows out of what it shows,
-- so the record vanishes from view while the medication names and note text stay
-- in that device's SQLite file.
--
-- Meanwhile the published privacy policy said deletion reached "every phone in
-- the circle", and that deleted information "disappears from the app straight
-- away and from our backup copies within 30 days". The first was false. The
-- second was misleading in a way that is easy to miss: backups do roll over, but
-- the live row never went anywhere, so every new backup kept including it.
--
-- WHY A TRIGGER, AND WHY THAT FIXES THE PHONES TOO
--
-- Blanking the content the moment deleted_at is set means:
--
--   1. The server stops holding it immediately — no grace period to get wrong,
--      and no scheduled job to install, monitor and have fail silently.
--   2. Every phone is fixed for free. Blanking bumps updated_at (set_updated_at
--      fires on the same UPDATE), so the blanked row is a normal sync delta:
--      every device pulls it and overwrites its own copy through the ordinary
--      pull path. One change at the centre purges the whole family.
--   3. The deleting device gets there too, on its next pull, which is the same
--      cycle as the push.
--
-- The row itself STAYS. Tombstones are what tell other devices a thing was
-- deleted rather than never seen, so removing the row would break sync. What is
-- left is a shell: ids, timestamps, and nothing about anybody.
--
-- WHAT IS DELIBERATELY NOT BLANKED
--
--   * family_members and families. A member's name is not the parent's health
--     record, and it is load-bearing elsewhere: notes.author_member_id,
--     appointments.attending_member_id and parents.consent_attested_by all point
--     at it, so blanking a removed member's name would erase the attribution on
--     history that is still live. Member removal has its own item (G2-55 level
--     2) and its own design.
--   * parents' consent columns. They are the evidence that holding the record
--     was authorised in the first place (G2-44), which outlives the record, and
--     parents_consent_shape is an all-or-nothing CHECK that a partial blank
--     would violate.
--   * on_duty. Its only non-structural column is a timestamp.
--   * NOT NULL enums and timestamps generally. An appointment slot with no
--     provider, or a severity with no description, is not a health fact about
--     anyone — and inventing a value to satisfy NOT NULL would be worse.
--
-- Written explicitly per table rather than as one generic jsonb trigger. A
-- generic version has to guess how to empty an enum, a timestamptz and a
-- text[], and getting that wrong on a medical record is not worth the brevity.

begin;


-- ---------------------------------------------------------------------------
-- parents
-- Keeps: consent_basis / consent_attested_at / consent_attested_by / consent_notice_version / consent_sharing_at — the consent trail is EVIDENCE that holding this record was authorised (G2-44), and parents_consent_shape is an all-or-nothing CHECK, so a partial blank would violate it.
-- ---------------------------------------------------------------------------
create or replace function public.parents_blank_deleted_content()
returns trigger
language plpgsql
-- Deliberately NOT security definer: this only assigns to NEW, so it needs no
-- privilege the writer does not already have, and a definer function is
-- attack surface to justify rather than add by habit. search_path is still
-- pinned, which is the thing that actually broke create_invite (migration 13).
set search_path to 'public'
as $$
begin
  if new.deleted_at is not null then
      new.name := '';
      new.conditions := '{}'::text[];
      new.allergies := '{}'::text[];
      new.ice_contacts := '[]'::jsonb;
      new.nickname := null;
      new.photo_url := null;
      new.dob := null;
      new.preferences := null;
      new.blood_type := null;
      new.pharmacy := null;
      new.primary_doctor := null;
      new.insurance := null;
      new.dnr_status := null;
      new.healthcare_proxy := null;
      new.last_verified_at := null;
      new.last_verified_by := null;
  end if;
  return new;
end $$;

drop trigger if exists parents_blank_deleted_content on public.parents;
create trigger parents_blank_deleted_content
  before insert or update on public.parents
  for each row execute function public.parents_blank_deleted_content();


-- ---------------------------------------------------------------------------
-- medications
-- Keeps: nothing beyond the structural columns.
-- ---------------------------------------------------------------------------
create or replace function public.medications_blank_deleted_content()
returns trigger
language plpgsql
-- Deliberately NOT security definer: this only assigns to NEW, so it needs no
-- privilege the writer does not already have, and a definer function is
-- attack surface to justify rather than add by habit. search_path is still
-- pinned, which is the thing that actually broke create_invite (migration 13).
set search_path to 'public'
as $$
begin
  if new.deleted_at is not null then
      new.name := '';
      new.schedule := '[]'::jsonb;
      new.dose := null;
      new.purpose := null;
      new.photo_color := null;
      new.shape := null;
      new.prescriber := null;
      new.pharmacy := null;
      new.refill_by := null;
      new.pills_left := null;
      new.started_at := null;
      new.notes := null;
  end if;
  return new;
end $$;

drop trigger if exists medications_blank_deleted_content on public.medications;
create trigger medications_blank_deleted_content
  before insert or update on public.medications
  for each row execute function public.medications_blank_deleted_content();


-- ---------------------------------------------------------------------------
-- med_doses
-- Keeps: scheduled_at and skipped — both NOT NULL, and a dose slot with no drug name attached is not health information.
-- ---------------------------------------------------------------------------
create or replace function public.med_doses_blank_deleted_content()
returns trigger
language plpgsql
-- Deliberately NOT security definer: this only assigns to NEW, so it needs no
-- privilege the writer does not already have, and a definer function is
-- attack surface to justify rather than add by habit. search_path is still
-- pinned, which is the thing that actually broke create_invite (migration 13).
set search_path to 'public'
as $$
begin
  if new.deleted_at is not null then
      new.given_at := null;
      new.given_by_member_id := null;
      new.skip_reason := null;
  end if;
  return new;
end $$;

drop trigger if exists med_doses_blank_deleted_content on public.med_doses;
create trigger med_doses_blank_deleted_content
  before insert or update on public.med_doses
  for each row execute function public.med_doses_blank_deleted_content();


-- ---------------------------------------------------------------------------
-- appointments
-- Keeps: starts_at and status — NOT NULL, and an empty appointment slot reveals nothing.
-- ---------------------------------------------------------------------------
create or replace function public.appointments_blank_deleted_content()
returns trigger
language plpgsql
-- Deliberately NOT security definer: this only assigns to NEW, so it needs no
-- privilege the writer does not already have, and a definer function is
-- attack surface to justify rather than add by habit. search_path is still
-- pinned, which is the thing that actually broke create_invite (migration 13).
set search_path to 'public'
as $$
begin
  if new.deleted_at is not null then
      new.provider_name := '';
      new.specialty := null;
      new.location := null;
      new.duration_min := null;
      new.prep_notes := null;
      new.summary := null;
  end if;
  return new;
end $$;

drop trigger if exists appointments_blank_deleted_content on public.appointments;
create trigger appointments_blank_deleted_content
  before insert or update on public.appointments
  for each row execute function public.appointments_blank_deleted_content();


-- ---------------------------------------------------------------------------
-- visit_notes
-- Keeps: kind and captured_at — NOT NULL enum and timestamp with no content of their own.
-- ---------------------------------------------------------------------------
create or replace function public.visit_notes_blank_deleted_content()
returns trigger
language plpgsql
-- Deliberately NOT security definer: this only assigns to NEW, so it needs no
-- privilege the writer does not already have, and a definer function is
-- attack surface to justify rather than add by habit. search_path is still
-- pinned, which is the thing that actually broke create_invite (migration 13).
set search_path to 'public'
as $$
begin
  if new.deleted_at is not null then
      new.body := '';
  end if;
  return new;
end $$;

drop trigger if exists visit_notes_blank_deleted_content on public.visit_notes;
create trigger visit_notes_blank_deleted_content
  before insert or update on public.visit_notes
  for each row execute function public.visit_notes_blank_deleted_content();


-- ---------------------------------------------------------------------------
-- symptoms
-- Keeps: severity, observed_at, resolved — all NOT NULL. severity alone, with no description, is not a health fact about anyone.
-- ---------------------------------------------------------------------------
create or replace function public.symptoms_blank_deleted_content()
returns trigger
language plpgsql
-- Deliberately NOT security definer: this only assigns to NEW, so it needs no
-- privilege the writer does not already have, and a definer function is
-- attack surface to justify rather than add by habit. search_path is still
-- pinned, which is the thing that actually broke create_invite (migration 13).
set search_path to 'public'
as $$
begin
  if new.deleted_at is not null then
      new.description := '';
      new.possible_med_links := '{}'::uuid[];
      new.observed_by_member_id := null;
  end if;
  return new;
end $$;

drop trigger if exists symptoms_blank_deleted_content on public.symptoms;
create trigger symptoms_blank_deleted_content
  before insert or update on public.symptoms
  for each row execute function public.symptoms_blank_deleted_content();


-- ---------------------------------------------------------------------------
-- handoffs
-- Keeps: sent_at and until — NOT NULL timestamps.
-- ---------------------------------------------------------------------------
create or replace function public.handoffs_blank_deleted_content()
returns trigger
language plpgsql
-- Deliberately NOT security definer: this only assigns to NEW, so it needs no
-- privilege the writer does not already have, and a definer function is
-- attack surface to justify rather than add by habit. search_path is still
-- pinned, which is the thing that actually broke create_invite (migration 13).
set search_path to 'public'
as $$
begin
  if new.deleted_at is not null then
      new.summary := '';
      new.personal_message := null;
      new.accepted_at := null;
  end if;
  return new;
end $$;

drop trigger if exists handoffs_blank_deleted_content on public.handoffs;
create trigger handoffs_blank_deleted_content
  before insert or update on public.handoffs
  for each row execute function public.handoffs_blank_deleted_content();


-- ---------------------------------------------------------------------------
-- thread_messages
-- Keeps: is_digest — NOT NULL boolean.
-- ---------------------------------------------------------------------------
create or replace function public.thread_messages_blank_deleted_content()
returns trigger
language plpgsql
-- Deliberately NOT security definer: this only assigns to NEW, so it needs no
-- privilege the writer does not already have, and a definer function is
-- attack surface to justify rather than add by habit. search_path is still
-- pinned, which is the thing that actually broke create_invite (migration 13).
set search_path to 'public'
as $$
begin
  if new.deleted_at is not null then
      new.body := '';
  end if;
  return new;
end $$;

drop trigger if exists thread_messages_blank_deleted_content on public.thread_messages;
create trigger thread_messages_blank_deleted_content
  before insert or update on public.thread_messages
  for each row execute function public.thread_messages_blank_deleted_content();


-- ---------------------------------------------------------------------------
-- notes
-- Keeps: kind — NOT NULL enum.
-- ---------------------------------------------------------------------------
create or replace function public.notes_blank_deleted_content()
returns trigger
language plpgsql
-- Deliberately NOT security definer: this only assigns to NEW, so it needs no
-- privilege the writer does not already have, and a definer function is
-- attack surface to justify rather than add by habit. search_path is still
-- pinned, which is the thing that actually broke create_invite (migration 13).
set search_path to 'public'
as $$
begin
  if new.deleted_at is not null then
      new.body := '';
      new.linked_id := null;
  end if;
  return new;
end $$;

drop trigger if exists notes_blank_deleted_content on public.notes;
create trigger notes_blank_deleted_content
  before insert or update on public.notes
  for each row execute function public.notes_blank_deleted_content();


-- ---------------------------------------------------------------------------
-- Backfill. The triggers only catch deletions from now on; these rows were
-- already tombstoned and still hold their content.
--
-- `where deleted_at is not null` re-saves each row, which fires the trigger
-- above and blanks it — so the blanking rules live in exactly one place rather
-- than being restated here and allowed to drift.
-- ---------------------------------------------------------------------------
update public.parents set deleted_at = deleted_at where deleted_at is not null;
update public.medications set deleted_at = deleted_at where deleted_at is not null;
update public.med_doses set deleted_at = deleted_at where deleted_at is not null;
update public.appointments set deleted_at = deleted_at where deleted_at is not null;
update public.visit_notes set deleted_at = deleted_at where deleted_at is not null;
update public.symptoms set deleted_at = deleted_at where deleted_at is not null;
update public.handoffs set deleted_at = deleted_at where deleted_at is not null;
update public.thread_messages set deleted_at = deleted_at where deleted_at is not null;
update public.notes set deleted_at = deleted_at where deleted_at is not null;

commit;

-- VERIFY. Every row below should report 0 rows still holding content.
select 'parents'         as tbl, count(*) as still_holding_content from public.parents         where deleted_at is not null and (name <> '' or conditions <> '{}'::text[] or allergies <> '{}'::text[] or dnr_status is not null)
union all select 'medications',    count(*) from public.medications     where deleted_at is not null and (name <> '' or dose is not null or notes is not null)
union all select 'med_doses',      count(*) from public.med_doses       where deleted_at is not null and (skip_reason is not null or given_at is not null)
union all select 'appointments',   count(*) from public.appointments    where deleted_at is not null and (provider_name <> '' or location is not null or summary is not null)
union all select 'visit_notes',    count(*) from public.visit_notes     where deleted_at is not null and body <> ''
union all select 'symptoms',       count(*) from public.symptoms        where deleted_at is not null and description <> ''
union all select 'handoffs',       count(*) from public.handoffs        where deleted_at is not null and (summary <> '' or personal_message is not null)
union all select 'thread_messages',count(*) from public.thread_messages where deleted_at is not null and body <> ''
union all select 'notes',          count(*) from public.notes           where deleted_at is not null and body <> '';
