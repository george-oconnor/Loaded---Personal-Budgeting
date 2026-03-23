import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Pressable, View, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const TAB_CONFIG: Record<string, { label: string; icon: keyof typeof Feather.glyphMap }> = {
  index: { label: "Home", icon: "home" },
  import: { label: "Import", icon: "download" },
  search: { label: "Search", icon: "search" },
};

function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        position: "absolute",
        bottom: insets.bottom + 12,
        left: 20,
        right: 20,
        backgroundColor: "#181C2E",
        borderRadius: 28,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-evenly",
        height: 64,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
        elevation: 12,
      }}
    >
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const config = TAB_CONFIG[route.name];
        if (!config) return null;

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={config.label}
            style={{
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: 8,
              paddingHorizontal: 20,
            }}
          >
            <Feather
              name={config.icon}
              size={22}
              color={isFocused ? "#FE8C00" : "#9CA3AF"}
            />
            <Text
              style={{
                fontSize: 11,
                marginTop: 4,
                fontFamily: isFocused ? "QuickSand-SemiBold" : "QuickSand-Medium",
                color: isFocused ? "#FE8C00" : "#9CA3AF",
              }}
            >
              {config.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="import" />
      <Tabs.Screen name="search" />
    </Tabs>
  );
}
