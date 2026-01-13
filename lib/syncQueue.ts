import {
    createSyncCompleteNotification,
    createSyncFailedNotification,
    createSyncPausedNotification,
    useNotificationStore
} from '@/store/useNotificationStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ID, Query } from 'appwrite';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';
import { createBulkTransactions, databases } from './appwrite';
import { getDeleteStatus } from './deleteQueue';
import { areNotificationsEnabled } from './notifications';
import { addBreadcrumb, captureException } from './sentry';

export interface QueuedTransaction {
  id: string;
  title: string;
  subtitle: string;
  amount: number;
  kind: 'income' | 'expense';
  date: string;
  categoryId: string;
  currency: string;
  userId: string;
  syncStatus: 'pending' | 'syncing' | 'completed' | 'failed';
  attempts: number;
  error?: string;
  createdAt: string;
  excludeFromAnalytics?: boolean;
  isAnalyticsProtected?: boolean;
  source?: "revolut_import" | "aib_import" | "manual" | "other_import";
  displayName?: string;
  account?: string;
  matchedTransferId?: string;
  importBatchId?: string;
}

const SYNC_QUEUE_KEY = 'budget_app_sync_queue';
const SYNC_STATUS_KEY = 'budget_app_sync_status';
const MAX_RETRY_ATTEMPTS = 3;

export interface SyncStatus {
  isSyncing: boolean;
  progress: {
    current: number;
    total: number;
  };
  lastSync?: string;
  failedCount: number;
}

/**
 * Add transactions to local sync queue
 */
export async function queueTransactionsForSync(
  userId: string,
  transactions: {
    title: string;
    subtitle: string;
    amount: number;
    kind: 'income' | 'expense';
    date: string;
    categoryId: string;
    currency: string;
    source?: "revolut_import" | "aib_import" | "manual" | "other_import";
    displayName?: string;
    account?: string;
    matchedTransferId?: string;
    importBatchId?: string;
  }[]
): Promise<QueuedTransaction[]> {
  try {
    addBreadcrumb({ message: `Queueing ${transactions.length} transactions for sync`, category: 'sync', data: { userId, count: transactions.length } });
    const queue = await getQueuedTransactions();
    const newTransactions: QueuedTransaction[] = transactions.map((t, i) => ({
      id: ID.unique(), // Generate valid Appwrite document ID
      ...t,
      userId,
      syncStatus: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString(),
    }));

    const updatedQueue = [...queue, ...newTransactions];
    await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(updatedQueue));
    
    // Ensure background task is registered when transactions are queued
    try {
      const { registerBackgroundSyncTask } = await import('./backgroundTasks');
      await registerBackgroundSyncTask();
    } catch (error) {
      console.error('Failed to register background sync task:', error);
    }
    
    return newTransactions;
  } catch (error) {
    console.error('Error queuing transactions:', error);
    captureException(error instanceof Error ? error : new Error(String(error)), {
      tags: { operation: 'queue_transactions', feature: 'sync' },
      contexts: { sync: { userId, transactionCount: transactions.length } }
    });
    throw error;
  }
}

/**
 * Get all queued transactions
 */
export async function getQueuedTransactions(): Promise<QueuedTransaction[]> {
  try {
    const data = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error reading sync queue:', error);
    return [];
  }
}

/**
 * Update specific queued transactions (e.g., to set matchedTransferId)
 */
export async function updateQueuedTransactions(
  updates: Array<{ id: string; updates: Partial<QueuedTransaction> }>
): Promise<void> {
  try {
    const queue = await getQueuedTransactions();
    const updatedQueue = queue.map(tx => {
      const update = updates.find(u => u.id === tx.id);
      return update ? { ...tx, ...update.updates } : tx;
    });
    await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(updatedQueue));
  } catch (error) {
    console.error('Error updating queued transactions:', error);
    throw error;
  }
}

/**
 * Get pending transactions count for a specific user
 */
export async function getPendingTransactionCount(userId?: string): Promise<number> {
  try {
    const queue = await getQueuedTransactions();
    const filtered = userId ? queue.filter((t) => t.userId === userId) : queue;
    return filtered.filter((t) => t.syncStatus === 'pending' || t.syncStatus === 'failed').length;
  } catch {
    return 0;
  }
}

/**
 * Get current sync status
 */
export async function getSyncStatus(): Promise<SyncStatus> {
  try {
    const data = await AsyncStorage.getItem(SYNC_STATUS_KEY);
    return data
      ? JSON.parse(data)
      : {
          isSyncing: false,
          progress: { current: 0, total: 0 },
          failedCount: 0,
        };
  } catch {
    return {
      isSyncing: false,
      progress: { current: 0, total: 0 },
      failedCount: 0,
    };
  }
}

/**
 * Reset sync status (use when sync is stuck)
 */
export async function resetSyncStatus(): Promise<void> {
  try {
    const status: SyncStatus = {
      isSyncing: false,
      progress: { current: 0, total: 0 },
      failedCount: 0,
    };
    await AsyncStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(status));
  } catch (error) {
    console.error('Error resetting sync status:', error);
  }
}

/**
 * Clean up sync queue by removing transactions that no longer exist locally
 * Should be called periodically or after operations that might affect the queue
 */
export async function cleanupSyncQueue(userId: string): Promise<void> {
  try {
    const queue = await getQueuedTransactions();
    
    if (queue.length === 0) {
      return;
    }

    // Check if user has any transactions in the database
    const response = await databases.listDocuments(
      process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID,
      process.env.EXPO_PUBLIC_APPWRITE_TABLE_TRANSACTIONS || process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_TRANSACTIONS,
      [Query.equal("userId", userId), Query.limit(1)]
    );

    // If user has no transactions, clear the entire sync queue
    if (response.total === 0) {
      await AsyncStorage.removeItem(SYNC_QUEUE_KEY);
      await resetSyncStatus();
      return;
    }
  } catch (error) {
    console.error('Error cleaning up sync queue:', error);
  }
}

/**
 * Initialize sync status on app start - clears stuck syncing status
 */
export async function initializeSyncStatus(): Promise<void> {
  try {
    const status = await getSyncStatus();
    
    // If status shows syncing, it was stuck (app crashed or was backgrounded)
    // Reset it so we can try again
    if (status.isSyncing) {
      // Reset any transactions stuck in "syncing" state back to "pending"
      const queue = await getQueuedTransactions();
      const resetQueue = queue.map((t) =>
        t.syncStatus === 'syncing' ? { ...t, syncStatus: 'pending' as const } : t
      );
      await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(resetQueue));
      
      // Calculate actual remaining pending count (excluding completed ones)
      const remainingCount = resetQueue.filter(
        (t) => t.syncStatus === 'pending' || 
               (t.syncStatus === 'failed' && t.attempts < MAX_RETRY_ATTEMPTS)
      ).length;
      
      // Reset the sync status with accurate count
      await AsyncStorage.setItem(SYNC_STATUS_KEY, JSON.stringify({
        isSyncing: false,
        progress: { current: 0, total: remainingCount },
        failedCount: 0,
      }));
    }
  } catch (error) {
    console.error('Error initializing sync:', error);
  }
}

/**
 * Start syncing queued transactions to database
 */
export async function startSyncingTransactions(
  onProgressUpdate?: (status: SyncStatus) => void
): Promise<{ succeeded: number; failed: number }> {
  try {
    // If a delete operation is pending or in-progress, do not start sync
    const initialDeleteStatus = await getDeleteStatus();
    if (initialDeleteStatus && initialDeleteStatus.status !== 'completed') {
      await AsyncStorage.setItem(SYNC_STATUS_KEY, JSON.stringify({
        isSyncing: false,
        progress: { current: 0, total: 0 },
        failedCount: 0,
      }));
      onProgressUpdate?.({ isSyncing: false, progress: { current: 0, total: 0 }, failedCount: 0 });
      return { succeeded: 0, failed: 0 };
    }

    const queue = await getQueuedTransactions();
    const pendingTransactions = queue.filter(
      (t) => t.syncStatus === 'pending' || 
             t.syncStatus === 'syncing' || // Include stuck syncing transactions
             (t.syncStatus === 'failed' && t.attempts < MAX_RETRY_ATTEMPTS)
    );

    if (pendingTransactions.length === 0) {
      // Clear any stuck syncing status
      await AsyncStorage.setItem(SYNC_STATUS_KEY, JSON.stringify({
        isSyncing: false,
        progress: { current: 0, total: 0 },
        failedCount: 0,
      }));
      return { succeeded: 0, failed: 0 };
    }

    // Update status to syncing
    const syncStatus: SyncStatus = {
      isSyncing: true,
      progress: { current: 0, total: pendingTransactions.length },
      failedCount: 0,
    };
    await AsyncStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(syncStatus));
    onProgressUpdate?.(syncStatus);

    // Mark all pending as syncing
    const updatedQueue = queue.map((t) =>
      pendingTransactions.find((p) => p.id === t.id)
        ? { ...t, syncStatus: 'syncing' as const }
        : t
    );
    await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(updatedQueue));

    // Group by userId for bulk operations
    const groupedByUser = new Map<string, QueuedTransaction[]>();
    for (const transaction of pendingTransactions) {
      if (!groupedByUser.has(transaction.userId)) {
        groupedByUser.set(transaction.userId, []);
      }
      groupedByUser.get(transaction.userId)!.push(transaction);
    }

    let totalSucceeded = 0;
    let totalFailed = 0;

    // Cancellation flag, set by polling delete status
    let cancelSync = false;
    const cancelPoll = setInterval(async () => {
      try {
        const del = await getDeleteStatus();
        if (del && (del.status === 'in-progress' || del.status === 'pending')) {
          cancelSync = true;
        }
      } catch {}
    }, 500);

    // Process each user's transactions
    for (const [userId, userTransactions] of groupedByUser.entries()) {
      try {
        // Interrupt sync if a delete has started
        const currentDeleteStatus = await getDeleteStatus();
        if (currentDeleteStatus && (currentDeleteStatus.status === 'in-progress' || currentDeleteStatus.status === 'pending')) {
          // Reset syncing transactions back to pending
          const q = await getQueuedTransactions();
          const resetQueue = q.map((t) => t.syncStatus === 'syncing' ? { ...t, syncStatus: 'pending' as const } : t);
          await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(resetQueue));
          const pausedStatus: SyncStatus = {
            isSyncing: false,
            progress: { current: totalSucceeded, total: pendingTransactions.length },
            failedCount: totalFailed,
          };
          await AsyncStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(pausedStatus));
          onProgressUpdate?.(pausedStatus);
          clearInterval(cancelPoll);
          return { succeeded: totalSucceeded, failed: totalFailed };
        }

        // Check if app is still active before syncing
        // With background tasks, we can continue syncing even in background
        if (AppState.currentState !== 'active') {
          const remainingCount = pendingTransactions.length - totalSucceeded;
          console.log(`[Sync] App backgrounded with ${remainingCount} pending. Background task will continue.`);
          
          // Don't pause - let background task continue
          // Just notify user that sync continues in background
          try {
            const { addNotification } = useNotificationStore.getState();
            await addNotification(createSyncPausedNotification(remainingCount));
            
            // Send push notification
            if (await areNotificationsEnabled()) {
              await Notifications.scheduleNotificationAsync({
                content: {
                  title: '☁️ Syncing in Background',
                  body: `${remainingCount} transaction${remainingCount === 1 ? '' : 's'} syncing in the background`,
                  data: { type: 'sync_background', remaining: remainingCount },
                  sound: false,
                  badge: 1,
                },
                trigger: null, // Immediate
              });
            }
          } catch (notifError) {
            console.error('Failed to send notification:', notifError);
          }
          
          // Continue processing instead of returning
          // The background task will handle completion
        }

        const result = await createBulkTransactions(
          userId,
          userTransactions.map(({ userId, syncStatus, attempts, error, createdAt, ...t }) => t), // Keep id for duplicate prevention
          async (current, total) => {
            syncStatus.progress.current = totalSucceeded + current;
            await AsyncStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(syncStatus));
            onProgressUpdate?.(syncStatus);
          },
          () => cancelSync, // shouldCancel
          async (batchSuccessIndices) => {
            // Mark these transactions as completed immediately after batch succeeds
            const queue = await getQueuedTransactions();
            const updatedQueue = queue.map((t) => {
              const transactionIndex = userTransactions.findIndex((ut) => ut.id === t.id);
              if (transactionIndex !== -1 && batchSuccessIndices.includes(transactionIndex)) {
                return { ...t, syncStatus: 'completed' as const, attempts: t.attempts + 1 };
              }
              return t;
            });
            await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(updatedQueue));
          }
        );

        // If we were cancelled mid-batch, stop further processing gracefully
        if (cancelSync) {
          const q = await getQueuedTransactions();
          const resetQueue = q.map((t) => t.syncStatus === 'syncing' ? { ...t, syncStatus: 'pending' as const } : t);
          await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(resetQueue));
          const pausedStatus: SyncStatus = {
            isSyncing: false,
            progress: { current: totalSucceeded, total: pendingTransactions.length },
            failedCount: totalFailed,
          };
          await AsyncStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(pausedStatus));
          onProgressUpdate?.(pausedStatus);
          clearInterval(cancelPoll);
          return { succeeded: totalSucceeded, failed: totalFailed };
        }

        totalSucceeded += result.created;
        totalFailed += result.failed;

        // Update queue - mark only the successfully created transactions as completed
        let completedCount = 0;
        let failedCount = 0;
        const finalQueue = (await getQueuedTransactions()).map((t) => {
          // Find the index of this transaction in userTransactions
          const transactionIndex = userTransactions.findIndex((ut) => ut.id === t.id);
          const wasSuccessful = transactionIndex !== -1 && result.successfulIndices?.includes(transactionIndex);
          
          if (transactionIndex !== -1) {
            if (wasSuccessful) {
              completedCount++;
              return { ...t, syncStatus: 'completed' as const, attempts: t.attempts + 1 };
            } else if (result.errors.length > 0) {
              failedCount++;
              return {
                ...t,
                syncStatus: 'failed' as const,
                attempts: t.attempts + 1,
                error: 'Failed to create transaction',
              };
            }
          }
          return t;
        });

        await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(finalQueue));
      } catch (error) {
        console.error(`Error processing user ${userId}:`, error);
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        captureException(error instanceof Error ? error : new Error(errorMsg), {
          context: 'sync_user_batch_error',
          userId,
          errorMessage: errorMsg,
          transactionCount: userTransactions.length,
        });
        totalFailed += userTransactions.length;
        const isNetworkError = errorMsg.includes('Network request failed') || 
                              errorMsg.includes('network') || 
                              errorMsg.includes('timeout');

        console.error('Sync error for user', userId, ':', errorMsg, 'Network error:', isNetworkError);

        // Mark as failed or pending depending on error type
        const finalQueue = (await getQueuedTransactions()).map((t) => {
          const corresponding = userTransactions.find((ut) => ut.id === t.id);
          if (corresponding) {
            // For network errors, mark as pending to retry later
            // For other errors, mark as failed after max attempts
            if (isNetworkError || t.attempts < MAX_RETRY_ATTEMPTS - 1) {
              return {
                ...t,
                syncStatus: 'pending' as const,
                attempts: t.attempts + 1,
                error: errorMsg,
              };
            } else {
              return {
                ...t,
                syncStatus: 'failed' as const,
                attempts: t.attempts + 1,
                error: errorMsg,
              };
            }
          }
          return t;
        });

        await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(finalQueue));
      }
    }

    // Don't auto-clear completed transactions - let them be filtered naturally by the UI
    // when it detects they exist in the database. This prevents race conditions where
    // transactions disappear before the UI has refreshed to show them from the database.
    // However, clear them after a delay to prevent stale queue data from persisting forever
    setTimeout(() => {
      clearCompletedTransactions().catch(err => 
        console.error('Error clearing completed transactions after sync:', err)
      );
    }, 2000); // Wait 2 seconds for UI to refresh from database before clearing

    // Update final status
    // Calculate how many are still pending/failed after sync
    const finalQueue = await getQueuedTransactions();
    const stillPending = finalQueue.filter(
      (t) => t.syncStatus === 'pending' || 
             (t.syncStatus === 'failed' && t.attempts < MAX_RETRY_ATTEMPTS)
    ).length;
    
    const finalStatus: SyncStatus = {
      isSyncing: false,
      progress: { current: totalSucceeded, total: totalSucceeded + stillPending },
      lastSync: new Date().toISOString(),
      failedCount: totalFailed,
    };
    await AsyncStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(finalStatus));
    onProgressUpdate?.(finalStatus);
    clearInterval(cancelPoll);
    
    // Add completion notification
    try {
      const { addNotification } = useNotificationStore.getState();
      const isBackground = AppState.currentState !== 'active';
      
      if (totalSucceeded > 0) {
        await addNotification(createSyncCompleteNotification(totalSucceeded));
        
        // Send push notification if app is in background
        if (isBackground && await areNotificationsEnabled()) {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: '✓ Sync Complete',
              body: `Successfully synced ${totalSucceeded} transaction${totalSucceeded === 1 ? '' : 's'}`,
              data: { type: 'sync_complete', count: totalSucceeded },
              sound: true,
              badge: 1,
            },
            trigger: null, // Immediate
          });
        }
      }
      if (totalFailed > 0) {
        await addNotification(createSyncFailedNotification(totalFailed));
        
        // Always send push notification for failures
        if (await areNotificationsEnabled()) {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: '⚠️ Sync Failed',
              body: `${totalFailed} transaction${totalFailed === 1 ? '' : 's'} failed to sync`,
              data: { type: 'sync_failed', count: totalFailed },
              sound: true,
              badge: 1,
            },
            trigger: null, // Immediate
          });
        }
      }
    } catch (notifError) {
      console.error('Failed to send sync completion notification:', notifError);
    }
    
    return { succeeded: totalSucceeded, failed: totalFailed };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error during sync';
    console.error('Error syncing transactions:', error);
    captureException(error instanceof Error ? error : new Error(errorMsg), {
      context: 'sync_transaction_error',
      errorMessage: errorMsg,
    });
    
    // Reset any stuck syncing transactions back to pending
    try {
      const queue = await getQueuedTransactions();
      const resetQueue = queue.map((t) =>
        t.syncStatus === 'syncing' ? { ...t, syncStatus: 'pending' as const } : t
      );
      await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(resetQueue));
      
      const status: SyncStatus = {
        isSyncing: false,
        progress: { current: 0, total: 0 },
        failedCount: 0,
      };
      await AsyncStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(status));
      
      // Return gracefully with counts of what failed
      return { succeeded: 0, failed: 0 };
    } catch (resetError) {
      console.error('Error resetting sync state:', resetError);
      captureException(resetError instanceof Error ? resetError : new Error('Error resetting sync state'), {
        context: 'sync_reset_error',
      });
      // Even if reset fails, return gracefully to avoid crashing
      return { succeeded: 0, failed: 0 };
    }
  }
}

/**
 * Clear completed transactions from queue
 */
export async function clearCompletedTransactions(): Promise<void> {
  try {
    const queue = await getQueuedTransactions();
    const filtered = queue.filter((t) => t.syncStatus !== 'completed');
    await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error clearing completed transactions:', error);
  }
}

/**
 * Remove a transaction from queue
 */
export async function removeQueuedTransaction(transactionId: string): Promise<void> {
  try {
    const queue = await getQueuedTransactions();
    const filtered = queue.filter((t) => t.id !== transactionId);
    await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error removing transaction:', error);
  }
}
