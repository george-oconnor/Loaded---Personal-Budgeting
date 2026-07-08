/**
 * One-time Appwrite -> CloudKit data migration for existing users.
 *
 * Runs entirely on the client: sign into the legacy Appwrite account once,
 * read every collection, and write it into the user's CloudKit private zone.
 * This is the ONLY place Appwrite is used in the CloudKit build; everything
 * else goes through lib/backend -> lib/cloudkit.
 *
 * Idempotent: every CloudKit record is written with a recordName derived from
 * its Appwrite $id (transactions/subscriptions) or a deterministic key
 * (singletons, hashed account keys) with an upsert save policy, so re-running
 * after a failure overwrites rather than duplicates.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as appwrite from './appwrite';
import * as ck from './cloudkit';
import { addBreadcrumb, captureException } from './sentry';

const MIGRATION_FLAG = 'migration_state_v1';

export type StepKey =
  | 'signin'
  | 'categories'
  | 'budget'
  | 'profile'
  | 'preferences'
  | 'accountImports'
  | 'balances'
  | 'balanceHistory'
  | 'subscriptions'
  | 'transactions'
  | 'finalize';

export type StepStatus = 'pending' | 'active' | 'done' | 'error';

export type MigrationStep = {
  key: StepKey;
  label: string;
  status: StepStatus;
  count?: number;
};

export type LegacyCredentials = { email: string; password: string };

const STEP_LABELS: Record<StepKey, string> = {
  signin: 'Sign in to your old account',
  categories: 'Reading categories',
  budget: 'Budget',
  profile: 'Profile',
  preferences: 'Preferences',
  accountImports: 'Account import history',
  balances: 'Account balances',
  balanceHistory: 'Balance history',
  subscriptions: 'Subscriptions',
  transactions: 'Transactions',
  finalize: 'Finishing up',
};

const STEP_ORDER: StepKey[] = [
  'signin', 'categories', 'budget', 'profile', 'preferences',
  'accountImports', 'balances', 'balanceHistory', 'subscriptions',
  'transactions', 'finalize',
];

export function buildSteps(): MigrationStep[] {
  return STEP_ORDER.map((key) => ({ key, label: STEP_LABELS[key], status: 'pending' as StepStatus }));
}

// ── Status detection ──

export async function isMigrationDoneLocally(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(MIGRATION_FLAG)) === 'done';
  } catch {
    return false;
  }
}

async function markMigrationDoneLocally(): Promise<void> {
  await AsyncStorage.setItem(MIGRATION_FLAG, 'done');
}

/** Clear the local "migration done" flag (e.g. after account deletion). */
export async function resetMigrationFlag(): Promise<void> {
  try {
    await AsyncStorage.removeItem(MIGRATION_FLAG);
  } catch {
    // best effort
  }
}

/**
 * Whether this CloudKit account already has data (a completed migration record
 * or any transactions) — used to decide whether to offer the migration prompt
 * to a fresh Sign-in-with-Apple user.
 */
export async function cloudKitHasData(): Promise<boolean> {
  try {
    if (await ck.getMigrationState()) return true;
  } catch {
    // ignore
  }
  try {
    const page = await ck.getTransactionsPaginated('me', 1);
    return page.documents.length > 0;
  } catch {
    return false;
  }
}

// ── The migration itself ──

export type MigrationResult = { success: boolean; error?: string; counts: Record<string, number> };

export async function runMigration(
  creds: LegacyCredentials | null,
  onProgress: (steps: MigrationStep[]) => void
): Promise<MigrationResult> {
  const steps = buildSteps();
  const counts: Record<string, number> = {};
  const emit = () => onProgress(steps.map((s) => ({ ...s })));
  const setStep = (key: StepKey, status: StepStatus, count?: number) => {
    const step = steps.find((s) => s.key === key);
    if (step) {
      step.status = status;
      if (count !== undefined) step.count = count;
    }
    emit();
  };

  addBreadcrumb({ message: 'Migration started', category: 'migration' });

  try {
    // 1. Legacy sign-in (reuse an existing Appwrite session if still valid)
    setStep('signin', 'active');
    let session = await appwrite.getCurrentSession().catch(() => null);
    if (!session) {
      if (!creds) throw new Error('Please sign in to your old account to migrate.');
      await appwrite.signIn(creds.email, creds.password);
      session = await appwrite.getCurrentSession().catch(() => null);
    }
    const user = await appwrite.getCurrentUser();
    if (!user) throw new Error('Could not load your old account.');
    const userId = user.$id;
    setStep('signin', 'done');

    // 2. Categories — build an Appwrite categoryId -> slug map. (In practice the
    // Appwrite doc ids already equal the slugs, so this is usually identity.)
    setStep('categories', 'active');
    const cats = await appwrite.getCategories();
    const idToSlug = new Map<string, string>();
    for (const c of cats as any[]) {
      idToSlug.set(c.$id, c.slug || c.$id);
    }
    const remapCategory = (id?: string) => (id ? idToSlug.get(id) ?? id : id);
    setStep('categories', 'done', idToSlug.size);

    // 3. Budget
    setStep('budget', 'active');
    const budget = await appwrite.getMonthlyBudget(userId);
    if (budget && budget.monthlyBudget !== undefined) {
      await ck.updateMonthlyBudget(
        userId,
        budget.monthlyBudget,
        budget.currency || 'EUR',
        (budget.cycleType as any) || 'first_working_day',
        budget.cycleDay,
        (budget.budgetSource as any) || 'manual',
        budget.lastMonthReference
      );
      counts.budget = 1;
    }
    setStep('budget', 'done', counts.budget ?? 0);

    // 4. Profile
    setStep('profile', 'active');
    const profile = await appwrite.getUserProfile(userId);
    if (profile) {
      await ck.createUserProfile(userId, profile.email || '', profile.firstName || '', profile.lastName || '');
      counts.profile = 1;
    }
    setStep('profile', 'done', counts.profile ?? 0);

    // 5. Preferences
    setStep('preferences', 'active');
    const prefs = await appwrite.getUserPreferences(userId);
    if (prefs) {
      await ck.saveUserPreferences(userId, {
        dismissedImportBanners: prefs.dismissedImportBanners,
        notificationsEnabled: prefs.notificationsEnabled,
      });
      counts.preferences = 1;
    }
    setStep('preferences', 'done', counts.preferences ?? 0);

    // 6. Account imports
    setStep('accountImports', 'active');
    const imports = await appwrite.getAccountImports(userId);
    for (const imp of imports) {
      await ck.saveAccountImport(userId, imp.accountKey, imp.accountName, imp.provider);
    }
    counts.accountImports = imports.length;
    setStep('accountImports', 'done', imports.length);

    // 7. Balances
    setStep('balances', 'active');
    const balances = await appwrite.getAccountBalancesFromAppwrite(userId);
    for (const bal of balances) {
      await ck.upsertAccountBalance(userId, {
        accountKey: bal.accountKey,
        accountName: bal.accountName,
        accountType: bal.accountType,
        provider: bal.provider,
        currency: bal.currency,
        balance: bal.balance,
        lastUpdated: bal.lastUpdated,
      });
    }
    counts.balances = balances.length;
    setStep('balances', 'done', balances.length);

    // 8. Balance history (chunked upsert; deterministic recordNames)
    setStep('balanceHistory', 'active');
    const history = await appwrite.getBalanceHistory(userId);
    if (history.length > 0) {
      await ck.upsertBalanceHistoryEntries(userId, history);
    }
    counts.balanceHistory = history.length;
    setStep('balanceHistory', 'done', history.length);

    // 9. Subscriptions — capture old->new id map for transaction remap
    setStep('subscriptions', 'active');
    const subs = await appwrite.getConfirmedSubscriptions(userId);
    const subIdMap = new Map<string, string>();
    for (const sub of subs) {
      const { id, ...rest } = sub;
      const newId = await ck.migrateSubscription(id, {
        ...rest,
        categoryId: remapCategory(rest.categoryId) || rest.categoryId,
      });
      subIdMap.set(id, newId);
    }
    counts.subscriptions = subs.length;
    setStep('subscriptions', 'done', subs.length);

    // 10. Transactions — write with the Appwrite $id as recordName (idempotent),
    // remapping categoryId and subscriptionId.
    setStep('transactions', 'active');
    const txns = await appwrite.getAllTransactionsForUser(userId);
    const prepared = txns.map((t: any) => ({
      id: t.$id,
      title: t.title,
      subtitle: t.subtitle,
      amount: t.amount,
      kind: t.kind,
      categoryId: remapCategory(t.categoryId) || t.categoryId,
      date: t.date,
      currency: t.currency || 'EUR',
      excludeFromAnalytics: t.excludeFromAnalytics,
      isAnalyticsProtected: t.isAnalyticsProtected,
      source: t.source,
      displayName: t.displayName,
      account: t.account,
      matchedTransferId: t.matchedTransferId,
      hideMerchantIcon: t.hideMerchantIcon,
      importBatchId: t.importBatchId,
      importedAt: t.importedAt,
      originalAmount: t.originalAmount,
      isSubscription: t.isSubscription,
      subscriptionId: t.subscriptionId ? subIdMap.get(t.subscriptionId) ?? t.subscriptionId : undefined,
    }));

    let migratedTx = 0;
    const result = await ck.createBulkTransactions(
      userId,
      prepared,
      (current) => setStep('transactions', 'active', current)
    );
    migratedTx = result.created;
    counts.transactions = migratedTx;
    if (result.failed > 0) {
      throw new Error(`${result.failed} of ${prepared.length} transactions failed to migrate. Tap Retry to finish.`);
    }
    setStep('transactions', 'done', migratedTx);

    // 11. Finalize
    setStep('finalize', 'active');
    await ck.setMigrationState(userId, counts);
    await markMigrationDoneLocally();
    setStep('finalize', 'done');

    addBreadcrumb({ message: 'Migration completed', category: 'migration', level: 'info', data: counts });
    return { success: true, counts };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Migration failed';
    const activeStep = steps.find((s) => s.status === 'active');
    if (activeStep) {
      activeStep.status = 'error';
      emit();
    }
    captureException(err instanceof Error ? err : new Error(errorMsg), {
      tags: { operation: 'migration', feature: 'migration' },
    });
    return { success: false, error: errorMsg, counts };
  }
}

/**
 * Mark migration complete without importing anything — for users who confirm
 * they never used the old app, so they aren't prompted again.
 */
export async function skipMigration(): Promise<void> {
  await markMigrationDoneLocally();
  try {
    await ck.setMigrationState('skipped', {});
  } catch {
    // local flag is enough
  }
}
