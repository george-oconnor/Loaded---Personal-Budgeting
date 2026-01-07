import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function LoadingSplash() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 items-center justify-center">
        <View className="items-center gap-6">
          <View className="w-20 h-20 rounded-full bg-purple-600 items-center justify-center">
            <Text className="text-5xl font-bold text-white">💰</Text>
          </View>
          <ActivityIndicator size="large" color="#7C3AED" />
          <Text className="text-gray-500 text-sm mt-4">Loading your data...</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
