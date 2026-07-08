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

// Real Appwrite category document ids (see constants/categories.ts).
const CAT = {
  salary: "6945787f000a35903da2",
  groceries: "694576140002de855c7a",
  restaurants: "69457633002669063076",
  transport: "69457644003864cd88ea",
  utilities: "694576530033767de11e",
  entertainment: "69457662001bc83a81fa",
  shopping: "6949b8fb00070d28ff18",
  transfer: "6949cfe6003d17da084c",
};

const DEMO_TRANSACTIONS: DemoTx[] = [
  { title: "Salary", subtitle: "Monthly pay", amount: 285000, kind: "income", categoryId: CAT.salary, daysAgo: 2, hour: 9 },
  { title: "Mister Magpie Coffee", subtitle: "Dublin cafe", amount: 450, kind: "expense", categoryId: CAT.restaurants, daysAgo: 0, hour: 8 },
  { title: "Tesco", subtitle: "Weekly shop", amount: 8500, kind: "expense", categoryId: CAT.groceries, daysAgo: 0, hour: 18 },
  { title: "Nando's", subtitle: "Lunch", amount: 2150, kind: "expense", categoryId: CAT.restaurants, daysAgo: 1, hour: 12 },
  { title: "Uber", subtitle: "Airport ride", amount: 3200, kind: "expense", categoryId: CAT.transport, daysAgo: 2, hour: 5 },
  { title: "Irish Rail", subtitle: "Commute", amount: 1240, kind: "expense", categoryId: CAT.transport, daysAgo: 3, hour: 8 },
  { title: "Electric Ireland", subtitle: "Utility bill", amount: 9800, kind: "expense", categoryId: CAT.utilities, daysAgo: 4, hour: 10 },
  { title: "Vodafone", subtitle: "Phone plan", amount: 3500, kind: "expense", categoryId: CAT.utilities, daysAgo: 6, hour: 11 },
  { title: "Zara", subtitle: "Top & jeans", amount: 7900, kind: "expense", categoryId: CAT.shopping, daysAgo: 3, hour: 15 },
  { title: "Amazon", subtitle: "Household", amount: 4299, kind: "expense", categoryId: CAT.shopping, daysAgo: 7, hour: 20 },
  { title: "Monthly Saver", subtitle: "Transfer to savings", amount: 30000, kind: "expense", categoryId: CAT.transfer, daysAgo: 2, hour: 9 },
  { title: "Spotify", subtitle: "Subscription", amount: 1099, kind: "expense", categoryId: CAT.entertainment, daysAgo: 9, hour: 6 },
  { title: "SuperValu", subtitle: "Groceries", amount: 6230, kind: "expense", categoryId: CAT.groceries, daysAgo: 12, hour: 17 },
  { title: "Freelance invoice", subtitle: "Side project", amount: 45000, kind: "income", categoryId: CAT.salary, daysAgo: 15, hour: 14 },
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
