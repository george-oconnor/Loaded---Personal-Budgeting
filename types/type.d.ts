export type Category = {
  id: string;
  name: string;
  color?: string;
  icon?: string;
};

export type Transaction = {
  id: string;
  title: string;
  subtitle: string;
  amount: number;
  categoryId: string;
  kind: "income" | "expense";
  date: string;
  currency?: string; // e.g., 'EUR', 'GBP', 'USD'
  excludeFromAnalytics?: boolean;
  isAnalyticsProtected?: boolean; // When true, excludeFromAnalytics cannot be toggled by user
  source?: "revolut_import" | "aib_import" | "manual" | "other_import"; // Where the transaction came from
  displayName?: string; // How the transaction appears to the user; defaults to title for deduplication
  account?: string; // Which account this transaction relates to (e.g., "Current Account", "Savings")
  matchedTransferId?: string; // Linked transaction for internal transfers
  hideMerchantIcon?: boolean; // When true, use category icon instead of merchant icon
  importBatchId?: string; // Unique identifier for the import batch this transaction came from
};

export type Summary = {
  balance: number;
  income: number;
  expenses: number;
  currency: string;
  monthlyBudget: number;
  budgetSource?: "manual" | "lastMonth";
  lastMonthReference?: string;
};

export type QuickAction = {
  id: string;
  label: string;
  icon: string; // icon name from Feather glyphMap
};

export type SessionStatus = "idle" | "loading" | "authenticated" | "unauthenticated" | "error";

export type SessionUser = {
  id: string;
  email?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
};

export type SessionState = {
  user: SessionUser | null;
  token: string | null;
  status: SessionStatus;
  error: string | null;
  checkSession: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, firstName: string, lastName: string) => Promise<void>;
  logout: () => Promise<void>;
  setSession: (payload: { user: SessionUser; token: string }) => void;
  setStatus: (status: SessionStatus) => void;
  setError: (message: string | null) => void;
  clearSession: () => void;
};
