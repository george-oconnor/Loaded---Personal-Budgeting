import { updateMonthlyBudget } from "@/lib/backend";
import { useSessionStore } from "@/store/useSessionStore";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
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
import Animated, { FadeIn, SlideInRight, SlideOutLeft } from "react-native-reanimated";

const SLIDES = [
  { emoji: "💰", blob: "#FE8C00", title: "Take control\nof your money", subtitle: "Track every euro, effortlessly — see exactly where it goes and stay on budget." },
  { emoji: "🏦", blob: "#0C8CE9", title: "Import in\nseconds", subtitle: "Pull transactions straight from Revolut, AIB, or any CSV. We auto-categorise them for you." },
  { emoji: "🔒", blob: "#2F9B65", title: "Yours, and\nonly yours", subtitle: "Everything lives privately in your own iCloud. No sign-ups, no tracking, no ads. Ever." },
];

export default function OnboardingScreen() {
  const { user, setUserName, completeOnboarding } = useSessionStore();

  // Prefill from Apple when it provided details on first authorization.
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);

  // New users who already have a name + email from Apple skip the capture step.
  const needsProfile = !(user?.name?.trim() && user?.email?.trim());

  // Import is asked right after the slides — migrating users never see profile
  // capture (the migration brings their name/email/data across).
  const steps = useMemo(
    () => ["slide0", "slide1", "slide2", "import", ...(needsProfile ? ["profile"] : []), "budget"],
    [needsProfile]
  );

  const [idx, setIdx] = useState(0);
  const key = steps[idx];
  const accent = key.startsWith("slide") ? SLIDES[Number(key.slice(5))].blob : "#FE8C00";

  const next = () => setIdx((i) => Math.min(i + 1, steps.length - 1));

  const finish = async () => {
    setBusy(true);
    await completeOnboarding();
    router.replace("/");
  };

  const goImport = async () => {
    setBusy(true);
    await completeOnboarding();
    router.replace("/migrate");
  };

  const saveProfileAndNext = async () => {
    if (!name.trim()) return;
    setBusy(true);
    await setUserName(name, email);
    setBusy(false);
    next();
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

  const isSlide = key.startsWith("slide");
  const slide = isSlide ? SLIDES[Number(key.slice(5))] : null;

  const primaryDisabled = busy || (key === "profile" && !name.trim());
  const primaryLabel = key === "budget" ? "Start using Loaded" : key === "profile" ? "Continue" : "Next";
  const onPrimary = key === "budget" ? saveBudgetAndFinish : key === "profile" ? saveProfileAndNext : next;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        {/* Playful colour blobs */}
        <Animated.View
          key={`blob-${idx}`}
          entering={FadeIn.duration(600)}
          pointerEvents="none"
          style={{ position: "absolute", top: -70, right: -60, width: 240, height: 240, borderRadius: 120, backgroundColor: accent, opacity: 0.16 }}
        />
        <View pointerEvents="none" style={{ position: "absolute", bottom: 120, left: -70, width: 200, height: 200, borderRadius: 100, backgroundColor: "#6C63FF", opacity: 0.1 }} />

        {/* Skip only jumps past the intro slides to the import decision — the
            migration / name / email steps must be engaged with. */}
        {isSlide && (
          <Pressable onPress={() => setIdx(steps.indexOf("import"))} disabled={busy} className="absolute right-5 top-2 z-10 px-3 py-2">
            <Text className="text-sm font-semibold text-gray-400">Skip intro</Text>
          </Pressable>
        )}

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ---- Intro slides ---- */}
          {isSlide && slide && (
            <Animated.View key={key} entering={SlideInRight.duration(420)} exiting={SlideOutLeft.duration(260)}>
              <Animated.Text key={`emoji-${key}`} entering={FadeIn.duration(500).delay(120)} style={{ fontSize: 84, marginBottom: 28 }}>
                {slide.emoji}
              </Animated.Text>
              <Text className="text-4xl font-bold text-dark-100 mb-4" style={{ lineHeight: 42 }}>{slide.title}</Text>
              <Text className="text-lg text-gray-500" style={{ lineHeight: 26 }}>{slide.subtitle}</Text>
            </Animated.View>
          )}

          {/* ---- Import existing data ---- */}
          {key === "import" && (
            <Animated.View key="import" entering={SlideInRight.duration(420)} exiting={SlideOutLeft.duration(260)}>
              <Animated.Text entering={FadeIn.duration(500).delay(120)} style={{ fontSize: 76, marginBottom: 24 }}>📦</Animated.Text>
              <Text className="text-4xl font-bold text-dark-100 mb-3">Used Loaded{"\n"}before?</Text>
              <Text className="text-lg text-gray-500 mb-10">If you had an older account, bring all your transactions, budgets and balances across to iCloud.</Text>
              <Pressable onPress={goImport} disabled={busy} className="py-4 rounded-2xl items-center bg-primary mb-3 active:opacity-80">
                <Text className="text-white text-base font-bold">Yes, import my data</Text>
              </Pressable>
              <Pressable onPress={next} disabled={busy} className="py-4 rounded-2xl items-center bg-gray-100 active:opacity-80">
                <Text className="text-dark-100 text-base font-semibold">No, I&apos;m new here</Text>
              </Pressable>
            </Animated.View>
          )}

          {/* ---- Profile capture (new users only) ---- */}
          {key === "profile" && (
            <Animated.View key="profile" entering={SlideInRight.duration(420)} exiting={SlideOutLeft.duration(260)}>
              <Animated.Text entering={FadeIn.duration(500).delay(120)} style={{ fontSize: 76, marginBottom: 20 }}>👋</Animated.Text>
              <Text className="text-4xl font-bold text-dark-100 mb-3">Tell us a{"\n"}little about you</Text>
              <Text className="text-lg text-gray-500 mb-8">So we can personalise things. You can change these later.</Text>
              <View className="gap-4">
                <View>
                  <Text className="text-sm font-semibold text-dark-100 mb-2">Name</Text>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="Your name"
                    placeholderTextColor="#9CA3AF"
                    autoCapitalize="words"
                    className="px-5 py-4 rounded-2xl bg-gray-100 text-dark-100 text-lg"
                    style={{ paddingVertical: 16 }}
                  />
                </View>
                <View>
                  <Text className="text-sm font-semibold text-dark-100 mb-2">Email <Text className="text-gray-400 font-normal">(optional)</Text></Text>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    placeholder="your@email.com"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    className="px-5 py-4 rounded-2xl bg-gray-100 text-dark-100 text-lg"
                    style={{ paddingVertical: 16 }}
                  />
                </View>
              </View>
            </Animated.View>
          )}

          {/* ---- Budget setup ---- */}
          {key === "budget" && (
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
                  className="flex-1 py-4 text-dark-100 text-2xl font-bold"
                  style={{ paddingVertical: 16 }}
                />
              </View>
            </Animated.View>
          )}
        </ScrollView>

        {/* ---- Footer: progress dots + primary button ---- */}
        <View className="px-6 pb-4">
          <View className="flex-row items-center justify-center gap-2 mb-6">
            {steps.map((_, i) => (
              <View
                key={i}
                style={{ height: 8, width: i === idx ? 24 : 8, borderRadius: 4, backgroundColor: i === idx ? "#FE8C00" : "#E5E7EB" }}
              />
            ))}
          </View>

          {key !== "import" && (
            <Pressable
              onPress={onPrimary}
              disabled={primaryDisabled}
              className={`py-4 rounded-2xl flex-row items-center justify-center gap-2 ${primaryDisabled ? "bg-gray-300" : "bg-primary"} active:opacity-80`}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text className="text-white text-base font-bold">{primaryLabel}</Text>
                  <Feather name="arrow-right" size={18} color="#fff" />
                </>
              )}
            </Pressable>
          )}

          {key === "budget" && (
            <Pressable onPress={finish} disabled={busy} className="py-3 items-center">
              <Text className="text-gray-400 font-semibold">Set it up later</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
