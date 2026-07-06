/**
 * Sample data for App Review and first-run exploration. Replaces the old
 * server-side scripts/seed-demo-user.js (no server admin key exists with
 * CloudKit). Everything is stamped with DEMO_BATCH_ID so it can be removed
 * cleanly. Writes go through the backend seam into the user's own store.
 */
import {
  createBulkTransactions,
  deleteAccountBalanceDoc,
  deleteTransactionsByBatchId,
  updateMonthlyBudget,
  upsertAccountBalance,
} from "./backend";

export const DEMO_BATCH_ID = "demo_seed";

const DEMO_BALANCES = [
  { accountKey: "demo-current-eur", accountName: "Everyday Account", accountType: "current", provider: "DemoBank", currency: "EUR", balance: 182505 },
  { accountKey: "demo-savings-eur", accountName: "Savings Vault", accountType: "savings", provider: "DemoBank", currency: "EUR", balance: 520075 },
];

type DemoTx = {
  title: string;
  subtitle: string;
  amount: number; // cents
  kind: "income" | "expense";
  categoryId: string;
  daysAgo: number;
  hour: number;
};

const DEMO_TRANSACTIONS: DemoTx[] = [
  { title: "Salary", subtitle: "Monthly pay", amount: 285000, kind: "income", categoryId: "income", daysAgo: 2, hour: 9 },
  { title: "Mister Magpie Coffee", subtitle: "Dublin cafe", amount: 450, kind: "expense", categoryId: "food", daysAgo: 0, hour: 8 },
  { title: "Tesco", subtitle: "Weekly shop", amount: 8500, kind: "expense", categoryId: "food", daysAgo: 0, hour: 18 },
  { title: "Nando's", subtitle: "Lunch", amount: 2150, kind: "expense", categoryId: "food", daysAgo: 1, hour: 12 },
  { title: "Uber", subtitle: "Airport ride", amount: 3200, kind: "expense", categoryId: "transport", daysAgo: 2, hour: 5 },
  { title: "Irish Rail", subtitle: "Commute", amount: 1240, kind: "expense", categoryId: "transport", daysAgo: 3, hour: 8 },
  { title: "Electric Ireland", subtitle: "Utility bill", amount: 9800, kind: "expense", categoryId: "bills", daysAgo: 4, hour: 10 },
  { title: "Vodafone", subtitle: "Phone plan", amount: 3500, kind: "expense", categoryId: "bills", daysAgo: 6, hour: 11 },
  { title: "Zara", subtitle: "Top & jeans", amount: 7900, kind: "expense", categoryId: "shopping", daysAgo: 3, hour: 15 },
  { title: "Amazon", subtitle: "Household", amount: 4299, kind: "expense", categoryId: "shopping", daysAgo: 7, hour: 20 },
  { title: "Monthly Saver", subtitle: "Transfer to savings", amount: 30000, kind: "expense", categoryId: "savings", daysAgo: 2, hour: 9 },
  { title: "Spotify", subtitle: "Subscription", amount: 1099, kind: "expense", categoryId: "bills", daysAgo: 9, hour: 6 },
  { title: "SuperValu", subtitle: "Groceries", amount: 6230, kind: "expense", categoryId: "food", daysAgo: 12, hour: 17 },
  { title: "Freelance invoice", subtitle: "Side project", amount: 45000, kind: "income", categoryId: "income", daysAgo: 15, hour: 14 },
];

function isoDaysAgo(daysAgo: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export async function loadDemoData(userId: string): Promise<void> {
  await updateMonthlyBudget(userId, 250000, "EUR", "first_working_day", undefined, "manual");

  for (const bal of DEMO_BALANCES) {
    await upsertAccountBalance(userId, bal);
  }

  const txns = DEMO_TRANSACTIONS.map((t, i) => ({
    id: `${DEMO_BATCH_ID}_${i}`,
    title: t.title,
    subtitle: t.subtitle,
    amount: t.amount,
    kind: t.kind,
    categoryId: t.categoryId,
    date: isoDaysAgo(t.daysAgo, t.hour),
    currency: "EUR",
    account: "Everyday Account",
    displayName: t.title,
    source: "manual" as const,
    importBatchId: DEMO_BATCH_ID,
  }));

  await createBulkTransactions(userId, txns as any);
}

export async function removeDemoData(userId: string): Promise<void> {
  await deleteTransactionsByBatchId(userId, DEMO_BATCH_ID);
  for (const bal of DEMO_BALANCES) {
    await deleteAccountBalanceDoc(userId, bal.accountKey).catch(() => {});
  }
}
