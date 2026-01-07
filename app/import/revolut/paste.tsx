import { resolveAccountInfo, updateAccountBalance, upsertBalanceRemote } from "@/lib/accountBalances";
import {
    convertRevolutToAppTransaction,
    markTransfers,
    ParsedTransaction,
    parseRevolutCSV,
    RevolutParseResult,
    SkippedRow,
} from "@/lib/csvParser";
import { useSessionStore } from "@/store/useSessionStore";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
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

export default function RevolutImportPasteScreen() {
  const params = useLocalSearchParams<{ csvContent?: string }>();
  const [csvContent, setCSVContent] = useState("");
  const [loading, setLoading] = useState(false);
  const { user } = useSessionStore();
  const autoProcessTriggered = React.useRef(false);

  // If CSV content was passed as a parameter, set it and auto-proceed to preview
  useEffect(() => {
    if (params.csvContent && !autoProcessTriggered.current) {
      autoProcessTriggered.current = true;
      setCSVContent(params.csvContent);
    }
  }, [params.csvContent]);

  // Auto-proceed to preview when CSV content is set via share (not manual paste)
  useEffect(() => {
    if (csvContent && autoProcessTriggered.current && !loading) {
      // Small delay to ensure state is settled, then auto-process
      const timer = setTimeout(() => {
        handleContinue();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [csvContent]);

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

  const handleContinue = async () => {
    if (!csvContent.trim()) {
      Alert.alert("Error", "Please paste the CSV data from Revolut");
      return;
    }

    setLoading(true);
    try {
      // Parse the CSV
      const transactions = parseRevolutCSV(csvContent);
      const parseResult: RevolutParseResult = transactions;
      console.log(`Parsed ${parseResult.transactions.length} transactions from CSV`);

      if (parseResult.transactions.length === 0) {
        Alert.alert("Error", "No transactions found in the CSV data");
        setLoading(false);
        return;
      }

      // Build hints for account resolution (used for both balance parsing and transaction conversion)
      const lastVaultNameByCurrency = new Map<string, string>();
      const lastPocketNameByCurrency = new Map<string, string>();
      
      for (const transaction of parseResult.transactions) {
        if (!transaction.state || transaction.state.toUpperCase() !== 'COMPLETED') continue;
        const productLower = transaction.product?.toLowerCase();
        const currency = transaction.currency || 'EUR';
        
        if (productLower === 'savings') {
          const vaultMatch = transaction.description.match(/To pocket (?:EUR|GBP|USD)\s+(.+?)\s+from (?:EUR|GBP|USD)/i);
          if (vaultMatch && vaultMatch[1]) {
            lastVaultNameByCurrency.set(currency, vaultMatch[1].trim());
          }
        } else if (productLower === 'pocket') {
          const pocketMatch = transaction.description.match(/To pocket (?:EUR|GBP|USD)\s+(.+?)\s+from (?:EUR|GBP|USD)/i);
          if (pocketMatch && pocketMatch[1]) {
            lastPocketNameByCurrency.set(currency, pocketMatch[1].trim());
          }
        }
      }

      // Convert to app format (async for categorization)
      const convertedTransactions = await Promise.all(
        parseResult.transactions.map(async (tx) => {
          const converted = await convertRevolutToAppTransaction(tx);
          // Resolve account name using the same logic as balance parsing

          const currency = tx.currency || 'EUR';
          const pocketNameHint = lastPocketNameByCurrency.get(currency);
          const vaultNameHint = lastVaultNameByCurrency.get(currency);
          const accountInfo = resolveAccountInfo({
            description: tx.description,
            product: tx.product,
            currency,
            provider: 'revolut',
            pocketNameHint,
            vaultNameHint,
          });
          return {
            ...converted,
            account: accountInfo.accountName,
          };
        })
      );

      // Detect and mark transfer pairs (account transfers with matching debit/credit)
      const transactionsWithTransfers = await markTransfers(convertedTransactions);

      // Extract and save the latest balance for each account (keyed by accountKey)
      const accountBalances = new Map<
        string,
        {
          accountName: string;
          accountType: string;
          provider: string;
          currency: string;
          balance: number;
          accountKey: string;
          lastDateISO: string;
        }
      >();

      if (parseResult.transactions.length > 0) {
        // FIRST PASS: Process completed transactions to establish final balances
        for (const transaction of parseResult.transactions) {
          if (!transaction.balance) continue;
          if (transaction.state && transaction.state.toUpperCase() !== 'COMPLETED') continue;

          const currency = transaction.currency || 'EUR';
          let vaultNameHint: string | undefined;
          let pocketNameHint: string | undefined;

          const productLower = transaction.product?.toLowerCase();

          if (productLower === 'savings') {
            const vaultMatch = transaction.description.match(/To pocket (?:EUR|GBP|USD)\s+(.+?)\s+from (?:EUR|GBP|USD)/i);
            if (vaultMatch && vaultMatch[1]) {
              lastVaultNameByCurrency.set(currency, vaultMatch[1].trim());
            } else if (transaction.description?.toLowerCase() === 'pocket withdrawal') {
              vaultNameHint = lastVaultNameByCurrency.get(currency);
            }
          } else if (productLower === 'pocket') {
            const pocketMatch = transaction.description.match(/To pocket (?:EUR|GBP|USD)\s+(.+?)\s+from (?:EUR|GBP|USD)/i);
            if (pocketMatch && pocketMatch[1]) {
              lastPocketNameByCurrency.set(currency, pocketMatch[1].trim());
            } else {
              pocketNameHint = lastPocketNameByCurrency.get(currency);
            }
          }

          const accountInfo = resolveAccountInfo({
            description: transaction.description,
            product: transaction.product,
            currency,
            provider: 'revolut',
            pocketNameHint,
            vaultNameHint,
          });

          const balanceAmount = parseFloat(transaction.balance);
          if (isNaN(balanceAmount)) continue;

          const balanceInCents = Math.round(balanceAmount * 100);
          const txnDateISO = ((transaction.completedDate || transaction.startedDate)?.replace(' ', 'T')) || new Date().toISOString();

          const existing = accountBalances.get(accountInfo.accountKey);
          if (!existing || new Date(txnDateISO).getTime() > new Date(existing.lastDateISO).getTime()) {
            accountBalances.set(accountInfo.accountKey, {
              ...accountInfo,
              balance: balanceInCents,
              lastDateISO: txnDateISO,
            });
          }
        }

        // SECOND PASS: Accumulate pending transaction amounts per account
        const pendingAdjustments = new Map<string, number>();
        for (const transaction of parseResult.transactions) {
          if (!transaction.state || transaction.state.toUpperCase() !== 'PENDING') continue;

          const currency = transaction.currency || 'EUR';
          const amount = transaction.amount || 0;
          if (isNaN(amount)) continue;

          const vaultNameHint = lastVaultNameByCurrency.get(currency);
          const pocketNameHint = lastPocketNameByCurrency.get(currency);

          const accountInfo = resolveAccountInfo({
            description: transaction.description,
            product: transaction.product,
            currency,
            provider: 'revolut',
            pocketNameHint,
            vaultNameHint,
          });

          const pendingInCents = Math.round(amount * 100);
          const current = pendingAdjustments.get(accountInfo.accountKey) || 0;
          pendingAdjustments.set(accountInfo.accountKey, current + pendingInCents);
        }

        // Apply pending adjustments to final balances
        for (const [accountKey, adjustment] of pendingAdjustments) {
          const existing = accountBalances.get(accountKey);
          if (existing) {
            existing.balance += adjustment;
          }
        }

        // Save all account balances locally and remotely (if signed in)
        const importTime = new Date().toISOString(); // Use actual import time, not transaction date
        for (const [, { accountName, accountType, provider, currency, balance, accountKey }] of accountBalances) {
          await updateAccountBalance(accountName, balance, currency, {
            accountKey,
            accountType,
            provider,
            lastUpdated: importTime,
            userId: user?.id,
          });
          if (user?.id) {
            await upsertBalanceRemote(user.id, { accountKey, accountName, accountType, provider, currency }, balance, importTime);
          }
        }
      }

      // Store in cache instead of passing through params
      parsedTransactionsCache = {
        transactions: transactionsWithTransfers,
        parsedRows: parseResult.transactions.length,
        totalRows: parseResult.totalRows,
        skippedRows: parseResult.skipped,
        skippedDetails: parseResult.skippedDetails,
      };

      // Navigate to preview screen
      router.push("/import/revolut/preview");
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
          <Text className="text-3xl font-bold text-dark-100">Paste CSV Data</Text>
          <Text className="text-sm text-gray-500 mt-2">
            Copy the CSV from Revolut and paste it below
          </Text>
        </View>

        {/* Instructions */}
        <View className="rounded-xl bg-blue-50 border border-blue-200 p-4 mb-6">
          <Text className="text-xs font-semibold text-blue-900 mb-2">📝 How to Export</Text>
          <Text className="text-xs text-blue-800 leading-5 mb-2">
            In Revolut: Accounts → Select Account → Statement → Choose Date Range → Copy CSV
          </Text>
          <Text className="text-xs text-blue-700 font-semibold">
            Then tap the "Paste CSV" button below
          </Text>
        </View>

        {/* Paste Button */}
        <Pressable
          onPress={handlePaste}
          disabled={loading}
          className="rounded-xl bg-white border-2 border-primary p-6 mb-6 active:opacity-80"
        >
          <View className="items-center gap-3">
            <View className="w-16 h-16 rounded-full bg-primary/10 items-center justify-center">
              <Feather name="clipboard" size={28} color="#7C3AED" />
            </View>
            <Text className="text-base font-bold text-primary">Paste CSV from Clipboard</Text>
            <Text className="text-xs text-gray-500 text-center">
              Copy CSV from Revolut, then tap here to paste
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
              {csvContent.split("\n").length} lines • Ready to import approximately{" "}
              {Math.max(0, csvContent.split("\n").length - 1)} transactions
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
              loading || !csvContent.trim() ? "bg-gray-300" : "bg-primary"
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
