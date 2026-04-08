import TransactionListItem from "@/components/TransactionListItem";
import { updateTransaction } from "@/lib/appwrite";
import { formatCurrency } from "@/lib/currencyFunctions";
import { getMerchantIconUrl, getSuggestedMerchantIcon } from "@/lib/merchantIcons";
import { getFrequencyLabel, type RecurringFrequency } from "@/lib/recurringPayments";
import { useHomeStore } from "@/store/useHomeStore";
import { useSubscriptionsStore } from "@/store/useSubscriptionsStore";
import { useTransactionDetailStore } from "@/store/useTransactionDetailStore";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SubscriptionDetailScreen() {
  const { subscriptionId } = useLocalSearchParams<{ subscriptionId: string }>();
  const { transactions, categories, summary } = useHomeStore();
  const { confirmedSubscriptions, updateConfirmed } = useSubscriptionsStore();
  const { setSelectedTransactionId } = useTransactionDetailStore();
  const currency = summary?.currency ?? "EUR";

  const [showAddModal, setShowAddModal] = useState(false);
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const sub = useMemo(
    () => confirmedSubscriptions.find((s) => s.id === subscriptionId),
    [confirmedSubscriptions, subscriptionId]
  );

  // Transactions linked to this subscription
  const linkedTransactions = useMemo(() => {
    if (!transactions || !subscriptionId) return [];
    return transactions
      .filter((t) => t.subscriptionId === subscriptionId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, subscriptionId]);

  // Unlinked transactions from same merchant (for the add modal)
  const unlinkedTransactions = useMemo(() => {
    if (!transactions || !sub) return [];
    const merchantLower = sub.merchantName.toLowerCase();
    return transactions
      .filter((t) => {
        if (t.subscriptionId) return false;
        const display = (t.displayName || t.title || "").toLowerCase();
        return display === merchantLower;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, sub]);

  // Stats
  const totalSpent = useMemo(
    () => linkedTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0),
    [linkedTransactions]
  );

  const isVariable = sub?.amountType === "variable";

  const averageAmount = useMemo(() => {
    if (!isVariable || linkedTransactions.length === 0) return 0;
    return totalSpent / linkedTransactions.length;
  }, [isVariable, linkedTransactions, totalSpent]);

  // Subscription icon
  const [tldIndex, setTldIndex] = useState(0);
  const [iconFailed, setIconFailed] = useState(false);
  const [crowdSourcedUrl, setCrowdSourcedUrl] = useState<string | null>(null);
  const [crowdSourcedFailed, setCrowdSourcedFailed] = useState(false);

  const merchantName = sub?.displayName || sub?.merchantName || "";
  const subscriptionName = sub?.name || merchantName;

  useEffect(() => {
    let mounted = true;
    setCrowdSourcedUrl(null);
    setCrowdSourcedFailed(false);
    setIconFailed(false);
    setTldIndex(0);

    if (merchantName) {
      getSuggestedMerchantIcon(merchantName, 128)
        .then((url) => mounted && setCrowdSourcedUrl(url))
        .catch(() => mounted && setCrowdSourcedUrl(null));
    }
    return () => { mounted = false; };
  }, [merchantName]);

  const effectiveCrowdSourced = crowdSourcedUrl && !crowdSourcedFailed ? crowdSourcedUrl : null;
  const builtInUrl = iconFailed ? null : getMerchantIconUrl(merchantName, 128, tldIndex);
  const iconUrl = effectiveCrowdSourced || (iconFailed ? null : builtInUrl);
  const isCrowdSourced = effectiveCrowdSourced && iconUrl === effectiveCrowdSourced;

  const handleIconError = () => {
    if (isCrowdSourced) { setCrowdSourcedFailed(true); return; }
    if (tldIndex < 2) { setTldIndex(tldIndex + 1); return; }
    setIconFailed(true);
  };

  const category = categories.find((c) => c.id === sub?.categoryId);

  const nextDate = sub?.nextBillingDate ? new Date(sub.nextBillingDate) : null;
  const now = new Date();
  const daysUntilNext = nextDate
    ? Math.ceil((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const nextLabel = !nextDate
    ? null
    : daysUntilNext != null && daysUntilNext <= 0
      ? "Due now"
      : daysUntilNext === 1
        ? "Tomorrow"
        : daysUntilNext != null && daysUntilNext <= 7
          ? `In ${daysUntilNext} days`
          : nextDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const handleTransactionPress = (id: string) => {
    setSelectedTransactionId(id);
    router.push("/transaction-detail");
  };

  const handleAddTransaction = async (txId: string) => {
    if (!subscriptionId) return;
    setAddingIds((prev) => new Set(prev).add(txId));
    try {
      await updateTransaction(txId, {
        isSubscription: true,
        subscriptionId,
      });
      // Optimistically update the local transactions array so the UI reflects the change immediately
      const currentTxs = useHomeStore.getState().transactions;
      useHomeStore.setState({
        transactions: currentTxs.map((t) =>
          t.id === txId ? { ...t, isSubscription: true, subscriptionId } : t
        ),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setAddingIds((prev) => {
        const next = new Set(prev);
        next.delete(txId);
        return next;
      });
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  if (!sub) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center">
        <Text className="text-gray-400">Subscription not found</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Back button */}
        <View className="px-5 pt-2 pb-4">
          <Pressable onPress={() => router.back()} className="flex-row items-center" hitSlop={8}>
            <Feather name="arrow-left" size={22} color="#181C2E" />
            <Text className="text-base text-dark-100 ml-2 font-quicksand-semibold">Back</Text>
          </Pressable>
        </View>

        {/* Subscription header */}
        <View className="items-center px-5 pb-5">
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
              style={{ backgroundColor: (category?.color ?? "#6C63FF") + "20" }}
            >
              <Feather name="repeat" size={32} color={category?.color ?? "#6C63FF"} />
            </View>
          )}
          {editingName ? (
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              onBlur={() => {
                const trimmed = nameDraft.trim();
                if (trimmed && trimmed !== subscriptionName) {
                  updateConfirmed(sub.id, { name: trimmed });
                }
                setEditingName(false);
              }}
              onSubmitEditing={() => {
                const trimmed = nameDraft.trim();
                if (trimmed && trimmed !== subscriptionName) {
                  updateConfirmed(sub.id, { name: trimmed });
                }
                setEditingName(false);
              }}
              autoFocus
              selectTextOnFocus
              className="text-2xl font-quicksand-bold text-dark-100 text-center border-b-2 border-primary px-2 pb-1"
              returnKeyType="done"
            />
          ) : (
            <Pressable
              onPress={() => {
                setNameDraft(subscriptionName);
                setEditingName(true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              className="flex-row items-center"
            >
              <Text className="text-2xl font-quicksand-bold text-dark-100 text-center">
                {subscriptionName}
              </Text>
              <Feather name="edit-2" size={14} color="#9CA3AF" style={{ marginLeft: 6 }} />
            </Pressable>
          )}
          <Text className="text-primary font-quicksand-bold text-lg mt-1">
            {isVariable
              ? linkedTransactions.length > 0
                ? `~${formatCurrency(averageAmount / 100, currency)}/${getFrequencyLabel(sub.frequency as RecurringFrequency).toLowerCase()}`
                : `Variable/${getFrequencyLabel(sub.frequency as RecurringFrequency).toLowerCase()}`
              : `${formatCurrency(sub.amount / 100, currency)}/${getFrequencyLabel(sub.frequency as RecurringFrequency).toLowerCase()}`}
          </Text>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              const newType = isVariable ? "fixed" : "variable";
              updateConfirmed(sub.id, { amountType: newType });
            }}
            className="flex-row items-center mt-2 px-3 py-1.5 rounded-full border border-gray-200 bg-gray-50 active:bg-gray-100"
          >
            <Feather name={isVariable ? "trending-up" : "lock"} size={12} color="#6B7280" />
            <Text className="text-gray-500 text-xs font-medium ml-1.5">
              {isVariable ? "Variable amount" : "Fixed amount"}
            </Text>
            <Feather name="chevron-right" size={12} color="#9CA3AF" style={{ marginLeft: 2 }} />
          </Pressable>
        </View>

        {/* Info cards */}
        <View className="flex-row mx-5 mb-3 rounded-2xl bg-gray-50 py-4">
          <View className="flex-1 items-center">
            <Text className="text-xs text-gray-100 mb-1">Next Payment</Text>
            <Text className="text-base font-quicksand-bold text-dark-100">
              {nextLabel ?? "—"}
            </Text>
          </View>
          <View style={{ width: 1, backgroundColor: "#E5E7EB" }} />
          <View className="flex-1 items-center">
            <Text className="text-xs text-gray-100 mb-1">Total Spent</Text>
            <Text className="text-base font-quicksand-bold text-dark-100">
              {formatCurrency(totalSpent / 100, currency)}
            </Text>
          </View>
          <View style={{ width: 1, backgroundColor: "#E5E7EB" }} />
          <View className="flex-1 items-center">
            <Text className="text-xs text-gray-100 mb-1">Payments</Text>
            <Text className="text-base font-quicksand-bold text-dark-100">
              {linkedTransactions.length}
            </Text>
          </View>
        </View>

        {/* Add transaction button */}
        <Pressable
          onPress={() => setShowAddModal(true)}
          className="flex-row items-center justify-center mx-5 mb-4 py-3 rounded-2xl bg-primary/10 active:bg-primary/20"
        >
          <Feather name="plus" size={16} color="#FE8C00" />
          <Text className="text-primary font-semibold text-sm ml-1.5">Add Transaction</Text>
        </Pressable>

        {/* Transaction list */}
        <View className="px-5 pt-2 pb-2">
          <Text className="text-sm font-quicksand-semibold text-gray-100 uppercase tracking-wider">
            Transactions
          </Text>
        </View>

        {linkedTransactions.length === 0 ? (
          <View className="items-center py-12 px-8">
            <Text className="text-base text-gray-100">No transactions linked yet</Text>
          </View>
        ) : (
          linkedTransactions.map((item) => {
            const cat = categories.find((c) => c.id === item.categoryId);
            return (
              <TransactionListItem
                key={item.id}
                transaction={item}
                currency={currency}
                categoryName={cat?.name}
                onPress={() => handleTransactionPress(item.id)}
              />
            );
          })
        )}
      </ScrollView>

      {/* Add Transaction Modal */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView className="flex-1 bg-white">
          {/* Modal header */}
          <View className="flex-row items-center px-5 pt-3 pb-3 border-b border-gray-100">
            <Text className="text-lg font-bold text-dark-100 flex-1">Add Transaction</Text>
            <Pressable onPress={() => setShowAddModal(false)} className="p-1">
              <Feather name="x" size={22} color="#6B7280" />
            </Pressable>
          </View>

          {unlinkedTransactions.length === 0 ? (
            <View className="flex-1 items-center justify-center px-8">
              <Feather name="check-circle" size={40} color="#D1D5DB" />
              <Text className="text-gray-400 mt-3 text-center">
                No unlinked transactions from {sub.merchantName}
              </Text>
            </View>
          ) : (
            <FlatList
              data={unlinkedTransactions}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingBottom: 40 }}
              renderItem={({ item }) => {
                const isAdding = addingIds.has(item.id);
                return (
                  <View className="flex-row items-center px-5 py-3 border-b border-gray-100">
                    <View className="flex-1 mr-3">
                      <Text className="text-dark-100 text-[14px]" numberOfLines={1}>
                        {item.displayName || item.title}
                      </Text>
                      <Text className="text-gray-400 text-xs mt-0.5">
                        {formatDate(item.date)}
                        {item.account ? ` · ${item.account}` : ""}
                      </Text>
                    </View>
                    <Text className="text-dark-100 font-semibold text-[14px] mr-3">
                      {item.kind === "income" ? "+" : "-"}
                      {formatCurrency(Math.abs(item.amount) / 100, currency)}
                    </Text>
                    <Pressable
                      onPress={() => handleAddTransaction(item.id)}
                      disabled={isAdding}
                      className="bg-primary rounded-xl px-3 py-1.5 active:opacity-70"
                      style={{ opacity: isAdding ? 0.5 : 1 }}
                    >
                      <Text className="text-white text-xs font-semibold">
                        {isAdding ? "Adding…" : "Add"}
                      </Text>
                    </Pressable>
                  </View>
                );
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
