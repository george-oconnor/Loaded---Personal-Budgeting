/**
 * CloudKit implementation of the backend surface previously provided by
 * lib/appwrite.ts. Function names and signatures mirror the Appwrite versions
 * so lib/backend.ts can select either implementation.
 *
 * Storage model:
 * - All user data lives in the private database, custom zone "UserData".
 *   The private DB is per-user by construction, so `userId` parameters are
 *   accepted (for signature compatibility) but not stored or filtered on.
 * - Deterministic recordNames replace query-then-upsert: singletons
 *   ("budget", "profile", "prefs") and hashed keys ("bal_<hash>",
 *   "bh_<hash>_<date>", "imp_<hash>"). Transactions and subscriptions use
 *   opaque unique IDs (UUIDs, or Appwrite $ids carried over by migration).
 * - Docs are returned with `$id`/`$createdAt`/`$updatedAt` aliases so existing
 *   consumers keep working.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import CloudKitStorage, {
  FieldValue,
  Filter,
  RecordInput,
  RecordOutput,
  SaveResult,
  Sort,
  getRetryAfterSeconds,
} from '../modules/cloudkit-storage';
import { CATEGORIES } from '../constants/categories';
import type {
  AccountImportDoc,
  BalanceHistoryDoc,
  BudgetDoc,
  BulkCreateResult,
  CategoryDoc,
  SubscriptionDoc,
  TransactionDoc,
  TransactionFilter,
  UserDoc,
  UserPreferencesDoc,
} from './appwrite';
import { ID, shortHash } from './ids';
import { addBreadcrumb, captureException } from './sentry';

export const ZONE = 'UserData';
const MY_VOTE_RECORDS_KEY = 'cloudkit_my_vote_records';

// ============================================================
// Availability / account
// ============================================================

export function isCloudKitAvailable(): boolean {
  return CloudKitStorage != null;
}

function native() {
  if (!CloudKitStorage) {
    throw new Error('CloudKit native module not available (requires a development build, not Expo Go)');
  }
  return CloudKitStorage;
}

let cachedUserRecordName: string | null = null;
export async function getCloudKitUserRecordName(): Promise<string> {
  if (!cachedUserRecordName) {
    cachedUserRecordName = await native().getUserRecordName();
  }
  return cachedUserRecordName;
}

export async function getCloudKitAccountStatus() {
  return native().getAccountStatus();
}

/** Public entry point for the auth flow to provision the user's data zone. */
export async function ensureUserZone(): Promise<void> {
  return ensureZone();
}

let zoneReady: Promise<void> | null = null;
async function ensureZone(): Promise<void> {
  if (!zoneReady) {
    zoneReady = native()
      .ensureZone(ZONE)
      .catch((err) => {
        zoneReady = null; // allow retry on next call
        throw err;
      });
  }
  return zoneReady;
}

// ============================================================
// Error handling / retry
// ============================================================

function errorCode(err: unknown): string {
  return (err as any)?.code || 'CK_ERROR';
}

const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries RATE_LIMITED (respecting the server's retryAfter hint) and recovers
 * once from ZONE_NOT_FOUND by recreating the zone. Everything else rethrows.
 */
async function withRetry<T>(op: () => Promise<T>, label: string): Promise<T> {
  let zoneRetried = false;
  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      const code = errorCode(err);
      if (code === 'ZONE_NOT_FOUND' && !zoneRetried) {
        zoneRetried = true;
        zoneReady = null;
        await ensureZone();
        continue;
      }
      if (code === 'RATE_LIMITED' && attempt < 2) {
        const retryAfter = getRetryAfterSeconds(err) ?? 3;
        console.warn(`${label}: CloudKit rate limited, retrying in ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        continue;
      }
      throw err;
    }
  }
}

// ============================================================
// Record <-> doc coding
// ============================================================

type FieldTypes = Record<string, FieldValue['type']>;

const TRANSACTION_FIELDS: FieldTypes = {
  title: 'string',
  subtitle: 'string',
  amount: 'double',
  kind: 'string',
  categoryId: 'string',
  date: 'date',
  currency: 'string',
  displayName: 'string',
  account: 'string',
  matchedTransferId: 'string',
  hideMerchantIcon: 'bool',
  importedAt: 'date',
  originalAmount: 'double',
  excludeFromAnalytics: 'bool',
  isAnalyticsProtected: 'bool',
  isSubscription: 'bool',
  subscriptionId: 'string',
  source: 'string',
  importBatchId: 'string',
};

const BUDGET_FIELDS: FieldTypes = {
  monthlyBudget: 'double',
  currency: 'string',
  cycleType: 'string',
  cycleDay: 'int',
  budgetSource: 'string',
  lastMonthReference: 'string',
};

const PROFILE_FIELDS: FieldTypes = {
  email: 'string',
  firstname: 'string',
  lastname: 'string',
  updatedAt: 'date',
  lastLoginTime: 'date',
};

const BALANCE_FIELDS: FieldTypes = {
  accountKey: 'string',
  accountName: 'string',
  accountType: 'string',
  provider: 'string',
  currency: 'string',
  balance: 'double',
  lastUpdated: 'date',
  previousBalance: 'double',
  previousBalanceTimestamp: 'date',
  importBatchId: 'string',
};

const BALANCE_HISTORY_FIELDS: FieldTypes = {
  accountKey: 'string',
  date: 'date', // YYYY-MM-DD encoded as UTC midnight
  balance: 'int', // cents
  currency: 'string',
  accountName: 'string',
  provider: 'string',
  source: 'string',
  importBatchId: 'string',
};

const ACCOUNT_IMPORT_FIELDS: FieldTypes = {
  accountKey: 'string',
  accountName: 'string',
  provider: 'string',
  lastImportDate: 'date',
};

const PREFERENCES_FIELDS: FieldTypes = {
  dismissedImportBanners: 'string', // JSON string, matching the Appwrite schema
  notificationsEnabled: 'bool',
};

const SUBSCRIPTION_FIELDS: FieldTypes = {
  name: 'string',
  merchantName: 'string',
  displayName: 'string',
  amount: 'double',
  amountType: 'string',
  frequency: 'string',
  categoryId: 'string',
  status: 'string',
  nextBillingDate: 'date',
  confirmedAt: 'date',
  notes: 'string',
};

const VOTE_FIELDS: FieldTypes = {
  merchantKey: 'string',
  merchantName: 'string',
  categoryId: 'string',
  iconUrl: 'string',
  voterHash: 'string',
  updatedAt: 'date',
};

/** YYYY-MM-DD -> full ISO timestamp so CloudKit stores a real, range-queryable Date. */
function dayToISO(day: string): string {
  return day.length === 10 ? `${day}T00:00:00.000Z` : day;
}

function encodeFields(data: Record<string, any>, types: FieldTypes): Record<string, FieldValue> {
  const fields: Record<string, FieldValue> = {};
  for (const [key, raw] of Object.entries(data)) {
    if (raw === undefined) continue;
    const type = types[key];
    if (!type) continue; // unknown fields are dropped rather than sent untyped
    if (raw === null) {
      fields[key] = { type: 'null' };
      continue;
    }
    fields[key] = { type, value: type === 'date' ? dayToISO(String(raw)) : raw };
  }
  return fields;
}

/** Decodes a record into a doc with $id/$createdAt/$updatedAt aliases, coercing int-encoded bools. */
function decodeRecord(record: RecordOutput, types: FieldTypes): any {
  const doc: any = {
    $id: record.recordName,
    $createdAt: record.createdAt,
    $updatedAt: record.modifiedAt,
  };
  for (const [key, field] of Object.entries(record.fields)) {
    const declared = types[key];
    if (declared === 'bool') {
      doc[key] = field.value === 1 || field.value === true;
    } else {
      doc[key] = field.value;
    }
  }
  return doc;
}

function filterValue(type: FieldValue['type'], value: any): FieldValue {
  return { type, value: type === 'date' ? dayToISO(String(value)) : value };
}

// ============================================================
// Low-level operation helpers
// ============================================================

async function savePrivate(
  records: RecordInput[],
  savePolicy: 'allKeys' | 'changedKeys',
  label: string
): Promise<SaveResult> {
  await ensureZone();
  return withRetry(() => native().saveRecords('private', ZONE, records, savePolicy), label);
}

async function saveOne(
  recordType: string,
  recordName: string,
  data: Record<string, any>,
  types: FieldTypes,
  savePolicy: 'allKeys' | 'changedKeys',
  label: string
) {
  const result = await savePrivate(
    [{ recordType, recordName, fields: encodeFields(data, types) }],
    savePolicy,
    label
  );
  if (result.failed.length > 0) {
    const failure = result.failed[0];
    const err = new Error(`${label} failed: ${failure.message}`);
    (err as any).code = failure.code;
    throw err;
  }
  return { $id: recordName, ...data };
}

async function deletePrivate(recordNames: string[], label: string): Promise<SaveResult> {
  if (recordNames.length === 0) return { saved: [], failed: [] };
  await ensureZone();
  const result = await withRetry(() => native().deleteRecords('private', ZONE, recordNames), label);
  // Deleting something already gone is success for our purposes
  result.failed = result.failed.filter((f) => f.code !== 'NOT_FOUND');
  return result;
}

async function fetchOne(recordName: string, types: FieldTypes): Promise<any | null> {
  await ensureZone();
  const res = await withRetry(
    () => native().fetchRecords('private', ZONE, [recordName]),
    `fetch ${recordName}`
  );
  const record = res.found[0];
  return record ? decodeRecord(record, types) : null;
}

async function queryPage(
  recordType: string,
  types: FieldTypes,
  options: {
    filters?: Filter[];
    sorts?: Sort[];
    limit?: number;
    cursor?: string | null;
    desiredKeys?: string[] | null;
  } = {}
): Promise<{ docs: any[]; cursor: string | null }> {
  await ensureZone();
  const res = await withRetry(
    () =>
      native().queryRecords('private', ZONE, recordType, {
        filters: options.filters ?? [],
        sorts: options.sorts ?? [],
        limit: options.limit ?? 0,
        cursor: options.cursor ?? null,
        desiredKeys: options.desiredKeys ?? null,
      }),
    `query ${recordType}`
  );
  return { docs: res.records.map((r) => decodeRecord(r, types)), cursor: res.cursor };
}

/** Cursor-loops until exhausted. */
async function queryAll(
  recordType: string,
  types: FieldTypes,
  options: { filters?: Filter[]; sorts?: Sort[]; desiredKeys?: string[] | null } = {}
): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | null = null;
  do {
    const page = await queryPage(recordType, types, { ...options, cursor, limit: 400 });
    all.push(...page.docs);
    cursor = page.cursor;
  } while (cursor);
  return all;
}

// ============================================================
// User profile
// ============================================================

export async function createUserProfile(
  userId: string,
  email: string,
  firstName: string,
  lastName: string
) {
  return saveOne(
    'UserProfile',
    'profile',
    { email, firstname: firstName, lastname: lastName },
    PROFILE_FIELDS,
    'allKeys',
    'createUserProfile'
  );
}

export async function getUserProfile(userId: string): Promise<UserDoc | null> {
  try {
    const doc = await fetchOne('profile', PROFILE_FIELDS);
    if (!doc) return null;
    return {
      userId,
      email: doc.email,
      firstName: doc.firstname,
      lastName: doc.lastname,
      createdAt: doc.$createdAt,
      updatedAt: doc.updatedAt ?? doc.$updatedAt,
      lastLoginTime: doc.lastLoginTime,
    };
  } catch (err) {
    console.error('getUserProfile - error:', userId, err);
    return null;
  }
}

export async function updateUserProfile(
  userId: string,
  data: Partial<Omit<UserDoc, 'userId' | 'createdAt'>>
) {
  const payload: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (data.email !== undefined) payload.email = data.email;
  if (data.firstName !== undefined) payload.firstname = data.firstName;
  if (data.lastName !== undefined) payload.lastname = data.lastName;
  if (data.lastLoginTime !== undefined) payload.lastLoginTime = data.lastLoginTime;
  return saveOne('UserProfile', 'profile', payload, PROFILE_FIELDS, 'changedKeys', 'updateUserProfile');
}

// ============================================================
// Account balances
// ============================================================

const balanceRecordName = async (accountKey: string) => `bal_${await shortHash(accountKey)}`;

export async function upsertAccountBalance(
  userId: string,
  data: {
    accountKey: string;
    accountName: string;
    accountType: string;
    provider?: string;
    currency: string;
    balance: number;
    lastUpdated?: string;
  }
) {
  try {
    return await saveOne(
      'Balance',
      await balanceRecordName(data.accountKey),
      { ...data, lastUpdated: data.lastUpdated || new Date().toISOString() },
      BALANCE_FIELDS,
      'changedKeys', // preserve any snapshot fields (previousBalance etc.) on the record
      'upsertAccountBalance'
    );
  } catch (err) {
    console.error('upsertAccountBalance error', err);
    captureException(asError(err));
    throw err;
  }
}

export async function getAccountBalancesFromAppwrite(userId: string) {
  try {
    const docs = await queryAll('Balance', BALANCE_FIELDS);
    return docs.map((doc) => ({
      accountKey: doc.accountKey,
      accountName: doc.accountName,
      accountType: doc.accountType,
      provider: doc.provider,
      currency: doc.currency,
      balance: doc.balance,
      lastUpdated: doc.lastUpdated,
    }));
  } catch (err) {
    console.error('getAccountBalances error', err);
    captureException(asError(err));
    throw err;
  }
}

export async function deleteAccountBalanceDoc(userId: string, accountKey: string) {
  try {
    const result = await deletePrivate([await balanceRecordName(accountKey)], 'deleteAccountBalanceDoc');
    if (result.failed.length > 0) {
      throw new Error(result.failed[0].message);
    }
    return { deleted: result.saved.length > 0, ...(result.saved.length === 0 ? { reason: 'not-found' } : {}) } as
      | { deleted: true }
      | { deleted: false; reason: 'not-found' };
  } catch (err) {
    console.error('deleteAccountBalanceDoc error', err);
    captureException(asError(err));
    throw err;
  }
}

export async function saveBalanceSnapshotToAppwrite(
  userId: string,
  importBatchId: string,
  balances: Array<{
    accountKey: string;
    accountName: string;
    accountType: string;
    provider?: string;
    currency: string;
    balance: number;
    lastUpdated: string;
  }>
): Promise<void> {
  try {
    const snapshotTimestamp = new Date().toISOString();
    const records: RecordInput[] = await Promise.all(
      balances.map(async (balance) => ({
        recordType: 'Balance',
        recordName: await balanceRecordName(balance.accountKey),
        fields: encodeFields(
          {
            previousBalance: balance.balance,
            previousBalanceTimestamp: snapshotTimestamp,
            importBatchId,
          },
          BALANCE_FIELDS
        ),
      }))
    );
    const result = await savePrivate(records, 'changedKeys', 'saveBalanceSnapshot');
    if (result.failed.length > 0) {
      console.warn(
        `Balance snapshot completed with ${result.failed.length}/${balances.length} failures (undo may be partial)`
      );
    } else {
      console.log('Balance snapshot saved to CloudKit');
    }
  } catch (err) {
    console.error('Error saving balance snapshot:', err);
    captureException(asError(err));
    throw err;
  }
}

export async function restoreBalancesFromSnapshot(userId: string, importBatchId: string): Promise<boolean> {
  try {
    const docs = await queryAll('Balance', BALANCE_FIELDS, {
      filters: [{ field: 'importBatchId', op: 'eq', value: filterValue('string', importBatchId) }],
    });
    if (docs.length === 0) {
      console.warn('No balances found to restore for batch', importBatchId);
      return false;
    }

    const records: RecordInput[] = [];
    for (const doc of docs) {
      if (doc.previousBalance !== null && doc.previousBalance !== undefined) {
        records.push({
          recordType: 'Balance',
          recordName: doc.$id,
          fields: encodeFields(
            {
              balance: doc.previousBalance,
              lastUpdated: new Date().toISOString(),
              previousBalance: null,
              previousBalanceTimestamp: null,
              importBatchId: null,
            },
            BALANCE_FIELDS
          ),
        });
      }
    }
    if (records.length === 0) return false;

    const result = await savePrivate(records, 'changedKeys', 'restoreBalancesFromSnapshot');
    const restored = result.saved.length;
    console.log(`Restored ${restored} balance(s) from snapshot`);
    return restored > 0;
  } catch (err) {
    console.error('Error restoring balances from snapshot:', err);
    captureException(asError(err));
    return false;
  }
}

// ============================================================
// Balance history
// ============================================================

export function isBalanceHistoryConfigured(): boolean {
  return isCloudKitAvailable();
}

function historyDayFromDoc(doc: any): string {
  // Stored as a CK Date; surface the original YYYY-MM-DD string
  return String(doc.date).slice(0, 10);
}

export async function upsertBalanceHistoryEntries(
  userId: string,
  entries: BalanceHistoryDoc[]
): Promise<void> {
  if (!isCloudKitAvailable()) return;
  if (!entries.length) return;

  const records: RecordInput[] = await Promise.all(
    entries.map(async (entry) => ({
      recordType: 'BalanceHistory',
      recordName: `bh_${await shortHash(entry.accountKey)}_${entry.date}`,
      fields: encodeFields(
        {
          accountKey: entry.accountKey,
          date: entry.date,
          balance: entry.balance,
          currency: entry.currency,
          accountName: entry.accountName,
          provider: entry.provider,
          source: entry.source || 'import',
          importBatchId: entry.importBatchId,
        },
        BALANCE_HISTORY_FIELDS
      ),
    }))
  );

  const result = await savePrivate(records, 'allKeys', 'upsertBalanceHistoryEntries');
  if (result.failed.length > 0) {
    // Rethrow so the background flush queue backs off and retries the rest
    const failure = result.failed[0];
    const err = new Error(`upsertBalanceHistoryEntries: ${result.failed.length} entries failed: ${failure.message}`);
    (err as any).code = failure.code;
    throw err;
  }
}

export async function getBalanceHistory(
  userId: string,
  options: { startDate?: string; endDate?: string; accountKeys?: string[] } = {}
): Promise<BalanceHistoryDoc[]> {
  if (!isCloudKitAvailable()) return [];

  const filters: Filter[] = [];
  if (options.startDate) filters.push({ field: 'date', op: 'gte', value: filterValue('date', options.startDate) });
  if (options.endDate) filters.push({ field: 'date', op: 'lte', value: filterValue('date', options.endDate) });
  if (options.accountKeys && options.accountKeys.length > 0) {
    filters.push({
      field: 'accountKey',
      op: 'in',
      value: options.accountKeys.map((k) => filterValue('string', k)),
    });
  }

  try {
    const docs = await queryAll('BalanceHistory', BALANCE_HISTORY_FIELDS, {
      filters,
      sorts: [{ field: 'date', ascending: true }],
    });
    return docs.map((doc) => ({
      userId,
      accountKey: doc.accountKey,
      date: historyDayFromDoc(doc),
      balance: doc.balance,
      currency: doc.currency,
      accountName: doc.accountName,
      provider: doc.provider,
      source: doc.source,
      importBatchId: doc.importBatchId,
    }));
  } catch (err) {
    console.error('getBalanceHistory error', err);
    captureException(asError(err));
    return [];
  }
}

export async function deleteBalanceHistoryByBatch(userId: string, importBatchId: string): Promise<number> {
  if (!isCloudKitAvailable()) return 0;
  try {
    const docs = await queryAll('BalanceHistory', BALANCE_HISTORY_FIELDS, {
      filters: [{ field: 'importBatchId', op: 'eq', value: filterValue('string', importBatchId) }],
      desiredKeys: [],
    });
    const result = await deletePrivate(docs.map((d) => d.$id), 'deleteBalanceHistoryByBatch');
    return result.saved.length;
  } catch (err) {
    console.error('deleteBalanceHistoryByBatch error', err);
    captureException(asError(err));
    return 0;
  }
}

export async function deleteAllBalanceHistory(userId: string): Promise<number> {
  if (!isCloudKitAvailable()) return 0;
  try {
    const docs = await queryAll('BalanceHistory', BALANCE_HISTORY_FIELDS, { desiredKeys: [] });
    const result = await deletePrivate(docs.map((d) => d.$id), 'deleteAllBalanceHistory');
    return result.saved.length;
  } catch (err) {
    console.error('deleteAllBalanceHistory error', err);
    captureException(asError(err));
    return 0;
  }
}

export async function deleteBalanceHistoryPage(
  userId: string,
  pageSize: number = 25
): Promise<{ deleted: number; hasMore: boolean }> {
  if (!isCloudKitAvailable()) return { deleted: 0, hasMore: false };

  const page = await queryPage('BalanceHistory', BALANCE_HISTORY_FIELDS, {
    limit: pageSize,
    desiredKeys: [],
  });
  if (page.docs.length === 0) return { deleted: 0, hasMore: false };

  const result = await deletePrivate(page.docs.map((d) => d.$id), 'deleteBalanceHistoryPage');
  if (result.failed.length > 0) {
    const failure = result.failed[0];
    const err = new Error(`deleteBalanceHistoryPage: ${failure.message}`);
    (err as any).code = failure.code;
    throw err;
  }
  return { deleted: result.saved.length, hasMore: page.cursor != null };
}

export async function countBalanceHistory(userId: string): Promise<number> {
  if (!isCloudKitAvailable()) return 0;
  try {
    // CloudKit has no server-side count — page through keys only
    const docs = await queryAll('BalanceHistory', BALANCE_HISTORY_FIELDS, { desiredKeys: [] });
    return docs.length;
  } catch (err) {
    console.error('countBalanceHistory error', err);
    return 0;
  }
}

// ============================================================
// Budget
// ============================================================

export async function getMonthlyBudget(userId: string): Promise<BudgetDoc> {
  const doc = await fetchOne('budget', BUDGET_FIELDS);
  if (doc) return { userId, ...doc };
  return { userId, monthlyBudget: 0, currency: 'EUR', budgetSource: 'manual' };
}

export async function updateMonthlyBudget(
  userId: string,
  monthlyBudget: number,
  currency: string = 'EUR',
  cycleType: 'first_working_day' | 'last_working_day' | 'specific_date' | 'last_friday' = 'first_working_day',
  cycleDay?: number,
  budgetSource: 'manual' | 'lastMonth' = 'manual',
  lastMonthReference?: string
) {
  const budgetData: Record<string, any> = { monthlyBudget, currency, cycleType, budgetSource };
  if (cycleType === 'specific_date' && cycleDay) {
    budgetData.cycleDay = cycleDay;
  }
  if (budgetSource === 'lastMonth' && lastMonthReference) {
    budgetData.lastMonthReference = lastMonthReference;
  } else if (budgetSource === 'manual') {
    budgetData.lastMonthReference = null;
  }
  return saveOne('Budget', 'budget', budgetData, BUDGET_FIELDS, 'changedKeys', 'updateMonthlyBudget');
}

// ============================================================
// Transactions
// ============================================================

function dateRangeFilters(startISO: string, endISO: string): Filter[] {
  return [
    { field: 'date', op: 'gte', value: filterValue('date', startISO) },
    { field: 'date', op: 'lte', value: filterValue('date', endISO) },
  ];
}

const DATE_DESC: Sort[] = [{ field: 'date', ascending: false }];

export async function getTransactionsForMonth(
  userId: string,
  year: number,
  monthIndex0: number
): Promise<TransactionDoc[]> {
  const start = new Date(Date.UTC(year, monthIndex0, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex0 + 1, 0, 23, 59, 59));
  const page = await queryPage('Transaction', TRANSACTION_FIELDS, {
    filters: dateRangeFilters(start.toISOString(), end.toISOString()),
    sorts: DATE_DESC,
    limit: 500,
  });
  return page.docs;
}

export async function getTransactionsInRange(
  userId: string,
  startISO: string,
  endISO: string
): Promise<TransactionDoc[]> {
  const page = await queryPage('Transaction', TRANSACTION_FIELDS, {
    filters: dateRangeFilters(startISO, endISO),
    sorts: DATE_DESC,
    limit: 500,
  });
  return page.docs;
}

export async function getTransactionsPaginated(
  userId: string,
  limit: number = 25,
  cursor?: string,
  filter?: TransactionFilter
): Promise<{ documents: TransactionDoc[]; hasMore: boolean; lastCursor?: string }> {
  const filters: Filter[] = [];
  // CloudKit's predicate subset has no OR / "is not null", so the 'hidden'
  // filter (matchedTransferId set OR isAnalyticsProtected) is applied client-side.
  const clientSideHidden = filter === 'hidden';
  if (filter === 'income' || filter === 'expense') {
    filters.push({ field: 'kind', op: 'eq', value: filterValue('string', filter) });
  } else if (filter && filter !== 'all' && filter !== 'hidden') {
    filters.push({ field: 'categoryId', op: 'eq', value: filterValue('string', filter) });
  }

  const page = await queryPage('Transaction', TRANSACTION_FIELDS, {
    filters,
    sorts: DATE_DESC,
    limit,
    cursor: cursor ?? null,
  });

  let docs = page.docs as TransactionDoc[];
  if (clientSideHidden) {
    docs = docs.filter((t: any) => t.matchedTransferId || t.isAnalyticsProtected);
  }
  return {
    documents: docs,
    hasMore: page.cursor != null,
    lastCursor: page.cursor ?? undefined,
  };
}

export async function getTransactionsInRangeAll(
  userId: string,
  startISO: string,
  endISO: string
): Promise<TransactionDoc[]> {
  return queryAll('Transaction', TRANSACTION_FIELDS, {
    filters: dateRangeFilters(startISO, endISO),
    sorts: DATE_DESC,
  });
}

export async function getTransactionsBySubscriptionId(subscriptionId: string): Promise<string[]> {
  const page = await queryPage('Transaction', TRANSACTION_FIELDS, {
    filters: [{ field: 'subscriptionId', op: 'eq', value: filterValue('string', subscriptionId) }],
    limit: 500,
    desiredKeys: [],
  });
  return page.docs.map((d) => d.$id);
}

export async function deleteAllTransactionsForUser(
  userId: string
): Promise<{ deleted: number; failed: number }> {
  const docs = await queryAll('Transaction', TRANSACTION_FIELDS, { desiredKeys: [] });
  const result = await deletePrivate(docs.map((d) => d.$id), 'deleteAllTransactionsForUser');
  return { deleted: result.saved.length, failed: result.failed.length };
}

export async function getAllTransactionsForUser(userId: string): Promise<TransactionDoc[]> {
  return queryAll('Transaction', TRANSACTION_FIELDS);
}

export async function getCategories(): Promise<CategoryDoc[]> {
  return CATEGORIES as unknown as CategoryDoc[];
}

export async function createTransaction(
  userId: string,
  title: string,
  subtitle: string | undefined,
  amount: number,
  kind: 'income' | 'expense',
  categoryId: string,
  date: string,
  currency: string = 'EUR',
  customId?: string,
  excludeFromAnalytics?: boolean,
  isAnalyticsProtected?: boolean,
  source?: 'revolut_import' | 'manual' | 'other_import',
  displayName?: string,
  account?: string,
  matchedTransferId?: string,
  hideMerchantIcon?: boolean,
  importBatchId?: string,
  importedAt?: string,
  originalAmount?: number,
  isSubscription?: boolean,
  subscriptionId?: string
) {
  const data: Record<string, any> = {
    title,
    subtitle: subtitle || '',
    amount,
    kind,
    categoryId,
    date,
    currency,
    displayName: displayName || title,
    excludeFromAnalytics,
    isAnalyticsProtected,
    source,
    account,
    matchedTransferId,
    hideMerchantIcon,
    importBatchId,
    importedAt,
    originalAmount,
    isSubscription,
    subscriptionId,
  };

  try {
    // allKeys: retrying a queued create with the same ID overwrites instead of failing
    return await saveOne('Transaction', customId || ID.unique(), data, TRANSACTION_FIELDS, 'allKeys', 'createTransaction');
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { operation: 'create_transaction', feature: 'transactions' },
      contexts: { transaction: { title, amount, kind, categoryId, userId } },
    });
    throw err;
  }
}

export async function getTransactionById(transactionId: string): Promise<any | null> {
  return fetchOne(transactionId, TRANSACTION_FIELDS);
}

export async function updateTransaction(
  transactionId: string,
  updates: {
    excludeFromAnalytics?: boolean;
    isAnalyticsProtected?: boolean;
    categoryId?: string;
    displayName?: string;
    matchedTransferId?: string;
    hideMerchantIcon?: boolean;
    isSubscription?: boolean;
    subscriptionId?: string;
  }
) {
  return updateTransactionFields(transactionId, updates);
}

/** Generic partial update — accepts any Transaction fields (title, amount, date, ...). */
export async function updateTransactionFields(transactionId: string, updates: Record<string, any>) {
  try {
    return await saveOne('Transaction', transactionId, updates, TRANSACTION_FIELDS, 'changedKeys', 'updateTransaction');
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { operation: 'update_transaction', feature: 'transactions' },
      contexts: { transaction: { transactionId, updates } },
    });
    throw err;
  }
}

export async function deleteTransaction(transactionId: string): Promise<void> {
  const result = await deletePrivate([transactionId], 'deleteTransaction');
  if (result.failed.length > 0) {
    throw new Error(result.failed[0].message);
  }
}

export async function createBulkTransactions(
  userId: string,
  transactions: Array<{
    id?: string;
    title: string;
    subtitle?: string;
    amount: number;
    kind: 'income' | 'expense';
    categoryId: string;
    date: string;
    currency: string;
    excludeFromAnalytics?: boolean;
    isAnalyticsProtected?: boolean;
    source?: 'revolut_import' | 'manual' | 'other_import';
    displayName?: string;
    account?: string;
    matchedTransferId?: string;
    importedAt?: string;
    originalAmount?: number;
    isSubscription?: boolean;
    subscriptionId?: string;
  }>,
  onProgress?: (current: number, total: number) => void,
  shouldCancel?: () => boolean,
  onBatchSuccess?: (indices: number[]) => Promise<void>
): Promise<BulkCreateResult> {
  const errors: BulkCreateResult['errors'] = [];
  const successfulIndices: number[] = [];
  let created = 0;
  // Native side chunks at CloudKit's 400/op limit; smaller JS chunks keep
  // progress reporting and cancellation responsive.
  const BATCH_SIZE = 100;

  try {
    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      if (shouldCancel?.()) break;
      const batch = transactions.slice(i, i + BATCH_SIZE);

      const recordNameToIndex = new Map<string, number>();
      const records: RecordInput[] = batch.map((tx, batchIndex) => {
        const recordName = tx.id || ID.unique();
        recordNameToIndex.set(recordName, i + batchIndex);
        return {
          recordType: 'Transaction',
          recordName,
          fields: encodeFields(
            {
              title: tx.title,
              subtitle: tx.subtitle || '',
              amount: tx.amount,
              kind: tx.kind,
              categoryId: tx.categoryId,
              date: tx.date,
              currency: tx.currency,
              displayName: tx.displayName || tx.title,
              excludeFromAnalytics: tx.excludeFromAnalytics,
              isAnalyticsProtected: tx.isAnalyticsProtected,
              source: tx.source,
              account: tx.account,
              matchedTransferId: tx.matchedTransferId,
              hideMerchantIcon: (tx as any).hideMerchantIcon,
              importBatchId: (tx as any).importBatchId,
              importedAt: tx.importedAt,
              originalAmount: tx.originalAmount,
              isSubscription: tx.isSubscription,
              subscriptionId: tx.subscriptionId,
            },
            TRANSACTION_FIELDS
          ),
        };
      });

      const result = await savePrivate(records, 'allKeys', 'createBulkTransactions');

      const batchSuccessfulIndices: number[] = [];
      for (const recordName of result.saved) {
        const index = recordNameToIndex.get(recordName);
        if (index !== undefined) {
          successfulIndices.push(index);
          batchSuccessfulIndices.push(index);
          created++;
        }
      }
      for (const failure of result.failed) {
        const index = recordNameToIndex.get(failure.recordName);
        const tx = index !== undefined ? transactions[index] : undefined;
        errors.push({ message: failure.message, title: tx?.title, date: tx?.date });
        console.error('Error creating transaction:', failure.message, tx?.title, tx?.date);
      }

      if (batchSuccessfulIndices.length > 0 && onBatchSuccess) {
        try {
          await onBatchSuccess(batchSuccessfulIndices);
        } catch (batchUpdateError) {
          console.error('Error updating queue after batch success:', batchUpdateError);
        }
      }
      onProgress?.(Math.min(i + BATCH_SIZE, transactions.length), transactions.length);
    }
  } catch (batchError: any) {
    const errorMessage = batchError?.message || 'Unknown error during batch processing';
    console.error('Error during batch transaction creation:', errorMessage);
    captureException(batchError instanceof Error ? batchError : new Error(errorMessage), {
      tags: { operation: 'bulk_transaction_create', feature: 'transactions' },
      contexts: { bulk: { errorMessage, transactionCount: transactions.length, userId } },
    });
    errors.push({ message: errorMessage });
  }

  return { created, failed: errors.length, errors, successfulIndices };
}

export async function getLastImportBatchId(userId: string): Promise<string | null> {
  try {
    // No "is not null" predicate in CloudKit — scan newest-first for a batch ID.
    let cursor: string | null = null;
    let scanned = 0;
    do {
      const page = await queryPage('Transaction', TRANSACTION_FIELDS, {
        sorts: [{ field: 'importedAt', ascending: false }],
        limit: 100,
        cursor,
        desiredKeys: ['importBatchId', 'importedAt'],
      });
      const withBatch = page.docs.find((d) => d.importBatchId);
      if (withBatch) return withBatch.importBatchId;
      cursor = page.cursor;
      scanned += page.docs.length;
    } while (cursor && scanned < 1000);
    return null;
  } catch (error) {
    console.error('Error fetching last import batch ID:', error);
    return null;
  }
}

export async function getTransactionsByBatchId(userId: string, batchId: string): Promise<TransactionDoc[]> {
  try {
    return await queryAll('Transaction', TRANSACTION_FIELDS, {
      filters: [{ field: 'importBatchId', op: 'eq', value: filterValue('string', batchId) }],
    });
  } catch (error) {
    console.error('Error fetching transactions by batch ID:', error);
    return [];
  }
}

export async function deleteTransactionsByBatchId(
  userId: string,
  batchId: string
): Promise<{ deleted: number; failed: number }> {
  try {
    const docs = await queryAll('Transaction', TRANSACTION_FIELDS, {
      filters: [{ field: 'importBatchId', op: 'eq', value: filterValue('string', batchId) }],
      desiredKeys: [],
    });
    const result = await deletePrivate(docs.map((d) => d.$id), 'deleteTransactionsByBatchId');
    return { deleted: result.saved.length, failed: result.failed.length };
  } catch (error) {
    console.error('Error deleting transactions by batch ID:', error);
    return { deleted: 0, failed: 0 };
  }
}

// ============================================================
// Account deletion
// ============================================================

export async function deleteUserAccount(userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    addBreadcrumb({ message: 'Starting account deletion', category: 'auth', data: { userId } });

    // The entire private dataset lives in one zone — one operation wipes it all
    await native().deleteZone(ZONE);
    zoneReady = null;

    // Delete this user's public-DB votes (tracked locally when cast)
    try {
      const raw = await AsyncStorage.getItem(MY_VOTE_RECORDS_KEY);
      const voteRecords: string[] = raw ? JSON.parse(raw) : [];
      if (voteRecords.length > 0) {
        await native().deleteRecords('public', null, voteRecords);
        await AsyncStorage.removeItem(MY_VOTE_RECORDS_KEY);
      }
    } catch (voteErr) {
      console.warn('Failed to delete public votes during account deletion:', voteErr);
    }

    addBreadcrumb({ message: 'Account deletion completed', category: 'auth', level: 'info' });
    return { success: true };
  } catch (err) {
    console.error('deleteUserAccount error:', err);
    captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { operation: 'delete_account', feature: 'auth' },
      contexts: { deletion: { userId } },
    });
    return { success: false, error: err instanceof Error ? err.message : 'Failed to delete account' };
  }
}

// ============================================================
// Account imports
// ============================================================

export async function saveAccountImport(
  userId: string,
  accountKey: string,
  accountName: string,
  provider: string
): Promise<void> {
  try {
    await saveOne(
      'AccountImport',
      `imp_${await shortHash(accountKey)}`,
      { accountKey, accountName, provider, lastImportDate: new Date().toISOString() },
      ACCOUNT_IMPORT_FIELDS,
      'allKeys',
      'saveAccountImport'
    );
  } catch (err) {
    console.error('saveAccountImport error:', err);
    captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { operation: 'save_account_import', feature: 'notifications' },
    });
    throw err;
  }
}

export async function getAccountImports(userId: string): Promise<AccountImportDoc[]> {
  try {
    const docs = await queryAll('AccountImport', ACCOUNT_IMPORT_FIELDS);
    return docs.map((doc) => ({
      userId,
      accountKey: doc.accountKey,
      accountName: doc.accountName,
      provider: doc.provider,
      lastImportDate: doc.lastImportDate,
      $createdAt: doc.$createdAt,
      $updatedAt: doc.$updatedAt,
    }));
  } catch (err) {
    console.error('getAccountImports error:', err);
    return [];
  }
}

// ============================================================
// User preferences
// ============================================================

export async function getUserPreferences(userId: string): Promise<UserPreferencesDoc | null> {
  try {
    const doc = await fetchOne('prefs', PREFERENCES_FIELDS);
    if (!doc) return null;
    let dismissedImportBanners: Record<string, string> = {};
    if (doc.dismissedImportBanners) {
      dismissedImportBanners =
        typeof doc.dismissedImportBanners === 'string'
          ? JSON.parse(doc.dismissedImportBanners)
          : doc.dismissedImportBanners;
    }
    return {
      userId,
      dismissedImportBanners,
      notificationsEnabled: doc.notificationsEnabled,
      $updatedAt: doc.$updatedAt,
    };
  } catch (err) {
    console.error('getUserPreferences error:', err);
    return null;
  }
}

export async function saveUserPreferences(
  userId: string,
  preferences: Partial<Omit<UserPreferencesDoc, 'userId' | '$updatedAt'>>
): Promise<void> {
  try {
    const payload: Record<string, unknown> = { ...preferences };
    if (payload.dismissedImportBanners && typeof payload.dismissedImportBanners === 'object') {
      payload.dismissedImportBanners = JSON.stringify(payload.dismissedImportBanners);
    }
    await saveOne('UserPreferences', 'prefs', payload, PREFERENCES_FIELDS, 'changedKeys', 'saveUserPreferences');
  } catch (err) {
    console.error('saveUserPreferences error:', err);
    captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { operation: 'save_user_preferences', feature: 'notifications' },
    });
    throw err;
  }
}

// ============================================================
// Subscriptions
// ============================================================

export async function getConfirmedSubscriptions(
  userId: string
): Promise<(SubscriptionDoc & { id: string })[]> {
  const docs = await queryAll('Subscription', SUBSCRIPTION_FIELDS, {
    sorts: [{ field: 'confirmedAt', ascending: false }],
  });
  return docs.map((d) => ({ ...d, userId, id: d.$id }));
}

export async function createSubscription(userId: string, data: Omit<SubscriptionDoc, 'userId'>) {
  return saveOne('Subscription', ID.unique(), data, SUBSCRIPTION_FIELDS, 'allKeys', 'createSubscription');
}

export async function updateSubscription(docId: string, updates: Partial<SubscriptionDoc>) {
  const { userId: _ignored, ...rest } = updates;
  return saveOne('Subscription', docId, rest, SUBSCRIPTION_FIELDS, 'changedKeys', 'updateSubscription');
}

export async function deleteSubscription(docId: string) {
  const result = await deletePrivate([docId], 'deleteSubscription');
  if (result.failed.length > 0) {
    throw new Error(result.failed[0].message);
  }
}

// ============================================================
// Migration support (Appwrite -> CloudKit, one-time per user)
// ============================================================

const MIGRATION_FIELDS: FieldTypes = {
  migratedAt: 'date',
  appwriteUserId: 'string',
  counts: 'string', // JSON string of per-collection counts
};

export type MigrationStateDoc = {
  migratedAt: string;
  appwriteUserId?: string;
  counts?: Record<string, number>;
};

export async function getMigrationState(): Promise<MigrationStateDoc | null> {
  const doc = await fetchOne('migration', MIGRATION_FIELDS);
  if (!doc) return null;
  return {
    migratedAt: doc.migratedAt,
    appwriteUserId: doc.appwriteUserId,
    counts: doc.counts ? JSON.parse(doc.counts) : undefined,
  };
}

export async function setMigrationState(appwriteUserId: string, counts: Record<string, number>): Promise<void> {
  await saveOne(
    'MigrationState',
    'migration',
    { migratedAt: new Date().toISOString(), appwriteUserId, counts: JSON.stringify(counts) },
    MIGRATION_FIELDS,
    'allKeys',
    'setMigrationState'
  );
}

/**
 * Writes a subscription with a recordName derived from its Appwrite id so a
 * re-run overwrites rather than duplicates. Returns the new CloudKit id, which
 * the migration uses to remap transactions' subscriptionId.
 */
export async function migrateSubscription(oldId: string, data: Omit<SubscriptionDoc, 'userId'>): Promise<string> {
  const recordName = `sub_${oldId}`;
  await saveOne('Subscription', recordName, data, SUBSCRIPTION_FIELDS, 'allKeys', 'migrateSubscription');
  return recordName;
}

// ============================================================
// Public DB: crowd-sourced merchant category/icon votes
// ============================================================

/**
 * One record per (voter, merchant): re-voting overwrites the voter's previous
 * choice (allKeys upsert on a deterministic recordName), so aggregation is a
 * simple count of records per option — no contended vote counters.
 */
export type PublicVote = {
  $id: string;
  merchantKey: string;
  merchantName?: string;
  categoryId?: string;
  iconUrl?: string;
  voterHash: string;
};

async function voterHash(): Promise<string> {
  return shortHash(await getCloudKitUserRecordName());
}

async function trackOwnVote(recordName: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(MY_VOTE_RECORDS_KEY);
    const records: string[] = raw ? JSON.parse(raw) : [];
    if (!records.includes(recordName)) {
      records.push(recordName);
      await AsyncStorage.setItem(MY_VOTE_RECORDS_KEY, JSON.stringify(records));
    }
  } catch {
    // best-effort bookkeeping for account deletion
  }
}

async function getAllVotes(recordType: 'MerchantVote' | 'IconVote'): Promise<PublicVote[]> {
  const all: PublicVote[] = [];
  let cursor: string | null = null;
  do {
    const res = await withRetry(
      () => native().queryRecords('public', null, recordType, { limit: 400, cursor }),
      `query ${recordType}`
    );
    all.push(...res.records.map((r) => decodeRecord(r, VOTE_FIELDS)));
    cursor = res.cursor;
  } while (cursor);
  return all;
}

async function castVote(
  recordType: 'MerchantVote' | 'IconVote',
  prefix: 'mv' | 'iv',
  merchantKey: string,
  merchantName: string,
  data: Record<string, any>
): Promise<void> {
  const voter = await voterHash();
  const recordName = `${prefix}_${voter}_${await shortHash(merchantKey)}`;
  const result = await withRetry(
    () =>
      native().saveRecords(
        'public',
        null,
        [
          {
            recordType,
            recordName,
            fields: encodeFields(
              { merchantKey, merchantName, voterHash: voter, updatedAt: new Date().toISOString(), ...data },
              VOTE_FIELDS
            ),
          },
        ],
        'allKeys'
      ),
    `cast ${recordType}`
  );
  if (result.failed.length > 0) {
    throw new Error(result.failed[0].message);
  }
  await trackOwnVote(recordName);
}

export async function getAllMerchantVotes(): Promise<PublicVote[]> {
  return getAllVotes('MerchantVote');
}

export async function castMerchantVote(
  merchantKey: string,
  merchantName: string,
  categoryId: string
): Promise<void> {
  return castVote('MerchantVote', 'mv', merchantKey, merchantName, { categoryId });
}

export async function getAllIconVotes(): Promise<PublicVote[]> {
  return getAllVotes('IconVote');
}

export async function castIconVote(
  merchantKey: string,
  merchantName: string,
  iconUrl: string
): Promise<void> {
  return castVote('IconVote', 'iv', merchantKey, merchantName, { iconUrl });
}
