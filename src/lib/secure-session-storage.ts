// Session storage backed by the device keychain rather than AsyncStorage.
//
// AsyncStorage is unencrypted: on iOS it is a plist inside the app container,
// which is protected by the device passcode but is plain JSON to anything that
// can read the container (a backup, a jailbroken device, a forensic tool). The
// Supabase session is a bearer token for a family's entire health record, so it
// belongs in the keychain, which is hardware-backed and never leaves the device.
//
// The catch: SecureStore rejects values over 2048 bytes, and a Supabase session
// with a JWT and a refresh token routinely exceeds that. So values are split
// into numbered chunks and reassembled on read. A small index entry records how
// many chunks a key currently has, which is also what lets removal clean up
// every chunk rather than orphaning the tail of a previously longer value.

import * as SecureStore from 'expo-secure-store';

// Comfortably under the 2048-byte limit, leaving room for multi-byte UTF-8.
const CHUNK_SIZE = 1536;

// SecureStore keys allow only alphanumerics, ".", "-" and "_".
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9.\-_]/g, '_');
}

const countKey = (k: string) => `${safeKey(k)}.n`;
const chunkKey = (k: string, i: number) => `${safeKey(k)}.${i}`;

async function readCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(countKey(key));
  const n = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export const SecureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const count = await readCount(key);
      if (count === 0) return null;
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await SecureStore.getItemAsync(chunkKey(key, i));
        // A missing chunk means the value is torn; treat it as absent rather
        // than handing back a truncated token that would fail confusingly.
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join('');
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    const previous = await readCount(key);

    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }

    for (let i = 0; i < chunks.length; i++) {
      await SecureStore.setItemAsync(chunkKey(key, i), chunks[i]);
    }
    await SecureStore.setItemAsync(countKey(key), String(chunks.length));

    // If this value is shorter than the last one, delete the leftover tail so a
    // stale chunk can never be spliced onto a future read.
    for (let i = chunks.length; i < previous; i++) {
      await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
  },

  async removeItem(key: string): Promise<void> {
    const count = await readCount(key);
    for (let i = 0; i < count; i++) {
      await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
    await SecureStore.deleteItemAsync(countKey(key));
  },
};
