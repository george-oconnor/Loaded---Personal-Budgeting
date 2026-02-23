/**
 * PDF Parser
 * 
 * SECURITY: All parsing happens entirely ON-DEVICE.
 * Takes the real data rows from pdfTableDetector and the column mapping
 * from pdfAIAnalyzer (or heuristic analysis) and produces ParsedTransaction[].
 * 
 * This is the PDF equivalent of genericCsvParser.ts.
 * The real financial data NEVER leaves the device — only the anonymized
 * structure was sent to AI, and the mapping instructions came back.
 */

import { categorizeTransaction } from './categorization';
import { ColumnMapping } from './csvAIAnalyzer';
import { ParsedTransaction, SkippedRow } from './csvParser';
import { DetectedTable, DetectedRow } from './pdfTableDetector';

// ─── Types ────────────────────────────────────────────────────────────────

export interface PdfTransaction {
  date: string;
  description: string;
  amount: number;
  currency: string;
  balance?: string;
}

export interface PdfParseResult {
  transactions: PdfTransaction[];
  skipped: number;
  totalRows: number;
  skippedDetails: SkippedRow[];
}

// ─── Date Parsing ─────────────────────────────────────────────────────────

function parseDate(dateStr: string, format: string): Date | null {
  if (!dateStr || !dateStr.trim()) return null;

  const str = dateStr.trim();

  // ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str.replace(' ', 'T'));
    if (!isNaN(d.getTime())) return d;
  }

  // DD Mon (no year) — common in credit card statements
  // Infer year: use current year; if the date is in the future, use previous year
  const shortMonthMatch = str.match(/^(\d{1,2})\s+(\S+)$/);
  if (shortMonthMatch) {
    const day = parseInt(shortMonthMatch[1], 10);
    const monthToken = shortMonthMatch[2];
    let monthNum = parseMonthName(monthToken);
    if (monthNum === -1) monthNum = parseOcrMonth(monthToken);
    if (monthNum !== -1 && day >= 1 && day <= 31) {
      const now = new Date();
      let year = now.getFullYear();
      const candidate = new Date(year, monthNum, day);
      // If the date is more than 2 months in the future, assume previous year
      if (candidate.getTime() > now.getTime() + 60 * 24 * 60 * 60 * 1000) {
        year--;
      }
      const d = new Date(year, monthNum, day);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const euroMatch = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (euroMatch) {
    const a = parseInt(euroMatch[1], 10);
    const b = parseInt(euroMatch[2], 10);
    const year = parseInt(euroMatch[3], 10);

    if (format.toUpperCase().startsWith('MM')) {
      // MM/DD/YYYY
      const d = new Date(year, a - 1, b);
      if (!isNaN(d.getTime())) return d;
    }
    // Default DD/MM/YYYY
    const d = new Date(year, b - 1, a);
    if (!isNaN(d.getTime())) return d;
  }

  // DD/MM/YY
  const shortMatch = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/);
  if (shortMatch) {
    const day = parseInt(shortMatch[1], 10);
    const month = parseInt(shortMatch[2], 10) - 1;
    let year = parseInt(shortMatch[3], 10);
    year = year < 50 ? 2000 + year : 1900 + year;
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }

  // DD Mon YYYY or DD Month YYYY (also handles OCR-garbled months)
  const monthNameMatch = str.match(/^(\d{1,2})\s+(\S+)\s+(\d{2,4})$/);
  if (monthNameMatch) {
    const day = parseInt(monthNameMatch[1], 10);
    const monthToken = monthNameMatch[2];
    let year = parseInt(monthNameMatch[3], 10);
    if (year < 100) year = year < 50 ? 2000 + year : 1900 + year;

    // Try exact match first, then OCR-fuzzy match
    let monthNum = parseMonthName(monthToken);
    if (monthNum === -1) {
      monthNum = parseOcrMonth(monthToken);
    }
    if (monthNum !== -1 && day >= 1 && day <= 31) {
      const d = new Date(year, monthNum, day);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Mon DD, YYYY
  const usMonthMatch = str.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (usMonthMatch) {
    const monthName = usMonthMatch[1];
    const day = parseInt(usMonthMatch[2], 10);
    const year = parseInt(usMonthMatch[3], 10);
    const monthNum = parseMonthName(monthName);
    if (monthNum !== -1) {
      const d = new Date(year, monthNum, day);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Generic fallback
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;

  return null;
}

function parseMonthName(name: string): number {
  const months: Record<string, number> = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };
  return months[name.toLowerCase()] ?? -1;
}

/**
 * Fuzzy month name parser for OCR-garbled text.
 * OCR commonly confuses letters with visually similar digits/characters:
 *   e.g. "Feb" → "F3b", "251", "Fcb", "Feh"
 *        "Jan" → "J4n", "1an", "Jon"
 * Strategy: try edit-distance and common OCR substitution patterns.
 */
function parseOcrMonth(token: string): number {
  if (!token || token.length < 2) return -1;

  const canonical = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  ];

  // Common OCR character substitutions
  const ocrNormalize = (s: string): string =>
    s.toLowerCase()
      .replace(/0/g, 'o')
      .replace(/1/g, 'l')
      .replace(/3/g, 'e')  // 3 ↔ e
      .replace(/4/g, 'a')  // 4 ↔ a
      .replace(/5/g, 's')  // 5 ↔ s
      .replace(/6/g, 'b')  // 6 ↔ b
      .replace(/7/g, 't')  // 7 ↔ t
      .replace(/8/g, 'b')  // 8 ↔ b
      .replace(/9/g, 'g'); // 9 ↔ g

  const normalized = ocrNormalize(token);

  // First try: does the normalized token start with a 3-letter month?
  for (let i = 0; i < canonical.length; i++) {
    if (normalized.startsWith(canonical[i])) return i;
  }

  // Second try: edit distance ≤ 1 against first 3 chars
  const first3 = normalized.slice(0, 3);
  for (let i = 0; i < canonical.length; i++) {
    if (editDistance(first3, canonical[i]) <= 1) return i;
  }

  // Third try: pure digits → could be month number from OCR
  const num = parseInt(token, 10);
  if (num >= 1 && num <= 12) return num - 1;

  return -1;
}

function editDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) {
        matrix[i][j] = j;
      } else {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost,
        );
      }
    }
  }
  return matrix[a.length][b.length];
}

// ─── Amount Parsing ───────────────────────────────────────────────────────

function parseAmount(amountStr: string): number | null {
  if (!amountStr || !amountStr.trim()) return null;

  let str = amountStr.trim();

  // Remove currency symbols
  str = str.replace(/[€$£¥₹]/g, '').trim();

  // Remove currency codes
  str = str.replace(/\s*(EUR|USD|GBP|CHF|CAD|AUD)\s*/gi, '').trim();

  // Handle DR/CR suffix (common in bank statements)
  let isDebit = false;
  if (/\s*DR\s*$/i.test(str)) {
    isDebit = true;
    str = str.replace(/\s*DR\s*$/i, '').trim();
  } else if (/\s*CR\s*$/i.test(str)) {
    str = str.replace(/\s*CR\s*$/i, '').trim();
  }

  // Handle accounting format: (123.45) = -123.45
  if (/^\([\d,.\s]+\)$/.test(str)) {
    str = '-' + str.replace(/[()]/g, '');
  }

  // Handle thousand separators
  if (str.includes('.') && str.includes(',')) {
    // Both present — determine which is decimal separator
    const lastDot = str.lastIndexOf('.');
    const lastComma = str.lastIndexOf(',');
    if (lastDot > lastComma) {
      // Period is decimal: 1,234.56
      str = str.replace(/,/g, '');
    } else {
      // Comma is decimal: 1.234,56 (European)
      str = str.replace(/\./g, '').replace(',', '.');
    }
  } else if (str.includes(',')) {
    const commaPos = str.lastIndexOf(',');
    const afterComma = str.substring(commaPos + 1);
    if (afterComma.length <= 2 && /^\d+$/.test(afterComma)) {
      // Comma is decimal separator
      str = str.replace(',', '.');
    } else {
      // Comma is thousand separator
      str = str.replace(/,/g, '');
    }
  }

  // Remove non-numeric except minus and period
  str = str.replace(/[^\d.\-]/g, '');

  const amount = parseFloat(str);
  if (isNaN(amount)) return null;

  // Apply DR flag
  if (isDebit && amount > 0) {
    return -amount;
  }

  return amount;
}

// ─── Main Parser ──────────────────────────────────────────────────────────

/**
 * Parse a detected PDF table using the column mapping to produce raw transactions.
 * All processing is LOCAL — real data never leaves the device.
 */
export function parsePdfTable(
  table: DetectedTable,
  mapping: ColumnMapping
): PdfParseResult {
  const transactions: PdfTransaction[] = [];
  let skipped = 0;
  const skippedDetails: SkippedRow[] = [];

  console.log('PDF parser: sign convention =', mapping.amountSignConvention,
    '| isCreditCardFormat =', table.isCreditCardFormat,
    '| rows =', table.dataRows.length);

  for (const row of table.dataRows) {
    const fields = row.fields;

    try {
      // Extract date
      const dateStr = mapping.dateColumn >= 0 ? fields[mapping.dateColumn]?.trim() : '';
      const parsedDate = parseDate(dateStr, mapping.dateFormat);

      if (!parsedDate) {
        skipped++;
        skippedDetails.push({ line: row.lineNumber, reason: `Invalid date: "${dateStr}" (raw: "${row.rawText.slice(0, 80)}")` });
        console.log('PDF row skipped (bad date):', { line: row.lineNumber, dateStr, fields: fields.slice(0, 5) });
        continue;
      }

      // Extract amount
      let amount: number | null = null;

      if (mapping.amountFormat === 'single' && mapping.amountColumn >= 0) {
        amount = parseAmount(fields[mapping.amountColumn]?.trim() || '');
      } else if (mapping.amountFormat === 'split') {
        const debitStr =
          mapping.debitColumn !== undefined ? fields[mapping.debitColumn]?.trim() : '';
        const creditStr =
          mapping.creditColumn !== undefined ? fields[mapping.creditColumn]?.trim() : '';

        const debit = parseAmount(debitStr);
        const credit = parseAmount(creditStr);

        if (debit && Math.abs(debit) > 0.001) {
          amount = -Math.abs(debit);
        } else if (credit && Math.abs(credit) > 0.001) {
          amount = Math.abs(credit);
        }
      }

      if (amount === null || isNaN(amount)) {
        skipped++;
        skippedDetails.push({ line: row.lineNumber, reason: 'Invalid or missing amount' });
        continue;
      }

      // Apply sign convention
      if (mapping.amountSignConvention === 'inverted') {
        amount = -amount;
      }

      // Extract description
      const description =
        mapping.descriptionColumn >= 0
          ? fields[mapping.descriptionColumn]?.trim() || 'Unknown'
          : 'Unknown';

      // Extract optional balance
      const balance =
        mapping.balanceColumn !== undefined && mapping.balanceColumn >= 0
          ? fields[mapping.balanceColumn]?.trim()
          : undefined;

      // Detect currency from amount string or default to EUR
      let currency = 'EUR';
      if (mapping.currencyColumn !== undefined && mapping.currencyColumn >= 0) {
        currency = fields[mapping.currencyColumn]?.trim().toUpperCase() || 'EUR';
      }

      transactions.push({
        date: parsedDate.toISOString(),
        description,
        amount,
        currency,
        balance,
      });
    } catch {
      skipped++;
      skippedDetails.push({ line: row.lineNumber, reason: 'Parse error' });
    }
  }

  return {
    transactions,
    skipped,
    totalRows: table.totalDataRows,
    skippedDetails,
  };
}

// ─── Conversion to App Format ─────────────────────────────────────────────

/**
 * Convert a raw PDF transaction to the app's standard ParsedTransaction format
 */
async function convertPdfToAppTransaction(
  transaction: PdfTransaction
): Promise<ParsedTransaction> {
  const isExpense = transaction.amount < 0;
  const amountInCents = Math.round(Math.abs(transaction.amount) * 100);
  const date = new Date(transaction.date);

  const title = transaction.description || (isExpense ? 'Expense' : 'Income');
  const subtitle = '';

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
 * Process a detected PDF table end-to-end:
 * 1. Parse rows using column mapping (LOCAL)
 * 2. Convert to app's standard ParsedTransaction format (LOCAL)
 * 
 * @param table - Detected table from pdfTableDetector
 * @param mapping - Column mapping from pdfAIAnalyzer (or heuristic)
 * @returns Parsed transactions ready for import
 */
export async function processPdfTable(
  table: DetectedTable,
  mapping: ColumnMapping
): Promise<{
  transactions: ParsedTransaction[];
  parseResult: PdfParseResult;
}> {
  const parseResult = parsePdfTable(table, mapping);

  const transactions = await Promise.all(
    parseResult.transactions.map(tx => convertPdfToAppTransaction(tx))
  );

  // Detect dominant currency
  const currencyCounts = new Map<string, number>();
  for (const tx of parseResult.transactions) {
    const c = tx.currency.toUpperCase();
    currencyCounts.set(c, (currencyCounts.get(c) || 0) + 1);
  }
  let defaultCurrency = 'EUR';
  let maxCount = 0;
  for (const [currency, count] of currencyCounts) {
    if (count > maxCount) {
      maxCount = count;
      defaultCurrency = currency;
    }
  }

  const finalTransactions = transactions.map(tx => ({
    ...tx,
    currency: tx.currency || defaultCurrency,
  }));

  return {
    transactions: finalTransactions,
    parseResult,
  };
}
