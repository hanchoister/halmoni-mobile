-- DESTRUCTIVE: wipes all sample data from halmoni-prod.
-- Hana confirmed 2026-08-26: the 4 users / 1 family / 180 doses on prod are
-- disposable sample data. Run this before real users sign up.
--
-- Order matters (FKs cascade downward from families, but auth.users is
-- separate). This wipes app data first, then the auth users.

begin;

-- App data — one truncate cascades through every FK to families/parents.
truncate table
  public.families,
  public.parents,
  public.family_members,
  public.family_invites,
  public.medications,
  public.med_doses,
  public.symptoms,
  public.appointments,
  public.visit_notes,
  public.notes,
  public.handoffs,
  public.thread_messages,
  public.on_duty
cascade;

-- Web-app-only tables that may hold references to the wiped rows.
-- If any of these don't exist in your project, comment out that line.
truncate table
  public.appointment_questions,
  public.attachments,
  public.check_ins,
  public.notification_preferences,
  public.private_journal_entries,
  public.push_subscriptions,
  public.shared_er_cards,
  public.voice_notes
cascade;

-- auth.users — cascade delete would wipe rows in public tables via FK if any
-- survived the truncates above. Should be a no-op after the above ran.
delete from auth.users;

commit;

-- Verify empty:
select 'families'         as t, count(*) from public.families
union all select 'family_members', count(*) from public.family_members
union all select 'med_doses',      count(*) from public.med_doses
union all select 'auth.users',     count(*) from auth.users;
