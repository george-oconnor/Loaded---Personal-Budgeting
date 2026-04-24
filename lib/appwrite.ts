import { Account, Client, Databases, ID, Permission, Query, Role } from "appwrite";
import { addBreadcrumb, captureException } from "./sentry";

const endpoint = process.env.EXPO_PUBLIC_APPWRITE_ENDPOINT;
const projectId = process.env.EXPO_PUBLIC_APPWRITE_PROJECT_ID;
const databaseId = process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID;
// Appwrite now refers to 'Tables' in UI; SDK still uses collection IDs.
// Support both env names to avoid confusion.
const transactionsTableId =
  process.env.EXPO_PUBLIC_APPWRITE_TABLE_TRANSACTIONS ||
  process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_TRANSACTIONS;
const budgetsTableId =
  process.env.EXPO_PUBLIC_APPWRITE_TABLE_BUDGETS ||
  process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_BUDGETS;
const categoriesTableId =
  process.env.EXPO_PUBLIC_APPWRITE_TABLE_CATEGORIES ||
  process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_CATEGORIES;
const usersTableId =
  process.env.EXPO_PUBLIC_APPWRITE_TABLE_USERS ||
  process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_USERS;
const balancesTableId =
  process.env.EXPO_PUBLIC_APPWRITE_TABLE_BALANCES ||
  process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_BALANCES;
const accountImportsTableId =
  process.env.EXPO_PUBLIC_APPWRITE_TABLE_ACCOUNT_IMPORTS ||
  process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_ACCOUNT_IMPORTS;
const userPreferencesTableId =
  process.env.EXPO_PUBLIC_APPWRITE_TABLE_USER_PREFERENCES ||
  process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_USER_PREFERENCES;
const subscriptionsTableId =
  process.env.EXPO_PUBLIC_APPWRITE_TABLE_SUBSCRIPTIONS ||
  process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_SUBSCRIPTIONS;
const balanceHistoryTableId =
  process.env.EXPO_PUBLIC_APPWRITE_TABLE_BALANCE_HISTORY ||
  process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_BALANCE_HISTORY;

export const appwriteClient = new Client();
if (endpoint && projectId) {
  appwriteClient.setEndpoint(endpoint).setProject(projectId);
}

export const databases = new Databases(appwriteClient);
export const account = new Account(appwriteClient);

// Auth functions
export async function createAccount(email: string, password: string, name: string) {
  try {
    addBreadcrumb({ message: 'Creating account', category: 'auth', data: { email, name } });
    const result = await account.create(ID.unique(), email, password, name);
    addBreadcrumb({ message: 'Account created successfully', category: 'auth', level: 'info' });
    return result;
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { operation: 'create_account', feature: 'auth' },
      contexts: { auth: { email, name } }
    });
    throw err;
  }
}

export async function signIn(email: string, password: string) {
  try {
    addBreadcrumb({ message: 'Attempting sign in', category: 'auth', data: { email } });
    // Defensive: clear any stale session before creating a new one. Appwrite throws
    // "Creation of a session is prohibited when a session is active" otherwise.
    try {
      await account.deleteSession('current');
    } catch {
      // No existing session — ignore.
    }
    const result = await account.createEmailPasswordSession(email, password);
    addBreadcrumb({ message: 'Sign in successful', category: 'auth', level: 'info' });
    return result;
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { operation: 'sign_in', feature: 'auth' },
      contexts: { auth: { email } }
    });
    throw err;
  }
}

export async function signOut() {
  try {
    return await account.deleteSession("current");
  } catch (err) {
    console.error("signOut error:", err);
    throw err;
  }
}

export async function clearAllSessions() {
  try {
    return await account.deleteSessions();
  } catch (err) {
    console.error("clearAllSessions error:", err);
    throw err;
  }
}

export async function getCurrentUser() {
  try {
    const user = await account.get();
    // Verify user is valid by checking their ID
    if (!user || !user.$id) {
      return null;
    }
    return user;
  } catch (err) {
    // Appwrite throws for guests with no session; treat that as "no user" without logging an error
    const code = (err as any)?.code;
    if (code === 401 || (err as any)?.message?.includes("missing scopes")) {
      return null;
    }

    console.error("getCurrentUser error:", err);
    return null;
  }
}

export async function getCurrentSession() {
  try {
    return await account.getSession("current");
  } catch {
    return null;
  }
}

// Password Recovery functions
export async function requestPasswordReset(email: string, resetUrl: string) {
  return await account.createRecovery(email, resetUrl);
}

export async function completePasswordReset(userId: string, secret: string, newPassword: string) {
  return await account.updateRecovery(userId, secret, newPassword);
}

export type UserDoc = {
  userId: string; // Appwrite auth user ID
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
  updatedAt?: string;
  lastLoginTime?: string;
};

export async function createUserProfile(
  userId: string,
  email: string,
  firstName: string,
  lastName: string
) {
  if (!databaseId || !usersTableId) throw new Error("Appwrite env not configured");
  
  return await databases.createDocument(
    databaseId,
    usersTableId,
    userId,
    {
      userId,
      email,
      firstname: firstName,
      lastname: lastName,
    },
    [
      Permission.read(Role.user(userId)),
      Permission.update(Role.user(userId)),
      Permission.delete(Role.user(userId)),
    ]
  );
}

export async function getUserProfile(userId: string) {
  if (!databaseId || !usersTableId) throw new Error("Appwrite env not configured");
  try {
    const doc = await databases.getDocument(databaseId, usersTableId, userId);
    const profile: UserDoc = {
      userId: doc.userId,
      email: doc.email,
      firstName: doc.firstname,
      lastName: doc.lastname,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      lastLoginTime: doc.lastLoginTime,
    };
    console.log("getUserProfile - fetched:", { 
      userId, 
      hasProfile: !!profile,
      firstName: profile.firstName,
      lastName: profile.lastName
    });
    return profile;
  } catch (err) {
    console.error("getUserProfile - error:", userId, err);
    return null;
  }
}

export async function updateUserProfile(
  userId: string,
  data: Partial<Omit<UserDoc, "userId" | "createdAt">>
) {
  if (!databaseId || !usersTableId) throw new Error("Appwrite env not configured");
  return await databases.updateDocument(databaseId, usersTableId, userId, {
    ...data,
    updatedAt: new Date().toISOString(),
  });
}

export type BudgetDoc = {
  userId: string;
  monthlyBudget: number;
  currency: string;
  cycleType?: "first_working_day" | "last_working_day" | "specific_date" | "last_friday"; // When budget cycle starts/ends
  cycleDay?: number; // For specific_date: 1-31
  budgetSource?: "manual" | "lastMonth";
  lastMonthReference?: string;
};

export type AccountImportDoc = {
  userId: string;
  accountKey: string;
  accountName: string;
  provider: string; // 'revolut' | 'aib'
  lastImportDate: string; // ISO timestamp
  $createdAt?: string;
  $updatedAt?: string;
};

export type UserPreferencesDoc = {
  userId: string;
  dismissedImportBanners?: Record<string, string>; // accountKey -> lastImportDate at dismissal
  notificationsEnabled?: boolean; // User's notification preference
  $updatedAt?: string;
};

export type TransactionDoc = {
  userId: string;
  title: string;
  subtitle?: string;
  amount: number; // negative for expenses, positive for income
  kind: "income" | "expense";
  categoryId: string;
  date: string; // ISO timestamp
  account?: string; // Which account this transaction relates to
  matchedTransferId?: string; // Linked transaction for internal transfers
  hideMerchantIcon?: boolean; // When true, use category icon instead of merchant icon
  importedAt?: string; // ISO timestamp of when the transaction was imported
  originalAmount?: number; // The amount at the time of import, used for duplicate detection
};

export type CategoryDoc = {
  name: string;
  slug?: string;
  color?: string;
  icon?: string;
};

export type AccountBalanceDoc = {
  userId: string;
  accountKey: string; // stable key for the account (provider + type + currency + name slug)
  accountName: string;
  accountType: string; // current | pocket | vault | savings
  provider?: string; // revolut, aib, etc.
  currency: string;
  balance: number;
  lastUpdated: string;
};

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
  if (!databaseId || !balancesTableId) throw new Error("Appwrite env not configured");

  try {
    const res = await databases.listDocuments(databaseId, balancesTableId, [
      Query.equal("userId", userId),
      Query.equal("accountKey", data.accountKey),
      Query.limit(1),
    ]);

    const doc = res.documents?.[0];
    const payload = {
      userId,
      accountKey: data.accountKey,
      accountName: data.accountName,
      accountType: data.accountType,
      provider: data.provider,
      currency: data.currency,
      balance: data.balance,
      lastUpdated: data.lastUpdated || new Date().toISOString(),
    };

    if (doc) {
      return await databases.updateDocument(databaseId, balancesTableId, doc.$id, payload);
    }

    return await databases.createDocument(
      databaseId,
      balancesTableId,
      ID.unique(),
      payload,
      [
        Permission.read(Role.user(userId)),
        Permission.update(Role.user(userId)),
        Permission.delete(Role.user(userId)),
      ]
    );
  } catch (err) {
    console.error("upsertAccountBalance error", err);
    captureException(err);
    throw err;
  }
}

export async function getAccountBalancesFromAppwrite(userId: string) {
  if (!databaseId || !balancesTableId) throw new Error("Appwrite env not configured");

  try {
    const res = await databases.listDocuments(databaseId, balancesTableId, [
      Query.equal("userId", userId),
    ]);

    return res.documents.map((doc: any) => ({
      accountKey: doc.accountKey,
      accountName: doc.accountName,
      accountType: doc.accountType,
      provider: doc.provider,
      currency: doc.currency,
      balance: doc.balance,
      lastUpdated: doc.lastUpdated,
    }));
  } catch (err) {
    console.error("getAccountBalancesFromAppwrite error", err);
    captureException(err);
    throw err;
  }
}

export async function deleteAccountBalanceDoc(userId: string, accountKey: string) {
  if (!databaseId || !balancesTableId) throw new Error("Appwrite env not configured");

  try {
    const res = await databases.listDocuments(databaseId, balancesTableId, [
      Query.equal("userId", userId),
      Query.equal("accountKey", accountKey),
      Query.limit(1),
    ]);

    const doc = res.documents?.[0];
    if (!doc) {
      return { deleted: false, reason: "not-found" } as const;
    }

    await databases.deleteDocument(databaseId, balancesTableId, doc.$id);
    return { deleted: true } as const;
  } catch (err) {
    console.error("deleteAccountBalanceDoc error", err);
    captureException(err);
    throw err;
  }
}

// Save balance snapshots by storing current balance as previousBalance
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
  if (!databaseId || !balancesTableId) throw new Error("Appwrite env not configured");

  try {
    const snapshotTimestamp = new Date().toISOString();
    const { runThrottled } = await import('./appwriteThrottle');

    let failed = 0;
    await runThrottled(
      balances,
      async (balance) => {
        // Find the existing balance record
        const res = await databases.listDocuments(databaseId!, balancesTableId!, [
          Query.equal("userId", userId),
          Query.equal("accountKey", balance.accountKey),
          Query.limit(1),
        ]);

        const doc = res.documents?.[0];
        if (doc) {
          await databases.updateDocument(databaseId!, balancesTableId!, doc.$id, {
            previousBalance: balance.balance,
            previousBalanceTimestamp: snapshotTimestamp,
            importBatchId: importBatchId,
          });
        }
      },
      {
        chunkSize: 3,
        chunkDelayMs: 600,
        maxRetries: 5,
        label: 'saveBalanceSnapshotToAppwrite',
        onError: (err, balance) => {
          failed++;
          console.error(
            `saveBalanceSnapshotToAppwrite: failed to snapshot ${balance.accountKey}`,
            err
          );
        },
      }
    );

    if (failed > 0) {
      console.warn(
        `Balance snapshot completed with ${failed}/${balances.length} failures (undo may be partial)`
      );
    } else {
      console.log("Balance snapshot saved to Appwrite");
    }
  } catch (err) {
    console.error("Error saving balance snapshot to Appwrite:", err);
    captureException(err);
    throw err;
  }
}

// Restore balances from previousBalance field for a specific import batch
export async function restoreBalancesFromSnapshot(userId: string, importBatchId: string): Promise<boolean> {
  if (!databaseId || !balancesTableId) throw new Error("Appwrite env not configured");

  try {
    const res = await databases.listDocuments(databaseId, balancesTableId, [
      Query.equal("userId", userId),
      Query.equal("importBatchId", importBatchId),
    ]);

    const balances = res.documents || [];
    if (balances.length === 0) {
      console.warn("No balances found to restore for batch", importBatchId);
      return false;
    }

    // Restore each balance from previousBalance
    let restored = 0;
    for (const doc of balances) {
      if (doc.previousBalance !== null && doc.previousBalance !== undefined) {
        await databases.updateDocument(databaseId, balancesTableId, doc.$id, {
          balance: doc.previousBalance,
          lastUpdated: new Date().toISOString(),
          previousBalance: null,
          previousBalanceTimestamp: null,
          importBatchId: null,
        });
        restored++;
      }
    }

    console.log(`Restored ${restored} balance(s) from snapshot`);
    return restored > 0;
  } catch (err) {
    console.error("Error restoring balances from snapshot:", err);
    captureException(err);
    return false;
  }
}

// ============================================================
// Balance History (daily account balance snapshots)
// ============================================================

export type BalanceHistoryDoc = {
  userId: string;
  accountKey: string;
  date: string; // YYYY-MM-DD (UTC)
  balance: number; // cents
  currency: string;
  accountName?: string;
  provider?: string;
  source?: 'import' | 'manual' | 'seed';
  importBatchId?: string;
};

export function isBalanceHistoryConfigured(): boolean {
  return Boolean(databaseId && balanceHistoryTableId);
}

export async function upsertBalanceHistoryEntries(
  userId: string,
  entries: BalanceHistoryDoc[]
): Promise<void> {
  if (!databaseId || !balanceHistoryTableId) {
    return; // No-op when not configured
  }
  if (!entries.length) return;

  // Group entries by accountKey so we can fetch existing rows in fewer queries.
  const byAccount = new Map<string, BalanceHistoryDoc[]>();
  for (const e of entries) {
    const list = byAccount.get(e.accountKey) || [];
    list.push(e);
    byAccount.set(e.accountKey, list);
  }

  for (const [accountKey, list] of byAccount) {
    // Compute the date range for this account's entries
    const dates = list.map((e) => e.date).sort();
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];

    // Fetch existing rows in this range for this account
    const existingByDate = new Map<string, any>();
    let cursor: string | undefined;
    while (true) {
      const queries: any[] = [
        Query.equal("userId", userId),
        Query.equal("accountKey", accountKey),
        Query.greaterThanEqual("date", minDate),
        Query.lessThanEqual("date", maxDate),
        Query.limit(500),
      ];
      if (cursor) queries.push(Query.cursorAfter(cursor));
      const res = await databases.listDocuments(databaseId, balanceHistoryTableId, queries);
      for (const d of res.documents) existingByDate.set((d as any).date, d);
      if (res.documents.length < 500) break;
      cursor = res.documents[res.documents.length - 1].$id;
    }

    // Upsert each entry
    for (const entry of list) {
      const existing = existingByDate.get(entry.date);
      const payload: any = {
        userId,
        accountKey: entry.accountKey,
        date: entry.date,
        balance: entry.balance,
        currency: entry.currency,
        accountName: entry.accountName,
        provider: entry.provider,
        source: entry.source || 'import',
        importBatchId: entry.importBatchId,
      };
      try {
        if (existing) {
          await databases.updateDocument(
            databaseId,
            balanceHistoryTableId,
            existing.$id,
            payload
          );
        } else {
          await databases.createDocument(
            databaseId,
            balanceHistoryTableId,
            ID.unique(),
            payload,
            [
              Permission.read(Role.user(userId)),
              Permission.update(Role.user(userId)),
              Permission.delete(Role.user(userId)),
            ]
          );
        }
      } catch (err) {
        // Rethrow rate-limit errors so the caller (background flush queue) can
        // back off and retry the remaining entries instead of silently dropping them.
        const msg = String((err as any)?.message || err || '').toLowerCase();
        const code = Number((err as any)?.code);
        if (code === 429 || msg.includes('rate limit') || msg.includes('too many requests')) {
          throw err;
        }
        console.error('upsertBalanceHistoryEntries entry failed', { accountKey, date: entry.date, err });
      }
    }
  }
}

export async function getBalanceHistory(
  userId: string,
  options: { startDate?: string; endDate?: string; accountKeys?: string[] } = {}
): Promise<BalanceHistoryDoc[]> {
  if (!databaseId || !balanceHistoryTableId) return [];

  const all: BalanceHistoryDoc[] = [];
  const limit = 500;
  let cursor: string | undefined;

  while (true) {
    const queries: any[] = [Query.equal("userId", userId)];
    if (options.startDate) queries.push(Query.greaterThanEqual("date", options.startDate));
    if (options.endDate) queries.push(Query.lessThanEqual("date", options.endDate));
    if (options.accountKeys && options.accountKeys.length > 0) {
      queries.push(Query.equal("accountKey", options.accountKeys));
    }
    queries.push(Query.orderAsc("date"));
    queries.push(Query.limit(limit));
    if (cursor) queries.push(Query.cursorAfter(cursor));

    try {
      const res = await databases.listDocuments(databaseId, balanceHistoryTableId, queries);
      for (const d of res.documents) {
        const doc = d as any;
        all.push({
          userId: doc.userId,
          accountKey: doc.accountKey,
          date: doc.date,
          balance: doc.balance,
          currency: doc.currency,
          accountName: doc.accountName,
          provider: doc.provider,
          source: doc.source,
          importBatchId: doc.importBatchId,
        });
      }
      if (res.documents.length < limit) break;
      cursor = res.documents[res.documents.length - 1].$id;
    } catch (err) {
      console.error("getBalanceHistory error", err);
      captureException(err);
      break;
    }
  }

  return all;
}

export async function deleteBalanceHistoryByBatch(
  userId: string,
  importBatchId: string
): Promise<number> {
  if (!databaseId || !balanceHistoryTableId) return 0;

  let deleted = 0;
  try {
    while (true) {
      const res = await databases.listDocuments(databaseId, balanceHistoryTableId, [
        Query.equal("userId", userId),
        Query.equal("importBatchId", importBatchId),
        Query.limit(100),
      ]);
      if (res.documents.length === 0) break;
      for (const doc of res.documents) {
        try {
          await databases.deleteDocument(databaseId, balanceHistoryTableId, doc.$id);
          deleted++;
        } catch (err) {
          console.error("deleteBalanceHistoryByBatch entry failed", err);
        }
      }
      if (res.documents.length < 100) break;
    }
  } catch (err) {
    console.error("deleteBalanceHistoryByBatch error", err);
    captureException(err);
  }
  return deleted;
}

export async function deleteAllBalanceHistory(userId: string): Promise<number> {
  if (!databaseId || !balanceHistoryTableId) return 0;

  let deleted = 0;
  try {
    while (true) {
      const res = await databases.listDocuments(databaseId, balanceHistoryTableId, [
        Query.equal("userId", userId),
        Query.limit(100),
      ]);
      if (res.documents.length === 0) break;
      for (const doc of res.documents) {
        try {
          await databases.deleteDocument(databaseId, balanceHistoryTableId, doc.$id);
          deleted++;
        } catch (err) {
          console.error("deleteAllBalanceHistory entry failed", err);
        }
      }
      if (res.documents.length < 100) break;
    }
  } catch (err) {
    console.error("deleteAllBalanceHistory error", err);
    captureException(err);
  }
  return deleted;
}

/**
 * Delete a single page of balance-history docs for a user. Used by the
 * background wipe processor so we can throttle between pages and react to
 * rate limits between calls.
 *
 * Throws on rate-limit / network errors so callers can apply backoff.
 * Returns the number deleted in this page and whether more docs likely remain.
 */
export async function deleteBalanceHistoryPage(
  userId: string,
  pageSize: number = 25
): Promise<{ deleted: number; hasMore: boolean }> {
  if (!databaseId || !balanceHistoryTableId) return { deleted: 0, hasMore: false };

  const res = await databases.listDocuments(databaseId, balanceHistoryTableId, [
    Query.equal("userId", userId),
    Query.limit(pageSize),
  ]);

  if (res.documents.length === 0) return { deleted: 0, hasMore: false };

  let deleted = 0;
  for (const doc of res.documents) {
    await databases.deleteDocument(databaseId, balanceHistoryTableId, doc.$id);
    deleted++;
  }

  return { deleted, hasMore: res.documents.length >= pageSize };
}

/**
 * Cheap count of remote balance-history docs for a user. Returns 0 when the
 * collection isn't configured.
 */
export async function countBalanceHistory(userId: string): Promise<number> {
  if (!databaseId || !balanceHistoryTableId) return 0;
  try {
    const res = await databases.listDocuments(databaseId, balanceHistoryTableId, [
      Query.equal("userId", userId),
      Query.limit(1),
    ]);
    return (res as any).total ?? res.documents.length;
  } catch (err) {
    console.error("countBalanceHistory error", err);
    return 0;
  }
}

export async function getMonthlyBudget(userId: string) {
  if (!databaseId || !budgetsTableId) throw new Error("Appwrite env not configured");
  const res = await databases.listDocuments(databaseId, budgetsTableId, [
    Query.equal("userId", userId),
  ]);
  const doc = res.documents?.[0] as unknown as BudgetDoc | undefined;
  return (
    doc ?? {
      userId,
      monthlyBudget: 0,
      currency: "EUR",
      budgetSource: "manual",
    }
  );
}

export async function updateMonthlyBudget(
  userId: string,
  monthlyBudget: number,
  currency: string = "EUR",
  cycleType: "first_working_day" | "last_working_day" | "specific_date" | "last_friday" = "first_working_day",
  cycleDay?: number,
  budgetSource: "manual" | "lastMonth" = "manual",
  lastMonthReference?: string
) {
  if (!databaseId || !budgetsTableId) throw new Error("Appwrite env not configured");
  
  // Check if budget doc exists
  const res = await databases.listDocuments(databaseId, budgetsTableId, [
    Query.equal("userId", userId),
  ]);
  const existingDoc = res.documents?.[0] as any;
  
  const budgetData: any = {
    monthlyBudget,
    currency,
    cycleType,
    budgetSource,
  };
  
  // Only add cycleDay if it's a specific_date type
  if (cycleType === "specific_date" && cycleDay) {
    budgetData.cycleDay = cycleDay;
  }

  if (budgetSource === "lastMonth" && lastMonthReference) {
    budgetData.lastMonthReference = lastMonthReference;
  } else if (budgetSource === "manual") {
    budgetData.lastMonthReference = null;
  }
  
  if (existingDoc) {
    // Update existing
    return await databases.updateDocument(databaseId, budgetsTableId, existingDoc.$id, budgetData);
  } else {
    // Create new
    return await databases.createDocument(
      databaseId,
      budgetsTableId,
      ID.unique(),
      {
        userId,
        ...budgetData,
      },
      [
        Permission.read(Role.user(userId)),
        Permission.update(Role.user(userId)),
        Permission.delete(Role.user(userId)),
      ]
    );
  }
}

export async function getTransactionsForMonth(userId: string, year: number, monthIndex0: number) {
  if (!databaseId || !transactionsTableId) throw new Error("Appwrite env not configured");
  const start = new Date(Date.UTC(year, monthIndex0, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex0 + 1, 0, 23, 59, 59));
  const res = await databases.listDocuments(databaseId, transactionsTableId, [
    Query.equal("userId", userId),
    Query.greaterThanEqual("date", start.toISOString()),
    Query.lessThanEqual("date", end.toISOString()),
    Query.limit(500),
    Query.orderDesc("date"),
  ]);
  return res.documents as unknown as TransactionDoc[];
}

export async function getTransactionsInRange(userId: string, startISO: string, endISO: string) {
  if (!databaseId || !transactionsTableId) throw new Error("Appwrite env not configured");
  const res = await databases.listDocuments(databaseId, transactionsTableId, [
    Query.equal("userId", userId),
    Query.greaterThanEqual("date", startISO),
    Query.lessThanEqual("date", endISO),
    Query.limit(500),
    Query.orderDesc("date"),
  ]);
  return res.documents as unknown as TransactionDoc[];
}

// Filter type for paginated transactions
export type TransactionFilter = 'all' | 'income' | 'expense' | 'hidden' | string;

// Paginated transaction fetching for infinite scroll
export async function getTransactionsPaginated(
  userId: string, 
  limit: number = 25, 
  cursor?: string,
  filter?: TransactionFilter
): Promise<{ documents: TransactionDoc[]; hasMore: boolean; lastCursor?: string }> {
  if (!databaseId || !transactionsTableId) throw new Error("Appwrite env not configured");
  
  const queries: any[] = [
    Query.equal("userId", userId),
    Query.orderDesc("date"),
  ];

  // Apply server-side filtering based on filter type
  // For "hidden" filter, we need to fetch transactions that are auto-flagged transfers
  if (filter === 'hidden') {
    // Hidden = auto-flagged transfers (has matchedTransferId OR isAnalyticsProtected)
    // Use OR query to get both types
    queries.push(Query.or([
      Query.isNotNull("matchedTransferId"),
      Query.equal("isAnalyticsProtected", true),
    ]));
  } else if (filter === 'income') {
    queries.push(Query.equal("kind", "income"));
  } else if (filter === 'expense') {
    queries.push(Query.equal("kind", "expense"));
  } else if (filter && filter !== 'all') {
    // Category filter
    queries.push(Query.equal("categoryId", filter));
  }
  // For 'all' and other filters, client-side filtering will exclude hidden transactions

  queries.push(Query.limit(limit));

  if (cursor) {
    queries.push(Query.cursorAfter(cursor));
  }

  const res = await databases.listDocuments(databaseId, transactionsTableId, queries);
  const docs = res.documents as unknown as TransactionDoc[];
  
  return {
    documents: docs,
    hasMore: docs.length === limit,
    lastCursor: docs.length > 0 ? docs[docs.length - 1].$id : undefined,
  };
}

// Fetch all transactions in range with pagination to avoid missing duplicates
export async function getTransactionsInRangeAll(userId: string, startISO: string, endISO: string) {
  if (!databaseId || !transactionsTableId) throw new Error("Appwrite env not configured");

  const all: any[] = [];
  const limit = 500;
  let cursor: string | undefined;

  while (true) {
    const queries: any[] = [
      Query.equal("userId", userId),
      Query.greaterThanEqual("date", startISO),
      Query.lessThanEqual("date", endISO),
      Query.limit(limit),
      Query.orderDesc("date"),
    ];

    if (cursor) {
      queries.push(Query.cursorAfter(cursor));
    }

    const res = await databases.listDocuments(databaseId, transactionsTableId, queries);
    const docs = res.documents || [];
    all.push(...docs);

    if (docs.length < limit) break;
    cursor = docs[docs.length - 1]?.$id;
    if (!cursor) break;
  }

  return all as unknown as TransactionDoc[];
}

export async function getTransactionsBySubscriptionId(subscriptionId: string): Promise<string[]> {
  if (!databaseId || !transactionsTableId) throw new Error("Appwrite env not configured");

  const res = await databases.listDocuments(databaseId, transactionsTableId, [
    Query.equal("subscriptionId", subscriptionId),
    Query.limit(500),
  ]);
  return (res.documents || []).map((d: any) => d.$id);
}

// Delete all transactions for a user
export async function deleteAllTransactionsForUser(userId: string): Promise<{ deleted: number; failed: number }> {
  if (!databaseId || !transactionsTableId) throw new Error("Appwrite env not configured");

  let deleted = 0;
  let failed = 0;
  const limit = 500;
  let cursor: string | undefined;

  // Fetch and delete in batches
  while (true) {
    const queries: any[] = [
      Query.equal("userId", userId),
      Query.limit(limit),
    ];

    if (cursor) {
      queries.push(Query.cursorAfter(cursor));
    }

    const res = await databases.listDocuments(databaseId, transactionsTableId, queries);
    const docs = res.documents || [];
    
    if (docs.length === 0) break;

    // Delete each transaction
    for (const doc of docs) {
      try {
        await databases.deleteDocument(databaseId, transactionsTableId, doc.$id);
        deleted++;
      } catch (error) {
        console.error(`Failed to delete transaction ${doc.$id}:`, error);
        failed++;
      }
    }

    if (docs.length < limit) break;
    cursor = docs[docs.length - 1]?.$id;
  }

  return { deleted, failed };
}

// Fetch every transaction for a user (paginated) for global dedupe comparisons
export async function getAllTransactionsForUser(userId: string) {
  if (!databaseId || !transactionsTableId) throw new Error("Appwrite env not configured");

  const all: any[] = [];
  const limit = 500;
  let cursor: string | undefined;

  while (true) {
    const queries: any[] = [
      Query.equal("userId", userId),
      Query.orderAsc("$id"),
      Query.limit(limit),
    ];

    if (cursor) {
      queries.push(Query.cursorAfter(cursor));
    }

    const res = await databases.listDocuments(databaseId, transactionsTableId, queries);
    const docs = res.documents || [];
    all.push(...docs);

    if (docs.length < limit) break;
    cursor = docs[docs.length - 1]?.$id;
    if (!cursor) break;
  }

  return all as unknown as TransactionDoc[];
}

export async function getCategories() {
  if (!databaseId || !categoriesTableId) throw new Error("Appwrite env not configured");
  const res = await databases.listDocuments(databaseId, categoriesTableId, []);
  return res.documents as unknown as CategoryDoc[];
}

export async function createTransaction(
  userId: string,
  title: string,
  subtitle: string | undefined,
  amount: number,
  kind: "income" | "expense",
  categoryId: string,
  date: string,
  currency: string = 'EUR',
  customId?: string, // Optional custom ID to prevent duplicates
  excludeFromAnalytics?: boolean,
  isAnalyticsProtected?: boolean,
  source?: "revolut_import" | "manual" | "other_import",
  displayName?: string, // How the transaction appears to the user; defaults to title if not provided
  account?: string, // Which account this transaction relates to
  matchedTransferId?: string, // Linked transaction for internal transfers
  hideMerchantIcon?: boolean, // When true, use category icon instead of merchant icon
  importBatchId?: string, // Unique identifier for the import batch
  importedAt?: string, // ISO timestamp of when the transaction was imported
  originalAmount?: number, // The amount at the time of import, used for duplicate detection
  isSubscription?: boolean,
  subscriptionId?: string
) {
  if (!databaseId || !transactionsTableId) throw new Error("Appwrite env not configured");
  
  const data: any = {
    userId,
    title,
    subtitle: subtitle || "",
    amount,
    kind,
    categoryId,
    date,
    currency,
    displayName: displayName || title, // Always ensure displayName is set; default to title if missing
  };
  
  if (excludeFromAnalytics !== undefined) {
    data.excludeFromAnalytics = excludeFromAnalytics;
  }
  
  if (isAnalyticsProtected !== undefined) {
    data.isAnalyticsProtected = isAnalyticsProtected;
  }
  
  if (source !== undefined) {
    data.source = source;
  }
  
  if (account !== undefined) {
    data.account = account;
  }

  if (matchedTransferId !== undefined) {
    data.matchedTransferId = matchedTransferId;
  }

  if (hideMerchantIcon !== undefined) {
    data.hideMerchantIcon = hideMerchantIcon;
  }

  if (importBatchId !== undefined) {
    data.importBatchId = importBatchId;
  }

  if (importedAt !== undefined) {
    data.importedAt = importedAt;
  }

  if (originalAmount !== undefined) {
    data.originalAmount = originalAmount;
  }

  if (isSubscription !== undefined) {
    data.isSubscription = isSubscription;
  }

  if (subscriptionId !== undefined) {
    data.subscriptionId = subscriptionId;
  }
  
  try {
    return await databases.createDocument(
      databaseId, 
      transactionsTableId, 
      customId || ID.unique(), // Use custom ID if provided, otherwise generate
      data,
      [
        Permission.read(Role.user(userId)),
        Permission.update(Role.user(userId)),
        Permission.delete(Role.user(userId)),
      ]
    );
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { operation: 'create_transaction', feature: 'transactions' },
      contexts: { transaction: { title, amount, kind, categoryId, userId } }
    });
    throw err;
  }
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
  if (!databaseId || !transactionsTableId) throw new Error("Appwrite env not configured");
  
  const data: any = {};
  
  if (updates.excludeFromAnalytics !== undefined) {
    data.excludeFromAnalytics = updates.excludeFromAnalytics;
  }
  
  if (updates.isAnalyticsProtected !== undefined) {
    data.isAnalyticsProtected = updates.isAnalyticsProtected;
  }
  
  if (updates.categoryId !== undefined) {
    data.categoryId = updates.categoryId;
  }
  
  if (updates.displayName !== undefined) {
    data.displayName = updates.displayName;
  }

  if (updates.matchedTransferId !== undefined) {
    data.matchedTransferId = updates.matchedTransferId;
  }

  if (updates.hideMerchantIcon !== undefined) {
    data.hideMerchantIcon = updates.hideMerchantIcon;
  }

  if (updates.isSubscription !== undefined) {
    data.isSubscription = updates.isSubscription;
  }

  if (updates.subscriptionId !== undefined) {
    data.subscriptionId = updates.subscriptionId;
  }
  
  try {
    return await databases.updateDocument(
      databaseId,
      transactionsTableId,
      transactionId,
      data
    );
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { operation: 'update_transaction', feature: 'transactions' },
      contexts: { transaction: { transactionId, updates } }
    });
    throw err;
  }
}

export type BulkCreateResult = {
  created: number;
  failed: number;
  errors: Array<{ message: string; title?: string; date?: string }>;
  successfulIndices?: number[]; // Indices of successfully created transactions
};

export async function createBulkTransactions(
  userId: string,
  transactions: Array<{
    id?: string; // Queue transaction ID for duplicate prevention
    title: string;
    subtitle?: string;
    amount: number;
    kind: "income" | "expense";
    categoryId: string;
    date: string;
    currency: string;
    excludeFromAnalytics?: boolean;
    isAnalyticsProtected?: boolean;
    source?: "revolut_import" | "manual" | "other_import";
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
  onBatchSuccess?: (indices: number[]) => Promise<void>,
): Promise<BulkCreateResult> {
  if (!databaseId || !transactionsTableId) throw new Error("Appwrite env not configured");
  
  const errors: BulkCreateResult["errors"] = [];
  const successfulIndices: number[] = [];
  let created = 0;
  const BATCH_SIZE = 2; // Process 2 transactions at a time to avoid rate limits
  const DELAY_MS = 2000; // 2 second delay between batches
  
  try {
    for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
      if (shouldCancel?.()) {
        break;
      }
      const batch = transactions.slice(i, i + BATCH_SIZE);
      
      // Process batch in parallel
      const batchPromises = batch.map(async (tx, batchIndex) => {
        if (shouldCancel?.()) return null;
        try {
          const res = await createTransaction(
            userId,
            tx.title,
            tx.subtitle,
            tx.amount,
            tx.kind,
            tx.categoryId,
            tx.date,
            tx.currency,
            tx.id, // Pass the queue transaction ID to prevent duplicates
            tx.excludeFromAnalytics,
            tx.isAnalyticsProtected,
            tx.source,
            tx.displayName,
            tx.account,
            tx.matchedTransferId,
            (tx as any).hideMerchantIcon,
            (tx as any).importBatchId,
            tx.importedAt,
            tx.originalAmount,
            tx.isSubscription,
            tx.subscriptionId
          );
          return { success: true, index: i + batchIndex };
        } catch (err: any) {
          const message = err?.message || "Unknown error";
          
          // If it's a duplicate error, treat it as success (already exists)
          if (message.includes('Document with the requested ID already exists') || 
              message.includes('already exists')) {
            return { success: true, index: i + batchIndex };
          }
          
          errors.push({ message, title: tx.title, date: tx.date });
          console.error("Error creating transaction:", message, tx.title, tx.date);
          return null;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      const successCount = batchResults.filter(r => r !== null).length;
      created += successCount;
      
      // Track which transactions succeeded
      const batchSuccessfulIndices: number[] = [];
      batchResults.forEach(result => {
        if (result?.success) {
          successfulIndices.push(result.index);
          batchSuccessfulIndices.push(result.index);
        }
      });
      
      // Immediately notify of successful batch so queue can be updated
      if (batchSuccessfulIndices.length > 0 && onBatchSuccess) {
        try {
          await onBatchSuccess(batchSuccessfulIndices);
        } catch (batchUpdateError) {
          console.error('Error updating queue after batch success:', batchUpdateError);
        }
      }
      
      // Report progress based on attempted items
      if (onProgress) {
        onProgress(Math.min(i + BATCH_SIZE, transactions.length), transactions.length);
      }
      
      // Add delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < transactions.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }
  } catch (batchError: any) {
    // If batch processing fails, log it but don't crash
    const errorMessage = batchError?.message || 'Unknown error during batch processing';
    console.error('Error during batch transaction creation:', errorMessage);
    captureException(batchError instanceof Error ? batchError : new Error(errorMessage), {
      context: 'bulk_transaction_create_error',
      errorMessage,
      transactionCount: transactions.length,
      userId,
    });
    errors.push({ message: errorMessage });
  }
  
  return { created, failed: errors.length, errors, successfulIndices };
}

// Get the most recent import batch ID for a user
export async function getLastImportBatchId(userId: string): Promise<string | null> {
  if (!databaseId || !transactionsTableId) throw new Error("Appwrite env not configured");

  try {
    const res = await databases.listDocuments(
      databaseId,
      transactionsTableId,
      [
        Query.equal("userId", userId),
        Query.isNotNull("importBatchId"),
        Query.orderDesc("$createdAt"),
        Query.limit(1),
      ]
    );

    const doc = res.documents?.[0];
    return doc?.importBatchId || null;
  } catch (error) {
    console.error("Error fetching last import batch ID:", error);
    return null;
  }
}

// Get all transactions from a specific import batch
export async function getTransactionsByBatchId(userId: string, batchId: string): Promise<TransactionDoc[]> {
  if (!databaseId || !transactionsTableId) throw new Error("Appwrite env not configured");

  const all: TransactionDoc[] = [];
  const limit = 500;
  let cursor: string | undefined;

  try {
    while (true) {
      const queries: any[] = [
        Query.equal("userId", userId),
        Query.equal("importBatchId", batchId),
        Query.limit(limit),
      ];

      if (cursor) {
        queries.push(Query.cursorAfter(cursor));
      }

      const res = await databases.listDocuments(databaseId, transactionsTableId, queries);
      const docs = res.documents || [];
      all.push(...(docs as unknown as TransactionDoc[]));

      if (docs.length < limit) break;
      cursor = docs[docs.length - 1]?.$id;
      if (!cursor) break;
    }
  } catch (error) {
    console.error("Error fetching transactions by batch ID:", error);
  }

  return all;
}

// Delete all transactions from a specific import batch
export async function deleteTransactionsByBatchId(userId: string, batchId: string): Promise<{ deleted: number; failed: number }> {
  if (!databaseId || !transactionsTableId) throw new Error("Appwrite env not configured");

  let deleted = 0;
  let failed = 0;

  try {
    const transactions = await getTransactionsByBatchId(userId, batchId);

    for (const doc of transactions) {
      try {
        await databases.deleteDocument(databaseId, transactionsTableId, doc.$id);
        deleted++;
      } catch (error) {
        console.error(`Failed to delete transaction ${doc.$id}:`, error);
        failed++;
      }
    }
  } catch (error) {
    console.error("Error deleting transactions by batch ID:", error);
  }

  return { deleted, failed };
}

// Delete all user data and account
// This function prioritizes disabling the account immediately, then queues data deletion
export async function deleteUserAccount(userId: string): Promise<{ success: boolean; error?: string }> {
  if (!databaseId) throw new Error("Appwrite env not configured");

  try {
    addBreadcrumb({ message: 'Starting account deletion', category: 'auth', data: { userId } });

    // 1. FIRST: Disable the Appwrite auth account immediately
    // This prevents the user from logging back in while data is being cleaned up
    console.log("Disabling auth account...");
    try {
      await account.updateStatus();
      console.log("Auth account disabled successfully");
    } catch (err) {
      // If we can't disable the account, we should not proceed
      console.error("Failed to disable account:", err);
      throw new Error("Failed to disable account. Please try again.");
    }

    // 2. Delete small data sets synchronously (budgets, balances, profile)
    // These are small and won't hit rate limits
    
    // Delete budget documents
    if (budgetsTableId) {
      console.log("Deleting user budgets...");
      try {
        const budgets = await databases.listDocuments(databaseId, budgetsTableId, [
          Query.equal("userId", userId),
        ]);
        for (const doc of budgets.documents) {
          await databases.deleteDocument(databaseId, budgetsTableId, doc.$id);
        }
      } catch (err) {
        console.log("Error deleting budgets (continuing):", err);
      }
    }

    // Delete account balances
    if (balancesTableId) {
      console.log("Deleting user account balances...");
      try {
        const balances = await databases.listDocuments(databaseId, balancesTableId, [
          Query.equal("userId", userId),
        ]);
        for (const doc of balances.documents) {
          await databases.deleteDocument(databaseId, balancesTableId, doc.$id);
        }
      } catch (err) {
        console.log("Error deleting balances (continuing):", err);
      }
    }

    // Delete account imports
    if (accountImportsTableId) {
      console.log("Deleting account imports...");
      try {
        const imports = await databases.listDocuments(databaseId, accountImportsTableId, [
          Query.equal("userId", userId),
        ]);
        for (const doc of imports.documents) {
          await databases.deleteDocument(databaseId, accountImportsTableId, doc.$id);
        }
      } catch (err) {
        console.log("Error deleting account imports (continuing):", err);
      }
    }

    // Delete user preferences
    if (userPreferencesTableId) {
      console.log("Deleting user preferences...");
      try {
        await databases.deleteDocument(databaseId, userPreferencesTableId, userId);
      } catch (err) {
        console.log("Error deleting user preferences (continuing):", err);
      }
    }

    // Delete user profile document
    if (usersTableId) {
      console.log("Deleting user profile...");
      try {
        await databases.deleteDocument(databaseId, usersTableId, userId);
      } catch (err) {
        // Profile might not exist, continue
        console.log("User profile not found or already deleted");
      }
    }

    // 3. Transactions will be deleted via the background queue
    // Don't block account deletion on this - the account is already disabled
    // The deleteQueue will handle transaction cleanup in the background
    console.log("Account disabled. Transaction cleanup will happen in background.");

    addBreadcrumb({ message: 'Account deletion completed', category: 'auth', level: 'info' });
    return { success: true };
  } catch (err) {
    console.error("deleteUserAccount error:", err);
    captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { operation: 'delete_account', feature: 'auth' },
      contexts: { deletion: { userId } }
    });
    return { success: false, error: err instanceof Error ? err.message : "Failed to delete account" };
  }
}

// Account Import Tracking Functions
export async function saveAccountImport(
  userId: string,
  accountKey: string,
  accountName: string,
  provider: string
): Promise<void> {
  if (!databaseId || !accountImportsTableId) {
    console.warn("Account imports table not configured");
    return;
  }

  try {
    const now = new Date().toISOString();
    
    // Check if record exists
    const existing = await databases.listDocuments(databaseId, accountImportsTableId, [
      Query.equal("userId", userId),
      Query.equal("accountKey", accountKey),
    ]);

    if (existing.documents.length > 0) {
      // Update existing
      await databases.updateDocument(
        databaseId,
        accountImportsTableId,
        existing.documents[0].$id,
        {
          accountName,
          provider,
          lastImportDate: now,
        }
      );
    } else {
      // Create new
      await databases.createDocument(
        databaseId,
        accountImportsTableId,
        ID.unique(),
        {
          userId,
          accountKey,
          accountName,
          provider,
          lastImportDate: now,
        },
        [
          Permission.read(Role.user(userId)),
          Permission.update(Role.user(userId)),
          Permission.delete(Role.user(userId)),
        ]
      );
    }
  } catch (err) {
    console.error("saveAccountImport error:", err);
    captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { operation: 'save_account_import', feature: 'notifications' },
    });
    throw err;
  }
}

export async function getAccountImports(userId: string): Promise<AccountImportDoc[]> {
  if (!databaseId || !accountImportsTableId) {
    console.warn("Account imports table not configured");
    return [];
  }

  try {
    const result = await databases.listDocuments(databaseId, accountImportsTableId, [
      Query.equal("userId", userId),
    ]);

    return result.documents.map(doc => ({
      userId: doc.userId,
      accountKey: doc.accountKey,
      accountName: doc.accountName,
      provider: doc.provider,
      lastImportDate: doc.lastImportDate,
      $createdAt: doc.$createdAt,
      $updatedAt: doc.$updatedAt,
    }));
  } catch (err) {
    console.error("getAccountImports error:", err);
    return [];
  }
}

// User Preferences Functions
export async function getUserPreferences(userId: string): Promise<UserPreferencesDoc | null> {
  if (!databaseId || !userPreferencesTableId) {
    console.warn("User preferences table not configured");
    return null;
  }

  try {
    const doc = await databases.getDocument(databaseId, userPreferencesTableId, userId);
    // Appwrite may return dismissedImportBanners as a JSON string — parse it if so
    let dismissedImportBanners: Record<string, string> = {};
    if (doc.dismissedImportBanners) {
      dismissedImportBanners =
        typeof doc.dismissedImportBanners === 'string'
          ? JSON.parse(doc.dismissedImportBanners)
          : doc.dismissedImportBanners;
    }
    return {
      userId: doc.userId,
      dismissedImportBanners,
      $updatedAt: doc.$updatedAt,
    };
  } catch (err) {
    // Document doesn't exist yet
    if ((err as any)?.code === 404) {
      return null;
    }
    console.error("getUserPreferences error:", err);
    return null;
  }
}

export async function saveUserPreferences(
  userId: string,
  preferences: Partial<Omit<UserPreferencesDoc, 'userId' | '$updatedAt'>>
): Promise<void> {
  if (!databaseId || !userPreferencesTableId) {
    console.warn("User preferences table not configured");
    return;
  }

  try {
    // Appwrite stores dismissedImportBanners as a string attribute,
    // so we must JSON.stringify the object before sending it
    const payload: Record<string, unknown> = { ...preferences };
    if (payload.dismissedImportBanners && typeof payload.dismissedImportBanners === 'object') {
      payload.dismissedImportBanners = JSON.stringify(payload.dismissedImportBanners);
    }

    // Try to update existing
    try {
      await databases.updateDocument(
        databaseId,
        userPreferencesTableId,
        userId,
        payload
      );
    } catch (updateErr) {
      // Document doesn't exist, create it
      if ((updateErr as any)?.code === 404) {
        await databases.createDocument(
          databaseId,
          userPreferencesTableId,
          userId,
          {
            userId,
            ...payload,
          },
          [
            Permission.read(Role.user(userId)),
            Permission.update(Role.user(userId)),
            Permission.delete(Role.user(userId)),
          ]
        );
      } else {
        throw updateErr;
      }
    }
  } catch (err) {
    console.error("saveUserPreferences error:", err);
    captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { operation: 'save_user_preferences', feature: 'notifications' },
    });
    throw err;
  }
}

// ── Confirmed Subscriptions ──

export type SubscriptionDoc = {
  userId: string;
  name: string;
  merchantName: string;
  displayName: string;
  amount: number;
  amountType: "fixed" | "variable";
  frequency: string;
  categoryId: string;
  status: "active" | "paused" | "cancelled";
  nextBillingDate?: string;
  confirmedAt: string; // Appwrite datetime
  notes?: string;
};

export async function getConfirmedSubscriptions(userId: string): Promise<(SubscriptionDoc & { id: string })[]> {
  if (!databaseId || !subscriptionsTableId) throw new Error("Subscriptions collection not configured");

  const all: any[] = [];
  const limit = 100;
  let cursor: string | undefined;

  while (true) {
    const queries: any[] = [
      Query.equal("userId", userId),
      Query.limit(limit),
      Query.orderDesc("confirmedAt"),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const res = await databases.listDocuments(databaseId, subscriptionsTableId, queries);
    const docs = res.documents || [];
    all.push(...docs);
    if (docs.length < limit) break;
    cursor = docs[docs.length - 1]?.$id;
    if (!cursor) break;
  }

  return all.map((d) => ({ ...d, id: d.$id })) as (SubscriptionDoc & { id: string })[];
}

export async function createSubscription(userId: string, data: Omit<SubscriptionDoc, "userId">) {
  if (!databaseId || !subscriptionsTableId) throw new Error("Subscriptions collection not configured");

  return await databases.createDocument(
    databaseId,
    subscriptionsTableId,
    ID.unique(),
    { userId, ...data },
    [
      Permission.read(Role.user(userId)),
      Permission.update(Role.user(userId)),
      Permission.delete(Role.user(userId)),
    ]
  );
}

export async function updateSubscription(docId: string, updates: Partial<SubscriptionDoc>) {
  if (!databaseId || !subscriptionsTableId) throw new Error("Subscriptions collection not configured");
  return await databases.updateDocument(databaseId, subscriptionsTableId, docId, updates);
}

export async function deleteSubscription(docId: string) {
  if (!databaseId || !subscriptionsTableId) throw new Error("Subscriptions collection not configured");
  return await databases.deleteDocument(databaseId, subscriptionsTableId, docId);
}

