import RemainingSpendCard from "@/components/RemainingSpendCard";
import SpendingOverTimeChart from "@/components/SpendingOverTimeChart";
import { getCycleBudgetStats, getCycleEndDateForCycleStart, getCycleRepresentativeMonth, getCycleStartDateWithOffset, getDaysRemainingInCycle } from "@/lib/budgetCycle";
import { formatCurrency } from "@/lib/currencyFunctions";
import { getMerchantIconUrl, getSuggestedMerchantIcon } from "@/lib/merchantIcons";
import { useHomeStore } from "@/store/useHomeStore";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, Pressable, ScrollView, Text, TouchableWithoutFeedback, View } from "react-native";
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
  const { summary, transactions, categories, loading, cycleType, cycleDay, oldestCycleLoaded, fetchOlderTransactions } = useHomeStore();
  const [isDraggingChart, setIsDraggingChart] = useState(false);
  const [viewMode, setViewMode] = useState<"category" | "merchant" | "daily">("category");
  const [showViewDropdown, setShowViewDropdown] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [selectedGraphDate, setSelectedGraphDate] = useState<string | null>(null);
  const [cycleOffset, setCycleOffset] = useState(0); // 0 = current cycle, -1 = previous, etc.
  const [hintSwipeStart, setHintSwipeStart] = useState<number | null>(null);
  const dropdownAnim = useRef(new Animated.Value(0)).current;
  const budget = summary?.monthlyBudget ?? 0;
  const currency = summary?.currency ?? "USD";

  // Load more historical data when approaching the edge
  useEffect(() => {
    // When we're within 2 cycles of the oldest loaded data, fetch 6 more cycles
    const threshold = oldestCycleLoaded + 2;
    if (cycleOffset <= threshold) {
      console.log(`Approaching data edge (offset: ${cycleOffset}, oldest: ${oldestCycleLoaded}), loading more...`);
      fetchOlderTransactions(6);
    }
  }, [cycleOffset, oldestCycleLoaded, fetchOlderTransactions]);

  // Get the cycle label based on offset
  const getCycleLabel = useMemo(() => {
    if (cycleOffset === 0) return "This Month";
    if (cycleOffset === -1) return "Last Month";
    
    const cycleStart = getCycleStartDateWithOffset(cycleType, cycleDay, cycleOffset);
    const representativeMonth = getCycleRepresentativeMonth(cycleType, cycleDay, cycleStart);
    return representativeMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [cycleOffset, cycleType, cycleDay]);

  // Handle chart swipe to change cycle
  const handleChartSwipe = (direction: "left" | "right") => {
    if (direction === "right") {
      // Swiped right - go to older cycle
      setCycleOffset(prev => prev - 1);
    } else if (direction === "left" && cycleOffset < 0) {
      // Swiped left - go to newer (more recent) cycle
      setCycleOffset(prev => prev + 1);
    }
  };

  // Helper to extract date string consistently
  const getDateKey = (date: Date) => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  const analyticsTransactions = useMemo(
    () => transactions.filter((t) => !t.excludeFromAnalytics),
    [transactions]
  );

  // Get cycle dates for the selected offset
  const selectedCycleDates = useMemo(() => {
    const cycleStart = getCycleStartDateWithOffset(cycleType, cycleDay, cycleOffset);
    const cycleEnd = getCycleEndDateForCycleStart(cycleType, cycleDay, cycleStart);
    
    // For current cycle, data goes up to end of today; for past cycles, up to cycle end
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    const dataEndDate = cycleOffset < 0 ? cycleEnd : (now < cycleEnd ? now : cycleEnd);
    
    return { cycleStart, cycleEnd, dataEndDate };
  }, [cycleType, cycleDay, cycleOffset]);

  // Get transactions for the selected cycle (with offset)
  // For current cycle: up to end of today (matches chart)
  // For past cycles: full cycle
  const selectedCycleTransactions = useMemo(() => {
    const { cycleStart, dataEndDate } = selectedCycleDates;
    
    return analyticsTransactions.filter((t) => {
      const txDate = new Date(t.date);
      return txDate >= cycleStart && txDate <= dataEndDate;
    });
  }, [analyticsTransactions, selectedCycleDates]);

  // Animate dropdown open/close
  useEffect(() => {
    Animated.spring(dropdownAnim, {
      toValue: showViewDropdown ? 1 : 0,
      useNativeDriver: true,
      tension: 50,
      friction: 7,
    }).start();
  }, [showViewDropdown]);

  // Calculate budget statistics for the current cycle (used for RemainingSpendCard when viewing current period)
  const { expenses: cycleExpenses, remaining, isOverspent, progress } = getCycleBudgetStats(
    analyticsTransactions,
    budget,
    cycleType,
    cycleDay
  );

  const displayRemaining = Math.abs(remaining);
  const daysRemaining = getDaysRemainingInCycle(cycleType, cycleDay);

  // Calculate spending comparison with previous cycle (relative to selected cycle)
  const spendingComparison = useMemo(() => {
    const { cycleStart, cycleEnd } = selectedCycleDates;
    
    // For current cycle (offset 0), compare up to end of today
    // For past cycles, compare the full cycle (end of last day)
    const isCurrentCycle = cycleOffset === 0;
    
    let compareUpTo: Date;
    if (isCurrentCycle) {
      // End of today - matches chart behavior
      compareUpTo = new Date();
      compareUpTo.setHours(23, 59, 59, 999);
    } else {
      // End of last day of cycle
      compareUpTo = new Date(cycleEnd);
      compareUpTo.setHours(23, 59, 59, 999);
    }
    
    // Calculate days into the selected cycle (for percentage calculation)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cycleStartNormalized = new Date(cycleStart);
    cycleStartNormalized.setHours(0, 0, 0, 0);
    
    const daysIntoCycle = Math.floor((today.getTime() - cycleStartNormalized.getTime()) / (1000 * 60 * 60 * 24));
    const totalCycleDays = Math.floor((cycleEnd.getTime() - cycleStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const percentThroughCycle = isCurrentCycle 
      ? Math.min(1, (daysIntoCycle + 1) / totalCycleDays) // +1 because we include today
      : 1; // For completed cycles, use 100%

    // Get spending in selected cycle - this is the TOTAL for the cycle
    // For current cycle: all spending up to end of today
    // For past cycles: all spending in the cycle
    const selectedCycleSpent = selectedCycleTransactions
      .filter(t => t.kind === "expense")
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    // Get the previous cycle (relative to selected cycle)
    const prevCycleStart = getCycleStartDateWithOffset(cycleType, cycleDay, cycleOffset - 1);
    const prevCycleEnd = getCycleEndDateForCycleStart(cycleType, cycleDay, prevCycleStart);
    const prevCycleDays = Math.floor((prevCycleEnd.getTime() - prevCycleStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    // Calculate the equivalent day in previous cycle using percentage normalization
    const prevCycleDayOffset = Math.floor(percentThroughCycle * prevCycleDays);
    const prevEquivalentDay = new Date(prevCycleStart);
    prevEquivalentDay.setDate(prevEquivalentDay.getDate() + prevCycleDayOffset);
    prevEquivalentDay.setHours(23, 59, 59, 999);

    // Get transactions from previous cycle up to the equivalent day
    const prevCycleTransactions = analyticsTransactions.filter((t) => {
      const txDate = new Date(t.date);
      return (
        t.kind === "expense" &&
        txDate >= prevCycleStart &&
        txDate <= prevEquivalentDay
      );
    });

    const prevCycleSpent = prevCycleTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
    const difference = selectedCycleSpent - prevCycleSpent;
    const percentageChange = prevCycleSpent > 0 ? ((difference / prevCycleSpent) * 100) : 0;

    return {
      difference,
      percentageChange,
      isHigher: difference > 0,
      prevCycleSpent,
      selectedCycleSpent,
      isCurrentCycle,
    };
  }, [analyticsTransactions, selectedCycleTransactions, selectedCycleDates, cycleType, cycleDay, cycleOffset]);

  // Calculate category spending stats
  const categoryStats = useMemo(() => {
    // Use transactions from selected cycle (with offset)
    const cycleTransactions = selectedCycleTransactions;
    
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
  }, [categories, selectedCycleTransactions]);

  // Calculate merchant spending stats
  const merchantStats = useMemo(() => {
    // Use transactions from selected cycle (with offset)
    const cycleTransactions = selectedCycleTransactions;
    
    const merchantMap = new Map<string, { name: string; transactions: Transaction[]; totalSpent: number; }>();
    
    cycleTransactions
      .filter(t => t.kind === "expense" && !t.excludeFromAnalytics)
      .forEach(transaction => {
        const merchantName = transaction.displayName || transaction.title || "Unknown Merchant";
        const key = merchantName.toLowerCase();

        if (!merchantMap.has(key)) {
          merchantMap.set(key, {
            name: merchantName,
            transactions: [],
            totalSpent: 0,
          });
        }
        
        const merchant = merchantMap.get(key)!;
        merchant.transactions.push(transaction);
        merchant.totalSpent += Math.abs(transaction.amount);
      });
    
    const merchantArray = Array.from(merchantMap.values())
      .map(merchant => ({
        ...merchant,
        count: merchant.transactions.length,
      }))
      .filter(merchant => merchant.totalSpent > 0)
      .sort((a, b) => b.totalSpent - a.totalSpent);
    
    const totalExpenses = merchantArray.reduce((sum, merchant) => sum + merchant.totalSpent, 0);
    
    return merchantArray.map(merchant => ({
      ...merchant,
      percentage: totalExpenses > 0 ? (merchant.totalSpent / totalExpenses) * 100 : 0,
    }));
  }, [selectedCycleTransactions]);

  // Group transactions by day for selected cycle
  const dailyTransactions = useMemo(() => {
    const grouped = new Map<string, Transaction[]>();
    
    selectedCycleTransactions
      .filter(t => t.kind === "expense")
      .forEach((t) => {
        const date = new Date(t.date);
        const dateKey = getDateKey(date);
        
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
  }, [selectedCycleTransactions]);

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
        
        <View className="mt-1 flex-row items-center justify-end">
          <Pressable 
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setCycleOffset(prev => prev - 1);
            }}
            className="mr-2 active:opacity-70"
          >
            <Feather name="chevron-left" size={24} color="#7C3AED" />
          </Pressable>
          <Text className="text-2xl font-bold text-dark-100">{getCycleLabel}</Text>
          {cycleOffset < 0 && (
            <Pressable 
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setCycleOffset(prev => prev + 1);
              }}
              className="ml-2 active:opacity-70"
            >
              <Feather name="chevron-right" size={24} color="#7C3AED" />
            </Pressable>
          )}
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
                const isMoreThanPrevCycle = spendingComparison.isHigher;
                const isOverBudget = spendingComparison.selectedCycleSpent > budget;
                
                // Red: more than previous cycle AND over budget
                if (isMoreThanPrevCycle && isOverBudget) return "#EF4444";
                // Green: less than previous cycle AND below budget
                if (!isMoreThanPrevCycle && !isOverBudget) return "#10B981";
                // Orange: only one condition is true
                return "#F97316";
              })()
            }}
          >
            {formatCurrency(spendingComparison.selectedCycleSpent / 100, currency)}
          </Text>
          <View className="flex-row items-center flex-wrap">
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
            <Text className="text-xs text-gray-500 ml-1">
              {spendingComparison.isCurrentCycle 
                ? "vs same point last cycle"
                : "vs previous cycle"
              }
            </Text>
          </View>
        </View>

        {/* Spending Over Time Chart - With swipe navigation */}
        <View>
          <SpendingOverTimeChart
            transactions={analyticsTransactions}
            cycleType={cycleType}
            cycleDay={cycleDay}
            currency={summary?.currency}
            monthlyBudget={budget}
            onDraggingChange={setIsDraggingChart}
            onDateSelected={setSelectedGraphDate}
            cycleOffset={cycleOffset}
            onSwipe={handleChartSwipe}
          />
          
          {/* Swipe hint indicator - also swipeable */}
          <View
            className="flex-row justify-center items-center mt-2 gap-1 py-2"
            onTouchStart={(e) => setHintSwipeStart(e.nativeEvent.pageX)}
            onTouchEnd={(e) => {
              if (hintSwipeStart !== null) {
                const deltaX = e.nativeEvent.pageX - hintSwipeStart;
                const swipeThreshold = 50;
                if (Math.abs(deltaX) > swipeThreshold) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  if (deltaX > 0) {
                    handleChartSwipe("right");
                  } else {
                    handleChartSwipe("left");
                  }
                }
                setHintSwipeStart(null);
              }
            }}
          >
            <Feather name="chevron-left" size={14} color="#D1D5DB" />
            <Text className="text-xs text-gray-300">Swipe to change period</Text>
            <Feather name="chevron-right" size={14} color="#D1D5DB" />
          </View>
        </View>

        {/* Remaining Spend Card - Works for any cycle */}
        <View className="px-5 mt-5">
          <RemainingSpendCard 
            summary={summary}
            transactions={analyticsTransactions}
            loading={loading}
            cycleType={cycleType}
            cycleDay={cycleDay}
            disableNavigation={true}
            cycleOffset={cycleOffset}
          />
        </View>

        {/* Category Breakdown / Daily Transactions */}
        <View className="mt-6 pb-6 relative">
          <TouchableWithoutFeedback onPress={() => showViewDropdown && setShowViewDropdown(false)}>
            <View>
              <View className="px-5">
                <Pressable 
                  onPress={() => {
                    console.log("Header clicked, current dropdown state:", showViewDropdown);
                    setShowViewDropdown(!showViewDropdown);
                  }}
                  className="flex-row items-center justify-between mb-3 active:opacity-70"
                >
                  <Text className={`text-lg font-bold ${showViewDropdown ? "text-gray-400" : "text-dark-100"}`}>
                    {viewMode === "category" ? "Spending by Category" : viewMode === "merchant" ? "Spending by Merchant" : "Daily Transactions"}
                  </Text>
                  <Feather 
                    name={showViewDropdown ? "chevron-up" : "chevron-down"} 
                    size={20} 
                    color={showViewDropdown ? "#9CA3AF" : "#181C2E"}
                  />
                </Pressable>
              </View>
            </View>
          </TouchableWithoutFeedback>

              {/* Dropdown Menu - Full width, positioned absolutely below */}
              <Animated.View 
                pointerEvents={showViewDropdown ? 'auto' : 'none'}
                className="absolute left-0 right-0 mx-5 rounded-2xl overflow-hidden z-50" 
                style={{ 
                  top: 36,
                  backgroundColor: '#FFFFFF',
                  shadowColor: '#7C3AED',
                  shadowOffset: { width: 0, height: 8 },
                  shadowOpacity: 0.3,
                  shadowRadius: 20,
                  elevation: 10,
                  borderWidth: 2,
                  borderColor: '#E5E7EB',
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
                <View style={{ backgroundColor: '#FFFFFF' }}>
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
                      setViewMode("merchant");
                      setSelectedOption("merchant");
                      setShowViewDropdown(false);
                      setTimeout(() => setSelectedOption(null), 300);
                    }}
                    className={`px-6 py-4 border-b active:opacity-70 ${selectedOption === "merchant" ? "bg-purple-100" : ""}`}
                    style={{ borderBottomColor: 'rgba(124, 58, 237, 0.15)', borderBottomWidth: 1 }}
                  >
                    <Text className={`${viewMode === "merchant" ? "font-bold text-primary" : "text-dark-100"}`}>
                      Spending by Merchant
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

          {/* Content with opacity effect when dropdown is open */}
          <View className="px-5" style={{ opacity: showViewDropdown ? 0.3 : 1 }}>
          {/* Category View */}
          {viewMode === "category" && (
            categoryStats.length === 0 ? (
              <Text className="text-gray-400 text-sm">No spending data available</Text>
            ) : (
              <View className="gap-3">
                {categoryStats.map((cat) => (
                  <Pressable
                    key={cat.id}
                    onPress={() => router.push(`/category-transactions?categoryId=${cat.id}&cycleOffset=${cycleOffset}`)}
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

          {/* Merchant View */}
          {viewMode === "merchant" && (
            merchantStats.length === 0 ? (
              <Text className="text-gray-400 text-sm">No spending data available</Text>
            ) : (
              <View className="gap-3">
                {merchantStats.map((merchant, index) => {
                  const firstTransaction = merchant.transactions[0];
                  const category = categories.find(c => c.id === firstTransaction?.categoryId);
                  return (
                    <MerchantStatItem
                      key={`${merchant.name}-${index}`}
                      merchantName={merchant.name}
                      totalSpent={merchant.totalSpent}
                      count={merchant.count}
                      percentage={merchant.percentage}
                      currency={currency}
                      categoryColor={category?.color}
                      categoryIcon={normalizeFeatherIconName(category?.icon as any, category?.name)}
                      categoryName={category?.name}
                      onPress={() => router.push({ pathname: "/merchant-detail", params: { name: merchant.name } })}
                    />
                  );
                })}
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
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Component for rendering a merchant stat item with icon waterfall logic
function MerchantStatItem({
  merchantName,
  totalSpent,
  count,
  percentage,
  currency,
  categoryColor,
  categoryIcon,
  categoryName,
  onPress,
}: {
  merchantName: string;
  totalSpent: number;
  count: number;
  percentage: number;
  currency: string;
  categoryColor?: string;
  categoryIcon: string;
  categoryName?: string;
  onPress?: () => void;
}) {
  const [tldIndex, setTldIndex] = useState(0);
  const [iconFailed, setIconFailed] = useState(false);
  const [crowdSourcedIconUrl, setCrowdSourcedIconUrl] = useState<string | null>(null);
  const [crowdSourcedIconFailed, setCrowdSourcedIconFailed] = useState(false);

  // Load crowd-sourced icon suggestion
  useEffect(() => {
    getSuggestedMerchantIcon(merchantName, 64)
      .then(url => {
        setCrowdSourcedIconUrl(url);
        setCrowdSourcedIconFailed(false);
      })
      .catch(() => setCrowdSourcedIconUrl(null));
  }, [merchantName]);

  // Built-in icon (fallback)
  const builtInIconUrl = iconFailed ? null : getMerchantIconUrl(merchantName, 64, tldIndex);
  // Prioritize crowd-sourced icon (if not failed), then fall back to built-in
  const effectiveCrowdSourcedUrl = (crowdSourcedIconUrl && !crowdSourcedIconFailed) ? crowdSourcedIconUrl : null;
  const merchantIconUrl = effectiveCrowdSourcedUrl || (iconFailed ? null : builtInIconUrl);

  const hasMerchantIcon = merchantIconUrl !== null;
  const isCrowdSourced = effectiveCrowdSourcedUrl && merchantIconUrl === effectiveCrowdSourcedUrl;

  const handleImageError = () => {
    // If this is a crowd-sourced icon, mark it as failed so we fall back
    if (isCrowdSourced) {
      setCrowdSourcedIconFailed(true);
      return;
    }
    // Try next TLD (ie -> com -> co.uk)
    if (tldIndex < 2) {
      setTldIndex(tldIndex + 1);
      return;
    }
    // After all TLDs exhausted, fall back to category icon
    setIconFailed(true);
  };

  const backgroundColor = hasMerchantIcon ? "#FFFFFF" : `${categoryColor || "#EF4444"}20`;

  const content = (
    <View className="flex-row items-center rounded-2xl bg-gray-50 px-4 py-4 border border-gray-100">
      <View 
        className="w-10 h-10 rounded-full items-center justify-center mr-3"
        style={{ 
          backgroundColor, 
          borderWidth: hasMerchantIcon ? 1 : 0, 
          borderColor: '#E5E7EB' 
        }}
      >
        {hasMerchantIcon ? (
          <Image 
            source={{ uri: merchantIconUrl }}
            style={{ width: 32, height: 32, borderRadius: 16 }}
            resizeMode="contain"
            onError={handleImageError}
          />
        ) : (
          <Feather
            name={categoryIcon as any}
            size={18}
            color={categoryColor || "#EF4444"}
          />
        )}
      </View>
      <View className="flex-1">
        <Text className="font-semibold text-dark-100" numberOfLines={1}>
          {merchantName}
        </Text>
        <Text className="text-xs text-gray-500 mt-1">
          {count} transaction{count !== 1 ? "s" : ""}
        </Text>
      </View>
      <View className="items-end">
        <Text className="font-bold text-red-500">
          {formatCurrency(totalSpent / 100, currency)}
        </Text>
        <Text className="text-xs text-gray-500 mt-1">{percentage.toFixed(1)}%</Text>
      </View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} className="active:opacity-70">
        {content}
      </Pressable>
    );
  }

  return content;
}
