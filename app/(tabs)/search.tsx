import TransactionListItem from "@/components/TransactionListItem";
import { formatCurrency } from "@/lib/currencyFunctions";
import { getMerchantIconUrl, getSuggestedMerchantIcon } from "@/lib/merchantIcons";
import { getFrequencyLabel, type RecurringFrequency } from "@/lib/recurringPayments";
import { useHomeStore } from "@/store/useHomeStore";
import { useSubscriptionsStore, type ConfirmedSubscription } from "@/store/useSubscriptionsStore";
import { useTransactionDetailStore } from "@/store/useTransactionDetailStore";
import type { Transaction } from "@/types/type";
import { Feather } from "@expo/vector-icons";
import { router, useNavigation } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Keyboard,
  Pressable,
  SectionList,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/** Merchant icon with the same resolution chain as TransactionRow */
const MerchantIcon = memo(function MerchantIcon({ name }: { name: string }) {
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
      getSuggestedMerchantIcon(name, 64)
        .then((url) => mounted && setCrowdSourcedUrl(url))
        .catch(() => mounted && setCrowdSourcedUrl(null));
    }
    return () => { mounted = false; };
  }, [name]);

  const effectiveCrowdSourced = crowdSourcedUrl && !crowdSourcedFailed ? crowdSourcedUrl : null;
  const builtInUrl = iconFailed ? null : getMerchantIconUrl(name, 64, tldIndex);
  const iconUrl = effectiveCrowdSourced || (iconFailed ? null : builtInUrl);
  const isCrowdSourced = effectiveCrowdSourced && iconUrl === effectiveCrowdSourced;

  const handleError = () => {
    if (isCrowdSourced) { setCrowdSourcedFailed(true); return; }
    if (tldIndex < 2) { setTldIndex(tldIndex + 1); return; }
    setIconFailed(true);
  };

  if (iconUrl) {
    return (
      <View
        className="w-10 h-10 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB" }}
      >
        <Image
          source={{ uri: iconUrl }}
          style={{ width: 32, height: 32, borderRadius: 16 }}
          resizeMode="contain"
          onError={handleError}
        />
      </View>
    );
  }

  return (
    <View
      className="w-10 h-10 rounded-full items-center justify-center mr-3"
      style={{ backgroundColor: "#FE8C0020" }}
    >
      <Feather name="shopping-bag" size={18} color="#FE8C00" />
    </View>
  );
});

type MerchantResult = {
  type: "merchant";
  name: string;
  transactionCount: number;
  totalSpent: number;
  transactions: Transaction[];
};

type AccountResult = {
  type: "account";
  name: string;
  transactionCount: number;
};

type SubscriptionResult = {
  type: "subscription";
  subscription: ConfirmedSubscription;
};

type TransactionResult = {
  type: "transaction";
  transaction: Transaction;
};

type SearchItem = MerchantResult | AccountResult | SubscriptionResult | TransactionResult;

type SearchSection = {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  data: SearchItem[];
};

export default function Search() {
  const { transactions, categories, summary } = useHomeStore();
  const { confirmedSubscriptions } = useSubscriptionsStore();
  const { setSelectedTransactionId } = useTransactionDetailStore();
  const [query, setQuery] = useState("");
  const inputRef = useRef<TextInput>(null);
  const currency = summary?.currency ?? "EUR";
  const navigation = useNavigation();

  // Clear search bar when tapping the search tab while already on it
  useEffect(() => {
    const unsubscribe = (navigation as any).addListener("tabPress", () => {
      if (query) {
        setQuery("");
        inputRef.current?.focus();
      }
    });
    return unsubscribe;
  }, [navigation, query]);

  const sections = useMemo((): SearchSection[] => {
    if (!query.trim() || !transactions) return [];
    const q = query.toLowerCase();

    // --- Merchants ---
    // Group transactions by displayName (preferred) so cleaned merchant names are deduped.
    // Transactions without displayName fall back to title.
    const merchantMap = new Map<string, { displayName: string; transactions: Transaction[] }>();
    for (const t of transactions) {
      const display = t.displayName || t.title || "Unknown";
      const key = display.toLowerCase();
      if (!merchantMap.has(key)) {
        merchantMap.set(key, { displayName: display, transactions: [] });
      }
      merchantMap.get(key)!.transactions.push(t);
    }
    const merchantResults: MerchantResult[] = [];
    for (const [key, { displayName, transactions: txns }] of merchantMap) {
      if (key.includes(q)) {
        const analyticsTxns = txns.filter((t) => !t.excludeFromAnalytics);
        const totalSpent = analyticsTxns.reduce((sum, t) => sum + t.amount, 0);
        merchantResults.push({
          type: "merchant",
          name: displayName,
          transactionCount: txns.length,
          totalSpent,
          transactions: txns,
        });
      }
    }
    merchantResults.sort((a, b) => b.transactionCount - a.transactionCount);

    // --- Accounts ---
    const accountMap = new Map<string, number>();
    for (const t of transactions) {
      if (t.account) {
        const key = t.account.toLowerCase();
        accountMap.set(key, (accountMap.get(key) ?? 0) + 1);
      }
    }
    const accountResults: AccountResult[] = [];
    for (const [key, count] of accountMap) {
      if (key.includes(q)) {
        // Get the original-cased name from the first match
        const original = transactions.find((t) => t.account?.toLowerCase() === key)?.account ?? key;
        accountResults.push({ type: "account", name: original, transactionCount: count });
      }
    }
    accountResults.sort((a, b) => b.transactionCount - a.transactionCount);

    // --- Transactions ---
    const transactionResults: TransactionResult[] = transactions
      .filter((t) => {
        const title = (t.displayName ?? t.title ?? "").toLowerCase();
        const subtitle = (t.subtitle ?? "").toLowerCase();
        const cat = categories.find((c) => c.id === t.categoryId);
        const catName = (cat?.name ?? "").toLowerCase();
        return title.includes(q) || subtitle.includes(q) || catName.includes(q);
      })
      .map((t) => ({ type: "transaction" as const, transaction: t }));

    // --- Subscriptions ---
    const subscriptionResults: SubscriptionResult[] = confirmedSubscriptions
      .filter((s) => {
        const name = (s.name || s.displayName || s.merchantName || "").toLowerCase();
        const merchant = (s.merchantName || "").toLowerCase();
        return name.includes(q) || merchant.includes(q);
      })
      .map((s) => ({ type: "subscription" as const, subscription: s }));

    const result: SearchSection[] = [];
    if (subscriptionResults.length > 0) {
      result.push({ title: "Subscriptions", icon: "repeat", data: subscriptionResults });
    }
    if (merchantResults.length > 0) {
      result.push({ title: "Merchants", icon: "shopping-bag", data: merchantResults });
    }
    if (accountResults.length > 0) {
      result.push({ title: "Accounts", icon: "credit-card", data: accountResults });
    }
    if (transactionResults.length > 0) {
      result.push({ title: "Transactions", icon: "list", data: transactionResults });
    }
    return result;
  }, [query, transactions, categories, confirmedSubscriptions]);

  const totalResults = useMemo(
    () => sections.reduce((sum, s) => sum + s.data.length, 0),
    [sections]
  );

  const handleTransactionPress = useCallback(
    (transactionId: string) => {
      Keyboard.dismiss();
      setSelectedTransactionId(transactionId);
      router.push("/transaction-detail");
    },
    [setSelectedTransactionId]
  );

  const handleMerchantPress = useCallback(
    (merchant: MerchantResult) => {
      Keyboard.dismiss();
      router.push({ pathname: "/merchant-detail", params: { name: merchant.name } });
    },
    []
  );

  const handleAccountPress = useCallback(
    (_account: AccountResult) => {
      Keyboard.dismiss();
      router.push("/balances");
    },
    []
  );

  const handleSubscriptionPress = useCallback(
    (sub: SubscriptionResult) => {
      Keyboard.dismiss();
      router.push({ pathname: "/subscription-detail", params: { subscriptionId: sub.subscription.id } });
    },
    []
  );

  const renderItem = useCallback(
    ({ item }: { item: SearchItem }) => {
      if (item.type === "merchant") {
        return (
          <Pressable
            onPress={() => handleMerchantPress(item)}
            className="flex-row items-center px-5 py-3 bg-white active:opacity-70"
          >
            <MerchantIcon name={item.name} />
            <View className="flex-1">
              <Text className="font-semibold text-dark-100 text-base" numberOfLines={1}>
                {item.name}
              </Text>
              <Text className="text-xs text-gray-500 mt-0.5">
                {item.transactionCount} transaction{item.transactionCount !== 1 ? "s" : ""}
              </Text>
            </View>
            <Text className="text-sm font-semibold text-dark-100">
              {formatCurrency(Math.abs(item.totalSpent) / 100, currency)}
            </Text>
          </Pressable>
        );
      }

      if (item.type === "subscription") {
        const s = item.subscription;
        const freq = s.frequency as RecurringFrequency;
        const statusColor = s.status === "active" ? "#22C55E" : s.status === "paused" ? "#F59E0B" : "#EF4444";
        return (
          <Pressable
            onPress={() => handleSubscriptionPress(item)}
            className="flex-row items-center px-5 py-3 bg-white active:opacity-70"
          >
            <MerchantIcon name={s.displayName || s.merchantName} />
            <View className="flex-1">
              <Text className="font-semibold text-dark-100 text-base" numberOfLines={1}>
                {s.name || s.displayName || s.merchantName}
              </Text>
              <View className="flex-row items-center mt-0.5">
                <View className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ backgroundColor: statusColor }} />
                <Text className="text-xs text-gray-500">
                  {getFrequencyLabel(freq)} · {formatCurrency(s.amount / 100, currency)}
                </Text>
              </View>
            </View>
            <Feather name="chevron-right" size={16} color="#9CA3AF" />
          </Pressable>
        );
      }

      if (item.type === "account") {
        return (
          <Pressable
            onPress={() => handleAccountPress(item)}
            className="flex-row items-center px-5 py-3 bg-white active:opacity-70"
          >
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: "#6366F120" }}
            >
              <Feather name="credit-card" size={18} color="#6366F1" />
            </View>
            <View className="flex-1">
              <Text className="font-semibold text-dark-100 text-base" numberOfLines={1}>
                {item.name}
              </Text>
              <Text className="text-xs text-gray-500 mt-0.5">
                {item.transactionCount} transaction{item.transactionCount !== 1 ? "s" : ""}
              </Text>
            </View>
            <Feather name="chevron-right" size={16} color="#9CA3AF" />
          </Pressable>
        );
      }

      // Transaction
      const t = item.transaction;
      const category = categories.find((c) => c.id === t.categoryId);
      return (
        <TransactionListItem
          transaction={t}
          currency={currency}
          categoryName={category?.name}
          onPress={() => handleTransactionPress(t.id)}
        />
      );
    },
    [categories, currency, handleTransactionPress, handleMerchantPress, handleAccountPress, handleSubscriptionPress]
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: SearchSection }) => (
      <View className="flex-row items-center px-5 pt-4 pb-2 bg-white">
        <Feather name={section.icon} size={14} color="#9CA3AF" />
        <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wider ml-1.5">
          {section.title}
        </Text>
        <Text className="text-xs text-gray-400 ml-1">({section.data.length})</Text>
      </View>
    ),
    []
  );

  return (
    <SafeAreaView className="flex-1 bg-white">
      {/* Search bar */}
      <View className="px-5 pt-4 pb-2">
        <View className="flex-row items-center bg-gray-50 rounded-2xl px-4 h-12">
          <Feather name="search" size={20} color="#9CA3AF" />
          <TextInput
            ref={inputRef}
            className="flex-1 ml-3 text-base text-dark-100 font-quicksand"
            placeholder="Search transactions..."
            placeholderTextColor="#9CA3AF"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <Feather name="x" size={18} color="#9CA3AF" />
            </Pressable>
          )}
        </View>
        {totalResults > 0 && (
          <Text className="text-xs text-gray-100 mt-2 ml-1">
            {totalResults} result{totalResults !== 1 ? "s" : ""}
          </Text>
        )}
      </View>

      {/* Results */}
      {query.trim().length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Feather name="search" size={48} color="#D1D5DB" />
          <Text className="text-lg font-quicksand-semibold text-gray-100 mt-4 text-center">
            Search your finances
          </Text>
          <Text className="text-sm text-gray-100 mt-1 text-center">
            Search by merchant, subscription, account, or category
          </Text>
        </View>
      ) : totalResults === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Feather name="alert-circle" size={48} color="#D1D5DB" />
          <Text className="text-lg font-quicksand-semibold text-gray-100 mt-4">
            No results found
          </Text>
          <Text className="text-sm text-gray-100 mt-1 text-center">
            Try a different search term
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item, index) => {
            if (item.type === "merchant") return `m-${item.name}`;
            if (item.type === "subscription") return `s-${item.subscription.id}`;
            if (item.type === "account") return `a-${item.name}`;
            return `t-${item.transaction.id}-${index}`;
          }}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={{ paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          stickySectionHeadersEnabled={false}
        />
      )}
    </SafeAreaView>
  );
}
