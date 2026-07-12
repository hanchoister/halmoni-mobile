export function isSameDay(a: string | Date, b: string | Date): boolean {
  const da = typeof a === 'string' ? new Date(a) : a;
  const db = typeof b === 'string' ? new Date(b) : b;
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
