import { createAccount, createUserProfile, deleteUserAccount, getCurrentSession, getCurrentUser, signIn, signOut, updateUserProfile, USE_CLOUDKIT } from "@/lib/backend";
import {
  activateCloudKitSession,
  checkICloud,
  clearStoredIdentity,
  getStoredIdentity,
  isAppleCancel,
  isAppleCredentialValid,
  signInWithApple,
  type AppleIdentity,
} from "@/lib/auth";
import { queueDeleteAll } from "@/lib/deleteQueue";
import { resetMigrationFlag } from "@/lib/migration";
import { hasOnboarded, resetOnboarding, setOnboarded } from "@/lib/onboarding";
import { addBreadcrumb, captureException, clearUser as clearSentryUser, setUser as setSentryUser } from "@/lib/sentry";
import type { SessionState } from "@/types/type";
import { create } from "zustand";

const identityToUser = (identity: AppleIdentity, name?: string, email?: string) => ({
  id: identity.appleUserId,
  email: email ?? identity.email,
  name: name ?? identity.fullName,
});

// A user who already has a CloudKit profile name (returning/migrated) has
// effectively onboarded; only brand-new accounts without a name see the flow.
async function resolveNeedsOnboarding(name?: string): Promise<boolean> {
  const done = await hasOnboarded();
  const isReturning = !!(name && name.trim());
  if (isReturning && !done) {
    await setOnboarded();
    return false;
  }
  return !done && !isReturning;
}

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  token: null,
  status: "idle",
  error: null,
  needsOnboarding: false,

  checkSession: async () => {
    set({ status: "loading" });

    // ── CloudKit (Sign in with Apple + private iCloud database) ──
    if (USE_CLOUDKIT) {
      try {
        const identity = await getStoredIdentity();
        if (!identity) {
          set({ user: null, token: null, status: "unauthenticated", error: null });
          return;
        }
        if (!(await isAppleCredentialValid(identity.appleUserId))) {
          await clearStoredIdentity();
          set({ user: null, token: null, status: "unauthenticated", error: null });
          return;
        }
        if ((await checkICloud()) !== "available") {
          // Signed in, but the device has no usable iCloud account — data is
          // unreachable until they sign in. ICloudGate handles this state.
          set({ user: identityToUser(identity), token: null, status: "icloud-unavailable", error: null });
          return;
        }
        const { userRecordName, name, email } = await activateCloudKitSession(identity);
        const needsOnboarding = await resolveNeedsOnboarding(name);
        setSentryUser({ id: identity.appleUserId, email: email ?? identity.email, username: name });
        set({ user: identityToUser(identity, name, email), token: userRecordName, status: "authenticated", error: null, needsOnboarding });
        updateUserProfile(identity.appleUserId, { lastLoginTime: new Date().toISOString() }).catch(() => {});
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to restore session";
        captureException(err instanceof Error ? err : new Error(errorMsg));
        set({ user: null, token: null, status: "unauthenticated", error: errorMsg });
      }
      return;
    }

    // ── Appwrite (email/password) ──
    try {
      const session = await getCurrentSession();
      if (!session) {
        set({ user: null, token: null, status: "unauthenticated", error: null });
        return;
      }

      const user = await getCurrentUser();
      if (user) {
        setSentryUser({ id: user.$id, email: user.email, username: user.name });
        set({ user: { id: user.$id, email: user.email, name: user.name }, token: session.$id, status: "authenticated", error: null });
        updateUserProfile(user.$id, { lastLoginTime: new Date().toISOString() }).catch(() => {});
        return;
      }

      set({ user: null, token: null, status: "unauthenticated", error: null });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to check session";
      captureException(err instanceof Error ? err : new Error(errorMsg));
      set({ user: null, token: null, status: "unauthenticated", error: errorMsg });
    }
  },

  loginWithApple: async () => {
    set({ status: "loading", error: null });
    try {
      addBreadcrumb({ message: "Sign in with Apple attempt", category: "auth" });
      const identity = await signInWithApple();

      if ((await checkICloud()) !== "available") {
        set({ user: identityToUser(identity), token: null, status: "icloud-unavailable", error: null });
        return;
      }

      const { userRecordName, name, email } = await activateCloudKitSession(identity);
      const needsOnboarding = await resolveNeedsOnboarding(name);
      setSentryUser({ id: identity.appleUserId, email: email ?? identity.email, username: name });
      addBreadcrumb({ message: "Sign in with Apple successful", category: "auth", level: "info", data: { userId: identity.appleUserId } });
      set({ user: identityToUser(identity, name, email), token: userRecordName, status: "authenticated", error: null, needsOnboarding });
      updateUserProfile(identity.appleUserId, { lastLoginTime: new Date().toISOString() }).catch(() => {});
    } catch (err) {
      if (isAppleCancel(err)) {
        set({ status: "unauthenticated", error: null });
        return;
      }
      const errorMsg = err instanceof Error ? err.message : "Sign in failed";
      captureException(err instanceof Error ? err : new Error(errorMsg), {
        tags: { operation: "sign_in_apple", feature: "auth" },
      });
      set({ status: "error", error: errorMsg });
      throw err;
    }
  },

  // Re-evaluate iCloud availability (e.g. from the ICloudGate "Retry" button).
  recheckICloud: async () => {
    const identity = await getStoredIdentity();
    if (!identity) {
      set({ user: null, token: null, status: "unauthenticated", error: null });
      return;
    }
    if ((await checkICloud()) !== "available") {
      set({ user: identityToUser(identity), token: null, status: "icloud-unavailable", error: null });
      return;
    }
    try {
      const { userRecordName, name } = await activateCloudKitSession(identity);
      setSentryUser({ id: identity.appleUserId, email: identity.email, username: name });
      set({ user: identityToUser(identity, name), token: userRecordName, status: "authenticated", error: null });
    } catch {
      set({ user: identityToUser(identity), token: null, status: "icloud-unavailable", error: null });
    }
  },

  setUserName: async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const state = useSessionStore.getState();
    const userId = state.user?.id;
    const [firstName, ...rest] = trimmed.split(" ");
    if (userId) {
      await updateUserProfile(userId, { firstName: firstName ?? "", lastName: rest.join(" ") }).catch(() => {});
    }
    setSentryUser({ id: userId ?? "", email: state.user?.email, username: trimmed });
    set({ user: state.user ? { ...state.user, name: trimmed } : state.user });
  },

  completeOnboarding: async () => {
    await setOnboarded();
    set({ needsOnboarding: false });
  },

  login: async (email: string, password: string) => {
    set({ status: "loading", error: null });
    try {
      addBreadcrumb({ message: 'Login attempt', category: 'auth', data: { email } });
      await signIn(email, password);
      const user = await getCurrentUser();
      if (user) {
        setSentryUser({ id: user.$id, email: user.email, username: user.name });
        addBreadcrumb({ message: 'Login successful', category: 'auth', level: 'info', data: { userId: user.$id } });
        set({ user: { id: user.$id, email: user.email, name: user.name }, token: user.$id, status: "authenticated", error: null });
        updateUserProfile(user.$id, { lastLoginTime: new Date().toISOString() }).catch(() => {});
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Login failed";
      captureException(err instanceof Error ? err : new Error(errorMsg), {
        tags: { operation: 'login', feature: 'auth' },
        contexts: { auth: { email, errorMsg } }
      });
      set({ status: "error", error: errorMsg });
      throw err;
    }
  },

  signup: async (email: string, password: string, firstName: string, lastName: string) => {
    set({ status: "loading", error: null });
    try {
      addBreadcrumb({ message: 'Signup attempt', category: 'auth', data: { email, firstName, lastName } });
      const fullName = `${firstName} ${lastName}`.trim();
      const authUser = await createAccount(email, password, fullName);
      await signIn(email, password);

      await createUserProfile(authUser.$id, email, firstName, lastName);

      const user = await getCurrentUser();
      if (user) {
        setSentryUser({ id: user.$id, email: user.email, username: fullName });
        addBreadcrumb({ message: 'Signup successful', category: 'auth', level: 'info', data: { userId: user.$id } });
        set({ user: { id: user.$id, email: user.email, name: fullName, firstName, lastName }, token: user.$id, status: "authenticated", error: null });
        updateUserProfile(user.$id, { lastLoginTime: new Date().toISOString() }).catch(() => {});
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Signup failed";
      captureException(err instanceof Error ? err : new Error(errorMsg), {
        tags: { operation: 'signup', feature: 'auth' },
        contexts: { auth: { email, firstName, lastName, errorMsg } }
      });
      set({ status: "error", error: errorMsg });
      throw err;
    }
  },

  logout: async () => {
    try {
      if (USE_CLOUDKIT) {
        await clearStoredIdentity();
      } else {
        await signOut();
      }
      clearSentryUser();
      set({ user: null, token: null, status: "unauthenticated", error: null });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Logout failed";
      captureException(err instanceof Error ? err : new Error(errorMsg));
      set({ error: errorMsg });
    }
  },

  deleteAccount: async () => {
    const state = useSessionStore.getState();
    const userId = state.user?.id;

    if (!userId) {
      return { success: false, error: "No user logged in" };
    }

    try {
      addBreadcrumb({ message: 'Account deletion initiated', category: 'auth', data: { userId } });

      // CloudKit wipes all data via a single zone delete inside deleteUserAccount;
      // Appwrite needs the background delete queue for transactions.
      if (!USE_CLOUDKIT) {
        await queueDeleteAll(userId);
      }

      const result = await deleteUserAccount(userId);

      if (result.success) {
        if (USE_CLOUDKIT) {
          // Fully reset "new user" state so re-signing-in re-runs onboarding
          // and re-offers migration.
          await clearStoredIdentity();
          await resetOnboarding();
          await resetMigrationFlag();
        }
        clearSentryUser();
        set({ user: null, token: null, status: "unauthenticated", error: null, needsOnboarding: false });
      }

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to delete account";
      captureException(err instanceof Error ? err : new Error(errorMsg), {
        tags: { operation: 'delete_account', feature: 'auth' },
      });
      return { success: false, error: errorMsg };
    }
  },

  setSession: ({ user, token }) =>
    set({ user, token, status: "authenticated", error: null }),
  setStatus: (status) => set({ status }),
  setError: (message) => set({ error: message, status: "error" }),
  clearSession: () => set({ user: null, token: null, status: "idle", error: null }),
}));
