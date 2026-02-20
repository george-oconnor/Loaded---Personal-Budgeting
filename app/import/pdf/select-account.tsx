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

export default function PdfSelectAccountScreen() {
  const { user } = useSessionStore();
  const params = useLocalSearchParams();
  const transactionCount = params.transactionCount as string;
  const detectedBalance = params.detectedBalance as string | undefined;

  const [existingAccounts, setExistingAccounts] = useState<ExistingAccount[]>(
    []
  );
  const [selectedAccountKey, setSelectedAccountKey] = useState<string | null>(
    null
  );
  const [isCreatingNewAccount, setIsCreatingNewAccount] = useState(true);
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountType, setNewAccountType] = useState("Current");
  const [newAccountCurrency, setNewAccountCurrency] = useState("EUR");
  const [newAccountBalance, setNewAccountBalance] = useState(
    detectedBalance || ""
  );

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
      const slug = newAccountName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);
      accountKey = `pdf-${newAccountType.toLowerCase()}-${newAccountCurrency}-${slug}-${Date.now()}`;
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
      const selected = existingAccounts.find(
        (a) => a.key === selectedAccountKey
      );
      if (!selected) {
        alert("Selected account not found");
        return;
      }
      accountKey = selectedAccountKey;
      accountName = selected.name;
      accountType = selected.type;
      accountCurrency = selected.currency;
    }

    router.push({
      pathname: "/import/pdf/preview",
      params: {
        selectedAccountKey: accountKey,
        selectedAccountName: accountName,
        selectedAccountType: accountType,
        selectedAccountCurrency: accountCurrency,
        initialBalance: initialBalance,
        isNewAccount: isNewAccount ? "true" : "false",
      },
    } as any);
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
          <Text className="text-2xl font-bold text-dark-100">
            Select Account
          </Text>
          <Text className="text-sm text-gray-500 mt-1">
            Choose which account to associate with {transactionCount}{" "}
            transactions from PDF
          </Text>
        </View>

        <View className="px-5 py-4">
          {/* Create New Account */}
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
                ? "bg-violet-50 border-violet-500"
                : "bg-white border-gray-200"
            }`}
          >
            <View
              className={`w-10 h-10 rounded-full items-center justify-center ${
                isCreatingNewAccount ? "bg-violet-500" : "bg-gray-100"
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
                  style={{
                    minHeight: 48,
                    lineHeight: 24,
                    paddingVertical: 12,
                  }}
                  className="bg-white border border-gray-300 rounded-xl px-4 py-3 text-base font-normal"
                />
              </View>

              <View>
                <Text className="text-xs font-semibold text-gray-700 mb-2">
                  Account Type
                </Text>
                <View className="flex-row gap-2">
                  {["Current", "Savings", "Credit Card", "Loan"].map(
                    (type) => (
                      <Pressable
                        key={type}
                        onPress={() => setNewAccountType(type)}
                        className={`flex-1 p-3 rounded-xl border-2 ${
                          newAccountType === type
                            ? "bg-violet-50 border-violet-500"
                            : "bg-white border-gray-200"
                        }`}
                      >
                        <Text
                          className={`text-xs text-center font-semibold ${
                            newAccountType === type
                              ? "text-violet-700"
                              : "text-gray-600"
                          }`}
                        >
                          {type}
                        </Text>
                      </Pressable>
                    )
                  )}
                </View>
              </View>

              <View>
                <Text className="text-xs font-semibold text-gray-700 mb-2">
                  Currency
                </Text>
                <View className="flex-row gap-2">
                  {["EUR", "GBP", "USD"].map((curr) => (
                    <Pressable
                      key={curr}
                      onPress={() => setNewAccountCurrency(curr)}
                      className={`flex-1 p-3 rounded-xl border-2 ${
                        newAccountCurrency === curr
                          ? "bg-violet-50 border-violet-500"
                          : "bg-white border-gray-200"
                      }`}
                    >
                      <Text
                        className={`text-xs text-center font-semibold ${
                          newAccountCurrency === curr
                            ? "text-violet-700"
                            : "text-gray-600"
                        }`}
                      >
                        {curr}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {detectedBalance && (
                <View>
                  <Text className="text-xs font-semibold text-gray-700 mb-2">
                    Detected Balance
                  </Text>
                  <TextInput
                    value={newAccountBalance}
                    onChangeText={setNewAccountBalance}
                    placeholder="0.00"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="decimal-pad"
                    className="bg-white border border-gray-300 rounded-xl px-4 py-3 text-base font-normal"
                  />
                </View>
              )}
            </View>
          )}

          {/* Existing Accounts */}
          {existingAccounts.length > 0 && (
            <>
              <Text className="text-sm font-semibold text-gray-700 mb-3">
                Or Use Existing Account
              </Text>
              <View className="gap-2 mb-6">
                {existingAccounts.map((account) => (
                  <Pressable
                    key={account.key}
                    onPress={() => {
                      setIsCreatingNewAccount(false);
                      setSelectedAccountKey(account.key);
                    }}
                    className={`p-4 rounded-xl border-2 flex-row items-center gap-3 ${
                      !isCreatingNewAccount &&
                      selectedAccountKey === account.key
                        ? "bg-violet-50 border-violet-500"
                        : "bg-white border-gray-200"
                    }`}
                  >
                    <View className="w-10 h-10 rounded-full bg-gray-100 items-center justify-center">
                      <Feather
                        name="credit-card"
                        size={18}
                        color="#6B7280"
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-gray-800">
                        {account.name}
                      </Text>
                      <Text className="text-xs text-gray-500">
                        {account.type} • {account.currency}
                      </Text>
                    </View>
                    {!isCreatingNewAccount &&
                      selectedAccountKey === account.key && (
                        <Feather
                          name="check-circle"
                          size={20}
                          color="#8B5CF6"
                        />
                      )}
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>

      {/* Bottom Action */}
      <View className="px-5 py-4 border-t border-gray-200">
        <Pressable
          onPress={handleContinue}
          className="w-full bg-violet-500 py-4 rounded-2xl items-center active:opacity-80"
        >
          <View className="flex-row items-center gap-2">
            <Feather name="arrow-right" size={18} color="white" />
            <Text className="text-white font-bold text-base">
              Continue to Preview
            </Text>
          </View>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
