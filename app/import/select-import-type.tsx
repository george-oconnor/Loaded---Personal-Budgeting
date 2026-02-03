import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const IMPORT_TYPE_OPTIONS = [
  {
    id: "aib",
    name: "AIB Import",
    icon: "briefcase",
    description: "Use AIB-specific parser for bank statement CSV files",
    color: "#0EA5E9",
    pathname: "/import/aib/paste",
  },
  {
    id: "revolut",
    name: "Revolut Import",
    icon: "credit-card",
    description: "Use Revolut-specific parser for account CSV exports",
    color: "#4F46E5",
    pathname: "/import/revolut/paste",
  },
  {
    id: "csv",
    name: "AI CSV Import",
    icon: "file-text",
    description: "Use AI-powered parser for any bank CSV format",
    color: "#10B981",
    pathname: "/import/csv/paste",
  },
];

export default function SelectImportTypeScreen() {
  const params = useLocalSearchParams<{ csvContent: string; detectedType?: string }>();
  
  const handleSelectType = (pathname: string) => {
    router.push({
      pathname,
      params: { csvContent: params.csvContent }
    } as any);
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        contentContainerStyle={{ 
          flexGrow: 1, 
          paddingHorizontal: 20, 
          paddingTop: 20, 
          paddingBottom: 40 
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
          <Text className="text-3xl font-bold text-dark-100">Choose Import Type</Text>
          <Text className="text-sm text-gray-500 mt-2">
            Select which parser to use for your CSV file
          </Text>
        </View>

        {/* Import Type Options */}
        <View className="gap-4">
          {IMPORT_TYPE_OPTIONS.map((option) => {
            const isDetected = option.id === params.detectedType;
            
            return (
              <Pressable
                key={option.id}
                onPress={() => handleSelectType(option.pathname)}
                className={`rounded-2xl border-2 p-5 flex-row items-start gap-4 ${
                  isDetected 
                    ? "bg-emerald-50 border-emerald-300" 
                    : "bg-white border-gray-200"
                }`}
              >
                <View
                  className="w-14 h-14 rounded-xl items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${option.color}25` }}
                >
                  <Feather name={option.icon as any} size={28} color={option.color} />
                </View>

                <View className="flex-1">
                  <View className="flex-row items-center gap-2 mb-1">
                    <Text className="text-lg font-bold text-dark-100">
                      {option.name}
                    </Text>
                    {isDetected && (
                      <View className="bg-emerald-200 px-2.5 py-0.5 rounded-full">
                        <Text className="text-xs font-bold text-emerald-800">
                          Detected
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-sm text-gray-600 leading-5">
                    {option.description}
                  </Text>
                </View>

                <View className="mt-1">
                  <Feather name="chevron-right" size={20} color="#9CA3AF" />
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Help Text */}
        <View className="mt-8 p-4 bg-blue-50 rounded-xl border border-blue-200">
          <View className="flex-row gap-3">
            <Feather name="info" size={20} color="#3B82F6" />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-blue-900 mb-1">
                Not sure which to choose?
              </Text>
              <Text className="text-sm text-blue-800 leading-5">
                The AI CSV Import works with most bank formats. Use specific parsers 
                (AIB or Revolut) for better accuracy if you know your file source.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
