import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const TUTORIAL_STEPS = [
  {
    step: 1,
    title: "Open Revolut App",
    description: "Launch the Revolut mobile app on your device and log in to your account.",
  },
  {
    step: 2,
    title: "Go to Statements",
    description: "Tap on the Accounts tab, select your account, and choose 'Statement' or 'Export'.",
  },
  {
    step: 3,
    title: "Export as CSV",
    description: "Select the date range for your transactions and export as CSV format.",
  },
  {
    step: 4,
    title: "Share with Budget App",
    description: "When prompted to share the file, select 'Copy' or 'Share' and paste the data here.",
  },
  {
    step: 5,
    title: "Review & Confirm",
    description: "Review the imported transactions and confirm they look correct before saving.",
  },
];

export default function RevolutImportScreen() {
  const [openingApp, setOpeningApp] = useState(false);

  const openRevolutApp = async () => {
    setOpeningApp(true);
    try {
      // On iOS, canOpenURL can return false even if the app is installed
      // So we'll try opening directly without checking first
      const deepLinkSchemes = Platform.OS === "ios"
        ? [
            "revolut://",
            "revolut://app",
          ]
        : [
            "com.revolut.revolut://",
            "revolut://",
          ];
      
      let opened = false;
      let lastError = null;
      
      console.log(`Attempting to open Revolut on ${Platform.OS}...`);
      
      for (const scheme of deepLinkSchemes) {
        try {
          console.log(`Trying to open: ${scheme}`);
          await Linking.openURL(scheme);
          opened = true;
          console.log("Successfully opened Revolut");
          break;
        } catch (e) {
          lastError = e;
          console.error(`Failed with scheme ${scheme}:`, e);
          // Continue to next scheme
          continue;
        }
      }
      
      if (!opened) {
        console.error("Failed to open Revolut with any scheme", lastError);
        Alert.alert(
          "Revolut App Not Found",
          `Could not open the Revolut app. Please ensure Revolut is installed.\n\nPlatform: ${Platform.OS}\n\nTroubleshoot: Try manually opening Revolut from your home screen, then return to this app.`,
          [{ text: "OK" }]
        );
      }
    } catch (err) {
      console.error("Error opening Revolut:", err);
      Alert.alert(
        "Error",
        "Failed to open Revolut app. Please try again.",
        [{ text: "OK" }]
      );
    } finally {
      setOpeningApp(false);
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
            <View className="h-12 w-12 items-center justify-center rounded-xl bg-indigo-100">
              <Feather name="credit-card" size={24} color="#4F46E5" />
            </View>
            <View className="flex-1">
              <Text className="text-3xl font-bold text-dark-100">Revolut Import</Text>
              <Text className="text-sm text-gray-500">Step-by-step guide</Text>
            </View>
          </View>
        </View>

        {/* Important Warning */}
        <View className="rounded-xl bg-amber-50 border border-amber-200 p-4 mb-8">
          <Text className="text-xs font-semibold text-amber-900 mb-3">⚠️ Important: After Opening Revolut</Text>
          <View className="gap-2">
            <View className="flex-row gap-2">
              <Text className="text-amber-900">1.</Text>
              <Text className="text-sm text-amber-800 flex-1 font-semibold">Go to Accounts → Select account → Statements</Text>
            </View>
            <View className="flex-row gap-2">
              <Text className="text-amber-900">2.</Text>
              <Text className="text-sm text-amber-800 flex-1 font-semibold">Choose your date range</Text>
            </View>
            <View className="flex-row gap-2">
              <Text className="text-amber-900">3.</Text>
              <Text className="text-sm text-amber-800 flex-1 font-semibold">Tap Generate statement</Text>
            </View>
            <View className="flex-row gap-2">
              <Text className="text-amber-900">4.</Text>
              <Text className="text-sm text-amber-800 flex-1 font-semibold">Select CSV format → Get statement</Text>
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
              onPress={() => item.step === 1 && openRevolutApp()}
              disabled={item.step !== 1 || openingApp}
              className={`rounded-2xl border-2 p-4 flex-row gap-4 ${
                item.step === 1 
                  ? "border-primary bg-primary/5 active:bg-primary/10" 
                  : "border-gray-200 bg-white"
              }`}
            >
              <View className={`h-12 w-12 items-center justify-center rounded-full ${
                item.step === 1 ? "bg-primary" : "bg-primary"
              }`}>
                <Text className="text-lg font-bold text-white">{item.step}</Text>
              </View>
              <View className="flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="text-base font-semibold text-dark-100">{item.title}</Text>
                  {item.step === 1 && (
                    <Feather name="external-link" size={14} color="#667eea" />
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
            We never store your Revolut credentials. The import process only reads the CSV data
            you provide and stores it securely in your account.
          </Text>
        </View>
      </ScrollView>

      {/* Fixed Bottom Button */}
      <View className="absolute bottom-0 left-0 right-0 px-5 pb-6" style={{ 
        background: 'linear-gradient(to top, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 100%)'
      }}>
        <Pressable
          onPress={() => router.push("/import/revolut/paste")}
          className="rounded-2xl bg-primary py-4 items-center active:opacity-80 shadow-lg"
        >
          <Text className="text-white text-base font-bold">I have my export ready</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
