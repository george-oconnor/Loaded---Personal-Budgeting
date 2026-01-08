import TransactionListItem from "@/components/TransactionListItem";
import { databases, getTransactionsPaginated } from "@/lib/appwrite";
import { getQueuedTransactions } from "@/lib/syncQueue";
import { useHomeStore } from "@/store/useHomeStore";
import { useSessionStore } from "@/store/useSessionStore";
import { useTransactionDetailStore } from "@/store/useTransactionDetailStore";
import type { Transaction } from "@/types/type";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    RefreshControl,
    ScrollView,
    Text,
    View
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

type GroupedTransaction = {
  type: "header" | "transaction";
  date?: string;
  dateLabel?: string;
  transaction?: Transaction;
  id: string;
};

export default function AllTransactionsScreen() {
  const { categories, summary } = useHomeStore();
  const { user } = useSessionStore();
  const { filter } = useLocalSearchParams<{ filter?: string }>();
  const [selectedFilter, setSelectedFilter] = useState<string>("all");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const currency = summary?.currency ?? "USD";

  // Apply filter from URL params on mount
  useEffect(() => {
    if (filter && (filter === "income" || filter === "expense" || filter === "all" || filter === "hidden")) {
      setSelectedFilter(filter);
    }
  }, [filter]);

  // Load initial transactions
  useEffect(() => {
    loadTransactions(true);
  }, []);

  // Reload when filter changes
  useEffect(() => {
    loadTransactions(true);
  }, [selectedFilter]);

  const loadTransactions = async (reset: boolean = false) => {
    if (!user?.id) return;
    
    if (reset) {
      setLoading(true);
      setTransactions([]);
      setCursor(undefined);
      setHasMore(true);
    } else {
      if (!hasMore || loadingMore) return;
      setLoadingMore(true);
    }

    try {
      const [result, queuedTxs] = await Promise.all([
        getTransactionsPaginated(user.id, 25, reset ? undefined : cursor),
        reset ? getQueuedTransactions() : Promise.resolve([]),
      ]);
      
      const newTransactions: Transaction[] = result.documents.map((t) => {
        const docId = (t as any).$id ?? (t as any).id;
        const safeId = typeof docId === "string"
          ? docId
          : `${t.userId}-${t.date}-${t.title ?? ""}-${t.amount}`;

        return {
          id: safeId,
          title: t.title,
          subtitle: t.subtitle || "",
          amount: t.amount,
          categoryId: t.categoryId,
          kind: t.kind,
          date: t.date,
          currency: t.currency,
          source: (t as any).source,
          displayName: (t as any).displayName,
          excludeFromAnalytics: (t as any).excludeFromAnalytics,
          isAnalyticsProtected: (t as any).isAnalyticsProtected,
          matchedTransferId: (t as any).matchedTransferId,
          hideMerchantIcon: (t as any).hideMerchantIcon,
        };
      });

      // Add queued transactions (only on reset/initial load)
      if (reset) {
        const userQueuedTxs = queuedTxs.filter(t => t.userId === user.id);
        const queuedTransactions: Transaction[] = userQueuedTxs.map((t) => ({
          id: t.id,
          title: t.title,
          subtitle: t.subtitle,
          amount: t.amount,
          categoryId: t.categoryId,
          kind: t.kind,
          date: t.date,
          currency: t.currency,
          source: t.source,
          displayName: t.displayName,
          excludeFromAnalytics: t.excludeFromAnalytics,
          isAnalyticsProtected: t.isAnalyticsProtected,
          matchedTransferId: t.matchedTransferId,
          hideMerchantIcon: t.hideMerchantIcon,
        }));

        // Combine and sort by date (most recent first)
        const combined = dedupeById([...newTransactions, ...queuedTransactions]).sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        
        setTransactions(combined);
      } else {
        setTransactions(prev => dedupeById([...prev, ...newTransactions]));
      }

      setHasMore(result.hasMore);
      setCursor(result.lastCursor);
    } catch (error) {
      console.error("Failed to load transactions:", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const dedupeById = (list: Transaction[]) => {
    const byId = new Map<string, Transaction>();
    for (const tx of list) {
      if (!tx.id) continue;
      // Keep the latest occurrence (later in list wins) to favor freshly fetched data
      byId.set(tx.id, tx);
    }
    return Array.from(byId.values());
  };

  const handleLoadMore = useCallback(() => {
    if (hasMore && !loadingMore && !loading) {
      loadTransactions(false);
    }
  }, [hasMore, loadingMore, loading, cursor]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTransactions(true);
    setRefreshing(false);
  }, [user?.id]);

  const handleExcludeFromAnalytics = async (transaction: Transaction) => {
    try {
      const databaseId = process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID as string;
      const transactionsTableId = (process.env.EXPO_PUBLIC_APPWRITE_TABLE_TRANSACTIONS || process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_TRANSACTIONS) as string;
      
      await databases.updateDocument(
        databaseId,
        transactionsTableId,
        transaction.id,
        { excludeFromAnalytics: true }
      );

      // Refresh the list
      await loadTransactions(true);
      
      // Refresh home store to reflect analytics changes
      const { fetchHome } = useHomeStore.getState();
      fetchHome();
    } catch (error) {
      console.error("Failed to exclude transaction:", error);
    }
  };

  // Helper to check if a transaction is automatically flagged as a transfer
  const isAutoFlaggedTransfer = (t: Transaction) => {
    return !!(t.matchedTransferId || t.isAnalyticsProtected);
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (selectedFilter === "all") {
        // Exclude auto-flagged transfers from All view
        return !isAutoFlaggedTransfer(t);
      }
      if (selectedFilter === "hidden") {
        // Show only auto-flagged transfers
        return isAutoFlaggedTransfer(t);
      }
      if (selectedFilter === "income" || selectedFilter === "expense") {
        // Exclude auto-flagged transfers from income/expense view
        return t.kind === selectedFilter && !isAutoFlaggedTransfer(t);
      }
      // It's a category filter - exclude auto-flagged transfers
      return t.categoryId === selectedFilter && !isAutoFlaggedTransfer(t);
    });
  }, [transactions, selectedFilter]);

  const formatDateHeader = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Reset time parts for comparison
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const yesterdayOnly = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());

    if (dateOnly.getTime() === todayOnly.getTime()) {
      return "Today";
    } else if (dateOnly.getTime() === yesterdayOnly.getTime()) {
      return "Yesterday";
    } else {
      return date.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
      });
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  // Group transactions by date
  const groupedData = useMemo(() => {
    const sorted = [...filteredTransactions].sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    const grouped: GroupedTransaction[] = [];
    let currentDate = "";

    sorted.forEach((transaction, index) => {
      const transactionDate = new Date(transaction.date).toDateString();
      
      if (transactionDate !== currentDate) {
        currentDate = transactionDate;
        grouped.push({
          type: "header",
          date: transaction.date,
          dateLabel: formatDateHeader(transaction.date),
          id: `header-${transactionDate}`,
        });
      }

      grouped.push({
        type: "transaction",
        transaction,
        id:
          transaction.id ||
          `transaction-${transaction.date}-${transaction.title}-${transaction.amount}-${index}`,
      });
    });

    return grouped;
  }, [filteredTransactions]);

  const getTransactionIcon = (categoryName: string | undefined, kind: "income" | "expense") => {
    const key = (categoryName || "").toLowerCase();

    if (key.includes("grocery") || key.includes("supermarket") || key.includes("food") || key.includes("restaurant") || key.includes("coffee")) {
      return "shopping-bag";
    }
    if (key.includes("transport") || key.includes("taxi") || key.includes("uber") || key.includes("bolt") || key.includes("bus") || key.includes("train") || key.includes("travel") || key.includes("flight") || key.includes("fuel") || key.includes("petrol") || key.includes("gas")) {
      return "truck";
    }
    if (key.includes("bill") || key.includes("utility") || key.includes("wifi") || key.includes("internet") || key.includes("phone")) {
      return "file";
    }
    if (key.includes("entertain") || key.includes("movie") || key.includes("film") || key.includes("music") || key.includes("tv")) {
      return "play";
    }
    if (key.includes("shop") || key.includes("retail") || key.includes("store") || key.includes("clothe")) {
      return "shopping-bag";
    }
    if (key.includes("health") || key.includes("medical") || key.includes("gym") || key.includes("fitness") || key.includes("doctor")) {
      return "heart";
    }
    if (key.includes("rent") || key.includes("mortgage") || key.includes("home") || key.includes("housing")) {
      return "home";
    }
    if (key.includes("salary") || key.includes("pay") || key.includes("wage") || key.includes("income")) {
      return "trending-up";
    }
    if (key.includes("transfer")) {
      return "repeat";
    }
    if (key.includes("education") || key.includes("school") || key.includes("tuition")) {
      return "book";
    }
    if (key.includes("gift") || key.includes("donation") || key.includes("charity")) {
      return "gift";
    }

    return "dollar-sign";
  };

  const getTransactionColor = (kind: "income" | "expense") => {
    return kind === "income" ? "#10B981" : "#EF4444";
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1">
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

            <Text className="text-xs text-gray-500">All</Text>
          </View>

          <View className="mt-1 items-end">
            <Text className="text-2xl font-bold text-dark-100">All Transactions</Text>
          </View>
        </View>

        {/* Combined Filters */}
        <View className="px-5 py-3 border-b border-gray-100">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-2">
              {/* All */}
              <Pressable
                onPress={() => setSelectedFilter("all")}
                className={`px-4 py-2 rounded-full ${
                  selectedFilter === "all" ? "bg-primary" : "bg-gray-100"
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    selectedFilter === "all" ? "text-white" : "text-gray-700"
                  }`}
                >
                  All
                </Text>
              </Pressable>

              {/* Income */}
              <Pressable
                onPress={() => setSelectedFilter("income")}
                className={`px-4 py-2 rounded-full ${
                  selectedFilter === "income" ? "bg-green-500" : "bg-green-100"
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    selectedFilter === "income" ? "text-white" : "text-green-700"
                  }`}
                >
                  Income
                </Text>
              </Pressable>

              {/* Expenses */}
              <Pressable
                onPress={() => setSelectedFilter("expense")}
                className={`px-4 py-2 rounded-full ${
                  selectedFilter === "expense" ? "bg-red-500" : "bg-red-100"
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    selectedFilter === "expense" ? "text-white" : "text-red-700"
                  }`}
                >
                  Expenses
                </Text>
              </Pressable>

              {/* Categories */}
              {categories
                .filter((cat) => cat.id !== "all")
                .map((cat) => {
                  const active = selectedFilter === cat.id;
                  const bg = active ? cat.color || "#7C3AED" : "#F3F4F6";
                  const textColor = active ? "#FFFFFF" : "#111827";
                  return (
                    <Pressable
                      key={cat.id}
                      onPress={() => setSelectedFilter(cat.id)}
                      className="px-4 py-2 rounded-full"
                      style={{ backgroundColor: bg }}
                    >
                      <Text className="text-sm font-semibold" style={{ color: textColor }}>
                        {cat.name}
                      </Text>
                    </Pressable>
                  );
                })}

              {/* Hidden */}
              <Pressable
                onPress={() => setSelectedFilter("hidden")}
                className={`px-4 py-2 rounded-full ${
                  selectedFilter === "hidden" ? "bg-gray-700" : "bg-gray-100"
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    selectedFilter === "hidden" ? "text-white" : "text-gray-700"
                  }`}
                >
                  Hidden
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>

        {/* Transaction List */}
        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#7C3AED" />
          </View>
        ) : (
          <FlatList
            data={groupedData}
            keyExtractor={(item) => item.id}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                colors={["#7C3AED"]}
                tintColor="#7C3AED"
              />
            }
            renderItem={({ item }) => {
              if (item.type === "header") {
                return (
                  <View className="px-5 pt-4 pb-2 bg-gray-50">
                    <Text className="font-semibold text-sm text-gray-700">
                      {item.dateLabel}
                    </Text>
                  </View>
                );
              }

              const transaction = item.transaction!;
              return (
                <Swipeable
                  key={transaction.id}
                  renderRightActions={() => (
                    <Pressable
                      onPress={() => handleExcludeFromAnalytics(transaction)}
                      className="flex-row items-center justify-center px-4 bg-gray-500 ml-2"
                      style={{ width: 120, height: '100%' }}
                    >
                      <Feather name="eye-off" size={18} color="#fff" />
                      <Text className="text-white font-semibold ml-2">Exclude</Text>
                    </Pressable>
                  )}
                  overshootRight={false}
                >
                  <Pressable
                    onPress={() => {
                      console.log("Transaction ID being set:", transaction.id, "Length:", transaction.id.length);
                      useTransactionDetailStore.getState().setSelectedTransactionId(transaction.id);
                      router.push("/transaction-detail");
                    }}
                    className="active:opacity-70 bg-white"
                  >
                    <TransactionListItem
                      transaction={transaction}
                      currency={currency}
                      categoryName={categories.find((cat) => cat.id === transaction.categoryId)?.name}
                      onPress={() => {
                        useTransactionDetailStore.getState().setSelectedTransactionId(transaction.id);
                        router.push("/transaction-detail");
                      }}
                    />
                  </Pressable>
                </Swipeable>
              );
            }}
            ListEmptyComponent={
              <View className="items-center justify-center py-20">
                <Feather name="inbox" size={48} color="#D1D5DB" />
                <Text className="text-gray-400 text-base mt-4">No transactions found</Text>
              </View>
            }
            ListFooterComponent={
              loadingMore ? (
                <View className="py-4 items-center">
                  <ActivityIndicator size="small" color="#7C3AED" />
                </View>
              ) : null
            }
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.5}
            contentContainerStyle={{ flexGrow: 1 }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
