import { getSyncStatus, startSyncingTransactions, SyncStatus } from '@/lib/syncQueue';
import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';

export function SyncNotificationBanner() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const slideAnimation = new Animated.Value(-80);

  useEffect(() => {
    // Check sync status periodically
    const checkSync = async () => {
      const status = await getSyncStatus();
      setSyncStatus(status);
      
      if (status.isSyncing || status.failedCount > 0) {
        setIsVisible(true);
        Animated.timing(slideAnimation, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start();
      } else if (isVisible && !status.isSyncing) {
        // Keep showing for a moment after sync completes, then hide
        setTimeout(() => {
          Animated.timing(slideAnimation, {
            toValue: -80,
            duration: 300,
            useNativeDriver: true,
          }).start(() => setIsVisible(false));
        }, 2000);
      }
    };

    const interval = setInterval(checkSync, 1000);
    checkSync();

    return () => clearInterval(interval);
  }, [isVisible]);

  if (!isVisible || !syncStatus) return null;

  const progressPercent = syncStatus.progress.total > 0
    ? (syncStatus.progress.current / syncStatus.progress.total) * 100
    : 0;

  return (
    <Animated.View
      style={{
        transform: [{ translateY: slideAnimation }],
        zIndex: 1000,
      }}
      className="absolute top-0 left-0 right-0 bg-blue-50 border-b border-blue-200 px-4 py-3"
    >
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-1">
          <View className="flex-row items-center gap-2 mb-2">
            {syncStatus.isSyncing ? (
              <>
                <Feather name="upload-cloud" size={16} color="#3B82F6" />
                <Text className="text-sm font-medium text-blue-700">
                  Syncing {syncStatus.progress.current}/{syncStatus.progress.total}
                </Text>
              </>
            ) : syncStatus.failedCount > 0 ? (
              <>
                <Feather name="alert-circle" size={16} color="#EF4444" />
                <Text className="text-sm font-medium text-red-700">
                  {syncStatus.failedCount} failed to sync
                </Text>
              </>
            ) : (
              <>
                <Feather name="check-circle" size={16} color="#10B981" />
                <Text className="text-sm font-medium text-green-700">
                  Sync complete
                </Text>
              </>
            )}
          </View>
          
          {syncStatus.isSyncing && (
            <View className="h-1 bg-blue-200 rounded-full overflow-hidden">
              <View
                className="h-full bg-blue-500"
                style={{ width: `${progressPercent}%` }}
              />
            </View>
          )}
        </View>

        {!syncStatus.isSyncing && (
          <Pressable
            onPress={() => {
              setIsVisible(false);
              Animated.timing(slideAnimation, {
                toValue: -80,
                duration: 300,
                useNativeDriver: true,
              }).start();
            }}
            className="p-1"
          >
            <Feather name="x" size={18} color="#6B7280" />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

export function useSyncQueue() {
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    const check = async () => {
      const s = await getSyncStatus();
      setStatus(s);
    };

    check();
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, []);

  const sync = async () => {
    try {
      await startSyncingTransactions((updatedStatus) => {
        setStatus(updatedStatus);
      });
    } catch (error) {
      console.error('Sync error:', error);
    }
  };

  return { status, sync };
}
