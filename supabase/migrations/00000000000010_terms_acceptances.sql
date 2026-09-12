-- Who agreed to which version of the terms, and when — G1-33.
--
-- Separate from parent consent on purpose. This table is the user agreeing for
-- themselves to a contract with us. parents.consent_* is the user stating
-- something about their parent, who never installs the app, never signs up,
-- and cannot agree to our terms at all. Washington is explicit that the second
-- cannot ride on the first: consent to collect health data may not be obtained
-- through "acceptance of a general or broad terms of use agreement or a
-- similar document that contains descriptions of personal data processing
-- along with other unrelated information" (RCW 19.373.010).
--
-- Why store it at all: an agreement nobody can produce the text of is barely
-- an agreement. The enforceability cases turn on what was shown and whether
-- the person did something unambiguous about it, so the version is recorded
-- with the timestamp, and src/lib/terms.ts keeps the text of every version.
--
-- One row per document rather than one row for both, so that bumping the
-- privacy policy alone does not make it look as though the terms were
-- re-accepted the same day.
create table if not exists terms_acceptances (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document    text not null check (document in ('terms', 'privacy')),
  version     text not null,
  accepted_at timestamptz not null default now()
);

create index if not exists terms_acceptances_user_idx
  on terms_acceptances (user_id, document, accepted_at desc);

-- Append-only from outside, like parent_consent_events: a record of agreement
-- that the agreeing party can rewrite is not evidence of anything. Inserting
-- your own row is allowed (that is the act of accepting); editing and deleting
-- are not granted to anyone who speaks PostgREST.
alter table terms_acceptances enable row level security;

drop policy if exists terms_acceptances_select on terms_acceptances;
create policy terms_acceptances_select on terms_acceptances
  for select using (user_id = auth.uid());

drop policy if exists terms_acceptances_insert on terms_acceptances;
create policy terms_acceptances_insert on terms_acceptances
  for insert with check (user_id = auth.uid());

revoke all on terms_acceptances from anon, authenticated;
grant select, insert on terms_acceptances to authenticated;
-- Explicit rather than leaning on Supabase's default privileges for new tables
-- in public, for the same reason 00000000000008 is: a default you rely on in
-- one direction should not be relied on in the other.

-- Deliberately NOT deleted when the user deletes their account: the row is the
-- evidence that a contract existed, and it is kept only as long as auth.users
-- keeps the user (the cascade above). If that trade is wrong, it is a lawyer's
-- call, not a schema one — it is on the G2-41 question list.
