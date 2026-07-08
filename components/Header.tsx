import { getPendingBalanceHistoryCount, getPendingBalanceHistoryWipeCount } from "@/lib/balanceHistory";
import { getDeleteStatus } from "@/lib/deleteQueue";
import { getPendingTransactionCount, getSyncStatus, SyncStatus } from "@/lib/syncQueue";
import { useNotificationStore } from "@/store/useNotificationStore";
import { useSessionStore } from "@/store/useSessionStore";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";

export default function Header({
  name,
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
  const { unreadCount, openTray } = useNotificationStore();
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingBalHistCount, setPendingBalHistCount] = useState(0);
  const [pendingBalHistWipeCount, setPendingBalHistWipeCount] = useState(0);
  const [deleteStatus, setDeleteStatus] = useState<any>(null);
  const rotateAnim = useRef(new Animated.Value(0)).current;
  
  // Graceful fallback chain: display name -> email prefix -> friendly default,
  // so the header never shows a blank/"NO USER" when Apple withholds the name.
  const resolvedName = (name && name.trim()) || user?.email?.split("@")[0] || "Welcome";

  const initials = (name && name.trim())
    ? name.trim().split(" ").map((n) => n[0]).join("").toUpperCase()
    : (user?.email?.[0]?.toUpperCase() || "?");

  const displayTitle = title ?? resolvedName;

  useEffect(() => {
    const checkSync = async () => {
      const status = await getSyncStatus();
      const pending = await getPendingTransactionCount();
      const balHist = await getPendingBalanceHistoryCount(user?.id);
      const balHistWipe = await getPendingBalanceHistoryWipeCount(user?.id);
      const delStatus = await getDeleteStatus();
      setSyncStatus(status);
      setPendingCount(pending);
      setPendingBalHistCount(balHist);
      setPendingBalHistWipeCount(balHistWipe);
      // Only show delete status if it belongs to the current user
      if (delStatus && delStatus.userId === user?.id) {
        setDeleteStatus(delStatus);
      } else {
        setDeleteStatus(null);
      }
    };

    checkSync();
    const interval = setInterval(checkSync, 1000);
    return () => clearInterval(interval);
  }, [user?.id]);

  const hasPendingSync = syncStatus?.isSyncing || pendingCount > 0 || (deleteStatus && deleteStatus.status !== 'completed') || pendingBalHistCount > 0 || pendingBalHistWipeCount > 0;
  const isActiveOperation = !!(syncStatus?.isSyncing || deleteStatus?.status === 'in-progress' || pendingBalHistCount > 0 || pendingBalHistWipeCount > 0);
  const hasNotifications = unreadCount > 0 || hasPendingSync;

  useEffect(() => {
    if (!isActiveOperation) {
      rotateAnim.setValue(0);
      return;
    }
    rotateAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => {
      loop.stop();
    };
    // Only restart when active state flips, not on every count change.
  }, [isActiveOperation, rotateAnim]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View className={`flex-row items-center justify-between pt-4 ${noPaddingBottom ? "" : "pb-6"}`}>
      <View>
        <Text className="text-2xl font-bold text-dark-100">{displayTitle}</Text>
        <Text className="text-sm text-gray-500 mt-2">{subtitle}</Text>
      </View>
      <View className="flex-row items-center gap-3">
        {/* Notification Bell - opens notification tray, transforms during sync/delete */}
        <Pressable 
          onPress={openTray}
          className="h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm relative"
        >
          {isActiveOperation ? (
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              <Feather name="refresh-cw" size={18} color="#3B82F6" />
            </Animated.View>
          ) : (
            <>
              <Feather name="bell" size={18} color="#181C2E" />
              {hasNotifications && (
                <View className="absolute -top-0.5 -right-0.5 h-5 w-5 items-center justify-center rounded-full bg-red-500 border-2 border-white">
                  <Text className="text-[10px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount > 0 ? unreadCount : ''}
                  </Text>
                </View>
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
  );
}
