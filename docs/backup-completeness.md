# What a complete Halmoni backup is

**G1-21. Written 2026-09-24, against production as it actually is** — every
count and every name below came from querying `halmoni-prod`, not from memory.

The `G1-05` drill (2026-09-02) proved the care data round-trips: 22 tables, 374
rows, dumped and restored with identical per-table counts. What it did not
prove is that the dump is a **restorable application**. It is not, and this
document is the difference between the two.

## The failure the drill would have hit

A `pg_dump --schema=public` restored into an empty Postgres gives you every care
row and no way to sign in. Four foreign keys in `public` point at `auth.users`,
which that dump excludes:

| Column | What breaks without it |
|---|---|
| `family_members.user_id` | nobody is a member of anything, so **every RLS policy denies every row** |
| `families.created_by` | families have no creator |
| `family_invites.created_by` | invites have no author |
| `terms_acceptances.user_id` | the record of who accepted the Terms is orphaned |

`G1-21`'s original text said *three* such keys. It is four:
`terms_acceptances` arrived in migration 10, after the drill, and nothing
revisited the count. Expect this list to grow again — **any new column
referencing `auth.users` belongs in this table.**

The second failure is quieter. `create_invite` calls
`extensions.gen_random_bytes`, and `pgcrypto` lives in the `extensions` schema,
which a `public`-only dump also excludes. Restore into a bare database and
invites throw `42883` — the same error that took invites down on production for
ten days (migration 13).

## The four layers, and which are actually at risk

**1. Schema and data in `public` — covered by the existing drill.**
26 tables, 37 RLS policies, 6 enum types (`appt_status`, `member_color`,
`note_kind`, `pill_shape`, `severity_level`, `visit_note_kind`), the
`set_updated_at` triggers, the consent triggers, and the SECURITY DEFINER
functions. A `--schema=public` dump carries all of it, types and triggers
included.

**2. Identity — NOT covered, and the app is unusable without it.**
`auth.users` (6 rows today) and `auth.identities` (6). Restoring these means
restoring password hashes and provider links, so the dump is as sensitive as
the health data and must be handled the same way: encrypted at rest, deleted
after the drill, never committed.

**3. Extensions — NOT covered, and functions fail without them.**
`pgcrypto` and `uuid-ossp`, both in the `extensions` schema. A restore must
create the schema and both extensions **before** loading `public`, or the
function bodies that reference them break at call time rather than at load
time — which is the worst moment to find out.

**4. Storage — covered today by being empty.**
One bucket, `attachments`, private, **0 objects**. The bucket's existence is
part of the schema; its contents are currently nothing. This becomes a real
layer the moment `P-06` ships attachments, and a dump that silently omits a
parent's scanned documents would look successful. Revisit this section then.

## What is not in a backup at all, by design

- **The device mirrors.** Every phone holds a full SQLite copy. That is a
  recovery path of last resort, not a backup: it is per-family, it can be
  stale, and after `G2-33` it is excluded from iCloud, so it does not survive
  losing the phone.
- **Secrets.** `SENTRY_AUTH_TOKEN`, the Supabase keys, the probe credentials.
  These are rotated, not restored. Losing them is an inconvenience; including
  them in a backup is a liability.
- **`pg_cron` schedules.** The extension **is** installed (in `pg_catalog`) and
  has **zero jobs** today. An earlier note in the launch plan said production
  has no `pg_cron` at all, and used that to argue the check-in nudge (`P-08`)
  would need building from scratch. That is wrong: the extension is there and
  jobs are schedulable. If a job is ever added, `cron.job` becomes a fifth
  layer, because it lives in neither `public` nor `auth`.

## The honest statement of where this leaves us

- **The drill covers the data, not the application.** Restoring today's backup
  would give back every medication and dose, and nobody able to log in.
- **What Supabase does on its own — checked 2026-09-24.** The organisation
  (`hanchoister's org`) is on the **Pro** plan, so Supabase's own automated
  daily backups apply; `G0-03` bought that on 09-03. An earlier version of this
  paragraph said it "has never been checked", which was wrong — the plan was
  recorded in `G0-03` all along and nobody joined it up.
  **One claim still to check in the dashboard:** the launch plan describes Pro
  as bringing "automated PITR". Point-in-time recovery is a paid add-on on top
  of Pro rather than part of it, so the honest position is daily backups yes,
  PITR unconfirmed. That difference matters: daily backups lose up to a day,
  PITR loses minutes.
- **Nothing *of ours* is automated.** Supabase's own daily backups run without
  us, per the row above. What does not exist is a scheduled dump we control and
  can restore from on our own terms — the runbook in the launch plan is a thing
  a person does, and the last time a person did it was 2026-09-02. The two are
  not interchangeable: Supabase's backup restores a Supabase project, and the
  drill above is what proves we could stand the app up somewhere else.
- **Two tables have never been through any drill:** `audit_log` and
  `share_kits` were added on 09-03, after it. (`share_kits` was later removed
  by `G1-31`, so in practice it is `audit_log`, plus everything added since:
  `terms_acceptances`, `parent_consent_events`, `evergreen_metrics`.)

## What to change in the runbook

The runbook in the launch plan proves the data survives. To prove the
*application* survives, it needs three additions:

1. Dump `auth.users` and `auth.identities` alongside `public`, and treat that
   file as health data.
2. Before restoring `public`, `create schema extensions` and create `pgcrypto`
   and `uuid-ossp` in it.
3. End the drill by **calling a function that needs both layers** rather than
   by counting rows — `create_invite` needs `pgcrypto` and `is_family_member`
   needs a real membership row, so one successful call proves more than a
   hundred matching counts. Row counts are what passed while the restore was
   unusable.

Until those three land, the drill's result should be read as "the data is
safe", never as "we can restore".
