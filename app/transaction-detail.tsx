import { databases } from "@/lib/appwrite";
import { learnMerchantCategory } from "@/lib/categorization";
import { formatCurrency } from "@/lib/currencyFunctions";
import { getMerchantIconUrl, getSuggestedMerchantIcon, suggestMerchantIcon } from "@/lib/merchantIcons";
import { getQueuedTransactions } from "@/lib/syncQueue";
import { useHomeStore } from "@/store/useHomeStore";
import { useSessionStore } from "@/store/useSessionStore";
import { useTransactionDetailStore } from "@/store/useTransactionDetailStore";
import type { Transaction } from "@/types/type";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// Map category names to default icons
function getDefaultIcon(categoryName: string): string {
  const name = (categoryName || '').toLowerCase();
  const iconMap: Record<string, string> = {
    food: 'coffee',
    groceries: 'shopping-bag',
    transport: 'navigation',
    entertainment: 'play',
    shopping: 'shopping-bag',
    bills: 'file',
    utilities: 'zap',
    health: 'heart',
    services: 'cloud',
    sport: 'activity',
    general: 'inbox',
    income: 'trending-down',
  };
  return iconMap[name] || 'shopping-bag';
}

// Normalize date to YYYY-MM-DD to avoid timezone shifts when comparing
const dateOnlyKey = (value: string) => {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return (value || "").trim();
  return new Date(time).toISOString().split("T")[0];
};

// Normalize potentially invalid icon names to valid Feather icons
function normalizeFeatherIconName(icon: string | undefined, categoryName: string | undefined): string {
  const raw = (icon || '').toLowerCase().trim();
  const aliasMap: Record<string, string> = {
    cart: 'shopping-bag',
    'shopping-cart': 'shopping-bag',
    flash: 'zap',
    movie: 'play',
    film: 'play',
    bus: 'truck',
    utensils: 'coffee',
    'fork-knife': 'coffee',
    'silverware-fork-knife': 'coffee',
    'file-text': 'file',
  };
  const normalized = aliasMap[raw] || raw;
  const validSet = new Set([
    'shopping-bag','zap','play','truck','file','cloud','activity','heart','navigation','inbox','coffee','dollar-sign','credit-card','chevron-left','check-circle','x'
  ]);
  if (!normalized) return getDefaultIcon(categoryName || '');
  return validSet.has(normalized) ? normalized : getDefaultIcon(categoryName || '');
}
export default function TransactionDetailScreen() {
  const { selectedTransactionId, setSelectedTransactionId } = useTransactionDetailStore();
  const id = selectedTransactionId?.trim();
  const { categories, summary, transactions } = useHomeStore();
  const { user } = useSessionStore();
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedDisplayName, setEditedDisplayName] = useState("");
  const [editedAmount, setEditedAmount] = useState("");
  const [editedExcludeFromAnalytics, setEditedExcludeFromAnalytics] = useState(false);
  const [editedHideMerchantIcon, setEditedHideMerchantIcon] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isQueuedTransaction, setIsQueuedTransaction] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showIconSuggestionModal, setShowIconSuggestionModal] = useState(false);
  const [suggestedIconUrl, setSuggestedIconUrl] = useState("");
  const [iconPreviewUrl, setIconPreviewUrl] = useState<string | null>(null);
  const [savingIconSuggestion, setSavingIconSuggestion] = useState(false);
  const [crowdSourcedIconUrl, setCrowdSourcedIconUrl] = useState<string | null>(null);
  const [crowdSourcedIconFailed, setCrowdSourcedIconFailed] = useState(false);
  const [tldIndex, setTldIndex] = useState(0);
  const [iconFailed, setIconFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const currency = summary?.currency ?? "USD";

  // Fetch transaction details
  useEffect(() => {
    console.log("selectedTransactionId:", selectedTransactionId, "trimmed id:", id);
    loadTransaction();
  }, [id]);

  const loadTransaction = async () => {
    if (!id || id.length === 0 || !user?.id) {
      console.log("Skipping load - missing id or user:", { id, userId: user?.id });
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      console.log("Loading transaction with ID:", id);
      
      let dbTx: Transaction | null = null;
      let isQueued = false;
      
      // Try to load from database first (takes precedence over queue)
      try {
        const databaseId = process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID as string;
        const transactionsTableId = (process.env.EXPO_PUBLIC_APPWRITE_TABLE_TRANSACTIONS || process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_TRANSACTIONS) as string;
        if (!databaseId || !transactionsTableId) throw new Error("Appwrite env not configured");
        const response = await databases.getDocument(
          databaseId,
          transactionsTableId,
          id
        );

        dbTx = {
          id: response.$id,
          title: response.title,
          subtitle: response.subtitle,
          amount: response.amount,
          categoryId: response.categoryId,
          kind: response.kind,
          date: response.date,
          excludeFromAnalytics: response.excludeFromAnalytics ?? false,
          isAnalyticsProtected: response.isAnalyticsProtected ?? false,
          source: response.source,
          displayName: response.displayName,
          account: (response as any).account,
          matchedTransferId: (response as any).matchedTransferId,
          hideMerchantIcon: (response as any).hideMerchantIcon ?? false,
          importBatchId: (response as any).importBatchId,
        };
        
        isQueued = false;
        console.log("Loaded database transaction:", dbTx);
      } catch (dbError) {
        // Transaction not in database, check the queue
        // Only consider transactions that are not yet completed (pending, syncing, or failed)
        console.log("Transaction not in database, checking queue...");
        const queuedTxs = await getQueuedTransactions();
        const queuedTx = queuedTxs.find(t => t.id === id && t.syncStatus !== 'completed');
        
        if (queuedTx) {
          dbTx = queuedTx;
          isQueued = true;
          console.log("Loaded queued transaction:", queuedTx);
        } else {
          throw new Error("Transaction not found in database or queue");
        }
      }
      
      if (dbTx) {
        // If transaction is flagged as a transfer but has no matched ID, remove the flags
        if (dbTx.isAnalyticsProtected && !dbTx.matchedTransferId) {
          console.log("Transfer flag set but no matched transfer found, removing flags...");
          const updates = {
            isAnalyticsProtected: false,
            excludeFromAnalytics: false,
          };

          try {
            if (isQueued) {
              // Update queued transaction
              const queuedTxs = await getQueuedTransactions();
              const updated = queuedTxs.map(t =>
                t.id === id ? { ...t, ...updates } : t
              );
              await AsyncStorage.setItem("budget_app_sync_queue", JSON.stringify(updated));
            } else {
              // Update database transaction
              const databaseId = process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID as string;
              const transactionsTableId = (process.env.EXPO_PUBLIC_APPWRITE_TABLE_TRANSACTIONS || process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_TRANSACTIONS) as string;
              await databases.updateDocument(
                databaseId,
                transactionsTableId,
                id!,
                updates
              );
            }
            // Update local state
            dbTx = { ...dbTx, ...updates };
          } catch (err) {
            console.error("Failed to remove transfer flags:", err);
          }
        }

        setTransaction(dbTx);
        setEditedTitle(dbTx.title);
        setEditedDisplayName(dbTx.displayName || dbTx.title);
        setEditedAmount((dbTx.amount / 100).toString());
        setEditedExcludeFromAnalytics(dbTx.excludeFromAnalytics ?? false);
        setEditedHideMerchantIcon(dbTx.hideMerchantIcon ?? false);
        setIsQueuedTransaction(isQueued);
      }
    } catch (error) {
      console.error("Failed to load transaction:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // Reset icon state so we re-attempt fetching favicon on refresh
      setIconFailed(false);
      setTldIndex(0);
      setCrowdSourcedIconUrl(null);
      await loadTransaction();
    } finally {
      setRefreshing(false);
    }
  };

  // Load crowd-sourced icon URL when transaction changes
  useEffect(() => {
    const loadCrowdSourcedIcon = async () => {
      if (transaction?.title) {
        const suggestedUrl = await getSuggestedMerchantIcon(transaction.displayName || transaction.title);
        setCrowdSourcedIconUrl(suggestedUrl);
        setCrowdSourcedIconFailed(false); // Reset failed state when URL changes
      }
    };
    loadCrowdSourcedIcon();
  }, [transaction?.title, transaction?.displayName]);

  const handleOpenMatchedTransfer = () => {
    const targetId = transaction?.matchedTransferId;
    if (!targetId) return;
    if (targetId === id) return;
    setSelectedTransactionId(targetId);
    router.push("/transaction-detail");
  };

  // If the transaction title changes (different merchant), reset icon state
  useEffect(() => {
    setIconFailed(false);
    setTldIndex(0);
  }, [transaction?.title]);

  const handleSave = async () => {
    if (!transaction || !user?.id) return;

    try {
      setSaving(true);
      const amount = Math.round(parseFloat(editedAmount) * 100);

      if (isQueuedTransaction) {
        // Update queued transaction in AsyncStorage
        const queuedTxs = await getQueuedTransactions();
        const updated = queuedTxs.map(t =>
          t.id === id
            ? { ...t, title: editedTitle, amount, excludeFromAnalytics: editedExcludeFromAnalytics, displayName: editedDisplayName, hideMerchantIcon: editedHideMerchantIcon }
            : t
        );
        await AsyncStorage.setItem("budget_app_sync_queue", JSON.stringify(updated));
      } else {
        // Update database transaction
        const databaseId = process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID as string;
        const transactionsTableId = (process.env.EXPO_PUBLIC_APPWRITE_TABLE_TRANSACTIONS || process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_TRANSACTIONS) as string;
        await databases.updateDocument(
          databaseId,
          transactionsTableId,
          id!,
          {
            title: editedTitle,
            amount,
            excludeFromAnalytics: editedExcludeFromAnalytics,
            displayName: editedDisplayName,
            hideMerchantIcon: editedHideMerchantIcon,
          }
        );
      }

      setTransaction({
        ...transaction,
        title: editedTitle,
        amount,
        excludeFromAnalytics: editedExcludeFromAnalytics,
        displayName: editedDisplayName,
        hideMerchantIcon: editedHideMerchantIcon,
      });

      // Refresh home store to reflect analytics changes
      const { fetchHome } = useHomeStore.getState();
      fetchHome();

      setIsEditing(false);
    } catch (error) {
      console.error("Failed to save transaction:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!transaction || !user?.id) return;

    try {
      setSaving(true);
      if (isQueuedTransaction) {
        // Delete queued transaction from AsyncStorage
        const queuedTxs = await getQueuedTransactions();
        const updated = queuedTxs.filter(t => t.id !== id);
        await AsyncStorage.setItem("budget_app_sync_queue", JSON.stringify(updated));
      } else {
        // Delete database transaction
        const databaseId = process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID as string;
        const transactionsTableId = (process.env.EXPO_PUBLIC_APPWRITE_TABLE_TRANSACTIONS || process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_TRANSACTIONS) as string;
        await databases.deleteDocument(
          databaseId,
          transactionsTableId,
          id!
        );
      }
      router.back();
    } catch (error) {
      console.error("Failed to delete transaction:", error);
      setSaving(false);
    }
  };

  const handleSelectCategory = async (newCategoryId: string) => {
    if (!transaction || !user?.id) return;

    try {
      if (isQueuedTransaction) {
        // Update queued transaction in AsyncStorage
        const queuedTxs = await getQueuedTransactions();
        const updated = queuedTxs.map(t =>
          t.id === id
            ? { ...t, categoryId: newCategoryId }
            : t
        );
        await AsyncStorage.setItem("budget_app_sync_queue", JSON.stringify(updated));
      } else {
        // Update database transaction
        const databaseId = process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID as string;
        const transactionsTableId = (process.env.EXPO_PUBLIC_APPWRITE_TABLE_TRANSACTIONS || process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_TRANSACTIONS) as string;
        await databases.updateDocument(
          databaseId,
          transactionsTableId,
          id!,
          { categoryId: newCategoryId }
        );
      }

      // Learn this merchant-category mapping for future imports
      // Store both the raw title and displayName to improve matching
      await learnMerchantCategory(transaction.title, newCategoryId, user?.id);
      if (transaction.displayName && transaction.displayName !== transaction.title) {
        await learnMerchantCategory(transaction.displayName, newCategoryId, user?.id);
      }

      // Update the transaction state
      setTransaction({
        ...transaction,
        categoryId: newCategoryId,
      });

      // Refresh home store to reflect analytics changes
      const { fetchHome } = useHomeStore.getState();
      fetchHome();

      setShowCategoryDropdown(false);
      console.log("Updated category to:", newCategoryId);
    } catch (error) {
      console.error("Failed to update category:", error);
    }
  };

  const handleToggleHideMerchantIcon = async (newValue: boolean) => {
    if (!transaction || !user?.id) return;

    try {
      setEditedHideMerchantIcon(newValue);

      if (isQueuedTransaction) {
        // Update queued transaction in AsyncStorage
        const queuedTxs = await getQueuedTransactions();
        const updated = queuedTxs.map(t =>
          t.id === id
            ? { ...t, hideMerchantIcon: newValue }
            : t
        );
        await AsyncStorage.setItem("budget_app_sync_queue", JSON.stringify(updated));
      } else {
        // Update database transaction
        const databaseId = process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID as string;
        const transactionsTableId = (process.env.EXPO_PUBLIC_APPWRITE_TABLE_TRANSACTIONS || process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_TRANSACTIONS) as string;
        await databases.updateDocument(
          databaseId,
          transactionsTableId,
          id!,
          { hideMerchantIcon: newValue }
        );
      }

      // Update the transaction state
      setTransaction({
        ...transaction,
        hideMerchantIcon: newValue,
      });

      // Refresh home store to update all transaction lists
      const { fetchHome } = useHomeStore.getState();
      fetchHome();

      console.log("Updated hideMerchantIcon to:", newValue);
    } catch (error) {
      console.error("Failed to toggle hideMerchantIcon:", error);
      // Revert the change on error
      setEditedHideMerchantIcon(!newValue);
    }
  };

  const handleToggleExcludeFromAnalytics = async (newValue: boolean) => {
    if (!transaction || !user?.id) return;
    
    // Prevent toggling if analytics protection is enabled
    if (transaction.isAnalyticsProtected) {
      Alert.alert(
        "Protected Transaction",
        "This transaction is marked as a transfer and cannot be included in analytics.",
        [{ text: "OK" }]
      );
      return;
    }

    try {
      setEditedExcludeFromAnalytics(newValue);

      if (isQueuedTransaction) {
        // Update queued transaction in AsyncStorage
        const queuedTxs = await getQueuedTransactions();
        const updated = queuedTxs.map(t =>
          t.id === id
            ? { ...t, excludeFromAnalytics: newValue }
            : t
        );
        await AsyncStorage.setItem("budget_app_sync_queue", JSON.stringify(updated));
      } else {
        // Update database transaction
        const databaseId = process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID as string;
        const transactionsTableId = (process.env.EXPO_PUBLIC_APPWRITE_TABLE_TRANSACTIONS || process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_TRANSACTIONS) as string;
        await databases.updateDocument(
          databaseId,
          transactionsTableId,
          id!,
          { excludeFromAnalytics: newValue }
        );
      }

      // Update the transaction state
      setTransaction({
        ...transaction,
        excludeFromAnalytics: newValue,
      });

      // Refresh home store to reflect analytics changes
      const { fetchHome } = useHomeStore.getState();
      fetchHome();

      console.log("Updated excludeFromAnalytics to:", newValue);
    } catch (error) {
      console.error("Failed to toggle excludeFromAnalytics:", error);
      // Revert the change on error
      setEditedExcludeFromAnalytics(!newValue);
    }
  };

  const handleOpenIconSuggestionModal = () => {
    setSuggestedIconUrl("");
    setIconPreviewUrl(null);
    setShowIconSuggestionModal(true);
  };

  // Check if input looks like a domain (e.g., "example.com")
  const isDomainFormat = (input: string): boolean => {
    const domainPattern = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
    return domainPattern.test(input) && !input.startsWith('http');
  };

  // Convert input to preview URL (handles both domain and direct URL)
  const getPreviewUrl = (input: string): string => {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      return input;
    }
    // Treat as domain and use Google favicon
    return `https://www.google.com/s2/favicons?domain=${input}&sz=128`;
  };

  const handlePreviewIconUrl = () => {
    const input = suggestedIconUrl.trim();
    if (!input) {
      setIconPreviewUrl(null);
      return;
    }
    
    // Accept either domain format or full URL
    if (!input.startsWith('http://') && !input.startsWith('https://') && !isDomainFormat(input)) {
      Alert.alert("Invalid Input", "Please enter a valid domain (e.g., example.com) or full URL (https://...)");
      return;
    }
    
    setIconPreviewUrl(getPreviewUrl(input));
  };

  const handleSubmitIconSuggestion = async () => {
    if (!transaction || !user?.id) return;
    
    const input = suggestedIconUrl.trim();
    if (!input) {
      Alert.alert("No Input", "Please enter a domain or icon URL to suggest.");
      return;
    }
    
    // Accept either domain format or full URL
    if (!input.startsWith('http://') && !input.startsWith('https://') && !isDomainFormat(input)) {
      Alert.alert("Invalid Input", "Please enter a valid domain (e.g., example.com) or full URL (https://...)");
      return;
    }
    
    try {
      setSavingIconSuggestion(true);
      
      // Submit the icon suggestion (store the raw input - domain or URL)
      await suggestMerchantIcon(
        transaction.displayName || transaction.title,
        input,
        user.id
      );
      
      // Also submit for the original title if different
      if (transaction.displayName && transaction.displayName !== transaction.title) {
        await suggestMerchantIcon(transaction.title, input, user.id);
      }
      
      // Update local state to show the new icon (use resolved URL for display)
      setCrowdSourcedIconUrl(getPreviewUrl(input));
      setIconFailed(false);
      setTldIndex(0);
      
      Alert.alert(
        "Thank you!",
        "Your icon suggestion has been submitted. It will help other users see the right icon for this merchant.",
        [{ text: "OK" }]
      );
      
      setShowIconSuggestionModal(false);
      setSuggestedIconUrl("");
      setIconPreviewUrl(null);
    } catch (error) {
      console.error("Failed to submit icon suggestion:", error);
      Alert.alert("Error", "Failed to submit your suggestion. Please try again.");
    } finally {
      setSavingIconSuggestion(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#7C3AED" />
      </SafeAreaView>
    );
  }

  if (!transaction) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="px-5 pt-2 pb-6">
          <Pressable
            onPress={() => router.back()}
            className="flex-row items-center gap-2"
          >
            <Feather name="chevron-left" size={20} color="#7C3AED" />
            <Text className="text-primary text-base font-semibold">Back</Text>
          </Pressable>
        </View>
        <View className="flex-1 items-center justify-center px-5">
          <Text className="text-gray-400 text-center">Transaction not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const category = categories.find(c => c.id === transaction.categoryId);

  return (
    <SafeAreaView className="flex-1 bg-white">
      {/* Header */}
      <View className="px-5 pt-2 pb-6 border-b border-gray-200 flex-row items-center justify-between">
        <Pressable
          onPress={() => router.back()}
          className="flex-row items-center gap-2"
        >
          <Feather name="chevron-left" size={20} color="#7C3AED" />
          <Text className="text-primary text-base font-semibold">Back</Text>
        </Pressable>
        {!isEditing && (
          <Pressable
            onPress={() => setIsEditing(true)}
            className="p-2 active:opacity-70"
          >
            <Feather name="edit-2" size={18} color="#7C3AED" />
          </Pressable>
        )}
      </View>

      <ScrollView
        className="flex-1 px-5 py-6"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={["#7C3AED"]}
            tintColor="#7C3AED"
          />
        }
        contentContainerStyle={isEditing ? { paddingBottom: 280 } : {}}
      >
        {/* Amount Display / Input with Icon */}
        <View className="mb-6">
          <Text className="text-gray-500 text-sm mb-2">Amount</Text>
          <View className="flex-row items-center justify-between">
            <View className="flex-1">
              {isEditing ? (
                <TextInput
                  value={editedAmount}
                  onChangeText={setEditedAmount}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  className="text-4xl font-bold text-dark-100 border-b-2 border-primary pb-2"
                  style={{ paddingVertical: 0 }}
                />
              ) : (
                <Text
                  className="text-4xl font-bold"
                  style={{
                    color: transaction.excludeFromAnalytics ? "#6B7280" : "#1F2937",
                    textDecorationLine: transaction.excludeFromAnalytics ? "line-through" : "none",
                  }}
                >
                  {formatCurrency(transaction.amount / 100, currency)}
                </Text>
              )}
            </View>
            
            {/* Merchant Icon */}
            {transaction && (() => {
              const shouldHideMerchantIcon = transaction.hideMerchantIcon || false;
              // Prioritize crowd-sourced icon (if not failed), then fall back to built-in mappings
              const builtInIconUrl = (shouldHideMerchantIcon || iconFailed) ? null : getMerchantIconUrl(transaction.displayName || transaction.title, 128, tldIndex);
              // Crowd-sourced icon overrides hideMerchantIcon setting (user explicitly suggested it), but falls back if it failed
              const effectiveCrowdSourcedUrl = (crowdSourcedIconUrl && !crowdSourcedIconFailed) ? crowdSourcedIconUrl : null;
              const baseIconUrl = effectiveCrowdSourcedUrl || ((shouldHideMerchantIcon || iconFailed) ? null : builtInIconUrl);
              const titleKey = (transaction.title || "").toLowerCase();
              const isRevolutTransfer =
                (transaction.source === "revolut_import") &&
                (titleKey.includes("to pocket") || titleKey.includes("transfer to") || titleKey.includes("transfer from"));
              const merchantIconUrl = baseIconUrl ?? (isRevolutTransfer && !shouldHideMerchantIcon ? `https://www.google.com/s2/favicons?domain=revolut.com&sz=128` : null);
              const hasMerchantIcon = merchantIconUrl !== null;
              const isIncome = transaction.kind === "income";
              const iconBackgroundColor = hasMerchantIcon ? "#FFFFFF" : (isIncome ? "#2F9B6520" : "#F1414120");
              const isCrowdSourced = effectiveCrowdSourcedUrl && baseIconUrl === effectiveCrowdSourcedUrl;
              
              const getCategoryIcon = (name?: string) => {
                const key = (name || "").toLowerCase();
                if (key.includes("grocery") || key.includes("supermarket") || key.includes("food") || key.includes("restaurant") || key.includes("coffee")) return "shopping-bag";
                if (key.includes("transport") || key.includes("taxi") || key.includes("uber") || key.includes("bolt") || key.includes("bus") || key.includes("train") || key.includes("travel") || key.includes("flight") || key.includes("fuel") || key.includes("petrol") || key.includes("gas")) return "truck";
                if (key.includes("bill") || key.includes("utility") || key.includes("wifi") || key.includes("internet") || key.includes("phone")) return "file";
                if (key.includes("entertain") || key.includes("movie") || key.includes("film") || key.includes("music") || key.includes("tv")) return "play";
                if (key.includes("shop") || key.includes("retail") || key.includes("store") || key.includes("clothe")) return "shopping-bag";
                if (key.includes("health") || key.includes("medical") || key.includes("gym") || key.includes("fitness") || key.includes("doctor")) return "heart";
                if (key.includes("rent") || key.includes("mortgage") || key.includes("home") || key.includes("housing")) return "home";
                if (key.includes("salary") || key.includes("pay") || key.includes("wage") || key.includes("income")) return "trending-up";
                if (key.includes("transfer")) return "repeat";
                if (key.includes("education") || key.includes("school") || key.includes("tuition")) return "book";
                if (key.includes("gift") || key.includes("donation") || key.includes("charity")) return "gift";
                return "dollar-sign";
              };
              
              const handleImageError = () => {
                // If this is a crowd-sourced icon, mark it as failed so we fall back to category icon
                if (isCrowdSourced) {
                  setCrowdSourcedIconFailed(true);
                  return;
                }
                // For built-in favicons, try other TLDs before falling back
                if (tldIndex < 2) {
                  setTldIndex(tldIndex + 1);
                  return;
                }
                setIconFailed(true);
              };

              const handleIconPress = () => {
                if (hasMerchantIcon && merchantIconUrl) {
                  const sourceInfo = isCrowdSourced 
                    ? "User-suggested" 
                    : "Auto-detected";
                  
                  Alert.alert(
                    "Merchant Icon",
                    `${sourceInfo}\n\nTap below to suggest a different icon for this merchant.`,
                    [
                      { text: "Suggest Icon", onPress: handleOpenIconSuggestionModal },
                      { text: "Done", style: "cancel" }
                    ]
                  );
                } else {
                  Alert.alert(
                    "No Icon Found",
                    `Showing category icon for ${category?.name || "Uncategorized"}.\n\nWould you like to suggest an icon for this merchant?`,
                    [
                      { text: "Suggest Icon", onPress: handleOpenIconSuggestionModal },
                      { text: "Cancel", style: "cancel" }
                    ]
                  );
                }
              };

              return (
                <Pressable onPress={handleIconPress} className="active:opacity-70">
                  <View
                    className="w-20 h-20 rounded-full items-center justify-center ml-4"
                    style={{ backgroundColor: iconBackgroundColor, borderWidth: hasMerchantIcon ? 2 : 0, borderColor: '#E5E7EB' }}
                  >
                    {hasMerchantIcon ? (
                      <Image
                        source={{ uri: merchantIconUrl }}
                        style={{ width: 64, height: 64, borderRadius: 32 }}
                        resizeMode="contain"
                        onError={handleImageError}
                      />
                    ) : (
                      <Feather
                        name={getCategoryIcon(category?.name) as any}
                        size={32}
                        color={isIncome ? "#2F9B65" : "#F14141"}
                      />
                    )}
                  </View>
                </Pressable>
              );
            })()}
          </View>
        </View>

        {/* Title */}
        <View className="mb-6">
          <Text className="text-gray-500 text-sm mb-2">Original Name</Text>
          <Text className="text-sm text-gray-600 mb-3">{transaction.title}</Text>
          
          <Text className="text-gray-500 text-sm mb-2">Display Name</Text>
          {isEditing ? (
            <TextInput
              value={editedDisplayName}
              onChangeText={setEditedDisplayName}
              placeholder="How this transaction appears"
              className="text-base text-dark-100 border-b-2 border-primary pb-2 mb-2"
              style={{ paddingVertical: 0 }}
            />
          ) : (
            <Text className="text-base font-semibold text-dark-100">{transaction.displayName || transaction.title}</Text>
          )}
        </View>

        {/* Category */}
        <Pressable
          onPress={() => setShowCategoryDropdown(true)}
          className="mb-6 active:opacity-70"
        >
          <View className="p-4 rounded-2xl bg-gray-50">
            <Text className="text-gray-500 text-sm mb-2">Category</Text>
            <View className="flex-row items-center gap-3 justify-between">
              <View className="flex-row items-center gap-3 flex-1">
                <View
                  className="w-10 h-10 rounded-full items-center justify-center"
                  style={{ backgroundColor: category?.color || "#7C3AED" }}
                >
                  <Feather name={normalizeFeatherIconName(category?.icon as any, category?.name)} size={16} color="white" />
                </View>
                <Text className="text-base font-semibold text-dark-100">
                  {category?.name || "Unknown"}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color="#9CA3AF" />
            </View>
          </View>
        </Pressable>

        {/* Type */}
        <View className="mb-6 p-4 rounded-2xl bg-gray-50">
          <Text className="text-gray-500 text-sm mb-2">Type</Text>
          <Text className="text-base font-semibold text-dark-100 capitalize">
            {transaction.kind}
          </Text>
        </View>

        {/* Date */}
        <View className="mb-6 p-4 rounded-2xl bg-gray-50">
          <Text className="text-gray-500 text-sm mb-2">Date</Text>
          <Text className="text-base font-semibold text-dark-100">
            {new Date(transaction.date).toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </Text>
        </View>

        {/* Source */}
        <View className="mb-6 p-4 rounded-2xl bg-gray-50">
          <Text className="text-gray-500 text-sm mb-2">Source</Text>
          <Text className="text-base font-semibold text-dark-100">
            {transaction.source === "aib_import" && "AIB Import"}
            {transaction.source === "revolut_import" && "Revolut Import"}
            {transaction.source === "manual" && "Manual Entry"}
            {transaction.source === "other_import" && "Other Import"}
            {!transaction.source && "Unknown"}
          </Text>
        </View>

        {/* Account */}
        <View className="mb-6 p-4 rounded-2xl bg-gray-50">
          <Text className="text-gray-500 text-sm mb-2">Account</Text>
          <Text className="text-base font-semibold text-dark-100">
            {transaction.account || "Not specified"}
          </Text>
        </View>

        {/* Matched Transfer */}
        {transaction.matchedTransferId && (
          <View className="mb-6 p-4 rounded-2xl bg-gray-50 gap-2">
            <Text className="text-gray-500 text-sm">Matched Transfer</Text>
            <Text className="text-xs text-gray-500">
              Linked internal transfer detected during import.
            </Text>
            <Pressable
              onPress={handleOpenMatchedTransfer}
              className="bg-primary rounded-xl py-3 px-4 items-center active:opacity-70"
            >
              <Text className="text-white font-semibold">Open matched transaction</Text>
            </Pressable>
          </View>
        )}

        {/* Exclude from Analytics Toggle */}
        <View className="mb-6 p-4 rounded-2xl bg-gray-50 flex-row items-center justify-between border border-gray-200">
          <View className="flex-1">
            <Text className="text-base font-semibold text-dark-100">
              Exclude from Analytics
            </Text>
            <Text className="text-xs text-gray-500 mt-1">
              {editedExcludeFromAnalytics
                ? "This transaction won't appear in reports"
                : "This transaction will appear in reports"}
              {transaction?.isAnalyticsProtected && " (Transfer - protected)"}
            </Text>
          </View>
          <Switch
            value={editedExcludeFromAnalytics}
            onValueChange={handleToggleExcludeFromAnalytics}
            disabled={transaction?.isAnalyticsProtected}
            trackColor={{ false: "#CBD5E1", true: "#7C3AED" }}
            ios_backgroundColor="#CBD5E1"
            thumbColor={"#FFFFFF"}
            style={{ transform: [{ scale: 1.05 }] }}
          />
        </View>

        {/* Hide Merchant Icon Toggle */}
        <View className="mb-6 p-4 rounded-2xl bg-gray-50 flex-row items-center justify-between border border-gray-200">
          <View className="flex-1">
            <Text className="text-base font-semibold text-dark-100">
              Use category icon
            </Text>
            <Text className="text-xs text-gray-500 mt-1">
              {editedHideMerchantIcon
                ? "Showing category icon instead of merchant logo"
                : "Showing merchant logo when available"}
            </Text>
          </View>
          <Switch
            value={editedHideMerchantIcon}
            onValueChange={handleToggleHideMerchantIcon}
            trackColor={{ false: "#CBD5E1", true: "#7C3AED" }}
            ios_backgroundColor="#CBD5E1"
            thumbColor={"#FFFFFF"}
            style={{ transform: [{ scale: 1.05 }] }}
          />
        </View>

        {/* Sync Status */}
        <View className="mb-6 p-4 rounded-2xl bg-gray-50">
          <Text className="text-gray-500 text-sm mb-2">Sync Status</Text>
          <View className="flex-row items-center gap-3">
            <View
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: isQueuedTransaction ? '#F97316' : '#10B981' }}
            />
            <Text className="text-base font-semibold text-dark-100">
              {isQueuedTransaction ? 'Not synced (queued)' : 'Synced'}
            </Text>
          </View>
          {isQueuedTransaction && (
            <Text className="text-xs text-gray-500 mt-2">
              This transaction is waiting to sync. Keep the app open or connected to send it.
            </Text>
          )}
        </View>

        {/* Transaction ID */}
        <View className="mb-6 p-4 rounded-2xl bg-gray-50">
          <Text className="text-gray-500 text-xs mb-2">Transaction ID</Text>
          <Text className="text-xs text-gray-600 font-mono">{transaction.id}</Text>
          {transaction.importBatchId && (
            <>
              <Text className="text-gray-500 text-xs mb-2 mt-4">Batch ID</Text>
              <Text className="text-xs text-gray-600 font-mono">{transaction.importBatchId}</Text>
            </>
          )}
        </View>

        {/* Delete Button (only visible when not editing) */}
        {!isEditing && (
          <Pressable
            onPress={handleDelete}
            disabled={saving}
            className="bg-red-500 rounded-2xl py-4 items-center active:opacity-70 disabled:opacity-50"
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-semibold">Delete Transaction</Text>
            )}
          </Pressable>
        )}
      </ScrollView>

      {/* Fixed Bottom Buttons (Edit Mode) */}
      {isEditing && (
        <View className="absolute bottom-0 left-0 right-0 px-5 py-4 bg-white border-t border-gray-200 gap-3">
          <Pressable
            onPress={handleSave}
            disabled={saving}
            className="bg-primary rounded-2xl py-4 items-center active:opacity-70 disabled:opacity-50"
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-semibold">Save Changes</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => {
              setIsEditing(false);
              setEditedTitle(transaction.title);
              setEditedDisplayName(transaction.displayName || transaction.title);
              setEditedAmount((transaction.amount / 100).toString());
              setEditedExcludeFromAnalytics(transaction.excludeFromAnalytics || false);
              setEditedHideMerchantIcon(transaction.hideMerchantIcon || false);
            }}
            className="border border-gray-300 rounded-2xl py-4 items-center active:opacity-70"
          >
            <Text className="text-dark-100 font-semibold">Cancel</Text>
          </Pressable>
        </View>
      )}

      {/* Category Dropdown Modal */}
      <Modal
        visible={showCategoryDropdown}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCategoryDropdown(false)}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-white rounded-t-3xl" style={{ maxHeight: "70%" }}>
            {/* Header */}
            <View className="px-5 pt-4 pb-2 border-b border-gray-200 flex-row items-center justify-between">
              <Text className="text-lg font-bold text-dark-100">Select Category</Text>
              <Pressable
                onPress={() => setShowCategoryDropdown(false)}
                className="p-2 active:opacity-70"
              >
                <Feather name="x" size={24} color="#181C2E" />
              </Pressable>
            </View>

            {/* Categories List */}
            <FlatList
              data={categories.filter(cat => cat.id !== "all")}
              keyExtractor={cat => cat.id}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => handleSelectCategory(item.id)}
                  className={`px-5 py-4 border-b border-gray-100 flex-row items-center gap-3 active:bg-gray-50 ${
                    transaction?.categoryId === item.id ? "bg-primary/10" : ""
                  }`}
                >
                  <View
                    className="w-10 h-10 rounded-full items-center justify-center"
                    style={{ backgroundColor: item.color || "#7C3AED" }}
                  >
                    <Feather name={normalizeFeatherIconName(item.icon as any, item.name)} size={16} color="white" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-dark-100">{item.name}</Text>
                  </View>
                  {transaction?.categoryId === item.id && (
                    <Feather name="check" size={20} color="#7C3AED" />
                  )}
                </Pressable>
              )}
              scrollEnabled
            />
          </View>
        </View>
      </Modal>

      {/* Icon Suggestion Modal */}
      <Modal
        visible={showIconSuggestionModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowIconSuggestionModal(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1"
        >
          <Pressable 
            className="flex-1 bg-black/50 justify-end"
            onPress={() => {
              Keyboard.dismiss();
              setShowIconSuggestionModal(false);
            }}
          >
            <Pressable onPress={() => {}} className="bg-white rounded-t-3xl">
              {/* Header */}
              <View className="px-5 pt-4 pb-2 border-b border-gray-200 flex-row items-center justify-between">
                <Text className="text-lg font-bold text-dark-100">Suggest Icon URL</Text>
                <Pressable
                  onPress={() => setShowIconSuggestionModal(false)}
                  className="p-2 active:opacity-70"
                >
                  <Feather name="x" size={24} color="#181C2E" />
                </Pressable>
              </View>

              {/* Content */}
              <ScrollView className="px-5 py-4" keyboardShouldPersistTaps="handled">
                <Text className="text-gray-600 text-sm mb-4">
                  Suggest an icon URL for "{transaction?.displayName || transaction?.title}". 
                  This will help other users see the correct icon for this merchant.
                </Text>

                {/* URL Input */}
                <Text className="text-gray-500 text-sm mb-2">Domain or Image URL</Text>
                <View className="flex-row items-center gap-2 mb-4">
                  <TextInput
                    value={suggestedIconUrl}
                    onChangeText={setSuggestedIconUrl}
                    placeholder="example.com or https://example.com/logo.png"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    className="flex-1 bg-gray-50 rounded-xl px-4 text-base text-dark-100 border border-gray-200"
                    style={{ height: 48, paddingTop: 0, paddingBottom: 0 }}
                  />
                  <Pressable
                    onPress={handlePreviewIconUrl}
                    className="bg-gray-100 rounded-xl px-4 py-3 active:opacity-70"
                  >
                    <Feather name="eye" size={20} color="#6B7280" />
                  </Pressable>
                </View>

                {/* Preview */}
                {iconPreviewUrl && (
                  <View className="mb-4 items-center">
                    <Text className="text-gray-500 text-sm mb-2">Preview</Text>
                    <View className="w-20 h-20 rounded-full items-center justify-center bg-white border-2 border-gray-200">
                      <Image
                        source={{ uri: iconPreviewUrl }}
                        style={{ width: 64, height: 64, borderRadius: 32 }}
                        resizeMode="contain"
                        onError={() => {
                          Alert.alert("Preview Failed", "Could not load the image from this URL. Please check the URL and try again.");
                          setIconPreviewUrl(null);
                        }}
                      />
                    </View>
                  </View>
                )}

                {/* Tips */}
                <View className="bg-blue-50 rounded-xl p-3 mb-4">
                  <Text className="text-blue-800 text-xs font-medium mb-1">Two ways to suggest an icon:</Text>
                  <Text className="text-blue-700 text-xs">• <Text className="font-semibold">Domain:</Text> Enter "example.com" (must have a favicon set up)</Text>
                  <Text className="text-blue-700 text-xs">• <Text className="font-semibold">Direct URL:</Text> Paste a full image URL (more reliable)</Text>
                  <Text className="text-blue-700 text-xs mt-1">• If domain shows blank, try a direct image URL instead</Text>
                </View>
                <Pressable
                  onPress={handleSubmitIconSuggestion}
                  disabled={savingIconSuggestion || !suggestedIconUrl.trim()}
                  className="bg-primary rounded-2xl py-4 items-center active:opacity-70 disabled:opacity-50 mb-4"
                >
                  {savingIconSuggestion ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white font-semibold">Submit Suggestion</Text>
                  )}
                </Pressable>
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
