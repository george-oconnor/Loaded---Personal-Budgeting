import { formatCurrency } from "@/lib/currencyFunctions";
import type { Summary } from "@/types/type";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

export default function IncomeExpenseRow({
  summary,
  loading,
}: {
  summary: Summary | null;
  loading: boolean;
}) {
  const currency = summary?.currency ?? "USD";
  const [incomePressed, setIncomePressed] = useState(false);
  const [expensePressed, setExpensePressed] = useState(false);

  return (
    <View className="flex-row gap-4 mt-4">
      <Pressable
        onPress={() => router.push("/category-transactions?type=income")}
        onPressIn={() => setIncomePressed(true)}
        onPressOut={() => setIncomePressed(false)}
        className="flex-1"
      >
        <View className={`rounded-3xl px-5 py-5 shadow-sm ${incomePressed ? "bg-white border-gray-200" : "bg-green-50 border-green-100"} border`}>
          <View className="flex-row items-center gap-2">
            <MaterialCommunityIcons name="arrow-top-right" size={18} color="#2F9B65" />
            <Text className="text-dark-100 text-base font-bold">Income</Text>
          </View>
          <Text className="text-dark-100 text-2xl font-bold mt-2">
            {loading ? "…" : formatCurrency((summary?.income ?? 0) / 100, currency)}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={() => router.push("/category-transactions?type=expense")}
        onPressIn={() => setExpensePressed(true)}
        onPressOut={() => setExpensePressed(false)}
        className="flex-1"
      >
        <View className={`rounded-3xl px-5 py-5 shadow-sm ${expensePressed ? "bg-white border-gray-200" : "bg-red-50 border-red-100"} border`}>
          <View className="flex-row items-center gap-2">
            <MaterialCommunityIcons name="arrow-bottom-right" size={18} color="#F14141" />
            <Text className="text-dark-100 text-base font-bold">Expenses</Text>
          </View>
          <Text className="text-dark-100 text-2xl font-bold mt-2">
            {loading ? "…" : formatCurrency((summary?.expenses ?? 0) / 100, currency)}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}
