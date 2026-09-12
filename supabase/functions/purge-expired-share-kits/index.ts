// Halmoni — purge-expired-share-kits
//
// Audit finding S-06 (2026-09-12): get_share_kit_metadata refuses expired kits,
// but the ciphertext stayed in the PUBLIC share-kits bucket indefinitely.
// Anyone who kept the storage path — the recipient, or anyone they forwarded it
// to — could still download it after the share "expired" and attack the
// passphrase offline at their leisure. Hiding the metadata was never the same
// as removing the file.
//
// This deletes the blob itself through the Storage API (the only way to remove
// the bytes rather than just the metadata row) for every kit that has expired
// or been revoked, then stamps purged_at so it is not retried.
//
// Which kits qualify is decided by the view public.share_kits_pending_purge,
// not by a PostgREST filter here, so the predicate can be read and tested as
// plain SQL.
//
// verify_jwt is off because pg_cron invokes this without a user JWT. That is
// safe here: it only ever deletes data that has already expired or been
// revoked, it returns counts and never share contents, and running it more
// often than scheduled changes nothing.

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const BUCKET = "share-kits";
const BATCH = 200;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async () => {
  const { data: kits, error } = await supabase
    .from("share_kits_pending_purge")
    .select("id, storage_path")
    .limit(BATCH);

  if (error) return json({ ok: false, stage: "select", error: error.message }, 500);
  if (!kits || kits.length === 0) return json({ ok: true, purged: 0 });

  const paths = kits.map((k) => k.storage_path).filter(Boolean) as string[];
  const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);

  // Storage reports no error for paths that are already gone, so a failure here
  // is a real one: leave purged_at null and let the next run retry rather than
  // marking files clean that may still exist.
  if (removeError) return json({ ok: false, stage: "storage", error: removeError.message }, 500);

  const { error: stampError } = await supabase
    .from("share_kits")
    .update({ purged_at: new Date().toISOString() })
    .in("id", kits.map((k) => k.id));

  if (stampError) return json({ ok: false, stage: "stamp", error: stampError.message }, 500);

  return json({ ok: true, purged: kits.length, more: kits.length === BATCH });
});
