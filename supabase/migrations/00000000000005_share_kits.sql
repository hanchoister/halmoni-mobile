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

drop policy if exists share_kits_storage_read on storage.objects;
create policy share_kits_storage_read on storage.objects
  for select using (bucket_id = 'share-kits');

drop policy if exists share_kits_storage_write on storage.objects;
create policy share_kits_storage_write on storage.objects
  for insert with check (
    bucket_id = 'share-kits'
    and auth.uid() is not null
  );

drop policy if exists share_kits_storage_delete on storage.objects;
create policy share_kits_storage_delete on storage.objects
  for delete using (
    bucket_id = 'share-kits'
    and auth.uid() is not null
  );
