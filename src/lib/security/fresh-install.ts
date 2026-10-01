/**
 * Deleting the app signs you out.
 *
 * It did not, and that was a surprise worth fixing. The Supabase session lives
 * in the keychain, and **keychain entries survive app deletion on iOS**. So
 * someone who deleted Halmoni believing they had removed their access would
 * find a reinstall dropping them straight back into a family's medical record,
 * still signed in. Verified on 2026-09-30 by deleting and reinstalling: the app
 * came back signed in and resynced.
 *
 * For an app holding health data about people who never signed up, "I deleted
 * it" has to mean something. This makes it mean the obvious thing.
 *
 * HOW IT KNOWS
 *
 * The keychain survives deletion; the app's container does not. So a marker
 * written to AsyncStorage — which lives in the container — is present on every
 * launch except the first one after an install. Keychain session + no marker =
 * the session outlived a deletion, and should not have.
 *
 * WHAT IT DELIBERATELY DOES NOT CLEAR
 *
 * Notification preferences, which also live in the keychain and are *meant* to
 * survive a reinstall (`G2-58`). The line is identity versus preference: who
 * you are should not outlive the app, what this phone chooses to buzz you about
 * reasonably can. So this removes one named key rather than everything.
 *
 * Offloading an app (Settings → iPhone Storage → Offload App) keeps the
 * container, so the marker survives and you stay signed in. That is correct:
 * offloading is not deleting, and iOS restores it as though nothing happened.
 *
 * ORDERING, WHICH IS THE WHOLE SAFETY ARGUMENT
 *
 * The marker is written BEFORE the session is cleared, which looks backwards
 * and is not. Consider the two failure modes:
 *
 *   - Clear first, then fail to write the marker: every single launch decides
 *     it is a fresh install and signs the user out. They can never stay signed
 *     in. The app is unusable and the cause is invisible.
 *   - Write the marker first, then fail to clear: the user stays signed in
 *     once. That is exactly the bug we started with — no worse — and the next
 *     install gets it right.
 *
 * One of those is a broken app and the other is the status quo, so the marker
 * goes first.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { SecureKeyValueStore } from '@/lib/secure-session-storage';
import { AUTH_STORAGE_KEY } from '@/lib/supabase';

const INSTALL_MARKER_KEY = 'halmoni.install-marker.v1';

/**
 * Clear a session that outlived an app deletion.
 *
 * Returns true if this launch was the first after an install AND a leftover
 * session was removed — i.e. somebody has just been signed out by this.
 *
 * Must be awaited before the first `supabase.auth.getSession()`, or the client
 * will read the stale session before it is gone.
 */
export async function clearSessionIfFreshInstall(): Promise<boolean> {
  let marked: string | null = null;
  try {
    marked = await AsyncStorage.getItem(INSTALL_MARKER_KEY);
  } catch {
    // Cannot tell whether this is a fresh install. Do nothing: signing someone
    // out on a guess is worse than leaving the old behaviour in place.
    return false;
  }

  if (marked) return false; // the container has been here before

  try {
    // Marker first — see the ordering note in the header.
    await AsyncStorage.setItem(INSTALL_MARKER_KEY, new Date().toISOString());
  } catch {
    return false;
  }

  try {
    const leftover = await SecureKeyValueStore.getItem(AUTH_STORAGE_KEY);
    if (!leftover) return false; // genuinely a first install, nothing to clear
    await SecureKeyValueStore.removeItem(AUTH_STORAGE_KEY);
    return true;
  } catch {
    // The keychain is unreadable or unwritable. The user stays signed in,
    // which is the behaviour we already had rather than a new failure.
    return false;
  }
}
