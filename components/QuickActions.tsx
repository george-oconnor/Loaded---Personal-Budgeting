import type { QuickAction } from "@/types/type";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

export default function QuickActions({ actions }: { actions: QuickAction[] }) {
  const handleActionPress = (actionId: string) => {
    switch (actionId) {
      case "add":
        router.push("/add-transaction");
        break;
      case "import":
        router.push("/import");
        break;
      case "analytics":
        router.push("/spend-analytics");
        break;
      case "balances":
        router.push("/balances");
        break;
      default:
        break;
    }
  };

  return (
    <View className="flex-row gap-4 mt-5">
      {actions.map((action) => (
        <Pressable
          key={action.id}
          onPress={() => handleActionPress(action.id)}
          className="flex-1 items-center rounded-2xl bg-white py-3 shadow-sm border border-gray-100 active:opacity-80"
        >
          <View className="h-10 w-10 items-center justify-center rounded-full bg-primary/10 mb-2">
            <Feather name={action.icon as any} size={18} color="#FE8C00" />
          </View>
          <Text className="text-dark-100 font-semibold">{action.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
