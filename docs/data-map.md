# Data map

Every field Halmoni stores, where it goes, and who can see it.

**Why this exists.** The privacy policy enumerates Halmoni's data field by
field, and the App Store privacy labels (`G2-05`) must match it. Both go stale
the moment a column is added. This file is the source both are checked against.

**Keep it current.** Any migration that adds a column is incomplete until it
appears here, in the privacy policy, and in the App Store labels. That is the
real cost of a new field, and it is the reason `P-23` exists.

Regenerated from the live `halmoni-prod` schema on 2026-09-23 (`information_schema.columns`
and `storage.buckets`, queried directly — not from memory or the last version of this file):
**26 tables** in `public`, one storage bucket. Storage and the `auth` schema are covered at
the end. This supersedes the 2026-09-03 version: the `share_kits` table and bucket are
confirmed gone (`G1-31`), and five tables have arrived since — `audit_log`,
`parent_consent_events`, `terms_acceptances`, `evergreen_metrics`, and the consent columns
added directly to `parents`.

---

## Who can see what — the three rules

1. **Family-scoped by default.** Almost every table carries `family_id`, and
   RLS restricts reads to members of that family via
   `public.is_family_member(family_id)`. There is no cross-family access and no
   "all families" view.
2. **The parent is not a user.** The person being cared for has no account and
   cannot log in, see, correct or export their own record. Everything in
   §2 is health data about someone who never agreed to any of it — though as
   of `G1-28`/`G1-32` every live parent row now carries who attested to what
   authority, and when. That asymmetry is still the single most important
   fact on this page; consent narrows the legal exposure, it does not remove
   the asymmetry.
3. **One deliberate exception.** `private_journal_entries` is scoped to the
   authoring member, not the family. It is the only table siblings cannot read.

---

## 1. Account and identity

| Field | Where | Notes |
|---|---|---|
| Email address | `auth.users` (Supabase) | Sign-in only. Magic-link OTP — **no password is asked for, stored or seen** |
| User id | `auth.users`, referenced by `families.created_by`, `family_invites.created_by`, `family_members.user_id`, `terms_acceptances.user_id` | The only link between an account and a family |
| Terms/Privacy acceptance | `terms_acceptances` — document, version, accepted_at | **G1-33.** The USER'S OWN agreement to Halmoni's terms, distinct from §2 below, which is the parent's data. Append-only: no update or delete policy exists, by design (verified by `scripts/verify-consent.js`) |

**Not in the `public` schema.** This is why the `G1-05` backup drill could not
restore accounts: `--schema=public` excludes `auth` entirely.

## 2. Health data about the parent — special category data

The most strongly protected class under UK/EU law, and the heart of the app.

**`parents`** — name, nickname, photo_url, dob, conditions[], allergies[],
blood_type, preferences, ice_contacts (jsonb), pharmacy (jsonb),
primary_doctor (jsonb), insurance (jsonb), **dnr_status**, **healthcare_proxy**
(jsonb), last_verified_at/by, plus five consent columns added by `G1-28`/`G1-32`:
**consent_basis**, **consent_attested_at**, **consent_attested_by**,
**consent_notice_version**, **consent_sharing_at**. A live row cannot exist
without all five (`parents_consent_required`, enforced by both a CHECK
constraint and RLS — see `G1-28`).

> `dnr_status` and `healthcare_proxy` are advance-care fields. Getting these
> wrong or stale has consequences no other field in this app has.

**`parent_consent_events`** — the append-only evidence trail for the above:
event, consent_basis, consent_attested_at, consent_sharing_at,
consent_notice_version, claimed_by, recorded_by, recorded_at. Write access is
revoked from `authenticated` entirely — it is populated only by the
`parents_record_consent` trigger, never by a client request, so it is evidence
*about* what a client did rather than something a client can shape.

**`medications`** — name, dose, purpose, schedule (jsonb), shape, photo_color,
prescriber, pharmacy, refill_by, pills_left, started_at, notes.

**`med_doses`** — scheduled_at, given_at, given_by_member_id, skipped,
skip_reason. An adherence record: who gave what, when, and what was missed.

**`symptoms`** — description, severity, observed_at, observed_by_member_id,
possible_med_links[], resolved. **`severity` and `resolved` are legacy
columns the app no longer writes or reads** — `G1-23` (2026-09-13) replaced
urgency-sorted symptom triage with a neutral "logged within 14 days of a
medication" list that makes no severity judgment; see `src/lib/detective.ts`.
They remain in the schema and are covered by `P-04` (decide whether to read
them, backfill them, or drop them).

**`appointments`** — provider_name, specialty, location, starts_at,
duration_min, prep_notes, summary, attending_member_id, status.

**`visit_notes`** — kind (diagnosis / new-med / stop-med / follow-up /
instruction / voice / other), body, captured_at. Free text from a clinical
visit; assume it contains anything.

**`notes`** — body, kind, linked_id, author_member_id. Free text.

**`check_ins`** — for_date, overall, appetite, sleep, meds_all_taken,
pain_level, notes. *(Table exists; mobile does not write it yet — `P-08`.)*

**`appointment_questions`** — body, answer_text, answered_at. *(`P-09`.)*

**`voice_notes`** — title, description, file_path, mime_type, size_bytes,
duration_seconds, recorded_by_member_id. Metadata only; the audio itself is a
storage object. *(`P-20`.)*

**`private_journal_entries`** — body, mood. **Member-private.** A caregiver's
own writing about their experience, not the parent's record. *(`P-21`.)*

## 3. Caregiver profile and coordination

| Table | Fields | Who sees it |
|---|---|---|
| `family_members` | name, relation, phone, color, photo_url, is_owner | The family |
| `families` | name, created_by | The family |
| `family_invites` | code, expires_at, revoked_at | The family. A valid code grants entry — treat as a credential |
| `handoffs` | summary, personal_message, sent_at, accepted_at, until | The family |
| `thread_messages` | body, is_digest | The family |
| `on_duty` | member_id, until | The family |
| `presence` | last_seen_at, device_info | The family. Reveals when a sibling was last active |

## 4. Operational

| Table | Fields | Notes |
|---|---|---|
| `notification_preferences` | 12 boolean toggles (email/push × handoff, thread, refill, appointment, check-in nudge) | Preferences only. Note: covers the web app's *email/push* notifications; `G2-09`'s local notifications are scheduled entirely on-device and do not read this table — a gap worth closing if both notification systems are meant to respect one settings screen |
| `push_subscriptions` | endpoint, p256dh, auth, user_agent | **Web push keys**, written by the (paused) web app only. `auth` here is a push secret, not an account credential |
| `attachments` | file_path, file_name, mime_type, size_bytes, category | Metadata; the file is a storage object. Capped 25 MB, 11 MIME types (`S-10`) |
| `shared_er_cards` | token, expires_at, revoked_at | A token grants access to an emergency summary — a credential. *(Mobile has no screen for this — see `P-22`, "not a port," which is rebuilding this on a different, fragment-key design rather than reusing the token above.)* |
| `audit_log` | actor_member_id, actor_user_id, entity_type, entity_id, action, meta (jsonb), at | General operational audit trail, family-scoped. Not surfaced in any app screen today — worth a line in the privacy policy regardless, since "we log administrative actions" is a true statement about data collected even without a UI for it |

## 5. Not Halmoni's own data

**`evergreen_metrics`** — install_id, iso_week, weeks_logged, sessions_hit,
attempts, hit_rate, hit_rate_delta, used_ai, followed_lever, lever_id,
lever_verdict, profile, app_version. **This is opt-in anonymous metrics from
Evergreen, a separate, unrelated app on Hana's own machine — not Halmoni.**
The table carries a comment to this effect directly in the database
(`No personal data by construction: install_id is a random per-device id with
no account behind it, and every other column is a bounded number or a fixed
enum, so free text cannot be stored here`). It shares Halmoni's Supabase
project for convenience. Worth a decision (`G2-47`, still open): a data
subject request or a breach-notification obligation for *Halmoni* should not
have to reason about a table that is not Halmoni's data — either move it to
its own project, or make sure every process that touches "Halmoni's
database" explicitly knows to skip it.

## 6. Outside the database

- **Storage buckets** — **`attachments`** only (uploaded documents and
  images). The **`share-kits`** bucket no longer exists — removed with the
  rest of the encrypted-share-kit feature (`G1-31`, migration
  `remove_share_kits_feature`, verified against prod 2026-09-23: no bucket, no
  table, no RPCs, no storage policies, no cron job). Buckets are **not covered
  by a `pg_dump`**, per `G1-05`.
- **Local device mirror** — SQLite on each device holds a full copy of the 12
  synced tables for that family, plus `pending_writes` (unsent edits) and
  `notified_handoffs` (per-device bookkeeping for `G2-09`, not synced). As of
  `G2-33` the database file is marked excluded from iCloud/iTunes device
  backups. It survives sign-out until **Account → Reset local data** is used.
- **Local backups** — `~/halmoni-backups/` on Hana's Mac holds `pg_dump`
  output during a restore drill. Fake data today; must be an encrypted volume
  and deleted after each drill before real family data exists.

---

## Processors

| Service | Handles | Where |
|---|---|---|
| Supabase | Database, auth, file storage. All care data. | United States (N. Virginia) |
| Sentry | Crash reports, scrubbed of PHI before send (`G1-07`) | United States. **Already listed in the live privacy policy** (`halmoni.app/app-privacy`, published 2026-09-11) |
| Vercel | Hosting for the landing page. **No care data.** | Global edge |
| Expo / EAS | App delivery and updates. **No care data.** | United States |
| Apple | App Store and TestFlight distribution | Global |
| Google Fonts | Typefaces on the landing page — the browser's request exposes the visitor's IP to Google. **No care data.** | Global |
| Zoho | `privacy@halmoni.app` mailbox. Receives whatever a data-subject request contains. | — |

### ⚠️ One processor the privacy policy still does not list

**Brevo** — `~/tend/.env.local` still carries `BREVO_API_KEY`,
`BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`. The (retired-in-practice, formally
**paused**, not deleted — `app.halmoni.uk` returns `DEPLOYMENT_PAUSED`) web
app sent notification email through it, meaning Brevo would process
**caregiver email addresses and whatever the notification body contains** if
that project were ever unpaused. It is still not in the policy's processor
table. Unpausing `tend` without resolving this would put the app back in
violation immediately. Either add Brevo to the policy, or — since `P-01`
already decided mobile is the product — delete the `tend` Vercel project
outright rather than leaving it paused-and-reversible, which closes this
permanently instead of leaving it one `unpause` away from reopening.

---

## Retention and deletion

- **Soft deletes.** Every synced table carries `deleted_at`. A "deleted" row is
  retained, not removed. **There is no retention policy and nothing purges
  tombstones.** That needs a decision before real data — deleting a medication
  today leaves it in the database indefinitely.
- **Account deletion** — the `delete_my_account` RPC exists and is applied to
  prod, wipes local data and signs out. Verified end-to-end on a real account
  2026-09-04 (`G1-06`); the family-cascade branch (deleting the last member of
  a family) is still unexercised against a cleanly-synced account.
- **Parent removal** — `removeParent()` (`G1-32`/`parent-remove.ts`) deletes a
  parent and all eight parent-scoped tables, reachable from Profile. This is
  the "withdraw permission" promise the parent notice makes.
- **Free-tier backups** — none needed; Supabase Pro (`G0-03`) gives automated
  backups and PITR. Manual restore-drill dumps hold care data only (`G1-21`
  — `auth`, storage and project config are not covered by `--schema=public`).

## What Halmoni does not collect

No password (magic-link only). No location. No advertising or analytics
identifiers. No contacts, camera roll or microphone access beyond files a user
explicitly attaches. Nothing is sold, shared with advertisers, or used to train
models.

## Open questions

1. **Retention.** How long do tombstoned rows live? Nothing deletes them today.
2. **Brevo.** Add to the policy, or delete `tend` outright rather than leaving
   it paused (see above).
3. **Parent rights.** The subject of most of this data cannot exercise any
   right over it themselves — consent now records *who* authorised holding it
   and *why* (`G1-28`), which narrows but does not remove this. Worth stating
   plainly in the policy rather than leaving implicit.
4. **`device_info`** in `presence` — unbounded string. Worth capping to a
   coarse value so it cannot become a fingerprint.
5. **`evergreen_metrics`** living in Halmoni's own production database (see
   §5) — a scoping question for `G2-47`, still open.
6. **`notification_preferences` vs `G2-09`.** The preferences table exists for
   the web app's email/push toggles; the new on-device local notifications
   (`G2-09`) don't read it, so there is presently no way to turn off a specific
   *local* reminder category short of the OS-level notification switch. Worth
   deciding whether that matters before or after the first outside tester.
