import * as Crypto from 'expo-crypto';

/**
 * Backend-agnostic unique ID generation. Drop-in replacement for Appwrite's
 * `ID.unique()` — UUIDs are valid Appwrite document IDs (36 chars, [a-z0-9-])
 * and valid CloudKit recordNames.
 */
export const ID = {
  unique(): string {
    return Crypto.randomUUID();
  },
};

/** First 16 hex chars of SHA-256 — used to derive safe, deterministic recordNames. */
export async function shortHash(input: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input);
  return digest.slice(0, 16);
}
