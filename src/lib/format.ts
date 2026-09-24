export function isSameDay(a: string | Date, b: string | Date): boolean {
  const da = typeof a === 'string' ? new Date(a) : a;
  const db = typeof b === 'string' ? new Date(b) : b;
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function formatTime(iso: string, tz?: string | null): string {
  const d = new Date(iso);
  if (tz) {
    try {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz });
    } catch {
      // An unresolvable zone must not blank out a dose time. Fall through.
    }
  }
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "America/New_York" → "New York". Good enough to disambiguate, short enough to fit. */
export function zoneLabel(tz: string): string {
  const last = tz.split('/').pop() ?? tz;
  return last.replace(/_/g, ' ');
}

/**
 * A dose time, in the zone the schedule was written in, and said out loud when
 * that is not the reader's own zone (G2-27).
 *
 * The naming matters more than the formatting here. A sibling in California
 * looking at a parent's New York medication needs to read "8:00 AM" — the time
 * the pill is actually taken, the time the parent will say on the phone — and
 * needs to know it is not 8am where she is. Showing her "5:00 AM" was the bug;
 * showing her "8:00 AM" with no hint would be a subtler one.
 */
export function formatDoseTime(iso: string, tz?: string | null): string {
  const time = formatTime(iso, tz);
  if (!tz) return time;
  let here: string | undefined;
  try {
    here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    here = undefined;
  }
  return here && here !== tz ? `${time} (${zoneLabel(tz)})` : time;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - then;
  const future = diff < 0;
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60000);
  if (min < 1) return future ? 'soon' : 'just now';
  if (min < 60) return future ? `in ${min}m` : `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return future ? `in ${hr}h` : `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return future ? `in ${day}d` : `${day}d ago`;
  return formatDateShort(iso);
}

export function calcAge(dobIso: string | null | undefined): number | null {
  if (!dobIso) return null;
  const dob = new Date(dobIso);
  if (isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

export function initialOf(name: string | null | undefined): string {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase();
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.round((db - da) / (1000 * 60 * 60 * 24));
}
