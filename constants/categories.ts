/**
 * Bundled category list. Categories were previously global documents in the
 * Appwrite `categories` collection, seeded with document ID = slug — so
 * `categoryId` values on transactions/subscriptions are already these slugs.
 * With CloudKit they ship as static data instead of a server fetch.
 */
export type BundledCategory = {
  $id: string; // canonical categoryId (slug)
  name: string;
  slug: string;
  color: string;
  icon: string;
};

export const CATEGORIES: BundledCategory[] = [
  { $id: "income", slug: "income", name: "Income", color: "#2F9B65", icon: "trending-up" },
  { $id: "food", slug: "food", name: "Food", color: "#FE8C00", icon: "shopping-bag" },
  { $id: "transport", slug: "transport", name: "Transport", color: "#0C8CE9", icon: "truck" },
  { $id: "bills", slug: "bills", name: "Bills", color: "#F14141", icon: "file-text" },
  { $id: "shopping", slug: "shopping", name: "Shopping", color: "#6C63FF", icon: "shopping-bag" },
  { $id: "savings", slug: "savings", name: "Savings", color: "#1E88E5", icon: "shield" },
];
