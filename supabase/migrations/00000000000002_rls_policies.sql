-- Family-scoped row-level security.
-- A user can read/write any row whose family_id matches a family_members row
-- they own (family_members.user_id = auth.uid()). Helper is a SECURITY DEFINER
-- function so the sub-select doesn't hit RLS recursion.

create or replace function is_family_member(fid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from family_members
    where family_id = fid
      and user_id = auth.uid()
      and deleted_at is null
  );
$$;

-- families: readable by any member; only owners can update; anyone can insert
-- their own family (they become owner via app logic).
alter table families enable row level security;
drop policy if exists families_select on families;
create policy families_select on families
  for select using (is_family_member(id));
drop policy if exists families_insert on families;
create policy families_insert on families
  for insert with check (auth.uid() is not null);
drop policy if exists families_update on families;
create policy families_update on families
  for update using (
    exists (
      select 1 from family_members
      where family_id = families.id
        and user_id = auth.uid()
        and is_owner = true
        and deleted_at is null
    )
  );

-- family_members: a user can see any member of a family they belong to,
-- and can update/delete only their own row (except owners, who can manage all).
alter table family_members enable row level security;
drop policy if exists fm_select on family_members;
create policy fm_select on family_members
  for select using (
    user_id = auth.uid() or is_family_member(family_id)
  );
drop policy if exists fm_insert on family_members;
-- Insert allowed when creating your own membership row OR when an owner adds
-- another member to their family.
create policy fm_insert on family_members
  for insert with check (
    user_id = auth.uid()
    or exists (
      select 1 from family_members m
      where m.family_id = family_members.family_id
        and m.user_id = auth.uid()
        and m.is_owner = true
        and m.deleted_at is null
    )
  );
drop policy if exists fm_update on family_members;
create policy fm_update on family_members
  for update using (
    user_id = auth.uid()
    or exists (
      select 1 from family_members m
      where m.family_id = family_members.family_id
        and m.user_id = auth.uid()
        and m.is_owner = true
        and m.deleted_at is null
    )
  );
drop policy if exists fm_delete on family_members;
create policy fm_delete on family_members
  for delete using (
    user_id = auth.uid()
    or exists (
      select 1 from family_members m
      where m.family_id = family_members.family_id
        and m.user_id = auth.uid()
        and m.is_owner = true
        and m.deleted_at is null
    )
  );

-- Uniform family-scoped policies for the rest of the tables.
do $$
declare
  t text;
  tables text[] := array[
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
    execute format('alter table %I enable row level security', t);
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

-- visit_notes is scoped by appointment, but we already stamp family_id on it,
-- so the loop above already covered it. Nothing extra needed.
