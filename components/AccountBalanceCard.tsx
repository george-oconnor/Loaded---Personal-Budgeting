import { getAccountBalances, syncBalancesFromAppwrite, type AccountBalance } from "@/lib/accountBalances";
import { formatCurrency } from "@/lib/currencyFunctions";
import { useSessionStore } from "@/store/useSessionStore";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

interface AccountBalanceCardProps {
  refreshTrigger?: number;
}

export default function AccountBalanceCard({ refreshTrigger }: AccountBalanceCardProps) {
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useSessionStore();

  useEffect(() => {
    loadBalances();
  }, [refreshTrigger, user?.id]);

  const loadBalances = async () => {
    try {
      setLoading(true);
      // Sync from Appwrite first if user is logged in
      if (user?.id) {
        await syncBalancesFromAppwrite(user.id);
      }
      const data = await getAccountBalances(user?.id);
      setBalances(data);
    } catch (error) {
      console.error('Error loading balances:', error);
    } finally {
      setLoading(false);
    }
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

  const savingsAccounts = balances.filter(acc => categorizeAccount(acc) === 'savings');
  const currentAccounts = balances.filter(acc => categorizeAccount(acc) === 'current');

  const savingsTotal = savingsAccounts.reduce((sum, account) => sum + account.balance, 0);
  const currentTotal = currentAccounts.reduce((sum, account) => sum + account.balance, 0);
  const totalBalance = savingsTotal + currentTotal;

  const mainCurrency = balances.length > 0 ? balances[0].currency : "EUR";

  const getAccountIcon = (accountName: string): string => {
    const name = accountName.toLowerCase();
    if (name.includes('vault')) return 'lock';
    if (name.includes('pocket')) return 'inbox';
    if (name.includes('savings')) return 'trending-up';
    return 'credit-card';
  };

  if (loading) {
    return (
      <View className="mt-5 rounded-3xl bg-gray-50 px-5 py-6 shadow-sm">
        <ActivityIndicator size="small" color="#667eea" />
      </View>
    );
  }

  if (balances.length === 0) {
    return null; // Don't show anything if no balances
  }

  return (
    <Pressable
      onPress={() => router.push("/balances")}
      className="mt-5 active:opacity-80"
    >
      <View className="rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 px-5 py-6 shadow-md" style={{ backgroundColor: '#667eea' }}>
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-white/80 text-sm font-medium">Total Balance</Text>
          <Feather name="chevron-right" size={20} color="white" opacity={0.6} />
        </View>
        
        <Text className="text-white text-3xl font-bold mb-4">
          {formatCurrency(totalBalance / 100, mainCurrency)}
        </Text>

        {/* Current Accounts Section */}
        {currentAccounts.length > 0 && (
          <View className="mb-3">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-white/70 text-xs font-semibold uppercase tracking-wide">Current</Text>
              <Text className="text-white/90 text-sm font-bold">
                {formatCurrency(currentTotal / 100, mainCurrency)}
              </Text>
            </View>
            {currentAccounts.map((account, index) => (
              <View key={`current-${index}`} className="flex-row items-center justify-between py-2 border-t border-white/10">
                <View className="flex-row items-center flex-1">
                  <View className="w-8 h-8 rounded-full bg-white/20 items-center justify-center mr-3">
                    <Feather name={getAccountIcon(account.accountName) as any} size={16} color="white" />
                  </View>
                  <Text className="text-white/90 text-sm flex-1" numberOfLines={1}>
                    {account.accountName}
                  </Text>
                </View>
                <Text className="text-white font-semibold text-sm ml-2">
                  {formatCurrency(account.balance / 100, account.currency)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Savings Accounts Section */}
        {savingsAccounts.length > 0 && (
          <View>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-white/70 text-xs font-semibold uppercase tracking-wide">Savings</Text>
              <Text className="text-white/90 text-sm font-bold">
                {formatCurrency(savingsTotal / 100, mainCurrency)}
              </Text>
            </View>
            {savingsAccounts.map((account, index) => (
              <View key={`savings-${index}`} className="flex-row items-center justify-between py-2 border-t border-white/10">
                <View className="flex-row items-center flex-1">
                  <View className="w-8 h-8 rounded-full bg-white/20 items-center justify-center mr-3">
                    <Feather name={getAccountIcon(account.accountName) as any} size={16} color="white" />
                  </View>
                  <Text className="text-white/90 text-sm flex-1" numberOfLines={1}>
                    {account.accountName}
                  </Text>
                </View>
                <Text className="text-white font-semibold text-sm ml-2">
                  {formatCurrency(account.balance / 100, account.currency)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
}
