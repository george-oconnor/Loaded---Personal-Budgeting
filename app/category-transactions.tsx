import TransactionListItem from "@/components/TransactionListItem";
import { updateTransactionFields } from "@/lib/backend";
import { getCycleEndDateForCycleStart, getCycleStartDateWithOffset } from "@/lib/budgetCycle";
import { formatCurrency } from "@/lib/currencyFunctions";
import { useHomeStore } from "@/store/useHomeStore";
import { useSessionStore } from "@/store/useSessionStore";
import { useTransactionDetailStore } from "@/store/useTransactionDetailStore";
import type { Transaction } from "@/types/type";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

// Map category names to default icons
function getDefaultIcon(categoryName: string): string {
  const name = (categoryName || '').toLowerCase();
  const iconMap: Record<string, string> = {
    food: 'coffee',
    groceries: 'shopping-bag',
    transport: 'navigation',
    entertainment: 'play',
    shopping: 'shopping-bag',
    bills: 'file',
    utilities: 'zap',
    health: 'heart',
    services: 'cloud',
    sport: 'activity',
    general: 'inbox',
    income: 'trending-down',
  };
  return iconMap[name] || 'shopping-bag';
}

// Normalize potentially invalid icon names to valid Feather icons
function normalizeFeatherIconName(icon: string | undefined, categoryName: string | undefined): string {
  const raw = (icon || '').toLowerCase().trim();
  const aliasMap: Record<string, string> = {
    cart: 'shopping-bag',
    'shopping-cart': 'shopping-bag',
    flash: 'zap',
    movie: 'play',
    film: 'play',
    bus: 'truck',
    utensils: 'coffee',
    'fork-knife': 'coffee',
    'silverware-fork-knife': 'coffee',
    'file-text': 'file',
  };
  const normalized = aliasMap[raw] || raw;
  const validSet = new Set([
    'shopping-bag','zap','play','truck','file','cloud','activity','heart','navigation','inbox','coffee','dollar-sign','credit-card','chevron-left','check-circle'
  ]);
  if (!normalized) return getDefaultIcon(categoryName || '');
  return validSet.has(normalized) ? normalized : getDefaultIcon(categoryName || '');
}

type GroupedTransaction = {
  type: "header" | "transaction";
  date?: string;
  dateLabel?: string;
  transaction?: Transaction;
  id: string;
};

export default function CategoryTransactionsScreen() {
  const { categoryId, type, cycleOffset: cycleOffsetParam, merchantName } = useLocalSearchParams<{ 
    categoryId?: string; 
    type?: string;
    cycleOffset?: string;
    merchantName?: string;
  }>();
  const { transactions, categories, summary, cycleType, cycleDay } = useHomeStore();
  const { user } = useSessionStore();
  const currency = summary?.currency ?? "USD";
  
  // Parse cycle offset (default to 0 = current cycle)
  const cycleOffset = cycleOffsetParam ? parseInt(cycleOffsetParam, 10) : 0;

  const category = useMemo(
    () => categories.find((c) => c.id === categoryId),
    [categoryId, categories]
  );

  // Get transactions for this category/merchant in the specified budget cycle
  const filteredTransactions = useMemo(() => {
    if (!categoryId && !type && !merchantName) return [];

    // Get cycle dates based on offset
    const cycleStart = getCycleStartDateWithOffset(cycleType, cycleDay, cycleOffset);
    const cycleEnd = getCycleEndDateForCycleStart(cycleType, cycleDay, cycleStart);

    return transactions.filter((t) => {
      // Filter by merchant name if provided
      if (merchantName) {
        if (t.title !== merchantName) return false;
      }
      
      // Filter by category if provided (and no merchant filter)
      if (categoryId && !merchantName) {
        const categoryMatch = t.categoryId === categoryId;
        if (!categoryMatch) return false;
      }

      // Filter by type (income/expense) if provided
      if (type) {
        if (t.kind !== type) return false;
      }

      // Exclude transactions flagged to be excluded from analytics
      if (t.excludeFromAnalytics) return false;

      // If filtering by category or merchant only, only include expenses
      if ((categoryId || merchantName) && !type && t.kind !== "expense") return false;

      // Match date range (in specified cycle)
      const txDate = new Date(t.date);
      return txDate >= cycleStart && txDate <= cycleEnd;
    });
  }, [categoryId, merchantName, type, transactions, cycleType, cycleDay, cycleOffset]);

  // Group transactions by date
  const groupedTransactions: GroupedTransaction[] = useMemo(() => {
    const grouped = new Map<string, Transaction[]>();

    filteredTransactions.forEach((t) => {
      const date = new Date(t.date);
      const dateKey = date.toISOString().split("T")[0];

      if (!grouped.has(dateKey)) {
        grouped.set(dateKey, []);
      }
      grouped.get(dateKey)!.push(t);
    });

    // Convert to grouped format
    const result: GroupedTransaction[] = [];
    Array.from(grouped.entries())
      .sort((a, b) => b[0].localeCompare(a[0])) // Sort by date descending
      .forEach(([dateKey, txs]) => {
        // Add header
        result.push({
          type: "header",
          date: dateKey,
          dateLabel: new Date(dateKey).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          }),
          id: `header-${dateKey}`,
        });

        // Add transactions
        txs.forEach((tx) => {
          result.push({
            type: "transaction",
            transaction: tx,
            id: tx.id,
          });
        });
      });

    return result;
  }, [filteredTransactions]);

  const handleExcludeFromAnalytics = async (transaction: Transaction) => {
    try {
      await updateTransactionFields(transaction.id, { excludeFromAnalytics: true });

      // Refresh home store to reflect analytics changes
      const { fetchHome } = useHomeStore.getState();
      fetchHome();
    } catch (error) {
      console.error("Failed to exclude transaction:", error);
    }
  };

  const totalAmount = useMemo(
    () =>
      filteredTransactions
        .filter((t) => !t.excludeFromAnalytics)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0),
    [filteredTransactions]
  );

  const isIncome = type === "income";
  const isExpense = type === "expense" || categoryId || merchantName;
  
  // Determine the title and subtitle
  const headerTitle = useMemo(() => {
    if (merchantName) return merchantName;
    if (type) return type === "income" ? "Income" : "Expenses";
    return category?.name || "Uncategorized";
  }, [merchantName, type, category]);
  
  const headerSubtitle = useMemo(() => {
    if (merchantName) return "Merchant";
    if (type) return "Type";
    return "Category";
  }, [merchantName, type]);
  
  // Get cycle label for display
  const cycleLabel = useMemo(() => {
    if (cycleOffset === 0) return "this cycle";
    if (cycleOffset === -1) return "last cycle";
    const cycleStart = getCycleStartDateWithOffset(cycleType, cycleDay, cycleOffset);
    return cycleStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [cycleOffset, cycleType, cycleDay]);

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
          <Text className="text-xs text-gray-500">{headerSubtitle}</Text>
        </View>
        <View className="mt-1 items-end">
          <Text className="text-2xl font-bold text-dark-100" numberOfLines={1}>
            {headerTitle}
          </Text>
        </View>
      </View>

      {/* Category/Type Info */}
        <View className="flex-row items-center gap-3 bg-gray-50 rounded-2xl p-4 mx-5">
          <View
            className="w-12 h-12 rounded-full items-center justify-center"
            style={{
              backgroundColor: type ? (isIncome ? "#10B981" : "#EF4444") : (category?.color || "#9CA3AF"),
            }}
          >
            <Feather
              name={type ? (isIncome ? "arrow-down-left" : "arrow-up-right") : (normalizeFeatherIconName(category?.icon as any, category?.name) as any)}
              size={20}
              color="white"
            />
          </View>
          <View className="flex-1">
            <Text className="text-gray-500 text-sm">
              {isIncome ? `Total earned ${cycleLabel}` : `Total spent ${cycleLabel}`}
            </Text>
            <Text className={`text-xl font-bold ${isIncome ? "text-green-500" : "text-red-500"}`}>
              {formatCurrency(totalAmount / 100, currency)}
            </Text>
          </View>
        </View>

      {/* Transactions List */}
      {filteredTransactions.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Feather name="inbox" size={48} color="#D1D5DB" />
          <Text className="text-gray-400 text-base mt-4 text-center px-8">
            {merchantName 
              ? `No transactions from ${merchantName} ${cycleLabel}`
              : type 
                ? `No ${type} transactions ${cycleLabel}` 
                : `No transactions in this category ${cycleLabel}`
            }
          </Text>
        </View>
      ) : (
        <FlatList
          data={groupedTransactions}
          renderItem={({ item }) => {
            if (item.type === "header") {
              return (
                <View className="px-5 pt-4 pb-3">
                  <Text className="font-semibold text-sm text-gray-700">
                    {item.dateLabel}
                  </Text>
                </View>
              );
            }

            const tx = item.transaction!;
            const txCategory = categories.find((c) => c.id === tx.categoryId);
            return (
              <Swipeable
                key={tx.id}
                renderRightActions={() => (
                  <Pressable
                    onPress={() => handleExcludeFromAnalytics(tx)}
                    className="flex-row items-center justify-center px-4 bg-gray-500 ml-2"
                    style={{ width: 120, height: '100%' }}
                  >
                    <Feather name="eye-off" size={18} color="#fff" />
                    <Text className="text-white font-semibold ml-2">Exclude</Text>
                  </Pressable>
                )}
                overshootRight={false}
              >
                <View className="bg-white">
                  <TransactionListItem
                    transaction={tx}
                    currency={currency}
                    categoryName={txCategory?.name || category?.name}
                    onPress={() => {
                      useTransactionDetailStore.getState().setSelectedTransactionId(tx.id);
                      router.push("/transaction-detail");
                    }}
                  />
                </View>
              </Swipeable>
            );
          }}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ flexGrow: 1 }}
          scrollEnabled={true}
        />
      )}
    </SafeAreaView>
  );
}
