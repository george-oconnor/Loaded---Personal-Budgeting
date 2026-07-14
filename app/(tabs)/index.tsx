import AccountBalanceCard from "@/components/AccountBalanceCard";
import Header from "@/components/Header";
import { ImportReminderBanner } from "@/components/ImportReminderBanner";
import IncomeExpenseRow from "@/components/IncomeExpenseRow";
import LoadingSplash from "@/components/LoadingSplash";
import QuickActions from "@/components/QuickActions";
import RemainingSpendCard from "@/components/RemainingSpendCard";
import TransactionsSection from "@/components/TransactionsSection";
import { getTransactionsInCurrentCycle } from "@/lib/budgetCycle";
import type { QuickAction } from "@/types/type";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useHomeStore } from "@/store/useHomeStore";
import { useSessionStore } from "@/store/useSessionStore";

const quickActions: QuickAction[] = [
  { id: "add", label: "Add", icon: "plus" },
  { id: "analytics", label: "Stats", icon: "bar-chart-2" },
  { id: "balances", label: "Balances", icon: "credit-card" },
];


export default function Index() {
  const {
    summary,
    transactions,
    categories,
    loading,
    fetchHome,
    refreshHomeIfStale,
    cycleType,
    cycleDay,
  } = useHomeStore();

  const { user } = useSessionStore();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    // Cache-first: render persisted data instantly, only hit the network if the
    // cache is missing or stale.
    if (user?.id) {
      refreshHomeIfStale();
    }
  }, [user?.id, refreshHomeIfStale]);

  // On foreground, refresh in the background only if the cache is stale.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === "active" &&
        user?.id
      ) {
        refreshHomeIfStale();
        setRefreshTrigger((prev) => prev + 1);
      }
      appState.current = nextAppState;
    });

    return () => subscription.remove();
  }, [user?.id, refreshHomeIfStale]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchHome();
      // Trigger account balance card refresh
      setRefreshTrigger(prev => prev + 1);
    } finally {
      setRefreshing(false);
    }
  };

  const hasTransactions = transactions && transactions.length > 0;

  // Filter transactions to current budget cycle for sparklines
  const cycleTransactions = useMemo(
    () => getTransactionsInCurrentCycle(transactions ?? [], cycleType, cycleDay),
    [transactions, cycleType, cycleDay]
  );

  // Only show the full splash on a genuine first load (no cached data yet).
  // With cache present we render instantly and refresh in the background.
  if (loading && !summary) {
    return <LoadingSplash />;
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={handleRefresh}
            tintColor="#667eea"
          />
        }
      >
        <Header name={user?.name} />
        
        {/* Import Reminder Banner - shows when accounts haven't been updated in 2+ weeks */}
        {hasTransactions && <ImportReminderBanner />}
        
        <RemainingSpendCard 
          summary={summary} 
          transactions={transactions} 
          loading={loading}
          cycleType={cycleType}
          cycleDay={cycleDay}
        />
        
        {hasTransactions ? (
          <>
            <IncomeExpenseRow summary={summary} loading={loading} transactions={cycleTransactions} />
            <AccountBalanceCard refreshTrigger={refreshTrigger} />
            <QuickActions actions={quickActions} />
            <TransactionsSection transactions={transactions} categories={categories} currency={summary?.currency ?? "EUR"} loading={loading} />
          </>
        ) : (
          !loading && (
            <View className="mt-8 px-4 py-8 bg-blue-50 rounded-3xl">
              <View className="items-center mb-6">
                <View className="w-16 h-16 rounded-full bg-primary/10 items-center justify-center mb-4">
                  <Text className="text-3xl">📊</Text>
                </View>
                <Text className="text-xl font-bold text-dark-100 mb-2 text-center">
                  Get Started
                </Text>
                <Text className="text-base text-gray-600 text-center mb-6">
                  Import your transactions to start tracking your spending and managing your budget
                </Text>
              </View>
              
              <Pressable
                onPress={() => router.push("/import")}
                className="py-4 rounded-2xl items-center bg-primary"
              >
                <Text className="text-white text-base font-bold">Import Transactions</Text>
              </Pressable>
            </View>
          )
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
