import { useSessionStore } from "@/store/useSessionStore";
import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * Full-screen gate shown when the user is signed in but the device has no
 * usable iCloud account. Their data isn't lost — it's simply unreachable until
 * they sign into iCloud. Any writes they make meanwhile keep accumulating in
 * the local AsyncStorage queues.
 */
export function ICloudGate() {
  const { recheckICloud, logout } = useSessionStore();
  const [checking, setChecking] = useState(false);

  const handleRetry = async () => {
    setChecking(true);
    try {
      await recheckICloud();
    } finally {
      setChecking(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-6 justify-center items-center">
        <View className="w-16 h-16 rounded-full bg-blue-50 items-center justify-center mb-6">
          <Feather name="cloud-off" size={28} color="#0C8CE9" />
        </View>

        <Text className="text-2xl font-bold text-dark-100 mb-3 text-center">
          Sign in to iCloud
        </Text>
        <Text className="text-base text-gray-500 text-center mb-8">
          Loaded keeps your budget private by storing it in your own iCloud account.
          To continue, sign into iCloud on this device, then tap Retry.
        </Text>

        <Text className="text-sm text-gray-400 text-center mb-8">
          Open Settings → tap your name at the top → make sure iCloud is on.
        </Text>

        <Pressable
          onPress={handleRetry}
          disabled={checking}
          className={`w-full py-4 rounded-2xl items-center mb-3 ${checking ? "bg-gray-300" : "bg-primary"}`}
        >
          {checking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white text-base font-bold">Retry</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => Linking.openURL("App-Prefs:root=CASTLE").catch(() => Linking.openSettings())}
          className="w-full py-4 rounded-2xl items-center mb-3 bg-gray-100"
          disabled={checking}
        >
          <Text className="text-dark-100 text-base font-semibold">Open Settings</Text>
        </Pressable>

        <Pressable onPress={() => logout()} className="mt-2" disabled={checking}>
          <Text className="text-gray-400 font-medium">Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
