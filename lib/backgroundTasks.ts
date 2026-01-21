import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { getDeleteStatus, startDeletingTransactions } from './deleteQueue';
import { areNotificationsEnabled } from './notifications';
import { addBreadcrumb, captureException } from './sentry';
import { getQueuedTransactions, startSyncingTransactions } from './syncQueue';

// Task identifiers
export const BACKGROUND_SYNC_TASK = 'background-sync-task';
export const BACKGROUND_DELETE_TASK = 'background-delete-task';

/**
 * Background sync task definition
 * Runs periodically to sync pending transactions
 */
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    addBreadcrumb({ message: 'Background sync task started', category: 'background_task' });
    
    const queue = await getQueuedTransactions();
    const pending = queue.filter(t => t.syncStatus === 'pending' || t.syncStatus === 'failed');
    
    if (pending.length === 0) {
      console.log('[Background] No pending transactions to sync');
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    console.log(`[Background] Syncing ${pending.length} transactions`);
    
    // Run sync with progress tracking
    const result = await startSyncingTransactions(async (status) => {
      console.log(`[Background] Sync progress: ${status.progress.current}/${status.progress.total}`);
    });

    // Send notification on completion
    if (result.succeeded > 0 && await areNotificationsEnabled()) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '✓ Background Sync Complete',
          body: `Synced ${result.succeeded} transaction${result.succeeded === 1 ? '' : 's'} in the background`,
          data: { type: 'background_sync_complete', count: result.succeeded },
          sound: false,
          badge: 1,
        },
        trigger: null,
      });
    }

    if (result.failed > 0 && await areNotificationsEnabled()) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '⚠️ Some Syncs Failed',
          body: `${result.failed} transaction${result.failed === 1 ? '' : 's'} failed to sync`,
          data: { type: 'background_sync_failed', count: result.failed },
          sound: false,
          badge: 1,
        },
        trigger: null,
      });
    }

    return result.succeeded > 0 
      ? BackgroundFetch.BackgroundFetchResult.NewData 
      : BackgroundFetch.BackgroundFetchResult.NoData;

  } catch (error) {
    console.error('[Background] Sync task error:', error);
    captureException(error instanceof Error ? error : new Error(String(error)), {
      tags: { feature: 'background_sync', task: BACKGROUND_SYNC_TASK }
    });
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/**
 * Background delete task definition
 * Continues deletion operations in the background
 */
TaskManager.defineTask(BACKGROUND_DELETE_TASK, async () => {
  try {
    addBreadcrumb({ message: 'Background delete task started', category: 'background_task' });
    
    const deleteStatus = await getDeleteStatus();
    
    if (!deleteStatus || deleteStatus.status === 'completed') {
      console.log('[Background] No pending delete operations');
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    console.log('[Background] Continuing delete operation');
    
    // Continue deletion
    let totalDeleted = 0;
    await startDeletingTransactions((deleted, status) => {
      totalDeleted = deleted;
      console.log(`[Background] Delete progress: ${deleted} deleted, status: ${status}`);
    });

    // Send notification on completion
    const finalStatus = await getDeleteStatus();
    if (finalStatus?.status === 'completed' && await areNotificationsEnabled()) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '✓ Background Delete Complete',
          body: `Deleted ${totalDeleted} transaction${totalDeleted === 1 ? '' : 's'} in the background`,
          data: { type: 'background_delete_complete', count: totalDeleted },
          sound: false,
          badge: 1,
        },
        trigger: null,
      });
    }

    return finalStatus?.status === 'completed'
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;

  } catch (error) {
    console.error('[Background] Delete task error:', error);
    captureException(error instanceof Error ? error : new Error(String(error)), {
      tags: { feature: 'background_delete', task: BACKGROUND_DELETE_TASK }
    });
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/**
 * Register background sync task
 * iOS: Runs periodically (iOS decides when, typically 15-30 min intervals)
 * Android: More flexible, can be configured
 */
export async function registerBackgroundSyncTask(): Promise<void> {
  try {
    // Check if background fetch is available (not available in Expo Go)
    const status = await BackgroundFetch.getStatusAsync();
    if (status === BackgroundFetch.BackgroundFetchStatus.Restricted || 
        status === BackgroundFetch.BackgroundFetchStatus.Denied) {
      console.log('[Background] Background fetch not available (likely Expo Go)');
      return;
    }

    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    
    if (isRegistered) {
      console.log('[Background] Sync task already registered');
      return;
    }

    await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: Platform.OS === 'ios' ? 15 * 60 : 15 * 60, // 15 minutes minimum
      stopOnTerminate: false, // Continue after app termination
      startOnBoot: true, // Start on device boot (Android)
    });

    console.log('[Background] Sync task registered successfully');
    addBreadcrumb({ message: 'Background sync task registered', category: 'background_task' });
  } catch (error) {
    // Silently handle in Expo Go - background fetch isn't available
    const errorMsg = String(error);
    if (errorMsg.includes('Background Fetch has not been configured') || 
        errorMsg.includes('UIBackgroundModes')) {
      console.log('[Background] Sync task skipped (Expo Go or missing native config)');
      return;
    }
    console.error('[Background] Failed to register sync task:', error);
    captureException(error instanceof Error ? error : new Error(String(error)), {
      tags: { feature: 'background_sync', operation: 'register_task' }
    });
  }
}

/**
 * Register background delete task
 * Only registers when there's an active delete operation
 */
export async function registerBackgroundDeleteTask(): Promise<void> {
  try {
    // Check if background fetch is available (not available in Expo Go)
    const status = await BackgroundFetch.getStatusAsync();
    if (status === BackgroundFetch.BackgroundFetchStatus.Restricted || 
        status === BackgroundFetch.BackgroundFetchStatus.Denied) {
      console.log('[Background] Background fetch not available for delete task');
      return;
    }

    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_DELETE_TASK);
    
    if (isRegistered) {
      console.log('[Background] Delete task already registered');
      return;
    }

    await BackgroundFetch.registerTaskAsync(BACKGROUND_DELETE_TASK, {
      minimumInterval: Platform.OS === 'ios' ? 15 * 60 : 5 * 60, // 5-15 minutes
      stopOnTerminate: false,
      startOnBoot: false, // Don't need this on boot
    });

    console.log('[Background] Delete task registered successfully');
    addBreadcrumb({ message: 'Background delete task registered', category: 'background_task' });
  } catch (error) {
    // Silently handle in Expo Go - background fetch isn't available
    const errorMsg = String(error);
    if (errorMsg.includes('Background Fetch has not been configured') || 
        errorMsg.includes('UIBackgroundModes')) {
      console.log('[Background] Delete task skipped (Expo Go or missing native config)');
      return;
    }
    console.error('[Background] Failed to register delete task:', error);
    captureException(error instanceof Error ? error : new Error(String(error)), {
      tags: { feature: 'background_delete', operation: 'register_task' }
    });
  }
}

/**
 * Unregister background sync task
 */
export async function unregisterBackgroundSyncTask(): Promise<void> {
  try {
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
    console.log('[Background] Sync task unregistered');
  } catch (error) {
    console.error('[Background] Failed to unregister sync task:', error);
  }
}

/**
 * Unregister background delete task
 */
export async function unregisterBackgroundDeleteTask(): Promise<void> {
  try {
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_DELETE_TASK);
    console.log('[Background] Delete task unregistered');
  } catch (error) {
    console.error('[Background] Failed to unregister delete task:', error);
  }
}

/**
 * Check background fetch status
 */
export async function getBackgroundFetchStatus(): Promise<BackgroundFetch.BackgroundFetchStatus | null> {
  return await BackgroundFetch.getStatusAsync();
}

/**
 * Set background fetch interval (Android only)
 */
export async function setBackgroundFetchInterval(intervalSeconds: number): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await BackgroundFetch.setMinimumIntervalAsync(intervalSeconds);
      console.log(`[Background] Fetch interval set to ${intervalSeconds} seconds`);
    } catch (error) {
      console.error('[Background] Failed to set interval:', error);
    }
  }
}

/**
 * Initialize all background tasks
 */
export async function initializeBackgroundTasks(): Promise<void> {
  try {
    const status = await getBackgroundFetchStatus();
    
    if (status === BackgroundFetch.BackgroundFetchStatus.Denied) {
      console.warn('[Background] Background fetch is denied');
      return;
    }

    if (status === BackgroundFetch.BackgroundFetchStatus.Restricted) {
      console.warn('[Background] Background fetch is restricted');
      return;
    }

    // Register sync task by default
    await registerBackgroundSyncTask();
    
    // Check if there's a pending delete operation
    const deleteStatus = await getDeleteStatus();
    if (deleteStatus && deleteStatus.status === 'pending') {
      await registerBackgroundDeleteTask();
    }

    console.log('[Background] Background tasks initialized');
  } catch (error) {
    console.error('[Background] Failed to initialize tasks:', error);
    captureException(error instanceof Error ? error : new Error(String(error)), {
      tags: { feature: 'background_tasks', operation: 'initialize' }
    });
  }
}
