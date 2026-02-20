import AsyncStorage from '@react-native-async-storage/async-storage';

export function formatCurrency(
  value: number,
  currency = "USD",
  locale = "en-US"
) {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

// --- Currency Conversion ---

const EXCHANGE_RATES_KEY = 'budget_app_exchange_rates';
const RATES_TTL_MS = 6 * 60 * 60 * 1000; // Cache for 6 hours

// Fallback rates (EUR-based, approximate) used when API is unavailable
const FALLBACK_RATES: Record<string, number> = {
  EUR: 1,
  GBP: 0.86,
  USD: 1.08,
  CHF: 0.96,
  CAD: 1.47,
  AUD: 1.66,
  JPY: 162.5,
  CNY: 7.82,
  INR: 90.5,
  PLN: 4.32,
  SEK: 11.2,
  NOK: 11.5,
  DKK: 7.46,
  CZK: 25.2,
  HUF: 393,
};

interface CachedRates {
  base: string;
  rates: Record<string, number>;
  fetchedAt: number; // timestamp
}

/**
 * Fetch exchange rates from the Frankfurter API (ECB data, no API key needed).
 * Results are cached in AsyncStorage for 6 hours.
 */
export async function getExchangeRates(baseCurrency = 'EUR'): Promise<{ rates: Record<string, number>; fromCache: boolean; stale: boolean }> {
  const cacheKey = `${EXCHANGE_RATES_KEY}_${baseCurrency}`;

  // Check cache first
  try {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const parsed: CachedRates = JSON.parse(cached);
      const age = Date.now() - parsed.fetchedAt;
      if (age < RATES_TTL_MS) {
        return { rates: { ...parsed.rates, [baseCurrency]: 1 }, fromCache: true, stale: false };
      }
      // Stale but usable as fallback
    }
  } catch {
    // Cache read failed, continue to fetch
  }

  // Fetch fresh rates
  try {
    const response = await fetch(`https://api.frankfurter.dev/v1/latest?base=${baseCurrency}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const rates: Record<string, number> = data.rates || {};

    // Cache the result
    const toCache: CachedRates = { base: baseCurrency, rates, fetchedAt: Date.now() };
    await AsyncStorage.setItem(cacheKey, JSON.stringify(toCache)).catch(() => {});

    return { rates: { ...rates, [baseCurrency]: 1 }, fromCache: false, stale: false };
  } catch (error) {
    console.warn('[Currency] Failed to fetch rates, using fallback:', error);

    // Try stale cache
    try {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        const parsed: CachedRates = JSON.parse(cached);
        return { rates: { ...parsed.rates, [baseCurrency]: 1 }, fromCache: true, stale: true };
      }
    } catch {
      // Cache read failed
    }

    // Use hardcoded fallback rates, converting to requested base
    const eurRate = FALLBACK_RATES[baseCurrency] || 1;
    const converted: Record<string, number> = {};
    for (const [currency, rate] of Object.entries(FALLBACK_RATES)) {
      converted[currency] = rate / eurRate;
    }
    converted[baseCurrency] = 1;

    return { rates: converted, fromCache: false, stale: true };
  }
}

/**
 * Convert an amount from one currency to another using the provided rates.
 * Rates should be relative to a common base currency.
 */
export function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates: Record<string, number>
): number {
  if (fromCurrency === toCurrency) return amount;

  const fromRate = rates[fromCurrency];
  const toRate = rates[toCurrency];

  if (!fromRate || !toRate) {
    console.warn(`[Currency] Missing rate for ${fromCurrency} or ${toCurrency}, returning unconverted`);
    return amount;
  }

  // Convert: amount in fromCurrency -> base -> toCurrency
  return (amount / fromRate) * toRate;
}

/**
 * Determine the most common currency from a list of currency strings.
 * Falls back to EUR if no clear winner.
 */
export function getPrimaryCurrency(currencies: string[]): string {
  if (currencies.length === 0) return 'EUR';

  const counts: Record<string, number> = {};
  for (const c of currencies) {
    counts[c] = (counts[c] || 0) + 1;
  }

  let maxCount = 0;
  let primary = 'EUR';
  for (const [currency, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      primary = currency;
    }
  }
  return primary;
}
