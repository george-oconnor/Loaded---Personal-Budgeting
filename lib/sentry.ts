import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import * as Application from "expo-application";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

// Last-known identity, cached in plain AsyncStorage (not SecureStore) so it's
// readable even when the Keychain is locked. checkSession() only runs once
// _layout.tsx's RootLayout mounts and the app is foregrounded, so a headless
// background-task launch (or a crash during a locked-device cold start)
// would otherwise never call setUser() at all and Sentry would only ever see
// an anonymous installation id for those events.
const CACHED_USER_KEY = "sentry_cached_user";

export function initSentry() {
  if (!dsn) {
    console.warn("⚠️ Sentry DSN not configured. Error tracking disabled.");
    return;
  }

  const appId = Application.applicationId ?? "unknown.app";
  const appVersion = Application.nativeApplicationVersion ?? "0.0.0";
  const buildNumber = Application.nativeBuildVersion ?? "0";
  const release = `${appId}@${appVersion}+${buildNumber}`;

  Sentry.init({
    dsn,
    // Set tracesSampleRate to 1.0 to capture 100% of transactions for performance monitoring.
    // We recommend adjusting this value in production
    tracesSampleRate: 1.0,
    // Set environment based on Expo release channel or default to development
    environment: __DEV__ ? "development" : "production",
    release,
    dist: buildNumber,
    // Enable native crash reporting
    enableNative: true,
    // Enable auto session tracking
    enableAutoSessionTracking: true,
    // Enable automatic breadcrumbs
    enableNativeCrashHandling: true,
  });

  console.log("✅ Sentry initialized", { release, dist: buildNumber });

  restoreCachedUser();
}

// Applies the last-known user identity as soon as Sentry is initialized,
// ahead of (and independent of) the real checkSession() flow. Runs in every
// JS process, including headless background-task launches.
async function restoreCachedUser() {
  try {
    const raw = await AsyncStorage.getItem(CACHED_USER_KEY);
    if (raw) {
      Sentry.setUser(JSON.parse(raw));
    }
  } catch {
    // Best-effort only — a miss just means events fall back to the anonymous id.
  }
}

// Helper to capture exceptions manually
export function captureException(
  error: Error,
  options?: {
    contexts?: Record<string, any>;
    tags?: Record<string, string>;
  }
) {
  Sentry.withScope((scope) => {
    if (options?.contexts) {
      for (const [key, value] of Object.entries(options.contexts)) {
        scope.setContext(key, value);
      }
    }
    if (options?.tags) {
      scope.setTags(options.tags);
    }
    Sentry.captureException(error);
  });
}

// Helper to capture messages with optional contexts/tags
export function captureMessage(
  message: string,
  options?: {
    level?: Sentry.SeverityLevel;
    contexts?: Record<string, any>;
    tags?: Record<string, string>;
  }
) {
  Sentry.withScope((scope) => {
    if (options?.contexts) {
      for (const [key, value] of Object.entries(options.contexts)) {
        scope.setContext(key, value);
      }
    }
    if (options?.tags) {
      scope.setTags(options.tags);
    }
    Sentry.captureMessage(message, options?.level ?? "info");
  });
}

// Helper to set user context
export function setUser(user: { id: string; email?: string; username?: string }) {
  Sentry.setUser(user);
  AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(user)).catch(() => {});
}

// Helper to clear user context
export function clearUser() {
  Sentry.setUser(null);
  AsyncStorage.removeItem(CACHED_USER_KEY).catch(() => {});
}

// Helper to time an operation as a Sentry performance span (visible in the
// Sentry dashboard under Performance, grouped by `name`/`op`).
export function withSpan<T>(
  name: string,
  op: string,
  attributes: Record<string, string | number | boolean> | undefined,
  callback: () => T | Promise<T>
): T | Promise<T> {
  return Sentry.startSpan({ name, op, attributes }, callback);
}

// Helper to add breadcrumbs for tracking user flow
export function addBreadcrumb(breadcrumb: {
  message: string;
  category?: string;
  level?: Sentry.SeverityLevel;
  data?: Record<string, any>;
}) {
  Sentry.addBreadcrumb(breadcrumb);
}

// Export ErrorBoundary for wrapping components
export const ErrorBoundary = Sentry.ErrorBoundary;
