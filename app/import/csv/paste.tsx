import { analyzeCSVWithAI, ColumnMapping, CSVAnalysisResult } from "@/lib/csvAIAnalyzer";
import { ParsedTransaction, SkippedRow } from "@/lib/csvParser";
import { processGenericCSV } from "@/lib/genericCsvParser";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// Temporary storage for parsed transactions (in-memory)
type ParsedCache = {
  transactions: ParsedTransaction[];
  parsedRows: number;
  totalRows: number;
  skippedRows: number;
  skippedDetails: SkippedRow[];
};

let parsedTransactionsCache: ParsedCache | null = null;

export function getParsedTransactions(): ParsedCache | null {
  return parsedTransactionsCache;
}

export function clearParsedTransactions() {
  parsedTransactionsCache = null;
}

type AnalysisStatus = 'idle' | 'reading' | 'anonymizing' | 'analyzing' | 'parsing' | 'done' | 'error';

export default function GenericCSVPasteScreen() {
  const { csvContent: sharedCsvContent } = useLocalSearchParams<{ csvContent?: string }>();
  const [csvContent, setCSVContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  const [analysisResult, setAnalysisResult] = useState<CSVAnalysisResult | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping | null>(null);
  const [hasAutoAnalyzed, setHasAutoAnalyzed] = useState(false);

  // Handle shared CSV content from other apps
  useEffect(() => {
    if (sharedCsvContent && !hasAutoAnalyzed) {
      setCSVContent(sharedCsvContent);
      setHasAutoAnalyzed(true);
      // Auto-trigger analysis for shared content
      setTimeout(() => {
        analyzeSharedContent(sharedCsvContent);
      }, 100);
    }
  }, [sharedCsvContent, hasAutoAnalyzed]);

  const analyzeSharedContent = async (content: string) => {
    // Reuse the analysis logic
    setLoading(true);
    setAnalysisStatus('anonymizing');
    setAnalysisResult(null);
    setColumnMapping(null);
    
    try {
      setAnalysisStatus('analyzing');
      const result = await analyzeCSVWithAI(content);
      setAnalysisResult(result);
      
      if (!result.isValidForImport || !result.mapping) {
        setAnalysisStatus('error');
        Alert.alert("Analysis Failed", result.suggestion || "Could not determine CSV structure");
        return;
      }
      
      setColumnMapping(result.mapping);
      setAnalysisStatus('parsing');
      
      const parseResult = await processGenericCSV(content, result.mapping);
      
      if (parseResult.transactions.length === 0) {
        setAnalysisStatus('error');
        Alert.alert("No Transactions", "No valid transactions found in the file");
        return;
      }
      
      parsedTransactionsCache = {
        transactions: parseResult.transactions,
        parsedRows: parseResult.transactions.length,
        totalRows: parseResult.parseResult.totalRows,
        skippedRows: parseResult.parseResult.skipped,
        skippedDetails: parseResult.parseResult.skippedDetails,
      };
      
      setAnalysisStatus('done');
    } catch (err) {
      console.error("Analysis error:", err);
      setAnalysisStatus('error');
      Alert.alert("Error", "Failed to analyze the CSV file");
    } finally {
      setLoading(false);
    }
  };

  const handlePaste = async () => {
    try {
      const content = await Clipboard.getStringAsync();
      if (!content) {
        Alert.alert("Error", "No text found in clipboard");
        return;
      }
      setCSVContent(content);
      setAnalysisResult(null);
      setColumnMapping(null);
      Alert.alert("Success", `Pasted ${content.split("\n").length} lines from clipboard`);
    } catch (err) {
      Alert.alert("Error", "Failed to paste from clipboard");
      console.error("Paste error:", err);
    }
  };

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/csv", "*/*"],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const file = result.assets[0];
      
      // Check file extension
      const fileName = file.name?.toLowerCase() || '';
      if (!fileName.endsWith('.csv') && !fileName.endsWith('.txt')) {
        Alert.alert(
          "File Type Warning",
          "This file doesn't appear to be a CSV. Would you like to try importing it anyway?",
          [
            { text: "Cancel", style: "cancel" },
            { 
              text: "Try Anyway", 
              onPress: async () => {
                await readAndSetFile(file.uri);
              }
            },
          ]
        );
        return;
      }

      await readAndSetFile(file.uri);
    } catch (err) {
      console.error("File picker error:", err);
      Alert.alert("Error", "Failed to pick file. Please try again.");
    }
  };

  const readAndSetFile = async (uri: string) => {
    try {
      const content = await FileSystem.readAsStringAsync(uri);
      setCSVContent(content);
      setAnalysisResult(null);
      setColumnMapping(null);
      Alert.alert("Success", `Loaded file with ${content.split("\n").length} lines`);
    } catch (err) {
      console.error("File read error:", err);
      Alert.alert("Error", "Failed to read file content");
    }
  };

  const handleAnalyze = async () => {
    if (!csvContent.trim()) {
      Alert.alert("Error", "Please paste or select a CSV file first");
      return;
    }

    setLoading(true);
    setAnalysisStatus('anonymizing');

    try {
      // Step 1: Show the user what we're doing (anonymizing)
      setAnalysisStatus('anonymizing');
      
      // Brief delay to show status
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Step 2: Analyze with AI (or heuristics)
      setAnalysisStatus('analyzing');
      const result = await analyzeCSVWithAI(csvContent);
      
      setAnalysisResult(result);
      
      if (result.isValidForImport && result.mapping) {
        setColumnMapping(result.mapping);
        setAnalysisStatus('done');
      } else {
        setAnalysisStatus('error');
        Alert.alert(
          "Cannot Import This CSV",
          result.suggestion || `Missing required columns: ${result.missingFields.join(', ')}`,
          [{ text: "OK" }]
        );
      }
    } catch (error) {
      console.error("Analysis error:", error);
      setAnalysisStatus('error');
      Alert.alert(
        "Analysis Failed",
        "Failed to analyze the CSV format. Please make sure your file has date, amount, and description columns.",
        [{ text: "OK" }]
      );
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    if (!columnMapping || !csvContent) {
      Alert.alert("Error", "Please analyze the CSV first");
      return;
    }

    setLoading(true);
    setAnalysisStatus('parsing');

    try {
      // Process the CSV using the detected mapping
      const { transactions, parseResult } = await processGenericCSV(csvContent, columnMapping);

      if (transactions.length === 0) {
        Alert.alert("Error", "No transactions found in the CSV data");
        setLoading(false);
        return;
      }

      // Extract the balance from the most recent transaction (if available)
      // Sort by date descending to find the most recent
      const sortedByDate = [...parseResult.transactions].sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      const mostRecentBalance = sortedByDate[0]?.balance;
      
      // Parse the balance to a number (it's stored as string)
      let latestBalance = "";
      if (mostRecentBalance) {
        const parsed = parseFloat(mostRecentBalance.replace(/[^0-9.-]/g, ''));
        if (!isNaN(parsed)) {
          latestBalance = parsed.toFixed(2);
        }
      }

      // Store in cache for account selection screen (without account info yet)
      parsedTransactionsCache = {
        transactions: transactions,
        parsedRows: parseResult.transactions.length,
        totalRows: parseResult.totalRows,
        skippedRows: parseResult.skipped,
        skippedDetails: parseResult.skippedDetails,
      };

      // Navigate to account selection (which will then go to preview)
      router.push({
        pathname: "/import/csv/select-account",
        params: {
          transactionCount: String(transactions.length),
          detectedBalance: latestBalance,
        },
      } as any);
    } catch (error) {
      console.error("Parse error:", error);
      Alert.alert(
        "Parse Failed",
        "Failed to parse the CSV file. Please check the format and try again.",
        [{ text: "OK" }]
      );
    } finally {
      setLoading(false);
      setAnalysisStatus('idle');
    }
  };

  const getStatusMessage = () => {
    switch (analysisStatus) {
      case 'anonymizing':
        return 'Preparing data structure (no personal data sent)...';
      case 'analyzing':
        return 'Analyzing column format...';
      case 'parsing':
        return 'Processing transactions...';
      case 'done':
        return 'Analysis complete!';
      case 'error':
        return 'Analysis failed';
      default:
        return '';
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="mb-6">
          <Pressable
            onPress={() => router.back()}
            className="mb-4 flex-row items-center gap-2"
          >
            <Text className="text-primary text-base">← Back</Text>
          </Pressable>
          <Text className="text-2xl font-bold text-dark-100">Import CSV</Text>
          <Text className="text-sm text-gray-500 mt-1">
            Paste CSV data or select a file from your device
          </Text>
        </View>

        {/* Privacy Notice */}
        <View className="mb-6 p-3 bg-emerald-50 rounded-xl flex-row items-center gap-3">
          <Feather name="shield" size={20} color="#10B981" />
          <Text className="text-xs text-emerald-700 flex-1">
            Your financial data never leaves your device. Only anonymized format info is analyzed.
          </Text>
        </View>

        {/* Import Options */}
        <View className="gap-3 mb-6">
          <Pressable
            onPress={handlePickFile}
            disabled={loading}
            className="border-2 border-dashed border-gray-300 rounded-2xl p-6 items-center justify-center bg-gray-50 active:bg-gray-100"
          >
            <Feather name="upload-cloud" size={32} color="#6B7280" />
            <Text className="text-base font-semibold text-gray-700 mt-2">Choose CSV File</Text>
            <Text className="text-xs text-gray-500 mt-1">Select from your device</Text>
          </Pressable>

          <View className="flex-row items-center gap-4 px-4">
            <View className="flex-1 h-px bg-gray-200" />
            <Text className="text-gray-400 text-sm">or</Text>
            <View className="flex-1 h-px bg-gray-200" />
          </View>

          <Pressable
            onPress={handlePaste}
            disabled={loading}
            className="border-2 border-gray-200 rounded-2xl p-4 flex-row items-center justify-center gap-2 bg-white active:bg-gray-50"
          >
            <Feather name="clipboard" size={20} color="#6B7280" />
            <Text className="text-base font-semibold text-gray-700">Paste from Clipboard</Text>
          </Pressable>
        </View>

        {/* CSV Content Preview */}
        {csvContent && (
          <View className="mb-6">
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-base font-bold text-dark-100">CSV Preview</Text>
              <View className="flex-row items-center gap-2">
                <Feather name="check-circle" size={16} color="#10B981" />
                <Text className="text-sm text-emerald-600">
                  {csvContent.split("\n").length} lines loaded
                </Text>
              </View>
            </View>
            <View className="bg-gray-50 rounded-xl p-3 max-h-32 overflow-hidden">
              <Text className="text-xs font-mono text-gray-600" numberOfLines={6}>
                {csvContent.slice(0, 500)}
                {csvContent.length > 500 ? "..." : ""}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setCSVContent("");
                setAnalysisResult(null);
                setColumnMapping(null);
              }}
              className="mt-2 self-end"
            >
              <Text className="text-sm text-red-500">Clear</Text>
            </Pressable>
          </View>
        )}

        {/* Analysis Status */}
        {loading && (
          <View className="mb-6 p-4 bg-blue-50 rounded-xl flex-row items-center gap-3">
            <ActivityIndicator size="small" color="#3B82F6" />
            <Text className="text-sm text-blue-700">{getStatusMessage()}</Text>
          </View>
        )}

        {/* Analysis Result */}
        {analysisResult && !loading && (
          <View className={`mb-6 p-4 rounded-xl ${analysisResult.isValidForImport ? 'bg-emerald-50' : 'bg-red-50'}`}>
            <View className="flex-row items-center gap-2 mb-3">
              <Feather 
                name={analysisResult.isValidForImport ? "check-circle" : "alert-circle"} 
                size={20} 
                color={analysisResult.isValidForImport ? "#10B981" : "#EF4444"} 
              />
              <Text className={`text-base font-bold ${analysisResult.isValidForImport ? 'text-emerald-800' : 'text-red-800'}`}>
                {analysisResult.isValidForImport ? 'Ready to Import' : 'Cannot Import'}
              </Text>
              <View className={`ml-auto px-2 py-1 rounded ${
                analysisResult.confidence === 'high' ? 'bg-emerald-100' :
                analysisResult.confidence === 'medium' ? 'bg-yellow-100' : 'bg-red-100'
              }`}>
                <Text className={`text-xs font-medium ${
                  analysisResult.confidence === 'high' ? 'text-emerald-700' :
                  analysisResult.confidence === 'medium' ? 'text-yellow-700' : 'text-red-700'
                }`}>
                  {analysisResult.confidence} confidence
                </Text>
              </View>
            </View>

            {/* Column Mapping */}
            {analysisResult.mapping && (
              <View className="mb-3">
                <Text className="text-sm font-semibold text-gray-700 mb-2">Detected Columns:</Text>
                <View className="flex-row flex-wrap gap-2">
                  {analysisResult.mapping.dateColumn >= 0 && (
                    <View className="px-2 py-1 bg-white rounded border border-gray-200">
                      <Text className="text-xs text-gray-600">📅 Date: Column {analysisResult.mapping.dateColumn + 1}</Text>
                    </View>
                  )}
                  {analysisResult.mapping.amountColumn >= 0 && (
                    <View className="px-2 py-1 bg-white rounded border border-gray-200">
                      <Text className="text-xs text-gray-600">💰 Amount: Column {analysisResult.mapping.amountColumn + 1}</Text>
                    </View>
                  )}
                  {analysisResult.mapping.descriptionColumn >= 0 && (
                    <View className="px-2 py-1 bg-white rounded border border-gray-200">
                      <Text className="text-xs text-gray-600">📝 Description: Column {analysisResult.mapping.descriptionColumn + 1}</Text>
                    </View>
                  )}
                  {analysisResult.mapping.debitColumn !== undefined && analysisResult.mapping.debitColumn >= 0 && (
                    <View className="px-2 py-1 bg-white rounded border border-gray-200">
                      <Text className="text-xs text-gray-600">📤 Debit: Column {analysisResult.mapping.debitColumn + 1}</Text>
                    </View>
                  )}
                  {analysisResult.mapping.creditColumn !== undefined && analysisResult.mapping.creditColumn >= 0 && (
                    <View className="px-2 py-1 bg-white rounded border border-gray-200">
                      <Text className="text-xs text-gray-600">📥 Credit: Column {analysisResult.mapping.creditColumn + 1}</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Warnings */}
            {analysisResult.warnings.length > 0 && (
              <View className="mb-2">
                {analysisResult.warnings.map((warning, index) => (
                  <View key={index} className="flex-row items-start gap-2">
                    <Feather name="alert-triangle" size={14} color="#F59E0B" />
                    <Text className="text-xs text-yellow-700 flex-1">{warning}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Missing Fields */}
            {analysisResult.missingFields.length > 0 && (
              <View>
                <Text className="text-xs text-red-700">
                  Missing: {analysisResult.missingFields.join(', ')}
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Bottom Actions */}
      <View className="absolute bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-100">
        {!analysisResult?.isValidForImport ? (
          <Pressable
            onPress={handleAnalyze}
            disabled={loading || !csvContent}
            className={`w-full py-4 rounded-2xl items-center ${
              loading || !csvContent ? 'bg-gray-300' : 'bg-primary active:opacity-80'
            }`}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <View className="flex-row items-center gap-2">
                <Feather name="cpu" size={18} color="white" />
                <Text className="text-white font-bold text-base">Analyze CSV Format</Text>
              </View>
            )}
          </Pressable>
        ) : (
          <View className="gap-3">
            <Pressable
              onPress={handleContinue}
              disabled={loading}
              className={`w-full py-4 rounded-2xl items-center ${
                loading ? 'bg-gray-300' : 'bg-emerald-500 active:opacity-80'
              }`}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <View className="flex-row items-center gap-2">
                  <Feather name="arrow-right" size={18} color="white" />
                  <Text className="text-white font-bold text-base">Continue to Preview</Text>
                </View>
              )}
            </Pressable>
            <Pressable
              onPress={() => {
                setAnalysisResult(null);
                setColumnMapping(null);
              }}
              className="w-full py-3 items-center"
            >
              <Text className="text-gray-500 font-medium">Re-analyze</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
