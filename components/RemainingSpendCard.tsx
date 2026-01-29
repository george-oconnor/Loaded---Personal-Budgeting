import { getCycleEndDateForCycleStart, getCycleStartDateWithOffset, getDaysRemainingInCycle } from "@/lib/budgetCycle";
import { formatCurrency } from "@/lib/currencyFunctions";
import type { Summary, Transaction } from "@/types/type";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

export default function RemainingSpendCard({
  summary,
  transactions,
  loading,
  cycleType = "first_working_day",
  cycleDay,
  disableNavigation = false,
  cycleOffset = 0,
}: {
  summary: Summary | null;
  transactions: Transaction[];
  loading: boolean;
  cycleType?: "first_working_day" | "last_working_day" | "specific_date" | "last_friday";
  cycleDay?: number;
  disableNavigation?: boolean;
  cycleOffset?: number;
}) {
  const currency = summary?.currency ?? "USD";
  const budget = summary?.monthlyBudget ?? 0;
  const budgetSource = summary?.budgetSource;
  const noBudgetSet = budget === 0 && budgetSource !== "lastMonth";
  const [pressed, setPressed] = useState(false);
  const [cardPressed, setCardPressed] = useState(false);
  
  // Helper to check if a transaction should be excluded from analytics
  const shouldExcludeFromAnalytics = (t: Transaction) => {
    return t.excludeFromAnalytics || t.matchedTransferId || t.isAnalyticsProtected;
  };
  
  // Calculate budget statistics for the selected cycle (with offset support)
  const { cycleExpenses, remaining, isOverspent, progress, daysRemaining, isCompletedCycle } = useMemo(() => {
    const cycleStart = getCycleStartDateWithOffset(cycleType, cycleDay, cycleOffset);
    const cycleEnd = getCycleEndDateForCycleStart(cycleType, cycleDay, cycleStart);
    
    // Filter transactions for this specific cycle
    const cycleTransactions = transactions.filter((t) => {
      const txDate = new Date(t.date);
      return txDate >= cycleStart && txDate <= cycleEnd;
    });
    
    // Calculate expenses, excluding hidden/excluded transactions
    const expenses = cycleTransactions
      .filter(t => t.kind === "expense" && !shouldExcludeFromAnalytics(t))
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
    const rem = budget - expenses;
    const over = rem < 0;
    const prog = budget > 0 ? Math.min(1, expenses / budget) : 0;
    
    // Calculate days remaining (only relevant for current cycle)
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    const isCompleted = cycleOffset < 0 || now > cycleEnd;
    
    let days = 0;
    if (!isCompleted) {
      days = getDaysRemainingInCycle(cycleType, cycleDay);
    }
    
    return {
      cycleExpenses: expenses,
      remaining: rem,
      isOverspent: over,
      progress: prog,
      daysRemaining: days,
      isCompletedCycle: isCompleted,
    };
  }, [transactions, budget, cycleType, cycleDay, cycleOffset]);
  
  const displayRemaining = Math.abs(remaining);

  if (noBudgetSet) {
    return (
      <Pressable 
        onPress={() => {
          console.log("Budget card pressed, navigating to /set-budget");
          router.push("/set-budget");
        }}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
      >
        <View className={`rounded-3xl bg-primary px-5 py-6 shadow-md items-center justify-center min-h-32 ${pressed ? "opacity-70" : "opacity-100"}`}>
          <Text className="text-white text-lg font-semibold">No budget set</Text>
          <Text className="text-white/80 text-sm mt-2">Set up a monthly budget to get started</Text>
          <View className="mt-4 px-6 py-2 rounded-lg bg-white/20">
            <Text className="text-white text-sm font-semibold">Tap to set budget →</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  const bgColor = isOverspent ? "bg-red-600" : "bg-green-600";

  const CardContent = (
    <View className={`rounded-3xl ${bgColor} px-5 py-6 shadow-md ${cardPressed ? "opacity-80" : "opacity-100"}`}>
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-white/80 text-sm">
          {isOverspent ? "Overspent" : "Remaining Spend"}
        </Text>
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            router.push("/set-budget");
          }}
          className="p-2 rounded-full active:bg-white/20"
        >
          <Feather name="edit-2" size={18} color="white" />
        </Pressable>
      </View>
      <Text className="text-white text-4xl font-bold mt-1">
        {loading ? "…" : `${isOverspent ? "-" : ""}${formatCurrency(displayRemaining / 100, currency)}`}
      </Text>
      <View className="mt-4">
        <View className="h-2 w-full rounded-full bg-white/20 overflow-hidden">
          <View
            style={{ width: `${progress * 100}%` }}
            className={`h-2 ${isOverspent ? "bg-red-300" : "bg-white"} rounded-full`}
          />
        </View>
        <View className="flex-row justify-between mt-2">
          <Text className="text-white/80 text-xs">
            {isCompletedCycle 
              ? "Cycle completed" 
              : `${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} remaining`
            }
          </Text>
          <Text className="text-white/80 text-xs">Budget: {formatCurrency(budget / 100, currency)}</Text>
        </View>
      </View>
    </View>
  );

  if (disableNavigation) {
    return CardContent;
  }

  return (
    <Pressable
      onPress={() => router.push("/spend-analytics")}
      onPressIn={() => setCardPressed(true)}
      onPressOut={() => setCardPressed(false)}
    >
      {CardContent}
    </Pressable>
  );
}
