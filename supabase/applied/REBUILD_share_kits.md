# How to rebuild doctor sharing (removed 2026-09-12)

The encrypted share-kit link was removed before it ever shipped: nothing in the
app called `createEncryptedCareKitShare`, no kits existed, no files were stored.
The PDF export covers the same need — doctors' offices accept an emailed PDF,
and a link plus a spoken passphrase is a flow most people never complete.

**If you want revocable sharing back, do NOT rebuild what was there.** The old
design put the ciphertext in a *public* storage bucket, which created three
problems that each needed their own machinery:

| Old problem | Old patch |
|---|---|
| Anyone with the path could download the file forever | daily cron + edge function to delete expired blobs |
| Recipient has no account, so metadata had to be readable by anyone | `get_share_kit_metadata`, an anon-callable RPC |
| A weak passphrase was the only protection | a 12-character minimum + generator |

## The design to build instead

**Put the ciphertext in the database row, not in storage.**

```sql
create table public.share_kits (
  id            text primary key,          -- shortSlug(8): 40 bits, Crockford base32
  family_id     uuid not null references public.families(id) on delete cascade,
  ciphertext    bytea not null,            -- AES-GCM-256 payload, encrypted on-device
  salt_b64      text not null,
  iv_b64        text not null,
  kdf_iterations integer not null,         -- 210_000 (OWASP PBKDF2-SHA256)
  created_by    uuid,
  expires_at    timestamptz not null default now() + interval '7 days',
  revoked_at    timestamptz
);
```

Then a single `security definer` RPC returns the row (ciphertext included) only
when `revoked_at is null and expires_at > now()`. Grant it to `anon`: the
recipient has no account, and what they get back is opaque bytes.

Why this is better:
- **Expiry becomes real.** No blob outlives the row. Deleting or expiring the
  row is the whole enforcement mechanism — no cron job, no cleanup function, no
  `purged_at` column, nothing to monitor.
- **Revoke is instant** for the same reason.
- **No public bucket exists**, so there is no path anyone can keep.
- Rows are small: these payloads were capped at 5 MB and are realistically a few
  KB of JSON. `bytea` is fine. Guard it with a size check if you like.

## Carry these over

- **Generate the passphrase, don't validate it.** `suggestSharePassphrase()`
  (three groups of five Crockford base32 chars, ~74 bits) existed for this.
  A minimum length only polices bad human choices; generating removes them.
- **Keep encryption on the device.** `src/lib/crypto/encrypt.ts` and `slug.ts`
  were deliberately left in the repo — they are the working pieces you need.
- **The viewer** lived at `halmoni-landing/view/` (`decrypt.js` did WebCrypto
  PBKDF2 + AES-GCM in the browser). Recover it from git history; it only needs
  its fetch changed from the public storage URL to the new RPC.

## Where the old code is

Everything is in git history, at the commit that removed it. Also:
- `supabase/applied/removed_get_er_card_by_token.sql` — the separate ER-card RPC.
- Migration `00000000000005_share_kits.sql` — original tables, bucket, policies.
- Migration `00000000000011_audit_2026_09_12.sql` — the purge machinery, now dropped.
