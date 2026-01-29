import { saveBalanceSnapshot } from "@/lib/accountBalances";
import { getAllTransactionsForUser, updateTransaction } from "@/lib/appwrite";
import { getTransferCategoryId } from "@/lib/categorization";
import { detectTransferPairs, ParsedTransaction } from "@/lib/csvParser";
import { saveLastImportDate } from "@/lib/notifications";
import { queueTransactionsForSync } from "@/lib/syncQueue";
import { useHomeStore } from "@/store/useHomeStore";
import { useSessionStore } from "@/store/useSessionStore";
import { Feather } from "@expo/vector-icons";
import { ID } from "appwrite";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Pressable,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { clearParsedTransactions, getParsedTransactions } from "./paste";

interface Transaction {
  title: string;
  subtitle: string;
  amount: number;
  kind: "income" | "expense";
  date: string;
  categoryId: string;
  currency: string;
  excludeFromAnalytics?: boolean;
  isAnalyticsProtected?: boolean;
  account?: string;
}

// Helpers for robust deduping
const normalizeText = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
const normalizeDateForKey = (value: string) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return (value || "").trim();
  return d.toISOString().split('T')[0];
};
const makeKeyFromTransaction = (t: Transaction) =>
  `${normalizeText(t.title)}|${Math.abs(t.amount)}|${t.kind}|${normalizeDateForKey(t.date)}`;
const makeKeyFromDoc = (doc: any) =>
  `${normalizeText(doc.title || "")}|${Math.abs(Number(doc.amount))}|${doc.kind}|${normalizeDateForKey(doc.date || "")}`;

export default function GenericCSVPreviewScreen() {
  const { user } = useSessionStore();
  const { fetchHome } = useHomeStore();
  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [skippedCount, setSkippedCount] = useState(0);
  const [uniqueCount, setUniqueCount] = useState(0);
  const [preSkippedCount, setPreSkippedCount] = useState(0);
  const [preUniqueCount, setPreUniqueCount] = useState(0);
  const [precheckDone, setPrecheckDone] = useState(false);
  const [duplicateKeys, setDuplicateKeys] = useState<Set<string>>(new Set());
  const [parseStats, setParseStats] = useState<{
    totalRows: number;
    parsedRows: number;
    skippedRows: number;
    skippedDetails: { line: number; reason: string }[];
  } | null>(null);
  const cancelRef = useRef(false);

  // Get transactions from cache
  useEffect(() => {
    const cached = getParsedTransactions();
    if (cached) {
      setTransactions(cached.transactions as Transaction[]);
      setParseStats({
        totalRows: cached.totalRows,
        parsedRows: cached.parsedRows,
        skippedRows: cached.skippedRows,
        skippedDetails: cached.skippedDetails,
      });
    } else {
      Alert.alert("Error", "No transactions found. Please go back and try again.");
      router.back();
    }
  }, []);

  // Precheck dedupe so the user sees skips before importing
  useEffect(() => {
    const runPrecheck = async () => {
      if (!user?.id || transactions.length === 0) return;
      try {
        const existing = await getAllTransactionsForUser(user.id);
        const existingKeys = new Set(existing.map(makeKeyFromDoc));
        const dupKeys = new Set<string>();
        let unique = 0;
        let skipped = 0;
        for (const t of transactions) {
          const key = makeKeyFromTransaction(t);
          const isExisting = existingKeys.has(key);
          if (isExisting) {
            skipped++;
            dupKeys.add(key);
            continue;
          }
          unique++;
        }
        setPreSkippedCount(skipped);
        setPreUniqueCount(unique);
        setDuplicateKeys(dupKeys);
        setPrecheckDone(true);
      } catch (e) {
        console.warn("Precheck dedupe failed:", e);
        // Still allow import even if precheck fails
        setPreUniqueCount(transactions.length);
        setPrecheckDone(true);
      }
    };
    runPrecheck();
  }, [transactions, user?.id]);

  const handleImport = async () => {
    if (!user?.id) {
      Alert.alert("Error", "User not authenticated");
      return;
    }

    if (transactions.length === 0) {
      Alert.alert("Error", "No transactions to import");
      return;
    }

    cancelRef.current = false;
    setLoading(true);

    try {
      console.log(`Starting generic CSV import of ${transactions.length} transactions`);

      // Fetch existing transactions to dedupe and detect transfers
      const existing = await getAllTransactionsForUser(user.id);
      const existingKeys = new Set(existing.map(makeKeyFromDoc));

      // Dedupe against existing
      const deduped: Transaction[] = [];
      for (const t of transactions) {
        const key = makeKeyFromTransaction(t);
        if (existingKeys.has(key)) continue;
        deduped.push(t);
      }

      // Detect internal transfer pairs within the new batch
      const internalTransferDetection = detectTransferPairs(deduped as ParsedTransaction[]);
      const internalTransferPairs = internalTransferDetection.pairs;
      
      // Get transfer category id for transfers
      const transferCategoryId = await getTransferCategoryId();
      
      // Mark internal transfers
      const finalTransactions = deduped.map((tx, idx) => {
        if (internalTransferDetection.indices.has(idx)) {
          return {
            ...tx,
            categoryId: transferCategoryId,
            excludeFromAnalytics: true,
            isAnalyticsProtected: true,
          };
        }
        return tx;
      });

      const skipped = transactions.length - finalTransactions.length;
      setSkippedCount(skipped);
      setUniqueCount(finalTransactions.length);
      setImportProgress({ current: 0, total: finalTransactions.length });

      // Generate unique batch ID for this import
      const importBatchId = ID.unique();
      
      // Save balance snapshot before queueing transactions
      await saveBalanceSnapshot(user.id, importBatchId);
      
      // Queue transactions locally
      const queuedTxs = await queueTransactionsForSync(
        user.id, 
        finalTransactions.map(tx => ({ 
          ...tx, 
          source: "other_import" as const,
          displayName: tx.title,
          account: tx.account || 'CSV Import',
          importBatchId,
        }))
      );

      // Link internal transfer pairs after sync
      if (internalTransferPairs.length > 0 && queuedTxs?.length) {
        console.log(`Waiting to link ${internalTransferPairs.length} internal transfer pairs...`);
        
        // Wait a bit for transactions to sync and get IDs
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Get fresh transaction list to find the synced transaction IDs
        const syncedTransactions = await getAllTransactionsForUser(user.id);
        
        // Create a map of transaction key -> ID for matching
        const txMap = new Map<string, string>();
        syncedTransactions.forEach((tx: any) => {
          const key = `${tx.date}_${tx.title}_${tx.amount}_${tx.kind}`;
          txMap.set(key, tx.$id);
        });
        
        // Link each pair
        for (const pair of internalTransferPairs) {
          const tx1 = finalTransactions[pair.index1];
          const tx2 = finalTransactions[pair.index2];
          
          const key1 = `${tx1.date}_${tx1.title}_${tx1.amount}_${tx1.kind}`;
          const key2 = `${tx2.date}_${tx2.title}_${tx2.amount}_${tx2.kind}`;
          
          const id1 = txMap.get(key1);
          const id2 = txMap.get(key2);
          
          if (id1 && id2) {
            try {
              await updateTransaction(id1, { matchedTransferId: id2 });
              await updateTransaction(id2, { matchedTransferId: id1 });
              console.log(`Linked transfer pair: ${id1} <-> ${id2}`);
            } catch (err) {
              console.error(`Failed to link transfer pair:`, err);
            }
          }
        }
      }

      setImportProgress({ current: finalTransactions.length, total: finalTransactions.length });

      // Track last import date for notifications
      await saveLastImportDate('csv-import', 'CSV Import', 'other', user?.id);
      console.log(`Import date tracked for CSV import`);

      Alert.alert(
        "Import Queued",
        `Added ${finalTransactions.length} transactions to your queue.${skipped > 0 ? `\nSkipped ${skipped} duplicate(s).` : ""}\n\nThey will sync to your account shortly.`,
        [
          {
            text: "View Home",
            onPress: async () => {
              clearParsedTransactions();
              await fetchHome();
              router.replace("/");
            },
          },
        ]
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to import transactions";
      Alert.alert("Import Error", errorMsg);
      console.error("Import error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (loading) {
      cancelRef.current = true;
    } else {
      router.back();
    }
  };

  const getTransactionColor = (kind: "income" | "expense") => {
    return kind === "income" ? "#10B981" : "#EF4444";
  };

  const formatAmount = (amount: number, kind: "income" | "expense", currency: string = 'EUR') => {
    const sign = kind === "income" ? "+" : "-";
    const value = (amount / 100).toFixed(2);
    const currencySymbol = currency === 'USD' ? '$' : currency === 'GBP' ? '£' : '€';
    return `${sign}${currencySymbol}${value}`;
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 flex-col">
        {/* Header */}
        <View className="px-5 pt-4 pb-4 border-b border-gray-200">
          <Pressable
            onPress={() => router.back()}
            className="mb-4 flex-row items-center gap-2"
          >
            <Text className="text-primary text-base">← Back</Text>
          </Pressable>
          <View className="flex-row items-center gap-3">
            <View
              className="w-10 h-10 rounded-lg items-center justify-center"
              style={{ backgroundColor: "#10B98120" }}
            >
              <Feather name="file-text" size={20} color="#10B981" />
            </View>
            <View>
              <Text className="text-2xl font-bold text-dark-100">Review Transactions</Text>
              <Text className="text-sm text-gray-600 mt-1">
                {transactions.length} transactions ready to import
              </Text>
            </View>
          </View>
        </View>

        {/* Summary */}
        <View className="px-5 pt-4 pb-4 border-b border-gray-100 gap-3">
          <View className="flex-row gap-4">
            <View className="flex-1 rounded-lg bg-green-50 p-3">
              <Text className="text-xs text-green-700 font-semibold">Income</Text>
              <Text className="text-lg font-bold text-green-700 mt-1">
                €{(
                  transactions
                    .filter((t) => t.kind === "income")
                    .reduce((sum, t) => sum + t.amount, 0) / 100
                ).toFixed(2)}
              </Text>
            </View>
            <View className="flex-1 rounded-lg bg-red-50 p-3">
              <Text className="text-xs text-red-700 font-semibold">Expenses</Text>
              <Text className="text-lg font-bold text-red-700 mt-1">
                €{Math.abs(
                  transactions
                    .filter((t) => t.kind === "expense")
                    .reduce((sum, t) => sum + t.amount, 0) / 100
                ).toFixed(2)}
              </Text>
            </View>
          </View>

          {precheckDone && parseStats && (
            <View className="rounded-lg bg-blue-50 border border-blue-200 p-3">
              <Text className="text-xs text-blue-900 font-semibold">
                Parsed {parseStats.parsedRows} of {parseStats.totalRows} data rows
              </Text>
              {parseStats.skippedRows > 0 && (
                <View className="mt-1 gap-1">
                  <Text className="text-[11px] text-blue-800">
                    Skipped {parseStats.skippedRows} empty/invalid row{parseStats.skippedRows === 1 ? "" : "s"}.
                  </Text>
                  {parseStats.skippedDetails.slice(0, 3).map((d, idx) => (
                    <Text key={`${d.line}-${idx}`} className="text-[11px] text-blue-700">
                      Line {d.line}: {d.reason}
                    </Text>
                  ))}
                  {parseStats.skippedDetails.length > 3 && (
                    <Text className="text-[11px] text-blue-700">
                      +{parseStats.skippedDetails.length - 3} more
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Privacy Reminder */}
          <View className="flex-row items-center gap-2 px-1">
            <Feather name="shield" size={14} color="#10B981" />
            <Text className="text-xs text-emerald-700">
              All data processing happened on your device
            </Text>
          </View>
        </View>

        {/* Transaction List */}
        <FlatList
          data={transactions}
          keyExtractor={(_, index) => index.toString()}
          renderItem={({ item }) => {
            const key = makeKeyFromTransaction(item);
            const isDuplicate = duplicateKeys.has(key);
            return (
              <View className="px-5 py-3 border-b border-gray-100 flex-row items-center justify-between">
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="font-semibold text-dark-100" numberOfLines={1}>{item.title}</Text>
                    {isDuplicate && (
                      <View className="px-2 py-1 rounded-full bg-red-100">
                        <Text className="text-[11px] font-semibold text-red-700">Will skip</Text>
                      </View>
                    )}
                  </View>
                  {item.subtitle ? (
                    <Text className="text-xs text-gray-500 mt-1">{item.subtitle}</Text>
                  ) : null}
                  <Text className="text-xs text-gray-400 mt-1">{formatDate(item.date)}</Text>
                </View>
                <View className="items-end gap-1">
                  <Text
                    className="font-bold text-sm"
                    style={{ color: getTransactionColor(item.kind) }}
                  >
                    {formatAmount(item.amount, item.kind, item.currency)}
                  </Text>
                </View>
              </View>
            );
          }}
          scrollEnabled={true}
          contentContainerStyle={{ paddingBottom: 20 }}
        />

        {/* Action Buttons */}
        <View className="px-5 py-4 gap-3 border-t border-gray-200">
          {!precheckDone && !loading && (
            <View className="items-center">
              <Text className="text-xs text-gray-600">
                Checking for duplicates...
              </Text>
            </View>
          )}
          {precheckDone && !loading && (
            <View className="items-center">
              <Text className="text-xs text-gray-600">
                Will skip {preSkippedCount} duplicate{preSkippedCount === 1 ? "" : "s"} • Will import {preUniqueCount}
              </Text>
            </View>
          )}
          {loading && (
            <View className="items-center">
              <Text className="text-xs text-gray-600">
                Skipping {skippedCount} duplicate{skippedCount === 1 ? "" : "s"} • Importing {uniqueCount}
              </Text>
            </View>
          )}
          <Pressable
            onPress={handleImport}
            disabled={!precheckDone || loading || transactions.length === 0 || preUniqueCount === 0}
            className={`rounded-2xl py-4 items-center ${
              !precheckDone || loading || transactions.length === 0 || preUniqueCount === 0 
                ? "bg-gray-300" 
                : "bg-emerald-500"
            }`}
          >
            {!precheckDone ? (
              <View className="flex-row items-center gap-2">
                <ActivityIndicator color="#fff" />
                <Text className="text-white text-base font-bold">
                  Checking for duplicates...
                </Text>
              </View>
            ) : loading ? (
              <View className="flex-row items-center gap-2">
                <ActivityIndicator color="#fff" />
                <Text className="text-white text-base font-bold">
                  Importing {importProgress.current}/{importProgress.total}...
                </Text>
              </View>
            ) : (
              <View className="flex-row items-center gap-2">
                <Feather name="check-circle" size={18} color="white" />
                <Text className="text-white text-base font-bold">
                  Import {preUniqueCount} Transaction{preUniqueCount === 1 ? "" : "s"}
                </Text>
              </View>
            )}
          </Pressable>
          <Pressable
            onPress={handleCancel}
            className="rounded-2xl border-2 border-gray-200 py-4 items-center bg-white"
          >
            <Text className="text-gray-700 text-base font-semibold">
              {loading ? "Cancel import" : "Cancel"}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
