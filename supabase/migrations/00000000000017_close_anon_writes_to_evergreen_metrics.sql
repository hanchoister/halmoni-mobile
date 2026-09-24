-- Close the anonymous write into the production database (G2-51).
--
-- Found 2026-09-20 by the RLS attack suite. evergreen_metrics carried
-- evergreen_metrics_insert_anon — an INSERT policy for the `anon` role with a
-- WITH CHECK of `true` — and the table grants to back it. Verified with nothing
-- but the publishable key: HTTP 201.
--
-- That key ships inside the app binary and sits in eas.json, so it is public in
-- every sense that matters. There is no rate limit and no bound, so anyone who
-- has ever installed the app could write unlimited rows into the same database
-- that holds the health record. It is a cost and availability problem rather
-- than a confidentiality one — the table holds no health data, is insert-only,
-- and anon has no SELECT policy — but "insert-only" is not much comfort when
-- the bill and the disk are shared with a medical record.
--
-- Safe to close: every row in the table at the time of writing was written by
-- the attack suite's own probes. Evergreen has never successfully sent a real
-- metric, so nothing that works today stops working.
--
-- If Evergreen does want metrics later, it should not be by handing the open
-- internet an INSERT on this database. Either give it its own Supabase project,
-- or put an edge function in front that can rate-limit and validate. The
-- broader question of why an Evergreen table lives in Halmoni's production
-- database at all is G2-47, and this does not settle it.

-- The probe rows first, while the grant still exists to have written them.
delete from public.evergreen_metrics
 where iso_week = '2026-W38'
    or install_id::text like 'rls-probe%';

drop policy if exists evergreen_metrics_insert_anon on public.evergreen_metrics;

revoke all on public.evergreen_metrics from anon;
