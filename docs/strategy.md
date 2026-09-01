# Halmoni product strategy

Last updated: 2026-07-13
Status: living document — update as validated assumptions change

## The aha moment

**"I passed the baton without a phone call."**

One sibling captures a doctor visit / med change / incident once. Everyone else _just knows_ — without a group-text novel, without a follow-up call, without wondering.

Everything upstream (individual tracking of meds/appointments) can already be done in Apple Notes. The value Halmoni delivers is **coordination without cognitive load**.

Runner-up aha moment: **one-tap PDF at ER intake** — 30 seconds instead of 20 minutes recreating a med list from memory at 2am.

## Hook Model

| Layer | Halmoni |
| --- | --- |
| External trigger | Med-window notification, sibling activity ping, appointment reminder |
| Internal trigger | Anxiety, guilt, curiosity (about parent, about what sibling did) |
| Action | Open app → Today tab, single glance |
| Variable reward | New sibling activity you didn't know about |
| Investment | Logging visits/meds/profile — makes app more valuable to future-you AND to siblings |

### Streaks are a trap in this domain

Missing a day of logging often means (a) parent stable [good] or (b) crisis. Both make streak-shaming actively harmful.

Use **presence signals** ("Sarah active 2h ago"), NOT gamified streaks / badges / leaderboards.

## Competitive landscape

- **CaringBridge** — broadcast journal, not operational
- **CareZone** — was the leader in family med tracking; sunset 2021 by Walmart. Literal void in the market
- **Life360** — nailed "peace of mind at a glance" for family location. Steal the emotional promise, apply to health
- **Real threat** — group-text inertia, not other apps. Every new user is a family that _almost_ just kept using WhatsApp/iMessage

## The one word-of-mouth bet

**Shareable Visit Summary.**

Caregiving is socially awkward — testimonial-driven virality won't work. Viral moments must be **operational, not testimonial**.

The visit summary text hits a sibling's phone at the moment of maximum receptivity — right after they've asked "what did the doctor say?" The artifact answers their question _and_ surfaces the app. This is the WhatsApp-forwarded-Otter-transcript pattern.

Math: ~12 viral moments per family per year × N families = compounding.

## Riskiest assumption

**Adult-child siblings will actually invite each other.**

The whole thesis dies if the invited sibling never engages. Validate by tracking:

1. % of first users who invite a sibling within 7 days
2. % of invited siblings who accept within 7 days
3. % of two-sibling families still active at day 30

Below ~40% acceptance rate → rethink before spending on App Store launch.

## Prioritized backlog

Scored 1-10 on impact × effort.

### Tier 1 — MVP core, close the aha loop

| # | Feature | Score | Status |
| --- | --- | --- | --- |
| 1 | Real push notifications (needs $99 Apple dev build) — gates all retention loops | 10 | Pending |
| 2 | Working sibling invite (email deep link → onboarding pre-scoped to parent) | 10 | ✅ Share sheet done; deep link pending push |
| 3 | Visit Summary auto-fill from Prep + In-visit tabs | 9 | ✅ Done |
| 4 | One-tap ER PDF of profile (meds, allergies, conditions, ICE) | 9 | ✅ Done (Care Kit PDF) |
| 5 | Handoff acknowledgment ("Got it" tap required) | 8 | ✅ Done |

### Tier 2 — Retention & habit loops

| # | Feature | Score |
| --- | --- | --- |
| 2.1 | Family activity digest push (evening) | 9 |
| 2.2 | Sibling presence indicator ("Sarah active 2h ago") | 8 |
| 2.3 | Auto-detected concerning patterns (side-effect detective) | 9 — ✅ Done |
| 2.4 | On-duty auto-rotation with schedule | 8 |
| 2.5 | Voice-note logging with Whisper transcript | 8 |
| 2.6 | Weekly Care Recap email | 7 |

**Cut from Tier 2**: streaks, badges, leaderboards, social feed of other families, gamified progress bars.

### Tier 3 — Virality

| # | Feature | Score |
| --- | --- | --- |
| 3.1 | Shareable visit summary (SMS + PDF, footer = app CTA) — THE viral bet | 10 — ✅ Done |
| 3.2 | Add sibling in <60s (share code / QR / iMessage) | 9 — ✅ Done |
| 3.3 | Care Kit PDF (shareable multi-page for hospice/urgent care/new dr) | 9 — ✅ Done |
| 3.4 | Caregiver-forum-native content ("Copy summary for r/AgingParents") | 7 |
| 3.5 | Referral incentive (1 free year premium per sibling brought) | 5 — defer until paid tier |

**Cut from Tier 3**: public profiles, social auto-share, in-app video calls, professional-caregiver marketplace.

## Validated build order

As of 2026-07-13:

1. ✅ Fix invite flow (Tier 1 #2)
2. ✅ Shareable visit summary (Tier 3 #1) — the viral bet
3. ✅ Care Kit PDF (Tier 3 #3 / Tier 1 #4)
4. ✅ Side-effect detective (Tier 2 #3)
5. **Next**: Push notifications (Tier 1 #1) — requires $99 Apple dev build; gates everything below
6. Family activity digest (2.1) + presence indicator (2.2) — needs push
7. Voice-note logging (2.5) — Whisper via Edge Function

## Decision filter

Before adding any new Halmoni feature, ask:

- Does it advance the aha moment? ("passed the baton without a phone call")
- Does it support the viral bet? (3.1 — Shareable visit summary)

If **neither**, cut it.
