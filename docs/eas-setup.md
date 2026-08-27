# EAS build & submit — setup notes

`eas.json` was added 2026-08-26. Before it can actually build or submit,
three things need doing. None of them are code.

## 1. Node is broken on this machine (blocks everything)

`/usr/local/bin/node` is an **x86_64** binary; the Mac is **arm64** and
Rosetta is not installed. `node`, `npx`, `expo` and `eas` all fail with
`bad CPU type in executable`. Homebrew is also the Intel build
(`/usr/local/bin/brew`, not `/opt/homebrew`).

Fast unblock — makes the existing toolchain work as-is:

    softwareupdate --install-rosetta --agree-to-license

Better long-term — native arm64, which is what you want for React Native:
install arm64 Homebrew to `/opt/homebrew`, then `brew install node`, and
make sure `/opt/homebrew/bin` precedes `/usr/local/bin` on `PATH`. Expo
SDK 54 wants Node 20+.

## 2. Apple Developer Program enrollment (the real gate)

Confirmed 2026-08-26: **there is no Apple Developer account yet.** Nothing
iOS-facing can happen until there is — no build, no TestFlight, no
submission. It costs $99/yr and approval takes **24–48 hours**, sometimes
longer if Apple asks for ID.

Start it early even while other work is in flight, because the waiting is
the long pole: https://developer.apple.com/programs/enroll/

Once approved, three values are needed for `eas submit`. The `submit` block
was deliberately REMOVED from eas.json rather than left with placeholder
strings, because an unedited `REPLACE_WITH_…` value fails the submit with a
confusing error. `eas submit` prompts for all three interactively, so
nothing is required up front. To hard-code them later, add back:

    "submit": {
      "production": {
        "ios": {
          "appleId": "<your Apple ID email>",
          "ascAppId": "<App Store Connect → the app → App Information → Apple ID>",
          "appleTeamId": "<developer.apple.com → Membership details → Team ID>"
        }
      }
    }

`ascAppId` only exists after the app record is created in App Store Connect
(Apps → + → New App, bundle ID `com.hanachoi.halmoni`). If that bundle ID
isn't in the dropdown, register it first under Certificates, Identifiers &
Profiles → Identifiers.

## 3. `appVersionSource: "remote"` — deliberate choice

Build numbers are tracked by EAS rather than committed to `app.json`, and
`production` sets `autoIncrement: true`. This means you never hand-edit a
build number and never get a "build number already used" rejection.

Consequence: `app.json`'s `version` ("1.0.0") is still the *marketing*
version and you bump that by hand for each release. The build number
underneath it is EAS's business.

## Sharing with testers WITHOUT an Apple account (EAS Update + Expo Go)

This is the path chosen 2026-08-26: testers install Expo Go and open a link.
No Apple Developer Program, no $99, no TestFlight review. Good for a handful
of friendly testers; awkward for strangers, who must install Expo Go first.

Already in place: logged in to Expo (accounts `hanachoi` + `hanchoister`),
`expo-updates` installed, `updates.url` set, and
`runtimeVersion: {policy: "sdkVersion"}` — that last one is REQUIRED for
Expo Go to load a published update.

### Blocker: the EAS project slug does not match

Every `eas` command currently fails with:

    Slug for project identified by "extra.eas.projectId" (harmony-mobile)
    does not match the "slug" field (halmoni-mobile)

The EAS project was created when the app was still called *harmony* and was
never renamed after the rebrand to *halmoni*. `app.json` says
`halmoni-mobile`; the server still says `harmony-mobile`.

**Fix (30 seconds, in the dashboard):**
https://expo.dev/accounts/hanchoister/projects/harmony-mobile/settings
→ rename the slug to `halmoni-mobile`.

Safe: nothing has been published yet, so no existing build or update URL
breaks. This keeps the existing projectId and `updates.url` untouched, which
is why it beats the alternatives — editing app.json's slug back to
`harmony-mobile` enshrines the wrong name, and `eas init --force` mints a new
project and forces an `updates.url` change too.

### Then publish

    npx eas-cli@latest update --branch preview --message "what changed"

That prints a shareable link. Testers install Expo Go and open it. Re-run for
every new version — no rebuild, no review, no Apple.

## CLI invocation

The package is `eas-cli`; the binary it installs is `eas`. So `npx eas` FAILS
with "could not determine executable to run" — npx looks for a package
literally named `eas`. Use either:

    npx eas-cli@latest <command>      # no install
    npm install -g eas-cli && eas <command>

## First build (needs the Apple account — see §2)

    npx eas-cli@latest build:configure
    npx eas-cli@latest build --profile preview --platform ios
