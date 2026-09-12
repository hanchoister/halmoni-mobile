-- ── Security audit, 2026-09-12 ──────────────────────────────────────────
-- Findings came from Supabase's advisors plus a read of the share-kit flow.
-- Both share_kits and shared_er_cards were empty at the time, and the share
-- feature is not yet wired into the app UI, so nothing was exposed in practice.

-- ── S-05 ── Drop get_er_card_by_token ───────────────────────────────────
-- It returned a complete emergency medical card to any caller holding a token.
-- Dead code: the only caller was the retired `tend` app, nothing creates
-- tokens, and shared_er_cards is empty. patch_harden_rpcs.sql kept it for "an
-- EMT scanning the card has no account" — but it was granted to `authenticated`
-- only, never `anon`, so that case could not have worked anyway.
-- Verbatim restore script: supabase/applied/removed_get_er_card_by_token.sql
drop function if exists public.get_er_card_by_token(text);

-- ── S-06 ── Expired share kits kept their ciphertext ────────────────────
-- get_share_kit_metadata refuses an expired kit, but the blob stayed in the
-- PUBLIC share-kits bucket forever, so anyone holding the storage path could
-- still download it and attack the passphrase offline. Hiding the metadata is
-- not the same as deleting the file.
alter table public.share_kits
  add column if not exists purged_at timestamptz;

comment on column public.share_kits.purged_at is
  'When the ciphertext blob was deleted from storage by purge-expired-share-kits. Null = the file may still exist.';

create index if not exists share_kits_purge_queue_idx
  on public.share_kits (expires_at)
  where purged_at is null;

-- The purge predicate lives in SQL, not in a PostgREST filter, so it can be
-- read and tested directly.
create or replace view public.share_kits_pending_purge as
  select id, storage_path, expires_at, revoked_at
  from public.share_kits
  where purged_at is null
    and storage_path is not null
    and (
      (expires_at is not null and expires_at < now())
      or revoked_at is not null
    );

comment on view public.share_kits_pending_purge is
  'Share kits whose ciphertext should be deleted from the public share-kits bucket. Read by the purge-expired-share-kits edge function (service role only; no anon grant).';

revoke all on public.share_kits_pending_purge from anon, authenticated;

-- Daily cleanup. The edge function (supabase/functions/purge-expired-share-kits)
-- deletes the blobs through the Storage API — the only way to remove the bytes
-- rather than just the metadata row — and stamps purged_at.
-- Guarded so a local stack without pg_cron/pg_net still applies the rest.
do $$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net with schema extensions;

  perform cron.unschedule('purge-expired-share-kits')
  where exists (select 1 from cron.job where jobname = 'purge-expired-share-kits');

  perform cron.schedule(
    'purge-expired-share-kits',
    '17 3 * * *',
    $job$
      select net.http_post(
        url     := 'https://wyovvbnlhyqfmnvsgket.supabase.co/functions/v1/purge-expired-share-kits',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body    := '{}'::jsonb
      );
    $job$
  );
exception when others then
  raise notice 'pg_cron/pg_net unavailable, skipping purge schedule: %', sqlerrm;
end $$;

-- ── Not changed, and why ────────────────────────────────────────────────
-- is_family_member stays callable by anon: its body requires auth.uid(), so an
-- anonymous caller always gets false. The advisory flags the grant, not a hole.
--
-- The share-kits bucket stays public: the recipient of a share has no account,
-- and the payload is encrypted client-side. What changed is that the ciphertext
-- no longer outlives the share. The passphrase floor moved 6 → 12 characters in
-- src/lib/crypto/share-kit.ts, which is what actually protects the payload.
