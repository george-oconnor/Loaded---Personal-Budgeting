/**
 * CSV Anonymization Utility
 * 
 * SECURITY: This module ensures that NO personal financial data is ever sent to AI services.
 * We only send:
 * - Column headers (e.g., "Date", "Amount", "Description")
 * - Data structure/format samples with SYNTHETIC data
 * - Row/column counts
 * 
 * We NEVER send:
 * - Actual transaction descriptions/merchant names
 * - Real monetary amounts
 * - Real dates that could identify user
 * - Account numbers, names, or any PII
 */

export interface CSVStructure {
  headers: string[];
  columnCount: number;
  rowCount: number;
  sampleRows: AnonymizedRow[];
  detectedFormats: ColumnFormat[];
}

export interface AnonymizedRow {
  [columnIndex: number]: string;
}

export interface ColumnFormat {
  columnIndex: number;
  columnName: string;
  inferredType: 'date' | 'amount' | 'currency' | 'text' | 'number' | 'empty' | 'unknown';
  sampleFormat?: string; // e.g., "YYYY-MM-DD", "DD/MM/YYYY", "-123.45"
  hasNegatives?: boolean;
  currencySymbols?: string[];
}

// Synthetic data generators for anonymization
const SYNTHETIC_MERCHANTS = [
  'SAMPLE_MERCHANT_A',
  'SAMPLE_MERCHANT_B', 
  'SAMPLE_MERCHANT_C',
  'SAMPLE_STORE_1',
  'SAMPLE_STORE_2',
];

/**
 * Detect the likely type of data in a column based on sample values
 */
function detectColumnType(values: string[]): ColumnFormat['inferredType'] {
  const nonEmptyValues = values.filter(v => v && v.trim().length > 0);
  
  if (nonEmptyValues.length === 0) return 'empty';
  
  // Check for date patterns
  const datePatterns = [
    /^\d{4}-\d{2}-\d{2}/, // YYYY-MM-DD
    /^\d{2}\/\d{2}\/\d{4}/, // DD/MM/YYYY or MM/DD/YYYY
    /^\d{2}\/\d{2}\/\d{2}/, // DD/MM/YY
    /^\d{1,2}\s+\w+\s+\d{4}/, // D Mon YYYY
    /^\w+\s+\d{1,2},?\s+\d{4}/, // Mon D, YYYY
    /^\d{4}-\d{2}-\d{2}T/, // ISO datetime
    /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/, // YYYY-MM-DD HH:mm
  ];
  
  const dateMatches = nonEmptyValues.filter(v => 
    datePatterns.some(p => p.test(v.trim()))
  );
  if (dateMatches.length > nonEmptyValues.length * 0.7) {
    return 'date';
  }
  
  // Check for currency/amount patterns
  const amountPatterns = [
    /^-?[\d,]+\.?\d*$/, // 123.45 or -123.45 or 1,234.56
    /^-?€[\d,]+\.?\d*$/, // €123.45
    /^-?\$[\d,]+\.?\d*$/, // $123.45
    /^-?£[\d,]+\.?\d*$/, // £123.45
    /^-?[\d,]+\.?\d*\s*(EUR|USD|GBP|CHF)$/i, // 123.45 EUR
    /^\([\d,]+\.?\d*\)$/, // (123.45) accounting format for negatives
  ];
  
  const amountMatches = nonEmptyValues.filter(v => 
    amountPatterns.some(p => p.test(v.trim().replace(/\s/g, '')))
  );
  if (amountMatches.length > nonEmptyValues.length * 0.7) {
    return 'amount';
  }
  
  // Check for pure numbers
  const numberMatches = nonEmptyValues.filter(v => 
    /^-?[\d,]+\.?\d*$/.test(v.trim().replace(/\s/g, ''))
  );
  if (numberMatches.length > nonEmptyValues.length * 0.7) {
    return 'number';
  }
  
  // Check for currency codes
  const currencyCodePattern = /^(EUR|USD|GBP|CHF|CAD|AUD|JPY|CNY|INR)$/i;
  const currencyMatches = nonEmptyValues.filter(v => 
    currencyCodePattern.test(v.trim())
  );
  if (currencyMatches.length > nonEmptyValues.length * 0.7) {
    return 'currency';
  }
  
  return 'text';
}

/**
 * Detect the format pattern of dates in a column
 */
function detectDateFormat(values: string[]): string | undefined {
  const nonEmptyValues = values.filter(v => v && v.trim().length > 0);
  
  for (const value of nonEmptyValues) {
    const v = value.trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return 'ISO_DATETIME';
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(v)) return 'YYYY-MM-DD HH:mm:ss';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'YYYY-MM-DD';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return 'DD/MM/YYYY or MM/DD/YYYY';
    if (/^\d{2}\/\d{2}\/\d{2}$/.test(v)) return 'DD/MM/YY';
    if (/^\d{1,2}\s+\w+\s+\d{4}$/.test(v)) return 'D Mon YYYY';
  }
  
  return undefined;
}

/**
 * Detect the format of amounts (negative indicators, currency symbols)
 */
function detectAmountFormat(values: string[]): { hasNegatives: boolean; currencySymbols: string[] } {
  const nonEmptyValues = values.filter(v => v && v.trim().length > 0);
  
  const hasNegatives = nonEmptyValues.some(v => 
    v.includes('-') || v.includes('(')
  );
  
  const symbols: Set<string> = new Set();
  for (const v of nonEmptyValues) {
    if (v.includes('€')) symbols.add('€');
    if (v.includes('$')) symbols.add('$');
    if (v.includes('£')) symbols.add('£');
    if (/EUR/i.test(v)) symbols.add('EUR');
    if (/USD/i.test(v)) symbols.add('USD');
    if (/GBP/i.test(v)) symbols.add('GBP');
  }
  
  return {
    hasNegatives,
    currencySymbols: Array.from(symbols),
  };
}

/**
 * Generate a synthetic/anonymized value based on the detected type
 */
function generateSyntheticValue(type: ColumnFormat['inferredType'], columnIndex: number, rowIndex: number): string {
  switch (type) {
    case 'date':
      // Generate synthetic date in common format
      const baseDate = new Date(2024, 0, 1);
      baseDate.setDate(baseDate.getDate() + rowIndex);
      return baseDate.toISOString().split('T')[0];
    
    case 'amount':
      // Generate synthetic amount (mix of positive and negative)
      const amounts = ['-50.00', '125.50', '-23.99', '500.00', '-89.95'];
      return amounts[rowIndex % amounts.length];
    
    case 'number':
      return String((rowIndex + 1) * 100);
    
    case 'currency':
      return 'EUR';
    
    case 'text':
      return SYNTHETIC_MERCHANTS[rowIndex % SYNTHETIC_MERCHANTS.length];
    
    case 'empty':
      return '';
    
    default:
      return `SAMPLE_VALUE_${columnIndex}_${rowIndex}`;
  }
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
 * Anonymize CSV content for AI analysis
 * 
 * SECURITY: This function extracts ONLY the structural information from CSV data.
 * No actual financial data, merchant names, or personal information is included.
 * 
 * @param csvContent - The raw CSV content from the user
 * @returns An anonymized structure safe to send to AI services
 */
export function anonymizeCSVForAnalysis(csvContent: string): CSVStructure {
  const rawLines = csvContent.split('\n');
  const lines = rawLines.map(l => l.replace(/\r$/, '')).filter(l => l.trim().length > 0);
  
  if (lines.length === 0) {
    throw new Error('CSV file is empty');
  }
  
  // Parse headers
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const columnCount = headers.length;
  const rowCount = lines.length - 1; // Excluding header
  
  // Collect sample values for each column (up to 10 rows) for type detection
  const columnSamples: string[][] = Array.from({ length: columnCount }, () => []);
  const sampleSize = Math.min(10, rowCount);
  
  for (let i = 1; i <= sampleSize; i++) {
    if (i >= lines.length) break;
    const fields = parseCSVLine(lines[i]);
    for (let j = 0; j < columnCount; j++) {
      columnSamples[j].push(fields[j] || '');
    }
  }
  
  // Detect format for each column
  const detectedFormats: ColumnFormat[] = headers.map((header, index) => {
    const inferredType = detectColumnType(columnSamples[index]);
    const format: ColumnFormat = {
      columnIndex: index,
      columnName: header,
      inferredType,
    };
    
    if (inferredType === 'date') {
      format.sampleFormat = detectDateFormat(columnSamples[index]);
    } else if (inferredType === 'amount') {
      const amountInfo = detectAmountFormat(columnSamples[index]);
      format.hasNegatives = amountInfo.hasNegatives;
      format.currencySymbols = amountInfo.currencySymbols;
    }
    
    return format;
  });
  
  // Generate synthetic sample rows (NEVER include real data)
  const sampleRows: AnonymizedRow[] = [];
  for (let i = 0; i < Math.min(3, rowCount); i++) {
    const row: AnonymizedRow = {};
    for (let j = 0; j < columnCount; j++) {
      row[j] = generateSyntheticValue(detectedFormats[j].inferredType, j, i);
    }
    sampleRows.push(row);
  }
  
  return {
    headers,
    columnCount,
    rowCount,
    sampleRows,
    detectedFormats,
  };
}

/**
 * Create a human-readable description of the CSV structure for AI analysis
 * This is what gets sent to the AI - containing NO actual user data
 */
export function createStructureDescription(structure: CSVStructure): string {
  const lines: string[] = [
    '=== CSV STRUCTURE ANALYSIS (ANONYMIZED - NO REAL USER DATA) ===',
    '',
    `Total Columns: ${structure.columnCount}`,
    `Total Data Rows: ${structure.rowCount}`,
    '',
    '=== COLUMN DETAILS ===',
  ];
  
  for (const format of structure.detectedFormats) {
    let details = `Column ${format.columnIndex + 1}: "${format.columnName}" - Type: ${format.inferredType}`;
    
    if (format.sampleFormat) {
      details += ` (Format: ${format.sampleFormat})`;
    }
    if (format.hasNegatives) {
      details += ' [Has negative values]';
    }
    if (format.currencySymbols && format.currencySymbols.length > 0) {
      details += ` [Currency symbols: ${format.currencySymbols.join(', ')}]`;
    }
    
    lines.push(details);
  }
  
  lines.push('');
  lines.push('=== SYNTHETIC SAMPLE ROWS (NOT REAL DATA) ===');
  lines.push(`Headers: ${structure.headers.join(', ')}`);
  
  for (let i = 0; i < structure.sampleRows.length; i++) {
    const row = structure.sampleRows[i];
    const values = Object.values(row);
    lines.push(`Row ${i + 1}: ${values.join(', ')}`);
  }
  
  return lines.join('\n');
}

/**
 * Validate that a structure description contains no sensitive data patterns
 * Extra security check before sending to AI
 */
export function validateNoSensitiveData(description: string): { safe: boolean; warnings: string[] } {
  const warnings: string[] = [];
  
  // Check for potential real monetary values (more than 2 digits before decimal)
  const realAmountPattern = /\b\d{3,}\.\d{2}\b/g;
  const potentialAmounts = description.match(realAmountPattern);
  if (potentialAmounts && potentialAmounts.length > 5) {
    warnings.push('Detected many decimal numbers that could be real amounts');
  }
  
  // Check for potential account numbers (long digit sequences)
  const accountPattern = /\b\d{8,}\b/g;
  const potentialAccounts = description.match(accountPattern);
  if (potentialAccounts) {
    warnings.push('Detected long number sequences that could be account numbers');
  }
  
  // Check for email patterns
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  if (emailPattern.test(description)) {
    warnings.push('Detected potential email addresses');
  }
  
  // Check for potential names (title case words that aren't common terms)
  // This is a soft check
  
  return {
    safe: warnings.length === 0,
    warnings,
  };
}
