-- Remove the encrypted share-kit link entirely (2026-09-12).
--
-- It never shipped: nothing called createEncryptedCareKitShare, no kits
-- existed, no files were stored. The PDF export covers the same need, so the
-- feature goes rather than being maintained — retiring the public bucket, the
-- anon-callable metadata RPC, and the purge machinery from migration 11.
--
-- To rebuild, read supabase/applied/REBUILD_share_kits.md first: keep the
-- ciphertext in the row and expiry needs no cleanup job at all.
--
-- The empty `share-kits` bucket row cannot be deleted from SQL
-- (storage.protect_delete blocks it); remove it from Storage in the dashboard.

do $$
begin
  perform cron.unschedule('purge-expired-share-kits')
  where exists (select 1 from cron.job where jobname = 'purge-expired-share-kits');
exception when others then
  raise notice 'pg_cron not present, nothing to unschedule: %', sqlerrm;
end $$;

drop view if exists public.share_kits_pending_purge;
drop function if exists public.get_share_kit_metadata(text);
drop policy if exists "share-kits storage insert" on storage.objects;
drop policy if exists "share-kits storage delete" on storage.objects;
drop table if exists public.share_kits;
