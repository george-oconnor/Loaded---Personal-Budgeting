import { getTransactionsInRangeAll } from "@/lib/appwrite";
import { getMerchantIconUrl, getSuggestedMerchantIcon } from "@/lib/merchantIcons";
import { useHomeStore } from "@/store/useHomeStore";
import { useSessionStore } from "@/store/useSessionStore";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type MerchantGroup = {
  name: string;
  displayName: string;
  count: number;
  categoryId: string;
};

const MerchantIcon = memo(function MerchantIcon({ name }: { name: string }) {
  const [tldIndex, setTldIndex] = useState(0);
  const [iconFailed, setIconFailed] = useState(false);
  const [crowdSourcedUrl, setCrowdSourcedUrl] = useState<string | null>(null);
  const [crowdSourcedFailed, setCrowdSourcedFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    setCrowdSourcedUrl(null);
    setCrowdSourcedFailed(false);
    setIconFailed(false);
    setTldIndex(0);

    if (name) {
      getSuggestedMerchantIcon(name, 64)
        .then((url) => mounted && setCrowdSourcedUrl(url))
        .catch(() => mounted && setCrowdSourcedUrl(null));
    }
    return () => { mounted = false; };
  }, [name]);

  const effectiveCrowdSourced = crowdSourcedUrl && !crowdSourcedFailed ? crowdSourcedUrl : null;
  const builtInUrl = iconFailed ? null : getMerchantIconUrl(name, 64, tldIndex);
  const iconUrl = effectiveCrowdSourced || (iconFailed ? null : builtInUrl);
  const isCrowdSourced = effectiveCrowdSourced && iconUrl === effectiveCrowdSourced;

  const handleError = () => {
    if (isCrowdSourced) { setCrowdSourcedFailed(true); return; }
    if (tldIndex < 2) { setTldIndex(tldIndex + 1); return; }
    setIconFailed(true);
  };

  if (iconUrl) {
    return (
      <View
        className="w-10 h-10 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB" }}
      >
        <Image
          source={{ uri: iconUrl }}
          style={{ width: 32, height: 32, borderRadius: 16 }}
          resizeMode="contain"
          onError={handleError}
        />
      </View>
    );
  }

  return (
    <View
      className="w-10 h-10 rounded-full items-center justify-center mr-3"
      style={{ backgroundColor: "#6C63FF20" }}
    >
      <Feather name="repeat" size={18} color="#6C63FF" />
    </View>
  );
});

export default function FindSubscriptionScreen() {
  const { user } = useSessionStore();
  const { categories } = useHomeStore();
  const [search, setSearch] = useState("");
  const [merchants, setMerchants] = useState<MerchantGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const end = new Date();
      const start = new Date();
      start.setFullYear(start.getFullYear() - 1);

      const docs = await getTransactionsInRangeAll(user.id, start.toISOString(), end.toISOString());
      if (cancelled) return;

      // Group expenses by merchant name, excluding already-claimed transactions
      const groups = new Map<string, { displayName: string; count: number; categoryId: string }>();
      for (const d of docs) {
        if ((d as any).kind !== "expense") continue;
        if ((d as any).subscriptionId) continue; // Already linked to a subscription
        const displayName = (d as any).displayName || (d as any).title || "";
        const key = displayName.toLowerCase().trim();
        if (!key) continue;

        const existing = groups.get(key);
        if (existing) {
          existing.count++;
        } else {
          groups.set(key, {
            displayName,
            count: 1,
            categoryId: (d as any).categoryId ?? "",
          });
        }
      }

      const result: MerchantGroup[] = [];
      for (const [key, val] of groups) {
        if (val.count > 0) {
          result.push({
            name: key,
            displayName: val.displayName,
            count: val.count,
            categoryId: val.categoryId,
          });
        }
      }

      result.sort((a, b) => b.count - a.count);

      setMerchants(result);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  const filtered = useMemo(() => {
    if (!search.trim()) return merchants;
    const q = search.toLowerCase().trim();
    return merchants.filter((m) => m.displayName.toLowerCase().includes(q));
  }, [merchants, search]);

  const handleSelect = useCallback((merchant: MerchantGroup) => {
    router.push({
      pathname: "/create-subscription",
      params: {
        merchantName: merchant.displayName,
        categoryId: merchant.categoryId,
      },
    });
  }, []);

  const renderItem = useCallback(({ item }: { item: MerchantGroup }) => {
    const cat = categories.find((c: any) => c.id === item.categoryId);
    return (
      <Pressable
        onPress={() => handleSelect(item)}
        className="flex-row items-center px-5 py-3.5 border-b border-gray-100 bg-white active:bg-gray-50"
      >
        <MerchantIcon name={item.displayName} />
        <View className="flex-1 mr-2">
          <Text className="text-dark-100 font-semibold text-[15px]" numberOfLines={1}>
            {item.displayName}
          </Text>
          <Text className="text-gray-500 text-xs mt-0.5">
            {item.count} transaction{item.count !== 1 ? "s" : ""}
            {cat ? ` · ${cat.name}` : ""}
          </Text>
        </View>
        <Feather name="chevron-right" size={16} color="#9CA3AF" />
      </Pressable>
    );
  }, [categories, handleSelect]);

  return (
    <SafeAreaView className="flex-1 bg-white">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-2 pb-3">
        <Pressable onPress={() => router.back()} className="mr-3 p-1">
          <Feather name="chevron-left" size={24} color="#1F2937" />
        </Pressable>
        <Text className="text-xl font-bold text-dark-100 flex-1">Find a Subscription</Text>
      </View>

      {/* Search */}
      <View className="px-5 pb-3">
        <View className="flex-row items-center bg-gray-50 rounded-xl px-3 py-2.5">
          <Feather name="search" size={16} color="#9CA3AF" />
          <TextInput
            className="flex-1 ml-2 text-dark-100 text-sm"
            placeholder="Search merchants..."
            placeholderTextColor="#9CA3AF"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x-circle" size={16} color="#9CA3AF" />
            </Pressable>
          )}
        </View>
      </View>

      <Text className="px-5 pb-2 text-gray-500 text-xs">
        Select a merchant to set up as a subscription.
      </Text>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#FE8C00" />
          <Text className="text-gray-500 mt-3 text-sm">Loading merchants...</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Feather name="search" size={28} color="#9CA3AF" />
          <Text className="text-gray-500 text-sm text-center mt-3">
            {search ? "No merchants found matching your search." : "No merchants found in your transaction history."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.name}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </SafeAreaView>
  );
}
