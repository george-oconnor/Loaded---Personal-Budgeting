import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const IMPORT_OPTIONS = [
  {
    id: "csv",
    name: "AI CSV/Excel Import",
    icon: "file-text",
    description: "Import from any bank's CSV export with AI-powered format detection",
    color: "#10B981",
    featured: true,
  },
  {
    id: "pdf",
    name: "AI PDF Statement Import",
    icon: "file",
    description: "Import from PDF bank statements using on-device text extraction",
    color: "#8B5CF6",
    featured: true,
  },
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
    id: "manual",
    name: "Manual Entry",
    icon: "plus-circle",
    description: "Add transactions manually",
    color: "#F59E0B",
  },
];

export default function ImportTabScreen() {
  const handleImportOption = (optionId: string) => {
    switch (optionId) {
      case "aib":
        router.push("/import/aib" as any);
        break;
      case "revolut":
        router.push("/import/revolut");
        break;
      case "csv":
        router.push("/import/csv" as any);
        break;
      case "pdf":
        router.push("/import/pdf" as any);
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
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="pb-5">
          <Text className="text-2xl font-bold text-dark-100">Import Transactions</Text>
          <Text className="text-sm text-gray-500 mt-2">
            Add transactions from your bank or financial accounts
          </Text>
        </View>

        {/* Main Featured Option - AI CSV Import */}
        {IMPORT_OPTIONS.filter((opt) => opt.featured).map((option) => (
          <Pressable
            key={option.id}
            onPress={() => handleImportOption(option.id)}
            className="rounded-3xl border-2 p-6 flex-row items-start gap-4 mb-8 bg-emerald-50 border-emerald-300 shadow-sm"
          >
            <View
              className="w-16 h-16 rounded-2xl items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${option.color}25` }}
            >
              <Feather name={option.icon as any} size={32} color={option.color} />
            </View>

            <View className="flex-1">
              <View className="flex-row flex-wrap items-center gap-2 mb-2">
                <Text className="text-lg font-bold text-dark-100">{option.name}</Text>
                <View className="bg-emerald-200 px-3 py-1 rounded-full">
                  <Text className="text-xs font-bold text-emerald-800">Recommended</Text>
                </View>
              </View>
              <Text className="text-base text-gray-700 leading-5">{option.description}</Text>
            </View>

            <Feather name="arrow-right" size={24} color="#10B981" style={{ alignSelf: 'center' }} />
          </Pressable>
        ))}

        {/* Alternative Options */}
        <View className="mb-8">
          <Text className="text-sm font-semibold text-gray-600 mb-3 px-2">Other Options</Text>
          <View className="gap-2">
            {IMPORT_OPTIONS.filter((opt) => !opt.featured).map((option) => (
              <Pressable
                key={option.id}
                onPress={() => handleImportOption(option.id)}
                className="rounded-xl border-2 p-3 flex-row items-center gap-3 border-gray-200 bg-white active:bg-gray-50"
              >
                <View
                  className="w-10 h-10 rounded-lg items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${option.color}20` }}
                >
                  <Feather name={option.icon as any} size={18} color={option.color} />
                </View>

                <View className="flex-1 min-h-12 justify-center">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-sm font-semibold text-dark-100">{option.name}</Text>
                  </View>
                  <Text className="text-xs text-gray-600 mt-0.5">{option.description}</Text>
                </View>

                <Feather name="arrow-right" size={16} color="#9CA3AF" />
              </Pressable>
            ))}
          </View>
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
