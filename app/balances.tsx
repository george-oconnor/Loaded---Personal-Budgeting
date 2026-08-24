import { getAccountBalances, removeAccountBalance, type AccountBalance } from "@/lib/accountBalances";
import BalanceHistoryChart from "@/components/BalanceHistoryChart";
import { convertCurrency, formatCurrency, getExchangeRates, getPrimaryCurrency } from "@/lib/currencyFunctions";
import { useSessionStore } from "@/store/useSessionStore";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, LayoutAnimation, Platform, Pressable, RefreshControl, ScrollView, Text, UIManager, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type CategoryKey = 'current' | 'savings' | 'loan' | 'credit-card';

interface CategoryConfig {
  key: CategoryKey;
  label: string;
  icon: string;
  color: string;
  bgColor: string;
}

const CATEGORIES: CategoryConfig[] = [
  { key: 'current', label: 'Current Accounts', icon: 'credit-card', color: '#6366F1', bgColor: '#EEF2FF' },
  { key: 'savings', label: 'Savings', icon: 'trending-up', color: '#10B981', bgColor: '#ECFDF5' },
  { key: 'credit-card', label: 'Credit Cards', icon: 'credit-card', color: '#EF4444', bgColor: '#FEF2F2' },
  { key: 'loan', label: 'Loans', icon: 'home', color: '#F59E0B', bgColor: '#FFFBEB' },
];

// --- Reusable account row ---
function AccountRow({
  account,
  deletingKey,
  onDelete,
  iconName,
  accentColor,
  formatDate,
}: {
  account: AccountBalance;
  deletingKey: string | null;
  onDelete: (a: AccountBalance) => void;
  iconName: string;
  accentColor: string;
  formatDate: (d: string) => string;
}) {
  const rowKey = account.accountKey || `${account.accountName}-${account.currency}`;
  const openHistory = () => {
    router.push({
      pathname: "/account-history",
      params: {
        accountKey: account.accountKey || "",
        accountName: account.accountName,
        currency: account.currency || "EUR",
      },
    });
  };
  return (
    <Swipeable
      renderRightActions={() => (
        <Pressable
          onPress={() => onDelete(account)}
          className="items-center justify-center bg-red-500 rounded-2xl ml-2"
          style={{ width: 80 }}
        >
          <Feather name="trash-2" size={18} color="#fff" />
          <Text className="text-white text-xs font-medium mt-1">Delete</Text>
        </Pressable>
      )}
      overshootRight={false}
    >
      <Pressable
        onPress={openHistory}
        className="flex-row items-center py-3 px-1"
        style={deletingKey === rowKey ? { opacity: 0.4 } : undefined}
      >
        <View
          className="w-10 h-10 rounded-xl items-center justify-center mr-3"
          style={{ backgroundColor: `${accentColor}12` }}
        >
          <Feather name={iconName as any} size={18} color={accentColor} />
        </View>
        <View className="flex-1 mr-3">
          <Text className="font-semibold text-gray-900 text-sm" numberOfLines={1} ellipsizeMode="tail">
            {account.accountName}
          </Text>
          <Text className="text-xs text-gray-400 mt-0.5">
            {formatDate(account.lastUpdated)}
          </Text>
        </View>
        <View className="items-end">
          <Text
            className={`font-bold text-base ${account.balance < 0 ? 'text-red-500' : account.balance > 0 ? 'text-green-600' : 'text-gray-900'}`}
          >
            {formatCurrency(account.balance / 100, account.currency)}
          </Text>
          {account.currency && (
            <Text className="text-xs text-gray-400 mt-0.5">{account.currency}</Text>
          )}
        </View>
      </Pressable>
    </Swipeable>
  );
}

export default function BalancesScreen() {
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
  const [ratesStale, setRatesStale] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<CategoryKey>>(new Set(['current', 'savings', 'loan', 'credit-card']));
  const { user } = useSessionStore();

  const sortBalances = (data: AccountBalance[]) =>
    [...data].sort((a, b) => a.accountName.localeCompare(b.accountName));

  const loadBalances = async () => {
    try {
      const data = await getAccountBalances(user?.id);
      const sorted = sortBalances(data);

      // Fetch exchange rates BEFORE setting balances so both states
      // are available on the same render and we avoid the
      // "Missing rate for X" warning.
      const currencies = sorted.map(b => b.currency);
      const hasMultiple = new Set(currencies).size > 1;
      if (hasMultiple) {
        const primary = getPrimaryCurrency(currencies);
        const { rates, stale } = await getExchangeRates(primary);
        setExchangeRates(rates);
        setRatesStale(stale);
      }

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

  const toggleSection = useCallback((key: CategoryKey) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleDeleteBalance = (account: AccountBalance) => {
    Alert.alert(
      "Delete balance?",
      `Remove ${account.accountName}${user?.id ? " from all devices" : ""}?`,
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
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setBalances(sortBalances(updated));
            } catch (err) {
              console.error('Error deleting balance:', err);
              Alert.alert('Delete failed', 'Could not remove this balance. Please try again.');
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
    const name = accountName.toLowerCase();
    if (name.includes('loan') || name.includes('mortgage')) return 'home';
    if (name.includes('vault')) return 'lock';
    if (name.includes('pocket')) return 'pocket';
    if (name.includes('savings')) return 'trending-up';
    return 'credit-card';
  };

  const getAccountColor = (accountName: string): string => {
    const name = accountName.toLowerCase();
    if (name.includes('revolut')) return '#7C3AED';
    if (name.includes('aib')) return '#10B981';
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

  // Group accounts by category
  const grouped = balances.reduce<Record<CategoryKey, AccountBalance[]>>((acc, bal) => {
    const cat = categorizeAccount(bal);
    acc[cat].push(bal);
    return acc;
  }, { current: [], savings: [], loan: [], 'credit-card': [] });

  const displayCurrency = getPrimaryCurrency(balances.map(b => b.currency));
  const hasMultipleCurrencies = new Set(balances.map(b => b.currency)).size > 1;

  const toDisplayCurrency = (balance: number, fromCurrency: string) => {
    if (fromCurrency === displayCurrency || !hasMultipleCurrencies) return balance;
    return convertCurrency(balance, fromCurrency, displayCurrency, exchangeRates);
  };

  const totalBalance = balances.reduce((sum, a) => sum + toDisplayCurrency(a.balance, a.currency), 0);

  // Keep the "Balance over time" chart limited to accounts that still exist today,
  // so deleted/renamed accounts don't keep contributing to historical totals.
  const activeAccountKeys = balances.map(b => b.accountKey).filter((k): k is string => Boolean(k));

  // Only show categories with accounts
  const activeCategories = CATEGORIES.filter(c => grouped[c.key].length > 0);

  // Proportion bar widths
  const absTotal = activeCategories.reduce((sum, c) => {
    return sum + Math.abs(grouped[c.key].reduce((s, a) => s + toDisplayCurrency(a.balance, a.currency), 0));
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
          <Text className="text-xs text-gray-500">Balances</Text>
        </View>
        <View className="mt-1 items-end">
          <Text className="text-2xl font-bold text-dark-100">Accounts</Text>
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
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        >
          {/* Total Balance Header */}
          <View className="bg-white px-5 pt-6 pb-5">
            <Text className="text-gray-500 text-sm mb-1">Total Balance</Text>
            <Text className={`text-3xl font-bold ${totalBalance < 0 ? 'text-red-500' : totalBalance > 0 ? 'text-green-600' : 'text-gray-900'}`}>
              {formatCurrency(totalBalance / 100, displayCurrency)}
            </Text>
            <Text className="text-gray-400 text-xs mt-1">
              {balances.length} account{balances.length !== 1 ? 's' : ''}
              {hasMultipleCurrencies ? ` · Converted to ${displayCurrency}` : ''}
            </Text>
            {hasMultipleCurrencies && ratesStale && (
              <Text className="text-amber-500 text-xs mt-1">
                Using approximate exchange rates
              </Text>
            )}

            {/* Proportion bar */}
            {activeCategories.length > 1 && absTotal > 0 && (
              <View className="flex-row h-2.5 rounded-full overflow-hidden mt-4">
                {activeCategories.map((cat, i) => {
                  const catAbs = Math.abs(grouped[cat.key].reduce((s, a) => s + toDisplayCurrency(a.balance, a.currency), 0));
                  const pct = (catAbs / absTotal) * 100;
                  if (pct < 1) return null;
                  return (
                    <View
                      key={cat.key}
                      style={{
                        width: `${pct}%` as any,
                        backgroundColor: cat.color,
                        marginLeft: i > 0 ? 2 : 0,
                        borderRadius: 6,
                      }}
                    />
                  );
                })}
              </View>
            )}

            {/* Legend */}
            {activeCategories.length > 1 && (
              <View className="flex-row flex-wrap mt-3 gap-x-4 gap-y-1">
                {activeCategories.map(cat => (
                  <View key={cat.key} className="flex-row items-center">
                    <View className="w-2.5 h-2.5 rounded-full mr-1.5" style={{ backgroundColor: cat.color }} />
                    <Text className="text-xs text-gray-500">{cat.label}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Balance over time */}
          <BalanceHistoryChart accountKeys={activeAccountKeys.length > 0 ? activeAccountKeys : undefined} />

          {/* Category Sections */}
          <View className="px-4 pt-4">
            {activeCategories.map((cat) => {
              const accounts = grouped[cat.key];
              const catTotal = accounts.reduce((s, a) => s + toDisplayCurrency(a.balance, a.currency), 0);
              const isCollapsed = collapsedSections.has(cat.key);

              return (
                <View key={cat.key} className="mb-4">
                  {/* Section header — tinted background, tappable */}
                  <Pressable
                    onPress={() => toggleSection(cat.key)}
                    className="flex-row items-center px-4 py-3.5"
                    style={{
                      backgroundColor: cat.bgColor,
                      borderTopLeftRadius: 16,
                      borderTopRightRadius: 16,
                      borderBottomLeftRadius: isCollapsed ? 16 : 0,
                      borderBottomRightRadius: isCollapsed ? 16 : 0,
                      borderWidth: 1,
                      borderColor: `${cat.color}20`,
                    }}
                  >
                    <View
                      className="w-9 h-9 rounded-xl items-center justify-center mr-3"
                      style={{ backgroundColor: `${cat.color}18` }}
                    >
                      <Feather name={cat.icon as any} size={16} color={cat.color} />
                    </View>
                    <View className="flex-1">
                      <Text className="font-bold text-gray-900 text-base">{cat.label}</Text>
                      <Text className="text-xs mt-0.5" style={{ color: `${cat.color}99` }}>
                        {accounts.length} account{accounts.length !== 1 ? 's' : ''} · Tap to {isCollapsed ? 'expand' : 'collapse'}
                      </Text>
                    </View>
                    <Text className={`font-bold text-base mr-2 ${catTotal < 0 ? 'text-red-500' : catTotal > 0 ? 'text-green-600' : 'text-gray-900'}`}>
                      {formatCurrency(catTotal / 100, displayCurrency)}
                    </Text>
                    <Feather
                      name={isCollapsed ? 'chevron-down' : 'chevron-up'}
                      size={18}
                      color={cat.color}
                    />
                  </Pressable>

                  {/* Accounts list — visually connected under the header */}
                  {!isCollapsed && (
                    <View
                      className="bg-white px-3"
                      style={{
                        borderBottomLeftRadius: 16,
                        borderBottomRightRadius: 16,
                        borderWidth: 1,
                        borderTopWidth: 0,
                        borderColor: '#F3F4F6',
                      }}
                    >
                      {accounts.map((account, index) => (
                        <View key={account.accountKey || `${account.accountName}-${account.currency}-${index}`}>
                          {index > 0 && <View className="h-px bg-gray-100 mx-1" />}
                          <AccountRow
                            account={account}
                            deletingKey={deletingKey}
                            onDelete={handleDeleteBalance}
                            iconName={getAccountIcon(account.accountName)}
                            accentColor={cat.color}
                            formatDate={formatDate}
                          />
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>

          {/* Info Footer */}
          <View className="px-4 pt-2 pb-4">
            <View className="bg-blue-50 rounded-2xl px-4 py-3 border border-blue-100">
              <View className="flex-row items-start gap-3">
                <Feather name="info" size={16} color="#3B82F6" style={{ marginTop: 1 }} />
                <Text className="text-blue-700 text-xs leading-5 flex-1">
                  Balances are from your imported files, showing the balance at the time of the last transaction in each import.
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
