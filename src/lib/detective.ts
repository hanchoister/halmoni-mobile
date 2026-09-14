import { daysBetween } from '@/lib/format';
import kb from '@/lib/med-knowledge.json';

// Halmoni deliberately does not judge symptoms. It reports that something was logged
// after a medication started (or that a family member linked the two) and leaves every
// clinical question to the doctor: no side-effect matching, no urgency, no reassurance.
// Reframed 2026-09-13 (plan G1-23). Only `environmentalContexts` is still read from the
// knowledge file — the `common` / `urgent` side-effect lists in it are intentionally unused.

export type DetectiveMed = {
  id: string;
  name: string;
  started_at: string | null;
};

export type DetectiveSymptom = {
  id: string;
  description: string;
  observed_at: string;
  possible_med_links?: string[] | null;
};

export type FindingSymptom = {
  id: string;
  description: string;
  observedAt: string;
  daysAfter: number | null;
  explicitLink: boolean;
  environmentalContext: string | null;
};

export type Finding = {
  medId: string;
  medName: string;
  daysSinceStart: number | null;
  symptoms: FindingSymptom[];
};

const knowledge = kb as unknown as { environmentalContexts: string[] };

const TEMPORAL_WINDOW_DAYS = 14;
const MS_PER_DAY = 86400000;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s'.,;-]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function detectEnvironmentalContext(normalizedText: string): string | null {
  for (const phrase of knowledge.environmentalContexts) {
    if (normalizedText.includes(phrase.toLowerCase())) return phrase;
  }
  return null;
}

export function analyzeSymptoms(
  meds: DetectiveMed[],
  symptoms: DetectiveSymptom[],
  dismissed?: Set<string>,
): Finding[] {
  const byMed = new Map<string, Finding>();

  const startedAtMs = new Map<string, number | null>();
  for (const med of meds) {
    if (!startedAtMs.has(med.id)) {
      startedAtMs.set(med.id, med.started_at ? new Date(med.started_at).getTime() : null);
    }
  }

  for (const symptom of symptoms) {
    const envContext = detectEnvironmentalContext(normalize(symptom.description));
    const explicitLinks = new Set(symptom.possible_med_links ?? []);
    const observedMs = new Date(symptom.observed_at).getTime();

    for (const med of meds) {
      const explicit = explicitLinks.has(med.id);
      let daysAfter: number | null = null;
      const startMs = startedAtMs.get(med.id) ?? null;
      if (startMs != null) {
        const d = Math.round((observedMs - startMs) / MS_PER_DAY);
        if (d >= 0 && d <= TEMPORAL_WINDOW_DAYS) daysAfter = d;
      }
      if (!explicit && daysAfter == null) continue;
      if (dismissed && dismissed.has(`${symptom.id}:${med.id}`)) continue;

      const findingSymptom: FindingSymptom = {
        id: symptom.id,
        description: symptom.description,
        observedAt: symptom.observed_at,
        daysAfter,
        explicitLink: explicit,
        environmentalContext: envContext,
      };

      const existing = byMed.get(med.id);
      if (existing) {
        existing.symptoms.push(findingSymptom);
      } else {
        byMed.set(med.id, {
          medId: med.id,
          medName: med.name,
          daysSinceStart: med.started_at
            ? daysBetween(med.started_at, new Date().toISOString())
            : null,
          symptoms: [findingSymptom],
        });
      }
    }
  }

  // Newest first, with no ordering by how worrying anything sounds.
  for (const f of byMed.values()) {
    f.symptoms.sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime());
  }
  return Array.from(byMed.values());
}
