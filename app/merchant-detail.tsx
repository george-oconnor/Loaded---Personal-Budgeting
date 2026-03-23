import TransactionListItem from "@/components/TransactionListItem";
import { getCycleStartDate } from "@/lib/budgetCycle";
import { formatCurrency } from "@/lib/currencyFunctions";
import { getMerchantIconUrl, getSuggestedMerchantIcon } from "@/lib/merchantIcons";
import { useHomeStore } from "@/store/useHomeStore";
import { useTransactionDetailStore } from "@/store/useTransactionDetailStore";
import type { Transaction } from "@/types/type";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, SectionList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function MerchantDetailScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const { transactions, categories, summary, cycleType, cycleDay } = useHomeStore();
  const { setSelectedTransactionId } = useTransactionDetailStore();
  const currency = summary?.currency ?? "EUR";

  // Find all transactions for this merchant (by displayName or title)
  const merchantTransactions = useMemo(() => {
    if (!name || !transactions) return [];
    const q = name.toLowerCase();
    return transactions
      .filter((t) => {
        const display = (t.displayName || t.title || "").toLowerCase();
        return display === q;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [name, transactions]);

  // Split into current cycle vs historic
  const cycleStart = useMemo(
    () => getCycleStartDate(cycleType, cycleDay),
    [cycleType, cycleDay]
  );

  const { thisCycle, historic } = useMemo(() => {
    const current: Transaction[] = [];
    const past: Transaction[] = [];
    for (const t of merchantTransactions) {
      if (new Date(t.date) >= cycleStart) {
        current.push(t);
      } else {
        past.push(t);
      }
    }
    return { thisCycle: current, historic: past };
  }, [merchantTransactions, cycleStart]);

  const sections = useMemo(() => {
    const s: { title: string; data: Transaction[] }[] = [];
    if (thisCycle.length > 0) s.push({ title: "This Cycle", data: thisCycle });
    if (historic.length > 0) s.push({ title: "Historic", data: historic });
    return s;
  }, [thisCycle, historic]);

  // Stats (exclude transactions flagged excludeFromAnalytics)
  const analyticsTransactions = useMemo(
    () => merchantTransactions.filter((t) => !t.excludeFromAnalytics),
    [merchantTransactions]
  );
  const totalSpent = useMemo(
    () => analyticsTransactions.reduce((sum, t) => sum + t.amount, 0),
    [analyticsTransactions]
  );
  const expenseCount = analyticsTransactions.filter((t) => t.kind === "expense").length;
  const incomeCount = analyticsTransactions.filter((t) => t.kind === "income").length;
  const avgAmount = analyticsTransactions.length > 0
    ? totalSpent / analyticsTransactions.length
    : 0;

  // Cycle-specific in/out totals
  const cycleAnalytics = useMemo(
    () => thisCycle.filter((t) => !t.excludeFromAnalytics),
    [thisCycle]
  );
  const cycleOut = useMemo(
    () => cycleAnalytics.filter((t) => t.kind === "expense").reduce((sum, t) => sum + Math.abs(t.amount), 0),
    [cycleAnalytics]
  );
  const cycleIn = useMemo(
    () => cycleAnalytics.filter((t) => t.kind === "income").reduce((sum, t) => sum + Math.abs(t.amount), 0),
    [cycleAnalytics]
  );

  // Merchant icon (same chain as search MerchantIcon)
  const [tldIndex, setTldIndex] = useState(0);
  const [iconFailed, setIconFailed] = useState(false);
  const [crowdSourcedUrl, setCrowdSourcedUrl] = useState<string | null>(null);
  const [crowdSourcedFailed, setCrowdSourcedFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    setCrowdSourcedUrl(null);
    setCrowdSourcedFailed(false);
    setIconFailed(false);
    setTldIndex(0);

    if (name) {
      getSuggestedMerchantIcon(name, 128)
        .then((url) => mounted && setCrowdSourcedUrl(url))
        .catch(() => mounted && setCrowdSourcedUrl(null));
    }
    return () => { mounted = false; };
  }, [name]);

  const effectiveCrowdSourced = crowdSourcedUrl && !crowdSourcedFailed ? crowdSourcedUrl : null;
  const builtInUrl = iconFailed ? null : getMerchantIconUrl(name ?? "", 128, tldIndex);
  const iconUrl = effectiveCrowdSourced || (iconFailed ? null : builtInUrl);
  const isCrowdSourced = effectiveCrowdSourced && iconUrl === effectiveCrowdSourced;

  const handleIconError = () => {
    if (isCrowdSourced) { setCrowdSourcedFailed(true); return; }
    if (tldIndex < 2) { setTldIndex(tldIndex + 1); return; }
    setIconFailed(true);
  };

  const handleTransactionPress = (id: string) => {
    setSelectedTransactionId(id);
    router.push("/transaction-detail");
  };

  const renderTransaction = ({ item }: { item: Transaction }) => {
    const category = categories.find((c) => c.id === item.categoryId);
    return (
      <TransactionListItem
        transaction={item}
        currency={currency}
        categoryName={category?.name}
        onPress={() => handleTransactionPress(item.id)}
      />
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderTransaction}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderSectionHeader={({ section: { title } }) => (
          <View className="px-5 pt-5 pb-2 bg-white">
            <Text className="text-sm font-quicksand-semibold text-gray-100 uppercase tracking-wider">
              {title}
            </Text>
          </View>
        )}
        ListHeaderComponent={
          <View>
            {/* Back button */}
            <View className="px-5 pt-2 pb-4">
              <Pressable onPress={() => router.back()} className="flex-row items-center" hitSlop={8}>
                <Feather name="arrow-left" size={22} color="#181C2E" />
                <Text className="text-base text-dark-100 ml-2 font-quicksand-semibold">Back</Text>
              </Pressable>
            </View>

            {/* Merchant header */}
            <View className="items-center px-5 pb-6">
              {iconUrl ? (
                <View
                  className="w-20 h-20 rounded-full items-center justify-center mb-4"
                  style={{ backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB" }}
                >
                  <Image
                    source={{ uri: iconUrl }}
                    style={{ width: 56, height: 56, borderRadius: 28 }}
                    resizeMode="contain"
                    onError={handleIconError}
                  />
                </View>
              ) : (
                <View
                  className="w-20 h-20 rounded-full items-center justify-center mb-4"
                  style={{ backgroundColor: "#FE8C0020" }}
                >
                  <Feather name="shopping-bag" size={32} color="#FE8C00" />
                </View>
              )}
              <Text className="text-2xl font-quicksand-bold text-dark-100 text-center">
                {name}
              </Text>
              <Text className="text-sm text-gray-100 mt-1">
                {merchantTransactions.length} transaction{merchantTransactions.length !== 1 ? "s" : ""}
              </Text>
            </View>

            {/* This Cycle in/out */}
            <View className="flex-row mx-5 mb-3 rounded-2xl bg-gray-50 py-4">
              <View className="flex-1 items-center">
                <Text className="text-xs text-gray-100 mb-1">Out This Cycle</Text>
                <Text className="text-base font-quicksand-bold text-error">
                  {cycleOut > 0 ? `-${formatCurrency(cycleOut / 100, currency)}` : formatCurrency(0, currency)}
                </Text>
              </View>
              <View style={{ width: 1, backgroundColor: "#E5E7EB" }} />
              <View className="flex-1 items-center">
                <Text className="text-xs text-gray-100 mb-1">In This Cycle</Text>
                <Text className="text-base font-quicksand-bold text-success">
                  {cycleIn > 0 ? `+${formatCurrency(cycleIn / 100, currency)}` : formatCurrency(0, currency)}
                </Text>
              </View>
            </View>

            {/* All-time stats row */}
            <View className="flex-row mx-5 mb-2 rounded-2xl bg-gray-50 py-4">
              <View className="flex-1 items-center">
                <Text className="text-xs text-gray-100 mb-1">All Time</Text>
                <Text className="text-base font-quicksand-bold text-dark-100">
                  {formatCurrency(Math.abs(totalSpent) / 100, currency)}
                </Text>
              </View>
              <View style={{ width: 1, backgroundColor: "#E5E7EB" }} />
              <View className="flex-1 items-center">
                <Text className="text-xs text-gray-100 mb-1">Average</Text>
                <Text className="text-base font-quicksand-bold text-dark-100">
                  {formatCurrency(Math.abs(avgAmount) / 100, currency)}
                </Text>
              </View>
              <View style={{ width: 1, backgroundColor: "#E5E7EB" }} />
              <View className="flex-1 items-center">
                <Text className="text-xs text-gray-100 mb-1">
                  {incomeCount > 0 && expenseCount > 0 ? "Split" : expenseCount > 0 ? "Expenses" : "Income"}
                </Text>
                <Text className="text-base font-quicksand-bold text-dark-100">
                  {incomeCount > 0 && expenseCount > 0
                    ? `${expenseCount}/${incomeCount}`
                    : merchantTransactions.length}
                </Text>
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View className="items-center py-12 px-8">
            <Text className="text-base text-gray-100">No transactions found</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}
