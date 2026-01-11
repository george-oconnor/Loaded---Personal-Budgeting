import { daysSinceImport, getStaleAccounts, type AccountImportRecord } from '@/lib/notifications';
import { useSessionStore } from '@/store/useSessionStore';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';

type BannerType = 'warning' | 'info' | 'error' | 'success';

type BannerConfig = {
  type: BannerType;
  icon: string;
  title: string;
  message: string;
  action?: () => void;
  actionLabel?: string;
};

const BANNER_COLORS: Record<BannerType, { bg: string; border: string; icon: string; text: string }> = {
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', icon: '#D97706', text: 'text-amber-800' },
  info: { bg: 'bg-blue-50', border: 'border-blue-200', icon: '#2563EB', text: 'text-blue-800' },
  error: { bg: 'bg-red-50', border: 'border-red-200', icon: '#DC2626', text: 'text-red-800' },
  success: { bg: 'bg-green-50', border: 'border-green-200', icon: '#059669', text: 'text-green-800' },
};

export function ImportReminderBanner() {
  const { user } = useSessionStore();
  const [staleAccounts, setStaleAccounts] = useState<AccountImportRecord[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const fadeAnim = useState(() => new Animated.Value(0))[0];

  useEffect(() => {
    const checkStaleAccounts = async () => {
      if (!user?.id) return;
      
      const stale = await getStaleAccounts(14); // 2 weeks threshold
      setStaleAccounts(stale);
      
      if (stale.length > 0 && !dismissed) {
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      }
    };

    checkStaleAccounts();
    // Check every time the component mounts or user changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, dismissed]);

  const handleDismiss = () => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setDismissed(true));
  };

  const handlePress = () => {
    if (staleAccounts.length === 1) {
      // Go directly to the import screen for that provider
      router.push(`/import/${staleAccounts[0].provider}` as any);
    } else {
      // Go to import selection
      router.push('/import');
    }
  };

  if (dismissed || staleAccounts.length === 0) {
    return null;
  }

  const oldestAccount = staleAccounts.reduce((oldest, current) => {
    const oldestDays = daysSinceImport(oldest.lastImportDate);
    const currentDays = daysSinceImport(current.lastImportDate);
    return currentDays > oldestDays ? current : oldest;
  }, staleAccounts[0]);

  const days = daysSinceImport(oldestAccount.lastImportDate);
  const colors = days >= 21 ? BANNER_COLORS.error : BANNER_COLORS.warning;

  return (
    <Animated.View
      style={{ opacity: fadeAnim }}
      className={`mx-4 mb-4 rounded-xl ${colors.bg} border ${colors.border} p-4`}
    >
      <View className="flex-row items-start">
        <View className="mr-3">
          <Feather 
            name={days >= 21 ? 'alert-circle' : 'alert-triangle'} 
            size={20} 
            color={colors.icon} 
          />
        </View>
        <View className="flex-1">
          <Text className={`text-sm font-semibold ${colors.text}`}>
            {staleAccounts.length === 1 
              ? `${oldestAccount.accountName} needs an update`
              : `${staleAccounts.length} accounts need updates`
            }
          </Text>
          <Text className={`text-xs ${colors.text} opacity-80 mt-0.5`}>
            {staleAccounts.length === 1
              ? `Last import was ${days} days ago`
              : `Some accounts haven't been updated in ${days}+ days`
            }
          </Text>
          <Pressable onPress={handlePress} className="mt-2">
            <Text className={`text-xs font-semibold ${colors.text} underline`}>
              Import now →
            </Text>
          </Pressable>
        </View>
        <Pressable onPress={handleDismiss} hitSlop={8} className="p-1">
          <Feather name="x" size={16} color={colors.icon} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

// Generic notification banner that can be used elsewhere
export function NotificationBanner({
  type,
  icon,
  title,
  message,
  action,
  actionLabel,
  onDismiss,
}: BannerConfig & { onDismiss?: () => void }) {
  const colors = BANNER_COLORS[type];

  return (
    <View className={`mx-4 mb-4 rounded-xl ${colors.bg} border ${colors.border} p-4`}>
      <View className="flex-row items-start">
        <View className="mr-3">
          <Feather name={icon as any} size={20} color={colors.icon} />
        </View>
        <View className="flex-1">
          <Text className={`text-sm font-semibold ${colors.text}`}>{title}</Text>
          <Text className={`text-xs ${colors.text} opacity-80 mt-0.5`}>{message}</Text>
          {action && actionLabel && (
            <Pressable onPress={action} className="mt-2">
              <Text className={`text-xs font-semibold ${colors.text} underline`}>
                {actionLabel} →
              </Text>
            </Pressable>
          )}
        </View>
        {onDismiss && (
          <Pressable onPress={onDismiss} hitSlop={8} className="p-1">
            <Feather name="x" size={16} color={colors.icon} />
          </Pressable>
        )}
      </View>
    </View>
  );
}
