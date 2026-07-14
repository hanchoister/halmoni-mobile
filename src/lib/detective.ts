import { daysBetween } from '@/lib/format';
import kb from '@/lib/med-knowledge.json';

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

export type FindingTier = 'urgent' | 'high' | 'low';

export type FindingSymptom = {
  id: string;
  description: string;
  observedAt: string;
  daysAfter: number | null;
  matchedKeyword: string | null;
  matchedTier: FindingTier;
  explicitLink: boolean;
  environmentalContext: string | null;
};

export type Finding = {
  medId: string;
  medName: string;
  tier: FindingTier;
  daysSinceStart: number | null;
  symptoms: FindingSymptom[];
};

type KbEntry = { aliases: string[]; common: string[]; urgent: string[] };
type KnowledgeBase = {
  medications: Record<string, KbEntry>;
  synonyms: Record<string, string[]>;
  environmentalContexts: string[];
};

const knowledge = kb as unknown as KnowledgeBase;

const TEMPORAL_WINDOW_DAYS = 14;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s'.,;-]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function lookupMed(medName: string): { key: string; entry: KbEntry } | null {
  const n = normalize(medName);
  for (const [key, entry] of Object.entries(knowledge.medications)) {
    if (n === key || n.startsWith(key + ' ') || n.includes(' ' + key)) {
      return { key, entry };
    }
    for (const alias of entry.aliases) {
      const a = normalize(alias);
      if (n === a || n.startsWith(a + ' ') || n.includes(' ' + a)) {
        return { key, entry };
      }
    }
  }
  return null;
}

function expandKeyword(canonical: string): string[] {
  const c = canonical.toLowerCase();
  const syn = knowledge.synonyms[c] ?? [];
  return [c, ...syn.map((s) => s.toLowerCase())];
}

type ExpandedKw = { canonical: string; needles: string[] };

function buildExpanded(keywords: string[]): ExpandedKw[] {
  return keywords.map((kw) => ({ canonical: kw, needles: expandKeyword(kw) }));
}

const NEGATION_CUES = new Set([
  'no',
  'not',
  'none',
  'never',
  'without',
  'denies',
  'denied',
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "didn't",
  "hasn't",
  "haven't",
  "don't",
  "doesn't",
]);
const MULTIWORD_NEGATION_CUES = ['no more', 'no longer', 'not really', 'nothing but'];
const NEGATION_WINDOW_TOKENS = 5;
const CLAUSE_SPLIT_RE = /[.,;]|\bbut\b|\bhowever\b|\band then\b/g;

function splitClauses(text: string): string[] {
  return text.split(CLAUSE_SPLIT_RE).map((c) => c.trim()).filter(Boolean);
}

function isNegatedInClause(clause: string, needle: string): boolean {
  const idx = clause.indexOf(needle);
  if (idx < 0) return false;
  const before = clause.slice(0, idx).trim();
  if (!before) return false;
  for (const cue of MULTIWORD_NEGATION_CUES) {
    if (before.endsWith(cue)) return true;
  }
  const tokens = before.split(/\s+/);
  const window = tokens.slice(-NEGATION_WINDOW_TOKENS);
  for (const tok of window) {
    if (NEGATION_CUES.has(tok)) return true;
  }
  return false;
}

function findKeywordMatch(normalizedText: string, expanded: ExpandedKw[]): string | null {
  const clauses = splitClauses(normalizedText);
  for (const { canonical, needles } of expanded) {
    for (const needle of needles) {
      for (const clause of clauses) {
        if (clause.includes(needle) && !isNegatedInClause(clause, needle)) {
          return canonical;
        }
      }
    }
  }
  return null;
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
): Finding[] {
  const byMed = new Map<string, Finding>();

  const kbByMed = new Map<
    string,
    { key: string; urgent: ExpandedKw[]; common: ExpandedKw[] } | null
  >();
  const startedAtMs = new Map<string, number | null>();
  for (const med of meds) {
    if (!kbByMed.has(med.id)) {
      const hit = lookupMed(med.name);
      kbByMed.set(
        med.id,
        hit
          ? {
              key: hit.key,
              urgent: buildExpanded(hit.entry.urgent),
              common: buildExpanded(hit.entry.common),
            }
          : null,
      );
    }
    if (!startedAtMs.has(med.id)) {
      startedAtMs.set(med.id, med.started_at ? new Date(med.started_at).getTime() : null);
    }
  }
  const MS_PER_DAY = 86400000;

  for (const symptom of symptoms) {
    const normText = normalize(symptom.description);
    const envContext = detectEnvironmentalContext(normText);
    const explicitLinks = new Set(symptom.possible_med_links ?? []);
    const observedMs = new Date(symptom.observed_at).getTime();

    const suspects: { med: DetectiveMed; explicit: boolean; daysAfter: number | null }[] = [];
    for (const med of meds) {
      const explicit = explicitLinks.has(med.id);
      let temporal = false;
      let daysAfter: number | null = null;
      const startMs = startedAtMs.get(med.id) ?? null;
      if (startMs != null) {
        const d = Math.round((observedMs - startMs) / MS_PER_DAY);
        if (d >= 0 && d <= TEMPORAL_WINDOW_DAYS) {
          temporal = true;
          daysAfter = d;
        }
      }
      if (explicit || temporal) {
        suspects.push({ med, explicit, daysAfter });
      }
    }

    for (const { med, explicit, daysAfter } of suspects) {
      const kbHit = kbByMed.get(med.id) ?? null;

      let tier: FindingTier = 'low';
      let matchedKeyword: string | null = null;

      if (kbHit) {
        const urgentMatch = findKeywordMatch(normText, kbHit.urgent);
        if (urgentMatch) {
          tier = 'urgent';
          matchedKeyword = urgentMatch;
        } else {
          const commonMatch = findKeywordMatch(normText, kbHit.common);
          if (commonMatch) {
            tier = 'high';
            matchedKeyword = commonMatch;
          } else if (explicit) {
            tier = 'high';
          } else {
            tier = 'low';
          }
        }
      } else if (explicit) {
        tier = 'high';
      } else {
        tier = 'low';
      }

      if (envContext && tier === 'high') {
        tier = 'low';
      }

      const findingSymptom: FindingSymptom = {
        id: symptom.id,
        description: symptom.description,
        observedAt: symptom.observed_at,
        daysAfter,
        matchedKeyword,
        matchedTier: tier,
        explicitLink: explicit,
        environmentalContext: envContext,
      };

      const existing = byMed.get(med.id);
      const rank: Record<FindingTier, number> = { low: 0, high: 1, urgent: 2 };
      if (existing) {
        existing.symptoms.push(findingSymptom);
        if (rank[tier] > rank[existing.tier]) existing.tier = tier;
        existing.symptoms.sort((a, b) => rank[b.matchedTier] - rank[a.matchedTier]);
      } else {
        const daysSinceStart = med.started_at
          ? daysBetween(med.started_at, new Date().toISOString())
          : null;
        byMed.set(med.id, {
          medId: med.id,
          medName: med.name,
          tier,
          daysSinceStart,
          symptoms: [findingSymptom],
        });
      }
    }
  }

  return Array.from(byMed.values());
}

export function isKnownMed(medName: string): boolean {
  return lookupMed(medName) !== null;
}
