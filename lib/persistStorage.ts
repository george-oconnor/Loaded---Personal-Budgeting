/**
 * Debounced persistence for Zustand stores.
 *
 * Zustand's `persist` middleware serializes and writes the store on *every*
 * setState. For stores that update frequently (home/subscriptions during
 * import + sync), that repeated JSON.stringify + AsyncStorage write janks the
 * JS thread and makes taps feel laggy. This custom PersistStorage keeps the
 * latest value in memory and flushes (serialize + write) at most once per
 * `delayMs`, so bursts of updates cost a single write. It also flushes when the
 * app backgrounds so nothing meaningful is lost.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import type { PersistStorage, StorageValue } from "zustand/middleware";

const pending = new Map<string, StorageValue<any>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function flush(name: string) {
  const timer = timers.get(name);
  if (timer) {
    clearTimeout(timer);
    timers.delete(name);
  }
  const value = pending.get(name);
  if (value !== undefined) {
    pending.delete(name);
    AsyncStorage.setItem(name, JSON.stringify(value)).catch(() => {});
  }
}

// Flush all pending writes when the app leaves the foreground.
AppState.addEventListener("change", (state) => {
  if (state !== "active") {
    for (const name of Array.from(pending.keys())) flush(name);
  }
});

export function debouncedPersistStorage(delayMs = 1200): PersistStorage<any> {
  return {
    getItem: async (name) => {
      const raw = await AsyncStorage.getItem(name);
      return raw ? JSON.parse(raw) : null;
    },
    setItem: (name, value) => {
      pending.set(name, value);
      const existing = timers.get(name);
      if (existing) clearTimeout(existing);
      timers.set(name, setTimeout(() => flush(name), delayMs));
    },
    removeItem: async (name) => {
      const timer = timers.get(name);
      if (timer) clearTimeout(timer);
      timers.delete(name);
      pending.delete(name);
      await AsyncStorage.removeItem(name);
    },
  };
}
