# Export compliance / encryption declaration

**Decision: `ITSAppUsesNonExemptEncryption: false` is correct. Keep it.**
Recorded 2026-09-02. Previously it was an unexamined default in `app.json`; the
App Store checklist flagged that it should be a deliberate, written call.

> This is a documented engineering rationale, not legal advice. If Halmoni ever
> ships to customers with contractual compliance obligations, get it reviewed.

## What the app actually encrypts

Verified against the source, not assumed:

| Where | What |
| ----- | ---- |
| `src/lib/crypto/encrypt.ts` | AES-GCM-256 with PBKDF2-SHA256 key derivation (210,000 iterations), for the encrypted care kit |
| `src/lib/crypto/share-kit.ts` | Uses the above; the server and Storage only ever hold ciphertext |
| Supabase client | HTTPS/TLS for all traffic |
| `expo-secure-store` | iOS Keychain for the session token |
| iOS platform | Device-level encryption of the SQLite mirror |

## Why the declaration is `false`

`ITSAppUsesNonExemptEncryption: false` asserts the app contains no
*non-exempt* encryption. It does not claim the app has no encryption at all —
a common misreading, and the reason this needed writing down.

Halmoni qualifies as exempt on every point that matters:

1. **Standard published algorithms only.** AES, SHA-256, PBKDF2, TLS. Nothing
   proprietary, and no cryptography Halmoni implemented itself.
2. **Encryption is not the product.** It protects user data at rest and in
   transit. Halmoni is a care-coordination app, not a security tool.
3. **The exempt purposes fit.** Authentication, and protecting the user's own
   data — both named categories.
4. **Not made available to third parties as a crypto capability.** No SDK, no
   API exposing encryption to anyone else.

## Two things not to forget

- **France requires its own declaration** regardless of the US exemption, if
  the app is distributed there. Handled in App Store Connect's availability
  settings, separately from this key.
- **Re-check this if the crypto's role changes.** Adding end-to-end encrypted
  messaging, or making encryption a headline feature rather than an
  implementation detail, is the kind of change that can move an app out of
  exemption. The trigger is a change of *purpose*, not of algorithm.

## Answering the App Store Connect questionnaire

At submission Apple asks the same question again in the web UI. To match this
declaration: *"Does your app use encryption?"* → **Yes**. *"Does it qualify for
any of the exemptions?"* → **Yes**, the standard-algorithms exemption. Answering
"No" to the first question would contradict `app.json` and is inaccurate — the
app plainly does encrypt.

---

# Addendum: `experiments.baseUrl`

Removed from `app.json` on 2026-09-02. It was set to `/demo` to serve the web
demo build under `halmoni.app/demo`.

The App Store checklist flagged it as "should be inert on native — but verify,
don't assume". Verified, and it was **not** inert: with `baseUrl` set, the iOS
bundle embedded asset paths like `/demo/assets/node_modules/@expo-google-fonts/…`
and `classic-assets.eascdn.net/~assets/demo/assets/…`. Removing it dropped
`/demo` from the native bundle from 3 occurrences to 0 and left asset paths
clean, which establishes cause rather than correlation.

The risk was fonts or images failing to resolve in a release build — the kind of
fault that appears only after a TestFlight round trip.

**To rebuild the web demo**, restore `experiments.baseUrl: "/demo"`, run the web
export, and remove it again before any native build. Better still: move
`app.json` to `app.config.js` and set it only when `process.env.EXPO_PLATFORM`
is web, so the two builds cannot interfere. Not done now because Halmoni is
mobile-only and the web demo is a stale marketing artifact.
