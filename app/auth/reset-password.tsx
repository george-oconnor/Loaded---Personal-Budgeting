import { completePasswordReset } from "@/lib/appwrite";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{ userId?: string; secret?: string }>();
  const [userId, setUserId] = useState(params.userId || "");
  const [secret, setSecret] = useState(params.secret || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleResetPassword = async () => {
    if (!password || !confirmPassword) {
      setError("Please fill in all fields");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (!userId || !secret) {
      setError("Please enter your User ID and Secret from the email.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      await completePasswordReset(userId, secret, password);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Failed to reset password. Please try again.");
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
            <Text className="text-2xl font-bold text-dark-100 mb-2 text-center">Password Reset Successful</Text>
            <Text className="text-base text-gray-500 text-center">
              Your password has been updated. You can now sign in with your new password.
            </Text>
          </View>

          <Pressable
            onPress={() => router.replace("/auth")}
            className="py-4 rounded-2xl items-center bg-primary"
          >
            <Text className="text-white text-base font-bold">Go to Login</Text>
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
            <Text className="text-3xl font-bold text-dark-100 mb-2">Reset Password</Text>
            <Text className="text-base text-gray-500 mb-8">
              Enter the reset code from your email and your new password.
            </Text>

            <View className="gap-4 mb-6">
              <View>
                <Text className="text-sm font-semibold text-dark-100 mb-2">User ID</Text>
                <TextInput
                  value={userId}
                  onChangeText={setUserId}
                  placeholder="User ID from email"
                  autoCapitalize="none"
                  editable={!loading}
                  className="px-4 py-3 rounded-2xl bg-white border border-gray-200 text-dark-100"
                />
              </View>

              <View>
                <Text className="text-sm font-semibold text-dark-100 mb-2">Secret Token</Text>
                <TextInput
                  value={secret}
                  onChangeText={setSecret}
                  placeholder="Secret token from email"
                  autoCapitalize="none"
                  editable={!loading}
                  className="px-4 py-3 rounded-2xl bg-white border border-gray-200 text-dark-100"
                />
              </View>

              <View>
                <Text className="text-sm font-semibold text-dark-100 mb-2">New Password</Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="password-new"
                  editable={!loading}
                  className="px-4 py-3 rounded-2xl bg-white border border-gray-200 text-dark-100"
                />
              </View>

              <View>
                <Text className="text-sm font-semibold text-dark-100 mb-2">Confirm Password</Text>
                <TextInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="••••••••"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="password-new"
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
              onPress={handleResetPassword}
              disabled={loading || !password || !confirmPassword || !userId || !secret}
              className={`py-4 rounded-2xl items-center mb-4 ${
                loading || !password || !confirmPassword || !userId || !secret ? "bg-gray-300" : "bg-primary"
              }`}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white text-base font-bold">Reset Password</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
