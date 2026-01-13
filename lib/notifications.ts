import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';
import { captureException } from './sentry';

// Storage keys
const NOTIFICATION_PERMISSION_KEY = '@notification_permission';
const PUSH_TOKEN_KEY = '@push_token';
const LAST_IMPORT_DATES_KEY = '@last_import_dates';
const SCHEDULED_NOTIFICATIONS_KEY = '@scheduled_notifications';

// Notification identifiers
export const NOTIFICATION_IDS = {
  IMPORT_REMINDER: 'import-reminder',
  BUDGET_WARNING: 'budget-warning',
  BUDGET_EXCEEDED: 'budget-exceeded',
  BUDGET_ON_TRACK: 'budget-on-track',
  ACCOUNT_STALE: 'account-stale',
} as const;

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Request notification permissions from the user
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    const granted = finalStatus === 'granted';
    await AsyncStorage.setItem(NOTIFICATION_PERMISSION_KEY, granted ? 'granted' : 'denied');
    
    return granted;
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}

/**
 * Check if notifications are enabled
 */
export async function areNotificationsEnabled(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Get push token for remote notifications (future use)
 */
export async function getPushToken(): Promise<string | null> {
  try {
    // Check if we have a cached token
    const cached = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (cached) return cached;

    const hasPermission = await areNotificationsEnabled();
    if (!hasPermission) return null;

    // For Expo, we use Expo Push Token
    const token = await Notifications.getExpoPushTokenAsync({
      projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
    });

    if (token?.data) {
      await AsyncStorage.setItem(PUSH_TOKEN_KEY, token.data);
      return token.data;
    }

    return null;
  } catch (error) {
    console.warn('Failed to get push token:', error);
    return null;
  }
}

// Types for import tracking
export type AccountImportRecord = {
  accountKey: string;
  accountName: string;
  provider: string; // 'revolut' | 'aib'
  lastImportDate: string; // ISO timestamp
};

/**
 * Save the last import date for an account
 */
export async function saveLastImportDate(
  accountKey: string,
  accountName: string,
  provider: string
): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(LAST_IMPORT_DATES_KEY);
    const records: AccountImportRecord[] = stored ? JSON.parse(stored) : [];
    
    const existingIndex = records.findIndex(r => r.accountKey === accountKey);
    const newRecord: AccountImportRecord = {
      accountKey,
      accountName,
      provider,
      lastImportDate: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      records[existingIndex] = newRecord;
    } else {
      records.push(newRecord);
    }

    await AsyncStorage.setItem(LAST_IMPORT_DATES_KEY, JSON.stringify(records));
  } catch (error) {
    console.error('Failed to save last import date:', error);
    captureException(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Get all account import records
 */
export async function getLastImportDates(): Promise<AccountImportRecord[]> {
  try {
    const stored = await AsyncStorage.getItem(LAST_IMPORT_DATES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to get last import dates:', error);
    return [];
  }
}

/**
 * Check which accounts have stale imports (older than specified days)
 */
export async function getStaleAccounts(daysThreshold: number = 14): Promise<AccountImportRecord[]> {
  const records = await getLastImportDates();
  const now = new Date();
  const thresholdMs = daysThreshold * 24 * 60 * 60 * 1000;

  return records.filter(record => {
    const lastImport = new Date(record.lastImportDate);
    const age = now.getTime() - lastImport.getTime();
    return age > thresholdMs;
  });
}

/**
 * Calculate days since last import for an account
 */
export function daysSinceImport(lastImportDate: string): number {
  const lastImport = new Date(lastImportDate);
  const now = new Date();
  const diffMs = now.getTime() - lastImport.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

// Budget status types
export type BudgetStatus = 'on-track' | 'close-to-limit' | 'over-budget' | 'under-budget';

export type BudgetStatusInfo = {
  status: BudgetStatus;
  percentage: number;
  remaining: number;
  daysRemaining: number;
  dailyBudget: number;
  projectedOverspend?: number;
};

/**
 * Calculate budget status based on spending and budget
 */
export function calculateBudgetStatus(
  totalExpenses: number,
  monthlyBudget: number,
  cycleStartDate: Date,
  cycleEndDate?: Date
): BudgetStatusInfo {
  const now = new Date();
  const endDate = cycleEndDate || new Date(cycleStartDate);
  if (!cycleEndDate) {
    endDate.setMonth(endDate.getMonth() + 1);
  }

  const totalDays = Math.ceil((endDate.getTime() - cycleStartDate.getTime()) / (24 * 60 * 60 * 1000));
  const daysElapsed = Math.ceil((now.getTime() - cycleStartDate.getTime()) / (24 * 60 * 60 * 1000));
  const daysRemaining = Math.max(0, totalDays - daysElapsed);

  const percentage = monthlyBudget > 0 ? (Math.abs(totalExpenses) / monthlyBudget) * 100 : 0;
  const remaining = monthlyBudget - Math.abs(totalExpenses);
  const dailyBudget = daysRemaining > 0 ? remaining / daysRemaining : 0;

  // Projected spending based on current rate
  const dailyRate = daysElapsed > 0 ? Math.abs(totalExpenses) / daysElapsed : 0;
  const projectedTotal = dailyRate * totalDays;
  const projectedOverspend = projectedTotal > monthlyBudget ? projectedTotal - monthlyBudget : undefined;

  let status: BudgetStatus;
  if (percentage >= 100) {
    status = 'over-budget';
  } else if (percentage >= 85) {
    status = 'close-to-limit';
  } else if (percentage < 50 && daysElapsed > totalDays / 2) {
    status = 'under-budget';
  } else {
    status = 'on-track';
  }

  return {
    status,
    percentage,
    remaining,
    daysRemaining,
    dailyBudget,
    projectedOverspend,
  };
}

/**
 * Schedule a local notification
 */
export async function scheduleNotification(
  id: string,
  title: string,
  body: string,
  trigger: Notifications.NotificationTriggerInput,
  data?: Record<string, any>
): Promise<string | null> {
  try {
    const hasPermission = await areNotificationsEnabled();
    if (!hasPermission) {
      console.log('Notifications not enabled, skipping schedule');
      return null;
    }

    // Cancel any existing notification with the same identifier
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});

    const notificationId = await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title,
        body,
        data: { ...data, notificationId: id },
        sound: true,
        badge: 1,
      },
      trigger,
    });

    // Track scheduled notification
    await trackScheduledNotification(id, title, trigger);

    return notificationId;
  } catch (error) {
    console.error('Failed to schedule notification:', error);
    captureException(error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

/**
 * Schedule import reminder notification
 */
export async function scheduleImportReminder(
  accountName: string,
  provider: string,
  daysSinceLastImport: number
): Promise<string | null> {
  const id = `${NOTIFICATION_IDS.ACCOUNT_STALE}-${provider}`;
  
  const trigger: Notifications.TimeIntervalTriggerInput = {
    type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    seconds: 5, // Immediate for testing, can be adjusted
  };
  
  return scheduleNotification(
    id,
    `Time to update ${accountName}`,
    `It's been ${daysSinceLastImport} days since your last ${provider.toUpperCase()} import. Keep your budget accurate with fresh data!`,
    trigger,
    { type: 'import_reminder', provider, accountName }
  );
}

/**
 * Schedule budget notification only when app is in background to avoid interrupting active users
 */
export async function scheduleBudgetNotificationWhenBackground(
  statusInfo: BudgetStatusInfo,
  currency: string = 'EUR'
): Promise<string | null> {
  // Only schedule push notifications if app is currently in background
  if (AppState.currentState === 'active') {
    console.log('App is active, skipping push notification for budget status');
    return null;
  }

  // Check if we already have a pending notification for this status type to avoid spam
  const scheduledNotifications = await getScheduledNotifications();
  const existingBudgetNotification = scheduledNotifications.find(notification => {
    const id = notification.identifier;
    return id === NOTIFICATION_IDS.BUDGET_WARNING || 
           id === NOTIFICATION_IDS.BUDGET_EXCEEDED || 
           id === NOTIFICATION_IDS.BUDGET_ON_TRACK;
  });

  if (existingBudgetNotification) {
    console.log('Budget notification already scheduled, skipping duplicate');
    return null;
  }

  // Schedule with a reasonable delay (1-2 hours) to allow user to return to app naturally
  const delayMinutes = statusInfo.status === 'over-budget' ? 60 : 120; // Sooner for exceeded budget
  return scheduleBudgetNotification(statusInfo, currency, delayMinutes);
}

/**
 * Schedule budget warning notification
 */
export async function scheduleBudgetNotification(
  statusInfo: BudgetStatusInfo,
  currency: string = 'EUR',
  delayMinutes: number = 30 // Default to 30 minutes delay
): Promise<string | null> {
  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount / 100);
  };

  let id: string;
  let title: string;
  let body: string;

  switch (statusInfo.status) {
    case 'over-budget':
      id = NOTIFICATION_IDS.BUDGET_EXCEEDED;
      title = '🚨 Budget Exceeded';
      body = `You've exceeded your budget by ${formatAmount(Math.abs(statusInfo.remaining))}. Review your spending in the app.`;
      break;
    case 'close-to-limit':
      id = NOTIFICATION_IDS.BUDGET_WARNING;
      title = '⚠️ Budget Alert';
      body = `You've used ${Math.round(statusInfo.percentage)}% of your budget. ${formatAmount(statusInfo.remaining)} remaining for ${statusInfo.daysRemaining} days.`;
      break;
    case 'under-budget':
      id = NOTIFICATION_IDS.BUDGET_ON_TRACK;
      title = '✨ Great Progress!';
      body = `You're under budget! ${formatAmount(statusInfo.remaining)} left with ${statusInfo.daysRemaining} days to go.`;
      break;
    default:
      return null; // Don't notify for on-track status
  }

  const trigger: Notifications.TimeIntervalTriggerInput = {
    type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    seconds: delayMinutes * 60, // Convert minutes to seconds
  };

  return scheduleNotification(
    id,
    title,
    body,
    trigger,
    { type: 'budget_status', status: statusInfo.status, percentage: statusInfo.percentage }
  );
}

/**
 * Schedule daily budget check notification
 * Schedules multiple times per day for better awareness
 */
export async function scheduleDailyBudgetCheck(): Promise<string[]> {
  const notificationTimes = [
    { hour: 12, minute: 0, label: 'midday' },   // Noon check
    { hour: 18, minute: 0, label: 'evening' },  // 6 PM check
    { hour: 21, minute: 0, label: 'night' },    // 9 PM final check
  ];

  const scheduledIds: string[] = [];

  for (const time of notificationTimes) {
    const id = `daily-budget-check-${time.label}`;
    
    const trigger: Notifications.DailyTriggerInput = {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: time.hour,
      minute: time.minute,
    };

    const body = time.hour === 21 
      ? 'End of day budget review - see how you did today'
      : time.hour === 18
      ? 'Evening budget check - stay on track for the rest of the day'
      : 'Lunchtime budget check - see your spending so far';

    const notificationId = await scheduleNotification(
      id,
      '📊 Budget Check',
      body,
      trigger,
      { type: 'daily_check', timeOfDay: time.label }
    );
    
    if (notificationId) {
      scheduledIds.push(notificationId);
    }
  }

  return scheduledIds;
}

/**
 * Schedule weekly import reminder
 * Reminds users twice per week for better engagement
 */
export async function scheduleWeeklyImportReminder(): Promise<string[]> {
  const scheduledIds: string[] = [];
  
  // Sunday evening reminder
  const sundayTrigger: Notifications.WeeklyTriggerInput = {
    type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
    weekday: 1, // Sunday
    hour: 18,
    minute: 0,
  };

  const sundayId = await scheduleNotification(
    NOTIFICATION_IDS.IMPORT_REMINDER + '-sunday',
    '📥 Weekend Import Reminder',
    'Start the week fresh! Import your latest transactions to keep your budget accurate.',
    sundayTrigger,
    { type: 'import_reminder', day: 'sunday' }
  );

  if (sundayId) scheduledIds.push(sundayId);

  // Wednesday evening reminder (mid-week check-in)
  const wednesdayTrigger: Notifications.WeeklyTriggerInput = {
    type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
    weekday: 4, // Wednesday
    hour: 19,
    minute: 0,
  };

  const wednesdayId = await scheduleNotification(
    NOTIFICATION_IDS.IMPORT_REMINDER + '-wednesday',
    '📊 Mid-Week Import Check',
    'Time for a mid-week update! Import your recent transactions to stay on top of your budget.',
    wednesdayTrigger,
    { type: 'import_reminder', day: 'wednesday' }
  );

  if (wednesdayId) scheduledIds.push(wednesdayId);

  return scheduledIds;
}

/**
 * Schedule smart budget milestone notifications
 * Tracks when user crosses budget thresholds and sends timely alerts
 */
export async function scheduleBudgetMilestoneNotification(
  percentage: number,
  remaining: number,
  daysRemaining: number,
  currency: string = 'EUR'
): Promise<string | null> {
  // Don't spam - only notify at key milestones
  const milestones = [50, 75, 85, 90, 100];
  const milestone = milestones.find(m => percentage >= m && percentage < m + 5);
  
  if (!milestone) return null;

  // Check if we've already notified for this milestone this cycle
  const milestoneKey = `@budget_milestone_${milestone}`;
  const lastNotified = await AsyncStorage.getItem(milestoneKey);
  
  if (lastNotified) {
    const lastDate = new Date(lastNotified);
    const now = new Date();
    // If we notified in the last 24 hours, skip
    if (now.getTime() - lastDate.getTime() < 24 * 60 * 60 * 1000) {
      return null;
    }
  }

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount / 100);
  };

  let title: string;
  let body: string;
  let id: string;

  if (milestone === 100) {
    id = NOTIFICATION_IDS.BUDGET_EXCEEDED;
    title = '🚨 Budget Exceeded';
    body = `You've spent ${Math.round(percentage)}% of your budget. Time to review your spending!`;
  } else if (milestone >= 90) {
    id = NOTIFICATION_IDS.BUDGET_WARNING;
    title = '⚠️ Almost at Budget Limit';
    body = `${milestone}% of budget used. Only ${formatAmount(remaining)} left for ${daysRemaining} days.`;
  } else if (milestone >= 75) {
    id = 'budget-milestone-75';
    title = '📊 Budget Update';
    body = `You've used ${milestone}% of your budget. ${formatAmount(remaining)} remaining.`;
  } else {
    id = 'budget-milestone-50';
    title = '✓ Halfway There';
    body = `${milestone}% of budget used. ${formatAmount(remaining)} left for the cycle.`;
  }

  // Schedule for immediate delivery
  const trigger: Notifications.TimeIntervalTriggerInput = {
    type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    seconds: 5, // 5 seconds delay to avoid spam
  };

  // Mark this milestone as notified
  await AsyncStorage.setItem(milestoneKey, new Date().toISOString());

  return scheduleNotification(
    id,
    title,
    body,
    trigger,
    { type: 'budget_milestone', milestone, percentage, remaining }
  );
}

/**
 * Cancel a scheduled notification
 */
export async function cancelNotification(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
    await removeTrackedNotification(id);
  } catch (error) {
    console.error('Failed to cancel notification:', error);
  }
}

/**
 * Cancel all scheduled notifications
 */
export async function cancelAllNotifications(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    await AsyncStorage.removeItem(SCHEDULED_NOTIFICATIONS_KEY);
  } catch (error) {
    console.error('Failed to cancel all notifications:', error);
  }
}

/**
 * Clear budget milestone tracking for new cycle
 * Call this when a new budget cycle starts
 */
export async function clearBudgetMilestones(): Promise<void> {
  try {
    const milestones = [50, 75, 85, 90, 100];
    for (const milestone of milestones) {
      await AsyncStorage.removeItem(`@budget_milestone_${milestone}`);
    }
    console.log('Budget milestones cleared for new cycle');
  } catch (error) {
    console.error('Failed to clear budget milestones:', error);
  }
}

/**
 * Get all scheduled notifications
 */
export async function getScheduledNotifications(): Promise<Notifications.NotificationRequest[]> {
  try {
    return await Notifications.getAllScheduledNotificationsAsync();
  } catch (error) {
    console.error('Failed to get scheduled notifications:', error);
    return [];
  }
}

// Tracking helpers for scheduled notifications
async function trackScheduledNotification(
  id: string,
  title: string,
  trigger: Notifications.NotificationTriggerInput
): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(SCHEDULED_NOTIFICATIONS_KEY);
    const notifications = stored ? JSON.parse(stored) : {};
    notifications[id] = { title, scheduledAt: new Date().toISOString(), trigger };
    await AsyncStorage.setItem(SCHEDULED_NOTIFICATIONS_KEY, JSON.stringify(notifications));
  } catch (error) {
    console.error('Failed to track notification:', error);
  }
}

async function removeTrackedNotification(id: string): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(SCHEDULED_NOTIFICATIONS_KEY);
    if (stored) {
      const notifications = JSON.parse(stored);
      delete notifications[id];
      await AsyncStorage.setItem(SCHEDULED_NOTIFICATIONS_KEY, JSON.stringify(notifications));
    }
  } catch (error) {
    console.error('Failed to remove tracked notification:', error);
  }
}

/**
 * Set badge count
 */
export async function setBadgeCount(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch (error) {
    console.error('Failed to set badge count:', error);
  }
}

/**
 * Clear badge count
 */
export async function clearBadgeCount(): Promise<void> {
  await setBadgeCount(0);
}
