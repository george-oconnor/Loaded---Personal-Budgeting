import { getCategories } from "@/lib/appwrite";
import { queueTransactionsForSync } from "@/lib/syncQueue";
import { useSessionStore } from "@/store/useSessionStore";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Category = {
  $id: string;
  name: string;
  color?: string;
  icon?: string;
};

export default function AddTransactionScreen() {
  const { user } = useSessionStore();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [time, setTime] = useState(new Date().toTimeString().slice(0, 5));
  const [loading, setLoading] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(true);

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      const cats = await getCategories();
      setCategories(cats as any);
      if (cats.length > 0) {
        // Try to find "General" category, otherwise use first category
        const generalCategory = cats.find(
          (cat) => cat.name.toLowerCase() === "general"
        );
        setSelectedCategoryId(generalCategory?.$id || cats[0].$id);
      }
    } catch (err) {
      console.error("Failed to load categories:", err);
      Alert.alert("Error", "Failed to load categories");
    } finally {
      setLoadingCategories(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert("Error", "Please enter a description");
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      Alert.alert("Error", "Please enter a valid amount");
      return;
    }

    if (!selectedCategoryId) {
      Alert.alert("Error", "Please select a category");
      return;
    }

    if (!user?.id) {
      Alert.alert("Error", "You must be logged in");
      return;
    }

    setLoading(true);
    try {
      const amountInCents = Math.round(amountNum * 100);
      const dateISO = new Date(`${date}T${time}:00Z`).toISOString();

      await queueTransactionsForSync(user.id, [
        {
          title: title.trim(),
          subtitle: "Manual Entry",
          amount: amountInCents,
          kind,
          categoryId: selectedCategoryId,
          date: dateISO,
          currency: "EUR",
          source: "manual",
          displayName: title.trim(),
        },
      ]);

      Alert.alert("Success", "Transaction added successfully", [
        {
          text: "OK",
          onPress: () => router.back(),
        },
      ]);
    } catch (err) {
      console.error("Failed to add transaction:", err);
      Alert.alert("Error", "Failed to add transaction. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 40,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View className="mb-8">
            <Pressable
              onPress={() => router.back()}
              className="mb-6 flex-row items-center gap-2"
            >
              <Text className="text-primary text-base">← Back</Text>
            </Pressable>
            <Text className="text-3xl font-bold text-dark-100">
              Add Transaction
            </Text>
            <Text className="text-sm text-gray-500 mt-2">
              Manually add a new transaction
            </Text>
          </View>

          {/* Type Toggle */}
          <View className="mb-6">
            <Text className="text-sm font-semibold text-dark-100 mb-3">
              Type
            </Text>
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setKind("expense")}
                className={`flex-1 py-3 rounded-xl border-2 ${
                  kind === "expense"
                    ? "border-red-500 bg-red-50"
                    : "border-gray-200 bg-white"
                }`}
              >
                <Text
                  className={`text-center font-semibold ${
                    kind === "expense" ? "text-red-600" : "text-gray-600"
                  }`}
                >
                  Expense
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setKind("income")}
                className={`flex-1 py-3 rounded-xl border-2 ${
                  kind === "income"
                    ? "border-green-500 bg-green-50"
                    : "border-gray-200 bg-white"
                }`}
              >
                <Text
                  className={`text-center font-semibold ${
                    kind === "income" ? "text-green-600" : "text-gray-600"
                  }`}
                >
                  Income
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Description */}
          <View className="mb-6">
            <Text className="text-sm font-semibold text-dark-100 mb-2">
              Description
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g., Groceries, Salary"
              className="px-4 py-3 rounded-2xl bg-white border border-gray-200 text-dark-100"
              editable={!loading}
            />
          </View>

          {/* Amount */}
          <View className="mb-6">
            <Text className="text-sm font-semibold text-dark-100 mb-2">
              Amount (€)
            </Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              keyboardType="decimal-pad"
              className="px-4 py-3 rounded-2xl bg-white border border-gray-200 text-dark-100"
              editable={!loading}
            />
          </View>

          {/* Date */}
          <View className="mb-6">
            <Text className="text-sm font-semibold text-dark-100 mb-2">
              Date
            </Text>
            <TextInput
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              className="px-4 py-3 rounded-2xl bg-white border border-gray-200 text-dark-100"
              editable={!loading}
            />
            <Text className="text-xs text-gray-500 mt-1">
              Format: YYYY-MM-DD (e.g., 2025-12-25)
            </Text>
          </View>

          {/* Time */}
          <View className="mb-6">
            <Text className="text-sm font-semibold text-dark-100 mb-2">
              Time
            </Text>
            <TextInput
              value={time}
              onChangeText={setTime}
              placeholder="HH:MM"
              className="px-4 py-3 rounded-2xl bg-white border border-gray-200 text-dark-100"
              editable={!loading}
            />
            <Text className="text-xs text-gray-500 mt-1">
              Format: HH:MM (e.g., 14:30)
            </Text>
          </View>

          {/* Category */}
          <View className="mb-8">
            <Text className="text-sm font-semibold text-dark-100 mb-3">
              Category
            </Text>
            {loadingCategories ? (
              <ActivityIndicator color="#667eea" />
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6 }}
              >
                {categories
                  .sort((a, b) => {
                    // Put selected category first
                    if (a.$id === selectedCategoryId) return -1;
                    if (b.$id === selectedCategoryId) return 1;
                    return 0;
                  })
                  .map((cat) => (
                    <Pressable
                      key={cat.$id}
                      onPress={() => setSelectedCategoryId(cat.$id)}
                      className={`px-4 py-2 rounded-full border-2 ${
                        selectedCategoryId === cat.$id
                          ? "border-primary bg-primary/10"
                          : "border-gray-200 bg-white"
                      }`}
                    >
                      <Text
                        className={`font-semibold ${
                          selectedCategoryId === cat.$id
                            ? "text-primary"
                            : "text-gray-600"
                        }`}
                      >
                        {cat.name}
                      </Text>
                    </Pressable>
                  ))}
              </ScrollView>
            )}
          </View>

          {/* Action Buttons */}
          <View className="gap-3">
            <Pressable
              onPress={handleSave}
              disabled={loading || !title.trim() || !amount}
              className={`rounded-2xl py-4 items-center ${
                loading || !title.trim() || !amount
                  ? "bg-gray-300"
                  : "bg-primary"
              }`}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white text-base font-bold">
                  Add Transaction
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => router.back()}
              disabled={loading}
              className="rounded-2xl border-2 border-gray-200 py-4 items-center bg-white"
            >
              <Text className="text-gray-700 text-base font-semibold">
                Cancel
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
