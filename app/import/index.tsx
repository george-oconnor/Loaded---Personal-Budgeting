import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const IMPORT_OPTIONS = [
  {
    id: "aib",
    name: "AIB",
    icon: "briefcase",
    description: "Import transactions from AIB bank statements",
    color: "#0EA5E9",
  },
  {
    id: "revolut",
    name: "Revolut",
    icon: "credit-card",
    description: "Import transactions from your Revolut account",
    color: "#4F46E5",
  },
  {
    id: "csv",
    name: "CSV File",
    icon: "file",
    description: "Import from a CSV file",
    color: "#10B981",
    comingSoon: true,
  },
  {
    id: "manual",
    name: "Manual Entry",
    icon: "plus-circle",
    description: "Add transactions manually",
    color: "#F59E0B",
  },
];

export default function ImportScreen() {
  const handleImportOption = (optionId: string) => {
    switch (optionId) {
      case "aib":
        router.push("/import/aib" as any);
        break;
      case "revolut":
        router.push("/import/revolut");
        break;
      case "csv":
        console.log("CSV import coming soon");
        break;
      case "manual":
        router.push("/add-transaction");
        break;
      default:
        break;
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 20 }}
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
          <Text className="text-3xl font-bold text-dark-100">Import Transactions</Text>
          <Text className="text-sm text-gray-500 mt-2">
            Add transactions from your bank or financial accounts
          </Text>
        </View>

        {/* Import Options */}
        <View className="gap-3 mb-8">
          {IMPORT_OPTIONS.map((option) => (
            <Pressable
              key={option.id}
              onPress={() => !option.comingSoon && handleImportOption(option.id)}
              disabled={option.comingSoon}
              className={`rounded-2xl border-2 p-4 flex-row items-start gap-4 ${
                option.comingSoon
                  ? "border-gray-200 bg-gray-50 opacity-60"
                  : "border-gray-200 bg-white active:bg-gray-50"
              }`}
            >
              <View
                className="w-12 h-12 rounded-lg items-center justify-center"
                style={{ backgroundColor: `${option.color}20` }}
              >
                <Feather name={option.icon as any} size={24} color={option.color} />
              </View>

              <View className="flex-1">
                <View className="flex-row items-center gap-2 mb-1">
                  <Text className="text-base font-bold text-dark-100">{option.name}</Text>
                  {option.comingSoon && (
                    <View className="bg-yellow-100 px-2 py-1 rounded">
                      <Text className="text-xs font-semibold text-yellow-800">Coming Soon</Text>
                    </View>
                  )}
                </View>
                <Text className="text-sm text-gray-600">{option.description}</Text>
              </View>

              {!option.comingSoon && (
                <Feather name="arrow-right" size={20} color="#6B7280" />
              )}
            </Pressable>
          ))}
        </View>

        {/* Info Section */}
        <View className="mt-auto pt-8 border-t border-gray-100">
          <Text className="text-xs text-gray-500 text-center">
            Your transactions are encrypted and secure. We never store your bank credentials.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
