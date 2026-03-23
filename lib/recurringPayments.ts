import type { Transaction } from "@/types/type";

export type RecurringFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";

export type RecurringPayment = {
  merchantName: string;
  displayName: string;
  amount: number; // median amount (positive value, in minor units)
  frequency: RecurringFrequency;
  confidence: number; // 0–1
  lastDate: string; // ISO date of most recent occurrence
  nextExpectedDate: string; // estimated next charge
  occurrences: number;
  categoryId: string;
  transactionIds: string[];
};

const FREQUENCY_RANGES: { name: RecurringFrequency; minDays: number; maxDays: number; label: string; periodDays: number }[] = [
  { name: "weekly", minDays: 5, maxDays: 9, label: "Weekly", periodDays: 7 },
  { name: "biweekly", minDays: 12, maxDays: 17, label: "Every 2 weeks", periodDays: 14 },
  { name: "monthly", minDays: 26, maxDays: 35, label: "Monthly", periodDays: 30 },
  { name: "quarterly", minDays: 85, maxDays: 100, label: "Quarterly", periodDays: 91 },
  { name: "annual", minDays: 350, maxDays: 385, label: "Annual", periodDays: 365 },
];

/** Normalize merchant name for grouping */
function normalizeMerchant(tx: Transaction): string {
  const name = (tx.displayName || tx.title || "").toLowerCase().trim();
  // Strip common suffixes/prefixes that vary between charges
  return name
    .replace(/\s*(ltd|limited|inc|plc|co|llc)\.?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Compute median of a sorted number array */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Days between two ISO date strings */
function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60 * 24);
}

/** Detect the most likely frequency from a set of intervals */
function detectFrequency(intervals: number[]): { frequency: RecurringFrequency; consistency: number } | null {
  if (intervals.length === 0) return null;

  const med = median(intervals);

  // Find which frequency range the median interval falls into
  for (const range of FREQUENCY_RANGES) {
    if (med >= range.minDays && med <= range.maxDays) {
      // Measure how consistent the intervals are relative to the expected period
      const deviations = intervals.map((i) => Math.abs(i - range.periodDays) / range.periodDays);
      const avgDeviation = deviations.reduce((sum, d) => sum + d, 0) / deviations.length;
      const consistency = Math.max(0, 1 - avgDeviation);
      return { frequency: range.name, consistency };
    }
  }

  return null;
}

/** Check if amounts are consistent (within tolerance of median) */
function amountConsistency(amounts: number[], tolerance = 0.15): number {
  const med = median(amounts);
  if (med === 0) return 0;
  const withinTolerance = amounts.filter(
    (a) => Math.abs(a - med) / Math.abs(med) <= tolerance
  ).length;
  return withinTolerance / amounts.length;
}

/** Add days to a date */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + Math.round(days));
  return d.toISOString();
}

/** Estimate the next expected payment date using calendar-based advancement */
export function estimateNextDate(lastDate: string, frequency: RecurringFrequency): string {
  const d = new Date(lastDate);

  switch (frequency) {
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      break;
    case "quarterly":
      d.setMonth(d.getMonth() + 3);
      break;
    case "annual":
      d.setFullYear(d.getFullYear() + 1);
      break;
    default: {
      // weekly / biweekly — flat day math is correct
      const periodDays = FREQUENCY_RANGES.find((r) => r.name === frequency)?.periodDays ?? 7;
      return addDays(lastDate, periodDays);
    }
  }

  // If the date already passed, keep advancing until it's in the future
  const now = new Date();
  while (d <= now) {
    switch (frequency) {
      case "monthly":
        d.setMonth(d.getMonth() + 1);
        break;
      case "quarterly":
        d.setMonth(d.getMonth() + 3);
        break;
      case "annual":
        d.setFullYear(d.getFullYear() + 1);
        break;
    }
  }

  return d.toISOString();
}

/** Get a human-readable label for a frequency */
export function getFrequencyLabel(frequency: RecurringFrequency): string {
  return FREQUENCY_RANGES.find((r) => r.name === frequency)?.label ?? frequency;
}

/** Get monthly equivalent cost for a recurring payment */
export function getMonthlyEquivalent(amount: number, frequency: RecurringFrequency): number {
  switch (frequency) {
    case "weekly": return amount * (52 / 12);
    case "biweekly": return amount * (26 / 12);
    case "monthly": return amount;
    case "quarterly": return amount / 3;
    case "annual": return amount / 12;
  }
}

/**
 * Detect recurring payments from a list of transactions.
 * Pass in as much historical data as possible for best results.
 */
export function detectRecurringPayments(
  transactions: Transaction[],
  options?: { minOccurrences?: number; minConfidence?: number }
): RecurringPayment[] {
  const minOccurrences = options?.minOccurrences ?? 3;
  const minConfidence = options?.minConfidence ?? 0.55;

  // Only consider expenses
  const expenses = transactions.filter((tx) => tx.kind === "expense" && !tx.excludeFromAnalytics);

  // Group by normalized merchant name
  const groups = new Map<string, Transaction[]>();
  for (const tx of expenses) {
    const key = normalizeMerchant(tx);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(tx);
    groups.set(key, group);
  }

  const results: RecurringPayment[] = [];

  for (const [merchantKey, txs] of groups) {
    if (txs.length < minOccurrences) continue;

    // Sort by date ascending
    const sorted = [...txs].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Compute intervals between consecutive transactions
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(daysBetween(sorted[i - 1].date, sorted[i].date));
    }

    // Detect frequency
    const freqResult = detectFrequency(intervals);
    if (!freqResult) continue;

    // Check amount consistency
    const amounts = sorted.map((tx) => Math.abs(tx.amount));
    const amtConsistency = amountConsistency(amounts);

    // Require at least 80% of amounts to be within tolerance
    if (amtConsistency < 0.8) continue;

    // Compute overall confidence
    // Weight: frequency consistency (50%), amount consistency (30%), occurrence count (20%)
    const occurrenceScore = Math.min(sorted.length / 6, 1); // Maxes out at 6 occurrences
    const confidence =
      freqResult.consistency * 0.5 +
      amtConsistency * 0.3 +
      occurrenceScore * 0.2;

    if (confidence < minConfidence) continue;

    const lastTx = sorted[sorted.length - 1];

    results.push({
      merchantName: merchantKey,
      displayName: lastTx.displayName || lastTx.title,
      amount: Math.abs(lastTx.amount),
      frequency: freqResult.frequency,
      confidence,
      lastDate: lastTx.date,
      nextExpectedDate: estimateNextDate(lastTx.date, freqResult.frequency),
      occurrences: sorted.length,
      categoryId: lastTx.categoryId,
      transactionIds: sorted.map((tx) => tx.id),
    });
  }

  // Sort by monthly equivalent cost descending
  return results.sort(
    (a, b) => getMonthlyEquivalent(b.amount, b.frequency) - getMonthlyEquivalent(a.amount, a.frequency)
  );
}

/**
 * Analyze a manually-selected set of transactions to suggest a subscription schedule.
 * Returns null if fewer than 2 transactions are provided.
 */
export function analyzeSelectedTransactions(
  transactions: Transaction[]
): { frequency: RecurringFrequency; amount: number; nextExpectedDate: string; confidence: number } | null {
  if (transactions.length < 2) return null;

  const sorted = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Compute intervals
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(daysBetween(sorted[i - 1].date, sorted[i].date));
  }

  // Try to detect frequency
  const freqResult = detectFrequency(intervals);

  // Fallback: if detection fails, pick the closest frequency to the median interval
  let frequency: RecurringFrequency;
  let consistency: number;
  if (freqResult) {
    frequency = freqResult.frequency;
    consistency = freqResult.consistency;
  } else {
    const med = median(intervals);
    // Find closest frequency range
    let bestRange = FREQUENCY_RANGES[2]; // default monthly
    let bestDist = Infinity;
    for (const range of FREQUENCY_RANGES) {
      const dist = Math.abs(med - range.periodDays);
      if (dist < bestDist) {
        bestDist = dist;
        bestRange = range;
      }
    }
    frequency = bestRange.name;
    consistency = Math.max(0, 1 - bestDist / bestRange.periodDays);
  }

  const lastTx = sorted[sorted.length - 1];
  const amount = Math.abs(lastTx.amount);

  return {
    frequency,
    amount,
    nextExpectedDate: estimateNextDate(lastTx.date, frequency),
    confidence: consistency,
  };
}
