import { getTransactionsInRangeAll } from "@/lib/appwrite";
import { formatCurrency } from "@/lib/currencyFunctions";
import { getMerchantIconUrl, getSuggestedMerchantIcon } from "@/lib/merchantIcons";
import {
  analyzeSelectedTransactions,
  getFrequencyLabel,
  type RecurringFrequency,
} from "@/lib/recurringPayments";
import { useHomeStore } from "@/store/useHomeStore";
import { useSessionStore } from "@/store/useSessionStore";
import { useSubscriptionsStore } from "@/store/useSubscriptionsStore";
import type { Transaction } from "@/types/type";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const FREQUENCIES: RecurringFrequency[] = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "annual",
];

export default function CreateSubscriptionScreen() {
  const { merchantName, categoryId, transactionId } =
    useLocalSearchParams<{
      merchantName: string;
      categoryId: string;
      transactionId: string;
    }>();

  const { user } = useSessionStore();
  const { summary, categories } = useHomeStore();
  const { manualConfirmSubscription } = useSubscriptionsStore();
  const currency = summary?.currency ?? "EUR";

  // Step 1: select transactions, Step 2: review & confirm
  const [step, setStep] = useState<1 | 2>(1);
  const [merchantTxs, setMerchantTxs] = useState<Transaction[]>([]);
  const [loadingTxs, setLoadingTxs] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Step 2 editable fields
  const [frequency, setFrequency] = useState<RecurringFrequency>("monthly");
  const [amountStr, setAmountStr] = useState("");
  const [displayName, setDisplayName] = useState(merchantName ?? "");

  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconFailed, setIconFailed] = useState(false);

  const category = categories.find((c) => c.id === categoryId);

  // Load merchant icon
  useEffect(() => {
    if (!merchantName) return;
    let cancelled = false;
    (async () => {
      const suggested = await getSuggestedMerchantIcon(merchantName);
      if (!cancelled && suggested) {
        setIconUrl(suggested);
        return;
      }
      const builtin = getMerchantIconUrl(merchantName);
      if (!cancelled && builtin) setIconUrl(builtin);
    })();
    return () => {
      cancelled = true;
    };
  }, [merchantName]);

  // Fetch all transactions from this merchant (12 months)
  useEffect(() => {
    if (!user?.id || !merchantName) return;
    let cancelled = false;

    (async () => {
      setLoadingTxs(true);
      const end = new Date();
      const start = new Date();
      start.setFullYear(start.getFullYear() - 1);

      const docs = await getTransactionsInRangeAll(
        user.id,
        start.toISOString(),
        end.toISOString()
      );
      if (cancelled) return;

      const merchantLower = merchantName.toLowerCase();
      const txs: Transaction[] = docs
        .filter((d: any) => {
          const name = (
            d.displayName ||
            d.title ||
            ""
          ).toLowerCase();
          return name === merchantLower;
        })
        .map((d: any) => ({
          id: d.$id ?? d.id,
          title: d.title ?? "",
          subtitle: d.subtitle ?? "",
          amount: d.amount ?? 0,
          categoryId: d.categoryId ?? "",
          kind: d.kind ?? "expense",
          date: d.date ?? "",
          currency: d.currency,
          displayName: d.displayName,
          account: d.account,
        }))
        .sort(
          (a: Transaction, b: Transaction) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
        );

      setMerchantTxs(txs);

      // Pre-select the current transaction if provided
      if (transactionId) {
        setSelectedIds(new Set([transactionId]));
      }
      setLoadingTxs(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, merchantName]);

  const toggleSelection = (txId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  };

  const selectAll = () => {
    const expenses = merchantTxs.filter((t) => t.kind === "expense");
    setSelectedIds(new Set(expenses.map((t) => t.id)));
  };

  const selectedTxs = useMemo(
    () => merchantTxs.filter((t) => selectedIds.has(t.id)),
    [merchantTxs, selectedIds]
  );

  const analysis = useMemo(
    () => analyzeSelectedTransactions(selectedTxs),
    [selectedTxs]
  );

  const handleNext = () => {
    if (selectedIds.size < 2) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Pre-fill step 2 fields from analysis
    if (analysis) {
      setFrequency(analysis.frequency);
      setAmountStr((analysis.amount / 100).toFixed(2));
    } else {
      // Fallback: use the most recent selected transaction
      const latest = selectedTxs[0];
      if (latest) setAmountStr((Math.abs(latest.amount) / 100).toFixed(2));
    }

    setStep(2);
  };

  const handleConfirm = () => {
    const amountInCents = Math.round(parseFloat(amountStr) * 100);
    if (!amountInCents || amountInCents <= 0) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    manualConfirmSubscription({
      merchantName: merchantName ?? "",
      displayName: displayName || merchantName || "",
      amount: amountInCents,
      frequency,
      categoryId: categoryId ?? "",
      nextBillingDate: analysis?.nextExpectedDate,
    });

    router.back();
    // Navigate to subscriptions after a short delay
    setTimeout(() => router.push("/subscriptions"), 100);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // ──────────────────────────── Step 1: Select Transactions ────────────────────────────
  if (step === 1) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View className="flex-row items-center mt-2 mb-5">
            <Pressable onPress={() => router.back()} className="mr-3 p-1">
              <Feather name="chevron-left" size={24} color="#1F2937" />
            </Pressable>
            <Text className="text-2xl font-bold text-dark-100 flex-1">
              Select Charges
            </Text>
          </View>

          {/* Merchant header */}
          <View className="flex-row items-center bg-gray-50 rounded-2xl px-4 py-3.5 mb-4">
            <View
              className="w-11 h-11 rounded-full items-center justify-center mr-3 overflow-hidden"
              style={{
                backgroundColor:
                  iconUrl && !iconFailed
                    ? "#F3F4F6"
                    : (category?.color ?? "#6C63FF") + "20",
              }}
            >
              {iconUrl && !iconFailed ? (
                <Image
                  source={{ uri: iconUrl }}
                  style={{ width: 28, height: 28, borderRadius: 14 }}
                  onError={() => setIconFailed(true)}
                />
              ) : (
                <Feather name="repeat" size={20} color={category?.color ?? "#6C63FF"} />
              )}
            </View>
            <View className="flex-1">
              <Text className="text-dark-100 font-semibold text-base">
                {merchantName}
              </Text>
              <Text className="text-gray-500 text-xs mt-0.5">
                Select the charges that are part of this subscription
              </Text>
            </View>
          </View>

          {loadingTxs ? (
            <View className="items-center py-12">
              <ActivityIndicator size="large" color="#FE8C00" />
              <Text className="text-gray-500 mt-3 text-sm">
                Loading transactions...
              </Text>
            </View>
          ) : (
            <>
              {/* Select all / count */}
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-gray-500 text-sm">
                  {selectedIds.size} of {merchantTxs.length} selected
                </Text>
                <Pressable onPress={selectAll}>
                  <Text className="text-primary font-semibold text-sm">
                    Select All
                  </Text>
                </Pressable>
              </View>

              {/* Transaction list */}
              {merchantTxs.map((tx) => {
                const isSelected = selectedIds.has(tx.id);
                return (
                  <Pressable
                    key={tx.id}
                    onPress={() => toggleSelection(tx.id)}
                    className="flex-row items-center py-3 border-b border-gray-100"
                  >
                    {/* Checkbox */}
                    <View
                      className="w-6 h-6 rounded-md mr-3 items-center justify-center border-2"
                      style={{
                        borderColor: isSelected ? "#FE8C00" : "#D1D5DB",
                        backgroundColor: isSelected ? "#FE8C00" : "transparent",
                      }}
                    >
                      {isSelected && (
                        <Feather name="check" size={14} color="white" />
                      )}
                    </View>

                    {/* Info */}
                    <View className="flex-1 mr-2">
                      <Text
                        className="text-dark-100 text-[14px]"
                        numberOfLines={1}
                      >
                        {tx.displayName || tx.title}
                      </Text>
                      <Text className="text-gray-400 text-xs mt-0.5">
                        {formatDate(tx.date)}
                        {tx.account ? ` · ${tx.account}` : ""}
                      </Text>
                    </View>

                    {/* Amount */}
                    <Text
                      className={`font-semibold text-[14px] ${
                        tx.kind === "income"
                          ? "text-green-600"
                          : "text-dark-100"
                      }`}
                    >
                      {tx.kind === "income" ? "+" : "-"}
                      {formatCurrency(Math.abs(tx.amount) / 100, currency)}
                    </Text>
                  </Pressable>
                );
              })}

              {merchantTxs.length === 0 && (
                <View className="items-center py-12">
                  <Text className="text-gray-500 text-sm">
                    No transactions found for this merchant.
                  </Text>
                </View>
              )}

              {/* Analysis preview */}
              {analysis && selectedIds.size >= 2 && (
                <View className="bg-blue-50 rounded-2xl px-4 py-3 mt-4 flex-row items-start">
                  <Feather
                    name="zap"
                    size={16}
                    color="#3B82F6"
                    style={{ marginTop: 2 }}
                  />
                  <Text className="text-blue-800 text-sm ml-2.5 flex-1">
                    Looks like{" "}
                    <Text className="font-semibold">
                      {getFrequencyLabel(analysis.frequency).toLowerCase()}
                    </Text>{" "}
                    at{" "}
                    <Text className="font-semibold">
                      {formatCurrency(analysis.amount / 100, currency)}
                    </Text>
                  </Text>
                </View>
              )}
            </>
          )}
        </ScrollView>

        {/* Bottom button */}
        {!loadingTxs && (
          <View className="absolute bottom-0 left-0 right-0 px-5 py-4 bg-white border-t border-gray-200">
            <Pressable
              onPress={handleNext}
              disabled={selectedIds.size < 2}
              className={`rounded-2xl py-4 items-center ${
                selectedIds.size >= 2
                  ? "bg-primary active:opacity-70"
                  : "bg-gray-200"
              }`}
            >
              <Text
                className={`font-bold text-sm ${
                  selectedIds.size >= 2 ? "text-white" : "text-gray-400"
                }`}
              >
                {selectedIds.size < 2
                  ? "Select at least 2 charges"
                  : `Next — Review Subscription`}
              </Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    );
  }

  // ──────────────────────────── Step 2: Review & Confirm ────────────────────────────
  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="flex-row items-center mt-2 mb-5">
          <Pressable
            onPress={() => setStep(1)}
            className="mr-3 p-1"
          >
            <Feather name="chevron-left" size={24} color="#1F2937" />
          </Pressable>
          <Text className="text-2xl font-bold text-dark-100 flex-1">
            Confirm Subscription
          </Text>
        </View>

        {/* Merchant icon + name */}
        <View className="items-center mb-6">
          <View
            className="w-16 h-16 rounded-full items-center justify-center mb-3 overflow-hidden"
            style={{
              backgroundColor:
                iconUrl && !iconFailed
                  ? "#F3F4F6"
                  : (category?.color ?? "#6C63FF") + "20",
            }}
          >
            {iconUrl && !iconFailed ? (
              <Image
                source={{ uri: iconUrl }}
                style={{ width: 40, height: 40, borderRadius: 20 }}
                onError={() => setIconFailed(true)}
              />
            ) : (
              <Feather
                name="repeat"
                size={28}
                color={category?.color ?? "#6C63FF"}
              />
            )}
          </View>
          <Text className="text-dark-100 font-bold text-lg">
            {merchantName}
          </Text>
          <Text className="text-gray-500 text-sm mt-1">
            Based on {selectedIds.size} selected charge
            {selectedIds.size !== 1 ? "s" : ""}
          </Text>
        </View>

        {/* Display Name */}
        <View className="mb-4">
          <Text className="text-gray-500 text-xs mb-1.5 ml-1">
            Display Name
          </Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            className="bg-gray-50 rounded-xl px-4 py-3 text-dark-100 text-base border border-gray-200"
            placeholder="Subscription name"
            placeholderTextColor="#9CA3AF"
          />
        </View>

        {/* Amount */}
        <View className="mb-4">
          <Text className="text-gray-500 text-xs mb-1.5 ml-1">
            Amount
          </Text>
          <View className="flex-row items-center bg-gray-50 rounded-xl border border-gray-200 px-4">
            <Text className="text-gray-500 text-lg mr-1">
              {currency === "EUR" ? "\u20AC" : currency === "GBP" ? "\u00A3" : "$"}
            </Text>
            <TextInput
              value={amountStr}
              onChangeText={setAmountStr}
              className="flex-1 py-3 text-dark-100 text-base"
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor="#9CA3AF"
            />
          </View>
        </View>

        {/* Frequency */}
        <View className="mb-4">
          <Text className="text-gray-500 text-xs mb-1.5 ml-1">
            Frequency
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {FREQUENCIES.map((f) => (
              <Pressable
                key={f}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setFrequency(f);
                }}
                className={`px-4 py-2.5 rounded-xl border ${
                  frequency === f
                    ? "bg-primary border-primary"
                    : "bg-gray-50 border-gray-200"
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    frequency === f ? "text-white" : "text-dark-100"
                  }`}
                >
                  {getFrequencyLabel(f)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Category */}
        {category && (
          <View className="mb-4">
            <Text className="text-gray-500 text-xs mb-1.5 ml-1">
              Category
            </Text>
            <View className="flex-row items-center bg-gray-50 rounded-xl border border-gray-200 px-4 py-3">
              <View
                className="w-3 h-3 rounded-full mr-2.5"
                style={{ backgroundColor: category.color ?? "#6C63FF" }}
              />
              <Text className="text-dark-100 text-base">{category.name}</Text>
            </View>
          </View>
        )}

        {/* Next billing date */}
        {analysis?.nextExpectedDate && (
          <View className="mb-4">
            <Text className="text-gray-500 text-xs mb-1.5 ml-1">
              Estimated Next Charge
            </Text>
            <View className="bg-gray-50 rounded-xl border border-gray-200 px-4 py-3">
              <Text className="text-dark-100 text-base">
                {formatDate(analysis.nextExpectedDate)}
              </Text>
            </View>
          </View>
        )}

        {/* Selected transactions summary */}
        <View className="mt-2 mb-4">
          <Text className="text-gray-500 text-xs mb-2 ml-1">
            Selected Charges
          </Text>
          <View className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
            {selectedTxs
              .sort(
                (a, b) =>
                  new Date(b.date).getTime() - new Date(a.date).getTime()
              )
              .slice(0, 5)
              .map((tx, i) => (
                <View
                  key={tx.id}
                  className={`flex-row items-center px-4 py-2.5 ${
                    i > 0 ? "border-t border-gray-100" : ""
                  }`}
                >
                  <Text className="text-gray-500 text-xs flex-1">
                    {formatDate(tx.date)}
                  </Text>
                  <Text className="text-dark-100 text-sm font-medium">
                    {formatCurrency(Math.abs(tx.amount) / 100, currency)}
                  </Text>
                </View>
              ))}
            {selectedTxs.length > 5 && (
              <View className="px-4 py-2 border-t border-gray-100">
                <Text className="text-gray-400 text-xs text-center">
                  +{selectedTxs.length - 5} more
                </Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Bottom buttons */}
      <View className="absolute bottom-0 left-0 right-0 px-5 py-4 bg-white border-t border-gray-200 gap-3">
        <Pressable
          onPress={handleConfirm}
          disabled={!amountStr || parseFloat(amountStr) <= 0}
          className={`rounded-2xl py-4 items-center ${
            amountStr && parseFloat(amountStr) > 0
              ? "bg-primary active:opacity-70"
              : "bg-gray-200"
          }`}
        >
          <Text
            className={`font-bold text-sm ${
              amountStr && parseFloat(amountStr) > 0
                ? "text-white"
                : "text-gray-400"
            }`}
          >
            Add Subscription
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
