// Compute a day-by-day adherence signal for a medication. Groups doses by
// local date; each day is (given / scheduled) in [0, 1]. Future days (after
// "today") are null so the sparkline can skip them.

export interface DoseSummary {
  scheduled_at: string;
  given_at: string | null;
  skipped: boolean;
}

export interface DayAdherence {
  date: string;        // YYYY-MM-DD (local)
  scheduled: number;
  given: number;
  rate: number | null; // null when scheduled === 0
}

function dateKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayKey(now = new Date()): string {
  return dateKey(now.toISOString());
}

export function computeAdherenceWindow(
  doses: DoseSummary[],
  days = 14,
  now: Date = new Date(),
): DayAdherence[] {
  const buckets = new Map<string, { scheduled: number; given: number }>();
  for (const d of doses) {
    const key = dateKey(d.scheduled_at);
    const b = buckets.get(key) ?? { scheduled: 0, given: 0 };
    b.scheduled += 1;
    if (d.given_at && !d.skipped) b.given += 1;
    buckets.set(key, b);
  }
  const out: DayAdherence[] = [];
  const startMs = now.getTime() - (days - 1) * 86_400_000;
  for (let i = 0; i < days; i++) {
    const d = new Date(startMs + i * 86_400_000);
    const key = dateKey(d.toISOString());
    const b = buckets.get(key);
    if (!b) {
      out.push({ date: key, scheduled: 0, given: 0, rate: null });
    } else {
      out.push({
        date: key,
        scheduled: b.scheduled,
        given: b.given,
        rate: b.scheduled === 0 ? null : b.given / b.scheduled,
      });
    }
  }
  return out;
}

export function overallRate(days: DayAdherence[]): number | null {
  const s = days.reduce((acc, d) => acc + d.scheduled, 0);
  if (s === 0) return null;
  const g = days.reduce((acc, d) => acc + d.given, 0);
  return g / s;
}

export { todayKey };
