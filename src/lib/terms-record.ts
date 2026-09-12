/**
 * Writing down that someone accepted the terms — G1-33.
 *
 * Split from terms.ts so that the rules stay pure and CI can compile and test
 * them standalone; this half is the part that talks to Supabase.
 *
 * Not routed through the sync engine on purpose. terms_acceptances is not a
 * family table, it has no place in the local mirror, and the acceptance
 * happens at the one moment the app is definitely online — immediately after
 * an emailed code has been verified.
 */
import { supabase } from '@/lib/supabase';
import { buildTermsAcceptances, needsAcceptance } from '@/lib/terms';
import type { TermsAcceptance } from '@/lib/terms';

/**
 * Record that this user accepted the versions currently shipping.
 *
 * Returns the error rather than throwing, and never blocks sign-in on it. A
 * failure here must not lock someone out of their mother's medication list;
 * the acceptance is re-offered on the next sign-in, because needsAcceptance()
 * reads the rows that did land rather than assuming.
 */
export async function recordTermsAcceptance(
  userId: string,
  now: Date = new Date(),
): Promise<{ error: string | null }> {
  let rows: TermsAcceptance[];
  try {
    rows = buildTermsAcceptances(userId, now);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const { error } = await supabase.from('terms_acceptances').insert(rows);
  return { error: error ? error.message : null };
}

/** Has this user already accepted the versions currently shipping? */
export async function hasAcceptedCurrentTerms(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('terms_acceptances')
    .select('document, version')
    .eq('user_id', userId);
  // On an error, say "not accepted": asking twice is a small annoyance, and
  // assuming agreement we cannot see is the failure that matters.
  if (error || !data) return false;
  return !needsAcceptance(data);
}
