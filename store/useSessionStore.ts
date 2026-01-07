import { createAccount, createUserProfile, getCurrentSession, getCurrentUser, signIn, signOut } from "@/lib/appwrite";
import { captureException, clearUser as clearSentryUser, setUser as setSentryUser } from "@/lib/sentry";
import type { SessionState } from "@/types/type";
import { create } from "zustand";

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  token: null,
  status: "idle",
  error: null,
  
  checkSession: async () => {
    set({ status: "loading" });
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
        return;
      }

      set({ user: null, token: null, status: "unauthenticated", error: null });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to check session";
      captureException(err instanceof Error ? err : new Error(errorMsg));
      set({ user: null, token: null, status: "unauthenticated", error: errorMsg });
    }
  },

  login: async (email: string, password: string) => {
    set({ status: "loading", error: null });
    try {
      await signIn(email, password);
      const user = await getCurrentUser();
      if (user) {
        setSentryUser({ id: user.$id, email: user.email, username: user.name });
        set({ user: { id: user.$id, email: user.email, name: user.name }, token: user.$id, status: "authenticated", error: null });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Login failed";
      captureException(err instanceof Error ? err : new Error(errorMsg), { email });
      set({ status: "error", error: errorMsg });
      throw err;
    }
  },

  signup: async (email: string, password: string, firstName: string, lastName: string) => {
    set({ status: "loading", error: null });
    try {
      const fullName = `${firstName} ${lastName}`.trim();
      const authUser = await createAccount(email, password, fullName);
      await signIn(email, password);
      
      // Create user profile in users table
      await createUserProfile(authUser.$id, email, firstName, lastName);
      
      const user = await getCurrentUser();
      if (user) {
        setSentryUser({ id: user.$id, email: user.email, username: fullName });
        set({ user: { id: user.$id, email: user.email, name: fullName, firstName, lastName }, token: user.$id, status: "authenticated", error: null });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Signup failed";
      captureException(err instanceof Error ? err : new Error(errorMsg), { email, firstName, lastName });
      set({ status: "error", error: errorMsg });
      throw err;
    }
  },

  logout: async () => {
    try {
      await signOut();
      clearSentryUser();
      set({ user: null, token: null, status: "unauthenticated", error: null });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Logout failed";
      captureException(err instanceof Error ? err : new Error(errorMsg));
      set({ error: errorMsg });
    }
  },

  setSession: ({ user, token }) =>
    set({ user, token, status: "authenticated", error: null }),
  setStatus: (status) => set({ status }),
  setError: (message) => set({ error: message, status: "error" }),
  clearSession: () => set({ user: null, token: null, status: "idle", error: null }),
}));
