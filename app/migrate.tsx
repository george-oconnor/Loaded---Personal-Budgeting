import { getCurrentSession } from "@/lib/appwrite";
import {
  buildSteps,
  runMigration,
  skipMigration,
  type LegacyCredentials,
  type MigrationStep,
} from "@/lib/migration";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Phase = "intro" | "credentials" | "running" | "done" | "error";

export default function MigrateScreen() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [hasSession, setHasSession] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [steps, setSteps] = useState<MigrationStep[]>(buildSteps());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCurrentSession()
      .then((s) => setHasSession(!!s))
      .catch(() => setHasSession(false));
  }, []);

  const start = async (creds: LegacyCredentials | null) => {
    setError(null);
    setPhase("running");
    const result = await runMigration(creds, setSteps);
    if (result.success) {
      setPhase("done");
    } else {
      setError(result.error ?? "Migration failed");
      setPhase("error");
    }
  };

  const handleStart = () => {
    if (hasSession) {
      start(null);
    } else {
      setPhase("credentials");
    }
  };

  const handleCredentialSubmit = () => {
    if (!email || !password) return;
    start({ email, password });
  };

  const handleSkip = async () => {
    await skipMigration();
    router.replace("/");
  };

  const finish = () => router.replace("/");

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} className="flex-1">
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 20 }} showsVerticalScrollIndicator={false}>
          <Text className="text-3xl font-bold text-dark-100 mb-2">Import your data</Text>

          {phase === "intro" && (
            <View className="flex-1">
              <Text className="text-base text-gray-500 mb-8">
                Bring your transactions, budgets, balances and subscriptions from your old Loaded
                account into iCloud. This runs once and can be safely re-run if interrupted.
              </Text>
              <Pressable onPress={handleStart} className="py-4 rounded-2xl items-center bg-primary mb-3">
                <Text className="text-white text-base font-bold">Start import</Text>
              </Pressable>
              <Pressable onPress={handleSkip} className="py-4 rounded-2xl items-center bg-gray-100">
                <Text className="text-dark-100 text-base font-semibold">I&apos;m new — skip</Text>
              </Pressable>
            </View>
          )}

          {phase === "credentials" && (
            <View className="flex-1">
              <Text className="text-base text-gray-500 mb-6">
                Sign in to your old account (email and password) so we can read your data one last time.
              </Text>
              <View className="gap-4 mb-6">
                <View>
                  <Text className="text-sm font-semibold text-dark-100 mb-2">Email</Text>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="your@email.com"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    className="px-4 py-3 rounded-2xl bg-white border border-gray-200 text-dark-100"
                    style={{ paddingVertical: 12 }}
                  />
                </View>
                <View>
                  <Text className="text-sm font-semibold text-dark-100 mb-2">Password</Text>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Your old account password"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry
                    autoCapitalize="none"
                    className="px-4 py-3 rounded-2xl bg-white border border-gray-200 text-dark-100"
                    style={{ paddingVertical: 12 }}
                  />
                </View>
              </View>
              <Pressable
                onPress={handleCredentialSubmit}
                disabled={!email || !password}
                className={`py-4 rounded-2xl items-center ${!email || !password ? "bg-gray-300" : "bg-primary"}`}
              >
                <Text className="text-white text-base font-bold">Continue</Text>
              </Pressable>
            </View>
          )}

          {(phase === "running" || phase === "done" || phase === "error") && (
            <View className="flex-1">
              <View className="gap-3 mb-8">
                {steps.map((step) => (
                  <StepRow key={step.key} step={step} />
                ))}
              </View>

              {error && (
                <View className="px-4 py-3 rounded-2xl bg-red-50 mb-4">
                  <Text className="text-sm text-red-600">{error}</Text>
                </View>
              )}

              {phase === "done" && (
                <Pressable onPress={finish} className="py-4 rounded-2xl items-center bg-primary">
                  <Text className="text-white text-base font-bold">Done</Text>
                </Pressable>
              )}

              {phase === "error" && (
                <Pressable onPress={() => start(null)} className="py-4 rounded-2xl items-center bg-primary">
                  <Text className="text-white text-base font-bold">Retry</Text>
                </Pressable>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StepRow({ step }: { step: MigrationStep }) {
  return (
    <View className="flex-row items-center gap-3">
      <View className="w-6 items-center">
        {step.status === "active" && <ActivityIndicator size="small" />}
        {step.status === "done" && <Feather name="check-circle" size={20} color="#2F9B65" />}
        {step.status === "error" && <Feather name="alert-circle" size={20} color="#F14141" />}
        {step.status === "pending" && <Feather name="circle" size={20} color="#D1D5DB" />}
      </View>
      <Text className={`text-base ${step.status === "pending" ? "text-gray-400" : "text-dark-100"}`}>
        {step.label}
        {step.count !== undefined ? `  (${step.count})` : ""}
      </Text>
    </View>
  );
}
