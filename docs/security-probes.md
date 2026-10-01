# Security probe accounts

The RLS attack suite (`npm run verify:rls`) holds real accounts and attacks
production with real user JWTs. That is the whole point: the SQL editor and the
MCP connection both connect as a privileged role, and RLS is not applied to
them — so every "the policies look right" check before this suite existed ran
on a path where RLS was switched off.

**The suite never creates accounts.** A script that can provision users on
production is a script that can be run carelessly against real family data, so
creating them is a deliberate manual step. This file is that step.

## What exists, and what each one is for

| Probe | State it must be in | What it proves |
|---|---|---|
| **A** | Owner of its own family | The attacker's side of every cross-family probe |
| **B** | Owner of a *different* family | The victim's side — one family must not reach another's |
| **C** | **Removed** (`deleted_at` set) in a family | A removed member keeps no access (the migration-14 regression) |
| **D** | **Live non-owner** in **probe A's** family | A member cannot promote themselves to owner (`G2-54`) |

Two of these have states that are easy to destroy by being helpful:

- **Probe C must stay removed.** It is the regression fixture. If someone
  un-removes it to "fix" it, the suite goes inconclusive and the original bug —
  removed members retaining full read/write access to a family's health
  record — becomes invisible again.
- **Probe D must stay a non-owner.** If D is ever promoted, the escalation
  probe cannot ask its question, because an owner setting `is_owner = true` is
  a no-op rather than an escalation.

The suite checks both fixtures before trusting any result, and reports
`INCONCLUSIVE` rather than passing, so a broken fixture is visible instead of
silent.

## Creating probe D

This is the one still missing. It needs an email you can confirm, and it has to
be done by hand because Claude's write access to `auth.*` on production is
deliberately blocked.

1. **Make the account.** Sign up in the app (or Supabase → Authentication →
   Add user) with a fresh address, and confirm it. A plus-address on an inbox
   you already own is fine — `you+probe-d@…`.

2. **Get it into probe A's family as a member, not an owner.** Do this through
   the app's own invite path rather than by inserting a row, so the fixture is
   created the way a real sibling would be:
   - sign in as **probe A**, create an invite code;
   - sign in as **probe D**, accept it.

   `accept_invite` creates the membership with `is_owner = false`, which is
   exactly the state needed.

3. **Check the fixture.** Run this read-only query and confirm one row comes
   back, with `is_owner = false`, `deleted_at` null, and the same `family_id`
   as probe A:

   ```sql
   select fm.id, fm.family_id, fm.is_owner, fm.deleted_at, u.email
   from public.family_members fm
   join auth.users u on u.id = fm.user_id
   where u.email in ('<probe A email>', '<probe D email>')
   order by u.email;
   ```

4. **Add two GitHub secrets** — Settings → Secrets and variables → Actions:
   `PROBE_D_EMAIL` and `PROBE_D_PASSWORD`. The workflow already reads them.

Until those secrets exist, the suite runs and reports:

```
[ ??   ] live non-owner escalation   PROBE_D_EMAIL / PROBE_D_PASSWORD not set —
                                     the escalation trigger is unverified this run (G2-54)
```

which is the intended behaviour: it does not pass, and it does not pretend to.

## What probe D actually tests

Four attacks and one positive control. All four should be refused; the control
should succeed, and is there so that an over-tightening which locks real
caregivers out shows up as a failure instead of looking like extra security.

| # | Attack | What should stop it |
|---|---|---|
| 7a | D sets its own `is_owner = true` | `enforce_owner_change_by_owner` trigger |
| 7b | D sets the owner's `is_owner = false` | `members update` is scoped to `user_id = auth.uid()` |
| 7c | D sets the owner's `deleted_at` | migration 15 — `deleted_at` is server-only |
| 7d | D renames the family | the `families update` policy |
| — | D reads its own family's record | *nothing — this must work* |

7a is the one that matters most, and it is why this probe exists. The
`members update` policy is `USING (user_id = auth.uid())` with **no WITH
CHECK**, so the policy text constrains no column at all — a member rewriting
their own `is_owner` is stopped by a trigger, not by RLS. That trigger was
confirmed by hand once, on 2026-09-20, and nothing repeated the check until
this probe. A trigger nobody re-tests is a trigger that can be dropped by a
future migration without anyone noticing.

Note that 7a and 7b re-read the row rather than trusting the PATCH response. A
PostgREST `PATCH` that matches no rows returns `200` with an empty array, so
reading the status alone would score a refusal correctly by accident — and
would score a *successful* escalation as a pass if the response shape ever
changed.

## Running it locally

```bash
PROBE_A_EMAIL=… PROBE_A_PASSWORD=… \
PROBE_B_EMAIL=… PROBE_B_PASSWORD=… \
PROBE_C_EMAIL=… PROBE_C_PASSWORD=… \
PROBE_D_EMAIL=… PROBE_D_PASSWORD=… \
npm run verify:rls
```

Exit 0 means every attack was repelled. Exit 1 means at least one got through,
or the suite could not run. It never exits 0 on "skipped" — a security check
that quietly skips reports "fine" forever, which is how CI went unwatched for a
month (`G0-11`).
