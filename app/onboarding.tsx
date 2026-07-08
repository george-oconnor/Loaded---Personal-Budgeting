import { updateMonthlyBudget } from "@/lib/backend";
import { useSessionStore } from "@/store/useSessionStore";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeIn, SlideInRight, SlideOutLeft } from "react-native-reanimated";

const SLIDES = [
  {
    emoji: "💰",
    blob: "#FE8C00",
    title: "Take control\nof your money",
    subtitle: "Track every euro, effortlessly — see exactly where it goes and stay on budget.",
  },
  {
    emoji: "🏦",
    blob: "#0C8CE9",
    title: "Import in\nseconds",
    subtitle: "Pull transactions straight from Revolut, AIB, or any CSV. We auto-categorise them for you.",
  },
  {
    emoji: "🔒",
    blob: "#2F9B65",
    title: "Yours, and\nonly yours",
    subtitle: "Everything lives privately in your own iCloud. No sign-ups, no tracking, no ads. Ever.",
  },
];

const NAME_STEP = SLIDES.length; // 3
const IMPORT_STEP = NAME_STEP + 1; // 4
const BUDGET_STEP = IMPORT_STEP + 1; // 5
const TOTAL = BUDGET_STEP + 1; // 6

export default function OnboardingScreen() {
  const { user, setUserName, completeOnboarding } = useSessionStore();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(user?.name ?? "");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    await completeOnboarding();
    router.replace("/");
  };

  const saveBudgetAndFinish = async () => {
    setBusy(true);
    const amount = parseFloat(budget.replace(/,/g, ""));
    if (user?.id && !isNaN(amount) && amount > 0) {
      await updateMonthlyBudget(user.id, Math.round(amount * 100), "EUR", "first_working_day", undefined, "manual").catch(() => {});
    }
    await completeOnboarding();
    router.replace("/");
  };

  const goImport = async () => {
    setBusy(true);
    if (name.trim()) await setUserName(name);
    await completeOnboarding();
    router.replace("/migrate");
  };

  const next = async () => {
    if (step === NAME_STEP && name.trim()) {
      await setUserName(name);
    }
    setStep((s) => Math.min(s + 1, TOTAL - 1));
  };

  const isSlide = step < NAME_STEP;
  const slide = isSlide ? SLIDES[step] : null;
  const accent = slide?.blob ?? "#FE8C00";

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        {/* Playful colour blobs */}
        <Animated.View
          key={`blobA-${step}`}
          entering={FadeIn.duration(600)}
          pointerEvents="none"
          style={{ position: "absolute", top: -70, right: -60, width: 240, height: 240, borderRadius: 120, backgroundColor: accent, opacity: 0.16 }}
        />
        <View pointerEvents="none" style={{ position: "absolute", bottom: 120, left: -70, width: 200, height: 200, borderRadius: 100, backgroundColor: "#6C63FF", opacity: 0.1 }} />

        {/* Skip */}
        {step < BUDGET_STEP && (
          <Pressable onPress={finish} disabled={busy} className="absolute right-5 top-2 z-10 px-3 py-2">
            <Text className="text-sm font-semibold text-gray-400">Skip</Text>
          </Pressable>
        )}

        <View className="flex-1 px-6 justify-center">
          {/* ---- Intro slides ---- */}
          {isSlide && slide && (
            <Animated.View key={`slide-${step}`} entering={SlideInRight.duration(420)} exiting={SlideOutLeft.duration(260)}>
              <Animated.Text key={`emoji-${step}`} entering={FadeIn.duration(500).delay(120)} style={{ fontSize: 84, marginBottom: 28 }}>
                {slide.emoji}
              </Animated.Text>
              <Text className="text-4xl font-bold text-dark-100 mb-4" style={{ lineHeight: 42 }}>{slide.title}</Text>
              <Text className="text-lg text-gray-500" style={{ lineHeight: 26 }}>{slide.subtitle}</Text>
            </Animated.View>
          )}

          {/* ---- Name capture ---- */}
          {step === NAME_STEP && (
            <Animated.View key="name" entering={SlideInRight.duration(420)} exiting={SlideOutLeft.duration(260)}>
              <Animated.Text entering={FadeIn.duration(500).delay(120)} style={{ fontSize: 76, marginBottom: 24 }}>👋</Animated.Text>
              <Text className="text-4xl font-bold text-dark-100 mb-3">What should we{"\n"}call you?</Text>
              <Text className="text-lg text-gray-500 mb-8">Just a first name is perfect.</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor="#9CA3AF"
                autoFocus
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={() => name.trim() && next()}
                className="px-5 py-4 rounded-2xl bg-gray-100 text-dark-100 text-lg"
                style={{ paddingVertical: 16 }}
              />
            </Animated.View>
          )}

          {/* ---- Import existing data ---- */}
          {step === IMPORT_STEP && (
            <Animated.View key="import" entering={SlideInRight.duration(420)} exiting={SlideOutLeft.duration(260)}>
              <Animated.Text entering={FadeIn.duration(500).delay(120)} style={{ fontSize: 76, marginBottom: 24 }}>📦</Animated.Text>
              <Text className="text-4xl font-bold text-dark-100 mb-3">Used Loaded{"\n"}before?</Text>
              <Text className="text-lg text-gray-500 mb-10">If you had an older account, bring all your transactions, budgets and balances across to iCloud.</Text>
              <Pressable onPress={goImport} disabled={busy} className="py-4 rounded-2xl items-center bg-primary mb-3 active:opacity-80">
                <Text className="text-white text-base font-bold">Yes, import my data</Text>
              </Pressable>
              <Pressable onPress={() => setStep(BUDGET_STEP)} disabled={busy} className="py-4 rounded-2xl items-center bg-gray-100 active:opacity-80">
                <Text className="text-dark-100 text-base font-semibold">No, I&apos;m new here</Text>
              </Pressable>
            </Animated.View>
          )}

          {/* ---- Budget setup ---- */}
          {step === BUDGET_STEP && (
            <Animated.View key="budget" entering={SlideInRight.duration(420)} exiting={SlideOutLeft.duration(260)}>
              <Animated.Text entering={FadeIn.duration(500).delay(120)} style={{ fontSize: 76, marginBottom: 24 }}>🎯</Animated.Text>
              <Text className="text-4xl font-bold text-dark-100 mb-3">Set your{"\n"}monthly budget</Text>
              <Text className="text-lg text-gray-500 mb-8">How much do you want to spend each month? You can change this anytime.</Text>
              <View className="flex-row items-center px-5 rounded-2xl bg-gray-100">
                <Text className="text-2xl font-bold text-gray-400 mr-1">€</Text>
                <TextInput
                  value={budget}
                  onChangeText={setBudget}
                  placeholder="2,500"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="decimal-pad"
                  autoFocus
                  className="flex-1 py-4 text-dark-100 text-2xl font-bold"
                  style={{ paddingVertical: 16 }}
                />
              </View>
            </Animated.View>
          )}
        </View>

        {/* ---- Footer: progress dots + primary button ---- */}
        <View className="px-6 pb-4">
          <View className="flex-row items-center justify-center gap-2 mb-6">
            {Array.from({ length: TOTAL }).map((_, i) => (
              <View
                key={i}
                style={{
                  height: 8,
                  width: i === step ? 24 : 8,
                  borderRadius: 4,
                  backgroundColor: i === step ? "#FE8C00" : "#E5E7EB",
                }}
              />
            ))}
          </View>

          {step !== IMPORT_STEP && (
            <Pressable
              onPress={step === BUDGET_STEP ? saveBudgetAndFinish : next}
              disabled={busy || (step === NAME_STEP && !name.trim())}
              className={`py-4 rounded-2xl flex-row items-center justify-center gap-2 ${
                busy || (step === NAME_STEP && !name.trim()) ? "bg-gray-300" : "bg-primary"
              } active:opacity-80`}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text className="text-white text-base font-bold">
                    {step === BUDGET_STEP ? "Start using Loaded" : step === NAME_STEP ? "Continue" : "Next"}
                  </Text>
                  <Feather name="arrow-right" size={18} color="#fff" />
                </>
              )}
            </Pressable>
          )}

          {step === BUDGET_STEP && (
            <Pressable onPress={finish} disabled={busy} className="py-3 items-center">
              <Text className="text-gray-400 font-semibold">Set it up later</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
