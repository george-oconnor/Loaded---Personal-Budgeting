/**
 * Merchant icon utilities for displaying brand favicons
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ID, Permission, Query, Role } from 'appwrite';
import { databases } from './appwrite';

const ICON_SUGGESTIONS_KEY = 'budget_app_icon_suggestions';
const databaseId = process.env.EXPO_PUBLIC_APPWRITE_DATABASE_ID;
const iconVotesTableId =
  process.env.EXPO_PUBLIC_APPWRITE_TABLE_ICON_VOTES ||
  process.env.EXPO_PUBLIC_APPWRITE_COLLECTION_ICON_VOTES ||
  'icon_votes';

// Interface for crowd-sourced icon mappings
interface IconMapping {
  [merchantKey: string]: string; // merchantKey -> iconUrl
}

/**
 * Get normalized merchant key from transaction title
 */
function getMerchantKey(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Get crowd-sourced icon mappings from database (most voted icon URL wins)
 */
async function getCrowdSourcedIcons(): Promise<IconMapping> {
  try {
    if (!databaseId || !iconVotesTableId) {
      // Fallback to AsyncStorage if database not configured
      const data = await AsyncStorage.getItem(ICON_SUGGESTIONS_KEY);
      return data ? JSON.parse(data) : {};
    }

    // Basic retry on transient Appwrite failures
    const maxAttempts = 2;
    let attempt = 0;
    let res: any;
    while (attempt < maxAttempts) {
      try {
        res = await databases.listDocuments(databaseId, iconVotesTableId, []);
        break;
      } catch (err: any) {
        attempt++;
        const msg = String(err?.message || err);
        const isTransient = msg.includes('503') || msg.toLowerCase().includes('timeout');
        if (!isTransient || attempt >= maxAttempts) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    }

    const mappings: IconMapping = {};

    // Group votes by merchant and find the most popular icon URL
    const votesByMerchant = new Map<string, Map<string, number>>();

    res.documents.forEach((doc: any) => {
      const merchantKey = doc.merchant_key;
      const iconUrl = doc.icon_url;

      if (!votesByMerchant.has(merchantKey)) {
        votesByMerchant.set(merchantKey, new Map());
      }
      const urlVotes = votesByMerchant.get(merchantKey)!;
      urlVotes.set(iconUrl, (urlVotes.get(iconUrl) || 0) + doc.votes);
    });

    // Pick the most voted icon URL for each merchant
    votesByMerchant.forEach((urlVotes, merchantKey) => {
      let topUrl = '';
      let topVotes = 0;
      urlVotes.forEach((votes, url) => {
        if (votes > topVotes) {
          topVotes = votes;
          topUrl = url;
        }
      });
      if (topUrl) {
        mappings[merchantKey] = topUrl;
      }
    });

    return mappings;
  } catch (error) {
    const msg = String((error as any)?.message || error);
    if (msg.includes('503') || msg.toLowerCase().includes('timeout')) {
      console.warn('Icon suggestions temporarily unavailable, using local cache');
    } else {
      console.error('Error loading icon suggestions:', error);
    }
    // Fallback to AsyncStorage
    try {
      const data = await AsyncStorage.getItem(ICON_SUGGESTIONS_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  }
}

/**
 * Suggest an icon URL for a merchant (crowd-sourced learning)
 */
export async function suggestMerchantIcon(
  merchantName: string,
  iconUrl: string,
  userId?: string
): Promise<void> {
  try {
    const merchantKey = getMerchantKey(merchantName);

    // Save to database if configured (for crowd-sourcing)
    if (databaseId && iconVotesTableId) {
      try {
        // Check if this merchant-icon vote already exists
        const existing = await databases.listDocuments(databaseId, iconVotesTableId, [
          Query.equal('merchant_key', merchantKey),
          Query.equal('icon_url', iconUrl),
        ]);

        if (existing.documents.length > 0) {
          // Increment vote count
          const doc = existing.documents[0] as any;
          await databases.updateDocument(databaseId, iconVotesTableId, doc.$id, {
            votes: (doc.votes || 1) + 1,
            last_voted: new Date().toISOString(),
          });
        } else {
          // Create new vote record
          await databases.createDocument(
            databaseId,
            iconVotesTableId,
            ID.unique(),
            {
              merchant_key: merchantKey,
              merchant_name: merchantName,
              icon_url: iconUrl,
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
        console.error('Error saving to icon votes database:', dbError);
        // Fallback to AsyncStorage
        const mappings = await getCrowdSourcedIcons();
        mappings[merchantKey] = iconUrl;
        await AsyncStorage.setItem(ICON_SUGGESTIONS_KEY, JSON.stringify(mappings));
      }
    } else {
      // Fallback to AsyncStorage if database not configured
      const mappings = await getCrowdSourcedIcons();
      mappings[merchantKey] = iconUrl;
      await AsyncStorage.setItem(ICON_SUGGESTIONS_KEY, JSON.stringify(mappings));
    }
  } catch (error) {
    console.error('Error saving icon suggestion:', error);
  }
}

/**
 * Convert a domain or URL to the final icon URL
 * If it's a direct URL (http/https), return as-is
 * If it's a domain, convert to Google favicon URL
 */
function resolveIconUrl(input: string, size: number = 128): string {
  // If it's already a direct URL, return as-is
  if (input.startsWith('http://') || input.startsWith('https://')) {
    return input;
  }
  
  // Otherwise treat as domain and use Google favicon service
  return `https://www.google.com/s2/favicons?domain=${input}&sz=${size}`;
}

/**
 * Get the suggested icon URL for a merchant from crowd-sourced data
 */
export async function getSuggestedMerchantIcon(merchantName: string, size: number = 128): Promise<string | null> {
  try {
    const merchantKey = getMerchantKey(merchantName);
    const suggestions = await getCrowdSourcedIcons();
    
    // Check exact match first
    if (suggestions[merchantKey]) {
      return resolveIconUrl(suggestions[merchantKey], size);
    }
    
    // Check partial matches (similar to category matching)
    const keys = Object.keys(suggestions);
    for (const storedKey of keys) {
      if (storedKey.length < 4) continue;
      
      if (merchantKey.includes(storedKey) || 
          (merchantKey.length >= 5 && storedKey.includes(merchantKey))) {
        return resolveIconUrl(suggestions[storedKey], size);
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error getting suggested icon:', error);
    return null;
  }
}

// Common merchant name to domain mappings
const merchantDomains: Record<string, string> = {
  // Supermarkets
  'tesco': 'tesco.com',
  'sainsbury': 'sainsburys.co.uk',
  'sainsburys': 'sainsburys.co.uk',
  'asda': 'asda.com',
  'aldi': 'aldi.ie',
  'lidl': 'lidl.com',
  'waitrose': 'waitrose.com',
  'morrisons': 'morrisons.com',
  'marks & spencer': 'marksandspencer.com',
  'm&s': 'marksandspencer.com',
  'fallon & byrne': 'fallonandbyrne.com',
  
  // Coffee & Food
  'starbucks': 'starbucks.com',
  'costa': 'costa.co.uk',
  'pret': 'pret.com',
  'greggs': 'greggs.co.uk',
  'subway': 'subway.com',
  'mcdonald': 'mcdonalds.com',
  'burger king': 'burgerking.com',
  'kfc': 'kfc.com',
  'nando': 'nandos.co.uk',
  'pizza hut': 'pizzahut.com',
  'domino': 'dominos.com',
  'mister magpie coffee': 'https://images.squarespace-cdn.com/content/v1/68ecd9f7270976356ad1b0d6/7733332e-7601-4e11-a84e-6a8f48ad90e2/Mister+Magpie+Logo.png?format=1500w',
  'mister mag': 'https://images.squarespace-cdn.com/content/v1/68ecd9f7270976356ad1b0d6/7733332e-7601-4e11-a84e-6a8f48ad90e2/Mister+Magpie+Logo.png?format=1500w',
  'spar food & fuel': 'spar.co.uk',
  'qskitchen. qs kitchen': 'qskitchen.ie',
  'qskitchen.* qs': 'qskitchen.ie',
  'boeuf restaura': 'boeuf.ie',
  'butlers chocol': 'butlerschocolate.com',
  'nando\'s': 'nandos.com',
  'nandos': 'nandos.com',
  'sprout & co': 'sproutfoodco.com',
  'póg tara street': 'ifancyapog.ie',
  'jc\'s takeaway': 'https://scontent-lga3-1.xx.fbcdn.net/v/t39.30808-1/300770167_497347769061736_5881899660955844192_n.png?stp=dst-png_s480x480&_nc_cat=111&ccb=1-7&_nc_sid=2d3e12&_nc_ohc=cMBRymZaZJUQ7kNvwGLX6x0&_nc_oc=AdnPY_FVMpJlJTqJHbtZEvpRXP8wJa7lZMBPZgBcZN9ohueIMZVtCm_xq_cVuL2HFGIYYa_VZLNPxVQcQHNUZGkr&_nc_zt=24&_nc_ht=scontent-lga3-1.xx&_nc_gid=kYvx8UkC_vko9_7RZhmqgw&oh=00_AfrmtNP5Rft4ts8v5d3UnX0NZA7Y87JFdQW53_ZpeXv3Xg&oe=6961ECA4',
  'brew twenty one': 'https://scontent-zrh1-1.cdninstagram.com/v/t51.2885-19/449200254_1025451885976282_6567563999337065492_n.jpg?stp=dst-jpg_s320x320_tt6&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLmRqYW5nby44OTAuYzIifQ&_nc_ht=scontent-zrh1-1.cdninstagram.com&_nc_cat=110&_nc_oc=Q6cZ2QFklyiu1OtJ4vC72Ph6i0-eO8eTed4vWVBzY4xL_7sSivMRlRmkcbssxjWI-ia0CFQ&_nc_ohc=Edes-GrrwpgQ7kNvwFtVJRV&_nc_gid=6PmAaW2H6j4NV0zIMIWXxA&edm=AOQ1c0wBAAAA&ccb=7-5&oh=00_AfpWi5tk_PczYhxHNum3W64U6cPaFSD7-8vIP5s8Jew5HQ&oe=6976ACC7&_nc_sid=8b3546',
  
  // Transport
  'uber': 'uber.com',
  'bolt': 'bolt.eu',
  'tfl': 'tfl.gov.uk',
  'trainline': 'trainline.com',
  'national rail': 'nationalrail.co.uk',
  'ryanair': 'ryanair.com',
  'easyjet': 'easyjet.com',
  'free now': 'free-now.com',
  'circle k gas station': 'circlek.com',
  'transport for ireland - tfi': 'transportforireland.ie',
  'dundrum car parking': 'dundrum.ie',
  
  // Streaming & Entertainment
  'netflix': 'netflix.com',
  'spotify': 'spotify.com',
  'amazon prime': 'primevideo.com',
  'disney': 'disneyplus.com',
  'apple music': 'music.apple.com',
  'youtube': 'youtube.com',
  '3olympia theatre': '3olympia.ie',
  
  // Shopping
  'amazon': 'amazon.com',
  'ebay': 'ebay.com',
  'argos': 'argos.co.uk',
  'next': 'next.co.uk',
  'zara': 'zara.com',
  'h&m': 'hm.com',
  'primark': 'primark.com',
  'penneys': 'primark.com',
  'asos': 'asos.com',
  'john lewis': 'johnlewis.com',
  'tiktok shop seller': 'tiktok.com',
  'ingredients.ie': 'https://ingredients.ie/static/logo.png',
  'bound apparel': 'boundonlineapparel.com',
  'cois farraige': 'coisfarraigerobes.ie',
  'ailínithe': 'ailinithe.ie',
  
  // Utilities & Services
  'vodafone': 'vodafone.com',
  'ee': 'ee.co.uk',
  'o2': 'o2.co.uk',
  'three': 'three.co.uk',
  'bt': 'bt.com',
  'sky': 'sky.com',
  'virgin media': 'virginmedia.com',
  'bord gais eire': 'bordgais.ie',
  'electric ireland': 'electricireland.ie',
  'prepay power': 'prepaypower.ie',
  'eir': 'eir.ie',
  'hetzner': 'hetzner.com',
  'google ads': 'ads.google.com',
  'expo': 'expo.dev',
  
  // Gyms & Health
  'puregym': 'puregym.com',
  'gymbox': 'gymbox.com',
  'david lloyd': 'davidlloyd.co.uk',
  'boots': 'boots.com',
  'superdrug': 'superdrug.com',
  'commercial rowing club': 'commercialrc.ie',
  
  // Banks & Finance
  'revolut': 'revolut.com',
  'monzo': 'monzo.com',
  'starling': 'starlingbank.com',
  'hsbc': 'hsbc.com',
  'barclays': 'barclays.com',
  'lloyds': 'lloydsbank.com',
  'natwest': 'natwest.com',
  'santander': 'santander.co.uk',
  'aib': 'aib.ie',

  // Travel & Accommodation
  'airbnb': 'airbnb.com',
  'booking.com': 'booking.com',
  'expedia': 'expedia.com',
  'hotel hotelsone.com': 'hotelsone.com',
};

/**
 * Get the domain or direct URL for a merchant name
 */
function getMerchantDomain(merchantName: string): string | null {
  const normalized = merchantName.toLowerCase().trim();
  
  // Check if the merchant name itself looks like a domain (e.g., "plex.tv", "example.com")
  const domainPattern = /^[a-z0-9-]+\.(com|net|org|tv|io|co\.uk|co\.ie|ie|uk|app|dev|gg|me|us|ca|eu|de|fr|es|it|jp|au|nz)$/i;
  if (domainPattern.test(normalized)) {
    return normalized;
  }
  
  // Check exact matches first
  if (merchantDomains[normalized]) {
    return merchantDomains[normalized];
  }
  
  // Sort keys by length (longest first) to match more specific patterns first
  const sortedKeys = Object.keys(merchantDomains).sort((a, b) => b.length - a.length);
  
  // Check partial matches with word boundaries for short keys
  for (const key of sortedKeys) {
    // For very short keys (2-3 chars), require word boundaries to avoid false matches
    if (key.length <= 3) {
      // Use word boundary regex: match only if surrounded by spaces or at start/end
      const pattern = new RegExp(`(^|\\s)${key}(\\s|$)`, 'i');
      if (pattern.test(normalized)) {
        return merchantDomains[key];
      }
    } else {
      // For longer keys, simple substring match is safe
      if (normalized.includes(key)) {
        return merchantDomains[key];
      }
    }
  }
  
  // As a last resort, try appending common TLDs to the merchant name
  // Clean the merchant name (remove spaces, special chars)
  const cleanName = normalized.replace(/[^a-z0-9]/g, '');
  
  // Skip if the cleaned name is too short (likely to cause false matches)
  if (cleanName.length >= 4) {
    // Try common TLDs in order of likelihood
    const commonTLDs = ['ie', 'com', 'co.uk', 'net', 'org'];
    
    // Return the first TLD attempt - let the favicon error handler deal with failures
    // We prioritize .ie first (Irish merchants), then .com
    return `${cleanName}.${commonTLDs[0]}`;
  }
  
  return null;
}

/**
 * Get the Google Favicon URL for a merchant, or direct image URL if provided
 * Returns null if no domain mapping exists
 */
export function getMerchantIconUrl(merchantName: string, size: number = 64, tldIndex: number = 0): string | null {
  const domain = getMerchantDomain(merchantName);
  if (!domain) return null;
  
  // If domain is a direct URL (starts with http:// or https://), return it directly
  if (domain.startsWith('http://') || domain.startsWith('https://')) {
    return domain;
  }
  
  // If domain already has a TLD or came from manual mapping, use it directly
  if (domain.includes('.') && tldIndex === 0) {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
  }
  
  // For generated domains (cleanName without TLD), try different TLDs
  const tlds = ['ie', 'com', 'co.uk'];
  if (tldIndex >= tlds.length) return null;
  
  // Remove any existing TLD from domain
  const baseDomain = domain.split('.')[0];
  const currentDomain = `${baseDomain}.${tlds[tldIndex]}`;
  
  return `https://www.google.com/s2/favicons?domain=${currentDomain}&sz=${size}`;
}

/**
 * Get the merchant icon URL with crowd-sourced suggestions (async version)
 * Checks crowd-sourced icon suggestions first, then falls back to built-in mappings
 */
export async function getMerchantIconUrlAsync(
  merchantName: string,
  size: number = 64,
  tldIndex: number = 0
): Promise<string | null> {
  // First check crowd-sourced suggestions
  const suggestedIcon = await getSuggestedMerchantIcon(merchantName);
  if (suggestedIcon) {
    return suggestedIcon;
  }
  
  // Fall back to built-in mappings
  return getMerchantIconUrl(merchantName, size, tldIndex);
}

/**
 * Check if a merchant has an icon available
 */
export function hasMerchantIcon(merchantName: string): boolean {
  return getMerchantDomain(merchantName) !== null;
}

/**
 * Check if a merchant has an icon available (async version - includes crowd-sourced)
 */
export async function hasMerchantIconAsync(merchantName: string): Promise<boolean> {
  const suggested = await getSuggestedMerchantIcon(merchantName);
  if (suggested) return true;
  return getMerchantDomain(merchantName) !== null;
}
