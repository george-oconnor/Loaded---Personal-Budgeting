import { formatCurrency } from "@/lib/currencyFunctions";
import { getMerchantIconUrl, getSuggestedMerchantIcon } from "@/lib/merchantIcons";
import { getFrequencyLabel, getMonthlyEquivalent, type RecurringPayment } from "@/lib/recurringPayments";
import { useHomeStore } from "@/store/useHomeStore";
import { useSubscriptionsStore } from "@/store/useSubscriptionsStore";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
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

function PotentialRow({
  item,
  currency,
  categories,
  onConfirm,
  onDismiss,
}: {
  item: RecurringPayment;
  currency: string;
  categories: { id: string; name: string; color?: string; icon?: string }[];
  onConfirm: (payment: RecurringPayment) => void;
  onDismiss: (merchantName: string) => void;
}) {
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconFailed, setIconFailed] = useState(false);
  const category = categories.find((c) => c.id === item.categoryId);
  const monthlyAmount = getMonthlyEquivalent(item.amount, item.frequency);

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

  const confidenceColor =
    item.confidence >= 0.7 ? "#22C55E" : item.confidence >= 0.5 ? "#F59E0B" : "#9CA3AF";
  const confidenceLabel =
    item.confidence >= 0.7 ? "High" : item.confidence >= 0.5 ? "Medium" : "Low";

  return (
    <View className="bg-white rounded-2xl mb-3 border border-gray-100 overflow-hidden">
      {/* Main row */}
      <View className="flex-row items-center px-4 py-3.5">
        {/* Icon */}
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

        {/* Info */}
        <View className="flex-1 mr-2">
          <Text className="text-dark-100 font-semibold text-[15px]" numberOfLines={1}>
            {item.displayName}
          </Text>
          <View className="flex-row items-center mt-0.5">
            <View className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ backgroundColor: confidenceColor }} />
            <Text className="text-gray-500 text-xs">
              {getFrequencyLabel(item.frequency)} · {confidenceLabel} confidence · {item.occurrences} charges
            </Text>
          </View>
        </View>

        {/* Amount */}
        <View className="items-end">
          <Text className="text-dark-100 font-bold text-[15px]">
            {formatCurrency(item.amount / 100, currency)}
          </Text>
          {item.frequency !== "monthly" && (
            <Text className="text-gray-400 text-xs mt-0.5">
              {formatCurrency(monthlyAmount / 100, currency)}/mo
            </Text>
          )}
        </View>
      </View>

      {/* Action buttons */}
      <View className="flex-row border-t border-gray-100">
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onDismiss(item.merchantName);
          }}
          className="flex-1 flex-row items-center justify-center py-2.5 active:bg-gray-50"
        >
          <Feather name="x" size={14} color="#9CA3AF" />
          <Text className="text-gray-500 text-sm ml-1.5">Not a Sub</Text>
        </Pressable>
        <View className="w-px bg-gray-100" />
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onConfirm(item);
          }}
          className="flex-1 flex-row items-center justify-center py-2.5 active:bg-primary/5"
        >
          <Feather name="check" size={14} color="#FE8C00" />
          <Text className="text-primary text-sm font-semibold ml-1.5">Confirm</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function PotentialSubscriptionsScreen() {
  const { potentialSubscriptions, loading, fetchAll, confirmSubscription, dismissSubscription } =
    useSubscriptionsStore();
  const { summary, categories } = useHomeStore();
  const currency = summary?.currency ?? "EUR";
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    // Fetch on mount
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await fetchAll(); } finally { setRefreshing(false); }
  };

  const totalMonthlyPotential = useMemo(
    () => potentialSubscriptions.reduce((sum, rp) => sum + getMonthlyEquivalent(rp.amount, rp.frequency), 0),
    [potentialSubscriptions]
  );

  if (loading && potentialSubscriptions.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#FE8C00" />
        <Text className="text-gray-500 mt-3 text-sm">Analyzing your transactions...</Text>
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
        <View className="flex-row items-center mt-2 mb-5">
          <Pressable onPress={() => router.back()} className="mr-3 p-1">
            <Feather name="chevron-left" size={24} color="#1F2937" />
          </Pressable>
          <Text className="text-2xl font-bold text-dark-100 flex-1">Potential Subscriptions</Text>
        </View>

        {/* Explainer */}
        <View className="bg-blue-50 rounded-2xl px-4 py-3 mb-5 flex-row items-start">
          <Feather name="info" size={16} color="#3B82F6" style={{ marginTop: 2 }} />
          <Text className="text-blue-800 text-sm ml-2.5 flex-1">
            We detected these as possible recurring payments based on your transaction history. Confirm the ones that are subscriptions.
          </Text>
        </View>

        {potentialSubscriptions.length > 0 && (
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-gray-500 text-sm">
              {potentialSubscriptions.length} potential subscription{potentialSubscriptions.length !== 1 ? "s" : ""}
            </Text>
            <Text className="text-gray-400 text-xs">
              ~{formatCurrency(totalMonthlyPotential / 100, currency)}/mo if confirmed
            </Text>
          </View>
        )}

        {potentialSubscriptions.length === 0 && !loading ? (
          <View className="items-center py-12">
            <View className="w-16 h-16 rounded-full bg-green-50 items-center justify-center mb-4">
              <Feather name="check-circle" size={28} color="#22C55E" />
            </View>
            <Text className="text-lg font-semibold text-dark-100 mb-2">All Caught Up</Text>
            <Text className="text-gray-500 text-center text-sm px-8">
              No new potential subscriptions detected. Import more transactions or check back later.
            </Text>
          </View>
        ) : (
          potentialSubscriptions.map((item) => (
            <PotentialRow
              key={item.merchantName}
              item={item}
              currency={currency}
              categories={categories}
              onConfirm={confirmSubscription}
              onDismiss={dismissSubscription}
            />
          ))
        )}

        <View className="mt-3 mb-5 px-2">
          <Text className="text-gray-400 text-xs text-center">
            Detection requires at least 3 matching charges with consistent amounts and timing.
            Dismissed items won&apos;t appear again.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
