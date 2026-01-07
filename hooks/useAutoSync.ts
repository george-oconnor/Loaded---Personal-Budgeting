import { getDeleteStatus, initializeDeleteStatus, startDeletingTransactions } from '@/lib/deleteQueue';
import { cleanupSyncQueue, getPendingTransactionCount, getSyncStatus, initializeSyncStatus, startSyncingTransactions } from '@/lib/syncQueue';
import { useSessionStore } from '@/store/useSessionStore';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';

export function useAutoSync() {
  const { user } = useSessionStore();
  
  useEffect(() => {
    let appStateSubscription: any;
    let syncInterval: NodeJS.Timeout;
    let isSyncing = false;

    // Initialize sync status on app start (clears stuck sync)
    const init = async () => {
      await initializeSyncStatus();
      await initializeDeleteStatus();
      requestPermissions();
    };
    init();

    // Request notification permissions
    const requestPermissions = async () => {
      try {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        console.log('Current notification permission status:', existingStatus);
        
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          console.log('Requesting notification permissions...');
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
          console.log('Permission request result:', status);
        }
        
        if (finalStatus !== 'granted') {
          console.warn('Notification permissions not granted. Status:', finalStatus);
        } else {
          console.log('Notification permissions granted successfully');
        }
      } catch (error) {
        console.error('Error requesting notification permissions:', error);
      }
    };

    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        // Dismiss any sync paused notifications
        await Notifications.dismissAllNotificationsAsync();
        
        // Clean up sync queue periodically
        if (user?.id) {
          await cleanupSyncQueue(user.id);
        }
        
        // App came to foreground, try syncing and deleting
        const currentSyncStatus = await getSyncStatus();
        const pendingCount = await getPendingTransactionCount(user?.id);
        const deleteStatus = await getDeleteStatus();
        
        console.log('App foregrounded. Sync status:', currentSyncStatus, 'Pending:', pendingCount, 'Delete status:', deleteStatus?.status);
        
        // Start delete operation first if there's one pending (and not already running)
        // Check both local flag and actual status to prevent concurrent operations
        if (deleteStatus && deleteStatus.status === 'pending' && !isSyncing) {
          console.log(`Auto-starting delete operation`);
          isSyncing = true;
          try {
            await startDeletingTransactions();
          } catch (error) {
            console.error('Auto-delete failed:', error);
          } finally {
            isSyncing = false;
          }
          return; // Don't sync while deleting
        }
        
        // Don't sync if delete is already in progress
        if (deleteStatus && deleteStatus.status === 'in-progress') {
          console.log('Delete in progress, skipping sync');
          return;
        }
        
        if (pendingCount > 0 && !currentSyncStatus.isSyncing && !isSyncing) {
          console.log(`Auto-syncing ${pendingCount} pending transactions`);
          isSyncing = true;
          try {
            await startSyncingTransactions();
          } catch (error) {
            console.error('Auto-sync failed:', error);
          } finally {
            isSyncing = false;
          }
        }
      }
      // When app goes to background, sync will automatically pause
    };

    // Listen for app state changes
    appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    // Also try to sync periodically (every 30 seconds) if user is active
    syncInterval = setInterval(async () => {
      if (AppState.currentState === 'active' && !isSyncing) {
        // Clean up sync queue periodically
        if (user?.id) {
          await cleanupSyncQueue(user.id);
        }
        
        const currentSyncStatus = await getSyncStatus();
        const pendingCount = await getPendingTransactionCount(user?.id);
        const deleteStatus = await getDeleteStatus();
        
        // Start delete if pending (the function itself has a lock to prevent concurrent operations)
        if (deleteStatus && deleteStatus.status === 'pending') {
          console.log('Periodic check: Starting delete operation');
          isSyncing = true;
          try {
            await startDeletingTransactions();
          } catch (error) {
            console.error('Periodic delete failed:', error);
          } finally {
            isSyncing = false;
          }
          return;
        }
        
        // Don't start sync if already syncing
        if (currentSyncStatus.isSyncing) {
          console.log('Sync already in progress, skipping periodic check');
          return;
        }
        
        // Don't sync if delete is in progress
        if (deleteStatus && deleteStatus.status === 'in-progress') {
          console.log('Delete in progress, skipping sync');
          return;
        }
        
        if (pendingCount > 0) {
          console.log(`Periodic sync: syncing ${pendingCount} pending transactions`);
          isSyncing = true;
          try {
            await startSyncingTransactions();
          } catch (error) {
            console.error('Periodic sync failed:', error);
          } finally {
            isSyncing = false;
          }
        }
      }
    }, 30000); // Every 30 seconds

    return () => {
      appStateSubscription?.remove();
      clearInterval(syncInterval);
    };
  }, []);
}
