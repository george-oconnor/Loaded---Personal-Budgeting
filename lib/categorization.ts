import AsyncStorage from '@react-native-async-storage/async-storage';
import { ID, Query, Permission, Role } from 'appwrite';
import { databases, getCategories } from './appwrite';

const MERCHANT_MAPPINGS_KEY = 'budget_app_merchant_categories';
const databaseId = process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID;
const merchantVotesTableId = 
  process.env.EXPO_PUBLIC_APPWRITE_TABLE_MERCHANT_VOTES ||
  process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_MERCHANT_VOTES ||
  'merchant_votes';

// Learned merchant-to-category mappings
interface MerchantMapping {
  [merchantKey: string]: string; // merchantKey -> categoryId
}

/**
 * Get normalized merchant key from transaction title
 */
function getMerchantKey(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Find a matching merchant key using fuzzy matching
 * Returns the categoryId if a match is found, null otherwise
 * 
 * Matching strategy:
 * 1. Exact match on normalized key
 * 2. Stored key is contained within the new title (e.g., "tesco" matches "tescostores1234")
 * 3. New key is contained within stored key (e.g., "tescostores" matches "tesco" if min length)
 */
function findMatchingCategory(
  titleKey: string,
  learnedMappings: MerchantMapping
): string | null {
  // 1. Exact match
  if (learnedMappings[titleKey]) {
    return learnedMappings[titleKey];
  }

  // 2 & 3. Substring matching - find the best match
  const merchantKeys = Object.keys(learnedMappings);
  
  for (const storedKey of merchantKeys) {
    // Skip very short keys (less than 4 chars) to avoid false positives
    if (storedKey.length < 4) continue;
    
    // Check if stored key is contained in the new title
    if (titleKey.includes(storedKey)) {
      return learnedMappings[storedKey];
    }
    
    // Check if new title is contained in stored key (for partial matches)
    // Only if the new title key is substantial (at least 5 chars)
    if (titleKey.length >= 5 && storedKey.includes(titleKey)) {
      return learnedMappings[storedKey];
    }
  }

  return null;
}

/**
 * Get learned merchant mappings from database (crowd-sourced, most popular category wins)
 */
async function getLearnedMappings(): Promise<MerchantMapping> {
  try {
    // Try to get from database first (crowd-sourced)
    if (!databaseId || !merchantVotesTableId) {
      // Fallback to AsyncStorage if database not configured
      const data = await AsyncStorage.getItem(MERCHANT_MAPPINGS_KEY);
      return data ? JSON.parse(data) : {};
    }
    // Basic retry on transient Appwrite failures (e.g., 503)
    const maxAttempts = 2;
    let attempt = 0;
    let res: any;
    while (attempt < maxAttempts) {
      try {
        res = await databases.listDocuments(databaseId, merchantVotesTableId, []);
        break;
      } catch (err: any) {
        attempt++;
        const msg = String(err?.message || err);
        // Only retry on likely transient errors
        const isTransient = msg.includes('503') || msg.toLowerCase().includes('timeout');
        if (!isTransient || attempt >= maxAttempts) {
          throw err;
        }
        // Small backoff
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    const mappings: MerchantMapping = {};

    // Group votes by merchant and find the most popular category
    const votesByMerchant = new Map<string, Map<string, number>>();
    
    res.documents.forEach((doc: any) => {
      const merchantKey = doc.merchant_key;
      const categoryId = doc.category_id;
      
      if (!votesByMerchant.has(merchantKey)) {
        votesByMerchant.set(merchantKey, new Map());
      }
      const categoryVotes = votesByMerchant.get(merchantKey)!;
      categoryVotes.set(categoryId, (categoryVotes.get(categoryId) || 0) + doc.votes);
    });

    // Pick the most voted category for each merchant
    votesByMerchant.forEach((categoryVotes, merchantKey) => {
      let topCategory = '';
      let topVotes = 0;
      categoryVotes.forEach((votes, categoryId) => {
        if (votes > topVotes) {
          topVotes = votes;
          topCategory = categoryId;
        }
      });
      if (topCategory) {
        mappings[merchantKey] = topCategory;
      }
    });

    return mappings;
  } catch (error) {
    const msg = String((error as any)?.message || error);
    // Reduce noise for transient failures; still fallback gracefully
    if (msg.includes('503') || msg.toLowerCase().includes('timeout')) {
      console.warn('Merchant mappings temporarily unavailable, using local cache');
    } else {
      console.error('Error loading merchant mappings:', error);
    }
    // Fallback to AsyncStorage
    try {
      const data = await AsyncStorage.getItem(MERCHANT_MAPPINGS_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }
}

/**
 * Save a merchant-to-category mapping for future use (crowd-sourced learning)
 */
export async function learnMerchantCategory(merchantName: string, categoryId: string, userId?: string): Promise<void> {
  try {
    const merchantKey = getMerchantKey(merchantName);
    
    // Save to database if configured (for crowd-sourcing)
    if (databaseId && merchantVotesTableId) {
      try {
        // Check if this merchant-category vote already exists
        const existing = await databases.listDocuments(databaseId, merchantVotesTableId, [
          Query.equal('merchant_key', merchantKey),
          Query.equal('category_id', categoryId),
        ]);

        if (existing.documents.length > 0) {
          // Increment vote count
          const doc = existing.documents[0] as any;
          await databases.updateDocument(databaseId, merchantVotesTableId, doc.$id, {
            votes: (doc.votes || 1) + 1,
            last_voted: new Date().toISOString(),
          });
        } else {
          // Create new vote record
          await databases.createDocument(
            databaseId,
            merchantVotesTableId,
            ID.unique(),
            {
              merchant_key: merchantKey,
              merchant_name: merchantName,
              category_id: categoryId,
              votes: 1,
              last_voted: new Date().toISOString(),
              ...(userId && { user_id: userId }),
            },
            [
              Permission.read(Role.users()), // Anyone authenticated can read votes
              Permission.update(Role.users()), // Anyone can update vote counts
            ]
          );
        }
      } catch (dbError) {
        console.error('Error saving to merchant votes database:', dbError);
        // Fallback to AsyncStorage
        const mappings = await getLearnedMappings();
        mappings[merchantKey] = categoryId;
        await AsyncStorage.setItem(MERCHANT_MAPPINGS_KEY, JSON.stringify(mappings));
      }
    } else {
      // Fallback to AsyncStorage if database not configured
      const mappings = await getLearnedMappings();
      mappings[merchantKey] = categoryId;
      await AsyncStorage.setItem(MERCHANT_MAPPINGS_KEY, JSON.stringify(mappings));
    }
  } catch (error) {
    console.error('Error saving merchant mapping:', error);
  }
}

/**
 * Map category slug to Appwrite database ID
 */
async function getCategoryIdBySlug(slug: string): Promise<string> {
  try {
    const categories = await getCategories();
    const category = categories.find(c => c.slug === slug || c.name.toLowerCase() === slug);
    
    if (category) {
      return category.$id;
    }
    
    // Fallback: try to find General category
    const general = categories.find(c => c.slug === 'general' || c.name.toLowerCase() === 'general');
    return general ? general.$id : '';
  } catch (error) {
    console.error('Error mapping category slug:', error);
    return '';
  }
}

/**
 * Keyword-based category matching rules
 * Returns category slug or null if no match
 */
function matchKeywordRules(description: string, isExpense: boolean): string | null {
  const desc = description.toLowerCase();

  // Food & Dining keywords
  if (
    desc.includes('restaurant') ||
    desc.includes('cafe') ||
    desc.includes('coffee') ||
    desc.includes('pizza') ||
    desc.includes('burger') ||
    desc.includes('mcdonald') ||
    desc.includes('kfc') ||
    desc.includes('subway') ||
    desc.includes('starbucks') ||
    desc.includes('costa') ||
    desc.includes('nando') ||
    desc.includes('greggs') ||
    desc.includes('pret')
  ) {
    return 'food';
  }

  // Groceries
  if (
    desc.includes('grocery') ||
    desc.includes('supermarket') ||
    desc.includes('sainsbury') ||
    desc.includes('tesco') ||
    desc.includes('asda') ||
    desc.includes('waitrose') ||
    desc.includes('aldi') ||
    desc.includes('lidl') ||
    desc.includes('morrisons') ||
    desc.includes('coop') ||
    desc.includes('co-op') ||
    desc.includes('marks & spencer') ||
    desc.includes('m&s food')
  ) {
    return 'groceries';
  }

  // Transport
  if (
    desc.includes('uber') ||
    desc.includes('lyft') ||
    desc.includes('taxi') ||
    desc.includes('train') ||
    desc.includes('bus') ||
    desc.includes('tube') ||
    desc.includes('metro') ||
    desc.includes('tfl') ||
    desc.includes('transport for london') ||
    desc.includes('national rail') ||
    desc.includes('trainline') ||
    desc.includes('citymapper')
  ) {
    return 'transport';
  }

  // Entertainment
  if (
    desc.includes('cinema') ||
    desc.includes('movie') ||
    desc.includes('theatre') ||
    desc.includes('concert') ||
    desc.includes('spotify') ||
    desc.includes('netflix') ||
    desc.includes('amazon prime') ||
    desc.includes('disney') ||
    desc.includes('apple music') ||
    desc.includes('youtube premium')
  ) {
    return 'entertainment';
  }

  // Shopping
  if (
    desc.includes('amazon') ||
    desc.includes('ebay') ||
    desc.includes('shop') ||
    desc.includes('store') ||
    desc.includes('retail') ||
    desc.includes('zara') ||
    desc.includes('h&m') ||
    desc.includes('primark') ||
    desc.includes('next') ||
    desc.includes('argos') ||
    desc.includes('john lewis')
  ) {
    return 'shopping';
  }

  // Utilities
  if (
    desc.includes('electric') ||
    desc.includes('gas') ||
    desc.includes('water') ||
    desc.includes('internet') ||
    desc.includes('broadband') ||
    desc.includes('phone bill') ||
    desc.includes('mobile') ||
    desc.includes('vodafone') ||
    desc.includes('ee ') ||
    desc.includes('o2') ||
    desc.includes('three') ||
    desc.includes('bt ')
  ) {
    return 'utilities';
  }

  // Health
  if (
    desc.includes('pharmacy') ||
    desc.includes('chemist') ||
    desc.includes('doctor') ||
    desc.includes('hospital') ||
    desc.includes('dental') ||
    desc.includes('gym') ||
    desc.includes('fitness') ||
    desc.includes('boots') ||
    desc.includes('superdrug')
  ) {
    return 'health';
  }

  // Transfers/Income (not expenses)
  if (!isExpense) {
    if (
      desc.includes('salary') ||
      desc.includes('wage') ||
      desc.includes('payment received') ||
      desc.includes('transfer from')
    ) {
      return 'income';
    }
  }

  return null; // No keyword match
}

/**
 * Categorize a transaction based on its title/description
 * Uses learned mappings first, then keyword rules, finally falls back to uncategorized
 * Returns the Appwrite database ID for the category
 */
export async function categorizeTransaction(
  title: string,
  description: string,
  isExpense: boolean
): Promise<string> {
  // 1. Check learned merchant mappings with fuzzy matching
  const merchantKey = getMerchantKey(title);
  const learnedMappings = await getLearnedMappings();
  
  const fuzzyMatch = findMatchingCategory(merchantKey, learnedMappings);
  if (fuzzyMatch) {
    return fuzzyMatch;
  }

  // 2. Try keyword matching on both title and description
  const combinedText = `${title} ${description}`;
  const keywordMatch = matchKeywordRules(combinedText, isExpense);
  
  if (keywordMatch) {
    // Map the slug to the actual database ID
    return await getCategoryIdBySlug(keywordMatch);
  }

  // 3. Fall back to General category for imports
  return await getCategoryIdBySlug('general');
}

/**
 * Batch categorize multiple transactions efficiently
 * Fetches categories and learned mappings once, then categorizes all transactions
 */
export async function batchCategorizeTransactions(
  transactions: Array<{ title: string; subtitle: string; kind: 'income' | 'expense' }>
): Promise<string[]> {
  // Fetch categories and learned mappings once for all transactions
  const [categories, learnedMappings] = await Promise.all([
    getCategories(),
    getLearnedMappings()
  ]);

  // Helper to get category ID by slug from the cached categories
  const getCategoryIdFromCache = (slug: string): string => {
    const category = categories.find(c => c.slug === slug || c.name.toLowerCase() === slug);
    if (category) return category.$id;
    
    // Fallback to general
    const general = categories.find(c => c.slug === 'general' || c.name.toLowerCase() === 'general');
    return general ? general.$id : '';
  };

  // Categorize all transactions using the cached data
  return transactions.map(tx => {
    const isExpense = tx.kind === 'expense';
    
    // 1. Check learned merchant mappings with fuzzy matching
    const merchantKey = getMerchantKey(tx.title);
    const fuzzyMatch = findMatchingCategory(merchantKey, learnedMappings);
    if (fuzzyMatch) {
      return fuzzyMatch;
    }

    // 2. Try keyword matching
    const combinedText = `${tx.title} ${tx.subtitle}`;
    const keywordMatch = matchKeywordRules(combinedText, isExpense);
    
    if (keywordMatch) {
      return getCategoryIdFromCache(keywordMatch);
    }

    // 3. Fall back to General
    return getCategoryIdFromCache('general');
  });
}

/**
 * Get or create the "uncategorized" category
 * This ensures we always have a fallback category
 * Returns the Appwrite database ID for the uncategorized category
 */
export async function ensureUncategorizedCategory(): Promise<string> {
  try {
    const categories = await getCategories();
    const uncategorized = categories.find(c => c.slug === 'uncategorized' || c.name.toLowerCase() === 'uncategorized');
    
    if (uncategorized) {
      return uncategorized.$id;
    }
    
    // If no uncategorized category exists, log a warning and return first category or empty string
    console.warn('No uncategorized category found in database');
    return categories.length > 0 ? categories[0].$id : '';
  } catch (error) {
    console.error('Error checking for uncategorized category:', error);
    return '';
  }
}

/**
 * Get the "Transfer" category for account transfers
 * Returns the Appwrite database ID for the transfer category
 */
export async function getTransferCategoryId(): Promise<string> {
  try {
    const categories = await getCategories();
    const transfer = categories.find(c => c.slug === 'transfer' || c.name.toLowerCase() === 'transfer');
    
    if (transfer) {
      return transfer.$id;
    }
    
    // Fall back to general category if no transfer category exists
    console.warn('No transfer category found, using general category');
    return await getCategoryIdBySlug('general');
  } catch (error) {
    console.error('Error getting transfer category:', error);
    return await getCategoryIdBySlug('general');
  }
}
