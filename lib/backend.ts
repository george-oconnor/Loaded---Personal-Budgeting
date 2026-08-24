/**
 * Backend seam: every consumer imports data functions from here instead of
 * lib/appwrite.ts directly. EXPO_PUBLIC_BACKEND selects the implementation:
 * "cloudkit" (lib/cloudkit.ts) or Appwrite (default during the transition).
 *
 * Auth (sign-in/sessions) is not switched here — it stays on Appwrite until
 * the Sign in with Apple release (Phase B of the CloudKit migration).
 */
import * as appwriteBackend from './appwrite';
import * as cloudkitBackend from './cloudkit';

export const USE_CLOUDKIT = process.env.EXPO_PUBLIC_BACKEND === 'cloudkit';

// Shared data surface — both modules implement every name destructured below.
// The cast gives the CloudKit signatures, which are the narrower/common shape.
const impl = (USE_CLOUDKIT ? cloudkitBackend : appwriteBackend) as unknown as typeof cloudkitBackend;

export const {
  // User profile
  createUserProfile,
  getUserProfile,
  updateUserProfile,
  // Account balances
  upsertAccountBalance,
  getAccountBalancesFromAppwrite,
  deleteAccountBalanceDoc,
  saveBalanceSnapshotToAppwrite,
  restoreBalancesFromSnapshot,
  // Balance history
  isBalanceHistoryConfigured,
  upsertBalanceHistoryEntries,
  getBalanceHistory,
  deleteBalanceHistoryByBatch,
  deleteBalanceHistoryByAccountKey,
  deleteAllBalanceHistory,
  deleteBalanceHistoryPage,
  countBalanceHistory,
  // Budget
  getMonthlyBudget,
  updateMonthlyBudget,
  // Transactions
  getTransactionsForMonth,
  getTransactionsInRange,
  getTransactionsPaginated,
  getTransactionsInRangeAll,
  getTransactionsBySubscriptionId,
  deleteAllTransactionsForUser,
  getAllTransactionsForUser,
  getCategories,
  createTransaction,
  getTransactionById,
  updateTransaction,
  updateTransactionFields,
  deleteTransaction,
  createBulkTransactions,
  getLastImportBatchId,
  getTransactionsByBatchId,
  deleteTransactionsByBatchId,
  // Account lifecycle
  deleteUserAccount,
  // Account imports
  saveAccountImport,
  getAccountImports,
  // Preferences
  getUserPreferences,
  saveUserPreferences,
  // Subscriptions
  getConfirmedSubscriptions,
  createSubscription,
  updateSubscription,
  deleteSubscription,
} = impl;

// Auth stays on Appwrite until the Sign in with Apple swap
export {
  clearAllSessions,
  completePasswordReset,
  createAccount,
  getCurrentSession,
  getCurrentUser,
  requestPasswordReset,
  signIn,
  signOut,
} from './appwrite';

export type {
  AccountImportDoc,
  AccountBalanceDoc,
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
