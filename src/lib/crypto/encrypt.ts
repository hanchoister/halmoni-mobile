// Zero-knowledge encryption: AES-GCM-256 with PBKDF2-SHA256 key derivation.
// Server never sees plaintext or passphrase — only ciphertext + salt + iv.
//
// Compat: mirror this same construction in the web decrypt page
// (halmoni-landing/view) using WebCrypto so ciphertexts are cross-decryptable.

import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import * as ExpoCrypto from 'expo-crypto';

export const KDF_ITERATIONS = 210_000;   // OWASP 2023 recommendation for PBKDF2-SHA256
const SALT_BYTES = 16;
const IV_BYTES = 12;                     // AES-GCM standard
const KEY_BYTES = 32;                    // AES-256

const utf8 = new TextEncoder();
const utf8Decode = new TextDecoder();

export interface EncryptedPayload {
  ciphertextB64: string;
  saltB64: string;
  ivB64: string;
  kdfIterations: number;
}

/** Encrypt a JSON-serializable value with a passphrase. */
export async function encryptWithPassphrase(
  value: unknown,
  passphrase: string,
  opts: { iterations?: number } = {},
): Promise<EncryptedPayload> {
  const iterations = opts.iterations ?? KDF_ITERATIONS;
  const salt = await ExpoCrypto.getRandomBytesAsync(SALT_BYTES);
  const iv = await ExpoCrypto.getRandomBytesAsync(IV_BYTES);
  const key = await pbkdf2Async(sha256, utf8.encode(passphrase), salt, {
    c: iterations,
    dkLen: KEY_BYTES,
  });
  const plaintext = utf8.encode(JSON.stringify(value));
  const ciphertext = gcm(key, iv).encrypt(plaintext);
  return {
    ciphertextB64: bytesToBase64(ciphertext),
    saltB64: bytesToBase64(salt),
    ivB64: bytesToBase64(iv),
    kdfIterations: iterations,
  };
}

/** Decrypt back to the original JSON value. Throws on wrong passphrase / tampering. */
export async function decryptWithPassphrase(
  payload: EncryptedPayload,
  passphrase: string,
): Promise<unknown> {
  const salt = base64ToBytes(payload.saltB64);
  const iv = base64ToBytes(payload.ivB64);
  const ciphertext = base64ToBytes(payload.ciphertextB64);
  const key = await pbkdf2Async(sha256, utf8.encode(passphrase), salt, {
    c: payload.kdfIterations,
    dkLen: KEY_BYTES,
  });
  const plaintext = gcm(key, iv).decrypt(ciphertext);
  return JSON.parse(utf8Decode.decode(plaintext));
}

// ---- base64 helpers --------------------------------------------------------
// Hermes exposes btoa/atob globally but they only handle latin1 strings, so we
// chunk to avoid stack-depth issues on long ciphertexts.

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    bin += String.fromCharCode.apply(null, Array.from(slice));
  }
  // eslint-disable-next-line no-undef
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  // eslint-disable-next-line no-undef
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
