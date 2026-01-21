import { getAccountBalances } from "@/lib/accountBalances";
import { useSessionStore } from "@/store/useSessionStore";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";

interface AibAccount {
  key: string;
  name: string;
  type: string;
}

export default function SelectAccountScreen() {
  const { user } = useSessionStore();
  const params = useLocalSearchParams();
  const transactionCount = params.transactionCount as string;

  const [existingAibAccounts, setExistingAibAccounts] = useState<AibAccount[]>([]);
  const [selectedAccountKey, setSelectedAccountKey] = useState<string | null>(null);
  const [isCreatingNewAccount, setIsCreatingNewAccount] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountType, setNewAccountType] = useState("Current");

  useEffect(() => {
    const loadAccounts = async () => {
      if (!user?.id) return;
      try {
        const balances = await getAccountBalances(user.id);
        const aibAccounts = balances
          .filter((b) => b.provider === "aib" && b.accountKey)
          .map((b) => ({
            key: b.accountKey!,
            name: b.accountName,
            type: b.accountType || "Current",
          }));
        setExistingAibAccounts(aibAccounts);

        // Auto-select first account if only one exists
        if (aibAccounts.length === 1) {
          setSelectedAccountKey(aibAccounts[0].key);
        }
      } catch (err) {
        console.error("Failed to load AIB accounts:", err);
      }
    };
    loadAccounts();
  }, [user?.id]);

  const handleContinue = () => {
    let selectedKey: string;

    if (isCreatingNewAccount) {
      if (!newAccountName.trim()) {
        alert("Please enter an account name");
        return;
      }
      // Create new account and use its ID
      selectedKey = `new-${Date.now()}`;
    } else {
      if (!selectedAccountKey) {
        alert("Please select or create an account");
        return;
      }
      selectedKey = selectedAccountKey;
    }

    // Navigate to preview with account info
    router.push({
      pathname: "/import/aib/preview",
      params: {
        selectedAccountKey: selectedKey,
        selectedAccountName: isCreatingNewAccount ? newAccountName : 
          existingAibAccounts.find(a => a.key === selectedAccountKey)?.name || "",
        selectedAccountType: isCreatingNewAccount ? newAccountType : 
          existingAibAccounts.find(a => a.key === selectedAccountKey)?.type || "Current",
        newAccountName: isCreatingNewAccount ? newAccountName : "",
        newAccountType: isCreatingNewAccount ? newAccountType : "",
      },
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View className="px-5 pt-5 pb-4 border-b border-gray-100">
          <Pressable onPress={() => router.back()} className="mb-4 flex-row items-center gap-2">
            <Text className="text-primary text-base">← Back</Text>
          </Pressable>
          <Text className="text-2xl font-bold text-dark-100">Select AIB Account</Text>
          <Text className="text-sm text-gray-500 mt-1">Choose where to import these {transactionCount} transactions</Text>
        </View>

        {/* Account Selection */}
        <View className="px-5 py-4">
          <Text className="text-sm font-semibold text-gray-700 mb-3">Create New Account</Text>
          
          <Pressable
            onPress={() => {
              setIsCreatingNewAccount(true);
              setSelectedAccountKey(null);
            }}
            className={`p-4 rounded-xl border-2 mb-4 ${
              isCreatingNewAccount
                ? "bg-sky-50 border-sky-500"
                : "bg-white border-gray-200"
            }`}
          >
            <Text className="text-sm font-semibold text-gray-800">+ Create New Account</Text>
          </Pressable>

          {isCreatingNewAccount && (
            <View className="gap-4 p-4 bg-gray-50 rounded-xl mb-4">
              <View>
                <Text className="text-xs font-semibold text-gray-700 mb-2">Account Name</Text>
                <TextInput
                  value={newAccountName}
                  onChangeText={setNewAccountName}
                  placeholder="e.g., AIB Current Account"
                  placeholderTextColor="#9CA3AF"
                  multiline={false}
                  style={{ minHeight: 48, lineHeight: 24, paddingVertical: 12 }}
                  className="bg-white border border-gray-300 rounded-xl px-4 py-3 text-base font-normal"
                />
              </View>
              <View>
                <Text className="text-xs font-semibold text-gray-700 mb-2">Account Type</Text>
                <View className="flex-row gap-2">
                  {["Current", "Savings", "Credit Card"].map((type) => (
                    <Pressable
                      key={type}
                      onPress={() => setNewAccountType(type)}
                      className={`flex-1 p-3 rounded-xl border-2 ${
                        newAccountType === type
                          ? "bg-sky-500 border-sky-500"
                          : "bg-white border-gray-200"
                      }`}
                    >
                      <Text className={`text-xs font-semibold text-center ${
                        newAccountType === type ? "text-white" : "text-gray-700"
                      }`}>{type}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
          )}

          {existingAibAccounts.length > 0 && (
            <>
              <Text className="text-sm font-semibold text-gray-700 mb-3">Existing Accounts</Text>
              <View className="gap-2">
                {existingAibAccounts.map((acc) => (
                  <Pressable
                    key={acc.key}
                    onPress={() => {
                      setSelectedAccountKey(acc.key);
                      setIsCreatingNewAccount(false);
                    }}
                    className={`p-4 rounded-xl border-2 ${
                      selectedAccountKey === acc.key && !isCreatingNewAccount
                        ? "bg-sky-50 border-sky-500"
                        : "bg-white border-gray-200"
                    }`}
                  >
                    <Text className="text-sm font-semibold text-gray-800">{acc.name}</Text>
                    <Text className="text-xs text-gray-500 mt-1">{acc.type}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {/* Fixed Bottom Button */}
      <View className="absolute bottom-0 left-0 right-0 px-5 pb-6 pt-4 bg-white border-t border-gray-200">
        <Pressable
          onPress={handleContinue}
          className="rounded-2xl bg-sky-500 py-4 items-center active:opacity-80"
        >
          <Text className="text-white text-base font-bold">Continue to Review</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
