-- Auto-bump updated_at on every UPDATE. The sync engine keys off this column
-- to compute delta pulls (updated_at > last_sync_at).

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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
    execute format('drop trigger if exists %I_set_updated_at on %I', t, t);
    execute format(
      'create trigger %I_set_updated_at before update on %I ' ||
      'for each row execute function set_updated_at()',
      t, t
    );
  end loop;
end $$;
