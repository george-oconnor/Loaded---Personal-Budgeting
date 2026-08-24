import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  countBalanceHistory,
  deleteBalanceHistoryByAccountKey,
  deleteBalanceHistoryByBatch,
  deleteBalanceHistoryPage,
  getBalanceHistory as getBalanceHistoryRemote,
  isBalanceHistoryConfigured,
  upsertBalanceHistoryEntries,
  type BalanceHistoryDoc,
} from './backend';
import { isRateLimitError } from './appwriteThrottle';

const LOCAL_KEY = 'budget_app_balance_history';
const PENDING_KEY = 'budget_app_balance_history_pending';
const PENDING_PEAK_KEY = 'budget_app_balance_history_pending_peak';
const FLUSH_LOCK_KEY = 'budget_app_balance_history_flush_lock';
const WIPE_QUEUE_KEY = 'budget_app_balance_history_wipe_queue';
const WIPE_LOCK_KEY = 'budget_app_balance_history_wipe_lock';

// Throttle between Appwrite upserts to avoid rate limits.
// Each upsert internally does 1 list + 1 create/update = ~2 requests.
const FLUSH_CHUNK_SIZE = 25;
const FLUSH_BETWEEN_CHUNK_MS = 1500;
const FLUSH_LOCK_TTL_MS = 60_000;

// Adaptive backoff state. Persisted in-memory between flush calls within the same
// JS runtime. When a 429 hits we shrink the chunk and lengthen the delay; on
// successful chunks we slowly relax back toward the defaults.
const MIN_CHUNK_SIZE = 5;
const MAX_CHUNK_SIZE = FLUSH_CHUNK_SIZE;
const MAX_BETWEEN_CHUNK_MS = 30_000;
const RATE_LIMIT_COOLDOWN_MS = 60_000;
let currentChunkSize = FLUSH_CHUNK_SIZE;
let currentBetweenChunkMs = FLUSH_BETWEEN_CHUNK_MS;
let rateLimitCooldownUntil = 0;
let consecutiveSuccesses = 0;

export interface BalanceHistoryEntry {
  accountKey: string;
  accountName?: string;
  provider?: string;
  currency: string;
  date: string; // YYYY-MM-DD
  balance: number; // cents
  source?: 'import' | 'manual' | 'seed';
  importBatchId?: string;
}

export interface AccountImportInput {
  accountKey: string;
  accountName: string;
  provider?: string;
  currency: string;
  /** Final/closing balance after the latest transaction, in cents */
  finalBalance: number;
  /** ISO timestamp of the most recent transaction this balance reflects */
  finalBalanceDate: string;
  /** Transactions for this account included in the import. Amounts in cents (negative = expense). */
  transactions: Array<{ date: string; amount: number; kind?: 'income' | 'expense' }>;
}

function toDateKey(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;
}

/**
 * Compute daily closing-balance snapshots for one account from an import.
 *
 * Algorithm:
 *   - Start from the known `finalBalance` at `finalBalanceDate`.
 *   - Group transactions by date (YYYY-MM-DD).
 *   - The closing balance for the final-balance date is `finalBalance`.
 *   - Walk dates backwards: previous day's closing balance = current day's
 *     closing balance - net of all transactions on the current day.
 *   - This gives one row per day that had activity, plus the final day.
 */
export function computeDailyHistoryFromImport(
  input: AccountImportInput
): Array<{ date: string; balance: number }> {
  const finalDateKey = toDateKey(input.finalBalanceDate);
  if (!finalDateKey) return [];

  // Sum amounts per date for transactions <= finalBalanceDate.
  // Callers pass `amount` as a positive number in cents with direction in `kind`,
  // so we sign it here before computing day net.
  const finalDateMs = new Date(finalDateKey + 'T23:59:59Z').getTime();
  const netByDate = new Map<string, number>();
  for (const tx of input.transactions) {
    const key = toDateKey(tx.date);
    if (!key) continue;
    const txMs = new Date(key + 'T00:00:00Z').getTime();
    if (txMs > finalDateMs) continue; // ignore tx newer than the known balance
    const raw = Number(tx.amount);
    if (!isFinite(raw)) continue;
    const signed = tx.kind === 'expense' ? -Math.abs(raw) : Math.abs(raw);
    netByDate.set(key, (netByDate.get(key) || 0) + signed);
  }

  // Sorted descending list of dates with activity, plus the final date
  const datesWithActivity = new Set(netByDate.keys());
  datesWithActivity.add(finalDateKey);
  const sortedDesc = Array.from(datesWithActivity).sort((a, b) => (a < b ? 1 : -1));

  const result: Array<{ date: string; balance: number }> = [];
  let runningClose = input.finalBalance;

  for (let i = 0; i < sortedDesc.length; i++) {
    const date = sortedDesc[i];
    if (i === 0) {
      // Closing balance for the latest date is the known final balance
      result.push({ date, balance: runningClose });
    } else {
      // Previous day's closing balance = next day's closing - that next day's net
      const nextDate = sortedDesc[i - 1];
      const nextDateNet = netByDate.get(nextDate) || 0;
      runningClose = runningClose - nextDateNet;
      result.push({ date, balance: runningClose });
    }
  }

  // Return ascending by date for nicer storage/debug
  return result.sort((a, b) => (a.date < b.date ? -1 : 1));
}

async function readLocalCache(userId: string): Promise<BalanceHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(`${LOCAL_KEY}_${userId}`);
    return raw ? (JSON.parse(raw) as BalanceHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeLocalCache(userId: string, entries: BalanceHistoryEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(`${LOCAL_KEY}_${userId}`, JSON.stringify(entries));
  } catch (err) {
    console.error('writeLocalCache (balance history) failed', err);
  }
}

function mergeEntries(
  existing: BalanceHistoryEntry[],
  incoming: BalanceHistoryEntry[]
): BalanceHistoryEntry[] {
  const map = new Map<string, BalanceHistoryEntry>();
  for (const e of existing) map.set(`${e.accountKey}|${e.date}`, e);
  for (const e of incoming) map.set(`${e.accountKey}|${e.date}`, e);
  return Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Record balance history rows from a freshly completed import.
 * Writes immediately to AsyncStorage and enqueues for background sync to
 * Appwrite (to avoid rate limits during large imports).
 */
export async function recordImportBalanceHistory(
  userId: string | undefined,
  importBatchId: string,
  accounts: AccountImportInput[]
): Promise<void> {
  if (!accounts.length) return;

  const entries: BalanceHistoryEntry[] = [];
  for (const acc of accounts) {
    const days = computeDailyHistoryFromImport(acc);
    for (const d of days) {
      entries.push({
        accountKey: acc.accountKey,
        accountName: acc.accountName,
        provider: acc.provider,
        currency: acc.currency,
        date: d.date,
        balance: d.balance,
        source: 'import',
        importBatchId,
      });
    }
  }

  if (!entries.length) return;

  if (userId) {
    const existing = await readLocalCache(userId);
    await writeLocalCache(userId, mergeEntries(existing, entries));

    // Enqueue for background remote sync (does NOT await network)
    if (isBalanceHistoryConfigured()) {
      try {
        await enqueueBalanceHistory(userId, entries);
        // Schedule a deferred flush so changes appear remotely soon, without
        // blocking the import flow. The flush itself is throttled + locked.
        setTimeout(() => {
          flushBalanceHistoryQueue().catch((err) =>
            console.error('Deferred balance-history flush failed:', err)
          );
        }, 5000);
      } catch (err) {
        console.error('recordImportBalanceHistory: enqueue failed', err);
      }
    }
  }
}

// ============================================================
// Background sync queue
// ============================================================

interface PendingEntry extends BalanceHistoryEntry {
  userId: string;
  attempts?: number;
}

async function readPendingQueue(): Promise<PendingEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingEntry[]) : [];
  } catch {
    return [];
  }
}

async function writePendingQueue(queue: PendingEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('writePendingQueue (balance history) failed', err);
  }
}

async function enqueueBalanceHistory(userId: string, entries: BalanceHistoryEntry[]): Promise<void> {
  const queue = await readPendingQueue();
  // Dedupe by (userId, accountKey, date) — keep the latest balance.
  const map = new Map<string, PendingEntry>();
  for (const e of queue) map.set(`${e.userId}|${e.accountKey}|${e.date}`, e);
  for (const e of entries) {
    map.set(`${userId}|${e.accountKey}|${e.date}`, { ...e, userId, attempts: 0 });
  }
  const next = Array.from(map.values());
  await writePendingQueue(next);
  // Update peak so the UI can render progress (peak as denominator).
  await bumpPendingPeak(userId, next.filter((e) => e.userId === userId).length);
}

// ----- Pending peak tracking (per-user denominator for the sync progress bar) -----

async function readPendingPeaks(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_PEAK_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

async function writePendingPeaks(peaks: Record<string, number>): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_PEAK_KEY, JSON.stringify(peaks));
  } catch {
    // ignore
  }
}

async function bumpPendingPeak(userId: string, currentCount: number): Promise<void> {
  if (currentCount <= 0) return;
  const peaks = await readPendingPeaks();
  const prev = Number(peaks[userId]) || 0;
  if (currentCount > prev) {
    peaks[userId] = currentCount;
    await writePendingPeaks(peaks);
  }
}

async function clearPendingPeakIfDrained(userId: string): Promise<void> {
  const queue = await readPendingQueue();
  const remaining = queue.filter((e) => e.userId === userId).length;
  if (remaining > 0) return;
  const peaks = await readPendingPeaks();
  if (peaks[userId] !== undefined) {
    delete peaks[userId];
    await writePendingPeaks(peaks);
  }
}

async function acquireFlushLock(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(FLUSH_LOCK_KEY);
    if (raw) {
      const ts = Number(raw);
      if (!isNaN(ts) && Date.now() - ts < FLUSH_LOCK_TTL_MS) {
        return false;
      }
    }
    await AsyncStorage.setItem(FLUSH_LOCK_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

async function releaseFlushLock(): Promise<void> {
  try {
    await AsyncStorage.removeItem(FLUSH_LOCK_KEY);
  } catch {
    // ignore
  }
}

/**
 * Get count of pending balance-history entries waiting to sync.
 */
export async function getPendingBalanceHistoryCount(userId?: string): Promise<number> {
  const queue = await readPendingQueue();
  if (!userId) return queue.length;
  return queue.filter((e) => e.userId === userId).length;
}

/**
 * Snapshot of background sync progress for a user:
 *   - pending: entries still waiting to sync
 *   - total:   highest pending count seen during this batch (denominator)
 * Returns null if nothing is queued for this user.
 */
export async function getBalanceHistorySyncProgress(
  userId: string
): Promise<{ pending: number; total: number } | null> {
  const queue = await readPendingQueue();
  const pending = queue.filter((e) => e.userId === userId).length;
  if (pending <= 0) {
    // Drained — clear any stale peak so the next batch starts clean.
    await clearPendingPeakIfDrained(userId);
    return null;
  }
  const peaks = await readPendingPeaks();
  const peak = Number(peaks[userId]) || 0;
  const total = Math.max(peak, pending);
  return { pending, total };
}

/**
 * Process the pending queue in throttled chunks. Safe to call frequently —
 * a lock prevents concurrent flushes.
 */
export async function flushBalanceHistoryQueue(): Promise<{ synced: number; remaining: number }> {
  if (!isBalanceHistoryConfigured()) return { synced: 0, remaining: 0 };

  // Honor a recent rate-limit cooldown so we don't immediately re-hammer Appwrite.
  if (Date.now() < rateLimitCooldownUntil) {
    const remaining = (await readPendingQueue()).length;
    return { synced: 0, remaining };
  }

  const got = await acquireFlushLock();
  if (!got) return { synced: 0, remaining: 0 };

  let synced = 0;
  try {
    while (true) {
      const queue = await readPendingQueue();
      if (queue.length === 0) break;

      const chunk = queue.slice(0, currentChunkSize);

      // Group chunk by userId, then upsert
      const byUser = new Map<string, BalanceHistoryDoc[]>();
      for (const e of chunk) {
        const list = byUser.get(e.userId) || [];
        list.push({
          userId: e.userId,
          accountKey: e.accountKey,
          date: e.date,
          balance: e.balance,
          currency: e.currency,
          accountName: e.accountName,
          provider: e.provider,
          source: e.source,
          importBatchId: e.importBatchId,
        });
        byUser.set(e.userId, list);
      }

      let chunkFailed = false;
      let rateLimited = false;
      for (const [uid, docs] of byUser) {
        try {
          await upsertBalanceHistoryEntries(uid, docs);
        } catch (err) {
          chunkFailed = true;
          if (isRateLimitError(err)) {
            rateLimited = true;
            break;
          }
          console.error('flushBalanceHistoryQueue: chunk upsert failed', err);
        }
      }

      if (rateLimited) {
        // Adaptive backoff: shrink chunk, grow delay, set cooldown.
        consecutiveSuccesses = 0;
        currentChunkSize = Math.max(MIN_CHUNK_SIZE, Math.floor(currentChunkSize / 2));
        currentBetweenChunkMs = Math.min(MAX_BETWEEN_CHUNK_MS, currentBetweenChunkMs * 2);
        rateLimitCooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        console.warn(
          `Balance-history flush rate-limited; backing off (chunk=${currentChunkSize}, delay=${currentBetweenChunkMs}ms, cooldown=${RATE_LIMIT_COOLDOWN_MS}ms)`
        );

        // Increment attempts on this chunk and stop for now (back off)
        const queueNow = await readPendingQueue();
        const chunkKeys = new Set(chunk.map((e) => `${e.userId}|${e.accountKey}|${e.date}`));
        const updated = queueNow.map((e) => {
          if (chunkKeys.has(`${e.userId}|${e.accountKey}|${e.date}`)) {
            return { ...e, attempts: (e.attempts || 0) + 1 };
          }
          return e;
        });
        await writePendingQueue(updated);
        break;
      }

      if (chunkFailed) {
        // Drop entries that have failed too many times to avoid permanent stalling
        const queueNow = await readPendingQueue();
        const chunkKeys = new Set(chunk.map((e) => `${e.userId}|${e.accountKey}|${e.date}`));
        const remaining = queueNow.filter((e) => {
          if (!chunkKeys.has(`${e.userId}|${e.accountKey}|${e.date}`)) return true;
          return (e.attempts || 0) < 5;
        }).map((e) => {
          if (chunkKeys.has(`${e.userId}|${e.accountKey}|${e.date}`)) {
            return { ...e, attempts: (e.attempts || 0) + 1 };
          }
          return e;
        });
        await writePendingQueue(remaining);
      } else {
        synced += chunk.length;
        // Successful chunk: gradually relax backoff after a few wins.
        consecutiveSuccesses += 1;
        if (consecutiveSuccesses >= 3) {
          consecutiveSuccesses = 0;
          if (currentChunkSize < MAX_CHUNK_SIZE) {
            currentChunkSize = Math.min(MAX_CHUNK_SIZE, currentChunkSize + 5);
          }
          if (currentBetweenChunkMs > FLUSH_BETWEEN_CHUNK_MS) {
            currentBetweenChunkMs = Math.max(
              FLUSH_BETWEEN_CHUNK_MS,
              Math.floor(currentBetweenChunkMs / 2)
            );
          }
        }
        // Remove the synced chunk
        const queueNow = await readPendingQueue();
        const chunkKeys = new Set(chunk.map((e) => `${e.userId}|${e.accountKey}|${e.date}`));
        const remaining = queueNow.filter((e) => !chunkKeys.has(`${e.userId}|${e.accountKey}|${e.date}`));
        await writePendingQueue(remaining);
      }

      // Throttle between chunks
      const stillPending = (await readPendingQueue()).length;
      if (stillPending === 0) break;
      await new Promise((res) => setTimeout(res, currentBetweenChunkMs));
    }
  } finally {
    await releaseFlushLock();
  }

  const remaining = (await readPendingQueue()).length;
  return { synced, remaining };
}

export async function deleteBalanceHistoryForBatch(
  userId: string,
  importBatchId: string
): Promise<void> {
  // Local cache: drop matching entries
  try {
    const existing = await readLocalCache(userId);
    const filtered = existing.filter((e) => e.importBatchId !== importBatchId);
    if (filtered.length !== existing.length) {
      await writeLocalCache(userId, filtered);
    }
  } catch (err) {
    console.error('deleteBalanceHistoryForBatch local failed', err);
  }

  // Pending sync queue: drop matching entries so they don't resurrect
  try {
    const queue = await readPendingQueue();
    const filtered = queue.filter((e) => !(e.userId === userId && e.importBatchId === importBatchId));
    if (filtered.length !== queue.length) {
      await writePendingQueue(filtered);
    }
  } catch (err) {
    console.error('deleteBalanceHistoryForBatch queue failed', err);
  }

  if (isBalanceHistoryConfigured()) {
    try {
      await deleteBalanceHistoryByBatch(userId, importBatchId);
    } catch (err) {
      console.error('deleteBalanceHistoryForBatch remote failed', err);
    }
  }
}

/**
 * Purge all balance history for one account (called when the account itself
 * is removed or renamed), so it stops being carried forward into chart totals
 * after it no longer exists in the live balances list.
 */
export async function deleteBalanceHistoryForAccount(
  userId: string,
  accountKey: string
): Promise<void> {
  // Local cache: drop matching entries
  try {
    const existing = await readLocalCache(userId);
    const filtered = existing.filter((e) => e.accountKey !== accountKey);
    if (filtered.length !== existing.length) {
      await writeLocalCache(userId, filtered);
    }
  } catch (err) {
    console.error('deleteBalanceHistoryForAccount local failed', err);
  }

  // Pending sync queue: drop matching entries so they don't resurrect
  try {
    const queue = await readPendingQueue();
    const filtered = queue.filter((e) => !(e.userId === userId && e.accountKey === accountKey));
    if (filtered.length !== queue.length) {
      await writePendingQueue(filtered);
    }
  } catch (err) {
    console.error('deleteBalanceHistoryForAccount queue failed', err);
  }

  if (isBalanceHistoryConfigured()) {
    try {
      await deleteBalanceHistoryByAccountKey(userId, accountKey);
    } catch (err) {
      console.error('deleteBalanceHistoryForAccount remote failed', err);
    }
  }
}

/**
 * Wipe ALL balance history for a user. Local cache + pending sync queue are
 * cleared immediately so the UI updates instantly. Remote Appwrite docs are
 * queued for throttled background deletion to avoid rate limits.
 */
export async function clearAllBalanceHistory(userId: string): Promise<void> {
  // Capture local cache size BEFORE clearing it — this is a reliable lower
  // bound on how many remote docs exist (one per accountKey/date pair).
  let localCount = 0;
  try {
    const cached = await readLocalCache(userId);
    localCount = cached.length;
  } catch (err) {
    console.error('clearAllBalanceHistory readLocalCache failed', err);
  }

  // Local cache: clear immediately
  try {
    await AsyncStorage.removeItem(`${LOCAL_KEY}_${userId}`);
  } catch (err) {
    console.error('clearAllBalanceHistory local failed', err);
  }

  // Pending upload queue: drop entries for this user so we don't re-upload
  // anything that's about to be wiped.
  try {
    const queue = await readPendingQueue();
    const filtered = queue.filter((e) => e.userId !== userId);
    if (filtered.length !== queue.length) {
      await writePendingQueue(filtered);
    }
  } catch (err) {
    console.error('clearAllBalanceHistory queue failed', err);
  }

  // Mark a remote wipe as pending. The background processor (called from
  // useAutoSync + here) will drain it in throttled chunks.
  if (isBalanceHistoryConfigured()) {
    try {
      // Probe remote total so the tray can render a real progress bar. Use
      // the larger of (remote count, local cache count) — the count call may
      // fail or be rate-limited, in which case the cache size is a much
      // better estimate than zero.
      let remoteCount = 0;
      try {
        remoteCount = await countBalanceHistory(userId);
      } catch (err) {
        console.error('clearAllBalanceHistory: count failed', err);
      }
      const total = Math.max(remoteCount, localCount);
      await enqueueBalanceHistoryWipe(userId, total);
      // Kick off a deferred background flush. Don't await — caller should not
      // be blocked, especially when a previous attempt hit a rate limit.
      setTimeout(() => {
        flushBalanceHistoryWipeQueue().catch((err) =>
          console.error('Deferred balance-history wipe flush failed:', err)
        );
      }, 100);
    } catch (err) {
      console.error('clearAllBalanceHistory: enqueue wipe failed', err);
    }
  }
}

// ============================================================
// Background wipe queue
// ============================================================

interface WipeQueueEntry {
  userId: string;
  total: number;   // best-effort initial doc count for progress
  deleted: number; // running count of docs deleted so far
}

async function readWipeQueue(): Promise<WipeQueueEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(WIPE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Back-compat: old format stored bare userId strings. Coerce to entries.
    return parsed
      .map((v) => {
        if (typeof v === 'string') return { userId: v, total: 0, deleted: 0 };
        if (v && typeof v.userId === 'string') {
          return {
            userId: v.userId,
            total: Number(v.total) || 0,
            deleted: Number(v.deleted) || 0,
          };
        }
        return null;
      })
      .filter((e): e is WipeQueueEntry => e !== null);
  } catch {
    return [];
  }
}

async function writeWipeQueue(entries: WipeQueueEntry[]): Promise<void> {
  try {
    if (entries.length === 0) {
      await AsyncStorage.removeItem(WIPE_QUEUE_KEY);
    } else {
      // Dedupe by userId, keep the latest entry for each.
      const byUser = new Map<string, WipeQueueEntry>();
      for (const e of entries) byUser.set(e.userId, e);
      await AsyncStorage.setItem(WIPE_QUEUE_KEY, JSON.stringify(Array.from(byUser.values())));
    }
  } catch (err) {
    console.error('writeWipeQueue (balance history) failed', err);
  }
}

async function enqueueBalanceHistoryWipe(userId: string, total: number): Promise<void> {
  const queue = await readWipeQueue();
  const existing = queue.find((e) => e.userId === userId);
  if (existing) {
    // Re-trigger: bump total to whatever we just measured (fresh wipe request)
    // and reset deleted so the bar reflects the new run accurately.
    existing.total = Math.max(total, existing.total - existing.deleted);
    existing.deleted = 0;
  } else {
    queue.push({ userId, total, deleted: 0 });
  }
  await writeWipeQueue(queue);
}

async function acquireWipeLock(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(WIPE_LOCK_KEY);
    if (raw) {
      const ts = Number(raw);
      if (!isNaN(ts) && Date.now() - ts < FLUSH_LOCK_TTL_MS) {
        return false;
      }
    }
    await AsyncStorage.setItem(WIPE_LOCK_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

async function releaseWipeLock(): Promise<void> {
  try {
    await AsyncStorage.removeItem(WIPE_LOCK_KEY);
  } catch {
    // ignore
  }
}

/**
 * True if there is a queued (in-progress) remote wipe for this user (or any
 * user when no id is given). Useful for the auto-sync hook.
 */
export async function getPendingBalanceHistoryWipeCount(userId?: string): Promise<number> {
  const queue = await readWipeQueue();
  if (!userId) return queue.length;
  return queue.some((e) => e.userId === userId) ? 1 : 0;
}

/**
 * Snapshot of wipe progress for a user: { total, deleted } in absolute doc
 * counts. Returns null if there's no active wipe for the user.
 */
export async function getBalanceHistoryWipeProgress(
  userId: string
): Promise<{ total: number; deleted: number } | null> {
  const queue = await readWipeQueue();
  const entry = queue.find((e) => e.userId === userId);
  if (!entry) return null;
  return { total: entry.total, deleted: entry.deleted };
}

/**
 * Drain the wipe queue in throttled pages. Honours the same rate-limit
 * cooldown as the upload flusher. Safe to call frequently — a lock prevents
 * concurrent runs.
 */
export async function flushBalanceHistoryWipeQueue(): Promise<{ deleted: number; remainingUsers: number }> {
  if (!isBalanceHistoryConfigured()) return { deleted: 0, remainingUsers: 0 };

  if (Date.now() < rateLimitCooldownUntil) {
    const queue = await readWipeQueue();
    return { deleted: 0, remainingUsers: queue.length };
  }

  const got = await acquireWipeLock();
  if (!got) return { deleted: 0, remainingUsers: 0 };

  let deleted = 0;
  try {
    while (true) {
      const queue = await readWipeQueue();
      if (queue.length === 0) break;

      const entry = queue[0];
      const userId = entry.userId;

      let pageHadMore = false;
      let rateLimited = false;
      let pageDeleted = 0;
      try {
        const result = await deleteBalanceHistoryPage(userId, currentChunkSize);
        pageDeleted = result.deleted;
        deleted += pageDeleted;
        pageHadMore = result.hasMore;
      } catch (err) {
        if (isRateLimitError(err)) {
          rateLimited = true;
          consecutiveSuccesses = 0;
          currentChunkSize = Math.max(MIN_CHUNK_SIZE, Math.floor(currentChunkSize / 2));
          currentBetweenChunkMs = Math.min(MAX_BETWEEN_CHUNK_MS, currentBetweenChunkMs * 2);
          rateLimitCooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
          console.warn(
            `Balance-history wipe rate-limited; backing off (chunk=${currentChunkSize}, delay=${currentBetweenChunkMs}ms, cooldown=${RATE_LIMIT_COOLDOWN_MS}ms)`
          );
        } else {
          console.error('flushBalanceHistoryWipeQueue: page delete failed', err);
          // For non-rate-limit errors, back off briefly and try again next call
          // to avoid a tight failure loop.
          rateLimitCooldownUntil = Date.now() + 5000;
        }
      }

      // Persist progress for this user. We deliberately do NOT auto-grow
      // `total` here — that previously made the bar always sit at
      // (deleted)/(deleted+1) when the initial count was 0. If our seeded
      // total really did underestimate, the UI clamps the displayed % at 100
      // until the queue empties and the row disappears.
      if (pageDeleted > 0) {
        const queueNow = await readWipeQueue();
        const updated = queueNow.map((e) => {
          if (e.userId !== userId) return e;
          return {
            ...e,
            deleted: e.deleted + pageDeleted,
          };
        });
        await writeWipeQueue(updated);
      }

      if (rateLimited) break;

      if (!pageHadMore) {
        // Done with this user; pop from queue.
        const queueNow = await readWipeQueue();
        await writeWipeQueue(queueNow.filter((e) => e.userId !== userId));

        // Successful chunks: relax backoff a bit.
        consecutiveSuccesses += 1;
        if (consecutiveSuccesses >= 3) {
          consecutiveSuccesses = 0;
          if (currentChunkSize < MAX_CHUNK_SIZE) {
            currentChunkSize = Math.min(MAX_CHUNK_SIZE, currentChunkSize + 5);
          }
          if (currentBetweenChunkMs > FLUSH_BETWEEN_CHUNK_MS) {
            currentBetweenChunkMs = Math.max(
              FLUSH_BETWEEN_CHUNK_MS,
              Math.floor(currentBetweenChunkMs / 2)
            );
          }
        }
        continue;
      }

      // More pages remaining for this user: throttle then continue.
      await new Promise((res) => setTimeout(res, currentBetweenChunkMs));
    }
  } finally {
    await releaseWipeLock();
  }

  const remainingUsers = (await readWipeQueue()).length;
  return { deleted, remainingUsers };
}

export interface ChartPoint {
  date: string; // YYYY-MM-DD
  /** Total balance across all accounts on this date (cents) */
  total: number;
  /** Per-account closing balance carried forward to this date (cents) */
  byAccount: Record<string, number>;
}

/**
 * Fetch balance history merged from Appwrite + local cache, and produce a
 * day-by-day series with carry-forward, suitable for charting.
 */
export async function getBalanceHistoryForChart(
  userId: string | undefined,
  options: { startDate?: string; endDate?: string; accountKeys?: string[] } = {}
): Promise<{
  points: ChartPoint[];
  accountKeys: string[];
  accountMeta: Record<string, { accountName?: string; currency?: string; provider?: string }>;
}> {
  if (!userId) return { points: [], accountKeys: [], accountMeta: {} };

  // Fetch local cache
  const local = await readLocalCache(userId);

  // Fetch remote (best-effort)
  let remote: BalanceHistoryDoc[] = [];
  if (isBalanceHistoryConfigured()) {
    try {
      remote = await getBalanceHistoryRemote(userId, options);
    } catch (err) {
      console.error('getBalanceHistoryForChart: remote fetch failed', err);
    }
  }

  // Merge by (accountKey, date), prefer remote (canonical) over local
  const merged = new Map<string, BalanceHistoryEntry>();
  for (const e of local) {
    if (options.accountKeys && !options.accountKeys.includes(e.accountKey)) continue;
    if (options.startDate && e.date < options.startDate) continue;
    if (options.endDate && e.date > options.endDate) continue;
    merged.set(`${e.accountKey}|${e.date}`, e);
  }
  for (const e of remote) {
    merged.set(`${e.accountKey}|${e.date}`, {
      accountKey: e.accountKey,
      accountName: e.accountName,
      provider: e.provider,
      currency: e.currency,
      date: e.date,
      balance: e.balance,
      source: e.source,
      importBatchId: e.importBatchId,
    });
  }

  const all = Array.from(merged.values());
  if (all.length === 0) {
    return { points: [], accountKeys: [], accountMeta: {} };
  }

  // Build per-account sorted series
  const byAccount = new Map<string, BalanceHistoryEntry[]>();
  const accountMeta: Record<string, { accountName?: string; currency?: string; provider?: string }> = {};
  for (const e of all) {
    const list = byAccount.get(e.accountKey) || [];
    list.push(e);
    byAccount.set(e.accountKey, list);
    accountMeta[e.accountKey] = {
      accountName: e.accountName || accountMeta[e.accountKey]?.accountName,
      currency: e.currency || accountMeta[e.accountKey]?.currency,
      provider: e.provider || accountMeta[e.accountKey]?.provider,
    };
  }
  for (const list of byAccount.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  // Determine date span
  const allDates = all.map((e) => e.date).sort();
  const startDate = options.startDate || allDates[0];
  const endDate = options.endDate || toDateKey(new Date());
  if (!startDate || !endDate || startDate > endDate) {
    return { points: [], accountKeys: Array.from(byAccount.keys()), accountMeta };
  }

  // Iterate day by day, carrying forward last-known balance per account
  const accountKeys = Array.from(byAccount.keys());
  const lastKnown: Record<string, number | undefined> = {};
  // Seed with the most recent entry on or before startDate (so chart starts at correct level)
  for (const key of accountKeys) {
    const series = byAccount.get(key)!;
    let seed: number | undefined;
    for (const e of series) {
      if (e.date <= startDate) seed = e.balance;
      else break;
    }
    lastKnown[key] = seed;
  }

  // Build a per-account map for O(1) lookup by date
  const seriesIndex = new Map<string, Map<string, number>>();
  for (const [key, list] of byAccount) {
    const m = new Map<string, number>();
    for (const e of list) m.set(e.date, e.balance);
    seriesIndex.set(key, m);
  }

  const points: ChartPoint[] = [];
  let cursor = startDate;
  // Cap the loop to avoid runaway iteration on bad input (max ~5 years)
  let safety = 366 * 5;
  while (cursor <= endDate && safety-- > 0) {
    for (const key of accountKeys) {
      const todayBal = seriesIndex.get(key)?.get(cursor);
      if (todayBal !== undefined) lastKnown[key] = todayBal;
    }
    const byAcct: Record<string, number> = {};
    let total = 0;
    let anyKnown = false;
    for (const key of accountKeys) {
      const v = lastKnown[key];
      if (v !== undefined) {
        byAcct[key] = v;
        total += v;
        anyKnown = true;
      }
    }
    if (anyKnown) {
      points.push({ date: cursor, total, byAccount: byAcct });
    }
    // increment cursor by 1 day
    const next = new Date(cursor + 'T00:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = toDateKey(next);
  }

  return { points, accountKeys, accountMeta };
}
