import * as Sentry from "@sentry/react-native";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export function initSentry() {
  if (!dsn) {
    console.warn("⚠️ Sentry DSN not configured. Error tracking disabled.");
    return;
  }

  Sentry.init({
    dsn,
    // Set tracesSampleRate to 1.0 to capture 100% of transactions for performance monitoring.
    // We recommend adjusting this value in production
    tracesSampleRate: 1.0,
    // Set environment based on Expo release channel or default to development
    environment: __DEV__ ? "development" : "production",
    // Enable native crash reporting
    enableNative: true,
    // Enable auto session tracking
    enableAutoSessionTracking: true,
    // Enable automatic breadcrumbs
    enableNativeCrashHandling: true,
  });

  console.log("✅ Sentry initialized");
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
}

// Helper to clear user context
export function clearUser() {
  Sentry.setUser(null);
}
