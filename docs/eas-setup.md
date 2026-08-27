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

## 2. Fill in the three submit placeholders

`eas.json` → `submit.production.ios` has `REPLACE_WITH_…` values:

- `appleId` — the Apple ID email on the developer account
- `ascAppId` — App Store Connect → the app → App Information → "Apple ID"
  (a number). The app record has to be created there first.
- `appleTeamId` — developer.apple.com → Membership

`eas submit` will prompt for anything left blank, so these are a
convenience, not strictly required. But an unedited `REPLACE_WITH_…`
string *will* fail, so either fill them in or delete the block.

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
