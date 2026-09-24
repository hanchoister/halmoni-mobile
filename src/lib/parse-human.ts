/**
 * Read a date or a time the way a person actually types it (G2-29).
 *
 * Three fields in this app were strict free text: a parent's date of birth and
 * a refill date both demanded `YYYY-MM-DD`, and a medication time demanded
 * 24-hour `HH:MM`. So a caregiver in the United States — the only country this
 * app is for — had to type `20:30` to mean half past eight in the evening, and
 * `1950-03-14` for a birthday they have written as `3/14/1950` their whole
 * life. The regex rejected everything else with "Bad time".
 *
 * This is not cosmetic. `G1-25` is the entry for a single bad date of birth
 * quarantining 186 writes: the strictness did not prevent bad data, it just
 * moved the failure somewhere less visible. Accepting what people type and
 * normalising it is the fix; the validator still runs afterwards.
 *
 * Deliberately NOT a date-picker. A picker means a native dependency, a
 * prebuild, and a UI nobody here can see until it is on a device — and it is
 * the wrong control for a birthday in 1950, where scrolling back seventy-six
 * years is worse than typing eight characters. Pickers may still be right for
 * the refill date later; this module is what makes the text field honest now.
 *
 * Pure: no React, no expo, no database, so `npm run verify:logic` exercises it
 * in CI.
 */

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function monthFromName(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return null;
  const i = MONTHS.findIndex((m) => m.startsWith(w));
  return i === -1 ? null : i + 1;
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * A date, as `YYYY-MM-DD`, or null if it cannot be read confidently.
 *
 * Accepts `1950-03-14`, `3/14/1950`, `03-14-1950`, `March 14, 1950`,
 * `14 March 1950`, `Mar 14 1950`.
 *
 * Two things it refuses on purpose:
 *
 *   - **Two-digit years.** `3/14/50` is 1950 to one reader and 2050 to
 *     another, and for a date of birth the difference is a century. Guessing
 *     is worse than asking.
 *   - **Ambiguous day/month.** `3/14` with no year cannot be placed.
 *
 * `4/5/1950` is read as US month-first, because this app ships only in the
 * United States. When the first number cannot be a month (`14/3/1950`) the
 * other order is used instead, which makes the common mistake harmless rather
 * than silently wrong by ten months.
 */
export function parseHumanDate(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;

  // ISO first: unambiguous and already the storage format.
  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
  if (isoMatch) {
    const [, y, m, d] = isoMatch.map(Number) as unknown as number[];
    return isRealDate(y, m, d) ? iso(y, m, d) : null;
  }

  // Numeric, month first, four-digit year required.
  const slash = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(raw);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = Number(slash[3]);
    // US order unless the first number cannot be a month.
    const [m, d] = a > 12 ? [b, a] : [a, b];
    return isRealDate(y, m, d) ? iso(y, m, d) : null;
  }

  // Month names, either order.
  const words = raw.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 3) {
    const named = words.map(monthFromName);
    const at = named.findIndex((m) => m !== null);
    if (at !== -1) {
      const month = named[at] as number;
      const rest = words.filter((_, i) => i !== at).map(Number);
      if (rest.every((n) => Number.isInteger(n))) {
        // The four-digit-looking one is the year.
        const [d, y] = rest[0] > 31 ? [rest[1], rest[0]] : [rest[0], rest[1]];
        if (y >= 1000 && isRealDate(y, month, d)) return iso(y, month, d);
      }
    }
  }

  return null;
}

/**
 * A time of day, as 24-hour `HH:MM`, or null if it cannot be read.
 *
 * Accepts `08:00`, `8:00`, `20:30`, `8am`, `8 AM`, `8:30pm`, `8.30 pm`,
 * `0800`, `830`, `noon`, `midnight`. The separator is optional, so the military
 * form falls out of the same pattern rather than needing its own.
 *
 * A bare number with no am/pm is read on the 24-hour clock, because that is
 * what this field has always meant and because `20` has no other reading. So
 * `8` is 08:00 and someone who means the evening writes `8pm` — which is the
 * whole point of the change.
 */
export function parseHumanTime(input: string): string | null {
  const raw = (input ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'noon' || raw === 'midday') return '12:00';
  if (raw === 'midnight') return '00:00';

  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm|a|p)?$/.exec(raw);
  if (!m) return null;

  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const suffix = m[3];

  if (minute > 59) return null;

  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    const pm = suffix.startsWith('p');
    if (pm) hour = hour === 12 ? 12 : hour + 12;
    else hour = hour === 12 ? 0 : hour;
  } else if (hour > 23) {
    return null;
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
