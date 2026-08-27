# Halmoni iOS — App Store submission checklist

Built 2026-08-26 by auditing the repo directly. Every claim below was verified
against a file, not assumed. Unchecked = confirmed missing or unconfirmed.

Bundle ID `com.hanachoi.halmoni` · EAS project `11439ff4-…` · Expo SDK 54 ·
version `1.0.0` (app.json).

---

## Hard blockers — submission will be rejected without these

- [ ] **Account deletion.** Guideline 5.1.1(v): any app with account creation
      must let users delete the account *in-app*. `src/app/account.tsx` offers
      only sign-out. Needs a delete path that removes the `auth.users` row and
      cascades family data — plus a decision on what happens to a family when
      its **owner** deletes (orphaned families are the trap here).
- [ ] **Privacy policy URL.** Required in App Store Connect, and required to be
      reachable from inside the app. `halmoni.uk` has no `/privacy` page —
      only `index.html`, `/demo`, and `/view`. Must be written and deployed.
- [ ] **Privacy nutrition label.** Halmoni stores medications, symptoms,
      appointments, visit notes — Apple classes this as **Health & Fitness
      data**, one of the most scrutinised categories. The App Store Connect
      data-collection questionnaire must be filled in accurately and match
      what the app actually does.
- [ ] **`eas.json` does not exist.** No build or submit profiles, so
      `eas build --platform ios` / `eas submit` cannot run at all. Nothing
      can be shipped until this is created.

## Verify before submitting — likely fine, but currently undocumented decisions

- [ ] **Encryption declaration.** `app.json` sets
      `ITSAppUsesNonExemptEncryption: false`, but the app *does* encrypt:
      AES-GCM-256 with PBKDF2-SHA256 (`src/lib/crypto/`). Standard-algorithm
      use for a normal purpose is usually exempt, so `false` is probably
      right — but it should be a recorded, deliberate call, not a default.
      Note France requires its own declaration regardless.
- [ ] **Medical copy review.** The app handles medications and dosing. Apple
      applies Guideline 1.4.1 to anything that reads as medical advice. Copy
      should be clearly a *coordination and record-keeping* tool — never
      dosing guidance. One deliberate pass over user-facing strings.
- [ ] **`experiments.baseUrl: "/demo"`** in `app.json` exists to serve the web
      demo build under `halmoni.uk/demo`. Confirm it has no effect on native
      routing in a **release** build (it shouldn't — but verify, don't assume).

## Security items — worth fixing before real users, not submission blockers

- [ ] **`flowType: 'implicit'`** in `src/lib/supabase.ts:27`. PKCE is the
      correct flow for a native client; implicit is the legacy web flow.
- [ ] **Session tokens in AsyncStorage** (`src/lib/supabase.ts:23`).
      Unencrypted at rest. `expo-secure-store` (not currently a dependency)
      backs onto the iOS Keychain. Worth doing given the app already ships a
      biometric lock — right now the lock guards a door whose window is open.
- [ ] **No crash reporting.** No Sentry/Bugsnag/Crashlytics anywhere. Not a
      blocker, but it means launching blind: a crash-on-launch for a subset of
      devices would be invisible to you.

## Store listing assets — none of this exists yet

- [ ] Screenshots: 6.7" and 6.5" iPhone required, iPad too (`supportsTablet:
      true` is set, so iPad screenshots become mandatory — or drop tablet
      support to avoid the work)
- [ ] App description, subtitle, keywords, promotional text
- [ ] Support URL (required) and marketing URL (optional)
- [ ] Age rating questionnaire
- [ ] App Review demo account — reviewers must be able to sign in. Note the
      OTP flow: an 8-digit emailed code is awkward for a reviewer. Either
      provide a mailbox they can reach or a documented bypass.

---

## Closed — audited and found to be a non-issue

- ~~PBKDF2 iteration count too low~~ (flagged in the Cursor audit as
  client-side item #9). **Not a real finding.** `src/lib/crypto/encrypt.ts:12`
  sets `KDF_ITERATIONS = 210_000`, which *is* OWASP's 2023 recommendation for
  PBKDF2-SHA256. No change needed.

---

## Suggested order

1. `eas.json` + a successful TestFlight build — until this works, nothing else
   can actually be verified on a real device.
2. Account deletion — the biggest chunk of real product work, and it needs the
   owner-deletion decision made first.
3. Privacy policy page → deploy to `halmoni.uk/privacy`.
4. Switch to PKCE + SecureStore while still pre-users; both get harder to
   change once real sessions exist in the wild.
5. Screenshots and listing copy last — they churn with every UI change, so
   doing them early wastes the work.
