import { getDeleteStatus } from "@/lib/deleteQueue";
import { getPendingTransactionCount, getSyncStatus, SyncStatus } from "@/lib/syncQueue";
import { useSessionStore } from "@/store/useSessionStore";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";

export default function Header({ 
  name = "NO USER",
  title,
  subtitle = "Welcome back",
  noPaddingBottom = false
}: { 
  name?: string;
  title?: string;
  subtitle?: string;
  noPaddingBottom?: boolean;
}) {
  const { user } = useSessionStore();
  const [showNotifications, setShowNotifications] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [deleteStatus, setDeleteStatus] = useState<any>(null);
  const rotateAnim = useRef(new Animated.Value(0)).current;
  
  const initials = user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase() || "?";
  
  const displayTitle = title ?? name;

  useEffect(() => {
    const checkSync = async () => {
      const status = await getSyncStatus();
      const pending = await getPendingTransactionCount();
      const delStatus = await getDeleteStatus();
      setSyncStatus(status);
      setPendingCount(pending);
      setDeleteStatus(delStatus);
    };

    checkSync();
    const interval = setInterval(checkSync, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (syncStatus?.isSyncing || deleteStatus?.status === 'in-progress') {
      // Start rotation animation
      Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();
    } else {
      // Reset rotation
      rotateAnim.setValue(0);
    }
  }, [syncStatus?.isSyncing, deleteStatus?.status]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const hasPendingSync = syncStatus?.isSyncing || pendingCount > 0 || (deleteStatus && deleteStatus.status !== 'completed');
  const hasSyncActivity = syncStatus?.isSyncing || pendingCount > 0; // exclude delete-only from showing sync item
  const isActiveOperation = syncStatus?.isSyncing || deleteStatus?.status === 'in-progress';

  return (
    <>
      <View className={`flex-row items-center justify-between pt-4 ${noPaddingBottom ? "" : "pb-6"}`}>
        <View>
          <Text className="text-xs text-gray-500">{subtitle}</Text>
          <Text className="text-2xl font-bold text-dark-100">{displayTitle}</Text>
        </View>
        <View className="flex-row items-center gap-3">
          <Pressable 
            onPress={() => setShowNotifications(!showNotifications)}
            className="h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm relative"
          >
            {isActiveOperation ? (
              <Animated.View style={{ transform: [{ rotate: spin }] }}>
                <Feather name="refresh-cw" size={18} color="#3B82F6" />
              </Animated.View>
            ) : (
              <>
                <Feather name="bell" size={18} color="#181C2E" />
                {hasPendingSync && (
                  <View className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-blue-500 border border-white" />
                )}
              </>
            )}
          </Pressable>
          <Pressable onPress={() => router.push("/profile")}>
            <View className="h-10 w-10 items-center justify-center rounded-full bg-primary">
              <Text className="text-xs font-bold text-white">{initials}</Text>
            </View>
          </Pressable>
        </View>
      </View>

      {/* Notification Dropdown */}
      {showNotifications && (
        <Pressable 
          onPress={() => setShowNotifications(false)}
          className="absolute top-14 right-0 left-0 bottom-0 z-50"
        >
          <View className="absolute top-2 right-4 w-80 bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
            <Pressable onPress={(e) => e.stopPropagation()}>
              {/* Header */}
              <View className="px-4 py-3 border-b border-gray-100">
                <Text className="text-base font-semibold text-dark-100">Notifications</Text>
              </View>

              {/* Sync Status */}
              {syncStatus && hasSyncActivity ? (
                <>
                  {/* Delete Status */}
                  {deleteStatus && deleteStatus.status !== 'completed' && (
                    <View className="px-4 py-4 border-b border-gray-100">
                      <View className="flex-row items-center gap-3">
                        {deleteStatus.status === 'in-progress' ? (
                          <View className="h-10 w-10 items-center justify-center rounded-full bg-red-50">
                            <Feather name="trash-2" size={18} color="#EF4444" />
                          </View>
                        ) : (
                          <View className="h-10 w-10 items-center justify-center rounded-full bg-gray-50">
                            <Feather name="clock" size={18} color="#6B7280" />
                          </View>
                        )}
                        
                        <View className="flex-1">
                          <Text className="text-sm font-medium text-dark-100">
                            {deleteStatus.status === 'in-progress' 
                              ? "Deleting transactions..." 
                              : deleteStatus.status === 'failed'
                              ? "Delete failed"
                              : "Delete queued"}
                          </Text>
                          <Text className="text-xs text-gray-500 mt-0.5">
                            {deleteStatus.status === 'in-progress' 
                              ? `${deleteStatus.totalDeleted} of ${deleteStatus.totalToDelete || '?'}` 
                              : deleteStatus.status === 'failed'
                              ? deleteStatus.lastError || 'An error occurred'
                              : "Will process shortly"}
                          </Text>
                        </View>
                      </View>
                      
                      {deleteStatus.status === 'in-progress' && (
                        <View className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <View
                            className="h-full bg-red-500 rounded-full"
                            style={{ 
                              width: `${deleteStatus.totalToDelete > 0 
                                ? (deleteStatus.totalDeleted / deleteStatus.totalToDelete) * 100 
                                : 0}%`
                            }}
                          />
                        </View>
                      )}
                    </View>
                  )}

                  {/* Sync Upload Status (only when actual sync is pending or running) */}
                  <View className="px-4 py-4 border-b border-gray-100">
                    <View className="flex-row items-center gap-3">
                      {syncStatus.isSyncing ? (
                        <View className="h-10 w-10 items-center justify-center rounded-full bg-blue-50">
                          <Feather name="upload-cloud" size={18} color="#3B82F6" />
                        </View>
                      ) : pendingCount > 0 ? (
                        <View className="h-10 w-10 items-center justify-center rounded-full bg-gray-50">
                          <Feather name="clock" size={18} color="#6B7280" />
                        </View>
                      ) : null}
                      
                      <View className="flex-1">
                        <Text className="text-sm font-medium text-dark-100">
                          {syncStatus.isSyncing 
                            ? "Syncing transactions..." 
                            : `${pendingCount} transaction${pendingCount === 1 ? '' : 's'} queued`}
                        </Text>
                        {syncStatus.isSyncing ? (
                          <View className="flex-row items-center justify-between mt-0.5">
                            <Text className="text-xs text-gray-500">
                              {syncStatus.progress.current}/{syncStatus.progress.total}
                            </Text>
                            <Text className="text-xs font-semibold text-blue-600">
                              {syncStatus.progress.total > 0 
                                ? Math.round((syncStatus.progress.current / syncStatus.progress.total) * 100)
                                : 0}%
                            </Text>
                          </View>
                        ) : (
                          <Text className="text-xs text-gray-500 mt-0.5">
                            Will sync shortly
                          </Text>
                        )}
                      </View>
                    </View>
                    
                    {syncStatus.isSyncing && (
                      <View className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <View
                          className="h-full bg-blue-500 rounded-full"
                          style={{ 
                            width: `${syncStatus.progress.total > 0 
                              ? (syncStatus.progress.current / syncStatus.progress.total) * 100 
                              : 0}%` 
                          }}
                        />
                      </View>
                    )}
                  </View>
                </>
              ) : deleteStatus && deleteStatus.status !== 'completed' ? (
                <View className="px-4 py-4 border-b border-gray-100">
                  <View className="flex-row items-center gap-3">
                    {deleteStatus.status === 'in-progress' ? (
                      <View className="h-10 w-10 items-center justify-center rounded-full bg-red-50">
                        <Feather name="trash-2" size={18} color="#EF4444" />
                      </View>
                    ) : (
                      <View className="h-10 w-10 items-center justify-center rounded-full bg-gray-50">
                        <Feather name="clock" size={18} color="#6B7280" />
                      </View>
                    )}
                    
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-dark-100">
                        {deleteStatus.status === 'in-progress' 
                          ? "Deleting transactions..." 
                          : deleteStatus.status === 'failed'
                          ? "Delete failed"
                          : "Delete queued"}
                      </Text>
                      <Text className="text-xs text-gray-500 mt-0.5">
                        {deleteStatus.status === 'in-progress' 
                          ? `${deleteStatus.totalDeleted} of ${deleteStatus.totalToDelete || '?'}` 
                          : deleteStatus.status === 'failed'
                          ? deleteStatus.lastError || 'An error occurred'
                          : "Will process shortly"}
                      </Text>
                    </View>
                  </View>
                  
                  {deleteStatus.status === 'in-progress' && (
                    <View className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <View
                        className="h-full bg-red-500 rounded-full"
                        style={{ 
                          width: `${deleteStatus.totalToDelete > 0 
                            ? (deleteStatus.totalDeleted / deleteStatus.totalToDelete) * 100 
                            : 0}%`
                        }}
                      />
                    </View>
                  )}
                </View>
              ) : (
                <View className="px-4 py-8">
                  <View className="items-center">
                    <View className="h-12 w-12 items-center justify-center rounded-full bg-gray-50 mb-2">
                      <Feather name="check-circle" size={24} color="#9CA3AF" />
                    </View>
                    <Text className="text-sm text-gray-500">All caught up!</Text>
                  </View>
                </View>
              )}
            </Pressable>
          </View>
        </Pressable>
      )}
    </>
  );
}
