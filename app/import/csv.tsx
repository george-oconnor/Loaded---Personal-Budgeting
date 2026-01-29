import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const TUTORIAL_STEPS = [
  {
    step: 1,
    title: "Prepare Your CSV File",
    description: "Export transactions from your bank's website or app as a CSV file.",
  },
  {
    step: 2,
    title: "Required Columns",
    description: "Your CSV should have columns for: Date, Amount (or Debit/Credit), and Description.",
  },
  {
    step: 3,
    title: "Privacy First",
    description: "We'll analyze your file's structure locally. Only column names and format info are used - never your actual transaction data.",
  },
  {
    step: 4,
    title: "Smart Detection",
    description: "AI will help identify which columns contain what data, making import seamless.",
  },
  {
    step: 5,
    title: "Review & Confirm",
    description: "Preview your transactions before importing to ensure everything looks correct.",
  },
];

const SECURITY_POINTS = [
  {
    icon: "shield",
    title: "Data Never Leaves Your Device",
    description: "Your actual transaction data stays on your device. Only anonymized column structure is analyzed.",
  },
  {
    icon: "lock",
    title: "No Financial Data Shared",
    description: "Merchant names, amounts, and dates are replaced with synthetic samples for AI analysis.",
  },
  {
    icon: "eye-off",
    title: "Privacy by Design",
    description: "We extract only the format pattern - the AI never sees your real transactions.",
  },
];

export default function GenericCSVImportScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 100 }}
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
          <View className="flex-row items-center gap-3 mb-2">
            <View
              className="w-12 h-12 rounded-lg items-center justify-center"
              style={{ backgroundColor: "#10B98120" }}
            >
              <Feather name="file-text" size={24} color="#10B981" />
            </View>
            <View>
              <Text className="text-2xl font-bold text-dark-100">Import CSV</Text>
              <Text className="text-sm text-gray-500">Universal bank statement import</Text>
            </View>
          </View>
        </View>

        {/* Security Section */}
        <View className="mb-8 p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
          <View className="flex-row items-center gap-2 mb-3">
            <Feather name="shield" size={20} color="#10B981" />
            <Text className="text-base font-bold text-emerald-800">Your Privacy is Protected</Text>
          </View>
          <View className="gap-3">
            {SECURITY_POINTS.map((point, index) => (
              <View key={index} className="flex-row items-start gap-3">
                <View className="w-8 h-8 rounded-full bg-emerald-100 items-center justify-center mt-0.5">
                  <Feather name={point.icon as any} size={14} color="#10B981" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-emerald-800">{point.title}</Text>
                  <Text className="text-xs text-emerald-700 mt-0.5">{point.description}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* How it works */}
        <View className="mb-8">
          <Text className="text-lg font-bold text-dark-100 mb-4">How it Works</Text>
          <View className="gap-4">
            {TUTORIAL_STEPS.map((step) => (
              <View key={step.step} className="flex-row items-start gap-4">
                <View className="w-8 h-8 rounded-full bg-primary/10 items-center justify-center">
                  <Text className="text-primary font-bold text-sm">{step.step}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-base font-semibold text-dark-100">{step.title}</Text>
                  <Text className="text-sm text-gray-500 mt-1">{step.description}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Supported Formats */}
        <View className="mb-8 p-4 bg-gray-50 rounded-2xl">
          <Text className="text-base font-bold text-dark-100 mb-2">Supported Formats</Text>
          <Text className="text-sm text-gray-600 mb-3">
            Most bank CSV exports are supported, including:
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {["Standard CSV", "Excel Export", "Bank Statements", "Transaction History"].map((format) => (
              <View key={format} className="px-3 py-1.5 bg-white rounded-full border border-gray-200">
                <Text className="text-xs font-medium text-gray-700">{format}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Bottom CTA */}
      <View className="absolute bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-100">
        <Pressable
          onPress={() => router.push("/import/csv/paste" as any)}
          className="w-full bg-emerald-500 py-4 rounded-2xl items-center active:opacity-80"
        >
          <View className="flex-row items-center gap-2">
            <Feather name="upload" size={18} color="white" />
            <Text className="text-white font-bold text-base">Import CSV File</Text>
          </View>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
