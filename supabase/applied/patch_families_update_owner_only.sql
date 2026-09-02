-- Patch: restrict families UPDATE to owners only.
-- Was: any family member could rename/edit the family row.
-- Run once in the Supabase SQL Editor against halmoni-prod. Idempotent.

drop policy if exists "families update" on public.families;
create policy "families update" on public.families
  for update
  using (
    exists (
      select 1
      from public.family_members
      where family_id = families.id
        and user_id   = auth.uid()
        and is_owner  = true
    )
  );
