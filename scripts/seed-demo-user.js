/*
  Seed a John Doe demo user with budget, categories, balances, and transactions.
  Usage: npm run seed:demo
  Requires Appwrite env vars: EXPO_PUBLIC_APPWRITE_ENDPOINT, EXPO_PUBLIC_APPWRITE_PROJECT_ID,
  EXPO_PUBLIC_APPWRITE_DATABASE_ID, EXPO_PUBLIC_APPWRITE_TABLE_* (transactions, budgets,
  categories, users, balances).
*/

/* Email: john.doe@example.com
Password: DemoUser123! */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { Client, Databases, ID, Query, Users } = require("node-appwrite");

const endpoint = process.env.EXPO_PUBLIC_APPWRITE_ENDPOINT;
const projectId = process.env.EXPO_PUBLIC_APPWRITE_PROJECT_ID;
const databaseId = process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID;
const transactionsTableId =
  process.env.EXPO_PUBLIC_APPWRITE_TABLE_TRANSACTIONS ||
  process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_TRANSACTIONS;
const budgetsTableId =
  process.env.EXPO_PUBLIC_APPWRITE_TABLE_BUDGETS ||
  process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_BUDGETS;
const categoriesTableId =
  process.env.EXPO_PUBLIC_APPWRITE_TABLE_CATEGORIES ||
  process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_CATEGORIES;
const usersTableId =
  process.env.EXPO_PUBLIC_APPWRITE_TABLE_USERS ||
  process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_USERS;
const balancesTableId =
  process.env.EXPO_PUBLIC_APPWRITE_TABLE_BALANCES ||
  process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_BALANCES;
const apiKey = process.env.EXPO_PUBLIC_APPWRITE_API_KEY || process.env.APPWRITE_API_KEY;
const DEMO_USER_ID = "demo-john-doe";

const DEMO_USER = {
  email: "john.doe@example.com",
  password: "DemoUser123!",
  firstName: "John",
  lastName: "Doe",
  name: "John Doe",
};

const categories = [
  { id: "income", name: "Income", color: "#2F9B65", icon: "trending-up" },
  { id: "food", name: "Food", color: "#FE8C00", icon: "shopping-bag" },
  { id: "transport", name: "Transport", color: "#0C8CE9", icon: "truck" },
  { id: "bills", name: "Bills", color: "#F14141", icon: "file-text" },
  { id: "shopping", name: "Shopping", color: "#6C63FF", icon: "shopping-bag" },
  { id: "savings", name: "Savings", color: "#1E88E5", icon: "shield" },
];

const balances = [
  {
    id: "demo-current-eur",
    accountKey: "demo-current-eur",
    accountName: "Everyday Account",
    accountType: "current",
    provider: "DemoBank",
    currency: "EUR",
    balance: 182505,
  },
  {
    id: "demo-savings-eur",
    accountKey: "demo-savings-eur",
    accountName: "Savings Vault",
    accountType: "savings",
    provider: "DemoBank",
    currency: "EUR",
    balance: 520075,
  },
];

const budget = {
  monthlyBudget: 250000, // 2,500.00 EUR
  currency: "EUR",
  cycleType: "first_working_day",
  budgetSource: "manual",
};

const transactions = [
  // Current cycle (Jan 1-5, 2026)
  {
    id: "demo-coffee-today",
    title: "Mister Magpie Coffee",
    subtitle: "Dublin cafe",
    amount: 450,
    kind: "expense",
    categoryId: "food",
    daysAgo: 0,
    hour: 8,
    minute: 15,
    account: "Everyday Account",
  },
  {
    id: "demo-groceries-jan5",
    title: "Tesco",
    subtitle: "Weekly shop",
    amount: 8500,
    kind: "expense",
    categoryId: "food",
    daysAgo: 0,
    hour: 18,
    minute: 30,
    account: "Everyday Account",
  },
  {
    id: "demo-gym-jan4",
    title: "ClassPass",
    subtitle: "Monthly membership",
    amount: 5000,
    kind: "expense",
    categoryId: "shopping",
    daysAgo: 1,
    hour: 7,
    minute: 0,
    account: "Everyday Account",
  },
  {
    id: "demo-lunch-jan4",
    title: "Nando's",
    subtitle: "Lunch",
    amount: 2150,
    kind: "expense",
    categoryId: "food",
    daysAgo: 1,
    hour: 12,
    minute: 45,
    account: "Everyday Account",
  },
  {
    id: "demo-bonus-jan4",
    title: "Bonus",
    subtitle: "Work bonus",
    amount: 50000,
    kind: "income",
    categoryId: "income",
    daysAgo: 1,
    hour: 9,
    minute: 0,
    account: "Everyday Account",
  },
  {
    id: "demo-transport-jan3",
    title: "Uber",
    subtitle: "Airport ride",
    amount: 3200,
    kind: "expense",
    categoryId: "transport",
    daysAgo: 2,
    hour: 5,
    minute: 30,
    account: "Everyday Account",
  },
  {
    id: "demo-shopping-jan3",
    title: "Zara",
    subtitle: "Top & jeans",
    amount: 9500,
    kind: "expense",
    categoryId: "shopping",
    daysAgo: 2,
    hour: 15,
    minute: 20,
    account: "Everyday Account",
  },
  {
    id: "demo-dinner-jan2",
    title: "Eddie Rockets",
    subtitle: "Dinner",
    amount: 4800,
    kind: "expense",
    categoryId: "food",
    daysAgo: 3,
    hour: 19,
    minute: 30,
    account: "Everyday Account",
  },
  {
    id: "demo-internet-jan2",
    title: "Eir",
    subtitle: "Internet & TV",
    amount: 3500,
    kind: "expense",
    categoryId: "bills",
    daysAgo: 3,
    hour: 10,
    minute: 0,
    account: "Everyday Account",
  },
  {
    id: "demo-cinema-jan1",
    title: "Vue Cinema",
    subtitle: "Movie tickets",
    amount: 1800,
    kind: "expense",
    categoryId: "shopping",
    daysAgo: 4,
    hour: 20,
    minute: 15,
    account: "Everyday Account",
  },
  
  // Previous month (December 2025) - Full month from 1st to 31st
  {
    id: "demo-paycheck-dec1",
    title: "Salary",
    subtitle: "Monthly salary",
    amount: 320000,
    kind: "income",
    categoryId: "income",
    daysAgo: 35,
    hour: 9,
    minute: 0,
    account: "Everyday Account",
  },
  {
    id: "demo-rent-dec1",
    title: "Rent",
    subtitle: "Apartment",
    amount: 120000,
    kind: "expense",
    categoryId: "bills",
    daysAgo: 35,
    hour: 10,
    minute: 30,
    account: "Everyday Account",
  },
  {
    id: "demo-grocery-dec1",
    title: "Tesco",
    subtitle: "Weekly groceries",
    amount: 8900,
    kind: "expense",
    categoryId: "food",
    daysAgo: 34,
    hour: 17,
    minute: 45,
    account: "Everyday Account",
  },
  {
    id: "demo-coffee-early-dec",
    title: "Mister Magpie Coffee",
    subtitle: "Morning coffee",
    amount: 450,
    kind: "expense",
    categoryId: "food",
    daysAgo: 33,
    hour: 8,
    minute: 30,
    account: "Everyday Account",
  },
  {
    id: "demo-luas-early-dec",
    title: "Luas",
    subtitle: "Weekly ticket",
    amount: 2500,
    kind: "expense",
    categoryId: "transport",
    daysAgo: 32,
    hour: 8,
    minute: 0,
    account: "Everyday Account",
  },
  {
    id: "demo-eir-dec",
    title: "Eir",
    subtitle: "Internet & TV",
    amount: 3500,
    kind: "expense",
    categoryId: "bills",
    daysAgo: 31,
    hour: 11,
    minute: 15,
    account: "Everyday Account",
  },
  {
    id: "demo-dunnes-early-dec",
    title: "Dunnes Stores",
    subtitle: "Groceries",
    amount: 6200,
    kind: "expense",
    categoryId: "food",
    daysAgo: 30,
    hour: 18,
    minute: 0,
    account: "Everyday Account",
  },
  {
    id: "demo-uber-early-dec",
    title: "Uber",
    subtitle: "Work commute",
    amount: 2100,
    kind: "expense",
    categoryId: "transport",
    daysAgo: 29,
    hour: 17,
    minute: 45,
    account: "Everyday Account",
  },
  {
    id: "demo-insomnia-dec",
    title: "Insomnia Coffee",
    subtitle: "Cafe",
    amount: 400,
    kind: "expense",
    categoryId: "food",
    daysAgo: 28,
    hour: 9,
    minute: 30,
    account: "Everyday Account",
  },
  {
    id: "demo-zara-dec",
    title: "Zara",
    subtitle: "Winter clothes",
    amount: 7500,
    kind: "expense",
    categoryId: "shopping",
    daysAgo: 27,
    hour: 14,
    minute: 20,
    account: "Everyday Account",
  },
  {
    id: "demo-boots-early-dec",
    title: "Boots",
    subtitle: "Skincare",
    amount: 2800,
    kind: "expense",
    categoryId: "shopping",
    daysAgo: 26,
    hour: 16,
    minute: 0,
    account: "Everyday Account",
  },
  {
    id: "demo-nandos-dec",
    title: "Nando's",
    subtitle: "Lunch",
    amount: 1950,
    kind: "expense",
    categoryId: "food",
    daysAgo: 25,
    hour: 12,
    minute: 30,
    account: "Everyday Account",
  },
  {
    id: "demo-virgin-dec",
    title: "Virgin Media",
    subtitle: "Broadband & TV",
    amount: 4500,
    kind: "expense",
    categoryId: "bills",
    daysAgo: 24,
    hour: 10,
    minute: 45,
    account: "Everyday Account",
  },
  {
    id: "demo-amazon-early-dec",
    title: "Amazon",
    subtitle: "Books",
    amount: 3400,
    kind: "expense",
    categoryId: "shopping",
    daysAgo: 23,
    hour: 15,
    minute: 30,
    account: "Everyday Account",
  },
  {
    id: "demo-eddie-rockets-dec",
    title: "Eddie Rockets",
    subtitle: "Dinner",
    amount: 4200,
    kind: "expense",
    categoryId: "food",
    daysAgo: 22,
    hour: 19,
    minute: 45,
    account: "Everyday Account",
  },
  {
    id: "demo-classpass-dec",
    title: "ClassPass",
    subtitle: "Gym membership",
    amount: 5000,
    kind: "expense",
    categoryId: "shopping",
    daysAgo: 21,
    hour: 6,
    minute: 45,
    account: "Everyday Account",
  },
  {
    id: "demo-spotify-dec",
    title: "Spotify",
    subtitle: "Monthly subscription",
    amount: 1299,
    kind: "expense",
    categoryId: "shopping",
    daysAgo: 20,
    hour: 11,
    minute: 0,
    account: "Everyday Account",
  },
  {
    id: "demo-tesco-mid-dec",
    title: "Tesco",
    subtitle: "Grocery run",
    amount: 7600,
    kind: "expense",
    categoryId: "food",
    daysAgo: 19,
    hour: 19,
    minute: 15,
    account: "Everyday Account",
  },
  {
    id: "demo-hm-mid-dec",
    title: "H&M",
    subtitle: "Casual wear",
    amount: 6800,
    kind: "expense",
    categoryId: "shopping",
    daysAgo: 18,
    hour: 13,
    minute: 45,
    account: "Everyday Account",
  },
  {
    id: "demo-taxi-mid-dec",
    title: "Taxi",
    subtitle: "Night out",
    amount: 3100,
    kind: "expense",
    categoryId: "transport",
    daysAgo: 17,
    hour: 23,
    minute: 30,
    account: "Everyday Account",
  },
  {
    id: "demo-dominos-dec",
    title: "Domino's",
    subtitle: "Dinner",
    amount: 2100,
    kind: "expense",
    categoryId: "food",
    daysAgo: 16,
    hour: 20,
    minute: 0,
    account: "Everyday Account",
  },
  {
    id: "demo-cinema-early-dec",
    title: "Vue Cinema",
    subtitle: "Movie night",
    amount: 1800,
    kind: "expense",
    categoryId: "shopping",
    daysAgo: 15,
    hour: 19,
    minute: 45,
    account: "Everyday Account",
  },
  {
    id: "demo-argos-early-dec",
    title: "Argos",
    subtitle: "Electronics",
    amount: 4500,
    kind: "expense",
    categoryId: "shopping",
    daysAgo: 14,
    hour: 14,
    minute: 0,
    account: "Everyday Account",
  },
  {
    id: "demo-december-bonus",
    title: "December bonus",
    subtitle: "Year-end bonus",
    amount: 150000,
    kind: "income",
    categoryId: "income",
    daysAgo: 13,
    hour: 9,
    minute: 0,
    account: "Everyday Account",
  },
  {
    id: "demo-hm-dec-late",
    title: "H&M",
    subtitle: "Christmas shopping",
    amount: 8900,
    kind: "expense",
    categoryId: "shopping",
    daysAgo: 12,
    hour: 15,
    minute: 30,
    account: "Everyday Account",
  },
  {
    id: "demo-cinema-dec-late",
    title: "Vue Cinema",
    subtitle: "Christmas movie",
    amount: 2200,
    kind: "expense",
    categoryId: "shopping",
    daysAgo: 11,
    hour: 19,
    minute: 30,
    account: "Everyday Account",
  },
  {
    id: "demo-tesco-dec-christmas",
    title: "Tesco",
    subtitle: "Christmas shopping",
    amount: 12500,
    kind: "expense",
    categoryId: "food",
    daysAgo: 10,
    hour: 16,
    minute: 45,
    account: "Everyday Account",
  },
  {
    id: "demo-fallon-byrne",
    title: "Fallon & Byrne",
    subtitle: "Christmas dinner items",
    amount: 9800,
    kind: "expense",
    categoryId: "food",
    daysAgo: 9,
    hour: 17,
    minute: 30,
    account: "Everyday Account",
  },
  {
    id: "demo-pub-dec",
    title: "The Brazen Head",
    subtitle: "Christmas drinks",
    amount: 5600,
    kind: "expense",
    categoryId: "food",
    daysAgo: 8,
    hour: 21,
    minute: 0,
    account: "Everyday Account",
  },
  {
    id: "demo-restaurant-dec",
    title: "Chapter One",
    subtitle: "Christmas dinner",
    amount: 18500,
    kind: "expense",
    categoryId: "food",
    daysAgo: 7,
    hour: 19,
    minute: 0,
    account: "Everyday Account",
  },
  {
    id: "demo-taxi-dec",
    title: "Taxi",
    subtitle: "Night out transport",
    amount: 4200,
    kind: "expense",
    categoryId: "transport",
    daysAgo: 6,
    hour: 23,
    minute: 45,
    account: "Everyday Account",
  },
  {
    id: "demo-savings-transfer-dec",
    title: "Savings transfer",
    subtitle: "Year-end transfer",
    amount: 80000,
    kind: "expense",
    categoryId: "savings",
    daysAgo: 5,
    hour: 10,
    minute: 0,
    account: "Everyday Account",
    excludeFromAnalytics: true,
    isAnalyticsProtected: true,
  },
  {
    id: "demo-argos-dec-final",
    title: "Argos",
    subtitle: "Last-minute gifts",
    amount: 7300,
    kind: "expense",
    categoryId: "shopping",
    daysAgo: 4,
    hour: 13,
    minute: 15,
    account: "Everyday Account",
  },
  {
    id: "demo-coffee-dec-boxing",
    title: "Mister Magpie Coffee",
    subtitle: "Boxing Day coffee",
    amount: 500,
    kind: "expense",
    categoryId: "food",
    daysAgo: 3,
    hour: 9,
    minute: 0,
    account: "Everyday Account",
  },
  {
    id: "demo-dunnes-dec-boxing",
    title: "Dunnes Stores",
    subtitle: "Boxing Day shopping",
    amount: 6100,
    kind: "expense",
    categoryId: "food",
    daysAgo: 2,
    hour: 17,
    minute: 30,
    account: "Everyday Account",
  },
  {
    id: "demo-uber-dec-final",
    title: "Uber",
    subtitle: "Shopping trip",
    amount: 2400,
    kind: "expense",
    categoryId: "transport",
    daysAgo: 1,
    hour: 16,
    minute: 20,
    account: "Everyday Account",
  },
];

function ensureEnv() {
  const missing = [];
  if (!endpoint) missing.push("EXPO_PUBLIC_APPWRITE_ENDPOINT");
  if (!projectId) missing.push("EXPO_PUBLIC_APPWRITE_PROJECT_ID");
  if (!databaseId) missing.push("EXPO_PUBLIC_APPWRITE_DATABASE_ID");
  if (!apiKey) missing.push("APPWRITE_API_KEY (server key)");
  if (!transactionsTableId) missing.push("EXPO_PUBLIC_APPWRITE_TABLE_TRANSACTIONS");
  if (!budgetsTableId) missing.push("EXPO_PUBLIC_APPWRITE_TABLE_BUDGETS");
  if (!categoriesTableId) missing.push("EXPO_PUBLIC_APPWRITE_TABLE_CATEGORIES");
  if (!usersTableId) missing.push("EXPO_PUBLIC_APPWRITE_TABLE_USERS");
  if (!balancesTableId) missing.push("EXPO_PUBLIC_APPWRITE_TABLE_BALANCES");

  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}

function isoDaysAgo(daysAgo, hour = 12, minute = 0) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

async function ensureUser(users) {
  let user = null;

  try {
    console.log("Creating demo user with ID", DEMO_USER_ID);
    user = await users.create(
      ID.custom(DEMO_USER_ID),
      DEMO_USER.email,
      null,
      DEMO_USER.password,
      DEMO_USER.name
    );
    console.log("✓ Created demo account");
  } catch (err) {
    if (err?.code === 409 || /already exists/i.test(err?.message || "")) {
      console.log("ℹ️  Demo account already exists, reusing");
      const found = await users.list([Query.equal("email", DEMO_USER.email), Query.limit(1)]);
      user = found?.users?.[0] || found?.documents?.[0] || null;
    } else {
      console.error("User create failed", err);
      throw err;
    }
  }

  if (!user?.$id) {
    throw new Error("Failed to resolve demo user ID (need APPWRITE_API_KEY with Users.read access)");
  }
  return user;
}

async function ensureUserProfile(databases, user) {
  try {
    await databases.createDocument(databaseId, usersTableId, user.$id, {
      userId: user.$id,
      email: user.email,
      firstname: DEMO_USER.firstName,
      lastname: DEMO_USER.lastName,
    });
    console.log("✓ Created user profile document");
  } catch (err) {
    if (err?.code === 409 || /already exists/i.test(err?.message || "")) {
      await databases.updateDocument(databaseId, usersTableId, user.$id, {
        email: user.email,
        firstname: DEMO_USER.firstName,
        lastname: DEMO_USER.lastName,
      });
      console.log("ℹ️  Updated existing user profile");
    } else {
      throw err;
    }
  }
}

async function upsertCategories(databases) {
  for (const cat of categories) {
    try {
      await databases.createDocument(databaseId, categoriesTableId, cat.id, {
        name: cat.name,
        color: cat.color,
        icon: cat.icon,
      });
      console.log(`✓ Created category ${cat.name}`);
    } catch (err) {
      if (err?.code === 409 || /exists/i.test(err?.message || "")) {
        await databases.updateDocument(databaseId, categoriesTableId, cat.id, {
          name: cat.name,
          color: cat.color,
          icon: cat.icon,
        });
        console.log(`ℹ️  Updated category ${cat.name}`);
      } else {
        throw err;
      }
    }
  }
}

async function upsertBudget(databases, userId) {
  const res = await databases.listDocuments(databaseId, budgetsTableId, [
    Query.equal("userId", userId),
    Query.limit(1),
  ]);
  const existing = res.documents?.[0];
  if (existing) {
    await databases.updateDocument(databaseId, budgetsTableId, existing.$id, {
      monthlyBudget: budget.monthlyBudget,
      currency: budget.currency,
      cycleType: budget.cycleType,
      budgetSource: budget.budgetSource,
      cycleDay: budget.cycleDay || null,
    });
    console.log("ℹ️  Updated budget");
  } else {
    await databases.createDocument(databaseId, budgetsTableId, ID.unique(), {
      userId,
      monthlyBudget: budget.monthlyBudget,
      currency: budget.currency,
      cycleType: budget.cycleType,
      budgetSource: budget.budgetSource,
      cycleDay: budget.cycleDay || null,
    });
    console.log("✓ Created budget");
  }
}

async function upsertBalances(databases, userId) {
  for (const bal of balances) {
    try {
      await databases.createDocument(databaseId, balancesTableId, bal.id, {
        userId,
        accountKey: bal.accountKey,
        accountName: bal.accountName,
        accountType: bal.accountType,
        provider: bal.provider,
        currency: bal.currency,
        balance: bal.balance,
        lastUpdated: new Date().toISOString(),
      });
      console.log(`✓ Created balance ${bal.accountName}`);
    } catch (err) {
      if (err?.code === 409 || /exists/i.test(err?.message || "")) {
        await databases.updateDocument(databaseId, balancesTableId, bal.id, {
          userId,
          accountKey: bal.accountKey,
          accountName: bal.accountName,
          accountType: bal.accountType,
          provider: bal.provider,
          currency: bal.currency,
          balance: bal.balance,
          lastUpdated: new Date().toISOString(),
        });
        console.log(`ℹ️  Updated balance ${bal.accountName}`);
      } else {
        throw err;
      }
    }
  }
}

async function upsertTransactions(databases, userId) {
  for (const tx of transactions) {
    const date = isoDaysAgo(tx.daysAgo, tx.hour || 12, tx.minute || 0);
    const amount = Math.abs(tx.amount);
    try {
      await databases.createDocument(databaseId, transactionsTableId, tx.id, {
        userId,
        title: tx.title,
        subtitle: tx.subtitle || "",
        amount,
        kind: tx.kind,
        categoryId: tx.categoryId,
        date,
        currency: "EUR",
        excludeFromAnalytics: tx.excludeFromAnalytics || false,
        isAnalyticsProtected: tx.isAnalyticsProtected || false,
        source: tx.source || "manual",
        displayName: tx.title,
        account: tx.account,
      });
      console.log(`✓ Created transaction ${tx.title}`);
    } catch (err) {
      if (err?.code === 409 || /exists/i.test(err?.message || "")) {
        await databases.updateDocument(databaseId, transactionsTableId, tx.id, {
          title: tx.title,
          subtitle: tx.subtitle || "",
          amount,
          kind: tx.kind,
          categoryId: tx.categoryId,
          date,
          currency: "EUR",
          excludeFromAnalytics: tx.excludeFromAnalytics || false,
          isAnalyticsProtected: tx.isAnalyticsProtected || false,
          source: tx.source || "manual",
          displayName: tx.title,
          account: tx.account,
        });
        console.log(`ℹ️  Updated transaction ${tx.title}`);
      } else {
        throw err;
      }
    }
  }
}

async function main() {
  ensureEnv();

  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const users = new Users(client);
  const databases = new Databases(client);

  try {
    const user = await ensureUser(users);
    await ensureUserProfile(databases, user);
    await upsertCategories(databases);
    await upsertBudget(databases, user.$id);
    await upsertBalances(databases, user.$id);
    await upsertTransactions(databases, user.$id);
    console.log("\nJohn Doe demo data is ready.");
  } catch (err) {
    console.error("Failed to seed demo user:", err?.message || err);
    process.exit(1);
  }
}

main();
