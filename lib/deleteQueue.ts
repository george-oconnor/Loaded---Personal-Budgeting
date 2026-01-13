import {
    createDeleteCompleteNotification,
    createDeleteFailedNotification,
    createDeletePausedNotification,
    createDeleteProgressNotification,
    useNotificationStore
} from '@/store/useNotificationStore';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Query } from "appwrite";
import * as Notifications from 'expo-notifications';
import { AppState } from "react-native";
import { databases } from "./appwrite";
import { areNotificationsEnabled } from './notifications';
import { captureException, captureMessage } from './sentry';

const DATABASE_ID = process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID;
const TRANSACTION_COLLECTION_ID = process.env.EXPO_PUBLIC_APPWRITE_TABLE_TRANSACTIONS || process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_TRANSACTIONS;

const DELETE_QUEUE_KEY = "delete_queue";
const DELETE_STATUS_KEY = "delete_status";
const DELETE_LOCK_KEY = "delete_lock"; // Prevent concurrent delete operations
const SYNC_STATUS_KEY = 'budget_app_sync_status';

// In-memory lock to prevent concurrent delete operations
let deleteOperationLocked = false;

interface DeleteOperation {
  userId: string;
  status: "pending" | "in-progress" | "completed" | "failed";
  totalDeleted: number;
  totalToDelete: number; // Total transactions to delete (set when starting)
  lastError?: string;
  createdAt: string;
}

async function resetSyncStatus(): Promise<void> {
  try {
    const status = {
      isSyncing: false,
      progress: { current: 0, total: 0 },
      failedCount: 0,
    };
    await AsyncStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(status));
  } catch (error) {
    console.error('Error resetting sync status:', error);
    captureException(error instanceof Error ? error : new Error('Error resetting sync status'), {
      tags: { feature: 'delete_queue', operation: 'resetSyncStatus' }
    });
  }
}

export async function queueDeleteAll(userId: string): Promise<void> {
  const operation: DeleteOperation = {
    userId,
    status: "pending",
    totalDeleted: 0,
    totalToDelete: 0, // Will be calculated when starting
    createdAt: new Date().toISOString(),
  };

  await AsyncStorage.setItem(DELETE_QUEUE_KEY, JSON.stringify(operation));
  
  // Also clear the sync queue since we're deleting everything
  await AsyncStorage.removeItem("budget_app_sync_queue");
  
  // Stop any in-progress sync
  await resetSyncStatus();
  
  // Register background task for deletion
  try {
    const { registerBackgroundDeleteTask } = await import('./backgroundTasks');
    await registerBackgroundDeleteTask();
  } catch (error) {
    console.error('Failed to register background delete task:', error);
  }
  
  console.log("Delete all operation queued for user:", userId);
}

export async function getDeleteStatus(): Promise<DeleteOperation | null> {
  try {
    const data = await AsyncStorage.getItem(DELETE_QUEUE_KEY);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error("Error getting delete status:", error);
    captureException(error instanceof Error ? error : new Error('Error getting delete status'), {
      tags: { feature: 'delete_queue', operation: 'getDeleteStatus' }
    });
    return null;
  }
}

async function updateDeleteStatus(updates: Partial<DeleteOperation>): Promise<void> {
  const current = await getDeleteStatus();
  if (current) {
    const updated = { ...current, ...updates };
    await AsyncStorage.setItem(DELETE_QUEUE_KEY, JSON.stringify(updated));
  }
}

export async function startDeletingTransactions(
  onProgressUpdate?: (deleted: number, status: string) => void
): Promise<void> {
  // Prevent concurrent delete operations - check lock first
  if (deleteOperationLocked) {
    console.log("Delete operation already in progress, skipping concurrent call");
    return;
  }

  // Acquire lock immediately to prevent race conditions
  deleteOperationLocked = true;

  try {
    const operation = await getDeleteStatus();
    
    if (!operation || operation.status === "completed") {
      console.log("No pending delete operation");
      return;
    }

    if (operation.status === "in-progress") {
      console.log("Delete already in progress");
      return;
    }

    console.log("Starting delete operation for user:", operation.userId);
    
    // First, count total transactions to delete
    let totalToDelete = 0;
    try {
      const countResponse = await databases.listDocuments(
        DATABASE_ID,
        TRANSACTION_COLLECTION_ID,
        [Query.equal("userId", operation.userId), Query.limit(1)]
      );
      totalToDelete = countResponse.total || 0;
      console.log(`Deleting ${totalToDelete} transactions`);
    } catch (error) {
      console.error("Error counting transactions:", error);
      captureException(error instanceof Error ? error : new Error('Error counting transactions'), {
        tags: { feature: 'delete_queue', operation: 'processDeleteOperation' },
        contexts: { delete_operation: { userId: operation.userId } }
      });
      totalToDelete = 0;
    }
    
    await updateDeleteStatus({ status: "in-progress", totalToDelete });
    onProgressUpdate?.(0, "in-progress");

    let totalDeleted = 0;
    const batchSize = 1; // Process one at a time to minimize rate limit issues
    const delayBetweenBatches = 2000; // 2 second delay between batches
    const delayBetweenDocuments = 500; // 0.5 second delay between documents

    while (true) {
      // Check if app went to background
      // With background tasks, we can continue deleting even in background
      if (AppState.currentState !== "active") {
        console.log(`[Delete] App backgrounded. Background task will continue deletion.`);
        
        // Don't pause - let background task continue
        // Just notify user that deletion continues in background
        try {
          const { addNotification } = useNotificationStore.getState();
          await addNotification(createDeletePausedNotification());
          
          // Send push notification
          if (await areNotificationsEnabled()) {
            await Notifications.scheduleNotificationAsync({
              content: {
                title: '🗑️ Deleting in Background',
                body: 'Deletion continues in the background',
                data: { type: 'delete_background' },
                sound: false,
                badge: 1,
              },
              trigger: null,
            });
          }
        } catch (notifError) {
          console.error('Failed to send delete background notification:', notifError);
        }
        
        // Continue processing instead of pausing
      }

      const response = await databases.listDocuments(
        DATABASE_ID,
        TRANSACTION_COLLECTION_ID,
        [Query.equal("userId", operation.userId), Query.limit(batchSize)]
      );

      if (response.documents.length === 0) {
        // All done!
        console.log(`Delete completed. Total deleted: ${totalDeleted}`);
        await updateDeleteStatus({ status: "completed", totalDeleted });
        onProgressUpdate?.(totalDeleted, "completed");
        
        // Add completion notification
        try {
          const { addNotification } = useNotificationStore.getState();
          const isBackground = AppState.currentState !== 'active';
          
          if (totalDeleted > 0) {
            await addNotification(createDeleteCompleteNotification(totalDeleted));
            
            // Send push notification if app is in background
            if (isBackground && await areNotificationsEnabled()) {
              await Notifications.scheduleNotificationAsync({
                content: {
                  title: '✓ Delete Complete',
                  body: `Successfully removed ${totalDeleted} transaction${totalDeleted === 1 ? '' : 's'}`,
                  data: { type: 'delete_complete', count: totalDeleted },
                  sound: true,
                  badge: 1,
                },
                trigger: null,
              });
            }
          }
        } catch (notifError) {
          console.error('Failed to send delete completion notification:', notifError);
        }
        
        // Clean up the delete queue and sync queue
        await AsyncStorage.removeItem(DELETE_QUEUE_KEY);
        await AsyncStorage.removeItem("budget_app_sync_queue");
        await resetSyncStatus();
        
        console.log("Cleared sync queue after delete");
        break;
      }

      // Delete this batch
      let batchDeleted = 0;
      for (const doc of response.documents) {
        try {
          await databases.deleteDocument(
            DATABASE_ID,
            TRANSACTION_COLLECTION_ID,
            doc.$id
          );
          totalDeleted++;
          batchDeleted++;
          
          // Add a small delay between individual deletes to avoid rate limits
          await new Promise((resolve) => setTimeout(resolve, delayBetweenDocuments));
        } catch (error: any) {
          // If document is not found, it was already deleted - count it as success
          if (error.code === 404 || error.message?.includes('could not be found')) {
            console.log("Document already deleted:", doc.$id);
            captureMessage(`Document already deleted during batch delete: ${doc.$id}`, 'warning');
            totalDeleted++;
            batchDeleted++;
          } 
          // Handle rate limit errors
          else if (error.code === 429 || error.type === 'rate_limit_exceeded' || error.message?.includes('rate limit')) {
            console.warn("Rate limit hit, waiting before retry:", doc.$id);
            captureException(error, { 
              context: 'delete_rate_limit',
              documentId: doc.$id,
              totalDeleted,
              batchSize 
            });
            
            // Wait longer and retry this document
            await new Promise((resolve) => setTimeout(resolve, 10000)); // 10 second wait
            
            try {
              await databases.deleteDocument(
                DATABASE_ID,
                TRANSACTION_COLLECTION_ID,
                doc.$id
              );
              totalDeleted++;
              batchDeleted++;
              console.log("Successfully deleted after rate limit retry:", doc.$id);
            } catch (retryError: any) {
              console.error("Failed to delete after rate limit retry:", doc.$id, retryError);
              captureException(retryError, { 
                context: 'delete_rate_limit_retry_failed',
                documentId: doc.$id 
              });
            }
          } 
          else {
            console.error("Error deleting document:", doc.$id, error);
            captureException(error, { 
              context: 'delete_error',
              documentId: doc.$id 
            });
          }
        }
      }

      await updateDeleteStatus({ totalDeleted });
      onProgressUpdate?.(totalDeleted, "in-progress");
      
      // Update progress notification every 10 deletions
      if (totalDeleted % 10 === 0 && totalToDelete > 0) {
        try {
          const { addNotification } = useNotificationStore.getState();
          await addNotification(createDeleteProgressNotification(totalDeleted, totalToDelete));
        } catch (notifError) {
          console.error('Failed to send delete progress notification:', notifError);
        }
      }

      // Wait before next batch to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
    }
  } catch (error: any) {
    console.error("Error during deletion:", error);
    await updateDeleteStatus({
      status: "failed",
      lastError: error.message,
      totalDeleted: 0,
    });
    onProgressUpdate?.(0, "failed");
    
    // Add failure notification
    try {
      const { addNotification } = useNotificationStore.getState();
      await addNotification(createDeleteFailedNotification(error.message || 'Unknown error'));
      
      // Always send push notification for failures
      if (await areNotificationsEnabled()) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '⚠️ Delete Failed',
            body: error.message || 'Failed to delete transactions',
            data: { type: 'delete_failed' },
            sound: true,
            badge: 1,
          },
          trigger: null,
        });
      }
    } catch (notifError) {
      console.error('Failed to send delete failure notification:', notifError);
    }
  } finally {
    // Release lock
    deleteOperationLocked = false;
  }
}

/**
 * Initialize delete status on app start - resets stuck delete operations
 */
export async function initializeDeleteStatus(): Promise<void> {
  try {
    const status = await getDeleteStatus();
    
    // If status shows in-progress, it was stuck (app crashed or was backgrounded)
    // Reset it back to pending so we can resume
    if (status && status.status === 'in-progress') {
      console.log('Found stuck delete operation, resetting to pending...');
      await updateDeleteStatus({ status: 'pending' });
      console.log('Delete operation will resume on next opportunity');
    }
  } catch (error) {
    console.error('Error initializing delete status:', error);
  }
}
