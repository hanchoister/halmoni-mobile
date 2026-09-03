# Halmoni

Care coordination for families looking after a parent together. The product's
claim is **coordination** — several people holding one shared, current picture
of a parent's care — not personal note-taking.

**Halmoni is a mobile app.** Decided 2026-09-01 (`P-01`/`G0-06`): the web app
(`tend`) retires, and `halmoni.app` becomes a landing page. Anything that reads
as "build it twice" is out of scope by definition.

---

## What ships in v1

**The shared record**
- Parent profile: conditions, allergies, ICE contacts, pharmacy, primary doctor,
  insurance, advance-care fields (`dnr_status` and related)
- Medications with schedules, and dose logging
- Appointments and visit notes
- Symptoms
- Family thread

**Coordination**
- Families, invites, and membership
- On-duty / handoff — who is responsible right now, and handing that over
- Presence — who else is in the app
- Local notifications: dose due, dose unlogged +30 min, refill at 7 and 2 days,
  handoff received (`G2-09`)

**Offline and sync**
- Local SQLite mirror; every write queues and drains to Supabase
- 12 synced tables (`SyncableTable` in `src/lib/db/schema.ts`)
- Soft deletes everywhere — rows carry `deleted_at` and are never removed
- Realtime updates, with a 30s poll as the fallback
- Failed writes quarantine after 5 attempts so one bad row cannot freeze a
  device's queue

**Sharing**
- Encrypted share kits — an emergency care summary, client-encrypted, stored in
  the `share-kits` bucket

---

## Deliberately NOT in v1

**Deferred until after launch** — these exist on web today and are a *rebuild*
on mobile, not a port. Each is genuinely wanted; none blocks shipping. Track P
Wave 3.

| | |
|---|---|
| Attachments (`P-06`) | New architecture — the sync engine moves JSON rows, not files |
| Documents (`P-07`) | Built on attachments, so strictly after it |
| Check-ins (`P-08`) | Small and self-contained; table already exists on prod |
| Appointment questions (`P-09`) | Smallest of the group |
| Voice notes (`P-20`) | New build: recording, playback, storage |
| Private journal (`P-21`) | Single-user capture inside a shared-record product |
| ER card (`P-22`) | Not a port — the web version was server-rendered |
| Push notifications (`P-10`) | Distinct from the local notifications above |

**Every one of these adds a new *category* of health data**, which means the
data map, privacy policy and App Store privacy labels all have to be redone
when it ships (`P-23`). That cost is part of the feature, not overhead.

**Cut, not deferred**
- **Symptom/medication pattern matching (`P-14`)** — the highest regulatory
  exposure in the backlog. Inferring a link between a symptom and a drug is the
  kind of claim that turns an organiser into something a regulator reads
  differently.

---

## Development

```bash
npm install
npx expo start
```

`npm run lint` runs ESLint, including `halmoni/no-unfiltered-soft-delete-select`
— a local rule that fails the build on a `supabase.from(...).select()` against a
soft-deleted table that omits `.is('deleted_at', null)`. Deleted rows coming
back as live has shipped three times; the rule exists so it cannot be a fourth.

`metro.config.js` is Expo's default plus `wasm` in `assetExts`, which the
expo-sqlite web worker needs for the `halmoni.app/demo` export.

**Environment** — `.env.local`, pointed at `halmoni-prod`:
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY`, and the three
`EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` values.

Demo mode is dev-only, plus the web demo build
(`EXPO_PUBLIC_START_IN_DEMO=1`). It never reaches a release build — a tester who
logged doses into a demo could conclude the app worked while nothing saved
(`G2-14`).

## Where things are written down

- **`HALMONI — LAUNCH PLAN (LIVING).md`** — the sequence, gated, with stable IDs.
  This README describes scope; that file describes order and status.
- `docs/incident-response.md` — what to do when something breaks in production
- `docs/eas-setup.md`, `docs/app-store-checklist.md`,
  `docs/encryption-declaration.md`, `docs/strategy.md`
