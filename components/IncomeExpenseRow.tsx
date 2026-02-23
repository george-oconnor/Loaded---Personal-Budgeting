import { formatCurrency } from "@/lib/currencyFunctions";
import type { Summary, Transaction } from "@/types/type";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Sparkline from "./Sparkline";

/** Build daily totals from transactions for sparkline display */
function buildDailySparkData(transactions: Transaction[], kind: "income" | "expense"): number[] {
  const filtered = transactions.filter((t) => t.kind === kind && !t.excludeFromAnalytics && !t.matchedTransferId && !t.isAnalyticsProtected);
  if (filtered.length === 0) return [];

  // Build a map of date -> daily total
  const dailyMap = new Map<string, number>();
  let minDate = filtered[0].date.slice(0, 10);
  let maxDate = filtered[0].date.slice(0, 10);

  for (const t of filtered) {
    const key = t.date.slice(0, 10);
    dailyMap.set(key, (dailyMap.get(key) ?? 0) + Math.abs(t.amount));
    if (key < minDate) minDate = key;
    if (key > maxDate) maxDate = key;
  }

  // Fill every day in range
  const data: number[] = [];
  const cursor = new Date(minDate + "T00:00:00");
  const end = new Date(maxDate + "T00:00:00");
  while (cursor <= end) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    data.push(dailyMap.get(key) ?? 0);
    cursor.setDate(cursor.getDate() + 1);
  }
  return data;
}

export default function IncomeExpenseRow({
  summary,
  loading,
  transactions = [],
}: {
  summary: Summary | null;
  loading: boolean;
  transactions?: Transaction[];
}) {
  const currency = summary?.currency ?? "USD";
  const [incomePressed, setIncomePressed] = useState(false);
  const [expensePressed, setExpensePressed] = useState(false);

  const incomeSparkData = useMemo(() => buildDailySparkData(transactions, "income"), [transactions]);
  const expenseSparkData = useMemo(() => buildDailySparkData(transactions, "expense"), [transactions]);

  return (
    <View className="flex-row gap-4 mt-4">
      <Pressable
        onPress={() => router.push("/category-transactions?type=income")}
        onPressIn={() => setIncomePressed(true)}
        onPressOut={() => setIncomePressed(false)}
        className="flex-1"
      >
        <View className={`rounded-3xl px-5 py-5 shadow-sm ${incomePressed ? "bg-white border-gray-200" : "bg-green-50 border-green-100"} border overflow-hidden`}>
          <View className="flex-row items-center gap-2">
            <MaterialCommunityIcons name="arrow-top-right" size={18} color="#2F9B65" />
            <Text className="text-dark-100 text-base font-bold">Income</Text>
          </View>
          <View className="flex-row items-end justify-between">
            <Text className="text-dark-100 text-2xl font-bold mt-2 flex-shrink">
              {loading ? "…" : formatCurrency((summary?.income ?? 0) / 100, currency)}
            </Text>
            {incomeSparkData.length >= 2 && (
              <View className="opacity-50 ml-1">
                <Sparkline
                  data={incomeSparkData}
                  width={56}
                  height={32}
                  strokeColor="#2F9B65"
                  fillColorStart="rgba(47,155,101,0.2)"
                  fillColorEnd="rgba(47,155,101,0)"
                  strokeWidth={1.5}
                />
              </View>
            )}
          </View>
        </View>
      </Pressable>
      <Pressable
        onPress={() => router.push("/category-transactions?type=expense")}
        onPressIn={() => setExpensePressed(true)}
        onPressOut={() => setExpensePressed(false)}
        className="flex-1"
      >
        <View className={`rounded-3xl px-5 py-5 shadow-sm ${expensePressed ? "bg-white border-gray-200" : "bg-red-50 border-red-100"} border overflow-hidden`}>
          <View className="flex-row items-center gap-2">
            <MaterialCommunityIcons name="arrow-bottom-right" size={18} color="#F14141" />
            <Text className="text-dark-100 text-base font-bold">Expenses</Text>
          </View>
          <View className="flex-row items-end justify-between">
            <Text className="text-dark-100 text-2xl font-bold mt-2 flex-shrink">
              {loading ? "…" : formatCurrency((summary?.expenses ?? 0) / 100, currency)}
            </Text>
            {expenseSparkData.length >= 2 && (
              <View className="opacity-50 ml-1">
                <Sparkline
                  data={expenseSparkData}
                  width={56}
                  height={32}
                  strokeColor="#F14141"
                  fillColorStart="rgba(241,65,65,0.2)"
                  fillColorEnd="rgba(241,65,65,0)"
                  strokeWidth={1.5}
                />
              </View>
            )}
          </View>
        </View>
      </Pressable>
    </View>
  );
}
