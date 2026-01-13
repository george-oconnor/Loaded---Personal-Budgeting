import { getCycleStartDate } from '@/lib/budgetCycle';
import {
    areNotificationsEnabled,
    calculateBudgetStatus,
    clearBadgeCount,
    daysSinceImport,
    getLastImportDates,
    getStaleAccounts,
    requestNotificationPermissions,
    scheduleBudgetMilestoneNotification,
    scheduleBudgetNotificationWhenBackground,
    scheduleDailyBudgetCheck,
    scheduleImportReminder,
    scheduleWeeklyImportReminder,
} from '@/lib/notifications';
import { useHomeStore } from '@/store/useHomeStore';
import {
    createBudgetExceededNotification,
    createBudgetOnTrackNotification,
    createBudgetWarningNotification,
    createGeneralImportReminderNotification,
    createImportReminderNotification,
    useNotificationStore,
} from '@/store/useNotificationStore';
import { useSessionStore } from '@/store/useSessionStore';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

// Configuration
const STALE_IMPORT_THRESHOLD_DAYS = 14; // 2 weeks
const BUDGET_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const IMPORT_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Hook to manage all notification-related functionality
 */
export function useNotifications() {
  const { user } = useSessionStore();
  const { summary, cycleType, cycleDay } = useHomeStore();
  const { addNotification, loadNotifications, unreadCount } = useNotificationStore();
  
  const lastBudgetCheck = useRef(0);
  const lastImportCheck = useRef(0);
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);
  const initialized = useRef(false);

  // Initialize notifications on mount
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const initializeNotifications = async () => {
      // Load existing in-app notifications
      await loadNotifications();

      // Request permissions
      const granted = await requestNotificationPermissions();
      if (!granted) {
        console.log('Notification permissions not granted');
        return;
      }

      // Schedule recurring notifications
      await scheduleWeeklyImportReminder();
      await scheduleDailyBudgetCheck();

      // Clear badge on app open
      await clearBadgeCount();
    };

    initializeNotifications();

    // Listen for incoming notifications
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
      // Could add to in-app notifications here if needed
    });

    // Listen for notification responses (user taps)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      handleNotificationPress(data);
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle notification taps
  const handleNotificationPress = (data: Record<string, any>) => {
    const { type, provider } = data;

    switch (type) {
      case 'import_reminder':
        if (provider) {
          router.push(`/import/${provider.toLowerCase()}` as any);
        } else {
          router.push('/import' as any);
        }
        break;
      case 'budget_status':
      case 'daily_check':
        router.push('/spend-analytics' as any);
        break;
      default:
        // Default to home
        router.push('/');
    }

    // Clear badge when user interacts with notification
    clearBadgeCount();
  };

  // Check budget status and create notifications
  const checkBudgetStatus = async () => {
    if (!user?.id || !summary) return;

    const now = Date.now();
    if (now - lastBudgetCheck.current < BUDGET_CHECK_INTERVAL_MS) {
      return; // Skip if checked recently
    }
    lastBudgetCheck.current = now;

    try {
      const cycleStart = getCycleStartDate(cycleType, cycleDay);
      const expenses = summary.expenses || 0;
      const budget = summary.monthlyBudget || 0;

      if (budget <= 0) return; // No budget set

      const statusInfo = calculateBudgetStatus(expenses, budget, cycleStart);

      // Use smart milestone notifications for better engagement
      const enabled = await areNotificationsEnabled();
      if (enabled) {
        await scheduleBudgetMilestoneNotification(
          statusInfo.percentage,
          statusInfo.remaining,
          statusInfo.daysRemaining,
          summary.currency
        );
      }

      // Also create in-app notifications for important events
      if (statusInfo.status === 'over-budget') {
        await addNotification(createBudgetExceededNotification(
          Math.abs(statusInfo.remaining),
          summary.currency
        ));
        
        if (enabled) {
          await scheduleBudgetNotificationWhenBackground(statusInfo, summary.currency);
        }
      } else if (statusInfo.status === 'close-to-limit') {
        await addNotification(createBudgetWarningNotification(
          statusInfo.percentage,
          statusInfo.remaining,
          statusInfo.daysRemaining,
          summary.currency
        ));

        if (enabled) {
          await scheduleBudgetNotificationWhenBackground(statusInfo, summary.currency);
        }
      } else if (statusInfo.status === 'under-budget' && statusInfo.daysRemaining <= 7) {
        // Only notify about being under budget near end of cycle
        await addNotification(createBudgetOnTrackNotification(
          statusInfo.remaining,
          statusInfo.daysRemaining,
          summary.currency
        ));
      }
    } catch (error) {
      console.error('Failed to check budget status:', error);
    }
  };

  // Check for stale imports and create notifications
  const checkStaleImports = async () => {
    if (!user?.id) return;

    const now = Date.now();
    if (now - lastImportCheck.current < IMPORT_CHECK_INTERVAL_MS) {
      return; // Skip if checked recently
    }
    lastImportCheck.current = now;

    try {
      const staleAccounts = await getStaleAccounts(STALE_IMPORT_THRESHOLD_DAYS);

      for (const account of staleAccounts) {
        const days = daysSinceImport(account.lastImportDate);
        
        // Create in-app notification
        await addNotification(createImportReminderNotification(
          account.accountName,
          account.provider,
          days
        ));

        // Send push notification for very stale accounts (3+ weeks)
        if (days >= 21) {
          const enabled = await areNotificationsEnabled();
          if (enabled) {
            await scheduleImportReminder(account.accountName, account.provider, days);
          }
        }
      }

      // If user has never imported, remind them
      const allImports = await getLastImportDates();
      if (allImports.length === 0) {
        await addNotification(createGeneralImportReminderNotification());
      }
    } catch (error) {
      console.error('Failed to check stale imports:', error);
    }
  };

  // Run checks when app becomes active
  useEffect(() => {
    const handleAppStateChange = (state: AppStateStatus) => {
      if (state === 'active') {
        clearBadgeCount();
        checkBudgetStatus();
        checkStaleImports();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Initial check
    if (user?.id && summary) {
      checkBudgetStatus();
      checkStaleImports();
    }

    return () => {
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, summary?.expenses, summary?.monthlyBudget]);

  return {
    checkBudgetStatus,
    checkStaleImports,
    handleNotificationPress,
    unreadCount,
  };
}

/**
 * Hook to handle notification responses
 */
export function useNotificationResponse() {
  useEffect(() => {
    // Check if app was opened from a notification
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (response) {
        const data = response.notification.request.content.data;
        // Handle the notification that opened the app
        if (data?.type) {
          switch (data.type) {
            case 'import_reminder':
              if (data.provider && typeof data.provider === 'string') {
                router.push(`/import/${data.provider.toLowerCase()}` as any);
              }
              break;
            case 'budget_status':
              router.push('/spend-analytics' as any);
              break;
          }
        }
      }
    });
  }, []);
}
