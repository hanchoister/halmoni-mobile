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
 * Leaving demo also has to clear the local mirror, and since 2026-10-04 so does
 * an ordinary sign-out (G2-69). The demo seeds the Smith
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

  // G2-69: a real sign-out now clears the local mirror too.
  //
  // It did not, and only demo mode ever called wipeLocalData — so the complete
  // family health record stayed in the device's SQLite file after someone
  // signed out. "I signed out" is what people do before lending, selling or
  // handing on a phone, and reading that as "my data is not on here any more"
  // is entirely reasonable. It was not true.
  //
  // Deleting the app already cleared it (the container goes), and deleting the
  // account already called wipeLocalData. Sign-out was the gap.
  //
  // ORDER: wipe BEFORE signOut(). The reverse loses the race — signOut()
  // triggers the auth listener, which tears down the SyncProvider and can start
  // a navigation away from this screen, so a wipe queued after it may never run
  // and the user would be signed out with the data still there: the exact bug,
  // reappearing only sometimes, which is the worst version of it.
  //
  // A failed wipe must not strand someone signed in. If the delete throws, the
  // sign-out still happens — same exposure as before this change, rather than a
  // new way to be trapped in the app.
  try {
    await wipeLocalData();
  } catch {
    // Deliberately swallowed; see above. The session still has to end.
  }
  await supabase.auth.signOut();
}
