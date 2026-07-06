import type { SubscriptionDoc } from "./backend";

type SubscriptionLike = SubscriptionDoc & { id: string };

type TxLike = {
  title?: string;
  displayName?: string;
  amount: number;
  kind: "income" | "expense";
};

/**
 * Match an incoming transaction against the user's confirmed subscriptions.
 * Mirrors the matching logic used for early-payment detection in
 * `useSubscriptionsStore`:
 *  - Only expense transactions are eligible.
 *  - Name match: tx name contains/contained-in merchantName or displayName.
 *  - Fixed-amount subs require the amount within ±15% of the sub amount.
 *  - Variable-amount subs match on name only.
 * Cancelled subscriptions are ignored. Active and paused are eligible so that
 * a backfill import can still link historical transactions to their sub.
 *
 * Returns the id of the best-matching subscription, or null.
 */
export function matchTransactionToSubscription(
  tx: TxLike,
  subscriptions: SubscriptionLike[]
): string | null {
  if (tx.kind !== "expense") return null;

  const txName = ((tx.displayName || tx.title) || "").toLowerCase().trim();
  if (!txName) return null;

  const txAmount = Math.abs(tx.amount);

  let best: { id: string; score: number } | null = null;

  for (const sub of subscriptions) {
    if (sub.status === "cancelled") continue;

    const merchantLower = (sub.merchantName || "").toLowerCase().trim();
    const displayLower = (sub.displayName || "").toLowerCase().trim();

    const nameMatch =
      (!!merchantLower && (txName.includes(merchantLower) || merchantLower.includes(txName))) ||
      (!!displayLower && (txName.includes(displayLower) || displayLower.includes(txName)));

    if (!nameMatch) continue;

    const isVariable = sub.amountType === "variable";
    const subAmount = Math.abs(sub.amount);
    const tolerance = subAmount * 0.15;
    const amountMatch = isVariable || Math.abs(txAmount - subAmount) <= tolerance;

    if (!amountMatch) continue;

    // Score: prefer fixed matches with smaller amount delta; variable matches
    // get a baseline score so a fixed match always wins over a variable one
    // when both qualify.
    const score = isVariable ? Number.MAX_SAFE_INTEGER : Math.abs(txAmount - subAmount);
    if (!best || score < best.score) {
      best = { id: sub.id, score };
    }
  }

  return best?.id ?? null;
}
