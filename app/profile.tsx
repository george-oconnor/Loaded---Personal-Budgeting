import { restoreLastBalanceSnapshot } from "@/lib/accountBalances";
import { deleteTransactionsByBatchId, getLastImportBatchId } from "@/lib/appwrite";
import { queueDeleteAll } from "@/lib/deleteQueue";
import {
    areNotificationsEnabled,
    cancelAllNotifications,
    daysSinceImport,
    getLastImportDates,
    requestNotificationPermissions,
    scheduleDailyBudgetCheck,
    scheduleWeeklyImportReminder,
} from "@/lib/notifications";
import { useHomeStore } from "@/store/useHomeStore";
import { useNotificationStore } from "@/store/useNotificationStore";
import { useSessionStore } from "@/store/useSessionStore";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    Switch,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ProfileScreen() {
  const { user, logout, deleteAccount } = useSessionStore();
  const { fetchHome } = useHomeStore();
  const { clearNotifications, unreadCount, openTray } = useNotificationStore();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [undoLoading, setUndoLoading] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [importRecords, setImportRecords] = useState<Array<{ accountName: string; provider: string; daysSince: number }>>([]);
  const initials = user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase() || "?";

  // Check notification permissions and load import history
  useEffect(() => {
    const checkNotifications = async () => {
      const enabled = await areNotificationsEnabled();
      setNotificationsEnabled(enabled);
    };
    
    const loadImportHistory = async () => {
      const records = await getLastImportDates();
      setImportRecords(records.map(r => ({
        accountName: r.accountName,
        provider: r.provider,
        daysSince: daysSinceImport(r.lastImportDate),
      })));
    };
    
    checkNotifications();
    loadImportHistory();
  }, []);

  const handleToggleNotifications = async (value: boolean) => {
    if (value) {
      const granted = await requestNotificationPermissions();
      if (granted) {
        setNotificationsEnabled(true);
        // Schedule default notifications
        await scheduleWeeklyImportReminder();
        await scheduleDailyBudgetCheck();
        Alert.alert("Notifications Enabled", "You'll receive reminders for imports and budget alerts.");
      } else {
        Alert.alert(
          "Permission Required",
          "Please enable notifications in your device settings to receive reminders.",
          [{ text: "OK" }]
        );
      }
    } else {
      await cancelAllNotifications();
      setNotificationsEnabled(false);
      Alert.alert("Notifications Disabled", "You won't receive any notifications from this app.");
    }
  };

  const handleClearNotifications = async () => {
    Alert.alert(
      "Clear All Notifications",
      "This will remove all in-app notifications. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await clearNotifications();
            Alert.alert("Done", "All notifications cleared.");
          },
        },
      ]
    );
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await logout();
      router.replace("/auth");
    } catch (err) {
      console.error("Logout failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAllTransactions = async () => {
    if (!user?.id) return;

    Alert.alert(
      "Delete All Transactions",
      "Are you sure you want to delete ALL your transactions? This action cannot be undone.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete All",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              await queueDeleteAll(user.id);
              
              Alert.alert(
                "Delete Queued",
                "Your transactions will be deleted in the background. Check the notification icon for progress."
              );
              
              // Refresh home data - it will update as transactions are deleted
              await fetchHome();
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : "Failed to queue deletion";
              Alert.alert("Error", errorMsg);
              console.error("Queue delete error:", error);
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  const handleUndoLastImport = async () => {
    if (!user?.id) {
      Alert.alert("Error", "User not authenticated");
      return;
    }

    Alert.alert(
      "Undo Last Import?",
      "This will delete all transactions from the last import and restore account balances. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Undo Import",
          style: "destructive",
          onPress: async () => {
            setUndoLoading(true);
            try {
              // Get the last import batch ID
              const batchId = await getLastImportBatchId(user.id);
              if (!batchId) {
                Alert.alert("No Import Found", "There is no recent import to undo.");
                setUndoLoading(false);
                return;
              }

              // Delete all transactions from that batch
              const result = await deleteTransactionsByBatchId(user.id, batchId);
              console.log(`Deleted ${result.deleted} transactions from batch ${batchId}`);

              // Restore balances from Appwrite snapshot for this batch
              const restored = await restoreLastBalanceSnapshot(user.id, batchId);
              
              if (restored) {
                Alert.alert(
                  "Import Undone",
                  `Deleted ${result.deleted} transactions and restored account balances.`
                );
              } else {
                Alert.alert(
                  "Partial Undo",
                  `Deleted ${result.deleted} transactions, but could not restore balances (no snapshot available).`
                );
              }

              // Refresh home data
              await fetchHome();
            } catch (err) {
              console.error("Error undoing import:", err);
              Alert.alert("Error", "Failed to undo the last import. Please try again.");
            } finally {
              setUndoLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleDeleteAccount = async () => {
    if (!user?.id) return;

    Alert.alert(
      "Delete Account",
      "Are you sure you want to permanently delete your account? This will delete all your data including transactions, budgets, and account balances. This action cannot be undone.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete Account",
          style: "destructive",
          onPress: () => {
            // Second confirmation for extra safety
            Alert.alert(
              "Final Confirmation",
              "This is permanent. Type DELETE to confirm you want to delete your account and all associated data.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Yes, Delete Everything",
                  style: "destructive",
                  onPress: async () => {
                    setDeletingAccount(true);
                    try {
                      const result = await deleteAccount();
                      
                      if (result.success) {
                        router.replace("/auth");
                      } else {
                        Alert.alert("Error", result.error || "Failed to delete account. Please try again.");
                      }
                    } catch (error) {
                      const errorMsg = error instanceof Error ? error.message : "Failed to delete account";
                      Alert.alert("Error", errorMsg);
                      console.error("Delete account error:", error);
                    } finally {
                      setDeletingAccount(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 20 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="bg-white -mx-5 px-5 pt-2 pb-6 mb-4">
          <View className="flex-row items-center justify-between">
            <Pressable
              onPress={() => router.back()}
              className="flex-row items-center gap-2"
            >
              <Feather name="chevron-left" size={20} color="#7C3AED" />
              <Text className="text-primary text-base font-semibold">Back</Text>
            </Pressable>
            <Text className="text-xs text-gray-500">Account</Text>
          </View>
          <View className="mt-1 items-end">
            <Text className="text-2xl font-bold text-dark-100">Profile</Text>
          </View>
        </View>

        {/* Avatar Section */}
        <View className="mb-8 items-center">
          <View className="h-24 w-24 items-center justify-center rounded-full bg-primary">
            <Text className="text-4xl font-bold text-white">
              {initials}
            </Text>
          </View>
        </View>

        {/* User Info */}
        <View className="mb-8 rounded-2xl bg-gray-50 p-4">
          <View className="mb-4">
            <Text className="text-xs font-semibold text-gray-500 mb-1">Name</Text>
            <Text className="text-base font-semibold text-dark-100">
              {user?.name || "Unknown"}
            </Text>
          </View>
          <View>
            <Text className="text-xs font-semibold text-gray-500 mb-1">Email</Text>
            <Text className="text-base font-semibold text-dark-100">
              {user?.email || "No email"}
            </Text>
          </View>
        </View>

        {/* Notification Settings */}
        <View className="mb-8 rounded-2xl bg-gray-50 p-4">
          <View className="flex-row items-center gap-2 mb-4">
            <Feather name="bell" size={18} color="#374151" />
            <Text className="text-base font-bold text-dark-100">Notifications</Text>
            {unreadCount > 0 && (
              <Pressable 
                onPress={openTray}
                className="bg-red-500 rounded-full px-2 py-0.5"
              >
                <Text className="text-xs font-bold text-white">{unreadCount} new</Text>
              </Pressable>
            )}
          </View>
          
          {/* Push Notifications Toggle */}
          <View className="flex-row items-center justify-between py-3 border-b border-gray-200">
            <View className="flex-1">
              <Text className="text-sm font-semibold text-dark-100">Push Notifications</Text>
              <Text className="text-xs text-gray-500">Budget alerts & import reminders</Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={handleToggleNotifications}
              trackColor={{ false: '#D1D5DB', true: '#7C3AED' }}
              thumbColor={notificationsEnabled ? '#fff' : '#f4f3f4'}
            />
          </View>

          {/* View Notifications */}
          <Pressable 
            onPress={openTray}
            className="flex-row items-center justify-between py-3 border-b border-gray-200"
          >
            <View className="flex-row items-center gap-2">
              <Feather name="inbox" size={16} color="#6B7280" />
              <Text className="text-sm text-gray-700">View Notifications</Text>
            </View>
            <View className="flex-row items-center gap-1">
              {unreadCount > 0 && (
                <View className="bg-indigo-100 rounded-full px-2 py-0.5 mr-1">
                  <Text className="text-xs font-semibold text-indigo-700">{unreadCount}</Text>
                </View>
              )}
              <Feather name="chevron-right" size={16} color="#9CA3AF" />
            </View>
          </Pressable>

          {/* Clear Notifications */}
          <Pressable 
            onPress={handleClearNotifications}
            className="flex-row items-center justify-between py-3"
          >
            <View className="flex-row items-center gap-2">
              <Feather name="trash" size={16} color="#6B7280" />
              <Text className="text-sm text-gray-700">Clear All Notifications</Text>
            </View>
            <Feather name="chevron-right" size={16} color="#9CA3AF" />
          </Pressable>
        </View>

        {/* Import History */}
        {importRecords.length > 0 && (
          <View className="mb-8 rounded-2xl bg-gray-50 p-4">
            <View className="flex-row items-center gap-2 mb-4">
              <Feather name="download" size={18} color="#374151" />
              <Text className="text-base font-bold text-dark-100">Import History</Text>
            </View>
            {importRecords.map((record, index) => (
              <View 
                key={`${record.provider}-${index}`}
                className={`flex-row items-center justify-between py-3 ${
                  index < importRecords.length - 1 ? 'border-b border-gray-200' : ''
                }`}
              >
                <View>
                  <Text className="text-sm font-semibold text-dark-100">{record.accountName}</Text>
                  <Text className="text-xs text-gray-500">{record.provider.toUpperCase()}</Text>
                </View>
                <View className="items-end">
                  <Text className={`text-sm font-semibold ${
                    record.daysSince >= 14 ? 'text-red-500' : 
                    record.daysSince >= 7 ? 'text-amber-500' : 'text-green-600'
                  }`}>
                    {record.daysSince === 0 ? 'Today' : 
                     record.daysSince === 1 ? 'Yesterday' : 
                     `${record.daysSince} days ago`}
                  </Text>
                  {record.daysSince >= 14 && (
                    <Text className="text-xs text-red-400">Needs update</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Action Buttons */}
        <View className="mt-auto mb-4">
          <Pressable
            onPress={handleUndoLastImport}
            disabled={undoLoading}
            className="flex-row items-center justify-center gap-2 bg-red-50 border border-red-200 rounded-2xl px-4 py-3 mb-3 active:opacity-70 disabled:opacity-50"
          >
            <Feather name="rotate-ccw" size={16} color="#EF4444" />
            <Text className="text-red-600 font-semibold text-sm">
              {undoLoading ? "Undoing..." : "Undo Last Import"}
            </Text>
            {undoLoading && <ActivityIndicator color="#EF4444" size="small" />}
          </Pressable>
          {user?.email === "george@georgeoc.com" && (
            <Pressable
              onPress={handleDeleteAllTransactions}
              disabled={deleting}
              className={`rounded-2xl py-4 items-center mb-3 ${
                deleting ? "bg-gray-300" : "bg-orange-500"
              }`}
            >
              {deleting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white text-base font-bold">Delete All Transactions</Text>
              )}
            </Pressable>
          )}
          <Pressable
            onPress={handleLogout}
            disabled={loading}
            className={`rounded-2xl py-4 items-center mb-3 ${
              loading ? "bg-gray-300" : "bg-red-500"
            }`}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white text-base font-bold">Logout</Text>
            )}
          </Pressable>

          {/* Delete Account Button */}
          <Pressable
            onPress={handleDeleteAccount}
            disabled={deletingAccount}
            className="flex-row items-center justify-center gap-2 border-2 border-red-600 rounded-2xl py-4 active:opacity-70 disabled:opacity-50"
          >
            <Feather name="trash-2" size={18} color="#DC2626" />
            {deletingAccount ? (
              <ActivityIndicator color="#DC2626" size="small" />
            ) : (
              <Text className="text-red-600 text-base font-bold">Delete Account</Text>
            )}
          </Pressable>
        </View>

        {/* Account Info */}
        <View className="mb-4 items-center">
          <Text className="text-xs text-gray-400">
            Account ID: {user?.id ? user.id.slice(0, 8) + "..." : "N/A"}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
