// Client-side row ID generator. Rows are written to SQLite before they
// reach Supabase, so we need an ID at insert time instead of relying on
// Postgres `DEFAULT gen_random_uuid()`. Uses expo-crypto's RFC 4122 v4.

import * as Crypto from 'expo-crypto';

export function newId(): string {
  return Crypto.randomUUID();
}
