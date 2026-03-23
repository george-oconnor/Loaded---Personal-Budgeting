import { formatCurrency } from "@/lib/currencyFunctions";
import { getMerchantIconUrl, getSuggestedMerchantIcon } from "@/lib/merchantIcons";
import { getFrequencyLabel, getMonthlyEquivalent, type RecurringFrequency } from "@/lib/recurringPayments";
import { useHomeStore } from "@/store/useHomeStore";
import { useSubscriptionsStore, type ConfirmedSubscription } from "@/store/useSubscriptionsStore";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useSegments } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

function getDefaultCategoryIcon(categoryName: string): string {
  const name = (categoryName || "").toLowerCase();
  const map: Record<string, string> = {
    food: "coffee",
    groceries: "shopping-bag",
    transport: "navigation",
    entertainment: "play",
    shopping: "shopping-bag",
    bills: "file",
    utilities: "zap",
    health: "heart",
    services: "cloud",
    sport: "activity",
    general: "inbox",
  };
  return map[name] || "repeat";
}

function ConfirmedRow({
  item,
  currency,
  categories,
  onRemove,
}: {
  item: ConfirmedSubscription;
  currency: string;
  categories: { id: string; name: string; color?: string; icon?: string }[];
  onRemove: (id: string) => void;
}) {
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconFailed, setIconFailed] = useState(false);
  const category = categories.find((c) => c.id === item.categoryId);
  const freq = item.frequency as RecurringFrequency;
  const monthlyAmount = getMonthlyEquivalent(item.amount, freq);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const suggested = await getSuggestedMerchantIcon(item.displayName);
      if (!cancelled && suggested) { setIconUrl(suggested); return; }
      const builtin = getMerchantIconUrl(item.displayName);
      if (!cancelled && builtin) setIconUrl(builtin);
    })();
    return () => { cancelled = true; };
  }, [item.displayName]);

  const nextDate = item.nextBillingDate ? new Date(item.nextBillingDate) : null;
  const now = new Date();
  const daysUntilNext = nextDate
    ? Math.ceil((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const nextLabel = !nextDate
    ? getFrequencyLabel(freq)
    : daysUntilNext != null && daysUntilNext <= 0
      ? "Due now"
      : daysUntilNext === 1
        ? "Tomorrow"
        : daysUntilNext != null && daysUntilNext <= 7
          ? `In ${daysUntilNext} days`
          : nextDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const statusColor =
    item.status === "active" ? "#22C55E" : item.status === "paused" ? "#F59E0B" : "#EF4444";

  const handleLongPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      item.displayName,
      "What would you like to do?",
      [
        {
          text: "Remove Subscription",
          style: "destructive",
          onPress: () => onRemove(item.id),
        },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/merchant-detail", params: { name: item.displayName } })}
      onLongPress={handleLongPress}
      className="flex-row items-center bg-white rounded-2xl px-4 py-3.5 mb-2.5 border border-gray-100 active:opacity-80"
    >
      <View
        className="w-11 h-11 rounded-full items-center justify-center mr-3 overflow-hidden"
        style={{ backgroundColor: iconUrl && !iconFailed ? "#F3F4F6" : (category?.color ?? "#6C63FF") + "20" }}
      >
        {iconUrl && !iconFailed ? (
          <Image
            source={{ uri: iconUrl }}
            style={{ width: 28, height: 28, borderRadius: 14 }}
            onError={() => setIconFailed(true)}
          />
        ) : (
          <Feather
            name={getDefaultCategoryIcon(category?.name ?? "") as any}
            size={20}
            color={category?.color ?? "#6C63FF"}
          />
        )}
      </View>

      <View className="flex-1 mr-2">
        <Text className="text-dark-100 font-semibold text-[15px]" numberOfLines={1}>
          {item.displayName}
        </Text>
        <View className="flex-row items-center mt-0.5">
          <View className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ backgroundColor: statusColor }} />
          <Text className="text-gray-500 text-xs">
            {getFrequencyLabel(freq)} · {nextLabel}
          </Text>
        </View>
      </View>

      <View className="items-end">
        <Text className="text-dark-100 font-bold text-[15px]">
          {formatCurrency(item.amount / 100, currency)}
        </Text>
        {freq !== "monthly" && (
          <Text className="text-gray-400 text-xs mt-0.5">
            {formatCurrency(monthlyAmount / 100, currency)}/mo
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export default function SubscriptionsScreen() {
  const segments = useSegments();
  const isTab = segments[0] === "(tabs)";
  const { confirmedSubscriptions, potentialSubscriptions, loading, fetchAll, removeConfirmed } =
    useSubscriptionsStore();
  const { summary, categories } = useHomeStore();
  const currency = summary?.currency ?? "EUR";
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await fetchAll(); } finally { setRefreshing(false); }
  };

  const activeSubscriptions = useMemo(
    () => confirmedSubscriptions.filter((s) => s.status === "active"),
    [confirmedSubscriptions]
  );

  const totalMonthly = useMemo(
    () =>
      activeSubscriptions.reduce(
        (sum, s) => sum + getMonthlyEquivalent(s.amount, s.frequency as RecurringFrequency),
        0
      ),
    [activeSubscriptions]
  );

  const totalAnnual = totalMonthly * 12;

  const upcoming = useMemo(() => {
    const now = new Date();
    const weekFromNow = new Date();
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    return activeSubscriptions
      .filter((s) => {
        if (!s.nextBillingDate) return false;
        const next = new Date(s.nextBillingDate);
        return next >= now && next <= weekFromNow;
      })
      .sort((a, b) => new Date(a.nextBillingDate!).getTime() - new Date(b.nextBillingDate!).getTime());
  }, [activeSubscriptions]);

  const grouped = useMemo(() => {
    const map = new Map<string, ConfirmedSubscription[]>();
    for (const s of activeSubscriptions) {
      const cat = categories.find((c) => c.id === s.categoryId);
      const key = cat?.name ?? "Other";
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const totalA = a[1].reduce((s, r) => s + getMonthlyEquivalent(r.amount, r.frequency as RecurringFrequency), 0);
      const totalB = b[1].reduce((s, r) => s + getMonthlyEquivalent(r.amount, r.frequency as RecurringFrequency), 0);
      return totalB - totalA;
    });
  }, [activeSubscriptions, categories]);

  // Only show blocking spinner on first-ever load
  if (loading && confirmedSubscriptions.length === 0 && !useSubscriptionsStore.getState().lastFetched) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#FE8C00" />
        <Text className="text-gray-500 mt-3 text-sm">Loading subscriptions...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#667eea" />
        }
      >
        {/* Header */}
        <View className="pt-4 pb-5">
          <View className="flex-row items-center">
            {!isTab && router.canGoBack() && (
              <Pressable onPress={() => router.back()} className="mr-3 p-1">
                <Feather name="chevron-left" size={24} color="#1F2937" />
              </Pressable>
            )}
            <Text className="text-2xl font-bold text-dark-100 flex-1">Subscriptions</Text>
            <Pressable
              onPress={() => router.push("/potential-subscriptions")}
              className="flex-row items-center bg-primary/10 rounded-full px-3 py-1.5"
            >
              <Feather name="search" size={14} color="#FE8C00" />
              {potentialSubscriptions.length > 0 && (
                <View className="bg-primary rounded-full w-5 h-5 items-center justify-center ml-1.5">
                  <Text className="text-white text-[10px] font-bold">{potentialSubscriptions.length}</Text>
                </View>
              )}
            </Pressable>
          </View>
          <Text className="text-sm text-gray-500 mt-2">Manage your recurring payments</Text>
        </View>

        {/* Summary Card */}
        <View className="rounded-2xl p-5 mb-5" style={{ backgroundColor: "#181C2E" }}>
          <Text className="text-gray-400 text-sm mb-1">Monthly Cost</Text>
          <Text className="text-white text-3xl font-bold mb-3">
            {formatCurrency(totalMonthly / 100, currency)}
          </Text>
          <View className="flex-row justify-between">
            <View>
              <Text className="text-gray-500 text-xs">Annual</Text>
              <Text className="text-gray-300 text-base font-semibold">
                {formatCurrency(totalAnnual / 100, currency)}
              </Text>
            </View>
            <View className="items-end">
              <Text className="text-gray-500 text-xs">Active</Text>
              <Text className="text-gray-300 text-base font-semibold">
                {activeSubscriptions.length} subscription{activeSubscriptions.length !== 1 ? "s" : ""}
              </Text>
            </View>
          </View>
        </View>

        {activeSubscriptions.length === 0 ? (
          <View className="items-center py-12">
            <View className="w-16 h-16 rounded-full bg-gray-100 items-center justify-center mb-4">
              <Feather name="repeat" size={28} color="#9CA3AF" />
            </View>
            <Text className="text-lg font-semibold text-dark-100 mb-2">No Subscriptions Yet</Text>
            <Text className="text-gray-500 text-center text-sm px-8 mb-5">
              We&apos;ve detected potential subscriptions from your transactions. Review and confirm them to start tracking.
            </Text>
            {potentialSubscriptions.length > 0 && (
              <Pressable
                onPress={() => router.push("/potential-subscriptions")}
                className="bg-primary py-3 px-6 rounded-2xl"
              >
                <Text className="text-white font-bold text-sm">
                  Review {potentialSubscriptions.length} Potential Subscription{potentialSubscriptions.length !== 1 ? "s" : ""}
                </Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            {/* Potential subscriptions banner */}
            {potentialSubscriptions.length > 0 && (
              <Pressable
                onPress={() => router.push("/potential-subscriptions")}
                className="flex-row items-center bg-amber-50 rounded-2xl px-4 py-3 mb-5 border border-amber-200"
              >
                <Feather name="alert-circle" size={18} color="#F59E0B" />
                <Text className="flex-1 text-amber-800 text-sm ml-2.5 font-medium">
                  {potentialSubscriptions.length} potential subscription{potentialSubscriptions.length !== 1 ? "s" : ""} detected
                </Text>
                <Feather name="chevron-right" size={16} color="#F59E0B" />
              </Pressable>
            )}

            {/* Upcoming this week */}
            {upcoming.length > 0 && (
              <View className="mb-5">
                <Text className="text-base font-bold text-dark-100 mb-2.5">Coming Up</Text>
                {upcoming.map((item) => (
                  <ConfirmedRow
                    key={item.id}
                    item={item}
                    currency={currency}
                    categories={categories}
                    onRemove={removeConfirmed}
                  />
                ))}
              </View>
            )}

            {/* All confirmed grouped by category */}
            {grouped.map(([categoryName, items]) => (
              <View key={categoryName} className="mb-5">
                <View className="flex-row items-center justify-between mb-2.5">
                  <Text className="text-base font-bold text-dark-100">{categoryName}</Text>
                  <Text className="text-gray-500 text-xs">
                    {formatCurrency(
                      items.reduce((s, r) => s + getMonthlyEquivalent(r.amount, r.frequency as RecurringFrequency), 0) / 100,
                      currency
                    )}/mo
                  </Text>
                </View>
                {items.map((item) => (
                  <ConfirmedRow
                    key={item.id}
                    item={item}
                    currency={currency}
                    categories={categories}
                    onRemove={removeConfirmed}
                  />
                ))}
              </View>
            ))}
          </>
        )}

        <View className="mt-3 mb-5 px-2">
          <Text className="text-gray-400 text-xs text-center">
            Long press a subscription to remove it. Amounts and dates are estimates based on your transaction history.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
