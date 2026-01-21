import { getMonthlyBudget, updateMonthlyBudget } from "@/lib/appwrite";
import { useHomeStore } from "@/store/useHomeStore";
import { useSessionStore } from "@/store/useSessionStore";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "EUR", symbol: "€" },
  { code: "GBP", symbol: "£" },
  { code: "CAD", symbol: "C$" },
  { code: "AUD", symbol: "A$" },
];

const CYCLE_TYPES = [
  { id: "first_working_day", label: "First working day", description: "Budget resets on the first weekday (Mon-Fri)" },
  { id: "last_working_day", label: "Last working day", description: "Budget resets on the last weekday (Mon-Fri)" },
  { id: "last_friday", label: "Last Friday", description: "Budget resets on the last Friday of the month" },
  { id: "specific_date", label: "Specific date", description: "Choose a specific day (1-31)" },
];

type CycleType = "first_working_day" | "last_working_day" | "specific_date" | "last_friday";

export default function SetBudgetScreen() {
  const { user } = useSessionStore();
  const { summary, fetchHome, transactions } = useHomeStore();
  const [budgetAmount, setBudgetAmount] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState(summary?.currency || "EUR");
  const [cycleType, setCycleType] = useState<CycleType>("first_working_day");
  const [cycleDay, setCycleDay] = useState("1");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastMonthBudgetLoading, setLastMonthBudgetLoading] = useState(false);
  const [budgetMode, setBudgetMode] = useState<"manual" | "lastMonth">("manual");

  // Load existing budget values on mount
  useEffect(() => {
    const loadExistingBudget = async () => {
      try {
        if (!user?.id) {
          setInitialLoading(false);
          return;
        }

        const budget = await getMonthlyBudget(user.id);

        if (budget) {
          // Convert from cents to dollars; show 0.00 when no amount
          const amountStr = (((budget.monthlyBudget ?? 0) / 100)).toFixed(2);
          setBudgetAmount(amountStr);
          setSelectedCurrency(budget.currency || "EUR");
          setCycleType((budget.cycleType as CycleType) || "first_working_day");
          if (budget.cycleDay !== undefined && budget.cycleDay !== null) {
            setCycleDay(String(budget.cycleDay));
          }
          setBudgetMode(budget.budgetSource === "lastMonth" ? "lastMonth" : "manual");
        }
      } catch (err) {
        console.error("Failed to load existing budget:", err);
      } finally {
        setInitialLoading(false);
      }
    };

    loadExistingBudget();
  }, [user?.id]);

  const getPrevMonthReference = () => {
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = String(prevMonth.getMonth() + 1).padStart(2, "0");
    return `${prevMonth.getFullYear()}-${month}`;
  };

  const handleSetBudget = async () => {
    if (!user?.id) {
      setError("User not logged in");
      return;
    }

    if (!budgetAmount || isNaN(Number(budgetAmount))) {
      setError("Please enter a valid budget amount");
      return;
    }

    if (cycleType === "specific_date") {
      const day = Number(cycleDay);
      if (isNaN(day) || day < 1 || day > 31) {
        setError("Please enter a valid day (1-31)");
        return;
      }
    }

    const budget = Math.round(Number(budgetAmount) * 100); // Convert to cents
    const day = cycleType === "specific_date" ? Number(cycleDay) : undefined;
    const budgetSource = budgetMode === "lastMonth" ? "lastMonth" : "manual";
    const lastMonthReference = budgetSource === "lastMonth" ? getPrevMonthReference() : undefined;

    setLoading(true);
    setError(null);

    try {
      await updateMonthlyBudget(
        user.id,
        budget,
        selectedCurrency,
        cycleType,
        day,
        budgetSource,
        lastMonthReference
      );
      await fetchHome(); // Refresh home data
      router.back();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to set budget";
      setError(errorMsg);
      console.error("Set budget error:", err);
    } finally {
      setLoading(false);
    }
  };

  // Compute last month's total spend (expenses only, exclude excluded)
  const applyLastMonthSpend = async () => {
    setLastMonthBudgetLoading(true);
    try {
      if (!transactions || transactions.length === 0) {
        setBudgetAmount("0.00");
        setBudgetMode("lastMonth");
        setError(null);
        return;
      }

      const now = new Date();
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const monthStart = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 1);
      const monthEnd = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0, 23, 59, 59, 999);

      const total = transactions
        .filter((t) => {
          const d = new Date(t.date);
          return (
            t.kind === "expense" &&
            !t.excludeFromAnalytics &&
            d >= monthStart &&
            d <= monthEnd
          );
        })
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      if (total <= 0) {
        setBudgetAmount("0.00");
        setBudgetMode("lastMonth");
        setError(null);
        return;
      }

      setBudgetAmount((total / 100).toFixed(2));
      setError(null);
      setBudgetMode("lastMonth");
    } finally {
      setLastMonthBudgetLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 160 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Show loading state while fetching existing budget */}
        {initialLoading && (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#667eea" />
          </View>
        )}

        {!initialLoading && (
          <>
        {/* Header */}
        <View className="bg-white -mx-5 px-5 pt-2 pb-6 mb-4">
          <View className="flex-row items-center justify-between">
            <Pressable
              onPress={() => router.back()}
              className="flex-row items-center gap-2"
            >
              <Feather name="chevron-left" size={20} color="#7C3AED" />
              <Text className="text-primary text-base font-semibold">Back</Text>
            </Pressable>
            <Text className="text-xs text-gray-500">Budget</Text>
          </View>
          <View className="mt-1 items-end">
            <Text className="text-2xl font-bold text-dark-100">Set Monthly Budget</Text>
          </View>
        </View>

        {/* Budget Input Section */}
        <View className="mb-8 rounded-2xl bg-gray-50 p-6">
          <Text className="text-xs font-semibold text-gray-500 mb-3">BUDGET AMOUNT</Text>

          {/* Choice: Manual entry */}
          <Pressable
            onPress={() => setBudgetMode("manual")}
            className={`mb-3 rounded-xl border-2 p-4 ${
              budgetMode === "manual" ? "border-primary bg-primary/5" : "border-gray-200 bg-white"
            }`}
            hitSlop={12}
          >
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-base font-semibold text-dark-100">Type an amount</Text>
              <View
                className={`w-5 h-5 rounded-full border-2 ${
                  budgetMode === "manual" ? "border-primary bg-primary" : "border-gray-300 bg-white"
                }`}
              />
            </View>
            <View className="flex-row items-center gap-2">
              <Text className="text-2xl font-bold text-dark-100">
                {CURRENCIES.find((c) => c.code === selectedCurrency)?.symbol}
              </Text>
              <TextInput
                value={budgetAmount}
                onChangeText={(val) => {
                  setBudgetMode("manual");
                  setBudgetAmount(val);
                }}
                placeholder="0.00"
                placeholderTextColor="#999"
                keyboardType="decimal-pad"
                editable={budgetMode === "manual"}
                selectTextOnFocus={budgetMode === "manual"}
                className={`flex-1 border-b-2 border-primary px-2 py-2 text-2xl font-bold text-dark-100 ${
                  budgetMode === "manual" ? "" : "opacity-50"
                }`}
                style={{ paddingVertical: 8 }}
              />
            </View>
            <Text className="text-xs text-gray-400 mt-2">
              Enter your monthly budget limit in {selectedCurrency}
            </Text>
          </Pressable>

          {/* Choice: Last month spend */}
          <Pressable
            onPress={applyLastMonthSpend}
            disabled={lastMonthBudgetLoading}
            className={`rounded-xl border-2 p-4 ${
              budgetMode === "lastMonth" ? "border-primary bg-primary/5" : "border-gray-200 bg-white"
            }`}
            hitSlop={16}
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-base font-semibold text-primary">Spend less than last month</Text>
                <Text className="text-xs text-gray-500 mt-1">Use last month's total expenses as the budget</Text>
              </View>
              {lastMonthBudgetLoading ? (
                <ActivityIndicator size="small" color="#7C3AED" />
              ) : (
                <View
                  className={`w-5 h-5 rounded-full border-2 ${
                    budgetMode === "lastMonth" ? "border-primary bg-primary" : "border-gray-300 bg-white"
                  }`}
                />
              )}
            </View>
          </Pressable>
        </View>

        {/* Currency Selection */}
        <View className="mb-8">
          <Text className="text-xs font-semibold text-gray-500 mb-3">CURRENCY</Text>
          <View className="flex-row flex-wrap gap-2">
            {CURRENCIES.map((curr) => (
              <Pressable
                key={curr.code}
                onPress={() => setSelectedCurrency(curr.code)}
                className={`rounded-lg px-4 py-2 border-2 ${
                  selectedCurrency === curr.code
                    ? "border-primary bg-primary/10"
                    : "border-gray-200 bg-white"
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    selectedCurrency === curr.code ? "text-primary" : "text-gray-700"
                  }`}
                >
                  {curr.code}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Budget Cycle Selection */}
        <View className="mb-8">
          <Text className="text-xs font-semibold text-gray-500 mb-3">BUDGET CYCLE</Text>
          <Text className="text-xs text-gray-600 mb-3">When does your budget period start/end?</Text>
          <View className="gap-2">
            {CYCLE_TYPES.map((cycle) => (
              <Pressable
                key={cycle.id}
                onPress={() => setCycleType(cycle.id as CycleType)}
                className={`rounded-xl border-2 p-3 ${
                  cycleType === cycle.id
                    ? "border-primary bg-primary/10"
                    : "border-gray-200 bg-white"
                }`}
              >
                <Text
                  className={`text-base font-semibold ${
                    cycleType === cycle.id ? "text-primary" : "text-gray-800"
                  }`}
                >
                  {cycle.label}
                </Text>
                <Text className="text-xs text-gray-500 mt-1">{cycle.description}</Text>
              </Pressable>
            ))}
          </View>

          {/* Specific Date Input */}
          {cycleType === "specific_date" && (
            <View className="mt-4 rounded-lg bg-blue-50 border border-blue-200 p-4">
              <Text className="text-xs font-semibold text-blue-900 mb-2">Cycle Day</Text>
              <View className="flex-row items-center gap-2">
                <Text className="text-sm text-blue-900">Day of month:</Text>
                <TextInput
                  value={cycleDay}
                  onChangeText={(text) => setCycleDay(text.replace(/[^0-9]/g, ""))}
                  placeholder="1"
                  placeholderTextColor="#999"
                  keyboardType="number-pad"
                  maxLength={2}
                  className="flex-1 border border-blue-300 rounded-lg px-3 py-2 text-center text-sm"
                  style={{ paddingVertical: 8 }}
                />
                <Text className="text-sm text-blue-900">(1-31)</Text>
              </View>
            </View>
          )}
        </View>

        {/* Example Info */}
        <View className="mb-8 rounded-xl bg-blue-50 p-4 border border-blue-200">
          <Text className="text-xs font-semibold text-blue-900 mb-2">💡 Tip</Text>
          <Text className="text-xs text-blue-800">
            Your monthly budget helps you track spending and see how much you have remaining for
            the month. You can always adjust it later.
          </Text>
        </View>

        {/* Error Message */}
        {error && (
          <View className="mb-6 rounded-lg bg-red-50 p-3 border border-red-200">
            <Text className="text-sm font-semibold text-red-700">{error}</Text>
          </View>
        )}

          </>
        )}
      </ScrollView>
      {/* Fixed Bottom Button */}
      <View
        className="absolute bottom-0 left-0 right-0 px-5 pb-6"
        style={{
          background: "linear-gradient(to top, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 100%)",
        }}
      >
        <Pressable
          onPress={handleSetBudget}
          disabled={loading || !budgetAmount}
          className={`rounded-2xl py-4 items-center shadow-lg ${
            loading || !budgetAmount ? "bg-gray-300" : "bg-primary"
          }`}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white text-base font-bold">Set Budget</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
