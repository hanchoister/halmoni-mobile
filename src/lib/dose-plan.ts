/**
 * The dose horizon — how far into the future the app knows a pill is due.
 *
 * Adding a medication wrote exactly 90 days of doses, in one go, and nothing
 * anywhere ever wrote another one. There are no scheduled jobs and no edge
 * functions on the project. So on day 91 a chronic medication silently
 * disappeared from the Today screen and every reminder for it stopped, with no
 * warning to anyone — in an app whose entire promise is "dose due" (G2-23).
 * And because the rows were built once at creation, changing a dose time did
 * nothing to the doses already written; the edit screen told the user to delete
 * the medication and re-add it, which throws away the adherence history that is
 * supposed to be the compounding asset (G2-25).
 *
 * Both are the same missing idea: the dose rows are a projection of the
 * schedule, and a projection has to be recomputed, not minted once.
 *
 * This module is pure — no React, no expo, no database. It is compiled on its
 * own and exercised by `npm run verify:logic` in CI.
 *
 * Two entry points, deliberately not one:
 *
 *   planTopUp      extends the horizon and NEVER removes anything. Runs
 *                  unattended, after sync, on any sibling's phone.
 *   planReschedule recomputes the window and removes future doses that no
 *                  longer match. Runs only when a person on this device just
 *                  edited the schedule.
 *
 * The split exists because dose times used to be wall-clock times materialised
 * into UTC using the local timezone of whichever device wrote them. A sibling
 * in California opening the app must not quietly rewrite doses their sister in
 * New York created — so the unattended path is additive only.
 *
 * That underlying bug is now fixed (G2-27, 2026-09-24). A schedule carries the
 * zone its times are written in, and every device materialises them in that
 * zone. Two consequences worth naming, because the first was the visible
 * symptom and the second was the quieter, worse one:
 *
 *   - An 08:00 dose entered in New York reads as 08:00 to a sibling in
 *     California, instead of 05:00.
 *   - Every device now derives the same instants, so it derives the same dose
 *     ids. Before, a device in another zone did not collide with the existing
 *     rows — it added a second, parallel set of doses for the same medication,
 *     and the additive-only rule above made that permanent rather than
 *     preventing it.
 *
 * Schedules saved before the fix carry no zone and keep the old reader-local
 * behaviour. Rewriting them would move doses a parent has been taking for
 * weeks, and this module cannot honestly guess which zone was meant.
 */

export const DOSE_HORIZON_DAYS = 90;

/** Below this many days of runway, a top-up is worth doing. */
export const TOP_UP_THRESHOLD_DAYS = 60;

export type Slot = {
  time: string;
  withFood?: boolean;
  /**
   * The IANA zone the wall-clock `time` is written in — "America/New_York".
   *
   * Stamped from the device that created or last edited the schedule, and then
   * honoured by every other device. Without it, `time` means "08:00 wherever
   * the reader happens to be", which is how G2-27 happened.
   *
   * It lives on the slot rather than on the medication because `medications`
   * has no timezone column and `schedule` is a TEXT column holding this array,
   * so a new optional key needs no migration and no DDL on production, while a
   * new column would need both. One zone per medication is the intent — the
   * writers stamp the same value on every slot and `scheduleZone` reads the
   * first one it finds. Normalising it onto the medication (or better, onto the
   * parent, whose timezone it really is) is worth doing the next time there is
   * a migration to spend; it is not worth a migration of its own.
   */
  tz?: string;
};

/**
 * The zone a medication's times are written in, or null for a schedule saved
 * before `G2-27` — those fall back to the reader's own zone, which is the old
 * behaviour and the best that can be done without knowing what was meant.
 */
export function scheduleZone(schedule: Slot[] | null | undefined): string | null {
  for (const slot of schedule ?? []) if (slot?.tz) return slot.tz;
  return null;
}

/**
 * The zone this device is in, or null when the runtime cannot say.
 *
 * Stamped onto a schedule when it is created or edited. Null means the schedule
 * stays on the legacy reader-local path rather than being given a zone that
 * might be wrong — a wrong zone is worse than no zone, because it would be
 * honoured by every other device.
 */
export function deviceZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && zoneSupported(tz) ? tz : null;
  } catch {
    return null;
  }
}

/** Whether this runtime can actually resolve a zone. Hermes is not a given. */
export function zoneSupported(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

type Civil = { y: number; m: number; d: number; hh: number; mm: number; ss: number };

/** What the clock on the wall in `tz` reads at the instant `ts`. */
function civilPartsIn(ts: number, tz: string): Civil {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ts))) p[part.type] = part.value;
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    // en-US with hour12:false renders midnight as "24" in some ICU versions.
    hh: Number(p.hour) % 24,
    mm: Number(p.minute),
    ss: Number(p.second),
  };
}

/** How far `tz` is from UTC, in minutes, at the instant `ts`. */
export function zoneOffsetMinutes(ts: number, tz: string): number {
  const c = civilPartsIn(ts, tz);
  return Math.round((Date.UTC(c.y, c.m - 1, c.d, c.hh, c.mm, c.ss) - ts) / 60_000);
}

/**
 * The instant at which the wall clock in `tz` reads the given date and time.
 *
 * Two passes, not one. The first guess uses the offset in force at the *naive*
 * timestamp, which is the wrong side of a daylight-saving boundary for a few
 * hours a year; re-reading the offset at the corrected instant settles it.
 *
 * A wall-clock time that does not exist — 02:30 on a spring-forward morning —
 * resolves forward, to the same instant as 03:30. That is the conventional
 * answer and the safe one for a medication: the dose lands once, an hour later,
 * rather than vanishing from the day.
 *
 * Getting that last part right needs the check at the end. Inside the gap the
 * two passes do not converge, they oscillate between the instant an hour ahead
 * of the request and the instant half an hour behind it — and the second pass
 * happens to land on the one BEHIND, which would move a 02:30 dose to 01:30 and
 * silently give the parent their pill an hour early. So the result is read back
 * and, when it does not say what was asked for, the later candidate wins.
 *
 * An ambiguous time — 01:30 on a fall-back morning, which happens twice —
 * resolves to the first occurrence, which is what the two passes already agree
 * on. Both conventions match how every other calendar behaves.
 */
export function zonedWallClockToUtc(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  tz: string,
): number {
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const first = naive - zoneOffsetMinutes(naive, tz) * 60_000;
  const second = naive - zoneOffsetMinutes(first, tz) * 60_000;

  const reads = civilPartsIn(second, tz);
  const asked = reads.y === y && reads.m === m && reads.d === d && reads.hh === hh && reads.mm === mm;
  return asked ? second : Math.max(first, second);
}

export type ExistingDose = {
  id: string;
  scheduled_at: string;
  given_at?: string | null;
  skipped?: boolean | number | null;
  deleted_at?: string | null;
};

export type PlannedDose = { id: string; scheduled_at: string };

export type Plan = { create: PlannedDose[]; remove: string[] };

// ---------------------------------------------------------------------------
// Deterministic dose ids.
// ---------------------------------------------------------------------------
// Two phones can decide to extend the same medication's horizon before either
// has pulled the other's rows. With random ids that race writes the same 8am
// dose twice and the parent's Today screen shows the pill twice. A dose is
// identified by what it IS — this medication, this instant — so the id is
// derived from exactly that, and the two writes collide into one row instead.
//
// RFC 4122 v5 (SHA-1, namespaced). The namespace is a constant for this app.
const DOSE_NAMESPACE = '6b2f4b2e-9a1e-5c7a-9a3e-2f1c7d4b8e10';

function sha1(bytes: number[]): number[] {
  const ml = bytes.length * 8;
  const msg = bytes.slice();
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  // 64-bit big-endian length; messages here are far below 2^32 bits.
  for (let i = 0; i < 4; i++) msg.push(0);
  msg.push((ml >>> 24) & 0xff, (ml >>> 16) & 0xff, (ml >>> 8) & 0xff, ml & 0xff);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Array<number>(80);

  for (let i = 0; i < msg.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] =
        (msg[i + j * 4] << 24) |
        (msg[i + j * 4 + 1] << 16) |
        (msg[i + j * 4 + 2] << 8) |
        msg[i + j * 4 + 3];
    }
    for (let j = 16; j < 80; j++) {
      const n = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16];
      w[j] = (n << 1) | (n >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      let f: number, k: number;
      if (j < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (j < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) | 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }

  const out: number[] = [];
  for (const h of [h0, h1, h2, h3, h4]) {
    out.push((h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff);
  }
  return out;
}

function uuidToBytes(uuid: string): number[] {
  const hex = uuid.replace(/-/g, '');
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    let cp = ch.codePointAt(0) as number;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return out;
}

/** RFC 4122 v5 UUID. Exported so CI can check it against a known vector. */
export function uuidv5(name: string, namespace: string): string {
  const hash = sha1([...uuidToBytes(namespace), ...utf8Bytes(name)]);
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = hash.slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** The id a given dose of a given medication always has, on every device. */
export function doseId(medicationId: string, scheduledAtIso: string): string {
  return uuidv5(`${medicationId}|${scheduledAtIso}`, DOSE_NAMESPACE);
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * Every instant the schedule calls for, from `from` (a local calendar day) for
 * `days` days.
 *
 * Built one calendar day at a time and then given the slot's wall-clock time,
 * rather than by adding 24 hours repeatedly. Across a daylight-saving boundary
 * the second approach walks an 8:00 dose to 7:00 or 9:00 and leaves it there.
 */
function scheduledInstants(from: Date, days: number, schedule: Slot[]): string[] {
  const zone = scheduleZone(schedule);

  // The zoned path. Days are counted on the calendar in the medication's own
  // zone, so every device — wherever it is — derives the same instants and
  // therefore the same dose ids. That matters twice over: it is why a sibling
  // in California now sees a New York 08:00 dose at 08:00, and it is why she no
  // longer mints a second, parallel set of dose rows for the same medication
  // (the ids come from the instant, so a different instant is a different row).
  if (zone && zoneSupported(zone)) {
    const out: string[] = [];
    const start = civilPartsIn(from.getTime(), zone);
    for (let offset = 0; offset < days; offset++) {
      // A UTC proxy is only a way to do calendar arithmetic on y/m/d; it never
      // becomes the answer. Month ends and leap years come free.
      const proxy = new Date(Date.UTC(start.y, start.m - 1, start.d));
      proxy.setUTCDate(proxy.getUTCDate() + offset);
      for (const slot of schedule) {
        const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(slot.time ?? '');
        if (!m) continue; // a malformed time is skipped, never turned into a dose
        const ts = zonedWallClockToUtc(
          proxy.getUTCFullYear(),
          proxy.getUTCMonth() + 1,
          proxy.getUTCDate(),
          parseInt(m[1], 10),
          parseInt(m[2], 10),
          zone,
        );
        out.push(new Date(ts).toISOString());
      }
    }
    return out;
  }

  // The legacy path, for schedules saved before G2-27 stamped a zone, and for
  // any runtime whose Intl cannot resolve zones. Wall-clock times are read in
  // the reader's own zone. Kept deliberately: rewriting an old schedule's
  // instants would move doses a parent has been taking for weeks, and guessing
  // which zone was meant is not something this function can do honestly.
  const out: string[] = [];
  const day0 = new Date(from);
  day0.setHours(0, 0, 0, 0);
  for (let offset = 0; offset < days; offset++) {
    const day = new Date(day0);
    day.setDate(day0.getDate() + offset);
    for (const slot of schedule) {
      const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(slot.time ?? '');
      if (!m) continue;
      const at = new Date(day);
      at.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
      out.push(at.toISOString());
    }
  }
  return out;
}

function liveDoses(existing: ExistingDose[]): ExistingDose[] {
  return existing.filter((d) => !d.deleted_at);
}

function isUntouched(d: ExistingDose): boolean {
  return !d.given_at && !d.skipped;
}

/** How many days of runway a medication has left. 0 means it has run out. */
export function daysOfRunway(existing: ExistingDose[], now: Date): number {
  const future = liveDoses(existing)
    .map((d) => Date.parse(d.scheduled_at))
    .filter((t) => !Number.isNaN(t) && t > now.getTime());
  if (future.length === 0) return 0;
  return Math.floor((Math.max(...future) - now.getTime()) / 86_400_000);
}

/**
 * Extend the horizon. Additive only: it creates the doses the schedule calls
 * for that do not already exist, and removes nothing.
 */
export function planTopUp(input: {
  medicationId: string;
  schedule: Slot[];
  existing: ExistingDose[];
  now: Date;
  horizonDays?: number;
}): Plan {
  const { medicationId, schedule, existing, now } = input;
  const horizon = input.horizonDays ?? DOSE_HORIZON_DAYS;
  if (!schedule || schedule.length === 0) return { create: [], remove: [] };

  // Every instant already spoken for. The caller passes the rows it considers
  // current — the maintenance path passes live rows and writes new ones with
  // deleted_at cleared, so a time that leaves the schedule and later comes back
  // is genuinely restored rather than shadowed for ever by its own tombstone.
  const taken = new Set(existing.map((d) => d.scheduled_at));

  const create: PlannedDose[] = [];
  for (const at of scheduledInstants(now, horizon, schedule)) {
    if (Date.parse(at) <= now.getTime()) continue; // never invent a missed dose
    if (taken.has(at)) continue;
    create.push({ id: doseId(medicationId, at), scheduled_at: at });
  }
  return { create, remove: [] };
}

/**
 * Recompute the window after someone changed the schedule on this device.
 *
 * Removes only future doses that nobody has acted on. A dose already marked
 * given or skipped is adherence history and is never touched — that history is
 * the thing "delete the medication and re-add it" used to destroy.
 */
export function planReschedule(input: {
  medicationId: string;
  schedule: Slot[];
  existing: ExistingDose[];
  now: Date;
  horizonDays?: number;
}): Plan {
  const { medicationId, schedule, existing, now } = input;
  const horizon = input.horizonDays ?? DOSE_HORIZON_DAYS;

  const wanted = new Set(
    scheduledInstants(now, horizon, schedule ?? []).filter(
      (at) => Date.parse(at) > now.getTime(),
    ),
  );

  const live = liveDoses(existing);
  const kept = new Set(live.map((d) => d.scheduled_at));

  const remove = live
    .filter((d) => {
      const t = Date.parse(d.scheduled_at);
      if (Number.isNaN(t) || t <= now.getTime()) return false; // the past is history
      if (!isUntouched(d)) return false; // given or skipped: history too
      return !wanted.has(d.scheduled_at);
    })
    .map((d) => d.id);

  const create: PlannedDose[] = [];
  for (const at of wanted) {
    if (kept.has(at)) continue;
    create.push({ id: doseId(medicationId, at), scheduled_at: at });
  }
  // Stable order makes the writes, and the tests, predictable.
  create.sort((a, b) => (a.scheduled_at < b.scheduled_at ? -1 : 1));
  return { create, remove };
}
