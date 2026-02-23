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

type CategoryKey = 'current' | 'savings' | 'loan' | 'credit-card';

interface CategoryInfo {
  key: CategoryKey;
  label: string;
  icon: string;
  color: string;
  bgColor: string;
}

const CATEGORIES: CategoryInfo[] = [
  { key: 'current', label: 'Current', icon: 'credit-card', color: '#6366F1', bgColor: '#EEF2FF' },
  { key: 'savings', label: 'Savings', icon: 'trending-up', color: '#10B981', bgColor: '#ECFDF5' },
  { key: 'credit-card', label: 'Credit Cards', icon: 'credit-card', color: '#EF4444', bgColor: '#FEF2F2' },
  { key: 'loan', label: 'Loans', icon: 'home', color: '#F59E0B', bgColor: '#FFFBEB' },
];

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
      if (user?.id) {
        await syncBalancesFromAppwrite(user.id);
      }
      const data = await getAccountBalances(user?.id);
      setBalances([...data].sort((a, b) => a.accountName.localeCompare(b.accountName)));
    } catch (error) {
      console.error('Error loading balances:', error);
    } finally {
      setLoading(false);
    }
  };

  const categorizeAccount = (account: AccountBalance): CategoryKey => {
    const name = account.accountName.toLowerCase();
    const type = account.accountType?.toLowerCase();
    if (type === 'credit card' || type === 'credit-card' || type === 'creditcard' ||
        name.includes('credit card') || name.includes('creditcard')) return 'credit-card';
    if (name.includes('loan') || name.includes('mortgage') || type === 'loan') return 'loan';
    if (name.includes('vault') || type === 'vault') return 'savings';
    if (name.includes('pocket') || type === 'pocket') return 'current';
    if (type === 'savings') return 'savings';
    return 'current';
  };

  const grouped = balances.reduce<Record<CategoryKey, AccountBalance[]>>((acc, bal) => {
    const cat = categorizeAccount(bal);
    acc[cat].push(bal);
    return acc;
  }, { current: [], savings: [], loan: [], 'credit-card': [] });

  const totalBalance = balances.reduce((sum, a) => sum + a.balance, 0);
  const mainCurrency = balances.length > 0 ? balances[0].currency : "EUR";

  // Only show categories that have accounts
  const activeCategories = CATEGORIES.filter(c => grouped[c.key].length > 0);

  // For the balance bar proportions
  const positiveTotal = activeCategories.reduce((sum, c) => {
    const catTotal = grouped[c.key].reduce((s, a) => s + a.balance, 0);
    return sum + Math.abs(catTotal);
  }, 0);

  if (loading) {
    return (
      <View className="mt-5 rounded-3xl bg-gray-50 px-5 py-6 shadow-sm">
        <ActivityIndicator size="small" color="#667eea" />
      </View>
    );
  }

  if (balances.length === 0) {
    return null;
  }

  return (
    <Pressable
      onPress={() => router.push("/balances")}
      className="mt-5 active:opacity-80"
    >
      <View className="rounded-3xl bg-white px-5 py-5 shadow-sm border border-gray-100">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-1">
          <Text className="text-gray-500 text-sm font-medium">Total Balance</Text>
          <View className="flex-row items-center">
            <Text className="text-gray-400 text-xs mr-1">Details</Text>
            <Feather name="chevron-right" size={16} color="#9CA3AF" />
          </View>
        </View>

        {/* Total */}
        <Text className={`text-2xl font-bold mb-4 ${totalBalance < 0 ? 'text-red-500' : totalBalance > 0 ? 'text-green-600' : 'text-gray-900'}`}>
          {formatCurrency(totalBalance / 100, mainCurrency)}
        </Text>

        {/* Proportion bar */}
        {activeCategories.length > 1 && positiveTotal > 0 && (
          <View className="flex-row h-2 rounded-full overflow-hidden mb-4">
            {activeCategories.map((cat, i) => {
              const catTotal = Math.abs(grouped[cat.key].reduce((s, a) => s + a.balance, 0));
              const pct = (catTotal / positiveTotal) * 100;
              if (pct < 1) return null;
              return (
                <View
                  key={cat.key}
                  style={{
                    width: `${pct}%` as any,
                    backgroundColor: cat.color,
                    marginLeft: i > 0 ? 2 : 0,
                    borderRadius: 4,
                  }}
                />
              );
            })}
          </View>
        )}

        {/* Category rows */}
        <View className="gap-2">
          {activeCategories.map((cat) => {
            const accounts = grouped[cat.key];
            const catTotal = accounts.reduce((s, a) => s + a.balance, 0);
            return (
              <View key={cat.key} className="flex-row items-center py-2">
                <View
                  className="w-9 h-9 rounded-xl items-center justify-center mr-3"
                  style={{ backgroundColor: cat.bgColor }}
                >
                  <Feather name={cat.icon as any} size={16} color={cat.color} />
                </View>
                <View className="flex-1">
                  <Text className="text-gray-900 text-sm font-semibold">{cat.label}</Text>
                  <Text className="text-gray-400 text-xs">
                    {accounts.length} account{accounts.length !== 1 ? 's' : ''}
                  </Text>
                </View>
                <Text
                  className={`font-bold text-sm ${catTotal < 0 ? 'text-red-500' : catTotal > 0 ? 'text-green-600' : 'text-gray-900'}`}
                >
                  {formatCurrency(catTotal / 100, mainCurrency)}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </Pressable>
  );
}
