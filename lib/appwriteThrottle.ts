/**
 * Shared throttle / retry helpers for Appwrite calls.
 *
 * Appwrite enforces per-endpoint rate limits that are easy to trip during
 * large imports (snapshots, daily history, balance upserts). This module
 * centralises:
 *   - 429 detection
 *   - sequential chunked execution with delays between chunks
 *   - exponential backoff with retry on rate-limit errors
 */

export function isRateLimitError(err: unknown): boolean {
  const message = String((err as any)?.message || err || '').toLowerCase();
  const code = Number((err as any)?.code);
  return code === 429 || message.includes('rate limit') || message.includes('too many requests');
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RunThrottledOptions {
  /** Items processed per chunk before pausing. Default 5. */
  chunkSize?: number;
  /** Delay between chunks (ms). Default 250. */
  chunkDelayMs?: number;
  /** Max retry attempts when a single item hits a rate limit. Default 4. */
  maxRetries?: number;
  /** Initial backoff delay for the first retry (ms). Default 1000. Doubles each retry. */
  initialBackoffMs?: number;
  /** Max backoff delay (ms). Default 30000. */
  maxBackoffMs?: number;
  /** Optional label for log messages. */
  label?: string;
}

/**
 * Run an async operation against each item in `items`, sequentially, with
 * throttling and retry-on-429 behaviour.
 *
 * Resolves with the per-item results (or undefined for items that failed all
 * retries). Non-rate-limit errors are surfaced via the optional onError
 * callback but do NOT abort the run.
 */
export async function runThrottled<T, R>(
  items: T[],
  perItem: (item: T, index: number) => Promise<R>,
  options: RunThrottledOptions & { onError?: (err: unknown, item: T, index: number) => void } = {}
): Promise<Array<R | undefined>> {
  const {
    chunkSize = 5,
    chunkDelayMs = 250,
    maxRetries = 4,
    initialBackoffMs = 1000,
    maxBackoffMs = 30_000,
    label = 'runThrottled',
    onError,
  } = options;

  const results: Array<R | undefined> = new Array(items.length);

  for (let start = 0; start < items.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, items.length);

    for (let i = start; i < end; i++) {
      const item = items[i];
      let attempt = 0;
      let backoff = initialBackoffMs;

      while (true) {
        try {
          results[i] = await perItem(item, i);
          break;
        } catch (err) {
          if (isRateLimitError(err) && attempt < maxRetries) {
            console.warn(
              `${label}: rate limited on item ${i}; retrying in ${backoff}ms (attempt ${attempt + 1}/${maxRetries})`
            );
            await sleep(backoff);
            backoff = Math.min(maxBackoffMs, backoff * 2);
            attempt++;
            continue;
          }
          if (onError) {
            try { onError(err, item, i); } catch { /* swallow */ }
          } else {
            console.error(`${label}: item ${i} failed`, err);
          }
          results[i] = undefined;
          break;
        }
      }
    }

    if (end < items.length && chunkDelayMs > 0) {
      await sleep(chunkDelayMs);
    }
  }

  return results;
}
