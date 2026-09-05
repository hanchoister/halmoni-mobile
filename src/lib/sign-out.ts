import { wipeLocalData } from '@/lib/account/delete-account';
import { disableDemoMode, isDemoMode } from '@/lib/demo-mode';
import { resetDemoSeedFlag } from '@/lib/demo-seed';
import { supabase } from '@/lib/supabase';
import { resetDemoStore } from '@/lib/supabase-demo';

/**
 * The one way out of the app — and, importantly, the one way out of demo mode.
 *
 * `disableDemoMode()` existed but had no callers anywhere, so demo mode was a
 * trap: once in, every call went through the demo client, "Sign out" only told
 * listeners the fake session had ended, and "Signed in as" rendered blank
 * because there was no real user. Creating a family then refused with "The demo
 * is a fixed sample family", which reads as the app being broken rather than as
 * demo mode still being on. The only escape was reloading the bundle.
 *
 * Leaving demo also has to clear the local mirror. The demo seeds the Smith
 * family into the same SQLite tables a real account syncs into, so without a
 * wipe the next real sign-in pulls its own data on top of fixture rows.
 */
export async function signOutEverywhere(): Promise<void> {
  if (isDemoMode()) {
    await wipeLocalData();
    resetDemoStore();
    resetDemoSeedFlag();
    disableDemoMode();
    return;
  }
  await supabase.auth.signOut();
}
