import { router, useSegments } from "expo-router";
import { useEffect } from "react";
import { Text, View } from "react-native";

export default function NotFoundScreen() {
  const segments = useSegments();

  useEffect(() => {
    // If the user somehow hits an unknown route, send them to the auth flow by default.
    const inAuth = segments[0] === "auth";
    if (!inAuth) {
      router.replace("/auth");
    }
  }, [segments]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ fontSize: 18, fontWeight: "600", marginBottom: 8 }}>Page not found</Text>
      <Text style={{ fontSize: 14, color: "#4B5563", textAlign: "center" }}>
        Redirecting you to the sign in screen.
      </Text>
    </View>
  );
}
