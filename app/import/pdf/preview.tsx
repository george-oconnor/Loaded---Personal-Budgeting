import { saveBalanceSnapshot, updateAccountBalance, upsertBalanceRemote } from "@/lib/accountBalances";
import { recordImportBalanceHistory } from "@/lib/balanceHistory";
import { getConfirmedSubscriptions, getTransactionsByBatchId, updateTransaction } from "@/lib/backend";
import { getTransferCategoryId } from "@/lib/categorization";
import { detectTransferPairs, ParsedTransaction } from "@/lib/csvParser";
import { formatCurrency } from "@/lib/currencyFunctions";
import { getExistingTransactionsSince, invalidateExistingTransactionsCache } from "@/lib/existingTransactionsCache";
import { saveLastImportDate } from "@/lib/notifications";
import { withSpan } from "@/lib/sentry";
import { queueTransactionsForSync } from "@/lib/syncQueue";
import { matchTransactionToSubscription } from "@/lib/subscriptionMatcher";
import { useHomeStore } from "@/store/useHomeStore";
import { useSessionStore } from "@/store/useSessionStore";
import { Feather } from "@expo/vector-icons";
import { ID } from "@/lib/ids";
import { router, useLocalSearchParams } from "expo-router";
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
import { clearParsedPdfTransactions, getParsedPdfTransactions } from "../pdf/pick";

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
  return d.toISOString().split("T")[0];
};
const makeKeyFromTransaction = (t: Transaction) =>
  `${normalizeText(t.title)}|${Math.abs(t.amount)}|${t.kind}|${normalizeDateForKey(t.date)}`;
const makeKeyFromDoc = (doc: any) => {
  // Use originalAmount (pre-edit) if present, so user edits don't break deduplication
  const amount = doc.originalAmount !== undefined && doc.originalAmount !== null
    ? Math.abs(Number(doc.originalAmount))
    : Math.abs(Number(doc.amount));
  return `${normalizeText(doc.title || "")}|${amount}|${doc.kind}|${normalizeDateForKey(doc.date || "")}`;
};
const earliestDateISO = (txs: { date: string }[]) => {
  const times = txs.map((t) => new Date(t.date).getTime()).filter((t) => !Number.isNaN(t));
  return new Date(times.length ? Math.min(...times) : 0).toISOString();
};
const latestDateISO = (txs: { date: string }[], fallback: string) => {
  const times = txs.map((t) => new Date(t.date).getTime()).filter((t) => !Number.isNaN(t));
  return times.length ? new Date(Math.max(...times)).toISOString() : fallback;
};

export default function PdfPreviewScreen() {
  const { user } = useSessionStore();
  const { fetchHome } = useHomeStore();
  const params = useLocalSearchParams();

  // Get account info from params (passed from select-account screen)
  const selectedAccountKey = params.selectedAccountKey as string | undefined;
  const selectedAccountName = params.selectedAccountName as string | undefined;
  const selectedAccountType = params.selectedAccountType as string | undefined;
  const selectedAccountCurrency = params.selectedAccountCurrency as string | undefined;
  const initialBalance = params.initialBalance as string | undefined;
  const isNewAccount = params.isNewAccount === "true";

  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [skippedCount, setSkippedCount] = useState(0);
  const [uniqueCount, setUniqueCount] = useState(0);
  const [preSkippedCount, setPreSkippedCount] = useState(0);
  const [preUniqueCount, setPreUniqueCount] = useState(0);
  const [precheckDone, setPrecheckDone] = useState(false);
  const [duplicateKeys, setDuplicateKeys] = useState<Set<number>>(new Set());
  const [filterMode, setFilterMode] = useState<'all' | 'import'>('all');
  const [parseStats, setParseStats] = useState<{
    totalRows: number;
    parsedRows: number;
    skippedRows: number;
    skippedDetails: { line: number; reason: string }[];
  } | null>(null);
  const cancelRef = useRef(false);

  // Get transactions from cache and apply account info
  useEffect(() => {
    const cached = getParsedPdfTransactions();
    if (cached) {
      const transactionsWithAccount = cached.transactions.map((tx) => ({
        ...tx,
        account: selectedAccountName || "PDF Import",
        currency: selectedAccountCurrency || tx.currency || "EUR",
      })) as Transaction[];

      setTransactions(transactionsWithAccount);
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
  }, [selectedAccountName, selectedAccountCurrency]);

  // Precheck dedupe so the user sees skips before importing
  useEffect(() => {
    const runPrecheck = async () => {
      if (!user?.id || transactions.length === 0) return;
      try {
        await withSpan(
          "import.precheck",
          "function",
          { transactionCount: transactions.length },
          async () => {
            const existing = await getExistingTransactionsSince(user.id, earliestDateISO(transactions));
            // Use a count map so each existing transaction can only match one import
            const existingKeyCounts = new Map<string, number>();
            for (const doc of existing) {
              const key = makeKeyFromDoc(doc);
              existingKeyCounts.set(key, (existingKeyCounts.get(key) || 0) + 1);
            }
            const dupIndices = new Set<number>();
            let unique = 0;
            let skipped = 0;
            for (let i = 0; i < transactions.length; i++) {
              const key = makeKeyFromTransaction(transactions[i]);
              const remaining = existingKeyCounts.get(key) || 0;
              if (remaining > 0) {
                existingKeyCounts.set(key, remaining - 1);
                skipped++;
                dupIndices.add(i);
                continue;
              }
              unique++;
            }
            setPreSkippedCount(skipped);
            setPreUniqueCount(unique);
            setDuplicateKeys(dupIndices);
            setPrecheckDone(true);
          }
        );
      } catch (e) {
        console.warn("Precheck dedupe failed:", e);
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

    const hasBalanceToUpdate = isNewAccount && initialBalance && parseFloat(initialBalance) > 0;

    if (transactions.length === 0 && !hasBalanceToUpdate) {
      Alert.alert("Error", "No transactions to import");
      return;
    }

    cancelRef.current = false;
    setLoading(true);

    try {
      console.log(`Starting PDF import of ${transactions.length} transactions`);

      // Fetch existing transactions to dedupe and detect transfers.
      // Shares the precheck's cached fetch (same user + date range) instead of hitting the backend again.
      const existing = await getExistingTransactionsSince(user.id, earliestDateISO(transactions));
      // Use a count map so each existing transaction can only match one import
      const existingKeyCounts = new Map<string, number>();
      for (const doc of existing) {
        const key = makeKeyFromDoc(doc);
        existingKeyCounts.set(key, (existingKeyCounts.get(key) || 0) + 1);
      }

      // Dedupe against existing
      const deduped: Transaction[] = [];
      for (const t of transactions) {
        const key = makeKeyFromTransaction(t);
        const remaining = existingKeyCounts.get(key) || 0;
        if (remaining > 0) {
          existingKeyCounts.set(key, remaining - 1);
          continue;
        }
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

      // Fetch confirmed subscriptions so we can auto-link matching imported transactions
      const confirmedSubs = await getConfirmedSubscriptions(user.id).catch((e) => {
        console.warn('Failed to fetch confirmed subscriptions for matching:', e);
        return [] as Awaited<ReturnType<typeof getConfirmedSubscriptions>>;
      });

      // Queue transactions locally
      const queuedTxs = await queueTransactionsForSync(
        user.id,
        finalTransactions.map((tx) => {
          const subId = matchTransactionToSubscription(tx, confirmedSubs);
          return {
            ...tx,
            source: "pdf_import" as const,
            displayName: tx.title,
            account: tx.account || "PDF Import",
            importBatchId,
            originalAmount: tx.amount, // Preserve original imported amount for future deduplication
            ...(subId ? { isSubscription: true, subscriptionId: subId } : {}),
          };
        })
      );

      // These transactions now exist in the backend — drop the cached
      // "existing transactions" snapshot so the next dedup check sees them.
      invalidateExistingTransactionsCache(user.id);

      // Link internal transfer pairs after sync
      if (internalTransferPairs.length > 0 && queuedTxs?.length) {
        console.log(`Waiting to link ${internalTransferPairs.length} internal transfer pairs...`);

        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Scoped to this batch instead of the user's whole history.
        const syncedTransactions = await getTransactionsByBatchId(user.id, importBatchId);
        const txMap = new Map<string, string>();
        syncedTransactions.forEach((tx: any) => {
          const key = `${tx.date}_${tx.title}_${tx.amount}_${tx.kind}`;
          txMap.set(key, tx.$id);
        });

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
              console.error("Failed to link transfer pair:", err);
            }
          }
        }
      }

      setImportProgress({ current: finalTransactions.length, total: finalTransactions.length });

      // Track last import date for notifications
      const accountKeyToTrack = selectedAccountKey || 'pdf-import';
      const accountNameToTrack = selectedAccountName || 'PDF Import';
      await saveLastImportDate(accountKeyToTrack, accountNameToTrack, 'other', user?.id);
      console.log(`Import date tracked for account: ${accountKeyToTrack}`);

      // Create/update account if we have account info
      if (selectedAccountKey && selectedAccountName) {
        try {
          const accountCurrency = selectedAccountCurrency || "EUR";
          const accountType = selectedAccountType || "Current";

          if (isNewAccount) {
            const balanceInCents = initialBalance
              ? Math.round(parseFloat(initialBalance) * 100)
              : 0;
            const finalBalance = isNaN(balanceInCents) ? 0 : balanceInCents;

            console.log('PDF import: creating NEW account', {
              name: selectedAccountName,
              type: accountType,
              key: selectedAccountKey,
              balance: finalBalance,
              initialBalanceParam: initialBalance,
            });

            await updateAccountBalance(selectedAccountName, finalBalance, accountCurrency, {
              accountKey: selectedAccountKey,
              accountType: accountType,
              provider: "pdf",
              userId: user.id,
            });

            await upsertBalanceRemote(
              user.id,
              {
                accountKey: selectedAccountKey,
                accountName: selectedAccountName,
                accountType: accountType,
                provider: "pdf",
                currency: accountCurrency,
              },
              finalBalance
            );

            console.log(`Created new account: ${selectedAccountName} with balance: ${finalBalance}`);
          } else {
            // Existing account — still update the account type and balance
            const balanceInCents = initialBalance
              ? Math.round(parseFloat(initialBalance) * 100)
              : undefined;

            console.log('PDF import: updating EXISTING account', {
              name: selectedAccountName,
              type: accountType,
              key: selectedAccountKey,
              balance: balanceInCents,
              initialBalanceParam: initialBalance,
            });

            // Always update account type to ensure it reflects user's choice
            await updateAccountBalance(
              selectedAccountName,
              balanceInCents ?? 0,
              accountCurrency,
              {
                accountKey: selectedAccountKey,
                accountType: accountType,
                provider: "pdf",
                userId: user.id,
              }
            );

            await upsertBalanceRemote(
              user.id,
              {
                accountKey: selectedAccountKey,
                accountName: selectedAccountName,
                accountType: accountType,
                provider: "pdf",
                currency: accountCurrency,
              },
              balanceInCents ?? 0
            );

            console.log(`Updated existing account: ${selectedAccountName} type=${accountType}`);
          }

          // Record daily balance history for the chart
          if (user?.id && selectedAccountKey && selectedAccountName) {
            try {
              const initialCents = initialBalance ? Math.round(parseFloat(initialBalance) * 100) : 0;
              const seedBalance = isNaN(initialCents) ? 0 : initialCents;
              const importTime = new Date().toISOString();
              const accountTransactions = finalTransactions
                .filter(t => (t.account || selectedAccountName) === selectedAccountName)
                .map(t => ({ date: t.date, amount: t.amount, kind: t.kind }));
              await recordImportBalanceHistory(user.id, importBatchId, [{
                accountKey: selectedAccountKey,
                accountName: selectedAccountName,
                provider: 'pdf',
                currency: accountCurrency,
                finalBalance: seedBalance,
                finalBalanceDate: latestDateISO(accountTransactions, importTime),
                transactions: accountTransactions,
              }]);
            } catch (histErr) {
              console.error('Failed to record balance history (pdf):', histErr);
            }
          }
        } catch (balanceErr) {
          console.error("Failed to create/update account:", balanceErr);
        }
      }

      // Build success message
      const balanceProvided = initialBalance && parseFloat(initialBalance) > 0;
      let successMessage = "";

      if (finalTransactions.length > 0) {
        successMessage = `Added ${finalTransactions.length} transactions to your queue.`;
        if (skipped > 0) {
          successMessage += `\nSkipped ${skipped} duplicate(s).`;
        }
        if (isNewAccount) {
          successMessage += `\nCreated account: ${selectedAccountName}`;
        }
      } else if (isNewAccount) {
        successMessage = `Created account: ${selectedAccountName}`;
        if (balanceProvided) {
          successMessage += " with balance.";
        }
        if (skipped > 0) {
          successMessage += `\nSkipped ${skipped} duplicate transaction(s).`;
        }
      } else {
        successMessage = "No new transactions to import.";
        if (skipped > 0) {
          successMessage += `\nAll ${skipped} transactions were duplicates.`;
        }
      }

      if (!isNewAccount && selectedAccountName) {
        successMessage += `\n\nAccount: ${selectedAccountName}`;
      }

      if (finalTransactions.length > 0) {
        successMessage += "\n\nThey will sync to your account shortly.";
      }

      Alert.alert(
        finalTransactions.length > 0
          ? "Import Queued"
          : isNewAccount
          ? "Account Created"
          : "Import Complete",
        successMessage,
        [
          {
            text: "View Home",
            onPress: () => {
              clearParsedPdfTransactions();
              fetchHome();
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

  const formatAmount = (amount: number, kind: "income" | "expense", currency: string = "EUR") => {
    const sign = kind === "income" ? "+" : "-";
    return `${sign}${formatCurrency(amount / 100, currency)}`;
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
              style={{ backgroundColor: "#8B5CF620" }}
            >
              <Feather name="file-text" size={20} color="#8B5CF6" />
            </View>
            <View>
              <Text className="text-2xl font-bold text-dark-100">Review Transactions</Text>
              <Text className="text-sm text-gray-600 mt-1">
                {transactions.length} transactions from PDF statement
              </Text>
            </View>
          </View>

          {/* Account Info Banner */}
          {selectedAccountName && (
            <View className="mt-4 flex-row items-center gap-3 p-3 bg-violet-50 rounded-xl border border-violet-200">
              <View className="w-8 h-8 rounded-full bg-violet-500 items-center justify-center">
                <Feather name="credit-card" size={16} color="white" />
              </View>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-violet-800">
                  {selectedAccountName}
                </Text>
                <Text className="text-xs text-violet-600">
                  {selectedAccountType || "Account"} • {selectedAccountCurrency || "EUR"}
                  {isNewAccount ? " • New Account" : ""}
                </Text>
              </View>
              <Pressable
                onPress={() => router.back()}
                className="px-3 py-1.5 rounded-lg bg-violet-100 active:bg-violet-200"
              >
                <Text className="text-xs font-semibold text-violet-700">Change</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Summary */}
        <View className="px-5 pt-4 pb-4 border-b border-gray-100 gap-3">
          <View className="flex-row gap-4">
            <View className="flex-1 rounded-lg bg-green-50 p-3">
              <Text className="text-xs text-green-700 font-semibold">Income</Text>
              <Text className="text-lg font-bold text-green-700 mt-1">
                {formatCurrency(
                  transactions
                    .filter((t) => t.kind === "income")
                    .reduce((sum, t) => sum + t.amount, 0) / 100,
                  transactions[0]?.currency || "EUR"
                )}
              </Text>
            </View>
            <View className="flex-1 rounded-lg bg-red-50 p-3">
              <Text className="text-xs text-red-700 font-semibold">Expenses</Text>
              <Text className="text-lg font-bold text-red-700 mt-1">
                {formatCurrency(
                  Math.abs(
                    transactions
                      .filter((t) => t.kind === "expense")
                      .reduce((sum, t) => sum + t.amount, 0)
                  ) / 100,
                  transactions[0]?.currency || "EUR"
                )}
              </Text>
            </View>
          </View>

          {precheckDone && parseStats && (
            <View className="flex-row gap-1 bg-gray-100 rounded-full p-1">
              <Pressable
                key="filter-all"
                onPress={() => setFilterMode('all')}
                className="flex-1 py-1.5 rounded-full"
                style={filterMode === 'all' ? { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } } : undefined}
              >
                <Text className={`text-center text-xs font-semibold ${filterMode === 'all' ? 'text-dark-100' : 'text-gray-500'}`}>
                  All ({transactions.length})
                </Text>
              </Pressable>
              <Pressable
                key="filter-import"
                onPress={() => setFilterMode('import')}
                className="flex-1 py-1.5 rounded-full"
                style={filterMode === 'import' ? { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } } : undefined}
              >
                <Text className={`text-center text-xs font-semibold ${filterMode === 'import' ? 'text-dark-100' : 'text-gray-500'}`}>
                  Will import ({transactions.length - duplicateKeys.size})
                </Text>
              </Pressable>
            </View>
          )}

          {/* Privacy Reminder */}
          <View className="flex-row items-center gap-2 px-1">
            <Feather name="smartphone" size={14} color="#8B5CF6" />
            <Text className="text-xs text-violet-700">
              All text extraction and parsing happened on your device
            </Text>
          </View>
        </View>

        {/* Transaction List */}
        <FlatList
          data={transactions
            .map((t, i) => ({ ...t, _origIndex: i }))
            .filter((t) => filterMode === 'all' || !duplicateKeys.has(t._origIndex))
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())}
          keyExtractor={(item: any) => `tx-${item._origIndex}`}
          renderItem={({ item }: { item: any }) => {
            const isDuplicate = duplicateKeys.has(item._origIndex);
            return (
              <View className="px-5 py-3 border-b border-gray-100 flex-row items-center justify-between">
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="font-semibold text-dark-100 flex-shrink" numberOfLines={1}>
                      {item.title}
                    </Text>
                    {isDuplicate && (
                      <View className="px-2 py-1 rounded-full bg-red-100 flex-shrink-0">
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
              <Text className="text-xs text-gray-600">Checking for duplicates...</Text>
            </View>
          )}
          {precheckDone && !loading && (
            <View className="items-center">
              <Text className="text-xs text-gray-600">
                {preUniqueCount === 0 && preSkippedCount > 0
                  ? `All ${preSkippedCount} transactions already imported`
                  : `Will skip ${preSkippedCount} duplicate${preSkippedCount === 1 ? "" : "s"} • Will import ${preUniqueCount}`}
                {isNewAccount && initialBalance ? " • Will update balance" : ""}
              </Text>
            </View>
          )}
          {loading && (
            <View className="items-center">
              <Text className="text-xs text-gray-600">
                Skipping {skippedCount} duplicate{skippedCount === 1 ? "" : "s"} • Importing{" "}
                {uniqueCount}
              </Text>
            </View>
          )}
          <Pressable
            onPress={handleImport}
            disabled={
              !precheckDone ||
              loading ||
              (transactions.length === 0 && !(isNewAccount && initialBalance))
            }
            className={`rounded-2xl py-4 items-center ${
              !precheckDone ||
              loading ||
              (transactions.length === 0 && !(isNewAccount && initialBalance))
                ? "bg-gray-300"
                : "bg-violet-500"
            }`}
          >
            {!precheckDone ? (
              <View className="flex-row items-center gap-2">
                <ActivityIndicator color="#fff" />
                <Text className="text-white text-base font-bold">Checking for duplicates...</Text>
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
                  {preUniqueCount === 0
                    ? isNewAccount && initialBalance
                      ? "Update Account Balance"
                      : "No New Transactions"
                    : `Import ${preUniqueCount} Transaction${preUniqueCount === 1 ? "" : "s"}`}
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
