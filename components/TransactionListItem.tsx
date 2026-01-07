import { formatCurrency } from "@/lib/currencyFunctions";
import { getMerchantIconUrl } from "@/lib/merchantIcons";
import type { Transaction } from "@/types/type";
import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";

export default function TransactionListItem({
  transaction,
  categoryName,
  currency,
  onPress,
}: {
  transaction: Transaction;
  categoryName?: string;
  currency: string;
  onPress: () => void;
}) {
  const isIncome = transaction.kind === "income";
  const [tldIndex, setTldIndex] = useState(0);
  const [iconFailed, setIconFailed] = useState(false);
  const shouldHideMerchantIcon = transaction.hideMerchantIcon || false;
  const rawMerchantIconUrl = (shouldHideMerchantIcon || iconFailed) ? null : getMerchantIconUrl(transaction.displayName || transaction.title, 64, tldIndex);
  // Revolut-specific fallback: for transfers "To pocket" or "Transfer to" from Revolut imports
  const titleKey = (transaction.title || "").toLowerCase();
  const isRevolutTransfer =
    (transaction.source === "revolut_import") &&
    (titleKey.includes("to pocket") || titleKey.includes("transfer to") || titleKey.includes("transfer from"));
  const merchantIconUrl = rawMerchantIconUrl ?? (isRevolutTransfer && !shouldHideMerchantIcon ? `https://www.google.com/s2/favicons?domain=revolut.com&sz=64` : null);

  const hasMerchantIcon = merchantIconUrl !== null;
  const getTransactionColor = (kind: "income" | "expense") => (kind === "income" ? "#10B981" : "#EF4444");

  const iconBackgroundColor = hasMerchantIcon ? "#FFFFFF" : `${getTransactionColor(transaction.kind)}20`;

  const handleImageError = () => {
    if (tldIndex < 2) {
      setTldIndex(tldIndex + 1);
      return;
    }
    setIconFailed(true);
  };

  const formatDateHeader = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

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

  const getTransactionIcon = (name: string | undefined, kind: "income" | "expense") => {
    const key = (name || "").toLowerCase();
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

  return (
    <Pressable
      onPress={onPress}
      className="active:opacity-70"
    >
      <View className="px-5 py-4 border-b border-gray-100 flex-row items-center justify-between bg-white">
        <View className="flex-row items-center flex-1">
          <View
            className="w-10 h-10 rounded-full items-center justify-center mr-3"
            style={{ backgroundColor: iconBackgroundColor, borderWidth: hasMerchantIcon ? 1 : 0, borderColor: "#E5E7EB" }}
          >
            {hasMerchantIcon ? (
              <Image
                source={{ uri: merchantIconUrl! }}
                style={{ width: 32, height: 32, borderRadius: 16 }}
                resizeMode="contain"
                onError={handleImageError}
              />
            ) : (
              <Feather
                name={getTransactionIcon(categoryName, transaction.kind) as any}
                size={18}
                color={getTransactionColor(transaction.kind)}
              />
            )}
          </View>
          <View className="flex-1">
            <Text className="font-semibold text-dark-100 text-base">
              {transaction.displayName || transaction.title}
            </Text>
            <Text className="text-xs text-gray-500 mt-1">
              {categoryName || "Uncategorized"}
            </Text>
            <Text className="text-xs text-gray-400 mt-1">
              {formatDateHeader(transaction.date)}
              {transaction.source !== "aib_import" && ` • ${formatTime(transaction.date)}`}
            </Text>
          </View>
        </View>
        <Text
          className="font-bold text-base"
          style={{
            color: transaction.excludeFromAnalytics ? "#6B7280" : getTransactionColor(transaction.kind),
            textDecorationLine: transaction.excludeFromAnalytics ? "line-through" : "none",
          }}
        >
          {transaction.kind === "income" ? "+" : "-"}
          {formatCurrency(transaction.amount / 100, currency)}
        </Text>
      </View>
    </Pressable>
  );
}
