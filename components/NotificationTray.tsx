import { useNotificationStore, type InAppNotification } from '@/store/useNotificationStore';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import {
    Animated,
    Dimensions,
    FlatList,
    Modal,
    Pressable,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// Individual notification item
function NotificationItem({
  notification,
  onPress,
  onDismiss,
}: {
  notification: InAppNotification;
  onPress: () => void;
  onDismiss: () => void;
}) {
  const getTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getPriorityBorder = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'border-l-4 border-l-red-500';
      case 'medium':
        return 'border-l-4 border-l-amber-500';
      default:
        return 'border-l-4 border-l-gray-300';
    }
  };

  return (
    <Pressable
      onPress={onPress}
      className={`mx-4 mb-3 rounded-xl bg-white p-4 shadow-sm ${getPriorityBorder(notification.priority)} ${
        !notification.read ? 'bg-indigo-50/50' : ''
      }`}
    >
      <View className="flex-row items-start">
        {/* Icon */}
        <View
          className="h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: `${notification.iconColor || '#6366F1'}20` }}
        >
          <Feather
            name={(notification.icon as any) || 'bell'}
            size={20}
            color={notification.iconColor || '#6366F1'}
          />
        </View>

        {/* Content */}
        <View className="ml-3 flex-1">
          <View className="flex-row items-center justify-between">
            <Text
              className={`text-base ${!notification.read ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}
              numberOfLines={1}
            >
              {notification.title}
            </Text>
            <Text className="text-xs text-gray-400">{getTimeAgo(notification.createdAt)}</Text>
          </View>
          <Text className="mt-1 text-sm text-gray-600" numberOfLines={2}>
            {notification.body}
          </Text>

          {/* Action hint */}
          {notification.actionRoute && (
            <View className="mt-2 flex-row items-center">
              <Text className="text-xs font-medium text-indigo-600">Tap to view</Text>
              <Feather name="chevron-right" size={12} color="#4F46E5" />
            </View>
          )}
        </View>

        {/* Dismiss button */}
        <Pressable
          onPress={onDismiss}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          className="ml-2 p-1"
        >
          <Feather name="x" size={16} color="#9CA3AF" />
        </Pressable>
      </View>

      {/* Unread indicator */}
      {!notification.read && (
        <View className="absolute right-4 top-4 h-2 w-2 rounded-full bg-indigo-600" />
      )}
    </Pressable>
  );
}

// Empty state
function EmptyState() {
  return (
    <View className="flex-1 items-center justify-center py-20">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-gray-100">
        <Feather name="bell-off" size={32} color="#9CA3AF" />
      </View>
      <Text className="mt-4 text-lg font-semibold text-gray-700">No notifications</Text>
      <Text className="mt-1 text-center text-sm text-gray-500">
        {"You're all caught up! Check back later for\nbudget updates and import reminders."}
      </Text>
    </View>
  );
}

// Main notification tray component
export function NotificationTray() {
  const {
    notifications,
    showTray,
    closeTray,
    markAsRead,
    markAllAsRead,
    dismissNotification,
    dismissAllNotifications,
    loadNotifications,
    unreadCount,
  } = useNotificationStore();

  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  // Filter out dismissed notifications for display
  const visibleNotifications = notifications.filter((n) => !n.dismissed);

  useEffect(() => {
    if (showTray) {
      loadNotifications();
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 65,
          friction: 11,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SCREEN_HEIGHT,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTray]);

  const handleNotificationPress = useCallback(
    (notification: InAppNotification) => {
      markAsRead(notification.id);
      closeTray();

      if (notification.actionRoute) {
        setTimeout(() => {
          router.push(notification.actionRoute as any);
        }, 300);
      }
    },
    [markAsRead, closeTray]
  );

  const handleDismiss = useCallback(
    (notification: InAppNotification) => {
      dismissNotification(notification.id);
    },
    [dismissNotification]
  );

  const renderItem = useCallback(
    ({ item }: { item: InAppNotification }) => (
      <NotificationItem
        notification={item}
        onPress={() => handleNotificationPress(item)}
        onDismiss={() => handleDismiss(item)}
      />
    ),
    [handleNotificationPress, handleDismiss]
  );

  if (!showTray) return null;

  return (
    <Modal transparent visible={showTray} animationType="none" onRequestClose={closeTray}>
      {/* Backdrop */}
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          opacity: backdropAnim,
        }}
      >
        <Pressable style={{ flex: 1 }} onPress={closeTray} />
      </Animated.View>

      {/* Tray */}
      <Animated.View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          maxHeight: SCREEN_HEIGHT * 0.75,
          backgroundColor: '#F3F4F6',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          transform: [{ translateY: slideAnim }],
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.1,
          shadowRadius: 12,
          elevation: 10,
        }}
      >
        <SafeAreaView edges={['bottom']} className="flex-1">
          {/* Handle bar */}
          <View className="items-center pt-3 pb-2">
            <View className="h-1 w-10 rounded-full bg-gray-300" />
          </View>

          {/* Header */}
          <View className="flex-row items-center justify-between px-4 pb-3">
            <View className="flex-row items-center">
              <Text className="text-xl font-bold text-gray-900">Notifications</Text>
              {unreadCount > 0 && (
                <View className="ml-2 rounded-full bg-indigo-600 px-2 py-0.5">
                  <Text className="text-xs font-semibold text-white">{unreadCount}</Text>
                </View>
              )}
            </View>
            <View className="flex-row items-center gap-3">
              {visibleNotifications.length > 0 && (
                <>
                  <Pressable onPress={markAllAsRead} hitSlop={8}>
                    <Text className="text-sm font-medium text-indigo-600">Mark all read</Text>
                  </Pressable>
                  <Pressable onPress={dismissAllNotifications} hitSlop={8}>
                    <Feather name="trash-2" size={18} color="#6B7280" />
                  </Pressable>
                </>
              )}
              <Pressable onPress={closeTray} hitSlop={8}>
                <Feather name="x" size={24} color="#374151" />
              </Pressable>
            </View>
          </View>

          {/* Notifications list */}
          {visibleNotifications.length === 0 ? (
            <EmptyState />
          ) : (
            <FlatList
              data={visibleNotifications}
              renderItem={renderItem}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingBottom: 20, paddingTop: 8 }}
              showsVerticalScrollIndicator={false}
            />
          )}
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
}

// Notification bell button for header
export function NotificationBell({ size = 24 }: { size?: number }) {
  const { unreadCount, openTray } = useNotificationStore();

  return (
    <Pressable onPress={openTray} hitSlop={8} className="relative">
      <Feather name="bell" size={size} color="#374151" />
      {unreadCount > 0 && (
        <View className="absolute -right-1 -top-1 h-4 w-4 items-center justify-center rounded-full bg-red-500">
          <Text className="text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
