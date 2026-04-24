import BalanceHistoryChart from "@/components/BalanceHistoryChart";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function AccountHistoryScreen() {
  const { accountKey, accountName, currency } = useLocalSearchParams<{
    accountKey?: string;
    accountName?: string;
    currency?: string;
  }>();

  const accountKeys = accountKey ? [String(accountKey)] : undefined;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="px-5 pt-4 pb-4 border-b border-gray-200">
        <Pressable
          onPress={() => router.back()}
          className="mb-4 flex-row items-center gap-2"
        >
          <Feather name="chevron-left" size={20} color="#6366F1" />
          <Text className="text-primary text-base">Back</Text>
        </Pressable>
        <Text className="text-2xl font-bold text-dark-100">
          {accountName || "Account"}
        </Text>
        <Text className="text-sm text-gray-500 mt-1">
          Balance over time{currency ? ` · ${currency}` : ""}
        </Text>
      </View>

      <View className="flex-1">
        <BalanceHistoryChart accountKeys={accountKeys} />
      </View>
    </SafeAreaView>
  );
}
