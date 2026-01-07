import { useSessionStore } from "@/store/useSessionStore";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { login, status, error } = useSessionStore();

  const handleLogin = async () => {
    try {
      await login(email, password);
      router.replace("/");
    } catch (err) {
      // Error is handled by the store
    }
  };

  const loading = status === "loading";

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 40 }}
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-1 justify-center">
            <Text className="text-3xl font-bold text-dark-100 mb-2">Welcome Back</Text>
            <Text className="text-base text-gray-500 mb-8">Sign in to continue</Text>

            <View className="gap-4 mb-6">
              <View>
                <Text className="text-sm font-semibold text-dark-100 mb-2">Email</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="your@email.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  editable={!loading}
                  className="px-4 py-3 rounded-2xl bg-white border border-gray-200 text-dark-100"
                />
              </View>

              <View>
                <View className="flex-row justify-between items-center mb-2">
                  <Text className="text-sm font-semibold text-dark-100">Password</Text>
                  <Pressable onPress={() => router.push("/auth/forgot-password")} disabled={loading}>
                    <Text className="text-sm text-primary font-semibold">Forgot?</Text>
                  </Pressable>
                </View>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="password"
                  editable={!loading}
                  className="px-4 py-3 rounded-2xl bg-white border border-gray-200 text-dark-100"
                />
              </View>
            </View>

            {error && (
              <View className="px-4 py-3 rounded-2xl bg-red-50 mb-4">
                <Text className="text-sm text-red-600">{error}</Text>
              </View>
            )}

            <Pressable
              onPress={handleLogin}
              disabled={loading || !email || !password}
              className={`py-4 rounded-2xl items-center mb-4 ${
                loading || !email || !password ? "bg-gray-300" : "bg-primary"
              }`}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white text-base font-bold">Sign In</Text>
              )}
            </Pressable>

            <View className="flex-row items-center justify-center gap-2">
              <Text className="text-gray-500">Don't have an account?</Text>
              <Pressable onPress={() => router.push("/auth/signup")} disabled={loading}>
                <Text className="text-primary font-semibold">Sign Up</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
