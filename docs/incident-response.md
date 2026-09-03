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
   (Project Settings → Database), revoke share kits
   (`share_kits.revoked_at`), or disable the affected RLS-covered path. Do this
   before you understand the whole picture.
2. **Preserve evidence.** Screenshot dashboards, save the logs. Supabase's free
   tier retains little, and it will not wait for you.
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
There is no automated backup on the free tier. Recovery means the most recent
`pg_dump` — see the backup runbook in the living plan — which restores **care
data only**: not accounts, not storage, and not 10 of the 31 RLS policies.
Assume any restore leaves the app non-functional until `auth` is dealt with.

**Landing page or demo broken**
`cd ~/halmoni-landing && vercel --prod --yes`. Git push alone does not deploy —
the GitHub integration has been broken since 2026-08-10.

---

## Where to look

| | |
|---|---|
| Supabase | Logs, Advisors, Database health — project `wyovvbnlhyqfmnvsgket` |
| Vercel | Deployments and runtime logs for `halmoni-landing` |
| App Store Connect | Crash reports, phased release controls |
| EAS | Build and submission history |
| In-app | Diagnostics screen: backend ref, last sync, pending and quarantined writes |

**Gap, as of 2026-09-02:** Sentry is not installed (`G1-07`). Until it is,
"did it crash, and why" can only be answered by asking the family. That is the
single biggest hole in this page.

---

## After

Write it into the living plan's changelog: what happened, what you actually
did, and what would have caught it earlier. One entry, same day — the lesson
evaporates within about a week.

If the fix was a workaround, open an item for the real fix before you close the
incident. Workarounds that were never followed up are how the next SEV1 gets
built.
