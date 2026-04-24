import {
  createSubscription,
  deleteSubscription,
  getConfirmedSubscriptions,
  getTransactionsBySubscriptionId,
  getTransactionsInRangeAll,
  updateSubscription,
  updateTransaction,
  type SubscriptionDoc,
} from "@/lib/appwrite";
import { cancelSubscriptionReminder, scheduleSubscriptionReminder } from "@/lib/notifications";
import { detectRecurringPayments, estimateNextDate, type RecurringFrequency, type RecurringPayment } from "@/lib/recurringPayments";
import { captureException } from "@/lib/sentry";
import type { Transaction } from "@/types/type";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { useHomeStore } from "./useHomeStore";
import { useSessionStore } from "./useSessionStore";

const DISMISSED_KEY = "dismissed_subscriptions";

export type ConfirmedSubscription = SubscriptionDoc & { id: string };

export type EarlyPaymentInfo = ConfirmedSubscription & {
  paidDate: string;
  paidAmount: number;
};

type SubscriptionsState = {
  /** Algorithm-detected potential subscriptions (excluding confirmed & dismissed) */
  potentialSubscriptions: RecurringPayment[];
  /** User-confirmed subscriptions from the database */
  confirmedSubscriptions: ConfirmedSubscription[];
  /** Merchant names the user has dismissed */
  dismissedMerchants: string[];
  /** Subscriptions that appear to have been paid earlier than expected */
  earlyPayments: EarlyPaymentInfo[];
  loading: boolean;
  error: string | null;
  lastFetched: number | null;

  fetchAll: (force?: boolean) => Promise<void>;
  confirmSubscription: (payment: RecurringPayment) => void;
  dismissSubscription: (merchantName: string) => Promise<void>;
  undoDismiss: (merchantName: string) => Promise<void>;
  removeConfirmed: (docId: string) => Promise<void>;
  updateConfirmed: (docId: string, updates: Partial<SubscriptionDoc>) => Promise<void>;
  manualConfirmSubscription: (params: {
    merchantName: string;
    displayName: string;
    name?: string;
    amount: number;
    amountType?: "fixed" | "variable";
    frequency: RecurringFrequency;
    categoryId: string;
    nextBillingDate?: string;
    transactionIds?: string[];
  }) => void;
  /** Advance past billing dates and (re)schedule reminders for all active subscriptions */
  refreshSubscriptionReminders: () => Promise<void>;
  /** Mark a subscription as paid for the current period, advancing to the next billing date */
  markAsPaidForPeriod: (docId: string) => Promise<void>;
  /** Dismiss an early payment detection without marking as paid */
  dismissEarlyPayment: (docId: string) => void;
};

/** Map Appwrite docs to app Transaction type */
function mapDoc(doc: any): Transaction {
  return {
    id: doc.$id ?? doc.id,
    title: doc.title ?? "",
    subtitle: doc.subtitle ?? "",
    amount: doc.amount ?? 0,
    categoryId: doc.categoryId ?? "",
    kind: doc.kind ?? "expense",
    date: doc.date ?? "",
    currency: doc.currency,
    excludeFromAnalytics: doc.excludeFromAnalytics,
    source: doc.source,
    displayName: doc.displayName,
    account: doc.account,
    matchedTransferId: doc.matchedTransferId,
    hideMerchantIcon: doc.hideMerchantIcon,
    isSubscription: doc.isSubscription,
    subscriptionId: doc.subscriptionId,
  };
}

/** Tag (or untag) a batch of transactions with a subscription ID */
async function tagTransactions(transactionIds: string[], subscriptionId: string | null) {
  await Promise.allSettled(
    transactionIds.map((txId) =>
      updateTransaction(txId, {
        isSubscription: subscriptionId !== null,
        subscriptionId: subscriptionId ?? "",
      })
    )
  );
}

async function loadDismissed(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(DISMISSED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveDismissed(merchants: string[]) {
  await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(merchants));
}

export const useSubscriptionsStore = create<SubscriptionsState>((set, get) => ({
  potentialSubscriptions: [],
  confirmedSubscriptions: [],
  dismissedMerchants: [],
  earlyPayments: [],
  loading: false,
  error: null,
  lastFetched: null,

  fetchAll: async (force = false) => {
    const user = useSessionStore.getState().user;
    if (!user?.id) return;

    // Skip re-fetch if data loaded recently (2 min) unless forced
    const { lastFetched, confirmedSubscriptions } = get();
    if (!force && lastFetched && Date.now() - lastFetched < 120_000 && confirmedSubscriptions.length > 0) return;

    set({ loading: true, error: null });
    try {
      // Load dismissed list from local storage
      const dismissed = await loadDismissed();

      // Fetch confirmed subscriptions from DB
      let confirmed: ConfirmedSubscription[] = [];
      try {
        confirmed = await getConfirmedSubscriptions(user.id);
      } catch (e) {
        console.warn("[Subscriptions] Failed to fetch confirmed:", e);
        captureException(e as Error);
      }

      // Fetch 12 months of transaction history for detection
      const end = new Date();
      const start = new Date();
      start.setFullYear(start.getFullYear() - 1);

      const docs = await getTransactionsInRangeAll(user.id, start.toISOString(), end.toISOString());
      const transactions: Transaction[] = docs.map(mapDoc);
      const detected = detectRecurringPayments(transactions);

      // Build set of confirmed merchant names for filtering
      const confirmedNames = new Set(confirmed.map((c) => c.merchantName.toLowerCase()));
      const dismissedSet = new Set(dismissed.map((d) => d.toLowerCase()));

      // Potential = detected minus confirmed & dismissed
      const potential = detected.filter(
        (rp) =>
          !confirmedNames.has(rp.merchantName.toLowerCase()) &&
          !dismissedSet.has(rp.merchantName.toLowerCase())
      );

      // Detect early payments: recent transactions matching confirmed subscriptions
      // Only flag when the transaction falls within 7 days of the scheduled billing date (either side)
      const now = new Date();

      const previouslyDismissedEarlyKey = "dismissed_early_payments";
      let dismissedEarlyIds: string[] = [];
      try {
        const raw = await AsyncStorage.getItem(previouslyDismissedEarlyKey);
        dismissedEarlyIds = raw ? JSON.parse(raw) : [];
      } catch { /* ignore */ }

      const earlyPaid: EarlyPaymentInfo[] = [];
      for (const sub of confirmed) {
        if (sub.status !== "active" || !sub.nextBillingDate) continue;
        if (dismissedEarlyIds.includes(sub.id)) continue;

        const nextDate = new Date(sub.nextBillingDate);
        const daysUntilBilling = Math.ceil((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        // Only consider if billing date is within 7 days from now (but still in the future)
        if (daysUntilBilling <= 0 || daysUntilBilling > 7) continue;

        const merchantLower = sub.merchantName.toLowerCase();
        const displayLower = (sub.displayName || "").toLowerCase();
        const isVariable = sub.amountType === "variable";
        const amountTolerance = Math.abs(sub.amount) * 0.15;

        // Look for matching transactions within 7 days either side of the billing date
        const windowStart = new Date(nextDate);
        windowStart.setDate(windowStart.getDate() - 7);
        const windowEnd = new Date(nextDate);
        windowEnd.setDate(windowEnd.getDate() + 7);

        const matchingTx = transactions.find((tx) => {
          if (tx.kind !== "expense") return false;
          const txDate = new Date(tx.date);
          if (txDate < windowStart || txDate > windowEnd) return false;
          // Must have already been paid (transaction date is before billing date)
          if (txDate >= nextDate) return false;
          const txName = (tx.displayName || tx.title || "").toLowerCase();
          const nameMatch = txName.includes(merchantLower) || merchantLower.includes(txName)
            || txName.includes(displayLower) || displayLower.includes(txName);
          // Variable subscriptions match on name + date only; fixed also require amount match
          const amountMatch = isVariable || Math.abs(Math.abs(tx.amount) - Math.abs(sub.amount)) <= amountTolerance;
          return nameMatch && amountMatch;
        });

        if (matchingTx) {
          earlyPaid.push({
            ...sub,
            paidDate: matchingTx.date,
            paidAmount: Math.abs(matchingTx.amount),
          });
        }
      }

      set({
        potentialSubscriptions: potential,
        confirmedSubscriptions: confirmed,
        dismissedMerchants: dismissed,
        earlyPayments: earlyPaid,
        loading: false,
        lastFetched: Date.now(),
      });
    } catch (err) {
      captureException(err as Error);
      set({ error: "Failed to load subscriptions", loading: false });
    }
  },

  confirmSubscription: (payment: RecurringPayment) => {
    const user = useSessionStore.getState().user;
    if (!user?.id) return;

    // Optimistic: immediately remove from potential and add to confirmed
    const tempId = `temp_${Date.now()}`;
    set({
      potentialSubscriptions: get().potentialSubscriptions.filter(
        (rp) => rp.merchantName.toLowerCase() !== payment.merchantName.toLowerCase()
      ),
      confirmedSubscriptions: [
        ...get().confirmedSubscriptions,
        {
          id: tempId,
          userId: user.id,
          name: payment.displayName || payment.merchantName,
          merchantName: payment.merchantName,
          displayName: payment.displayName,
          amount: payment.amount,
          amountType: "fixed" as const,
          frequency: payment.frequency,
          categoryId: payment.categoryId,
          status: "active",
          nextBillingDate: payment.nextExpectedDate ?? "",
          confirmedAt: new Date().toISOString(),
          notes: "",
        },
      ],
    });

    // Persist in background, then swap temp ID with real one
    createSubscription(user.id, {
      name: payment.displayName || payment.merchantName,
      merchantName: payment.merchantName,
      displayName: payment.displayName,
      amount: Math.round(payment.amount),
      amountType: "fixed",
      frequency: payment.frequency,
      categoryId: payment.categoryId,
      status: "active",
      nextBillingDate: payment.nextExpectedDate,
      confirmedAt: new Date().toISOString(),
    })
      .then((doc) => {
        // Replace temp entry with real DB doc
        set({
          confirmedSubscriptions: get().confirmedSubscriptions.map((s) =>
            s.id === tempId ? { ...s, id: doc.$id } : s
          ),
        });
        // Schedule a reminder notification for the day before
        const currency = useHomeStore.getState().summary?.currency ?? "EUR";
        if (payment.nextExpectedDate) {
          scheduleSubscriptionReminder({
            subscriptionId: doc.$id,
            merchantName: payment.displayName || payment.merchantName,
            amount: Math.round(payment.amount),
            currency,
            nextBillingDate: payment.nextExpectedDate,
          }).catch(() => {});
        }
        // Tag matched transactions with the subscription ID
        if (payment.transactionIds?.length) {
          tagTransactions(payment.transactionIds, doc.$id).catch(() => {});
        }
      })
      .catch((err) => {
        captureException(err as Error);
        // Rollback: remove temp entry, put back in potential
        set({
          confirmedSubscriptions: get().confirmedSubscriptions.filter((s) => s.id !== tempId),
          potentialSubscriptions: [...get().potentialSubscriptions, payment],
        });
      });
  },

  dismissSubscription: async (merchantName: string) => {
    const dismissed = [...get().dismissedMerchants, merchantName];
    await saveDismissed(dismissed);

    // Remove from potential list locally
    set({
      dismissedMerchants: dismissed,
      potentialSubscriptions: get().potentialSubscriptions.filter(
        (rp) => rp.merchantName.toLowerCase() !== merchantName.toLowerCase()
      ),
    });
  },

  undoDismiss: async (merchantName: string) => {
    const dismissed = get().dismissedMerchants.filter(
      (d) => d.toLowerCase() !== merchantName.toLowerCase()
    );
    await saveDismissed(dismissed);
    set({ dismissedMerchants: dismissed });
    // Re-fetch to bring it back into potential
    await get().fetchAll();
  },

  removeConfirmed: async (docId: string) => {
    try {
      // Untag transactions linked to this subscription
      const txIds = await getTransactionsBySubscriptionId(docId).catch(() => [] as string[]);
      if (txIds.length) {
        tagTransactions(txIds, null).catch(() => {});
      }
      await deleteSubscription(docId);
      set({
        confirmedSubscriptions: get().confirmedSubscriptions.filter((s) => s.id !== docId),
      });
      // Cancel any scheduled reminder
      cancelSubscriptionReminder(docId).catch(() => {});
    } catch (err) {
      captureException(err as Error);
    }
  },

  updateConfirmed: async (docId: string, updates: Partial<SubscriptionDoc>) => {
    try {
      await updateSubscription(docId, updates);
      set({
        confirmedSubscriptions: get().confirmedSubscriptions.map((s) =>
          s.id === docId ? { ...s, ...updates } : s
        ),
      });
    } catch (err) {
      captureException(err as Error);
    }
  },

  manualConfirmSubscription: (params) => {
    const user = useSessionStore.getState().user;
    if (!user?.id) return;

    const tempId = `temp_${Date.now()}`;
    const now = new Date().toISOString();

    // Optimistic: add to confirmed immediately
    set({
      confirmedSubscriptions: [
        ...get().confirmedSubscriptions,
        {
          id: tempId,
          userId: user.id,
          name: params.name || params.displayName || params.merchantName,
          merchantName: params.merchantName,
          displayName: params.displayName,
          amount: params.amount,
          amountType: params.amountType ?? "fixed",
          frequency: params.frequency,
          categoryId: params.categoryId,
          status: "active",
          nextBillingDate: params.nextBillingDate ?? "",
          confirmedAt: now,
          notes: "",
        },
      ],
      // Also remove from potential if it was there
      potentialSubscriptions: get().potentialSubscriptions.filter(
        (rp) => rp.merchantName.toLowerCase() !== params.merchantName.toLowerCase()
      ),
    });

    createSubscription(user.id, {
      name: params.name || params.displayName || params.merchantName,
      merchantName: params.merchantName,
      displayName: params.displayName,
      amount: Math.round(params.amount),
      amountType: params.amountType ?? "fixed",
      frequency: params.frequency,
      categoryId: params.categoryId,
      status: "active",
      nextBillingDate: params.nextBillingDate,
      confirmedAt: now,
    })
      .then((doc) => {
        set({
          confirmedSubscriptions: get().confirmedSubscriptions.map((s) =>
            s.id === tempId ? { ...s, id: doc.$id } : s
          ),
        });
        // Schedule a reminder notification for the day before
        const currency = useHomeStore.getState().summary?.currency ?? "EUR";
        if (params.nextBillingDate) {
          scheduleSubscriptionReminder({
            subscriptionId: doc.$id,
            merchantName: params.displayName || params.merchantName,
            amount: Math.round(params.amount),
            currency,
            nextBillingDate: params.nextBillingDate,
          }).catch(() => {});
        }
        // Tag selected transactions with the subscription ID
        if (params.transactionIds?.length) {
          tagTransactions(params.transactionIds, doc.$id).catch(() => {});
        }
      })
      .catch((err) => {
        captureException(err as Error);
        set({
          confirmedSubscriptions: get().confirmedSubscriptions.filter((s) => s.id !== tempId),
        });
      });
  },

  refreshSubscriptionReminders: async () => {
    const currency = useHomeStore.getState().summary?.currency ?? "EUR";
    const subs = get().confirmedSubscriptions;
    const now = new Date();

    for (const sub of subs) {
      // Cancel any existing reminder for non-active subs (paused / cancelled)
      if (sub.status !== "active" || !sub.nextBillingDate) {
        if (!sub.id.startsWith("temp_")) {
          cancelSubscriptionReminder(sub.id).catch(() => {});
        }
        continue;
      }

      // If the billing date is in the past, advance it
      let nextDate = new Date(sub.nextBillingDate);
      let advanced = false;
      while (nextDate <= now) {
        const newIso = estimateNextDate(nextDate.toISOString(), sub.frequency as RecurringFrequency);
        nextDate = new Date(newIso);
        advanced = true;
      }

      if (advanced) {
        const newBillingDate = nextDate.toISOString();
        // Update locally
        set({
          confirmedSubscriptions: get().confirmedSubscriptions.map((s) =>
            s.id === sub.id ? { ...s, nextBillingDate: newBillingDate } : s
          ),
        });
        // Persist to DB (fire-and-forget)
        if (!sub.id.startsWith("temp_")) {
          updateSubscription(sub.id, { nextBillingDate: newBillingDate }).catch(() => {});
        }
        // Clear early payment dismissal so detection works for the new period
        AsyncStorage.getItem("dismissed_early_payments")
          .then((raw) => {
            const dismissed: string[] = raw ? JSON.parse(raw) : [];
            if (dismissed.includes(sub.id)) {
              AsyncStorage.setItem(
                "dismissed_early_payments",
                JSON.stringify(dismissed.filter((id) => id !== sub.id))
              );
            }
          })
          .catch(() => {});
      }

      // Schedule the reminder (replaces any existing one for this sub)
      const billingDate = advanced ? nextDate.toISOString() : sub.nextBillingDate;
      if (!sub.id.startsWith("temp_")) {
        scheduleSubscriptionReminder({
          subscriptionId: sub.id,
          merchantName: sub.displayName || sub.merchantName,
          amount: sub.amount,
          currency,
          nextBillingDate: billingDate,
        }).catch(() => {});
      }
    }
  },

  markAsPaidForPeriod: async (docId: string) => {
    const sub = get().confirmedSubscriptions.find((s) => s.id === docId);
    if (!sub || !sub.nextBillingDate) return;

    // Advance to the next billing date in the sequence
    const newBillingDate = estimateNextDate(sub.nextBillingDate, sub.frequency as RecurringFrequency);

    // Update locally
    set({
      confirmedSubscriptions: get().confirmedSubscriptions.map((s) =>
        s.id === docId ? { ...s, nextBillingDate: newBillingDate } : s
      ),
      // Remove from early payments if it was there
      earlyPayments: get().earlyPayments.filter((s) => s.id !== docId),
    });

    // Persist to DB
    if (!docId.startsWith("temp_")) {
      try {
        await updateSubscription(docId, { nextBillingDate: newBillingDate });
      } catch (err) {
        captureException(err as Error);
      }

      // Cancel old reminder and schedule new one for the advanced date
      const currency = useHomeStore.getState().summary?.currency ?? "EUR";
      cancelSubscriptionReminder(docId).catch(() => {});
      scheduleSubscriptionReminder({
        subscriptionId: docId,
        merchantName: sub.displayName || sub.merchantName,
        amount: sub.amount,
        currency,
        nextBillingDate: newBillingDate,
      }).catch(() => {});
    }

    // Also clear from dismissed early list so it can be detected next period
    try {
      const raw = await AsyncStorage.getItem("dismissed_early_payments");
      const dismissed: string[] = raw ? JSON.parse(raw) : [];
      await AsyncStorage.setItem(
        "dismissed_early_payments",
        JSON.stringify(dismissed.filter((id) => id !== docId))
      );
    } catch { /* ignore */ }
  },

  dismissEarlyPayment: (docId: string) => {
    set({
      earlyPayments: get().earlyPayments.filter((s) => s.id !== docId),
    });
    // Persist dismissal so it doesn't re-appear until next period
    AsyncStorage.getItem("dismissed_early_payments")
      .then((raw) => {
        const dismissed: string[] = raw ? JSON.parse(raw) : [];
        if (!dismissed.includes(docId)) {
          dismissed.push(docId);
          AsyncStorage.setItem("dismissed_early_payments", JSON.stringify(dismissed));
        }
      })
      .catch(() => {});
  },
}));
