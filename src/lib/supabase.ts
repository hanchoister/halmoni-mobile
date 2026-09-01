import 'react-native-url-polyfill/auto';

import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { isDemoMode } from '@/lib/demo-mode';
import { SecureSessionStorage } from '@/lib/secure-session-storage';
import { demoSupabase } from '@/lib/supabase-demo';

// The keychain entry holding the session. Exported so the account-deletion
// path can remove it explicitly.
export const AUTH_STORAGE_KEY = 'halmoni-auth';

// Real client is created lazily so demo builds work without env vars set.
let _realClient: SupabaseClient | null = null;
function getRealClient(): SupabaseClient {
  if (_realClient) return _realClient;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing Supabase config. Set EXPO_PUBLIC_SUPABASE_URL and ' +
        'EXPO_PUBLIC_SUPABASE_KEY in .env.local, then restart with `npx expo start --clear`.',
    );
  }
  _realClient = createClient(url, key, {
    auth: {
      // Keychain-backed rather than AsyncStorage: the session is a bearer token
      // for a family's entire health record and should not sit in plain JSON
      // inside the app container.
      storage: SecureSessionStorage,
      // Pinned rather than left to the default sb-<ref>-auth-token, so account
      // deletion can clear the session by name. SecureStore has no "list keys"
      // API, so an unknown key would be unclearable.
      storageKey: AUTH_STORAGE_KEY,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // PKCE binds the code exchange to this device with a one-time verifier,
      // so an intercepted callback is useless on its own. The implicit flow
      // returns the token straight in the redirect with no such binding.
      flowType: 'pkce',
    },
  });
  return _realClient;
}

// Every property access is dispatched to whichever client is active.
// Functions are bound so `this` stays correct on the underlying client.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client: any = isDemoMode() ? demoSupabase : getRealClient();
    const val = client[prop];
    return typeof val === 'function' ? val.bind(client) : val;
  },
}) as SupabaseClient;
