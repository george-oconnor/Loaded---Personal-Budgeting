import { Pressable, ScrollView, Text } from "react-native";
import type { Category } from "@/types/type";

export default function CategoryChips({
  categories,
  selected,
  onSelect,
}: {
  categories: Category[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="mt-5"
      contentContainerStyle={{ gap: 10 }}
    >
      {categories.map((cat) => {
        const active = selected === cat.id;
        return (
          <Pressable
            key={cat.id}
            onPress={() => onSelect(cat.id)}
            className={`px-4 py-2 rounded-full border ${
              active ? "bg-dark-100 border-dark-100" : "border-gray-200 bg-white"
            }`}
          >
            <Text
              className={`text-sm font-semibold ${
                active ? "text-white" : "text-dark-100"
              }`}
            >
              {cat.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
