import { USE_CLOUDKIT } from "@/lib/backend";
import { isAppleAuthAvailable } from "@/lib/auth";
import { useSessionStore } from "@/store/useSessionStore";
import * as AppleAuthentication from "expo-apple-authentication";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { login, loginWithApple, status, error } = useSessionStore();
  const [appleAvailable, setAppleAvailable] = useState(true);

  useEffect(() => {
    if (USE_CLOUDKIT) {
      isAppleAuthAvailable().then(setAppleAvailable);
    }
  }, []);

  const handleLogin = async () => {
    try {
      await login(email, password);
      router.replace("/");
    } catch {
      // Error is surfaced by the store
    }
  };

  const handleApple = async () => {
    try {
      await loginWithApple();
      // Navigation is handled by the root layout once status becomes authenticated
      // or icloud-unavailable.
    } catch {
      // Error is surfaced by the store
    }
  };

  const loading = status === "loading";

  // ── CloudKit: Sign in with Apple ──
  if (USE_CLOUDKIT) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 px-6 justify-center">
          <View className="items-center mb-12">
            <Text className="text-4xl font-bold text-dark-100 mb-3">Loaded</Text>
            <Text className="text-base text-gray-500 text-center">
              Your budget, stored privately in your iCloud. No account, no tracking.
            </Text>
          </View>

          {error ? (
            <View className="px-4 py-3 rounded-2xl bg-red-50 mb-4">
              <Text className="text-sm text-red-600">{error}</Text>
            </View>
          ) : null}

          {loading ? (
            <View className="py-4 items-center">
              <ActivityIndicator />
            </View>
          ) : appleAvailable ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={16}
              style={{ height: 52, width: "100%" }}
              onPress={handleApple}
            />
          ) : (
            <View className="px-4 py-3 rounded-2xl bg-gray-100">
              <Text className="text-sm text-gray-600 text-center">
                Sign in with Apple isn&apos;t available on this device.
              </Text>
            </View>
          )}

          <Pressable className="mt-8 items-center" onPress={() => router.push("/migrate")} disabled={loading}>
            <Text className="text-primary font-semibold">Migrating from an email account?</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── Appwrite: email / password ──
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
                  style={{ paddingVertical: 12 }}
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
                  style={{ paddingVertical: 12 }}
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
              <Text className="text-gray-500">Don&apos;t have an account?</Text>
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
