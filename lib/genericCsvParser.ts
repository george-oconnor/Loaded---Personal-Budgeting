/**
 * Generic CSV Parser
 * 
 * Uses AI-analyzed column mappings to transform any CSV format into
 * the standard transaction format used by the app.
 * 
 * SECURITY: All actual data transformation happens locally.
 * Only anonymized structure was sent to AI for column mapping.
 */

import { categorizeTransaction } from './categorization';
import { ColumnMapping } from './csvAIAnalyzer';
import { ParsedTransaction, SkippedRow } from './csvParser';

export interface GenericCSVTransaction {
  date: string;
  description: string;
  amount: number;
  currency: string;
  balance?: string;
  category?: string;
}

export interface GenericParseResult {
  transactions: GenericCSVTransaction[];
  skipped: number;
  totalRows: number;
  skippedDetails: SkippedRow[];
}

/**
 * Parse a CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

/**
 * Parse a date string using the detected format
 */
function parseDate(dateStr: string, format: string): Date | null {
  if (!dateStr || !dateStr.trim()) {
    return null;
  }
  
  const str = dateStr.trim();
  
  // Try ISO format first
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str.replace(' ', 'T'));
    if (!isNaN(d.getTime())) return d;
  }
  
  // DD/MM/YYYY or MM/DD/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const parts = str.split('/');
    // Default to DD/MM/YYYY (European format) which is more common in banking
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    
    // If format hint suggests MM/DD/YYYY
    if (format.toUpperCase().startsWith('MM')) {
      const d = new Date(year, day - 1, month + 1); // Swap day and month
      if (!isNaN(d.getTime())) return d;
    }
    
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }
  
  // DD/MM/YY
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(str)) {
    const parts = str.split('/');
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    let year = parseInt(parts[2], 10);
    // Assume 2000s for two-digit years
    year = year < 50 ? 2000 + year : 1900 + year;
    
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }
  
  // Try generic Date parsing as fallback
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  
  return null;
}

/**
 * Parse an amount string, handling various formats
 */
function parseAmount(amountStr: string): number | null {
  if (!amountStr || !amountStr.trim()) {
    return null;
  }
  
  let str = amountStr.trim();
  
  // Remove currency symbols
  str = str.replace(/[€$£¥₹]/g, '').trim();
  
  // Remove currency codes
  str = str.replace(/\s*(EUR|USD|GBP|CHF|CAD|AUD|JPY|CNY|INR)\s*/gi, '').trim();
  
  // Handle accounting format: (123.45) = -123.45
  if (/^\([\d,.\s]+\)$/.test(str)) {
    str = '-' + str.replace(/[()]/g, '');
  }
  
  // Remove thousand separators (comma in 1,234.56)
  // Be careful: some locales use comma as decimal separator
  // If there's a period, assume comma is thousand separator
  if (str.includes('.')) {
    str = str.replace(/,/g, '');
  } else if (str.includes(',')) {
    // If only comma, it might be decimal separator (European format)
    // Check if comma appears to be decimal separator (single comma near end)
    const commaPos = str.lastIndexOf(',');
    const afterComma = str.substring(commaPos + 1);
    if (afterComma.length <= 2 && /^\d+$/.test(afterComma)) {
      // Likely decimal separator
      str = str.replace(',', '.');
    } else {
      // Likely thousand separator
      str = str.replace(/,/g, '');
    }
  }
  
  // Remove any remaining non-numeric characters except minus and period
  str = str.replace(/[^\d.\-]/g, '');
  
  const amount = parseFloat(str);
  return isNaN(amount) ? null : amount;
}

/**
 * Detect the default currency from the data
 */
function detectDefaultCurrency(transactions: GenericCSVTransaction[]): string {
  const currencyCounts = new Map<string, number>();
  
  for (const tx of transactions) {
    if (tx.currency) {
      const curr = tx.currency.toUpperCase();
      currencyCounts.set(curr, (currencyCounts.get(curr) || 0) + 1);
    }
  }
  
  let maxCurrency = 'EUR';
  let maxCount = 0;
  
  for (const [currency, count] of currencyCounts) {
    if (count > maxCount) {
      maxCount = count;
      maxCurrency = currency;
    }
  }
  
  return maxCurrency;
}

/**
 * Parse generic CSV using AI-detected column mapping
 */
export function parseGenericCSV(csvContent: string, mapping: ColumnMapping): GenericParseResult {
  const rawLines = csvContent.split('\n');
  const lines = rawLines.map(l => l.replace(/\r$/, ''));

  if (lines.length < 2) {
    throw new Error('CSV file is empty or invalid');
  }

  const transactions: GenericCSVTransaction[] = [];
  let skipped = 0;
  const skippedDetails: SkippedRow[] = [];

  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      skipped++;
      skippedDetails.push({ line: i + 1, reason: 'Empty line' });
      continue;
    }

    const fields = parseCSVLine(line);

    // Defensive: skip rows whose any field is exactly a known "not actually charged"
    // status marker (e.g. a Revolut export pasted through the generic flow). These
    // rows have no balance impact and would otherwise distort the balance history.
    const hasReversedStatus = fields.some((f) => {
      const v = (f || '').trim().toUpperCase();
      return v === 'REVERTED' || v === 'DECLINED' || v === 'FAILED';
    });
    if (hasReversedStatus) {
      skipped++;
      skippedDetails.push({ line: i + 1, reason: 'Skipped reverted/declined/failed transaction' });
      continue;
    }

    try {
      // Extract date
      const dateStr = mapping.dateColumn >= 0 ? fields[mapping.dateColumn]?.trim() : '';
      const parsedDate = parseDate(dateStr, mapping.dateFormat);
      
      if (!parsedDate) {
        skipped++;
        skippedDetails.push({ line: i + 1, reason: 'Invalid or missing date' });
        continue;
      }
      
      // Extract amount
      let amount: number | null = null;
      
      if (mapping.amountFormat === 'single' && mapping.amountColumn >= 0) {
        const amountStr = fields[mapping.amountColumn]?.trim() || '';
        amount = parseAmount(amountStr);
      } else if (mapping.amountFormat === 'split') {
        // Handle debit/credit split
        const debitStr = mapping.debitColumn !== undefined ? fields[mapping.debitColumn]?.trim() : '';
        const creditStr = mapping.creditColumn !== undefined ? fields[mapping.creditColumn]?.trim() : '';
        
        const debit = parseAmount(debitStr);
        const credit = parseAmount(creditStr);
        
        if (debit && Math.abs(debit) > 0.001) {
          amount = -Math.abs(debit); // Debits are expenses (negative)
        } else if (credit && Math.abs(credit) > 0.001) {
          amount = Math.abs(credit); // Credits are income (positive)
        }
      }
      
      if (amount === null || isNaN(amount)) {
        skipped++;
        skippedDetails.push({ line: i + 1, reason: 'Invalid or missing amount' });
        continue;
      }
      
      // Apply sign convention
      if (mapping.amountSignConvention === 'inverted') {
        amount = -amount;
      }
      
      // Extract description
      const description = mapping.descriptionColumn >= 0 
        ? fields[mapping.descriptionColumn]?.trim() || 'Unknown'
        : 'Unknown';
      
      // Extract optional fields
      let currency = 'EUR';
      if (mapping.currencyColumn !== undefined && mapping.currencyColumn >= 0) {
        currency = fields[mapping.currencyColumn]?.trim().toUpperCase() || 'EUR';
        // Normalize currency codes
        if (currency === '€' || currency === 'EURO') currency = 'EUR';
        if (currency === '$' || currency === 'DOLLAR') currency = 'USD';
        if (currency === '£' || currency === 'POUND') currency = 'GBP';
      }
      
      const balance = mapping.balanceColumn !== undefined && mapping.balanceColumn >= 0
        ? fields[mapping.balanceColumn]?.trim()
        : undefined;
      
      const category = mapping.categoryColumn !== undefined && mapping.categoryColumn >= 0
        ? fields[mapping.categoryColumn]?.trim()
        : undefined;
      
      transactions.push({
        date: parsedDate.toISOString(),
        description,
        amount,
        currency,
        balance,
        category,
      });
      
    } catch {
      skipped++;
      skippedDetails.push({ line: i + 1, reason: 'Parse error' });
      continue;
    }
  }

  const totalRows = Math.max(0, lines.length - 1);
  return { transactions, skipped, totalRows, skippedDetails };
}

/**
 * Convert generic CSV transaction to app transaction format
 */
export async function convertGenericToAppTransaction(
  transaction: GenericCSVTransaction
): Promise<ParsedTransaction> {
  const isExpense = transaction.amount < 0;
  const amountInCents = Math.round(Math.abs(transaction.amount) * 100);
  
  const date = new Date(transaction.date);
  
  // Use description as title
  const title = transaction.description || (isExpense ? 'Expense' : 'Income');
  const subtitle = transaction.category || '';
  
  // Categorize the transaction
  const categoryId = await categorizeTransaction(title, subtitle, isExpense);
  
  return {
    title,
    subtitle,
    amount: amountInCents,
    kind: isExpense ? 'expense' : 'income',
    date: date.toISOString(),
    categoryId,
    currency: transaction.currency || 'EUR',
    displayName: title,
  };
}

/**
 * Process a generic CSV file end-to-end
 */
export async function processGenericCSV(
  csvContent: string,
  mapping: ColumnMapping
): Promise<{
  transactions: ParsedTransaction[];
  parseResult: GenericParseResult;
}> {
  // Parse the CSV using the mapping
  const parseResult = parseGenericCSV(csvContent, mapping);
  
  // Convert all transactions to app format
  const transactions = await Promise.all(
    parseResult.transactions.map(tx => convertGenericToAppTransaction(tx))
  );
  
  // Detect default currency if not specified per-transaction
  const defaultCurrency = detectDefaultCurrency(parseResult.transactions);
  
  // Apply default currency to transactions without one
  const finalTransactions = transactions.map(tx => ({
    ...tx,
    currency: tx.currency || defaultCurrency,
  }));
  
  return {
    transactions: finalTransactions,
    parseResult,
  };
}
