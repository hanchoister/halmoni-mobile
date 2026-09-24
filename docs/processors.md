# Everyone who touches Halmoni data

**G2-38. Written 2026-09-24**, built by reading what the code actually calls and
what the live pages actually load — not from memory, and not from the privacy
policy, which is the document this is supposed to keep honest.

Washington's My Health My Data Act lets you share consumer health data with a
processor only "pursuant to a binding contract" that limits what they may do
with it, and requires deletion requests to be passed on to them. Connecticut
and Nevada are similar. So this list has two jobs: name everyone, and record
whether a contract is actually in place.

## Touches health data

| Processor | What it holds | Contract |
|---|---|---|
| **Supabase** | Everything. The database (26 tables), authentication, and the `attachments` bucket (private, 0 objects today). Region `us-east-1`. | **`G2-03` — unverified.** The published app privacy policy already claims IDTA/SCC cover for the US transfer. That claim must be true, and nobody has checked it. |
| **Sentry** | Crash reports, org `hana-zp`. Scrubbed before sending — error messages dropped entirely, breadcrumb query strings stripped, `user` reduced to an id. `verify:scrub` guards it in CI and failed the first time it ran, so the scrubbing is real rather than assumed. | Not checked. |
| **Apple** | Once TestFlight starts: the build, crash logs, and tester email addresses. | Standard developer agreement, already accepted. |
| **Expo / EAS** | Build infrastructure. Sees the source and the build secrets, not user data at runtime. `EXPO_PUBLIC_SENTRY_DSN` and the Supabase publishable key are in `eas.json`; `SENTRY_AUTH_TOKEN` is an EAS secret. | Not checked. |

## Touches the website, not health data

| Processor | What it sees | Note |
|---|---|---|
| **Vercel** | Hosting for halmoni.app. Request logs, so visitor IPs. | Named in both privacy pages. |
| **Google Fonts** | `fonts.googleapis.com` and `fonts.gstatic.com` are loaded by `index.html`, so Google sees every visitor's IP address. | Named in both privacy pages — correct, and worth keeping that way. Self-hosting the two families would remove the processor entirely, which is the simplest way to make this row disappear. |

## Named in the policy but no longer real

**Formspree.** `privacy.html` says the site "collects one email through the
waitlist, which posts to Formspree". It does not. There is no Formspree
reference anywhere in `index.html`, no `fetch`, and the form's `action` is `#`.

The submit handler calls `preventDefault()`, prints *"Thanks — we'll be in touch
when we launch."*, and resets the field. **Every address anyone has ever typed
into the waitlist was discarded, and they were told otherwise.** Filed as
`G0-13`; it is a product problem first and a policy problem second, and the
policy cannot be corrected until it is decided where those emails should go.

## Configured but unused

`EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` are set in `.env.local` and exported by
`expo prebuild`, but **nothing in `src/` reads them** — there is no Google
sign-in. Stale environment variables, not a processor. Worth deleting so the
next person reading `.env.local` does not conclude the app has Google auth, and
worth remembering if sign-in with Google is ever added, because that makes
Google an identity processor and changes this document.

## What is deliberately not here

- **`@noble/ciphers` and `@noble/hashes`** run entirely on the device. No
  network, no processor.
- **The on-device SQLite mirror** is not a processor, it is the user's own copy.
  It is excluded from iCloud backups as of `G2-33`, and what it means for a
  removed member is `G2-55`.
- **Groq and any Evergreen service.** Evergreen is a different app. The only
  thing it shares is the `evergreen_metrics` table sitting in Halmoni's
  production database, which is `G2-47`, and whose anonymous write path is
  closed by migration 17.

## What is still owed

1. **`G2-03`** — confirm the Supabase DPA and transfer terms exist. The policy
   already promises them.
2. A contract or a documented assessment for **Sentry** and **Expo**.
3. A deletion-request path that actually reaches each processor, which is
   `G2-39`'s other half.
4. Re-read this list whenever a dependency is added. The honest trigger is any
   new entry in `package.json` or any new host in the landing page's HTML.
