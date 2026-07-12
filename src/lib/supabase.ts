import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { isDemoMode } from '@/lib/demo-mode';
import { demoSupabase } from '@/lib/supabase-demo';

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
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'implicit',
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
