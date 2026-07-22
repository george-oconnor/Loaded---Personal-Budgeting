/**
 * Shared cache for "existing transactions" lookups used by the import preview
 * screens for duplicate detection.
 *
 * The CloudKit backend fetches transactions over the network (paginated
 * CKQueryOperation round trips), so pulling a user's entire history on every
 * dedup check is expensive and gets slower as history grows. Instead we:
 *  - bound the fetch to transactions on/after the import batch's earliest date
 *  - cache the result per user for a short window so the precheck and the
 *    actual import step (which run seconds apart) share one fetch instead of two
 */
import { getTransactionsInRangeAll, TransactionDoc } from "./backend";
import { withSpan } from "./sentry";

type CacheEntry = {
  docs: TransactionDoc[];
  sinceISO: string;
  fetchedAt: number;
};

// Long enough to cover one import flow (precheck -> import), short enough
// that a second, later import doesn't dedupe against a stale snapshot.
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, CacheEntry>();

export async function getExistingTransactionsSince(
  userId: string,
  sinceISO: string
): Promise<TransactionDoc[]> {
  const entry = cache.get(userId);
  const now = Date.now();
  if (entry && entry.sinceISO <= sinceISO && now - entry.fetchedAt < CACHE_TTL_MS) {
    return entry.docs.filter((d) => (d as any).date >= sinceISO);
  }

  const nowISO = new Date().toISOString();
  const docs = await withSpan(
    "import.fetch_existing_transactions",
    "db.query",
    { sinceISO },
    () => getTransactionsInRangeAll(userId, sinceISO, nowISO)
  );
  cache.set(userId, { docs, sinceISO, fetchedAt: now });
  return docs;
}

/** Drop the cached snapshot for a user so the next lookup re-fetches from the backend. */
export function invalidateExistingTransactionsCache(userId: string) {
  cache.delete(userId);
}
