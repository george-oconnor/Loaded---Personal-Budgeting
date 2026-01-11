import { saveBalanceSnapshot, updateAccountBalance, upsertBalanceRemote } from "@/lib/accountBalances";
import { getAllTransactionsForUser, updateTransaction } from "@/lib/appwrite";
import { getTransferCategoryId } from "@/lib/categorization";
import { detectAibTransfers, detectCrossBankTransfers } from "@/lib/csvParser";
import { saveLastImportDate } from "@/lib/notifications";
import { getQueuedTransactions, queueTransactionsForSync, updateQueuedTransactions } from "@/lib/syncQueue";
import { useHomeStore } from "@/store/useHomeStore";
import { useSessionStore } from "@/store/useSessionStore";
import { ID } from "appwrite";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Pressable,
    ScrollView,
    Text,
    View
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
  displayName?: string;
}

// Helpers for robust deduping: normalize text and use date-only key to avoid timezone string mismatches
const normalizeText = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
const dateOnlyKey = (value: string) => {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return (value || "").trim();
  return new Date(time).toISOString().split("T")[0]; // YYYY-MM-DD
};
const makeKeyFromTransaction = (t: Transaction) =>
  `${normalizeText(t.title)}|${Math.abs(t.amount)}|${t.kind}|${dateOnlyKey(t.date)}`;
const makeKeyFromDoc = (doc: any) =>
  `${normalizeText(doc.title || "")}|${Math.abs(Number(doc.amount))}|${doc.kind}|${dateOnlyKey(doc.date || "")}`;

export default function ImportPreviewScreen() {
  const { user } = useSessionStore();
  const { fetchHome } = useHomeStore();
  const params = useLocalSearchParams();
  const selectedAccountKey = params.selectedAccountKey as string;
  const selectedAccountName = params.selectedAccountName as string;
  const selectedAccountType = params.selectedAccountType as string;
  const newAccountName = params.newAccountName as string;
  const newAccountType = params.newAccountType as string;
  
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
  const [finalBalance, setFinalBalance] = useState<number | undefined>();
  const [currency, setCurrency] = useState<string>("EUR");
  const [zeroAmountIndices, setZeroAmountIndices] = useState<Set<number>>(new Set());

  useEffect(() => {
    const cached = getParsedTransactions();
    if (cached) {
      setTransactions(cached.transactions);
      // Find transactions with zero amount
      const zeroIndices = new Set<number>();
      cached.transactions.forEach((tx, idx) => {
        if (tx.amount === 0) {
          zeroIndices.add(idx);
        }
      });
      setZeroAmountIndices(zeroIndices);
      
      setParseStats({
        totalRows: cached.totalRows,
        parsedRows: cached.parsedRows,
        skippedRows: cached.skippedRows,
        skippedDetails: cached.skippedDetails,
      });
      setFinalBalance(cached.finalBalance);
      setCurrency(cached.currency || "EUR");
    } else {
      Alert.alert("Error", "No transactions found. Please go back and try again.");
      router.back();
    }
  }, []);

  useEffect(() => {
    const runPrecheck = async () => {
      if (!user?.id || transactions.length === 0) return;
      try {
        console.log('Starting precheck - fetching all transactions...');
        const startTime = Date.now();
        const existing = await getAllTransactionsForUser(user.id);
        console.log(`Fetched ${existing.length} existing transactions in ${Date.now() - startTime}ms`);
        
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
        console.log(`Precheck complete: ${unique} unique, ${skipped} duplicates`);
      } catch (e) {
        console.warn("Precheck dedupe failed:", e);
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

    // Validate account selection from params
    if (!selectedAccountKey && !newAccountName) {
      Alert.alert("Error", "No account selected. Please go back and select an account.");
      return;
    }

    cancelRef.current = false;
    setLoading(true);

    try {
      console.log('=== AIB Import Started ===');
      const startTotal = Date.now();

      console.log('Step 1: Fetching existing transactions from DB and queue...');
      const step1Start = Date.now();
      const [existingDb, queuedTransactions] = await Promise.all([
        getAllTransactionsForUser(user.id),
        getQueuedTransactions()
      ]);
      // Combine database and queued transactions for transfer detection
      const existing = [...existingDb];
      console.log(`Step 1 complete: Fetched ${existingDb.length} from DB + ${queuedTransactions.length} from queue in ${Date.now() - step1Start}ms`);

      console.log('Step 2: Deduplication...');
      const step2Start = Date.now();
      // Create deduplication keys from both DB and queue
      const existingKeys = new Set([
        ...existing.map(makeKeyFromDoc),
        ...queuedTransactions.map((q: any) => makeKeyFromTransaction({
          title: q.title,
          subtitle: q.subtitle,
          amount: Math.abs(q.amount),
          kind: q.kind,
          date: q.date,
          categoryId: q.categoryId,
          currency: q.currency,
          displayName: q.displayName,
        }))
      ]);

      // Filter out transactions with zero amount and existing transactions
      const deduped: Transaction[] = [];
      for (let i = 0; i < transactions.length; i++) {
        const t = transactions[i];
        // Skip zero-amount transactions
        if (zeroAmountIndices.has(i)) continue;
        const key = makeKeyFromTransaction(t);
        if (existingKeys.has(key)) continue;
        deduped.push(t);
      }
      console.log(`Step 2 complete: Deduplicated to ${deduped.length} transactions in ${Date.now() - step2Start}ms`);

      console.log('Step 3: Converting existing transactions...');
      const step3Start = Date.now();
      // Convert both DB and queued transactions for transfer detection
      const existingAsTransactions: Transaction[] = [
        ...existing.map((doc: any) => ({
          title: doc.title || '',
          subtitle: doc.subtitle || '',
          amount: Math.abs(Number(doc.amount)),
          kind: doc.kind,
          date: doc.date || '',
          categoryId: doc.categoryId || '',
          currency: doc.currency || 'EUR',
          excludeFromAnalytics: doc.excludeFromAnalytics,
          isAnalyticsProtected: doc.isAnalyticsProtected,
          displayName: doc.displayName,
        })),
        ...queuedTransactions.map((q: any) => ({
          title: q.title || '',
          subtitle: q.subtitle || '',
          amount: Math.abs(Number(q.amount)),
          kind: q.kind,
          date: q.date || '',
          categoryId: q.categoryId || '',
          currency: q.currency || 'EUR',
          excludeFromAnalytics: q.excludeFromAnalytics,
          isAnalyticsProtected: q.isAnalyticsProtected,
          displayName: q.displayName,
        }))
      ];
      console.log(`Step 3 complete: Converted in ${Date.now() - step3Start}ms`);
      
      console.log('Step 4: Detecting AIB transfers...');
      const step4Start = Date.now();
      // For AIB imports, detect internal transfers using AIB-specific logic:
      // - Same date, *MOBI in title, same amount, opposite kind
      const aibTransfersResult = detectAibTransfers(deduped, existingAsTransactions);
      const aibTransferIndicesInNew = aibTransfersResult.newIndices;
      const aibTransferIndicesInExisting = aibTransfersResult.existingIndices;
      const aibPairs = aibTransfersResult.pairs;
      console.log(`Step 4 complete: Found ${aibTransferIndicesInNew.size} AIB transfers in ${Date.now() - step4Start}ms`);
      
      console.log('Step 5: Detecting cross-bank transfers...');
      const step5Start = Date.now();
      // Detect cross-bank transfers (AIB ↔ Revolut)
      const dbCount = existing.length;
      const existingRevolutTransactions = existingAsTransactions.filter((_, idx) => {
        if (idx < dbCount) {
          return existing[idx].source === 'revolut_import';
        } else {
          return queuedTransactions[idx - dbCount].source === 'revolut_import';
        }
      });
      const revolutIndicesMap = new Map<number, number>();
      let revolutMappedIndex = 0;
      existingAsTransactions.forEach((tx, idx) => {
        const isRevolut = idx < dbCount 
          ? existing[idx].source === 'revolut_import'
          : queuedTransactions[idx - dbCount].source === 'revolut_import';
        if (isRevolut) {
          revolutIndicesMap.set(revolutMappedIndex++, idx);
        }
      });
      
      const crossBankResult = detectCrossBankTransfers(
        deduped,
        existingRevolutTransactions,
        'aib_import',
        'revolut_import'
      );
      const mappedCrossBankPairs: Array<{ newIndex: number; existingIndex: number }> = [];
      crossBankResult.pairs.forEach(pair => {
        const originalIdx = revolutIndicesMap.get(pair.existingIndex);
        if (originalIdx !== undefined) {
          mappedCrossBankPairs.push({ newIndex: pair.newIndex, existingIndex: originalIdx });
        }
      });
      console.log(`Step 5 complete: Found ${crossBankResult.newIndices.size} cross-bank transfers in ${Date.now() - step5Start}ms`);
      
      console.log('Step 6: Combining transfer indices...');
      const step6Start = Date.now();
      // Combine AIB-specific and cross-bank transfer indices
      const allTransferIndicesInNew = new Set([...aibTransferIndicesInNew, ...crossBankResult.newIndices]);
      const crossBankExistingIndices = new Set<number>();
      crossBankResult.existingIndices.forEach(idx => {
        const originalIdx = revolutIndicesMap.get(idx);
        if (originalIdx !== undefined) {
          crossBankExistingIndices.add(originalIdx);
        }
      });
      const allTransferIndicesInExisting = new Set([...aibTransferIndicesInExisting, ...crossBankExistingIndices]);

      // Separate existing transactions from DB vs queue for proper updating
      const dbTransactionCount = existing.length;
      const dbTransferIndices = new Set<number>();
      const queuedTransferIndices = new Set<number>();
      allTransferIndicesInExisting.forEach(idx => {
        if (idx < dbTransactionCount) {
          dbTransferIndices.add(idx);
        } else {
          queuedTransferIndices.add(idx - dbTransactionCount);
        }
      });

      // Map of new transaction index -> matched existing transaction ID
      const newToExistingId = new Map<number, string>();
      const allPairs: Array<{ newIndex: number; existingIndex: number }> = [...aibPairs, ...mappedCrossBankPairs];
      allPairs.forEach(({ newIndex, existingIndex }) => {
        if (existingIndex < dbTransactionCount) {
          // Match is with a DB transaction
          const existingTx = existing[existingIndex];
          if (existingTx?.$id) {
            newToExistingId.set(newIndex, existingTx.$id);
          }
        } else {
          // Match is with a queued transaction
          const queuedTx = queuedTransactions[existingIndex - dbTransactionCount];
          if (queuedTx?.id) {
            newToExistingId.set(newIndex, queuedTx.id);
          }
        }
      });
      console.log(`Step 6 complete: Combined indices (${dbTransferIndices.size} in DB, ${queuedTransferIndices.size} in queue) in ${Date.now() - step6Start}ms`);
      
      console.log('Step 7: Getting transfer category ID...');
      const step7Start = Date.now();
      // Get the transfer category ID
      const transferCategoryId = await getTransferCategoryId();
      console.log(`Step 7 complete: Got transfer category in ${Date.now() - step7Start}ms`);
      
      console.log(`Step 8: Updating ${dbTransferIndices.size} existing DB transactions...`);
      const step8Start = Date.now();
      // Update only existing DB transactions that were identified as transfers
      // (Queued transactions will be updated when they sync)
      for (const existingIdx of dbTransferIndices) {
        const existingTx = existing[existingIdx];
        await updateTransaction(existingTx.$id, {
          categoryId: transferCategoryId,
          excludeFromAnalytics: true,
          isAnalyticsProtected: true,
        });
      }
      console.log(`Step 8 complete: Updated ${dbTransferIndices.size} DB transactions in ${Date.now() - step8Start}ms`);
      
      console.log('Step 9: Marking new transfers...');
      const step9Start = Date.now();
      // Mark new AIB internal transfers and cross-bank transfers with Transfer category and analytics protection
      const finalTransactions = deduped.map((tx, idx) => {
        const matchedExistingId = newToExistingId.get(idx);
        if (allTransferIndicesInNew.has(idx)) {
          return {
            ...tx,
            categoryId: transferCategoryId,
            excludeFromAnalytics: true,
            isAnalyticsProtected: true,
            matchedTransferId: matchedExistingId,
          };
        }
        return {
          ...tx,
          matchedTransferId: matchedExistingId,
        };
      });
      console.log(`Step 9 complete: Marked transfers in ${Date.now() - step9Start}ms`);

      console.log('Step 10: Queueing transactions for sync...');
      const step10Start = Date.now();
      const skipped = transactions.length - finalTransactions.length;
      setSkippedCount(skipped);
      setUniqueCount(finalTransactions.length);
      setImportProgress({ current: 0, total: finalTransactions.length });

      const accountName = selectedAccountName || newAccountName;
      const importBatchId = ID.unique(); // Generate unique batch ID for this import
      
      // Save balance snapshot before queueing transactions
      await saveBalanceSnapshot(user.id, importBatchId);
      
      const queuedTxs = await queueTransactionsForSync(
        user.id, 
        finalTransactions.map(tx => ({ 
          ...tx, 
          source: "aib_import" as const,
          displayName: tx.displayName || tx.title, // Explicitly ensure displayName is set
          account: accountName,
          importBatchId, // Add the batch ID to all transactions in this import
        }))
      );
      
      // Update existing transactions with matched transfer IDs
      const dbUpdates: Array<Promise<any>> = [];
      const queueUpdates: Array<{ id: string; updates: Partial<any> }> = [];
      
      if (queuedTxs?.length) {
        for (const { newIndex, existingIndex } of allPairs) {
          const queuedTx = queuedTxs[newIndex];
          if (!queuedTx) continue;
          
          if (existingIndex < dbTransactionCount) {
            // Update DB transaction with matched ID pointing to newly queued item
            const existingTx = existing[existingIndex];
            if (existingTx?.$id) {
              dbUpdates.push(
                updateTransaction(existingTx.$id, {
                  matchedTransferId: queuedTx.id,
                })
              );
            }
          } else {
            // Update queued transaction with matched ID pointing to newly queued item
            const queuedExistingTx = queuedTransactions[existingIndex - dbTransactionCount];
            if (queuedExistingTx?.id) {
              queueUpdates.push({
                id: queuedExistingTx.id,
                updates: { matchedTransferId: queuedTx.id }
              });
            }
          }
        }
        
        // Execute all updates
        await Promise.all(dbUpdates);
        if (queueUpdates.length > 0) {
          await updateQueuedTransactions(queueUpdates);
        }
      }
      console.log(`Step 10 complete: Queued ${finalTransactions.length} transactions, updated ${dbUpdates.length} DB + ${queueUpdates.length} queued matches in ${Date.now() - step10Start}ms`);

      console.log('Step 11: Progress animation...');
      const step11Start = Date.now();
      let current = 0;
      for (const _ of finalTransactions) {
        if (cancelRef.current) break;
        current += 1;
        setImportProgress({ current, total: finalTransactions.length });
        await new Promise(res => setTimeout(res, 50));
      }
      console.log(`Step 11 complete: Animation done in ${Date.now() - step11Start}ms`);

      console.log('Step 12: Updating account balance...');
      const step12Start = Date.now();
      // Update account balance if we have a final balance and account info
      if (finalBalance !== undefined && (selectedAccountName || newAccountName)) {
        const accountName = selectedAccountName || newAccountName;
        const accountKey = selectedAccountKey || undefined;
        const accountType = selectedAccountType || newAccountType;

        if (accountName) {
          const importTime = new Date().toISOString();
          await updateAccountBalance(accountName, finalBalance, currency, {
            provider: "aib",
            accountType,
            accountKey,
            userId: user?.id,
            lastUpdated: importTime,
          });
          if (user?.id && accountKey) {
            await upsertBalanceRemote(user.id, { accountKey, accountName, accountType, provider: "aib", currency }, finalBalance, importTime);
          }
          console.log(`Updated balance for ${accountName}: ${(finalBalance / 100).toFixed(2)} ${currency}`);
        }
      }
      console.log(`Step 12 complete: Balance updated in ${Date.now() - step12Start}ms`);

      console.log('Step 13: Fetching home data...');
      const step13Start = Date.now();
      await fetchHome();
      console.log(`Step 13 complete: Fetched home in ${Date.now() - step13Start}ms`);
      
      // Track last import date for notifications
      console.log('Step 14: Tracking import date for notifications...');
      const accountKeyToTrack = selectedAccountKey || `aib-${(selectedAccountName || newAccountName).toLowerCase().replace(/\s+/g, '-')}`;
      await saveLastImportDate(
        accountKeyToTrack,
        selectedAccountName || newAccountName,
        'aib'
      );
      console.log(`Step 14 complete: Import date tracked for ${accountKeyToTrack}`);
      
      console.log(`=== Total import time: ${Date.now() - startTotal}ms ===`);
      clearParsedTransactions();
      Alert.alert("Success", `Imported ${finalTransactions.length} transactions`, [
        { text: "OK", onPress: () => router.replace("/") },
      ]);
    } catch (err) {
      console.error("Import error:", err);
      Alert.alert("Error", "Failed to import transactions");
    } finally {
      setLoading(false);
    }
  };

  const renderItem = ({ item, index }: { item: Transaction; index: number }) => {
    const isExpense = item.kind === "expense";
    const isZeroAmount = zeroAmountIndices.has(index);
    
    return (
      <View className={`rounded-2xl border p-4 mb-3 ${isZeroAmount ? 'border-gray-300 bg-gray-50' : 'border-gray-200 bg-white'}`}>
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-1 flex-row items-center gap-2">
            <Text className={`text-base font-semibold flex-1 ${isZeroAmount ? 'text-gray-400' : 'text-dark-100'}`} numberOfLines={1}>{item.title || "Transaction"}</Text>
            {isZeroAmount && (
              <View className="bg-yellow-100 px-2 py-1 rounded">
                <Text className="text-xs font-semibold text-yellow-800">Skipped</Text>
              </View>
            )}
          </View>
          <Text className={`text-base font-bold ${isZeroAmount ? 'text-gray-400' : isExpense ? "text-red-500" : "text-green-600"}`}>
            {isExpense ? "-" : "+"}{(item.amount / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {item.currency}
          </Text>
        </View>
        <Text className={`text-sm ${isZeroAmount ? 'text-gray-400' : 'text-gray-500'}`} numberOfLines={1}>{item.subtitle || item.categoryId}</Text>
        <View className="flex-row justify-between items-center mt-2">
          <Text className={`text-xs ${isZeroAmount ? 'text-gray-400' : 'text-gray-500'}`}>{new Date(item.date).toLocaleDateString()}</Text>
          <Text className={`text-xs ${isZeroAmount ? 'text-gray-400' : 'text-gray-500'}`}>{item.categoryId}</Text>
        </View>
        {isZeroAmount && (
          <Text className="text-xs text-yellow-700 mt-2">Zero amount transactions will not be imported</Text>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1">
        <View className="px-5 pt-5 pb-4 border-b border-gray-100">
          <Pressable onPress={() => router.back()} className="mb-4 flex-row items-center gap-2">
            <Text className="text-primary text-base">← Back</Text>
          </Pressable>
          <Text className="text-2xl font-bold text-dark-100">AIB Import Preview</Text>
          <Text className="text-sm text-gray-500 mt-1">Review and confirm your imported transactions</Text>
          {parseStats && (
            <Text className="text-xs text-gray-400 mt-2">
              Parsed {parseStats.parsedRows}/{parseStats.totalRows} rows • Skipped {parseStats.skippedRows}
            </Text>
          )}
        </View>

        <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
          {/* Precheck info */}
          {precheckDone && (
            <View className="px-5 py-3 bg-gray-50 border-b border-gray-100">
              <Text className="text-xs text-gray-600">
                {preUniqueCount} new, {preSkippedCount} already in your account.
              </Text>
            </View>
          )}
        </ScrollView>

        {/* Progress Bar */}
        {loading && (
          <View className="px-5 py-3 bg-yellow-50 border-b border-yellow-100 flex-row items-center gap-2">
            <ActivityIndicator size="small" color="#ca8a04" />
            <Text className="text-sm text-yellow-800">
              Importing {importProgress.current}/{importProgress.total}...
            </Text>
          </View>
        )}

        {/* Fixed Account Selection */}
        <View className="px-5 py-4 bg-blue-50 border-b border-gray-100">
          <Text className="text-sm font-semibold text-gray-700 mb-3">Importing to:</Text>
          <View className="p-3 rounded-xl bg-white border-2 border-sky-500">
            <Text className="text-sm font-semibold text-gray-800">{selectedAccountName || newAccountName}</Text>
            <Text className="text-xs text-gray-500 mt-1">{selectedAccountType || newAccountType}</Text>
          </View>
        </View>

        <FlatList
          data={transactions}
          keyExtractor={(_, idx) => `tx-${idx}`}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 20, paddingBottom: 140 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={() => (
            <View className="items-center justify-center py-20">
              <Text className="text-gray-400">No transactions to preview</Text>
            </View>
          )}
        />
      </View>

      {/* Footer */}
      <View className="absolute bottom-0 left-0 right-0 px-5 pb-6 pt-4 bg-white border-t border-gray-200">
        <View className="gap-3">
          <Pressable
            onPress={handleImport}
            disabled={loading || transactions.length === 0}
            className={`rounded-2xl py-4 items-center ${
              loading || transactions.length === 0 ? "bg-gray-300" : "bg-sky-500"
            }`}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white text-base font-bold">Import to Budget</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => {
              clearParsedTransactions();
              router.back();
            }}
            disabled={loading}
            className="rounded-2xl border-2 border-gray-200 py-4 items-center bg-white"
          >
            <Text className="text-gray-700 text-base font-semibold">Cancel</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
