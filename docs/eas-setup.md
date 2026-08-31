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

The EAS project was created when the app was still called *harmony* and
`app.json` was later updated to `halmoni-mobile` after the rebrand. The
server still says `harmony-mobile`.

**Correction 2026-08-31 — the slug CANNOT be renamed.** An earlier version
of this file said to rename it in the dashboard in 30 seconds. That is
wrong, and there is no such setting to find. Expo's own documentation is
explicit: "A project ID is associated with a single slug, which cannot be
changed." (https://expo.fyi/eas-project-id). There is also no CLI rename —
`eas project:` offers only `delete`, `info`, `init` and `new`.

So there are exactly two real options:

**Option A — match app.json to the server (10 seconds, zero risk).**
Set `"slug": "harmony-mobile"` in app.json. Keeps the existing projectId and
`updates.url`. Cost: the EAS dashboard says "harmony" forever. The slug is
internal — it does not appear to users, and the App Store identity comes
from `ios.bundleIdentifier` (`com.hanachoi.halmoni`), not the slug.

**Option B — create a new EAS project with the right slug (recommended).**
Verified 2026-08-31: the `harmony-mobile` project has **zero builds and
nothing ever published**, so nothing is lost by abandoning it. Because a
projectId/slug pairing is permanent, before the first build is the only
moment this is ever free.

    # 1. clear the old identity from app.json
    #    (remove extra.eas.projectId and the whole updates block)
    # 2. create the new project — writes a fresh projectId into app.json
    npx eas-cli@latest init --account hanchoister
    # 3. re-point updates.url at the new projectId
    npx eas-cli@latest update:configure

Afterwards `npx eas-cli@latest project:info` should read
`@hanchoister/halmoni-mobile`. The old empty project can then be removed
with `npx eas-cli@latest project:delete` (optional; harmless to leave).

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
