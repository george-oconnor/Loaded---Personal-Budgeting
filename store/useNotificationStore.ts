import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

// Storage key for in-app notifications
const IN_APP_NOTIFICATIONS_KEY = '@in_app_notifications';
const DISMISSED_NOTIFICATIONS_KEY = '@dismissed_notifications';
const MAX_NOTIFICATIONS = 50;

export type NotificationType = 
  | 'budget_warning'
  | 'budget_exceeded'
  | 'budget_on_track'
  | 'import_reminder'
  | 'account_stale'
  | 'general'
  | 'sync_progress'
  | 'sync_complete'
  | 'sync_paused'
  | 'sync_failed'
  | 'delete_progress'
  | 'delete_complete'
  | 'delete_paused'
  | 'delete_failed';

export type InAppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  dismissed: boolean;
  actionRoute?: string; // Route to navigate to when tapped
  actionParams?: Record<string, any>;
  priority: 'high' | 'medium' | 'low';
  icon?: string; // Feather icon name
  iconColor?: string;
  metadata?: Record<string, any>;
};

type NotificationState = {
  notifications: InAppNotification[];
  unreadCount: number;
  showTray: boolean;
  loading: boolean;
  
  // Actions
  loadNotifications: () => Promise<void>;
  addNotification: (notification: Omit<InAppNotification, 'id' | 'createdAt' | 'read' | 'dismissed'>) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  dismissNotification: (id: string) => Promise<void>;
  dismissAllNotifications: () => Promise<void>;
  clearNotifications: () => Promise<void>;
  toggleTray: () => void;
  closeTray: () => void;
  openTray: () => void;
  
  // Helpers
  getNotificationsByType: (type: NotificationType) => InAppNotification[];
  hasUnreadOfType: (type: NotificationType) => boolean;
};

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  showTray: false,
  loading: false,

  loadNotifications: async () => {
    set({ loading: true });
    try {
      const stored = await AsyncStorage.getItem(IN_APP_NOTIFICATIONS_KEY);
      const dismissed = await AsyncStorage.getItem(DISMISSED_NOTIFICATIONS_KEY);
      const dismissedIds = dismissed ? JSON.parse(dismissed) : [];
      
      let notifications: InAppNotification[] = stored ? JSON.parse(stored) : [];
      
      // Filter out permanently dismissed notifications
      notifications = notifications.filter(n => !dismissedIds.includes(n.id));
      
      // Sort by date (newest first) and limit
      notifications.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      notifications = notifications.slice(0, MAX_NOTIFICATIONS);
      
      const unreadCount = notifications.filter(n => !n.read && !n.dismissed).length;
      
      set({ notifications, unreadCount, loading: false });
    } catch (error) {
      console.error('Failed to load notifications:', error);
      set({ loading: false });
    }
  },

  addNotification: async (notification) => {
    try {
      const { notifications } = get();
      
      // Check for duplicate notifications (same type and similar content within last hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const isDuplicate = notifications.some(
        n => n.type === notification.type && 
             n.title === notification.title && 
             n.createdAt > oneHourAgo
      );
      
      if (isDuplicate) {
        console.log('Duplicate notification skipped:', notification.title);
        return;
      }

      const newNotification: InAppNotification = {
        ...notification,
        id: `${notification.type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        createdAt: new Date().toISOString(),
        read: false,
        dismissed: false,
      };

      const updatedNotifications = [newNotification, ...notifications].slice(0, MAX_NOTIFICATIONS);
      
      await AsyncStorage.setItem(IN_APP_NOTIFICATIONS_KEY, JSON.stringify(updatedNotifications));
      
      set({
        notifications: updatedNotifications,
        unreadCount: updatedNotifications.filter(n => !n.read && !n.dismissed).length,
      });
    } catch (error) {
      console.error('Failed to add notification:', error);
    }
  },

  markAsRead: async (id) => {
    try {
      const { notifications } = get();
      const updatedNotifications = notifications.map(n =>
        n.id === id ? { ...n, read: true } : n
      );
      
      await AsyncStorage.setItem(IN_APP_NOTIFICATIONS_KEY, JSON.stringify(updatedNotifications));
      
      set({
        notifications: updatedNotifications,
        unreadCount: updatedNotifications.filter(n => !n.read && !n.dismissed).length,
      });
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  },

  markAllAsRead: async () => {
    try {
      const { notifications } = get();
      const updatedNotifications = notifications.map(n => ({ ...n, read: true }));
      
      await AsyncStorage.setItem(IN_APP_NOTIFICATIONS_KEY, JSON.stringify(updatedNotifications));
      
      set({
        notifications: updatedNotifications,
        unreadCount: 0,
      });
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  },

  dismissNotification: async (id) => {
    try {
      const { notifications } = get();
      const updatedNotifications = notifications.map(n =>
        n.id === id ? { ...n, dismissed: true } : n
      );
      
      await AsyncStorage.setItem(IN_APP_NOTIFICATIONS_KEY, JSON.stringify(updatedNotifications));
      
      set({
        notifications: updatedNotifications,
        unreadCount: updatedNotifications.filter(n => !n.read && !n.dismissed).length,
      });
    } catch (error) {
      console.error('Failed to dismiss notification:', error);
    }
  },

  dismissAllNotifications: async () => {
    try {
      const { notifications } = get();
      const updatedNotifications = notifications.map(n => ({ ...n, dismissed: true }));
      
      await AsyncStorage.setItem(IN_APP_NOTIFICATIONS_KEY, JSON.stringify(updatedNotifications));
      
      set({
        notifications: updatedNotifications,
        unreadCount: 0,
      });
    } catch (error) {
      console.error('Failed to dismiss all notifications:', error);
    }
  },

  clearNotifications: async () => {
    try {
      await AsyncStorage.removeItem(IN_APP_NOTIFICATIONS_KEY);
      set({ notifications: [], unreadCount: 0 });
    } catch (error) {
      console.error('Failed to clear notifications:', error);
    }
  },

  toggleTray: () => {
    set(state => ({ showTray: !state.showTray }));
  },

  closeTray: () => {
    set({ showTray: false });
  },

  openTray: () => {
    set({ showTray: true });
  },

  getNotificationsByType: (type) => {
    const { notifications } = get();
    return notifications.filter(n => n.type === type && !n.dismissed);
  },

  hasUnreadOfType: (type) => {
    const { notifications } = get();
    return notifications.some(n => n.type === type && !n.read && !n.dismissed);
  },
}));

// Helper functions for creating specific notification types

export function createBudgetWarningNotification(
  percentage: number,
  remaining: number,
  daysRemaining: number,
  currency: string = 'EUR'
): Omit<InAppNotification, 'id' | 'createdAt' | 'read' | 'dismissed'> {
  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount / 100);
  };

  return {
    type: 'budget_warning',
    title: '⚠️ Budget Alert',
    body: `You've used ${Math.round(percentage)}% of your budget. ${formatAmount(remaining)} remaining for ${daysRemaining} days.`,
    priority: 'high',
    icon: 'alert-triangle',
    iconColor: '#F59E0B',
    actionRoute: '/spend-analytics',
    metadata: { percentage, remaining, daysRemaining },
  };
}

export function createBudgetExceededNotification(
  overspent: number,
  currency: string = 'EUR'
): Omit<InAppNotification, 'id' | 'createdAt' | 'read' | 'dismissed'> {
  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Math.abs(amount) / 100);
  };

  return {
    type: 'budget_exceeded',
    title: '🚨 Budget Exceeded',
    body: `You've exceeded your budget by ${formatAmount(overspent)}. Review your spending to get back on track.`,
    priority: 'high',
    icon: 'alert-circle',
    iconColor: '#EF4444',
    actionRoute: '/spend-analytics',
    metadata: { overspent },
  };
}

export function createBudgetOnTrackNotification(
  remaining: number,
  daysRemaining: number,
  currency: string = 'EUR'
): Omit<InAppNotification, 'id' | 'createdAt' | 'read' | 'dismissed'> {
  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount / 100);
  };

  return {
    type: 'budget_on_track',
    title: '✨ Great Progress!',
    body: `You're doing well! ${formatAmount(remaining)} left with ${daysRemaining} days to go.`,
    priority: 'low',
    icon: 'check-circle',
    iconColor: '#10B981',
    actionRoute: '/spend-analytics',
    metadata: { remaining, daysRemaining },
  };
}

export function createImportReminderNotification(
  accountName: string,
  provider: string,
  daysSince: number
): Omit<InAppNotification, 'id' | 'createdAt' | 'read' | 'dismissed'> {
  return {
    type: 'account_stale',
    title: `📥 Update ${accountName}`,
    body: `It's been ${daysSince} days since your last ${provider.toUpperCase()} import. Keep your budget accurate!`,
    priority: daysSince >= 21 ? 'high' : 'medium',
    icon: 'download',
    iconColor: '#6366F1',
    actionRoute: `/import/${provider.toLowerCase()}`,
    metadata: { accountName, provider, daysSince },
  };
}

export function createGeneralImportReminderNotification(): Omit<InAppNotification, 'id' | 'createdAt' | 'read' | 'dismissed'> {
  return {
    type: 'import_reminder',
    title: '📊 Time to Update',
    body: 'Keep your budget accurate by importing your latest transactions.',
    priority: 'medium',
    icon: 'refresh-cw',
    iconColor: '#8B5CF6',
    actionRoute: '/import',
  };
}

export function createSyncProgressNotification(
  current: number,
  total: number
): Omit<InAppNotification, 'id' | 'createdAt' | 'read' | 'dismissed'> {
  return {
    type: 'sync_progress',
    title: '☁️ Syncing Transactions',
    body: `Uploading ${current} of ${total} transactions...`,
    priority: 'low',
    icon: 'upload-cloud',
    iconColor: '#3B82F6',
    metadata: { current, total },
  };
}

export function createSyncCompleteNotification(
  count: number
): Omit<InAppNotification, 'id' | 'createdAt' | 'read' | 'dismissed'> {
  return {
    type: 'sync_complete',
    title: '✓ Sync Complete',
    body: `Successfully synced ${count} transaction${count === 1 ? '' : 's'}`,
    priority: 'low',
    icon: 'check-circle',
    iconColor: '#10B981',
    metadata: { count },
  };
}

export function createSyncPausedNotification(
  remaining: number
): Omit<InAppNotification, 'id' | 'createdAt' | 'read' | 'dismissed'> {
  return {
    type: 'sync_paused',
    title: '☁️ Syncing in Background',
    body: `${remaining} transaction${remaining === 1 ? '' : 's'} syncing in the background`,
    priority: 'medium',
    icon: 'cloud',
    iconColor: '#3B82F6',
    metadata: { remaining },
  };
}

export function createSyncFailedNotification(
  failedCount: number
): Omit<InAppNotification, 'id' | 'createdAt' | 'read' | 'dismissed'> {
  return {
    type: 'sync_failed',
    title: '⚠️ Sync Failed',
    body: `${failedCount} transaction${failedCount === 1 ? '' : 's'} failed to sync`,
    priority: 'high',
    icon: 'alert-circle',
    iconColor: '#EF4444',
    metadata: { failedCount },
  };
}

export function createDeleteProgressNotification(
  deleted: number,
  total: number
): Omit<InAppNotification, 'id' | 'createdAt' | 'read' | 'dismissed'> {
  const percentage = total > 0 ? Math.round((deleted / total) * 100) : 0;
  return {
    type: 'delete_progress',
    title: '🗑️ Deleting Transactions',
    body: `Removing transactions... ${percentage}% complete`,
    priority: 'low',
    icon: 'trash-2',
    iconColor: '#EF4444',
    metadata: { deleted, total, percentage },
  };
}

export function createDeleteCompleteNotification(
  count: number
): Omit<InAppNotification, 'id' | 'createdAt' | 'read' | 'dismissed'> {
  return {
    type: 'delete_complete',
    title: '✓ Delete Complete',
    body: `Successfully removed ${count} transaction${count === 1 ? '' : 's'}`,
    priority: 'low',
    icon: 'check-circle',
    iconColor: '#10B981',
    metadata: { count },
  };
}

export function createDeletePausedNotification(): Omit<InAppNotification, 'id' | 'createdAt' | 'read' | 'dismissed'> {
  return {
    type: 'delete_paused',
    title: '🗑️ Deleting in Background',
    body: 'Deletion continues in the background',
    priority: 'medium',
    icon: 'trash-2',
    iconColor: '#EF4444',
  };
}

export function createDeleteFailedNotification(
  error: string
): Omit<InAppNotification, 'id' | 'createdAt' | 'read' | 'dismissed'> {
  return {
    type: 'delete_failed',
    title: '⚠️ Delete Failed',
    body: error || 'Failed to delete transactions',
    priority: 'high',
    icon: 'alert-circle',
    iconColor: '#EF4444',
    metadata: { error },
  };
}
