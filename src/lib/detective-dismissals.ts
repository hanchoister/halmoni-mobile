// A dismissal marks a (symptom, medication) pair as reviewed and not-a-side-effect
// so it stops appearing on Today and Patterns. Stored as a row in the syncable
// `notes` table (kind: 'detective-dismissed') so every sibling sees the same
// dismissals — no schema migration required.

import { list } from '@/lib/db/repository';
import { newId } from '@/lib/newid';
import { writeRow } from '@/lib/sync/write-path';

export const DETECTIVE_DISMISSED_KIND = 'detective-dismissed';

export type DetectiveDismissal = {
  symptomId: string;
  medId: string;
};

function pairKey(symptomId: string, medId: string): string {
  return `${symptomId}:${medId}`;
}

/** Set of `${symptomId}:${medId}` strings for fast membership checks. */
export async function loadDismissedPairs(familyId: string): Promise<Set<string>> {
  const rows = await list('notes', {
    family_id: familyId,
    kind: DETECTIVE_DISMISSED_KIND,
  });
  const out = new Set<string>();
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.body) as DetectiveDismissal;
      if (parsed.symptomId && parsed.medId) {
        out.add(pairKey(parsed.symptomId, parsed.medId));
      }
    } catch {
      // ignore malformed
    }
  }
  return out;
}

export async function dismissFinding(args: {
  familyId: string;
  parentId: string;
  authorMemberId: string | null;
  symptomId: string;
  medId: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await writeRow('notes', {
    id: newId(),
    family_id: args.familyId,
    parent_id: args.parentId,
    author_member_id: args.authorMemberId,
    kind: DETECTIVE_DISMISSED_KIND,
    body: JSON.stringify({ symptomId: args.symptomId, medId: args.medId }),
    created_at: now,
  });
}

export { pairKey };
