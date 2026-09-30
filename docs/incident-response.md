# Incident response

One page. Halmoni is run by one person, so this is written for one person at
2am — not for a team with a rota.

**The governing fact:** Halmoni holds health data about people who are not its
users. A parent whose medications are in here never signed up. That is why the
data questions below come before the availability ones.

---

## Severity

| | Meaning | Response |
|---|---|---|
| **SEV1** | Health data exposed to the wrong person, or lost | Stop everything. Start the clock — see *Data exposure*. |
| **SEV2** | App unusable for everyone: sync dead, cannot log in, crash on launch | Same day. |
| **SEV3** | One feature broken, or one family affected | Next working session. |
| **SEV4** | Cosmetic, or a nuisance with a workaround | Backlog. |

**Any doubt between two levels, take the higher one.** A wrong SEV2 costs an
evening. A wrong SEV3 that was a SEV1 costs the thing the product is for.

---

## First 15 minutes, any severity

1. **Write down the time and what you observed.** Not what you think caused it.
   Memory rewrites itself once you have a theory.
2. **Is health data exposed or lost?** If yes or unsure → *Data exposure*.
3. **How many families?** One, or all? That splits "a bug" from "an outage".
4. **What changed?** Last app release, last migration, last deploy. Most
   incidents are the most recent change.
5. **Stop the bleeding before diagnosing.** Halting a rollout or reverting a
   migration is reversible; a full diagnosis at 2am is not.

---

## Data exposure or loss — SEV1

**Do these in order. Do not skip to the fix.**

1. **Contain.** Revoke what is leaking: rotate the DB password
   (Project Settings → Database), revoke the affected user's sessions, or
   disable the affected RLS-covered path. Do this before you understand the
   whole picture. **There are no share kits any more** — `G1-31` removed the
   table and the doctor link in migration 12, so do not go looking for
   `share_kits.revoked_at`. The Care Kit is a locally generated PDF with no
   server-side artefact to revoke.
2. **Preserve evidence.** Screenshot dashboards, save the logs. Log retention
   is finite and will not wait for you. Also take a manual backup before you
   change anything — `bash ~/halmoni-mobile/scripts/backup-halmoni.sh` — so the
   state at the moment you noticed is preserved, not just the state after you
   started fixing.
3. **Establish scope.** Which rows, which families, which people — including
   the parents, who are not users and cannot check for themselves.
4. **Write the timeline** while it is fresh: when it started, when you noticed,
   what was reachable, what you did.
5. **Notification is a legal question, not a technical one.** Health data about
   identifiable people triggers state breach-notification duties on timelines
   you cannot afford to discover late. Do not decide alone that it does not
   apply. Get advice with the timeline in hand.

**Never:** quietly fix it and move on. The families are managing someone's
medications on the strength of this record.

---

## Playbooks

**Sync broken for one device**
Account → Reset local data rebuilds the mirror from the server. Check the
diagnostics screen for quarantined writes first (`MAX_PUSH_ATTEMPTS = 5`) — the
`last_error` on a quarantined row usually names the cause. A 403 means the
device is no longer a family member; a 409 means it references a row that is
gone.

**Sync broken for everyone**
Check Supabase status and whether the project auto-paused. Then check RLS: a
policy change can silently return zero rows rather than an error, which looks
exactly like an empty account.

**Project auto-paused (free tier, 7 days idle)**
Restore from the dashboard. On Pro this cannot happen — the reason `G0-03`
exists.

**Crash on launch after a release**
Halt the phased rollout in App Store Connect first, then diagnose. TestFlight
builds can simply be expired.

**Bad migration**
Two nets, in this order. **1.** `~/HalmoniBackups/` holds a daily encrypted
dump (`scripts/backup-halmoni.sh`, launchd, since 2026-09-29) — most recent
first, decrypt with `~/.halmoni-backup.key`. **2.** Supabase's own daily backup
on Pro. Point-in-time recovery was priced and declined (2026-09-28), so **the
worst case is losing up to a day**, not minutes.

What a restore does and does not give you is in `docs/backup-completeness.md`,
and the order matters: extensions first, then `public`, then `auth`. **Prove it
by calling `create_invite()` and `is_family_member()`, not by counting rows** —
matching row counts are exactly what passed while a restore was unusable.

Of the 66 policies in `public`, **12 reference `auth.uid()` directly** and will
not apply on a plain Postgres without an `auth.uid()` stub; the other 55 go
through `public.is_family_member(...)`. Assume any restore leaves the app
non-functional until `auth` is dealt with.

**Landing page or demo broken**
`cd ~/halmoni-landing && git push origin main`. Production follows `main` within
seconds. **Corrected 2026-09-29:** this page previously said the GitHub
integration was broken and to run `vercel --prod --yes` by hand. That has been
untrue since 2026-09-07, and following it produced pairs of duplicate
deployments. Verified again today by pushing the waitlist fix and watching it go
live. Reach for the CLI only if a git deploy demonstrably does not appear.

---

## Where to look

| | |
|---|---|
| Supabase | Logs, Advisors, Database health — project `wyovvbnlhyqfmnvsgket` |
| Vercel | Deployments and runtime logs for `halmoni-landing` |
| App Store Connect | Crash reports, phased release controls |
| EAS | Build and submission history |
| In-app | Diagnostics screen: backend ref, last sync, pending and quarantined writes |

**Closed since this page was written:** Sentry *is* installed (`G1-07`), scrubbed
so crash reports cannot carry health data (`verify:scrub` guards it in CI), and
symbol upload works (`G2-43`). Every event is tagged with whether the device can
resolve timezones (`tz.resolves`), which is the one thing that silently breaks
dose times. The diagnostics screen exists too (`G1-09`) — backend ref, demo
mode, last sync, pending and quarantined writes, and a TIME card.

**The remaining hole:** no crash data has ever come from a real device, because
no build has run on one (`G2-56`). Sentry is wired but unproven in the field.

---

## After

Write it into the living plan's changelog: what happened, what you actually
did, and what would have caught it earlier. One entry, same day — the lesson
evaporates within about a week.

If the fix was a workaround, open an item for the real fix before you close the
incident. Workarounds that were never followed up are how the next SEV1 gets
built.
