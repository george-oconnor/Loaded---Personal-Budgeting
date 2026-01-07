import { batchCategorizeTransactions } from "@/lib/categorization";
import {
    AibParseResult,
    parseAibCSV,
    ParsedTransaction,
    SkippedRow
} from "@/lib/csvParser";
import { useSessionStore } from "@/store/useSessionStore";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
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
  finalBalance?: number; // Final balance from AIB CSV in cents
  currency?: string; // Currency of the transactions
};

let parsedTransactionsCache: ParsedCache | null = null;

export function getParsedTransactions(): ParsedCache | null {
  return parsedTransactionsCache;
}

export function clearParsedTransactions() {
  parsedTransactionsCache = null;
}

export default function AibImportPasteScreen() {
  const params = useLocalSearchParams<{ csvContent?: string }>();
  const [csvContent, setCSVContent] = useState("");
  const [loading, setLoading] = useState(false);
  const { user } = useSessionStore();

  // If CSV content was passed as a parameter, set it automatically
  useEffect(() => {
    if (params.csvContent) {
      setCSVContent(params.csvContent);
    }
  }, [params.csvContent]);

  // Robust AIB date parser: supports DD/MM/YYYY and DD/MM/YY
  const parseAibDate = (raw: string | undefined): Date => {
    if (!raw) return new Date(NaN);
    const trimmed = raw.trim();
    const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const day = parseInt(m[1], 10);
      const month = parseInt(m[2], 10) - 1;
      const y = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
      // Use UTC midnight to avoid TZ ordering issues
      const d = new Date(Date.UTC(y, month, day, 0, 0, 0));
      return d;
    }
    // Fallback: let Date try to parse
    const normalized = trimmed.replace(' ', 'T');
    return new Date(normalized);
  };

  const handlePaste = async () => {
    try {
      const content = await Clipboard.getStringAsync();
      if (!content) {
        Alert.alert("Error", "No text found in clipboard");
        return;
      }
      setCSVContent(content);
      Alert.alert("Success", `Pasted ${content.split("\n").length} lines from clipboard`);
    } catch (err) {
      Alert.alert("Error", "Failed to paste from clipboard");
      console.error("Paste error:", err);
    }
  };

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/plain", "application/vnd.ms-excel"],
        copyToCacheDirectory: true,
      });
      
      if (result.canceled) {
        console.log("File picker was canceled");
        return;
      }
      
      if (!result.assets || result.assets.length === 0) {
        console.log("No file selected");
        return;
      }
      
      const asset = result.assets[0];
      if (!asset.uri) {
        Alert.alert("Error", "No file URI found");
        return;
      }
      
      const content = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'utf8' });
      setCSVContent(content);
      Alert.alert("Success", `Loaded ${content.split("\n").length} lines from ${asset.name || "file"}`);
    } catch (err) {
      Alert.alert("Error", "Failed to read CSV file");
      console.error("File pick error:", err);
    }
  };

  const handleContinue = async () => {
    if (!csvContent.trim()) {
      Alert.alert("Error", "Please paste the CSV data from AIB");
      return;
    }

    setLoading(true);
    try {
      console.log('=== AIB CSV Processing Started ===');
      const startTotal = Date.now();

      console.log('Step 1: Parsing CSV...');
      const parseStart = Date.now();
      const transactions = parseAibCSV(csvContent);
      const parseResult: AibParseResult = transactions;
      console.log(`Step 1 complete: Parsed ${parseResult.transactions.length} transactions in ${Date.now() - parseStart}ms`);

      if (parseResult.transactions.length === 0) {
        Alert.alert("Error", "No transactions found in the CSV data");
        setLoading(false);
        return;
      }

      // Sort raw AIB transactions by parsed date to identify the most recent correctly
      console.log('Step 2: Sorting by date...');
      const sortStart = Date.now();
      const sortedByDate = [...parseResult.transactions].sort((a, b) => {
        const ta = parseAibDate(a.date).getTime();
        const tb = parseAibDate(b.date).getTime();
        return ta - tb;
      });
      console.log(`Step 2 complete: Sorted in ${Date.now() - sortStart}ms`);

      console.log('Step 3: Converting transactions...');
      const convertStart = Date.now();
      
      // Batch categorize all transactions at once (single DB call)
      const categorizationStart = Date.now();
      const categoryIds = await batchCategorizeTransactions(
        parseResult.transactions.map(aib => ({
          title: aib.description || '',
          subtitle: aib.product || 'AIB',
          kind: aib.amount < 0 ? 'expense' as const : 'income' as const
        }))
      );
      console.log(`  Categorization complete in ${Date.now() - categorizationStart}ms`);
      
      // Convert transactions synchronously with pre-fetched categories
      const conversionStart = Date.now();
      const convertedTransactions: ParsedTransaction[] = parseResult.transactions.map((aib, idx) => {
        const isExpense = aib.amount < 0;
        const amountInCents = Math.round(Math.abs(aib.amount) * 100);

        let date = new Date(NaN);
        if (aib.date) {
          date = parseAibDate(aib.date);
        }
        
        if (isNaN(date.getTime())) {
          console.warn('Failed to parse AIB date:', aib.date, '- using current date as fallback');
          date = new Date();
        }

        const title = aib.description || (isExpense ? 'Expense' : 'Income');
        const subtitle = aib.product || 'AIB';

        // Clean up displayName by removing AIB-specific prefixes (repeatedly)
        let cleanDisplayName = title;
        let previousDisplayName = '';
        while (cleanDisplayName !== previousDisplayName) {
          previousDisplayName = cleanDisplayName;
          cleanDisplayName = cleanDisplayName
            .replace(/^TST-\s*/i, '')
            .replace(/^D\/D\s*/i, '')
            .replace(/^VDP-\s*/i, '')
            .replace(/^VDC-\s*/i, '')
            .trim();
        }
        // Remove masked card numbers and trailing asterisks
        cleanDisplayName = cleanDisplayName
          .replace(/\*{2}\d{4}\s*/g, '')
          .replace(/\*+$/, '')
          .trim();

        return {
          title,
          subtitle,
          amount: amountInCents,
          kind: isExpense ? 'expense' : 'income',
          date: date.toISOString(),
          categoryId: categoryIds[idx],
          currency: aib.currency || 'EUR',
          displayName: cleanDisplayName || title,
        };
      });
      console.log(`  Conversion complete in ${Date.now() - conversionStart}ms`);
      console.log(`Step 3 complete: Converted ${convertedTransactions.length} transactions in ${Date.now() - convertStart}ms`);

      // Extract final balance from the most recent transaction that contains a balance
      // Also take the currency from that same row (fallback to EUR)
      console.log('Step 4: Extracting balance...');
      const balanceStart = Date.now();
      let finalBalanceCents: number | undefined = undefined;
      let currency: string = 'EUR';
      for (let i = sortedByDate.length - 1; i >= 0; i--) {
        const tx = sortedByDate[i];
        const balStr = (tx.balance || '').toString().trim();
        if (balStr.length > 0) {
          const parsed = parseFloat(balStr.replace(/,/g, ''));
          if (!Number.isNaN(parsed)) {
            finalBalanceCents = Math.round(parsed * 100);
            currency = tx.currency || currency;
            break;
          }
        }
        if (!currency && tx.currency) {
          currency = tx.currency;
        }
      }
      console.log(`Step 4 complete: Balance extraction in ${Date.now() - balanceStart}ms`);

      console.log('Step 5: Caching transactions...');
      const cacheStart = Date.now();
      parsedTransactionsCache = {
        transactions: convertedTransactions,
        parsedRows: parseResult.transactions.length,
        totalRows: parseResult.totalRows,
        skippedRows: parseResult.skipped,
        skippedDetails: parseResult.skippedDetails,
        finalBalance: finalBalanceCents,
        currency,
      };
      console.log(`Step 5 complete: Cached in ${Date.now() - cacheStart}ms`);

      console.log('Step 6: Navigating to select-account...');
      const navStart = Date.now();
      router.push({
        pathname: "/import/aib/select-account" as any,
        params: { transactionCount: parseResult.transactions.length },
      });
      console.log(`Step 6 complete: Navigation triggered in ${Date.now() - navStart}ms`);
      console.log(`=== Total processing time: ${Date.now() - startTotal}ms ===`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to parse CSV";
      Alert.alert("Parse Error", errorMsg);
      console.error("CSV parse error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 20 }}
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
          <Text className="text-3xl font-bold text-dark-100">Upload AIB CSV</Text>
          <Text className="text-sm text-gray-500 mt-2">
            Select the CSV file you exported from AIB online banking
          </Text>
        </View>

        {/* Instructions */}
        <View className="rounded-xl bg-blue-50 border border-blue-200 p-4 mb-6">
          <Text className="text-xs font-semibold text-blue-900 mb-2">📝 How to Export</Text>
          <Text className="text-xs text-blue-800 leading-5 mb-2">
            In AIB: Accounts → Select Account → Statements/Download → Choose Date Range → CSV
          </Text>
          <Text className="text-xs text-blue-700 font-semibold">
            Download the file, then tap "Upload CSV" below
          </Text>
        </View>

        {/* File Upload Button */}
        <Pressable
          onPress={handlePickFile}
          disabled={loading}
          className="rounded-xl bg-white border-2 border-sky-500 p-6 mb-6 active:opacity-80"
        >
          <View className="items-center gap-3">
            <View className="w-16 h-16 rounded-full bg-sky-100 items-center justify-center">
              <Feather name="upload" size={28} color="#0EA5E9" />
            </View>
            <Text className="text-base font-bold text-sky-600">Upload CSV File</Text>
            <Text className="text-xs text-gray-500 text-center">
              Select the AIB CSV file from your device
            </Text>
          </View>
        </Pressable>

        {/* Status Info */}
        {csvContent.trim() && (
          <View className="rounded-lg bg-green-50 border border-green-200 p-4 mb-6">
            <View className="flex-row items-center gap-2 mb-1">
              <Feather name="check-circle" size={16} color="#10B981" />
              <Text className="text-sm font-semibold text-green-900">CSV Data Ready</Text>
            </View>
            <Text className="text-xs text-green-700">
              {csvContent.split("\n").length} lines • Ready to import approximately {Math.max(0, csvContent.split("\n").length - 1)} transactions
            </Text>
          </View>
        )}

        {/* Preview Info */}
        {csvContent.trim() && (
          <View className="rounded-lg bg-gray-50 p-3 mb-6">
            <Text className="text-xs text-gray-600">
              {`Detected ~${Math.max(0, csvContent.split("\n").length - 1)} transaction lines (excluding header)`}
            </Text>
          </View>
        )}

        {/* Action Buttons */}
        <View className="gap-3">
          <Pressable
            onPress={handleContinue}
            disabled={loading || !csvContent.trim()}
            className={`rounded-2xl py-4 items-center ${
              loading || !csvContent.trim() ? "bg-gray-300" : "bg-sky-500"
            }`}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white text-base font-bold">Review Transactions</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => router.back()}
            disabled={loading}
            className="rounded-2xl border-2 border-gray-200 py-4 items-center bg-white"
          >
            <Text className="text-gray-700 text-base font-semibold">Cancel</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
