import { requestPasswordReset } from "@/lib/appwrite";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handlePasswordReset = async () => {
    if (!email) {
      setError("Please enter your email address");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const resetUrl = "https://george-oconnor.github.io/budget-app/reset-password.html";
      await requestPasswordReset(email, resetUrl);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Failed to send reset email. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 px-5 pt-10 justify-center">
          <View className="items-center mb-8">
            <View className="w-16 h-16 rounded-full bg-green-100 items-center justify-center mb-4">
              <Text className="text-3xl">✓</Text>
            </View>
            <Text className="text-2xl font-bold text-dark-100 mb-2 text-center">Check Your Email</Text>
            <Text className="text-base text-gray-500 text-center">
              We've sent a password reset link to {email}
            </Text>
          </View>

          <Pressable
            onPress={() => router.back()}
            className="py-4 rounded-2xl items-center bg-primary mb-3"
          >
            <Text className="text-white text-base font-bold">Back to Login</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/auth/reset-password")}
            className="py-4 rounded-2xl items-center bg-gray-100"
          >
            <Text className="text-dark-100 text-base font-bold">I Have a Reset Code</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

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
            <Pressable onPress={() => router.back()} className="mb-6">
              <Text className="text-primary text-base">← Back</Text>
            </Pressable>

            <Text className="text-3xl font-bold text-dark-100 mb-2">Forgot Password?</Text>
            <Text className="text-base text-gray-500 mb-8">
              Enter your email address and we'll send you a link to reset your password.
            </Text>

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
            </View>

            {error && (
              <View className="px-4 py-3 rounded-2xl bg-red-50 mb-4">
                <Text className="text-sm text-red-600">{error}</Text>
              </View>
            )}

            <Pressable
              onPress={handlePasswordReset}
              disabled={loading || !email}
              className={`py-4 rounded-2xl items-center mb-4 ${
                loading || !email ? "bg-gray-300" : "bg-primary"
              }`}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white text-base font-bold">Send Reset Link</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
