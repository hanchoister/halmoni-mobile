// Short URL-friendly slugs. base32 (Crockford, no 0/O/1/I) so shares can be
// spoken aloud without confusion. 8 chars = 40 bits of entropy — plenty for
// per-family share-kit ids.

import * as ExpoCrypto from 'expo-crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export async function shortSlug(length = 8): Promise<string> {
  const bytes = await ExpoCrypto.getRandomBytesAsync(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
