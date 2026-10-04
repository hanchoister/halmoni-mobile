# What "deleted" and "removed" can honestly promise

Written for `G2-55`. The point of this document is to stop the app's words
outrunning its code. Every claim below is either verified against the source, or
marked as not yet true.

A privacy policy that promises erasure it cannot perform is a worse problem than
one that admits a limit, because the first is a false statement about health data
and the second is a design constraint.

## The shape of the problem

Halmoni is offline-first. Every phone in a family holds a full SQLite mirror of
the care record — medications, doses, appointments, notes — so the app works on
a plane and in a hospital basement. That is a real feature, and it is also the
reason "delete" cannot mean what people assume.

A server-side delete ends **new** access. It cannot reach a copy that already
exists on somebody else's phone.

## The four levels, weakest to strongest

| Level | What it does | Status |
|---|---|---|
| 1 | Revoke the refresh token, so the session dies at next refresh and the access token within its TTL (1h default) | **Not built** — lands with the removal feature |
| 2 | Best-effort wipe: on launch, a device that finds its membership revoked deletes its local mirror | **Not built** for revoked membership. Related and now done: a **sign-out** wipes the local mirror (`G2-69`, 2026-10-04) — it previously did not, so the full record survived signing out. |
| 3 | Keep the mirror out of iCloud backups, so a copy does not survive in Apple's cloud | **Done** 2026-09-23, `G2-33` |
| 4 | Encrypt the mirror with a key the device fetches at sign-in and never stores, so revoking a member turns their copy into unreadable ciphertext | **Not built** — the only technical guarantee |

Only level 4 is a guarantee rather than a best effort, and it means migrating
from `expo-sqlite` to `op-sqlite` with SQLCipher. **Decision: 1–3 ship with the
removal feature; 4 is a post-beta decision.** Hana asked to be reminded once
there are real test users.

## So the honest wording is

> We end access immediately, and the local copy is deleted when the app next
> opens.

and never anything that implies erasure from a device the family no longer
controls.

## What was NOT true, and is now

The published policy used to say:

> Removing the person you care for deletes their record and everything attached
> to it — medications, doses, appointments, notes — on every phone in the circle.

**It did not happen, on either side.** Verified against the code and against
production on 2026-10-01/04. `softDelete` set `deleted_at` and nothing else, and
`repository.list()` filtered tombstoned rows out of UI reads — so the record
*disappeared from view* while the content stayed. Measured on production before
the fix: **805 tombstoned `med_doses`, 4 `medications`, and 2 `parents`** — two
people whose records had been "deleted" and whose names, conditions, allergies
and DNR status were still in Postgres. No purge job existed.

The policy's other sentence was misleading in a quieter way: deleted information
"disappears from the app straight away and from our backup copies within 30
days". Backups do roll over — but the live row never went anywhere, so every new
backup kept including it, and the 30 days never arrived.

**Fixed 2026-10-04 (migration 20, `616666e`).** Nine `BEFORE INSERT OR UPDATE`
triggers blank a row's content the moment `deleted_at` is set. The row itself
stays, because tombstones are how other devices learn a thing was deleted rather
than never seen; what remains is ids and timestamps.

The device side comes free, which is why the server was the right place for it:
blanking bumps `updated_at`, so the blanked row is an ordinary sync delta that
every phone pulls and writes over its own copy. `purgeLocalRow` additionally
drops the row on the deleting device immediately, closing the window until its
next pull.

Verified after applying: 9 triggers enabled, **0** rows holding content across
all nine tables, 811 tombstone shells intact.

### What is deliberately still kept

| Kept | Why |
|---|---|
| `family_members`, `families` | A member's name is not the parent's health record, and `notes.author_member_id`, `appointments.attending_member_id` and `parents.consent_attested_by` all point at it — blanking it would erase attribution on live history. Member removal is `G2-55` level 2. |
| `parents` consent columns | They are the evidence that holding the record was authorised, which outlives the record (`G2-44`), and `parents_consent_shape` is an all-or-nothing CHECK. |
| `on_duty` | Its only non-structural column is a timestamp. |
| NOT NULL enums and timestamps | An appointment slot with no provider, or a severity with no description, is not a health fact — and inventing a value to satisfy NOT NULL would be worse. |

### The limit that remains

"Each phone as soon as it next connects" is the honest ceiling. A phone that is
never opened again keeps whatever it already had. No server-side change reaches
it; only level 4 (an encrypted mirror) would, and that is a post-beta decision.

### Not covered yet: attachment files

Blanking covers database rows. It does not delete **files** in the `attachments`
storage bucket. There are currently **0 files and 0 attachment rows**, so there
is no gap today — but when attachments ship, deleting a record must also delete
its objects from storage. Filed as `G2-70`.

## Related, and already settled

- **Deleting the app signs you out** (`G2-59`). It did not, because keychain
  entries survive app deletion on iOS, so a reinstall dropped someone straight
  back into a family's medical record. Fixed 2026-09-30.
- **Removed members keep no access** (`G1-03`, migrations 14–15). A removed
  member could previously read and write a family's whole record; the membership
  predicate ignored `deleted_at`. Fixed, and probe C in the attack suite is
  pinned in the removed state so the regression cannot come back unnoticed.
- **Rejoining is not self-service** (`G2-57`). It needs a live invite code, and
  only a current member can mint one.
