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

## First run

    npx eas login
    npx eas build:configure      # links the project, generates credentials
    npx eas build --profile preview --platform ios

`preview` produces an installable internal build — good for the two-device
sync test on real hardware without going through TestFlight review. Use
`production` + `eas submit` when actually shipping.
