-- Patch: align prod's schema with what halmoni-mobile actually writes.
--
-- The mobile sync engine stamps `created_at` onto EVERY row it pushes
-- (src/lib/sync/write-path.ts stampWrite) and upserts with
-- `onConflict: 'id'` (src/lib/sync/engine.ts). Five prod tables cannot
-- satisfy that contract, so every push to them fails with a PostgREST
-- schema-cache error before it ever reaches the database:
--
--   med_doses    missing created_at, missing parent_id
--   visit_notes  missing created_at
--   symptoms     missing created_at
--   handoffs     missing created_at
--   on_duty      missing created_at, missing id (keyed on parent_id instead)
--
-- Two of these were already known and deferred (med_doses.parent_id,
-- on_duty.id). The three bare created_at gaps were not — they mean sync is
-- broken for 5 of the 12 syncable tables, not 2. This closes all of them.
--
-- Verified 2026-08-31: all five tables have zero rows on prod, so nothing
-- is backfilled and no existing behaviour changes. `parents` has 1 row.
--
-- Nullability note: prod keeps `until` NOT NULL on on_duty and handoffs
-- while mobile's local SQLite allows null. Left alone deliberately — both
-- mobile write paths always populate it (index.tsx takeOverDuty,
-- handoff/new.tsx), so prod is simply the stricter of the two.
--
-- APPLIED to halmoni-prod 2026-08-31; all nine verification checks returned
-- true and the PostgREST schema cache was reloaded. Kept for the record and
-- for rebuilding a fresh environment.
--
-- Run once in the Supabase SQL Editor against halmoni-prod. Idempotent.

begin;

-- 1. created_at on the four tables that only lack that ------------------

alter table public.med_doses
  add column if not exists created_at timestamptz not null default now();

alter table public.visit_notes
  add column if not exists created_at timestamptz not null default now();

alter table public.symptoms
  add column if not exists created_at timestamptz not null default now();

alter table public.handoffs
  add column if not exists created_at timestamptz not null default now();

-- 2. med_doses.parent_id ------------------------------------------------
-- Mobile treats this as NOT NULL. Added nullable first, backfilled from the
-- owning medication, then tightened — so this stays correct if rows ever do
-- exist when it runs.

alter table public.med_doses
  add column if not exists parent_id uuid;

update public.med_doses d
   set parent_id = m.parent_id
  from public.medications m
 where m.id = d.medication_id
   and d.parent_id is null;

alter table public.med_doses
  alter column parent_id set not null;

-- Composite FK, matching the (parent_id, family_id) -> parents(id, family_id)
-- pattern every other parent-scoped table on prod already uses.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'med_doses_parent_id_family_fkey'
  ) then
    alter table public.med_doses
      add constraint med_doses_parent_id_family_fkey
      foreign key (parent_id, family_id)
      references public.parents (id, family_id)
      on delete cascade;
  end if;
end $$;

create index if not exists med_doses_parent_id_idx
  on public.med_doses (parent_id);

-- 3. on_duty: give it a real `id` primary key ---------------------------
-- Prod keys this table on parent_id; mobile expects an `id` column and the
-- sync engine upserts onConflict 'id'. Swap the PK to id and demote the
-- one-row-per-parent rule to a unique constraint, which is what the mobile
-- migration always intended ("unique (parent_id)"). Nothing references
-- on_duty, so dropping its PK breaks no foreign keys.

alter table public.on_duty
  add column if not exists id uuid not null default gen_random_uuid();

alter table public.on_duty
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'on_duty_pkey'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (parent_id)'
  ) then
    alter table public.on_duty drop constraint on_duty_pkey;
    alter table public.on_duty add constraint on_duty_pkey primary key (id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'on_duty_parent_id_key'
  ) then
    alter table public.on_duty
      add constraint on_duty_parent_id_key unique (parent_id);
  end if;
end $$;

commit;

-- Verify. Every row should read true.
select 'med_doses.created_at'   as check, to_regclass('public.med_doses') is not null
       and exists (select 1 from information_schema.columns where table_schema='public' and table_name='med_doses' and column_name='created_at') as ok
union all select 'med_doses.parent_id',
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='med_doses' and column_name='parent_id' and is_nullable='NO')
union all select 'visit_notes.created_at',
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='visit_notes' and column_name='created_at')
union all select 'symptoms.created_at',
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='symptoms' and column_name='created_at')
union all select 'handoffs.created_at',
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='handoffs' and column_name='created_at')
union all select 'on_duty.created_at',
       exists (select 1 from information_schema.columns where table_schema='public' and table_name='on_duty' and column_name='created_at')
union all select 'on_duty.id is PK',
       exists (select 1 from pg_constraint where conname='on_duty_pkey' and pg_get_constraintdef(oid)='PRIMARY KEY (id)')
union all select 'on_duty.parent_id unique',
       exists (select 1 from pg_constraint where conname='on_duty_parent_id_key');
