import { getAccountBalances } from "@/lib/accountBalances";
import { useSessionStore } from "@/store/useSessionStore";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
    Pressable,
    SafeAreaView,
    ScrollView,
    Text,
    TextInput,
    View,
} from "react-native";

interface ExistingAccount {
  key: string;
  name: string;
  type: string;
  provider: string;
  currency: string;
}

export default function CSVSelectAccountScreen() {
  const { user } = useSessionStore();
  const params = useLocalSearchParams();
  const transactionCount = params.transactionCount as string;
  const detectedBalance = params.detectedBalance as string | undefined;

  const [existingAccounts, setExistingAccounts] = useState<ExistingAccount[]>([]);
  const [selectedAccountKey, setSelectedAccountKey] = useState<string | null>(null);
  const [isCreatingNewAccount, setIsCreatingNewAccount] = useState(true); // Default to creating new
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountType, setNewAccountType] = useState("Current");
  const [newAccountCurrency, setNewAccountCurrency] = useState("EUR");
  const [newAccountBalance, setNewAccountBalance] = useState(detectedBalance || "");

  useEffect(() => {
    const loadAccounts = async () => {
      if (!user?.id) return;
      try {
        const balances = await getAccountBalances(user.id);
        const accounts = balances
          .filter((b) => b.accountKey)
          .map((b) => ({
            key: b.accountKey!,
            name: b.accountName,
            type: b.accountType || "Current",
            provider: b.provider || "other",
            currency: b.currency || "EUR",
          }));
        setExistingAccounts(accounts);

        // If there are existing accounts, default to selecting first one
        if (accounts.length > 0) {
          setIsCreatingNewAccount(false);
          setSelectedAccountKey(accounts[0].key);
        }
      } catch (err) {
        console.error("Failed to load accounts:", err);
      }
    };
    loadAccounts();
  }, [user?.id]);

  const handleContinue = () => {
    let accountKey: string;
    let accountName: string;
    let accountType: string;
    let accountCurrency: string;
    let initialBalance: string = "";
    let isNewAccount: boolean = false;

    if (isCreatingNewAccount) {
      if (!newAccountName.trim()) {
        alert("Please enter an account name");
        return;
      }
      // Create new account key
      const slug = newAccountName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);
      accountKey = `csv-${newAccountType.toLowerCase()}-${newAccountCurrency}-${slug}-${Date.now()}`;
      accountName = newAccountName.trim();
      accountType = newAccountType;
      accountCurrency = newAccountCurrency;
      initialBalance = newAccountBalance;
      isNewAccount = true;
    } else {
      if (!selectedAccountKey) {
        alert("Please select or create an account");
        return;
      }
      const selected = existingAccounts.find((a) => a.key === selectedAccountKey);
      if (!selected) {
        alert("Selected account not found");
        return;
      }
      accountKey = selectedAccountKey;
      accountName = selected.name;
      accountType = selected.type;
      accountCurrency = selected.currency;
    }

    // Navigate to preview with account info
    router.push({
      pathname: "/import/csv/preview",
      params: {
        selectedAccountKey: accountKey,
        selectedAccountName: accountName,
        selectedAccountType: accountType,
        selectedAccountCurrency: accountCurrency,
        initialBalance: initialBalance,
        isNewAccount: isNewAccount ? "true" : "false",
      },
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View className="px-5 pt-5 pb-4 border-b border-gray-100">
          <Pressable
            onPress={() => router.back()}
            className="mb-4 flex-row items-center gap-2"
          >
            <Text className="text-primary text-base">← Back</Text>
          </Pressable>
          <Text className="text-2xl font-bold text-dark-100">Select Account</Text>
          <Text className="text-sm text-gray-500 mt-1">
            Choose which account to associate with {transactionCount} transactions
          </Text>
        </View>

        {/* Account Selection */}
        <View className="px-5 py-4">
          {/* Create New Account Option */}
          <Text className="text-sm font-semibold text-gray-700 mb-3">
            Create New Account
          </Text>

          <Pressable
            onPress={() => {
              setIsCreatingNewAccount(true);
              setSelectedAccountKey(null);
            }}
            className={`p-4 rounded-xl border-2 mb-4 flex-row items-center gap-3 ${
              isCreatingNewAccount
                ? "bg-emerald-50 border-emerald-500"
                : "bg-white border-gray-200"
            }`}
          >
            <View
              className={`w-10 h-10 rounded-full items-center justify-center ${
                isCreatingNewAccount ? "bg-emerald-500" : "bg-gray-100"
              }`}
            >
              <Feather
                name="plus"
                size={20}
                color={isCreatingNewAccount ? "white" : "#6B7280"}
              />
            </View>
            <Text className="text-sm font-semibold text-gray-800">
              Create New Account
            </Text>
          </Pressable>

          {isCreatingNewAccount && (
            <View className="gap-4 p-4 bg-gray-50 rounded-xl mb-6">
              {/* Account Name */}
              <View>
                <Text className="text-xs font-semibold text-gray-700 mb-2">
                  Account Name
                </Text>
                <TextInput
                  value={newAccountName}
                  onChangeText={setNewAccountName}
                  placeholder="e.g., Bank of Ireland Current"
                  placeholderTextColor="#9CA3AF"
                  multiline={false}
                  style={{ minHeight: 48, lineHeight: 24, paddingVertical: 12 }}
                  className="bg-white border border-gray-300 rounded-xl px-4 py-3 text-base font-normal"
                />
              </View>

              {/* Account Type */}
              <View>
                <Text className="text-xs font-semibold text-gray-700 mb-2">
                  Account Type
                </Text>
                <View className="flex-row gap-2">
                  {["Current", "Savings", "Credit Card", "Loan"].map((type) => (
                    <Pressable
                      key={type}
                      onPress={() => setNewAccountType(type)}
                      className={`flex-1 p-3 rounded-xl border-2 ${
                        newAccountType === type
                          ? "bg-emerald-500 border-emerald-500"
                          : "bg-white border-gray-200"
                      }`}
                    >
                      <Text
                        className={`text-xs font-semibold text-center ${
                          newAccountType === type ? "text-white" : "text-gray-700"
                        }`}
                      >
                        {type}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Currency */}
              <View>
                <Text className="text-xs font-semibold text-gray-700 mb-2">
                  Currency
                </Text>
                <View className="flex-row gap-2">
                  {["EUR", "GBP", "USD"].map((currency) => (
                    <Pressable
                      key={currency}
                      onPress={() => setNewAccountCurrency(currency)}
                      className={`flex-1 p-3 rounded-xl border-2 ${
                        newAccountCurrency === currency
                          ? "bg-emerald-500 border-emerald-500"
                          : "bg-white border-gray-200"
                      }`}
                    >
                      <Text
                        className={`text-xs font-semibold text-center ${
                          newAccountCurrency === currency
                            ? "text-white"
                            : "text-gray-700"
                        }`}
                      >
                        {currency}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Initial Balance (Optional) */}
              <View>
                <View className="flex-row items-center gap-2 mb-1">
                  <Text className="text-xs font-semibold text-gray-700">
                    Current Balance
                  </Text>
                  {detectedBalance && (
                    <View className="px-2 py-0.5 bg-emerald-100 rounded">
                      <Text className="text-[10px] font-semibold text-emerald-700">
                        Auto-detected from CSV
                      </Text>
                    </View>
                  )}
                </View>
                <Text className="text-xs text-gray-500 mb-2">
                  {detectedBalance 
                    ? "This balance was found in your most recent transaction"
                    : "Enter the current balance of this account to track it going forward"
                  }
                </Text>
                <TextInput
                  value={newAccountBalance}
                  onChangeText={setNewAccountBalance}
                  placeholder="e.g., 1500.00"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="decimal-pad"
                  multiline={false}
                  style={{ minHeight: 48, lineHeight: 24, paddingVertical: 12 }}
                  className="bg-white border border-gray-300 rounded-xl px-4 py-3 text-base font-normal"
                />
              </View>
            </View>
          )}

          {/* Existing Accounts */}
          {existingAccounts.length > 0 && (
            <>
              <Text className="text-sm font-semibold text-gray-700 mb-3">
                Or Use Existing Account
              </Text>
              <View className="gap-2 mb-6">
                {existingAccounts.map((acc) => (
                  <Pressable
                    key={acc.key}
                    onPress={() => {
                      setSelectedAccountKey(acc.key);
                      setIsCreatingNewAccount(false);
                    }}
                    className={`p-4 rounded-xl border-2 flex-row items-center gap-3 ${
                      selectedAccountKey === acc.key && !isCreatingNewAccount
                        ? "bg-emerald-50 border-emerald-500"
                        : "bg-white border-gray-200"
                    }`}
                  >
                    <View
                      className={`w-10 h-10 rounded-full items-center justify-center ${
                        selectedAccountKey === acc.key && !isCreatingNewAccount
                          ? "bg-emerald-500"
                          : "bg-gray-100"
                      }`}
                    >
                      <Feather
                        name="credit-card"
                        size={18}
                        color={
                          selectedAccountKey === acc.key && !isCreatingNewAccount
                            ? "white"
                            : "#6B7280"
                        }
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-gray-800">
                        {acc.name}
                      </Text>
                      <Text className="text-xs text-gray-500 mt-0.5">
                        {acc.type} • {acc.currency}
                      </Text>
                    </View>
                    {selectedAccountKey === acc.key && !isCreatingNewAccount && (
                      <Feather name="check-circle" size={20} color="#10B981" />
                    )}
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
          className="rounded-2xl bg-emerald-500 py-4 items-center active:opacity-80"
        >
          <Text className="text-white text-base font-bold">Continue to Review</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
