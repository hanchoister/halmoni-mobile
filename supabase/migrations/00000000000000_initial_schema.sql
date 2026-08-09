-- halmoni initial schema
-- Every table carries updated_at + deleted_at so the offline-first sync engine
-- can do timestamp-based last-write-wins merges with tombstone awareness.
-- Additive: uses IF NOT EXISTS so it's safe to re-run against partial DBs.

create extension if not exists "pgcrypto";

-- families: the top-level tenant. Every other row is scoped by family_id.
create table if not exists families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- family_members: users belonging to a family. user_id matches auth.uid().
create table if not exists family_members (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id) on delete cascade,
  user_id     uuid,                       -- null until the invite is accepted
  name        text not null,
  relation    text,
  phone       text,
  color       text,
  photo_url   text,
  is_owner    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (family_id, user_id)
);
create index if not exists family_members_family_id_idx on family_members (family_id);
create index if not exists family_members_user_id_idx   on family_members (user_id);

create table if not exists parents (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references families(id) on delete cascade,
  name           text not null,
  nickname       text,
  photo_url      text,
  dob            date,
  conditions     text[]      not null default '{}',
  allergies      text[]      not null default '{}',
  preferences    text,
  blood_type     text,
  ice_contacts   jsonb       not null default '[]'::jsonb,
  pharmacy       jsonb,
  primary_doctor jsonb,
  insurance      jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists parents_family_id_idx on parents (family_id);

create table if not exists medications (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid not null references parents(id) on delete cascade,
  family_id    uuid not null references families(id) on delete cascade,
  name         text not null,
  dose         text,
  purpose      text,
  schedule     jsonb not null default '[]'::jsonb,  -- [{time,withFood}]
  prescriber   text,
  pharmacy     text,
  refill_by    date,
  pills_left   integer,
  notes        text,
  started_at   date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists medications_parent_id_idx on medications (parent_id);
create index if not exists medications_family_id_idx on medications (family_id);

create table if not exists med_doses (
  id                   uuid primary key default gen_random_uuid(),
  medication_id        uuid not null references medications(id) on delete cascade,
  parent_id            uuid not null references parents(id) on delete cascade,
  family_id            uuid not null references families(id) on delete cascade,
  scheduled_at         timestamptz not null,
  given_at             timestamptz,
  given_by_member_id   uuid references family_members(id) on delete set null,
  skipped              boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);
create index if not exists med_doses_medication_id_idx on med_doses (medication_id);
create index if not exists med_doses_family_scheduled_idx on med_doses (family_id, scheduled_at desc);

create table if not exists appointments (
  id             uuid primary key default gen_random_uuid(),
  parent_id      uuid not null references parents(id) on delete cascade,
  family_id      uuid not null references families(id) on delete cascade,
  provider_name  text,
  specialty      text,
  location       text,
  starts_at      timestamptz not null,
  duration_min   integer,
  status         text not null default 'upcoming',  -- upcoming | completed | cancelled
  summary        text,
  prep_notes     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists appointments_family_starts_idx on appointments (family_id, starts_at desc);

create table if not exists visit_notes (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid not null references appointments(id) on delete cascade,
  family_id       uuid not null references families(id) on delete cascade,
  kind            text not null,                     -- diagnosis | new-med | instruction | follow-up | voice
  body            text not null,
  captured_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists visit_notes_appt_idx on visit_notes (appointment_id);

create table if not exists symptoms (
  id                       uuid primary key default gen_random_uuid(),
  parent_id                uuid not null references parents(id) on delete cascade,
  family_id                uuid not null references families(id) on delete cascade,
  description              text not null,
  severity                 text,                     -- mild | moderate | severe
  observed_at              timestamptz not null,
  observed_by_member_id    uuid references family_members(id) on delete set null,
  possible_med_links       uuid[],
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz
);
create index if not exists symptoms_family_observed_idx on symptoms (family_id, observed_at desc);

create table if not exists handoffs (
  id                uuid primary key default gen_random_uuid(),
  parent_id         uuid not null references parents(id) on delete cascade,
  family_id         uuid not null references families(id) on delete cascade,
  from_member_id    uuid not null references family_members(id) on delete cascade,
  to_member_id      uuid not null references family_members(id) on delete cascade,
  summary           text not null,
  personal_message  text,
  sent_at           timestamptz not null default now(),
  accepted_at       timestamptz,
  until             timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index if not exists handoffs_family_sent_idx on handoffs (family_id, sent_at desc);

-- Only one on_duty row per (family, parent) at a time. Enforced by unique.
create table if not exists on_duty (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid not null references parents(id) on delete cascade,
  family_id   uuid not null references families(id) on delete cascade,
  member_id   uuid not null references family_members(id) on delete cascade,
  until       timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (parent_id)
);

create table if not exists thread_messages (
  id                 uuid primary key default gen_random_uuid(),
  parent_id          uuid not null references parents(id) on delete cascade,
  family_id          uuid not null references families(id) on delete cascade,
  author_member_id   uuid references family_members(id) on delete set null,
  body               text not null,
  is_digest          boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index if not exists thread_messages_family_created_idx on thread_messages (family_id, created_at desc);

create table if not exists notes (
  id                 uuid primary key default gen_random_uuid(),
  parent_id          uuid not null references parents(id) on delete cascade,
  family_id          uuid not null references families(id) on delete cascade,
  author_member_id   uuid references family_members(id) on delete set null,
  kind               text not null,                  -- mood | observation | general
  body               text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index if not exists notes_family_created_idx on notes (family_id, created_at desc);
