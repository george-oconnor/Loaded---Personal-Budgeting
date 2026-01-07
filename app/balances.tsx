import { getAccountBalances, removeAccountBalance, type AccountBalance } from "@/lib/accountBalances";
import { formatCurrency } from "@/lib/currencyFunctions";
import { useSessionStore } from "@/store/useSessionStore";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

export default function BalancesScreen() {
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const { user } = useSessionStore();

  const sortBalances = (data: AccountBalance[]) =>
    [...data].sort((a, b) => a.accountName.localeCompare(b.accountName));

  const loadBalances = async () => {
    try {
      const data = await getAccountBalances(user?.id);
      // Sort by account name for consistent display
      const sorted = sortBalances(data);
      setBalances(sorted);
    } catch (error) {
      console.error('Error loading balances:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadBalances();
  }, [user?.id]);

  const handleDeleteBalance = (account: AccountBalance) => {
    Alert.alert(
      "Delete balance?",
      `Remove ${account.accountName} from this list${user?.id ? " and Appwrite" : ""}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const pendingKey = account.accountKey || `${account.accountName}-${account.currency}`;
            setDeletingKey(pendingKey);
            try {
              const updated = await removeAccountBalance({
                accountName: account.accountName,
                currency: account.currency,
                accountKey: account.accountKey,
                accountType: account.accountType,
                provider: account.provider,
                userId: user?.id,
              });
              setBalances(sortBalances(updated));
            } catch (err) {
              console.error('Error deleting balance:', err);
              Alert.alert('Delete failed', 'We could not remove this balance. Please try again.');
              await loadBalances();
            } finally {
              setDeletingKey(null);
            }
          },
        },
      ]
    );
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadBalances();
  };

  const getAccountIcon = (accountName: string): string => {
    if (accountName.toLowerCase().includes('vault')) return 'lock';
    if (accountName.toLowerCase().includes('pocket')) return 'pocket';
    if (accountName.toLowerCase().includes('savings')) return 'trending-up';
    return 'credit-card';
  };

  const getAccountColor = (accountName: string): string => {
    if (accountName.toLowerCase().includes('revolut')) return '#7C3AED';
    if (accountName.toLowerCase().includes('aib')) return '#10B981';
    return '#6366F1';
  };

  const formatDate = (dateString: string) => {
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
    
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const categorizeAccount = (account: AccountBalance): 'savings' | 'current' => {
    const name = account.accountName.toLowerCase();
    const type = account.accountType?.toLowerCase();
    
    // Vault counts as savings
    if (name.includes('vault') || type === 'vault') return 'savings';
    // Pocket counts as current
    if (name.includes('pocket') || type === 'pocket') return 'current';
    // Use accountType if available
    if (type === 'savings') return 'savings';
    // Default to current
    return 'current';
  };

  const currentAccounts = balances.filter(acc => categorizeAccount(acc) === 'current');
  const savingsAccounts = balances.filter(acc => categorizeAccount(acc) === 'savings');

  // Calculate subtotals
  const currentTotal = currentAccounts.reduce((sum, account) => sum + account.balance, 0);
  const savingsTotal = savingsAccounts.reduce((sum, account) => sum + account.balance, 0);

  // Calculate total across all accounts
  const totalBalance = balances.reduce((sum, account) => {
    // Convert to GBP if needed (simplified - you might want proper currency conversion)
    return sum + account.balance;
  }, 0);

  return (
    <SafeAreaView className="flex-1 bg-white">
      {/* Header */}
      <View className="bg-white px-5 pt-2 pb-6">
        <View className="flex-row items-center justify-between">
          <Pressable
            onPress={() => router.back()}
            className="flex-row items-center gap-2"
          >
            <Feather name="chevron-left" size={20} color="#7C3AED" />
            <Text className="text-primary text-base font-semibold">Back</Text>
          </Pressable>
          
          <Text className="text-xs text-gray-500">Account Balances</Text>
        </View>
        
        <View className="mt-1">
          <Text className="text-2xl font-bold text-dark-100 text-right">Your Accounts</Text>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#7C3AED" />
        </View>
      ) : balances.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Feather name="credit-card" size={64} color="#D1D5DB" />
          <Text className="text-gray-400 text-center mt-4 text-lg font-semibold">
            No Account Balances
          </Text>
          <Text className="text-gray-400 text-center mt-2">
            Import transactions to see your account balances here
          </Text>
          <Pressable
            onPress={() => router.push('/import')}
            className="mt-6 bg-primary px-6 py-3 rounded-full active:opacity-80"
          >
            <Text className="text-white font-semibold">Import Transactions</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 0 }}
          style={{ marginTop: -20 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        >
          {/* Total Balance Card */}
          <View className="px-5 mb-6 pt-5" style={{ zIndex: 10, elevation: 10 }}>
            <View className="rounded-3xl bg-primary px-6 py-6 shadow-md">
              <Text className="text-white/80 text-sm mb-1">Total Balance</Text>
              <Text className="text-white text-4xl font-bold">
                {formatCurrency(totalBalance / 100, balances[0]?.currency || 'GBP')}
              </Text>
              <Text className="text-white/60 text-xs mt-2">
                Across {balances.length} account{balances.length !== 1 ? 's' : ''}
              </Text>
            </View>
          </View>

          {/* Account List */}
          <View className="px-5 pb-6">
            {/* Current Accounts */}
            {currentAccounts.length > 0 && (
              <View className="mb-6">
                <Text className="text-lg font-bold text-dark-100 mb-3">Current Accounts</Text>
                <View className="gap-3">
                  {currentAccounts.map((account, index) => {
                    const iconName = getAccountIcon(account.accountName);
                    const color = getAccountColor(account.accountName);
                    const rowKey = account.accountKey || `${account.accountName}-${account.currency}-${index}`;
                    
                    return (
                      <Swipeable
                        key={rowKey}
                        renderRightActions={() => (
                          <Pressable
                            onPress={() => handleDeleteBalance(account)}
                            className="flex-row items-center justify-center px-4 bg-red-500 rounded-2xl ml-2"
                            style={{ width: 96 }}
                          >
                            <Feather name="trash-2" size={18} color="#fff" />
                            <Text className="text-white font-semibold ml-2">Delete</Text>
                          </Pressable>
                        )}
                        overshootRight={false}
                      >
                        <View
                          className="flex-row items-center rounded-2xl bg-gray-50 px-4 py-4 border border-gray-100"
                          style={deletingKey === rowKey ? { opacity: 0.5 } : undefined}
                        >
                          <View
                            className="w-12 h-12 rounded-full items-center justify-center mr-4"
                            style={{ backgroundColor: `${color}15` }}
                          >
                            <Feather name={iconName as any} size={20} color={color} />
                          </View>
                          <View className="flex-1 mr-3">
                            <Text className="font-semibold text-dark-100 text-base" numberOfLines={1} ellipsizeMode="tail">
                              {account.accountName}
                            </Text>
                            <Text className="text-xs text-gray-500 mt-1">
                              Updated {formatDate(account.lastUpdated)}
                            </Text>
                          </View>
                          <View className="items-end flex-shrink-0">
                            <Text
                              className="font-bold text-lg"
                              style={{ color }}
                            >
                              {formatCurrency(account.balance / 100, account.currency)}
                            </Text>
                            <Text className="text-xs text-gray-500 mt-1">
                              {account.currency}
                            </Text>
                          </View>
                        </View>
                      </Swipeable>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Savings Accounts */}
            {savingsAccounts.length > 0 && (
              <View>
                <Text className="text-lg font-bold text-dark-100 mb-3">Savings Accounts</Text>
                <View className="gap-3">
                  {savingsAccounts.map((account, index) => {
                    const iconName = getAccountIcon(account.accountName);
                    const color = getAccountColor(account.accountName);
                    const rowKey = account.accountKey || `${account.accountName}-${account.currency}-${index}`;
                    
                    return (
                      <Swipeable
                        key={rowKey}
                        renderRightActions={() => (
                          <Pressable
                            onPress={() => handleDeleteBalance(account)}
                            className="flex-row items-center justify-center px-4 bg-red-500 rounded-2xl ml-2"
                            style={{ width: 96 }}
                          >
                            <Feather name="trash-2" size={18} color="#fff" />
                            <Text className="text-white font-semibold ml-2">Delete</Text>
                          </Pressable>
                        )}
                        overshootRight={false}
                      >
                        <View
                          className="flex-row items-center rounded-2xl bg-gray-50 px-4 py-4 border border-gray-100"
                          style={deletingKey === rowKey ? { opacity: 0.5 } : undefined}
                        >
                          <View
                            className="w-12 h-12 rounded-full items-center justify-center mr-4"
                            style={{ backgroundColor: `${color}15` }}
                          >
                            <Feather name={iconName as any} size={20} color={color} />
                          </View>
                          <View className="flex-1 mr-3">
                            <Text className="font-semibold text-dark-100 text-base" numberOfLines={1} ellipsizeMode="tail">
                              {account.accountName}
                            </Text>
                            <Text className="text-xs text-gray-500 mt-1">
                              Updated {formatDate(account.lastUpdated)}
                            </Text>
                          </View>
                          <View className="items-end flex-shrink-0">
                            <Text
                              className="font-bold text-lg"
                              style={{ color }}
                            >
                              {formatCurrency(account.balance / 100, account.currency)}
                            </Text>
                            <Text className="text-xs text-gray-500 mt-1">
                              {account.currency}
                            </Text>
                          </View>
                        </View>
                      </Swipeable>
                    );
                  })}
                </View>
              </View>
            )}
          </View>

          {/* Info Footer */}
          <View className="px-5 pb-8">
            <View className="bg-blue-50 rounded-2xl px-4 py-4 border border-blue-100">
              <View className="flex-row items-start gap-3">
                <Feather name="info" size={18} color="#3B82F6" />
                <View className="flex-1">
                  <Text className="text-blue-900 text-sm font-semibold mb-1">
                    About Account Balances
                  </Text>
                  <Text className="text-blue-700 text-xs leading-5">
                    Balances are extracted from your imported transaction files and show the balance at the time of the last transaction in each import.
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
