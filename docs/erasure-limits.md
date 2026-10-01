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
| 2 | Best-effort wipe: on launch, a device that finds its membership revoked deletes its local mirror | **Not built** — would reuse what `delete-account.ts` already does |
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

## A claim that is currently NOT true

The published app privacy policy says:

> Removing the person you care for deletes their record and everything attached
> to it — medications, doses, appointments, notes — on every phone in the circle.

**Verified against the code 2026-10-01: that does not happen.**
`repository.softDelete` sets `deleted_at` and nothing else, and the pull path
copies the tombstone into the mirror the same way. `repository.list()` then
filters tombstoned rows out of what the UI reads — so the record *disappears
from view* on every phone, which is probably what the sentence was describing.
But the medication names, dosages, appointment details and note text are all
still sitting in the SQLite file. There is no purge anywhere in the codebase;
`grep` for a `DELETE FROM` against a synced table finds none.

Two separate gaps, and they need different fixes:

1. **The wording over-claims.** "Deletes their record on every phone" should say
   what actually happens — the record is removed from the app on every phone,
   and the underlying copy is cleared when that phone next opens the app.
2. **The code should make the stronger version true.** On pulling a tombstone,
   the row's *content* should be purged locally rather than merely hidden,
   keeping only the id and `deleted_at` that sync bookkeeping needs.

Gap 2 is deliberately **not** implemented in the same pass that found it. It is
a destructive change to the local copy of a medical record, it has to respect
foreign keys between synced tables and `NOT NULL` columns in the mirror, and it
needs confirming on two real devices before anyone should believe it. Filed as
its own item rather than bolted on at the end of an unrelated change.

A smaller note on the same sentence: "on every phone in the circle" is true only
of phones that sync again. A sibling who stops opening the app keeps their copy
indefinitely, which is a limit no server-side change can remove — only level 4
can.

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
