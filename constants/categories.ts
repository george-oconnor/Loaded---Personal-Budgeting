/**
 * Bundled category list — the global categories that were previously stored in
 * the Appwrite `categories` collection. Categories are identified by their
 * Appwrite document id (which is what `categoryId` on transactions/subscriptions
 * references), so these ids are preserved verbatim for the CloudKit migration to
 * line up. There is no `slug` field in the source data; `slug` here is derived
 * from the name and only used by the keyword categorizer's matching fallback.
 */
export type BundledCategory = {
  $id: string; // canonical categoryId = original Appwrite document id
  name: string;
  slug: string;
  color: string;
  icon: string; // MaterialCommunityIcons name
};

export const CATEGORIES: BundledCategory[] = [
  { $id: "694576140002de855c7a", slug: "groceries", name: "Groceries", color: "#22C55E", icon: "cart" },
  { $id: "69457633002669063076", slug: "restaurants", name: "Restaurants", color: "#EF4444", icon: "silverware-fork-knife" },
  { $id: "69457644003864cd88ea", slug: "transport", name: "Transport", color: "#3B82F6", icon: "bus" },
  { $id: "694576530033767de11e", slug: "utilities", name: "Utilities", color: "#F59E0B", icon: "flash" },
  { $id: "69457662001bc83a81fa", slug: "entertainment", name: "Entertainment", color: "#8B5CF6", icon: "movie" },
  { $id: "6945767600023af45d9c", slug: "health", name: "Health", color: "#10B981", icon: "heart-pulse" },
  { $id: "69457689001bd6883954", slug: "lifestyle", name: "Lifestyle", color: "#6366F1", icon: "credit-card" },
  { $id: "6945769e001b331bb186", slug: "general", name: "General", color: "#6B7280", icon: "dots-horizontal" },
  { $id: "6945787f000a35903da2", slug: "salary", name: "Salary", color: "#10B981", icon: "briefcase" },
  { $id: "6949b8fb00070d28ff18", slug: "shopping", name: "Shopping", color: "#F59E0B", icon: "shopping-bag" },
  { $id: "6949c22a0036921a4148", slug: "services", name: "Services", color: "#3B82F6", icon: "cloud" },
  { $id: "6949c276000e786a2218", slug: "sport", name: "Sport", color: "#EF4444", icon: "activity" },
  { $id: "6949cfe6003d17da084c", slug: "transfer", name: "Transfer", color: "#6B7280", icon: "repeat" },
  { $id: "695e4fe10010d989f420", slug: "travel", name: "Travel", color: "#0EA5E9", icon: "navigation" },
  { $id: "69985ee5001f36e2259e", slug: "loan", name: "Loan", color: "#0D9488", icon: "credit-card" },
];
