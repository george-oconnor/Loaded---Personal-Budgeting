import { useSessionStore } from "@/store/useSessionStore";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SignupScreen() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { signup, status, error } = useSessionStore();

  const handleSignup = async () => {
    try {
      await signup(email, password, firstName, lastName);
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
            <Text className="text-3xl font-bold text-dark-100 mb-2">Create Account</Text>
            <Text className="text-base text-gray-500 mb-8">Sign up to get started</Text>

            <View className="gap-4 mb-6">
              <View>
                <Text className="text-sm font-semibold text-dark-100 mb-2">First Name</Text>
                <TextInput
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="John"
                  autoCapitalize="words"
                  autoComplete="name-given"
                  editable={!loading}
                  className="px-4 py-3 rounded-2xl bg-white border border-gray-200 text-dark-100"
                />
              </View>

              <View>
                <Text className="text-sm font-semibold text-dark-100 mb-2">Last Name</Text>
                <TextInput
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Doe"
                  autoCapitalize="words"
                  autoComplete="name-family"
                  editable={!loading}
                  className="px-4 py-3 rounded-2xl bg-white border border-gray-200 text-dark-100"
                />
              </View>

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
                <Text className="text-sm font-semibold text-dark-100 mb-2">Password</Text>
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
            </View>

            {error && (
              <View className="px-4 py-3 rounded-2xl bg-red-50 mb-4">
                <Text className="text-sm text-red-600">{error}</Text>
              </View>
            )}

            <Pressable
              onPress={handleSignup}
              disabled={loading || !firstName || !lastName || !email || !password}
              className={`py-4 rounded-2xl items-center mb-4 ${
                loading || !firstName || !lastName || !email || !password ? "bg-gray-300" : "bg-primary"
              }`}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white text-base font-bold">Create Account</Text>
              )}
            </Pressable>

            <View className="flex-row items-center justify-center gap-2">
              <Text className="text-gray-500">Already have an account?</Text>
              <Pressable onPress={() => router.back()} disabled={loading}>
                <Text className="text-primary font-semibold">Sign In</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
