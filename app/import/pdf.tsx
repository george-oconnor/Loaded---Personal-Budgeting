import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

const TUTORIAL_STEPS = [
  {
    step: 1,
    title: "Get Your PDF Statement",
    description:
      "Download your bank statement PDF from your bank's website or app.",
  },
  {
    step: 2,
    title: "On-Device Text Extraction",
    description:
      "We extract text from the PDF entirely on your device using Apple's built-in technology. Nothing is uploaded.",
  },
  {
    step: 3,
    title: "Smart Table Detection",
    description:
      "Our system automatically finds the transaction table in your statement and identifies columns.",
  },
  {
    step: 4,
    title: "Privacy-First Analysis",
    description:
      "If needed, only anonymized structure info (column names, types) is sent for format analysis — never your real data.",
  },
  {
    step: 5,
    title: "Review & Confirm",
    description:
      "Preview extracted transactions before importing to ensure everything looks correct.",
  },
];

const SECURITY_POINTS = [
  {
    icon: "smartphone",
    title: "100% On-Device Processing",
    description:
      "Your PDF is read and text is extracted entirely on your iPhone using Apple PDFKit and Vision — no server involved.",
  },
  {
    icon: "shield",
    title: "No Financial Data Shared",
    description:
      "Transaction amounts, descriptions, and dates never leave your device. Only anonymized column structure may be analyzed.",
  },
  {
    icon: "eye-off",
    title: "Works with Scanned PDFs Too",
    description:
      "For image-based/scanned statements, Apple Vision OCR runs locally on your device for text recognition.",
  },
];

export default function PdfImportLandingScreen() {
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: 120,
        }}
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
            <View
              className="w-12 h-12 rounded-lg items-center justify-center"
              style={{ backgroundColor: "#8B5CF620" }}
            >
              <Feather name="file" size={24} color="#8B5CF6" />
            </View>
            <View>
              <Text className="text-2xl font-bold text-dark-100">
                Import PDF Statement
              </Text>
              <Text className="text-sm text-gray-500">
                On-device bank statement processing
              </Text>
            </View>
          </View>
        </View>

        {/* Security Section */}
        <View className="mb-8 p-4 bg-violet-50 rounded-2xl border border-violet-100">
          <View className="flex-row items-center gap-2 mb-3">
            <Feather name="shield" size={20} color="#8B5CF6" />
            <Text className="text-base font-bold text-violet-800">
              100% On-Device Privacy
            </Text>
          </View>
          <View className="gap-3">
            {SECURITY_POINTS.map((point, index) => (
              <View key={index} className="flex-row items-start gap-3">
                <View className="w-8 h-8 rounded-full bg-violet-100 items-center justify-center mt-0.5">
                  <Feather name={point.icon as any} size={14} color="#8B5CF6" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-violet-800">
                    {point.title}
                  </Text>
                  <Text className="text-xs text-violet-700 mt-0.5">
                    {point.description}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* How it works */}
        <View className="mb-8">
          <Text className="text-lg font-bold text-dark-100 mb-4">
            How it Works
          </Text>
          <View className="gap-4">
            {TUTORIAL_STEPS.map((step) => (
              <View key={step.step} className="flex-row items-start gap-4">
                <View className="w-8 h-8 rounded-full bg-violet-100 items-center justify-center">
                  <Text className="text-violet-600 font-bold text-sm">
                    {step.step}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-base font-semibold text-dark-100">
                    {step.title}
                  </Text>
                  <Text className="text-sm text-gray-500 mt-1">
                    {step.description}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Supported Formats */}
        <View className="mb-8 p-4 bg-gray-50 rounded-2xl">
          <Text className="text-base font-bold text-dark-100 mb-2">
            Supported Statement Types
          </Text>
          <Text className="text-sm text-gray-600 mb-3">
            Works with most bank statement PDFs, including:
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {[
              "Digital PDFs",
              "Scanned Statements",
              "Bank Exports",
              "Monthly Statements",
            ].map((format) => (
              <View
                key={format}
                className="px-3 py-1.5 bg-white rounded-full border border-gray-200"
              >
                <Text className="text-xs font-medium text-gray-700">
                  {format}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Bottom CTA */}
      <View
        className="absolute bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-100"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <Pressable
          onPress={() => router.push("/import/pdf/pick" as any)}
          className="w-full bg-violet-500 py-4 rounded-2xl items-center active:opacity-80"
        >
          <View className="flex-row items-center gap-2">
            <Feather name="upload" size={18} color="white" />
            <Text className="text-white font-bold text-base">
              Select PDF File
            </Text>
          </View>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
