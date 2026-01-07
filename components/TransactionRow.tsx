import { formatCurrency } from "@/lib/currencyFunctions";
import { getMerchantIconUrl } from "@/lib/merchantIcons";
import type { Transaction } from "@/types/type";
import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Image, Text, View } from "react-native";

export default function TransactionRow({
  transaction,
  currency,
  categoryName,
}: {
  transaction: Transaction;
  currency: string;
  categoryName?: string;
}) {
  const isIncome = transaction.kind === "income";
  const amountColor = transaction.excludeFromAnalytics
    ? "text-gray-500"
    : isIncome ? "text-green-600" : "text-red-500";
  const [tldIndex, setTldIndex] = useState(0);
  const [iconFailed, setIconFailed] = useState(false);
  const titleKey = (transaction.title || "").toLowerCase();
  const isRevolutTransfer =
    (transaction.source === "revolut_import") &&
    (titleKey.includes("to pocket") || titleKey.includes("transfer to") || titleKey.includes("transfer from"));
  const shouldHideMerchantIcon = transaction.hideMerchantIcon || false;
  const merchantIconUrl = (shouldHideMerchantIcon || iconFailed)
    ? null
    : (isRevolutTransfer ? `https://www.google.com/s2/favicons?domain=revolut.com&sz=64` : getMerchantIconUrl(transaction.title, 64, tldIndex));

  const getCategoryIcon = (categoryName?: string) => {
    const key = (categoryName || "").toLowerCase();

    if (key.includes("grocery") || key.includes("supermarket") || key.includes("food") || key.includes("restaurant") || key.includes("coffee")) {
      return "shopping-bag";
    }
    if (key.includes("transport") || key.includes("taxi") || key.includes("uber") || key.includes("bolt") || key.includes("bus") || key.includes("train") || key.includes("travel") || key.includes("flight") || key.includes("fuel") || key.includes("petrol") || key.includes("gas")) {
      return "truck";
    }
    if (key.includes("bill") || key.includes("utility") || key.includes("wifi") || key.includes("internet") || key.includes("phone")) {
      return "file-text";
    }
    if (key.includes("entertain") || key.includes("movie") || key.includes("film") || key.includes("music") || key.includes("tv")) {
      return "film";
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
  
  const handleImageError = () => {
    // Try next TLD (ie -> com -> co.uk)
    if (tldIndex < 2) {
      setTldIndex(tldIndex + 1);
      return;
    }
    // After all TLDs exhausted, fall back to category icon
    setIconFailed(true);
  };
  
  const hasMerchantIcon = merchantIconUrl !== null;
  const backgroundColor = hasMerchantIcon ? "#FFFFFF" : (isIncome ? "#2F9B6520" : "#F1414120");
  
  return (
    <View className="flex-row items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm border border-gray-100">
      <View className="flex-row items-center gap-3 flex-1">
        <View 
          className="h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor, borderWidth: hasMerchantIcon ? 1 : 0, borderColor: '#E5E7EB' }}
        >
          {hasMerchantIcon ? (
            <Image 
              source={{ uri: merchantIconUrl }}
              style={{ width: 32, height: 32, borderRadius: 16 }}
              resizeMode="contain"
              onError={handleImageError}
            />
          ) : (
            <Feather
              name={getCategoryIcon(categoryName) as any}
              size={20}
              color={isIncome ? "#2F9B65" : "#F14141"}
            />
          )}
        </View>
        <View className="flex-1">
          <Text className="text-base font-semibold text-dark-100" numberOfLines={1}>{transaction.displayName || transaction.title}</Text>
          <Text className="text-xs text-gray-700">{categoryName || "No category"}</Text>
        </View>
      </View>
      <View className="items-end ml-2">
        <Text
          className={`text-base font-semibold ${amountColor}`}
          style={{
            textDecorationLine: transaction.excludeFromAnalytics ? "line-through" : "none",
          }}
        >
          {formatCurrency(transaction.amount / 100, currency)}
        </Text>
        <Text className="text-xs text-gray-500">
          {new Date(transaction.date).toLocaleDateString()}
        </Text>
      </View>
    </View>
  );
}
