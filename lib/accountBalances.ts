import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteAccountBalanceDoc, upsertAccountBalance } from './appwrite';

const ACCOUNT_BALANCES_KEY = 'budget_app_account_balances';

export interface AccountBalance {
  accountName: string; // e.g., "Revolut Current", "AIB Savings"
  balance: number; // in cents
  currency: string;
  lastUpdated: string; // ISO date
  accountKey?: string;
  accountType?: string;
  provider?: string;
}

/**
 * Migrate balances from old storage key to user-specific key
 */
async function migrateBalancesToUserScope(userId: string): Promise<void> {
  try {
    const newKey = `${ACCOUNT_BALANCES_KEY}_${userId}`;
    const oldKey = ACCOUNT_BALANCES_KEY;
    
    // Check if new key already has data
    const existingData = await AsyncStorage.getItem(newKey);
    if (existingData) {
      return; // Already migrated
    }
    
    // Check if old key has data
    const oldData = await AsyncStorage.getItem(oldKey);
    if (oldData) {
      // Migrate to new key
      await AsyncStorage.setItem(newKey, oldData);
      console.log(`Migrated account balances for user ${userId}`);
    }
  } catch (error) {
    console.error('Error migrating account balances:', error);
  }
}

/**
 * Get all stored account balances for a specific user
 */
export async function getAccountBalances(userId?: string): Promise<AccountBalance[]> {
  try {
    // Perform migration if userId is provided
    if (userId) {
      await migrateBalancesToUserScope(userId);
    }
    
    const key = userId ? `${ACCOUNT_BALANCES_KEY}_${userId}` : ACCOUNT_BALANCES_KEY;
    const data = await AsyncStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error loading account balances:', error);
    return [];
  }
}

/**
 * Update balance for a specific account
 */
export async function updateAccountBalance(
  accountName: string,
  balance: number,
  currency: string,
  options: { accountKey?: string; accountType?: string; provider?: string; lastUpdated?: string; userId?: string } = {}
): Promise<void> {
  try {
    const balances = await getAccountBalances(options.userId);
    const resolvedProvider = options.provider || guessProvider(accountName);
    const resolvedAccountType = options.accountType || guessAccountType(accountName);
    const resolvedAccountKey = buildAccountKey({
      accountName,
      currency,
      provider: resolvedProvider,
      accountType: resolvedAccountType,
      accountKey: options.accountKey,
    });

    const existingIndex = balances.findIndex((b) => {
      const key = buildAccountKeyFromBalance(b);
      return key === resolvedAccountKey || (b.accountName === accountName && b.currency === currency);
    });
    
    const newBalance: AccountBalance = {
      accountName,
      balance,
      currency,
      accountKey: resolvedAccountKey,
      accountType: resolvedAccountType,
      provider: resolvedProvider,
      lastUpdated: options.lastUpdated || new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      balances[existingIndex] = newBalance;
    } else {
      balances.push(newBalance);
    }

    const key = options.userId ? `${ACCOUNT_BALANCES_KEY}_${options.userId}` : ACCOUNT_BALANCES_KEY;
    await AsyncStorage.setItem(key, JSON.stringify(balances));
  } catch (error) {
    console.error('Error updating account balance:', error);
  }
}

function guessAccountType(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized.includes('vault') || normalized.includes('savings')) return 'vault';
  if (normalized.includes('pocket')) return 'pocket';
  return 'current';
}

function guessProvider(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized.includes('aib')) return 'aib';
  return 'revolut';
}

function buildAccountKey(params: { accountName: string; currency: string; provider?: string; accountType?: string; accountKey?: string }): string {
  if (params.accountKey) return params.accountKey;

  const provider = (params.provider || guessProvider(params.accountName)).toLowerCase();
  const accountType = (params.accountType || guessAccountType(params.accountName)).toLowerCase();
  const slug = slugifyAccountName(params.accountName);
  return `${provider}-${accountType}-${params.currency}-${slug}`;
}

function buildAccountKeyFromBalance(balance: AccountBalance): string {
  return buildAccountKey({
    accountName: balance.accountName,
    currency: balance.currency,
    provider: balance.provider,
    accountType: balance.accountType,
    accountKey: balance.accountKey,
  });
}

function slugifyAccountName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'account'
  );
}

export function resolveAccountInfo(options: {
  description: string;
  product?: string;
  currency?: string;
  provider?: string;
  pocketNameHint?: string;
  vaultNameHint?: string;
}): { accountName: string; accountType: string; accountKey: string; currency: string; provider: string } {
  const { description, product, currency, provider, pocketNameHint, vaultNameHint } = options;
  const normalizedProduct = (product || '').toLowerCase();
  const resolvedCurrency = currency || 'EUR';
  const resolvedProvider = provider || 'revolut';

  let accountType = 'current';
  let accountName = `Revolut Current (${resolvedCurrency})`;

  if (normalizedProduct === 'current') {
    accountType = 'current';
    accountName = `Revolut Current (${resolvedCurrency})`;
  } else if (normalizedProduct === 'pocket') {
    accountType = 'pocket';
    const pocketMatch = description.match(/To pocket (?:EUR|GBP|USD)\s+(.+?)\s+from (?:EUR|GBP|USD)/i);
    if (pocketMatch && pocketMatch[1]) {
      accountName = `Revolut Pocket: ${pocketMatch[1].trim()}`;
    } else if (pocketNameHint) {
      // Use the last known pocket name when the description omits it (e.g., spending from a pocket)
      accountName = `Revolut Pocket: ${pocketNameHint.trim()}`;
    } else {
      accountName = 'Revolut Pocket';
    }
  } else if (normalizedProduct === 'savings') {
    accountType = 'vault';
    const vaultMatch = description.match(/To pocket (?:EUR|GBP|USD)\s+(.+?)\s+from (?:EUR|GBP|USD)/i);
    if (vaultMatch && vaultMatch[1]) {
      accountName = `Revolut Vault: ${vaultMatch[1].trim()}`;
    } else if (vaultNameHint) {
      // Use the last known vault name when Revolut emits generic "Pocket Withdrawal" rows
      accountName = `Revolut Vault: ${vaultNameHint.trim()}`;
    } else {
      accountName = 'Revolut Savings';
    }
  }

  const slug = slugifyAccountName(accountName);
  const accountKey = `${resolvedProvider}-${accountType}-${resolvedCurrency}-${slug}`;

  return { accountName, accountType, accountKey, currency: resolvedCurrency, provider: resolvedProvider };
}

/**
 * Extract account name from transaction description
 * For Revolut: 
 *   - Current: Uses Product column "Current" + Currency
 *   - Pockets: Extracts pocket name from Description (e.g., "To pocket EUR Mexico 🇲🇽 from EUR")
 *   - Savings: Extracts vault name from Description (e.g., "To pocket EUR Mexico 🇲🇽 from EUR")
 */
export function extractAccountName(
  description: string, 
  source: 'revolut' | 'aib' = 'revolut',
  product?: string,
  currency?: string
): string {
  if (source === 'revolut') {
    // Product column tells us the account type directly
    if (product?.toLowerCase() === 'current') {
      return `Revolut Current (${currency || 'EUR'})`;
    }
    
    // Product = "Pocket" means this is a pocket transaction
    // Extract pocket name from "To pocket EUR [pocket name] from EUR" pattern
    if (product?.toLowerCase() === 'pocket') {
      const pocketMatch = description.match(/To pocket (?:EUR|GBP|USD)\s+(.+?)\s+from (?:EUR|GBP|USD)/i);
      if (pocketMatch && pocketMatch[1]) {
        return `Revolut Pocket: ${pocketMatch[1].trim()}`;
      }
      // If no pocket name found in description, it might be a spending transaction from the pocket
      // Just label it as a pocket transaction
      return 'Revolut Pocket';
    }
    
    // Product = "Savings" means this is a savings vault transaction
    // Extract vault name from "To pocket EUR [vault name] from EUR" pattern
    if (product?.toLowerCase() === 'savings') {
      const vaultMatch = description.match(/To pocket (?:EUR|GBP|USD)\s+(.+?)\s+from (?:EUR|GBP|USD)/i);
      if (vaultMatch && vaultMatch[1]) {
        return `Revolut Vault: ${vaultMatch[1].trim()}`;
      }
      return 'Revolut Savings';
    }
    
    // Default to current account
    return `Revolut Current (${currency || 'EUR'})`;
  }
  
  if (source === 'aib') {
    const desc = description.toLowerCase();
    if (desc.includes('savings')) return 'AIB Savings';
    return 'AIB Current';
  }
  
  return source === 'revolut' ? 'Revolut Current' : 'AIB Current';
}

export async function removeAccountBalance(options: {
  accountName: string;
  currency: string;
  accountKey?: string;
  accountType?: string;
  provider?: string;
  userId?: string | null;
}): Promise<AccountBalance[]> {
  const { accountName, currency, accountKey, accountType, provider, userId } = options;

  try {
    const balances = await getAccountBalances(userId || undefined);
    const resolvedKey = buildAccountKey({ accountName, currency, accountKey, accountType, provider });

    const filtered = balances.filter((b) => buildAccountKeyFromBalance(b) !== resolvedKey);
    const key = userId ? `${ACCOUNT_BALANCES_KEY}_${userId}` : ACCOUNT_BALANCES_KEY;
    await AsyncStorage.setItem(key, JSON.stringify(filtered));

    if (userId) {
      try {
        await deleteAccountBalanceDoc(userId, resolvedKey);
      } catch (err) {
        console.error('Error deleting remote account balance:', err);
      }
    }

    return filtered;
  } catch (error) {
    console.error('Error removing account balance:', error);
    throw error;
  }
}

export async function upsertBalanceRemote(
  userId: string,
  accountInfo: { accountKey: string; accountName: string; accountType: string; provider?: string; currency: string },
  balance: number,
  lastUpdated?: string
) {
  // Gracefully no-op when Appwrite env isn't configured (e.g., local dev/demo)
  const envOk = Boolean(
    process.env.EXPO_PUBLIC_APPWRITE_ENDPOINT &&
    process.env.EXPO_PUBLIC_APPWRITE_PROJECT_ID &&
    process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID &&
    (process.env.EXPO_PUBLIC_APPWRITE_TABLE_BALANCES || process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_BALANCES)
  );

  if (!envOk) {
    console.warn("upsertBalanceRemote: Appwrite env not configured, skipping remote upsert");
    return;
  }

  return upsertAccountBalance(userId, {
    accountKey: accountInfo.accountKey,
    accountName: accountInfo.accountName,
    accountType: accountInfo.accountType,
    provider: accountInfo.provider,
    currency: accountInfo.currency,
    balance,
    lastUpdated,
  });
}

/**
 * Sync account balances from Appwrite to local storage
 */
export async function syncBalancesFromAppwrite(userId: string): Promise<void> {
  // Gracefully no-op when Appwrite env isn't configured
  const envOk = Boolean(
    process.env.EXPO_PUBLIC_APPWRITE_ENDPOINT &&
    process.env.EXPO_PUBLIC_APPWRITE_PROJECT_ID &&
    process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID &&
    (process.env.EXPO_PUBLIC_APPWRITE_TABLE_BALANCES || process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_BALANCES)
  );

  if (!envOk) {
    console.warn("syncBalancesFromAppwrite: Appwrite env not configured, skipping sync");
    return;
  }

  try {
    const { getAccountBalancesFromAppwrite } = await import('./appwrite');
    const remoteBalances = await getAccountBalancesFromAppwrite(userId);
    
    // Save all remote balances to local storage
    const key = `${ACCOUNT_BALANCES_KEY}_${userId}`;
    await AsyncStorage.setItem(key, JSON.stringify(remoteBalances));
    console.log(`Synced ${remoteBalances.length} balances from Appwrite`);
  } catch (error) {
    console.error('Error syncing balances from Appwrite:', error);
  }
}

/**
 * Save current balances as a snapshot (called before importing)
 */
export async function saveBalanceSnapshot(userId: string, importBatchId: string): Promise<void> {
  try {
    const balances = await getAccountBalances(userId);
    
    // Save to Appwrite for persistence across devices
    const { saveBalanceSnapshotToAppwrite } = await import('./appwrite');
    await saveBalanceSnapshotToAppwrite(userId, importBatchId, balances);
    
    console.log('Balance snapshot saved');
  } catch (error) {
    console.error('Error saving balance snapshot:', error);
  }
}

/**
 * Restore balances from the most recent snapshot
 */
export async function restoreLastBalanceSnapshot(userId: string, importBatchId: string): Promise<boolean> {
  try {
    const { restoreBalancesFromSnapshot } = await import('./appwrite');
    
    // Restore balances from Appwrite previousBalance fields for this batch
    const restored = await restoreBalancesFromSnapshot(userId, importBatchId);

    if (restored) {
      // Also sync from Appwrite to update local storage
      const { syncBalancesFromAppwrite } = await import('./appwrite');
      await syncBalancesFromAppwrite(userId);
      console.log('Balance snapshot restored');
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error restoring balance snapshot:', error);
    return false;
  }
}
