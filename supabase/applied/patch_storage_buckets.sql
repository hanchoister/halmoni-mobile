-- Patch: Storage buckets for file features.
--
-- APPLIED to halmoni-prod 2026-09-01.
--
-- P-19 — `share-kits` did not exist. Mobile's encrypted care kit has always
-- uploaded to it, so that feature has never worked against production. The
-- parity audit called zero-knowledge sharing mobile's architectural strength;
-- it was theoretical.
--
-- Public on purpose. The landing page's /view fetches
-- `/storage/v1/object/public/share-kits/<familyId>/<slug>.bin` with no auth, and
-- the bytes are AES-GCM-256 ciphertext whose passphrase never leaves the sender's
-- device. Salt and IV live in the `share_kits` row, so leaked ciphertext alone is
-- inert, and the path embeds a UUID plus a random slug so it is not enumerable.
--
-- S-10 — `attachments` had no size limit and no MIME allow-list. Harmless while
-- nothing wrote to it; an unbounded cost and abuse hole the moment mobile starts
-- uploading photos and audio.
--
-- Idempotent.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('share-kits', 'share-kits', true, 5242880, array['application/octet-stream'])
on conflict (id) do update
  set public            = excluded.public,
      file_size_limit   = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

update storage.buckets
   set file_size_limit = 26214400,  -- 25 MB
       allowed_mime_types = array[
         'image/jpeg','image/png','image/heic','image/heif','image/webp',
         'application/pdf',
         'audio/m4a','audio/mp4','audio/mpeg','audio/aac','audio/wav'
       ]
 where id = 'attachments';

-- Writes are family-scoped, mirroring the attachments policies. Reads need no
-- policy because the bucket is public — that is the point of the design.
drop policy if exists "share-kits storage insert" on storage.objects;
create policy "share-kits storage insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'share-kits'
    and is_family_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "share-kits storage delete" on storage.objects;
create policy "share-kits storage delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'share-kits'
    and is_family_member(((storage.foldername(name))[1])::uuid)
  );

-- Verify: every row true.
select 'share-kits bucket exists' as check,
       exists (select 1 from storage.buckets where id='share-kits') as ok
union all select 'share-kits is public',
       (select public from storage.buckets where id='share-kits')
union all select 'attachments is size-capped',
       (select file_size_limit is not null from storage.buckets where id='attachments')
union all select 'attachments restricts mime types',
       (select allowed_mime_types is not null from storage.buckets where id='attachments')
union all select 'share-kits write policies exist',
       (select count(*) = 2 from pg_policies
        where schemaname='storage' and tablename='objects'
          and policyname like 'share-kits%');
