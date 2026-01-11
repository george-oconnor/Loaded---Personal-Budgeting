import {
    getCategories,
    getMonthlyBudget,
    getTransactionsForMonth,
    getTransactionsInRangeAll,
    updateMonthlyBudget,
} from "@/lib/appwrite";
import { getCycleStartDate, getTransactionsInCurrentCycle } from "@/lib/budgetCycle";
import { captureException } from "@/lib/sentry";
import { getQueuedTransactions } from "@/lib/syncQueue";
import type { Category, Summary, Transaction } from "@/types/type";
import { create } from "zustand";
import { useSessionStore } from "./useSessionStore";

type HomeState = {
  summary: Summary | null;
  categories: Category[];
  selectedCategory: string;
  transactions: Transaction[];
  loading: boolean;
  error: string | null;
  cycleType: "first_working_day" | "last_working_day" | "specific_date" | "last_friday";
  cycleDay?: number;
  fetchHome: () => Promise<void>;
  setCategory: (id: string) => void;
};

const mockCategories: Category[] = [
  { id: "all", name: "All", color: "#2F9B65" },
  { id: "food", name: "Food", color: "#FE8C00" },
  { id: "shopping", name: "Shopping", color: "#6C63FF" },
  { id: "transport", name: "Transport", color: "#0C8CE9" },
  { id: "bills", name: "Bills", color: "#F14141" },
];

const mockTransactions: Transaction[] = [
  {
    id: "t-1",
    title: "Groceries",
    subtitle: "Trader Joe's",
    amount: -6432,
    categoryId: "food",
    kind: "expense",
    date: "2024-12-19T15:30:00.000Z",
  },
  {
    id: "t-2",
    title: "Paycheck",
    subtitle: "Monthly salary",
    amount: 320000,
    categoryId: "income",
    kind: "income",
    date: "2024-12-18T09:00:00.000Z",
  },
  {
    id: "t-3",
    title: "Metro pass",
    subtitle: "Transit",
    amount: -4500,
    categoryId: "transport",
    kind: "expense",
    date: "2024-12-17T08:10:00.000Z",
  },
  {
    id: "t-4",
    title: "Electric bill",
    subtitle: "Utilities",
    amount: -12050,
    categoryId: "bills",
    kind: "expense",
    date: "2024-12-16T12:00:00.000Z",
  },
];

const mockSummary: Summary = {
  balance: 1245023,
  income: 520000,
  expenses: 265000,
  currency: "USD",
  monthlyBudget: 300000,
};

export const useHomeStore = create<HomeState>((set) => ({
  summary: null,
  categories: mockCategories,
  selectedCategory: "all",
  transactions: [],
  loading: false,
  error: null,
  cycleType: "first_working_day",
  cycleDay: undefined,
  fetchHome: async () => {
    set({ loading: true, error: null });
    try {
      const now = new Date();
      const user = useSessionStore.getState().user;
      const userId = user?.id;
      
      console.log("fetchHome - user:", user?.id, "name:", user?.name);
      
      if (!userId) {
        console.warn("fetchHome - no user ID, cannot fetch transactions");
        set({ summary: null, transactions: [], loading: false, error: "No user logged in" });
        return;
      }

      const envOk = Boolean(process.env.EXPO_PUBLIC_APPWRITE_ENDPOINT && process.env.EXPO_PUBLIC_APPWRITE_PROJECT_ID);
      if (!envOk) {
        // Fallback to mock if env not configured
        await new Promise((resolve) => setTimeout(resolve, 120));
        set({ summary: mockSummary, transactions: mockTransactions, loading: false });
        return;
      }

      // First fetch budget doc to determine cycle type for date range calculation
      const budgetDoc = await getMonthlyBudget(userId);
      const cycleType = (budgetDoc.cycleType as any) || "first_working_day";
      const cycleDay = budgetDoc.cycleDay;

      // Calculate date range to fetch: from start of previous cycle to now
      // This ensures we have data for both current and previous cycle (needed for analytics comparison)
      const currentCycleStart = getCycleStartDate(cycleType, cycleDay);
      const prevCycleStart = new Date(currentCycleStart);
      prevCycleStart.setMonth(prevCycleStart.getMonth() - 1);
      
      const rangeStart = prevCycleStart.toISOString();
      const rangeEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      const [monthTxDocs, rangeTxDocs, catDocs, queuedTxs] = await Promise.all([
        getTransactionsForMonth(userId, now.getUTCFullYear(), now.getUTCMonth()),
        getTransactionsInRangeAll(userId, rangeStart, rangeEnd), // Fetch all transactions in range for analytics
        getCategories().catch(() => []),
        getQueuedTransactions(),
      ]);

      // Filter queued transactions for this user
      const userQueuedTxs = queuedTxs.filter(t => t.userId === userId);
      // Only consider active (not completed) queue items for calculations
      const activeQueuedTxs = userQueuedTxs.filter(t => t.syncStatus !== 'completed');

      const income = monthTxDocs
        .filter((t) => t.kind === "income" && !(t as any).excludeFromAnalytics)
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      // Note: Summary should reflect current budget cycle, not calendar month.
      // We'll compute income/expenses from combined transactions for the current cycle
      const transactions: Transaction[] = rangeTxDocs.map((t) => ({
        id: (t as any).$id ?? `${t.userId}-${t.date}`,
        title: t.title,
        subtitle: t.subtitle || "",
        amount: t.amount,
        categoryId: t.categoryId,
        kind: t.kind,
        date: t.date,
        currency: (t as any).currency,
        excludeFromAnalytics: (t as any).excludeFromAnalytics,
        source: (t as any).source,
        displayName: (t as any).displayName,
        account: (t as any).account,
        matchedTransferId: (t as any).matchedTransferId,
        hideMerchantIcon: (t as any).hideMerchantIcon,
      }));

      // Add queued transactions to the list (exclude completed)
      const queuedTransactions: Transaction[] = activeQueuedTxs.map((t) => ({
        id: t.id,
        title: t.title,
        subtitle: t.subtitle,
        amount: t.amount,
        categoryId: t.categoryId,
        kind: t.kind,
        date: t.date,
        currency: t.currency,
        excludeFromAnalytics: t.excludeFromAnalytics,
        source: t.source,
        displayName: t.displayName,
        account: t.account,
        matchedTransferId: t.matchedTransferId,
      }));

      // Dedupe using same logic as all transactions screen (keeps latest occurrence)
      const dedupeById = (list: Transaction[]) => {
        const byId = new Map<string, Transaction>();
        for (const tx of list) {
          if (!tx.id) continue;
          byId.set(tx.id, tx);
        }
        return Array.from(byId.values());
      };

      // Combine and sort by date (most recent first) - same as all transactions screen
      const allTransactions = dedupeById([...transactions, ...queuedTransactions]).sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      // Map CategoryDoc -> Category
      const categories: Category[] = (catDocs as any[]).map((c) => ({
        id: c.$id,
        name: c.name,
        color: c.color,
        icon: c.icon,
      }));

      // Add "All" category at the beginning
      const allCategories: Category[] = [
        { id: "all", name: "All", color: "#2F9B65" },
        ...(categories.length ? categories : mockCategories.slice(1)), // Exclude mock "All" if using real categories
      ];

      // Compute cycle-based income/expenses for summary
      const cycleTransactions = getTransactionsInCurrentCycle(
        allTransactions,
        (budgetDoc.cycleType as any) || "first_working_day",
        budgetDoc.cycleDay
      );
      const cycleIncome = cycleTransactions
        .filter((t) => t.kind === "income" && !t.excludeFromAnalytics)
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      const cycleExpenses = cycleTransactions
        .filter((t) => t.kind === "expense" && !t.excludeFromAnalytics)
        .reduce((s, t) => s + Math.abs(t.amount), 0);

      const computeLastMonthBudget = () => {
        const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const monthStart = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 1);
        const monthEnd = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0, 23, 59, 59, 999);
        const total = allTransactions
          .filter((t) => {
            const d = new Date(t.date);
            return (
              t.kind === "expense" &&
              !t.excludeFromAnalytics &&
              d >= monthStart &&
              d <= monthEnd
            );
          })
          .reduce((sum, t) => sum + Math.abs(t.amount), 0);
        const monthRef = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;
        return { total, monthRef };
      };

      let effectiveMonthlyBudget = budgetDoc.monthlyBudget || 0;
      let effectiveCurrency = budgetDoc.currency || "USD";
      let effectiveBudgetSource = budgetDoc.budgetSource || "manual";

      if (effectiveBudgetSource === "lastMonth") {
        const { total, monthRef } = computeLastMonthBudget();

        // If we have no expenses to base it on, keep the existing stored budget (avoid zeroing out UI)
        if (total > 0 && (total !== effectiveMonthlyBudget || budgetDoc.lastMonthReference !== monthRef)) {
          try {
            await updateMonthlyBudget(
              userId,
              total,
              effectiveCurrency,
              (budgetDoc.cycleType as any) || "first_working_day",
              budgetDoc.cycleDay,
              "lastMonth",
              monthRef
            );
            effectiveMonthlyBudget = total;
          } catch (err) {
            console.warn("updateMonthlyBudget (lastMonth recompute) failed", err);
            captureException(err instanceof Error ? err : new Error('updateMonthlyBudget failed'), {
              tags: { feature: 'home_store', operation: 'updateMonthlyBudget_lastMonth' }
            });
          }
        }
      }

      const summary: Summary = {
        balance: cycleIncome - cycleExpenses,
        income: cycleIncome,
        expenses: cycleExpenses,
        currency: effectiveCurrency,
        monthlyBudget: effectiveMonthlyBudget,
        budgetSource: effectiveBudgetSource,
        lastMonthReference: budgetDoc.lastMonthReference,
      };

      set({
        summary,
        transactions: allTransactions,
        categories: allCategories,
        cycleType: (budgetDoc.cycleType as any) || "first_working_day",
        cycleDay: budgetDoc.cycleDay,
        loading: false,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to load home data";
      console.warn("❌ Fetch home data failed:", errorMsg, err);
      captureException(err instanceof Error ? err : new Error(errorMsg), { userId: "demo-user" });
      set({ error: errorMsg, loading: false });
    }
  },
  setCategory: (id) => set({ selectedCategory: id || "all" }),
}));
