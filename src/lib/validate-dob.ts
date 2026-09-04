/**
 * Date-of-birth validation.
 *
 * The old check was `/^\d{4}-\d{2}-\d{2}$/`, which only tests the *shape*.
 * "9999-99-99" passes it. That value was accepted, written to the local mirror,
 * and then rejected by Postgres with `date/time field value out of range`.
 *
 * The consequence was far worse than a bad field. The parent row could never
 * sync, so the medication that referenced it failed its foreign key, and every
 * one of the 180 doses referencing that medication failed in turn — 186
 * quarantined writes from a single unvalidated character. A value that cannot
 * reach the server must not be accepted by the form.
 */

/** Returns an error message, or null when the value is a usable date of birth. */
export function validateDob(input: string): string | null {
  const value = input.trim();
  if (!value) return null; // optional field

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return 'Use the format YYYY-MM-DD, for example 1950-03-14.';

  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);

  if (month < 1 || month > 12) return 'That month does not exist.';
  if (day < 1 || day > 31) return 'That day does not exist.';

  // Round-trip through Date to reject 31 February and similar, and to get leap
  // years right without hand-rolling the rules.
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return 'That date does not exist.';
  }

  const today = new Date();
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (parsed.getTime() > todayUTC) return 'A date of birth cannot be in the future.';

  // The oldest verified human lived to 122. Anything past that is a typo, and
  // Postgres would accept it silently.
  if (year < today.getUTCFullYear() - 130) return 'That date is too far in the past — check the year.';

  return null;
}
