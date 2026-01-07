import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const TUTORIAL_STEPS = [
  {
    step: 1,
    title: "Sign in to AIB",
    description: "Open AIB Internet Banking and log in.",
  },
  {
    step: 2,
    title: "Set Parameters",
    description: "Choose your account, select Historical, click Search and set your desired date range.",
  },
  {
    step: 3,
    title: "Export then Save, Share or copy the CSV",
    description: "Then export as CSV and save the CSV to Files.",
  },
  {
    step: 4,
    title: "Import into Budget App",
    description: "Come back and select or paste the CSV on the next screen.",
  },
  {
    step: 5,
    title: "Review & Confirm",
    description: "Review the imported transactions and confirm they look correct before saving.",
  },
];

export default function AibImportScreen() {
  const [opening, setOpening] = useState(false);

  const openAibSite = async () => {
    setOpening(true);
    try {
      const url = Platform.OS === "ios"
        ? "https://aib.ie/internetbanking"
        : "https://aib.ie/internetbanking";
      await Linking.openURL(url);
    } catch (err) {
      Alert.alert("Error", "Could not open AIB. Please open it manually.");
    } finally {
      setOpening(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="mb-8">
          <Pressable
            onPress={() => router.back()}
            className="mb-6 flex-row items-center gap-2"
          >
            <Text className="text-primary text-base">← Back</Text>
          </Pressable>
          <View className="flex-row items-center gap-3 mb-2">
            <View className="h-12 w-12 items-center justify-center rounded-xl bg-sky-100">
              <Feather name="briefcase" size={24} color="#0EA5E9" />
            </View>
            <View className="flex-1">
              <Text className="text-3xl font-bold text-dark-100">AIB Import</Text>
              <Text className="text-sm text-gray-500">Step-by-step guide</Text>
            </View>
          </View>
        </View>

        {/* Important Warning */}
        <View className="rounded-xl bg-amber-50 border border-amber-200 p-4 mb-8">
          <Text className="text-xs font-semibold text-amber-900 mb-3">⚠️ Important: After Signing In</Text>
          <View className="gap-2">
            <View className="flex-row gap-2">
              <Text className="text-amber-900">1.</Text>
              <Text className="text-sm text-amber-800 flex-1 font-semibold">Go to your account transactions</Text>
            </View>
            <View className="flex-row gap-2">
              <Text className="text-amber-900">2.</Text>
              <Text className="text-sm text-amber-800 flex-1 font-semibold">Set your date range</Text>
            </View>
            <View className="flex-row gap-2">
              <Text className="text-amber-900">3.</Text>
              <Text className="text-sm text-amber-800 flex-1 font-semibold">Click Export → CSV</Text>
            </View>
            <View className="flex-row gap-2">
              <Text className="text-amber-900">4.</Text>
              <Text className="text-sm text-amber-800 flex-1 font-semibold">Download the file</Text>
            </View>
            <View className="flex-row gap-2">
              <Text className="text-amber-900">5.</Text>
              <Text className="text-sm text-amber-800 flex-1 font-semibold">Return to this app to import</Text>
            </View>
          </View>
        </View>

        {/* Tutorial Steps */}
        <View className="gap-4 mb-8">
          {TUTORIAL_STEPS.map((item) => (
            <Pressable
              key={item.step}
              onPress={() => item.step === 1 && openAibSite()}
              disabled={item.step !== 1 || opening}
              className={`rounded-2xl border-2 p-4 flex-row gap-4 ${
                item.step === 1 
                  ? "border-sky-500 bg-sky-50 active:bg-sky-100" 
                  : "border-gray-200 bg-white"
              }`}
            >
              <View className={`h-12 w-12 items-center justify-center rounded-full ${
                item.step === 1 ? "bg-sky-500" : "bg-sky-500"
              }`}>
                <Text className="text-lg font-bold text-white">{item.step}</Text>
              </View>
              <View className="flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="text-base font-semibold text-dark-100">{item.title}</Text>
                  {item.step === 1 && (
                    <Feather name="external-link" size={14} color="#0EA5E9" />
                  )}
                </View>
                <Text className="text-sm text-gray-600 mt-1">{item.description}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        {/* Info Box */}
        <View className="rounded-xl bg-blue-50 border border-blue-200 p-4">
          <Text className="text-xs font-semibold text-blue-900 mb-2">🔒 Your Data is Safe</Text>
          <Text className="text-xs text-blue-800 leading-5">
            We never store your AIB credentials. The import reads only the CSV data you provide and stores it securely in your account.
          </Text>
        </View>
      </ScrollView>

      {/* Fixed Bottom Button */}
      <View className="absolute bottom-0 left-0 right-0 px-5 pb-6" style={{ backgroundColor: "rgba(255,255,255,0.95)" }}>
        <Pressable
          onPress={() => router.push("/import/aib/paste" as any)}
          className="rounded-2xl bg-sky-500 py-4 items-center active:opacity-80 shadow-lg"
        >
          <Text className="text-white text-base font-bold">I have my AIB CSV</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
