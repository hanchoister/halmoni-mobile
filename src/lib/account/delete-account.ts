// In-app account deletion (App Store Guideline 5.1.1(v)).
//
// Deleting an account has to clear BOTH sides or it isn't a deletion:
//
//   1. The server, via the delete_my_account() RPC. That decides whether the
//      family is destroyed (this user was its last live member) or merely
//      loses one member, then removes the auth user.
//   2. The device. Halmoni keeps a full local SQLite mirror of the family's
//      health data, so a server-only delete would leave every medication and
//      dose sitting in plaintext on the phone. The mirror is deleted here.
//
// The server call goes first on purpose: if it fails we still have a working
// signed-in app to show an error from, and nothing has been destroyed locally.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';

import { supabase } from '@/lib/supabase';

const DB_NAME = 'halmoni.db';

export interface DeleteAccountReceipt {
  families_deleted: number;
  memberships_removed: number;
}

/**
 * Removes every trace of the account from this device: the SQLite mirror
 * (health data + the pending_writes queue) and the app's AsyncStorage keys.
 *
 * Exported separately so it can be reused if we ever need a "reset this
 * device" affordance in support.
 */
export async function wipeLocalData(): Promise<void> {
  // The DB may hold an open handle from the sync engine; closing is
  // best-effort because deleteDatabaseAsync is what actually matters.
  try {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    await db.closeAsync();
  } catch {
    // Already closed, or never opened on this launch. Fine either way.
  }
  try {
    await SQLite.deleteDatabaseAsync(DB_NAME);
  } catch {
    // If the file is already gone we have nothing to do.
  }

  // Drop our own keys plus the cached Supabase session. Scoped by prefix
  // rather than AsyncStorage.clear() so we never touch anything we did not
  // write ourselves.
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter(
      (k) => k.startsWith('halmoni') || k.startsWith('sb-'),
    );
    if (ours.length) await AsyncStorage.multiRemove(ours);
  } catch {
    // Non-fatal: signOut below still clears the session.
  }
}

/**
 * Deletes the signed-in user's account, then wipes the device and signs out.
 * Throws if the server refuses, leaving local data untouched.
 */
export async function deleteAccount(): Promise<DeleteAccountReceipt> {
  const { data, error } = await supabase.rpc('delete_my_account');
  if (error) throw new Error(error.message);

  await wipeLocalData();

  // The user row is gone, so the access token is already dead server-side.
  // Sign out locally to clear in-memory state and return to the auth screen.
  await supabase.auth.signOut().catch(() => {});

  const receipt = (data ?? {}) as Partial<DeleteAccountReceipt>;
  return {
    families_deleted: receipt.families_deleted ?? 0,
    memberships_removed: receipt.memberships_removed ?? 0,
  };
}
