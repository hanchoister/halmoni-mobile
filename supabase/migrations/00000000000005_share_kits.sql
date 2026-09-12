-- Zero-knowledge encrypted care-kit shares.
-- The client encrypts a care-kit JSON payload with a user-chosen passphrase
-- (AES-GCM-256 keyed via PBKDF2-SHA256). Ciphertext lives in Storage; the
-- server never sees plaintext or the passphrase. This table holds only the
-- salt/iv/expiry metadata needed to decrypt.

create table if not exists share_kits (
  id                text primary key,           -- short base32 slug (URL friendly)
  family_id         uuid not null references families(id) on delete cascade,
  created_by        uuid references family_members(id) on delete set null,
  storage_path      text not null,              -- path within share-kits bucket
  salt_b64          text not null,              -- PBKDF2 salt, base64
  iv_b64            text not null,              -- AES-GCM IV, base64
  kdf_iterations    integer not null default 210000,
  ciphertext_bytes  integer,                    -- for observability only
  created_at        timestamptz not null default now(),
  expires_at        timestamptz,                -- optional TTL; nightly cleanup drops expired rows + storage objects
  revoked_at        timestamptz
);
create index if not exists share_kits_family_idx on share_kits (family_id, created_at desc);
create index if not exists share_kits_expires_idx on share_kits (expires_at) where expires_at is not null;

alter table share_kits enable row level security;

-- Family members can list/manage their own family's kits.
drop policy if exists share_kits_select on share_kits;
create policy share_kits_select on share_kits
  for select using (is_family_member(family_id));
drop policy if exists share_kits_insert on share_kits;
create policy share_kits_insert on share_kits
  for insert with check (is_family_member(family_id));
drop policy if exists share_kits_update on share_kits;
create policy share_kits_update on share_kits
  for update using (is_family_member(family_id))
  with check (is_family_member(family_id));
drop policy if exists share_kits_delete on share_kits;
create policy share_kits_delete on share_kits
  for delete using (is_family_member(family_id));

-- Public metadata endpoint: the recipient needs id → (salt, iv, iterations,
-- storage_path) to decrypt. Exposed via a SECURITY DEFINER RPC so the raw
-- table stays RLS-protected. Returns nothing if revoked or expired.
create or replace function get_share_kit_metadata(kit_id text)
returns table (
  storage_path    text,
  salt_b64        text,
  iv_b64          text,
  kdf_iterations  integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sk.storage_path,
    sk.salt_b64,
    sk.iv_b64,
    sk.kdf_iterations
  from share_kits sk
  where sk.id = kit_id
    and sk.revoked_at is null
    and (sk.expires_at is null or sk.expires_at > now());
$$;

grant execute on function get_share_kit_metadata(text) to anon, authenticated;

-- Storage bucket for the ciphertext blobs. Public-read so the recipient
-- (unauthenticated web viewer) can fetch, but only family members can write.
insert into storage.buckets (id, name, public)
values ('share-kits', 'share-kits', true)
on conflict (id) do nothing;

-- No SELECT policy, deliberately. The bucket is public, so object URLs are
-- fetchable without one; a broad SELECT policy adds only the ability to LIST
-- the bucket, which hands out the 8-character share slugs the whole design
-- treats as the secret (Supabase lint 0025_public_bucket_allows_listing).
-- share_kits_storage_read was dropped from production on 2026-09-10 for that
-- reason (G2-30), and recreating it here would put it back on the next push.
--
-- Writes are family-scoped rather than merely signed-in. The first version of
-- these two checked only `auth.uid() is not null`, which let ANY account with
-- an email address upload into — or delete from — any family's folder: free
-- file hosting on a public bucket, and a delete button on every other
-- family's kits. Permissive policies OR, so sitting beside the correct
-- family-scoped pair changed nothing about how bad they were. Dropped from
-- production 2026-09-11 (G2-35).
drop policy if exists share_kits_storage_read on storage.objects;
drop policy if exists share_kits_storage_write on storage.objects;
drop policy if exists share_kits_storage_delete on storage.objects;

drop policy if exists "share-kits storage insert" on storage.objects;
create policy "share-kits storage insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'share-kits'
    and is_family_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "share-kits storage delete" on storage.objects;
create policy "share-kits storage delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'share-kits'
    and is_family_member(((storage.foldername(name))[1])::uuid)
  );
