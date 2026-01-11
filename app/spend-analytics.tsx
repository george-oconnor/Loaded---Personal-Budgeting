import RemainingSpendCard from "@/components/RemainingSpendCard";
import SpendingOverTimeChart from "@/components/SpendingOverTimeChart";
import { getCycleBudgetStats, getCycleStartDate, getDaysRemainingInCycle, getTransactionsInCurrentCycle } from "@/lib/budgetCycle";
import { formatCurrency } from "@/lib/currencyFunctions";
import { useHomeStore } from "@/store/useHomeStore";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, Text, TouchableWithoutFeedback, View } from "react-native";
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
  // Map common aliases/invalid names
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
  // Known safe set; fallback to default if outside
  const validSet = new Set([
    'shopping-bag','zap','play','truck','file','cloud','activity','heart','navigation','inbox','coffee','dollar-sign','credit-card','chevron-left','check-circle'
  ]);
  if (!normalized) return getDefaultIcon(categoryName || '');
  return validSet.has(normalized) ? normalized : getDefaultIcon(categoryName || '');
}


export default function SpendAnalytics() {
  const { summary, transactions, categories, loading, cycleType, cycleDay } = useHomeStore();
  const [isDraggingChart, setIsDraggingChart] = useState(false);
  const [viewMode, setViewMode] = useState<"category" | "daily">("category");
  const [showViewDropdown, setShowViewDropdown] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [selectedGraphDate, setSelectedGraphDate] = useState<string | null>(null);
  const dropdownAnim = useRef(new Animated.Value(0)).current;
  const budget = summary?.monthlyBudget ?? 0;
  const currency = summary?.currency ?? "USD";

  const analyticsTransactions = useMemo(
    () => transactions.filter((t) => !t.excludeFromAnalytics),
    [transactions]
  );

  // Animate dropdown open/close
  useEffect(() => {
    Animated.spring(dropdownAnim, {
      toValue: showViewDropdown ? 1 : 0,
      useNativeDriver: true,
      tension: 50,
      friction: 7,
    }).start();
  }, [showViewDropdown]);

  // Calculate budget statistics for the current cycle
  const { expenses: cycleExpenses, remaining, isOverspent, progress } = getCycleBudgetStats(
    analyticsTransactions,
    budget,
    cycleType,
    cycleDay
  );

  const displayRemaining = Math.abs(remaining);
  const daysRemaining = getDaysRemainingInCycle(cycleType, cycleDay);

  // Calculate total spent in current cycle
  const totalSpentThisCycle = cycleExpenses;

  // Calculate spending comparison with last month (same day)
  const spendingComparison = useMemo(() => {
    const now = new Date();
    const currentCycleStart = getCycleStartDate(cycleType, cycleDay);
    const daysIntoCycle = Math.floor((now.getTime() - currentCycleStart.getTime()) / (1000 * 60 * 60 * 24));

    // Calculate last month's cycle start
    const lastMonthCycleStart = new Date(currentCycleStart);
    lastMonthCycleStart.setMonth(lastMonthCycleStart.getMonth() - 1);
    
    // Calculate the equivalent day last month
    const lastMonthEquivalentDay = new Date(lastMonthCycleStart);
    lastMonthEquivalentDay.setDate(lastMonthEquivalentDay.getDate() + daysIntoCycle);

    // Get transactions from last month's cycle up to the equivalent day
    const lastMonthTransactions = analyticsTransactions.filter((t) => {
      const txDate = new Date(t.date);
      return (
        t.kind === "expense" &&
        txDate >= lastMonthCycleStart &&
        txDate <= lastMonthEquivalentDay
      );
    });

    const lastMonthSpent = lastMonthTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const difference = totalSpentThisCycle - lastMonthSpent;
    const percentageChange = lastMonthSpent > 0 ? ((difference / lastMonthSpent) * 100) : 0;

    return {
      difference,
      percentageChange,
      isHigher: difference > 0,
      lastMonthSpent,
    };
  }, [analyticsTransactions, cycleType, cycleDay, totalSpentThisCycle]);

  // Calculate category spending stats
  const categoryStats = useMemo(() => {
    // Filter transactions to current cycle
    const cycleTransactions = getTransactionsInCurrentCycle(
      analyticsTransactions,
      cycleType,
      cycleDay
    );
    
    const categorizedStats = categories
      .filter((cat) => cat.id !== "all")
      .map((category) => {
        const catTransactions = cycleTransactions.filter(
          (t) => t.categoryId === category.id && t.kind === "expense"
        );
        const totalSpent = catTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
        return {
          ...category,
          totalSpent,
          count: catTransactions.length,
        };
      });

    // Add uncategorized transactions
    const uncategorizedTransactions = cycleTransactions.filter(
      (t) => t.categoryId === "uncategorized" && t.kind === "expense"
    );
    const uncategorizedSpent = uncategorizedTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const allStats = uncategorizedSpent > 0
      ? [
          ...categorizedStats,
          {
            id: "uncategorized",
            name: "Uncategorized",
            color: "#9CA3AF",
            totalSpent: uncategorizedSpent,
            count: uncategorizedTransactions.length,
          },
        ]
      : categorizedStats;

    const stats = allStats
      .filter((cat) => cat.totalSpent > 0)
      .sort((a, b) => b.totalSpent - a.totalSpent);

    const totalExpenses = stats.reduce((sum, cat) => sum + cat.totalSpent, 0);

    return stats.map((cat) => ({
      ...cat,
      percentage: totalExpenses > 0 ? (cat.totalSpent / totalExpenses) * 100 : 0,
    }));
  }, [categories, analyticsTransactions, cycleType, cycleDay]);

  // Group transactions by day
  const dailyTransactions = useMemo(() => {
    const grouped = new Map<string, Transaction[]>();
    
    analyticsTransactions
      .filter(t => t.kind === "expense")
      .forEach((t) => {
        const date = new Date(t.date);
        const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
        
        if (!grouped.has(dateKey)) {
          grouped.set(dateKey, []);
        }
        grouped.get(dateKey)!.push(t);
      });

    // Convert to array and sort by date descending
    return Array.from(grouped.entries())
      .map(([dateKey, txs]) => ({
        date: dateKey,
        transactions: txs,
        total: txs.reduce((sum, t) => sum + t.amount, 0),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [analyticsTransactions]);

  return (
    <SafeAreaView className="flex-1 bg-white">
      {/* Fixed Back button and Header */}
      <View className="bg-white px-5 pt-2 pb-6">
        <View className="flex-row items-center justify-between">
          <Pressable
            onPress={() => router.back()}
            className="flex-row items-center gap-2"
          >
            <Feather name="chevron-left" size={20} color="#7C3AED" />
            <Text className="text-primary text-base font-semibold">Back</Text>
          </Pressable>
          
          <Text className="text-xs text-gray-500">Budget Period</Text>
        </View>
        
        <View className="mt-1 items-end">
          <Text className="text-2xl font-bold text-dark-100">This Month</Text>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        scrollEnabled={!isDraggingChart}
      >

        {/* Total Spent Display Above Chart */}
        <View className="px-5 mb-1">
          <Text 
            className="text-3xl font-bold"
            style={{
              lineHeight: 36,
              color: (() => {
                const isMoreThanLastMonth = spendingComparison.isHigher;
                const isOverBudget = isOverspent;
                
                // Red: more than last month AND over budget
                if (isMoreThanLastMonth && isOverBudget) return "#EF4444";
                // Green: less than last month AND below budget
                if (!isMoreThanLastMonth && !isOverBudget) return "#10B981";
                // Orange: only one condition is true
                return "#F97316";
              })()
            }}
          >
            {formatCurrency(totalSpentThisCycle / 100, currency)}
          </Text>
          <View className="flex-row items-center">
            <Feather 
              name={spendingComparison.isHigher ? "trending-up" : "trending-down"} 
              size={14} 
              color={spendingComparison.isHigher ? "#EF4444" : "#10B981"} 
            />
            <Text 
              className="text-xs ml-1"
              style={{ color: spendingComparison.isHigher ? "#EF4444" : "#10B981" }}
            >
              {spendingComparison.isHigher ? "+" : ""}{formatCurrency(Math.abs(spendingComparison.difference) / 100, currency)}
              {" "}({spendingComparison.isHigher ? "+" : ""}{spendingComparison.percentageChange.toFixed(1)}%)
            </Text>
            <Text className="text-xs text-gray-500 ml-1">vs same period last month</Text>
          </View>
        </View>

        {/* Spending Over Time Chart - Full Width */}
        <SpendingOverTimeChart
          transactions={analyticsTransactions}
          cycleType={cycleType}
          cycleDay={cycleDay}
          currency={summary?.currency}
          monthlyBudget={budget}
          onDraggingChange={setIsDraggingChart}
          onDateSelected={setSelectedGraphDate}
        />

        {/* Remaining Spend Card */}
        <View className="px-5 mt-5">
          <RemainingSpendCard 
            summary={summary}
            transactions={analyticsTransactions}
            loading={loading}
            cycleType={cycleType}
            cycleDay={cycleDay}
            disableNavigation={true}
          />
        </View>

        {/* Category Breakdown / Daily Transactions */}
        <TouchableWithoutFeedback onPress={() => showViewDropdown && setShowViewDropdown(false)}>
          <View className="mt-6 px-5 pb-6">
            <View className="relative">
              <Pressable 
                onPress={() => {
                  console.log("Header clicked, current dropdown state:", showViewDropdown);
                  setShowViewDropdown(!showViewDropdown);
                }}
                className="flex-row items-center justify-between mb-3 active:opacity-70"
              >
                <Text className={`text-lg font-bold ${showViewDropdown ? "text-gray-400" : "text-dark-100"}`}>
                  {viewMode === "category" ? "Spending by Category" : "Daily Transactions"}
                </Text>
                <Feather 
                  name={showViewDropdown ? "chevron-up" : "chevron-down"} 
                  size={20} 
                  color={showViewDropdown ? "#9CA3AF" : "#181C2E"}
                />
              </Pressable>

              {/* Dropdown Menu - Positioned absolutely below */}
              <Animated.View 
                pointerEvents={showViewDropdown ? 'auto' : 'none'}
                className="absolute top-full mt-2 rounded-2xl overflow-hidden z-50" 
                style={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.7)',
                  shadowColor: '#7C3AED',
                  shadowOffset: { width: 0, height: 8 },
                  shadowOpacity: 0.3,
                  shadowRadius: 20,
                  elevation: 10,
                  borderWidth: 1,
                  borderColor: 'rgba(255, 255, 255, 0.5)',
                  opacity: dropdownAnim,
                  transform: [
                    {
                      scaleY: dropdownAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 1],
                      }),
                    },
                    {
                      scaleX: dropdownAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.3, 1],
                      }),
                    },
                  ],
                  transformOrigin: 'top',
                }}
              >
                <View style={{ backgroundColor: 'rgba(124, 58, 237, 0.08)' }}>
                  <Pressable
                    onPress={() => {
                      setViewMode("category");
                      setSelectedOption("category");
                      setShowViewDropdown(false);
                      setTimeout(() => setSelectedOption(null), 300);
                    }}
                    className={`px-6 py-4 border-b active:opacity-70 ${selectedOption === "category" ? "bg-purple-100" : ""}`}
                    style={{ borderBottomColor: 'rgba(124, 58, 237, 0.15)', borderBottomWidth: 1 }}
                  >
                    <Text className={`${viewMode === "category" ? "font-bold text-primary" : "text-dark-100"}`}>
                      Spending by Category
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setViewMode("daily");
                      setSelectedOption("daily");
                      setShowViewDropdown(false);
                      setTimeout(() => setSelectedOption(null), 300);
                    }}
                    className={`px-6 py-4 active:opacity-70 ${selectedOption === "daily" ? "bg-purple-100" : ""}`}
                  >
                    <Text className={`${viewMode === "daily" ? "font-bold text-primary" : "text-dark-100"}`}>
                      Daily Transactions
                    </Text>
                  </Pressable>
                </View>
              </Animated.View>
            </View>

          {/* Category View */}
          {viewMode === "category" && (
            categoryStats.length === 0 ? (
              <Text className="text-gray-400 text-sm">No spending data available</Text>
            ) : (
              <View className="gap-3">
                {categoryStats.map((cat) => (
                  <Pressable
                    key={cat.id}
                    onPress={() => router.push(`/category-transactions?categoryId=${cat.id}`)}
                    className="active:opacity-70"
                  >
                    <View className="flex-row items-center rounded-2xl bg-gray-50 px-4 py-4 border border-gray-100">
                      <View
                        className="w-10 h-10 rounded-full items-center justify-center mr-3"
                        style={{ backgroundColor: cat.color || "#7C3AED" }}
                      >
                        <Feather name={normalizeFeatherIconName(cat.icon as any, cat.name)} size={18} color="white" />
                      </View>
                      <View className="flex-1">
                        <Text className="font-semibold text-dark-100">{cat.name}</Text>
                        <Text className="text-xs text-gray-500 mt-1">
                          {cat.count} transaction{cat.count !== 1 ? "s" : ""}
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className="font-bold text-red-500">
                          {formatCurrency(cat.totalSpent / 100, currency)}
                        </Text>
                        <Text className="text-xs text-gray-500 mt-1">{cat.percentage.toFixed(1)}%</Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            )
          )}

          {/* Daily View */}
          {viewMode === "daily" && (
            selectedGraphDate === null ? (
              <Text className="text-gray-400 text-sm">Please select a date on the graph</Text>
            ) : (
              (() => {
                const selectedDay = dailyTransactions.find(d => d.date === selectedGraphDate);
                return selectedDay ? (
                  <View className="gap-3">
                    <View className="rounded-2xl bg-gray-50 px-4 py-4 border border-gray-100">
                      <View className="flex-row items-center justify-between mb-3">
                        <Text className="font-semibold text-dark-100">
                          {new Date(selectedDay.date).toLocaleDateString('en-US', { 
                            weekday: 'short', 
                            month: 'short', 
                            day: 'numeric' 
                          })}
                        </Text>
                        <Text className="font-bold text-red-500">
                          {formatCurrency(selectedDay.total / 100, currency)}
                        </Text>
                      </View>
                      <View className="gap-2">
                        {selectedDay.transactions.map((tx) => {
                          const category = categories.find(c => c.id === tx.categoryId);
                          return (
                            <View key={tx.id} className="flex-row items-center justify-between">
                              <View className="flex-1 flex-row items-center gap-2">
                                <View
                                  className="w-6 h-6 rounded-full"
                                  style={{ backgroundColor: category?.color || "#7C3AED" }}
                                />
                                <Text className="text-sm text-dark-100 flex-1" numberOfLines={1}>
                                  {tx.title}
                                </Text>
                              </View>
                              <Text className="text-sm text-red-500 ml-2">
                                {formatCurrency(tx.amount / 100, currency)}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                ) : (
                  <Text className="text-gray-400 text-sm">No transactions on {new Date(selectedGraphDate).toLocaleDateString()}</Text>
                );
              })()
            )
          )}
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>
    </SafeAreaView>
  );
}
