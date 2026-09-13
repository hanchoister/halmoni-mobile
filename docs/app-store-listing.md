# App Store listing — draft

Drafted 2026-09-13. **Nothing here has been entered in App Store Connect** — that waits
on the outside-business-activity approval (plan `G0-09`). Tracked as plan `G2-49`
(copy) and `G2-50` (screenshots).

Re-read every line against the build you actually submit. Guideline 2.3 rejects
metadata that describes features the app doesn't have.

## Character counts

| Field | Used / limit |
|---|---|
| Name | 7 / 30 |
| Subtitle | 29 / 30 |
| Promotional text | 145 / 170 |
| Keywords | 98 / 100 |
| Description | 1987 / 4000 |

## Name
```
Halmoni
```

## Subtitle
```
One place for a parent's care
```

## Promotional text
Editable any time without a new build.
```
Meds, appointments and hand-offs for a parent's care, in one place everyone helping can see — instead of a group chat, a shoebox and your memory.
```

## Keywords
Comma-separated, no spaces. Leaves out every word already in the name and subtitle
(`halmoni`, `one`, `place`, `parent`, `care`) — Apple indexes those fields together,
so repeating them wastes characters.
```
caregiver,medication,pill,tracker,elderly,senior,mom,dad,family,sibling,appointment,dementia,aging
```

## Description
The first sentence is the only part shown before "more", so it carries the whole value.
```
Halmoni puts everything about a parent's care — medications, appointments, hand-offs and what the doctor said — in one place your whole family can see.

Right now the system is a group chat, a shoebox of paperwork, three notes apps and whoever remembers. Halmoni replaces all of it. It works on your own, and it works better when your siblings, partner or anyone else helping can see the same picture.

KNOW WHAT'S BEEN GIVEN
Every medication and every dose in one list. Mark a dose given with one tap, undo it if you were wrong, and everyone sees it straight away — so nobody gives the 8am pills twice.

KNOW WHO'S ON
See at a glance who has your parent right now, and until when.

HAND IT OVER PROPERLY
When someone else takes over, send them a hand-off with the things they actually need to know, instead of a paragraph of context in a text.

APPOINTMENTS WITH A NAME ON THEM
Every visit has someone assigned to take them. Afterwards, note what the doctor said so it isn't lost.

QUESTIONS TO ASK THE DOCTOR
If symptoms get logged after a medication starts, Halmoni lists them together so you remember to raise them at the next appointment. It is a prompt for a conversation with the doctor, not a diagnosis.

A FAMILY THREAD THAT STAYS ON TOPIC
Messages about your parent, tagged with who wrote them, alongside the record they refer to.

THE CARE KIT
One tap makes a PDF of the essentials — allergies, conditions, current medications, emergency contacts, doctor, pharmacy and insurance — to send a sibling, a neighbour or an ER nurse.

BUILT FOR REAL LIFE
Works without a signal and syncs when you're back. Lock the app with Face ID. Your parent doesn't need an account or the app.

PRIVATE BY DEFAULT
Only the people you invite can see your family's information. No ads, and we never sell your data.

Halmoni is a coordination and record-keeping tool. It does not give medical advice, and it does not check whether a medication or dose is correct or safe. In an emergency, call 911.
```

## What this copy deliberately does not say

- **No reminders or notifications.** Not built yet (plan `G2-09`). Add a line only once it ships.
- **No share link or passphrase.** Removed 2026-09-12 (plan `G1-31`); the Care Kit PDF is the only share path.
- **"Questions to ask", never a cause.** Plan `G1-23` keeps symptom grouping only as a prompt for a
  conversation with the doctor. Don't let "may be causing", "side effect detected" or similar creep in.
- **Gender-neutral about the parent.** Same rule as the website.

## Screenshot captions

Six frames, 6.9-inch iPhone (1320 × 2868). Captions are marketing copy, so they stay neutral;
the app screens inside them show the Smith demo family and can say "Mom".

| # | Screen | Caption |
|---|---|---|
| 1 | Today | A group chat, a shoebox, three notes apps — and you. Now one place. |
| 2 | Timeline | Every dose given, and who gave it. |
| 3 | Family | Everyone helping sees the same picture. |
| 4 | Hand off | Going off duty? Hand it over properly. |
| 5 | Visits | Every visit, and what the doctor said. |
| 6 | Profile | Everything a stranger would need to know. |

Each caption describes something visible in its own screen — a caption promising what the
screen doesn't show reads as padding, and edges toward a Guideline 2.3 problem.
The Meds tab is the natural seventh frame if wanted (medications, schedules, refill dates).

**Capture from the native app**, not the web demo — Apple requires screenshots of the app as it
actually runs. Use the Smith demo family in the Simulator; never a real family's data.
`supportsTablet: true` in `app.json` also makes 13-inch iPad screenshots required, unless v1
drops iPad support.
