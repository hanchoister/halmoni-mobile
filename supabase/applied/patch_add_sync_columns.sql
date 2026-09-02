-- Phase 1 of schema unification: add updated_at + deleted_at to every table
-- the mobile app syncs. Non-destructive and idempotent — safe to re-run and
-- safe to run against a live web-app database (nothing breaks; the web app
-- just gets free updated_at/deleted_at tracking).
--
-- Run in Supabase SQL Editor against halmoni-prod. Verify at the bottom.

-- 1. Generic "touch updated_at on UPDATE" trigger function.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$;

-- 2. For every mobile-synced table: ensure updated_at + deleted_at exist,
--    then wire the trigger. `add column if not exists` is idempotent.
do $$
declare
  t text;
  tables text[] := array[
    'families',
    'family_members',
    'parents',
    'medications',
    'med_doses',
    'appointments',
    'visit_notes',
    'symptoms',
    'handoffs',
    'on_duty',
    'thread_messages',
    'notes'
  ];
begin
  foreach t in array tables loop
    execute format(
      'alter table public.%I add column if not exists updated_at timestamptz not null default now()',
      t
    );
    execute format(
      'alter table public.%I add column if not exists deleted_at timestamptz',
      t
    );
    execute format(
      'drop trigger if exists %I on public.%I',
      t || '_set_updated_at', t
    );
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end $$;

-- 3. Verification — should return 12 rows, one per table above.
--    Both cols should be true.
select
  c.table_name,
  bool_or(c.column_name = 'updated_at') as has_updated_at,
  bool_or(c.column_name = 'deleted_at') as has_deleted_at
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (
    'families','family_members','parents','medications','med_doses',
    'appointments','visit_notes','symptoms','handoffs','on_duty',
    'thread_messages','notes'
  )
  and c.column_name in ('updated_at','deleted_at')
group by c.table_name
order by c.table_name;
