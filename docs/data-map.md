# Data map

Every field Halmoni stores, where it goes, and who can see it.

**Why this exists.** The privacy policy enumerates Halmoni's data field by
field, and the App Store privacy labels (`G2-05`) must match it. Both go stale
the moment a column is added. This file is the source both are checked against.

**Keep it current.** Any migration that adds a column is incomplete until it
appears here, in the privacy policy, and in the App Store labels. That is the
real cost of a new field, and it is the reason `P-23` exists.

Generated from the live `halmoni-prod` schema on 2026-09-03: 22 tables in
`public`. Storage buckets and the `auth` schema are covered at the end.

---

## Who can see what — the three rules

1. **Family-scoped by default.** Almost every table carries `family_id`, and
   RLS restricts reads to members of that family via
   `public.is_family_member(family_id)`. There is no cross-family access and no
   "all families" view.
2. **The parent is not a user.** The person being cared for has no account and
   cannot log in, see, correct or export their own record. Everything in
   §2 is health data about someone who never agreed to any of it. That
   asymmetry is the single most important fact on this page.
3. **One deliberate exception.** `private_journal_entries` is scoped to the
   authoring member, not the family. It is the only table siblings cannot read.

---

## 1. Account and identity

| Field | Where | Notes |
|---|---|---|
| Email address | `auth.users` (Supabase) | Sign-in only. Magic-link OTP — **no password is asked for, stored or seen** |
| User id | `auth.users`, referenced by `families.created_by`, `family_invites.created_by`, `family_members.user_id` | The only link between an account and a family |

**Not in the `public` schema.** This is why the `G1-05` backup drill could not
restore accounts: `--schema=public` excludes `auth` entirely.

## 2. Health data about the parent — special category data

The most strongly protected class under UK/EU law, and the heart of the app.

**`parents`** — name, nickname, photo_url, dob, conditions[], allergies[],
blood_type, preferences, ice_contacts (jsonb), pharmacy (jsonb),
primary_doctor (jsonb), insurance (jsonb), **dnr_status**, **healthcare_proxy**
(jsonb), last_verified_at/by.

> `dnr_status` and `healthcare_proxy` are advance-care fields. Getting these
> wrong or stale has consequences no other field in this app has.

**`medications`** — name, dose, purpose, schedule (jsonb), shape, photo_color,
prescriber, pharmacy, refill_by, pills_left, started_at, notes.

**`med_doses`** — scheduled_at, given_at, given_by_member_id, skipped,
skip_reason. An adherence record: who gave what, when, and what was missed.

**`symptoms`** — description, severity, observed_at, observed_by_member_id,
possible_med_links[], resolved.

**`appointments`** — provider_name, specialty, location, starts_at,
duration_min, prep_notes, summary, attending_member_id, status.

**`visit_notes`** — kind (diagnosis / new-med / stop-med / follow-up /
instruction / voice / other), body, captured_at. Free text from a clinical
visit; assume it contains anything.

**`notes`** — body, kind, linked_id, author_member_id. Free text.

**`check_ins`** — for_date, overall, appetite, sleep, meds_all_taken,
pain_level, notes. *(Table exists; mobile does not write it yet — `P-08`.)*

**`appointment_questions`** — body, answer_text, answered_at. *(`P-09`.)*

**`voice_notes`** — title, description, file_path, duration_seconds. Metadata
only; the audio itself is a storage object. *(`P-20`.)*

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
| `notification_preferences` | 10 boolean toggles (email/push × handoff, thread, refill, appointment, check-in) | Preferences only |
| `push_subscriptions` | endpoint, p256dh, auth, user_agent | **Web push keys.** `auth` here is a push secret, not an account credential |
| `attachments` | file_path, file_name, mime_type, size_bytes, category | Metadata; the file is a storage object. Capped 25 MB, 11 MIME types (`S-10`) |
| `shared_er_cards` | token, expires_at, revoked_at | A token grants access to an emergency summary — a credential |

## 5. Outside the database

- **Storage buckets** — `attachments` (uploaded documents and images) and
  `share-kits` (client-encrypted emergency summaries). **Not covered by a
  `pg_dump`**, per `G1-05`.
- **Local device mirror** — SQLite on each device holds a full copy of the 12
  synced tables for that family, plus `pending_writes` (unsent edits). It
  survives sign-out until **Account → Reset local data** is used.
- **Local backups** — `~/halmoni-backups/` on Hana's Mac holds `pg_dump`
  output during a restore drill. Fake data today; must be an encrypted volume
  and deleted after each drill before real family data exists.

---

## Processors

| Service | Handles | Where |
|---|---|---|
| Supabase | Database, auth, file storage. All care data. | United States (N. Virginia) |
| Vercel | Hosting for the landing page. **No care data.** | Global edge |
| Expo / EAS | App delivery and updates. **No care data.** | United States |
| Apple | App Store and TestFlight distribution | Global |
| Google Fonts | Typefaces on the landing page — the browser's request exposes the visitor's IP to Google. **No care data.** | Global |
| Zoho | `privacy@halmoni.uk` mailbox. Receives whatever a data-subject request contains. | — |

### ⚠️ Two processors the privacy policy does not currently list

1. **Brevo** — `~/tend/.env.local` carries `BREVO_API_KEY`,
   `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`. The web app sends notification
   email through it, which means Brevo processes **caregiver email addresses
   and whatever the notification body contains**. It is not in the policy's
   processor table. Either add it, or confirm it is dead with the web app's
   retirement (`P-01`).
2. **Sentry** — not installed yet (`G1-07`), but the DSN vars already exist in
   both apps. The moment it is enabled it becomes a processor receiving crash
   payloads, which is exactly why `G1-07` says PHI scrubbing must be configured
   **before** the first event.

---

## Retention and deletion

- **Soft deletes.** Every synced table carries `deleted_at`. A "deleted" row is
  retained, not removed. **There is no retention policy and nothing purges
  tombstones.** That needs a decision before real data — deleting a medication
  today leaves it in the database indefinitely.
- **Account deletion** — the `delete_my_account` RPC exists and is applied to
  prod, wipes local data and signs out. **Never run on a real device** (`G1-06`).
- **Free-tier backups** — none. Recovery means the most recent manual `pg_dump`,
  which restores care data only (`G1-21`).

## What Halmoni does not collect

No password (magic-link only). No location. No advertising or analytics
identifiers. No contacts, camera roll or microphone access beyond files a user
explicitly attaches. Nothing is sold, shared with advertisers, or used to train
models.

## Open questions

1. **Retention.** How long do tombstoned rows live? Nothing deletes them today.
2. **Brevo.** Add to the policy, or confirm it dies with the web app.
3. **Parent rights.** The subject of most of this data cannot exercise any
   right over it. Worth stating plainly in the policy rather than leaving
   implicit.
4. **`device_info`** in `presence` — unbounded string. Worth capping to a
   coarse value so it cannot become a fingerprint.
