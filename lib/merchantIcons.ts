/**
 * Merchant icon utilities for displaying brand favicons
 */

// Common merchant name to domain mappings
const merchantDomains: Record<string, string> = {
  // Supermarkets
  'tesco': 'tesco.com',
  'sainsbury': 'sainsburys.co.uk',
  'sainsburys': 'sainsburys.co.uk',
  'asda': 'asda.com',
  'aldi': 'aldi.com',
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
 * Check if a merchant has an icon available
 */
export function hasMerchantIcon(merchantName: string): boolean {
  return getMerchantDomain(merchantName) !== null;
}
