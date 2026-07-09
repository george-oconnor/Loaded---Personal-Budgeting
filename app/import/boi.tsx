import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const BOI_COLOR = "#0D9488";

const TUTORIAL_STEPS = [
  {
    step: 1,
    title: "Sign in to Bank of Ireland",
    description: "Open Banking 365 Online and log in to your account.",
  },
  {
    step: 2,
    title: "Open your account transactions",
    description: "Select the account you want to import and view its transactions.",
  },
  {
    step: 3,
    title: "Choose a date range",
    description: "Set the period you want to export.",
  },
  {
    step: 4,
    title: "Download as CSV/Spreadsheet",
    description: "Use \"Export\" / \"Download\" and save the CSV file to Files.",
  },
  {
    step: 5,
    title: "Import & Review",
    description: "Come back, pick the CSV on the next screen, choose your Bank of Ireland account, and confirm.",
  },
];

export default function BoiImportScreen() {
  const [opening, setOpening] = useState(false);

  const openBoiSite = async () => {
    setOpening(true);
    try {
      await Linking.openURL("https://www.bankofireland.com/");
    } catch {
      Alert.alert("Error", "Could not open Bank of Ireland. Please open it manually.");
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
          <Pressable onPress={() => router.back()} className="mb-6 flex-row items-center gap-2">
            <Text className="text-primary text-base">← Back</Text>
          </Pressable>
          <View className="flex-row items-center gap-3 mb-2">
            <View className="h-12 w-12 items-center justify-center rounded-xl" style={{ backgroundColor: `${BOI_COLOR}20` }}>
              <Feather name="home" size={24} color={BOI_COLOR} />
            </View>
            <View className="flex-1">
              <Text className="text-3xl font-bold text-dark-100">Bank of Ireland</Text>
              <Text className="text-sm text-gray-500">Step-by-step guide</Text>
            </View>
          </View>
        </View>

        {/* Important Warning */}
        <View className="rounded-xl bg-amber-50 border border-amber-200 p-4 mb-8">
          <Text className="text-xs font-semibold text-amber-900 mb-3">⚠️ Important: After Signing In</Text>
          <View className="gap-2">
            {["Go to your account transactions", "Set your date range", "Click Export → CSV", "Save the file to Files", "Return to this app to import"].map((t, i) => (
              <View key={i} className="flex-row gap-2">
                <Text className="text-amber-900">{i + 1}.</Text>
                <Text className="text-sm text-amber-800 flex-1 font-semibold">{t}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Tutorial Steps */}
        <View className="gap-4 mb-8">
          {TUTORIAL_STEPS.map((item) => (
            <Pressable
              key={item.step}
              onPress={() => item.step === 1 && openBoiSite()}
              disabled={item.step !== 1 || opening}
              className={`rounded-2xl border-2 p-4 flex-row gap-4 ${item.step === 1 ? "border-teal-500 bg-teal-50 active:bg-teal-100" : "border-gray-200 bg-white"}`}
            >
              <View className="h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: BOI_COLOR }}>
                <Text className="text-lg font-bold text-white">{item.step}</Text>
              </View>
              <View className="flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="text-base font-semibold text-dark-100">{item.title}</Text>
                  {item.step === 1 && <Feather name="external-link" size={14} color={BOI_COLOR} />}
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
            We never store your Bank of Ireland credentials. The import reads only the CSV data you provide and stores it securely in your account.
          </Text>
        </View>
      </ScrollView>

      {/* Fixed Bottom Button — funnels into the AI CSV importer */}
      <View className="absolute bottom-0 left-0 right-0 px-5 pb-6" style={{ backgroundColor: "rgba(255,255,255,0.95)" }}>
        <Pressable
          onPress={() => router.push("/import/csv/paste" as any)}
          className="rounded-2xl py-4 items-center active:opacity-80 shadow-lg"
          style={{ backgroundColor: BOI_COLOR }}
        >
          <Text className="text-white text-base font-bold">I have my Bank of Ireland CSV</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
