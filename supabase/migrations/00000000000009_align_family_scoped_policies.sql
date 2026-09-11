-- Align production's access rules with 00000000000002 — G2-36.
--
-- Production was built by hand, not from these migrations. On nine of the
-- family-scoped tables it carries one permissive FOR ALL policy named
-- "<table> rw" instead of the four per-command policies 00000000000002 creates.
-- Both grant exactly the same thing today — is_family_member(family_id) for
-- every command — so nobody can see or change anything they could not before.
--
-- The problem is the next change, not this one. Permissive policies OR
-- together, so any later migration that tightens one of these tables by
-- replacing its _insert or _update policy would do nothing on production while
-- "<table> rw" still grants the same command unconditionally. That is exactly
-- what nearly happened to parents in 00000000000008, which handles parents
-- itself and is deliberately absent from the list below: re-running the plain
-- family-member policies here would loosen it again.
--
-- families and family_members are also hand-built on production, with
-- different names and genuinely different rules. Aligning those changes who can
-- do what, so it is a separate decision and not part of this migration.
--
-- On a database built from these migrations, the drops are no-ops and the
-- creates reproduce 00000000000002 exactly.
do $$
declare
  t text;
  tables text[] := array[
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
    execute format('drop policy if exists %I on %I', t || ' rw', t);

    execute format('drop policy if exists %I_select on %I', t, t);
    execute format(
      'create policy %I_select on %I for select using (is_family_member(family_id))',
      t, t
    );
    execute format('drop policy if exists %I_insert on %I', t, t);
    execute format(
      'create policy %I_insert on %I for insert with check (is_family_member(family_id))',
      t, t
    );
    execute format('drop policy if exists %I_update on %I', t, t);
    execute format(
      'create policy %I_update on %I for update using (is_family_member(family_id)) ' ||
      'with check (is_family_member(family_id))',
      t, t
    );
    execute format('drop policy if exists %I_delete on %I', t, t);
    execute format(
      'create policy %I_delete on %I for delete using (is_family_member(family_id))',
      t, t
    );
  end loop;
end $$;
