/**
 * PDF Table Detector
 * 
 * SECURITY: Runs entirely on-device. Analyzes the raw text extracted from a PDF
 * to identify transaction table boundaries, column positions, and row patterns.
 * 
 * This is analogous to csvDetector.ts but for PDF-extracted text where columns
 * are aligned by whitespace rather than delimited by commas.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface DetectedColumn {
  index: number;
  startPos: number;    // Character position where column starts
  endPos: number;      // Character position where column ends
  name: string;        // Detected header name
  inferredType: 'date' | 'amount' | 'text' | 'number' | 'empty' | 'unknown';
  sampleFormat?: string;
  hasNegatives?: boolean;
  currencySymbols?: string[];
}

export interface DetectedRow {
  lineNumber: number;
  rawText: string;
  fields: string[];    // Extracted field values based on column boundaries
  isDataRow: boolean;  // True if this looks like a transaction row
}

export interface DetectedTable {
  headerLineNumber: number;
  headerText: string;
  columns: DetectedColumn[];
  dataRows: DetectedRow[];
  startLine: number;
  endLine: number;
  totalDataRows: number;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
  isCreditCardFormat?: boolean;  // Hint: amounts are expenditures (positive = expense)
}

export interface TableDetectionResult {
  success: boolean;
  tables: DetectedTable[];      // May find multiple tables (e.g., multi-page)
  mergedTable: DetectedTable | null;  // All tables merged into one
  rawLineCount: number;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────

// Keywords that commonly appear in bank statement table headers
const DATE_KEYWORDS = ['date', 'posted', 'transaction date', 'value date', 'booking date', 'effective date'];
const AMOUNT_KEYWORDS = ['amount', 'value', 'sum', 'total', 'money out', 'money in'];
const DEBIT_KEYWORDS = ['debit', 'dr', 'withdrawal', 'money out', 'payments', 'out'];
const CREDIT_KEYWORDS = ['credit', 'cr', 'deposit', 'money in', 'receipts', 'in'];
const DESCRIPTION_KEYWORDS = ['description', 'details', 'particulars', 'narrative', 'reference', 'payee', 'merchant', 'transaction'];
const BALANCE_KEYWORDS = ['balance', 'running balance', 'available', 'closing balance'];

// Date patterns for detection
const DATE_PATTERNS = [
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,           // DD/MM/YYYY or DD/MM/YY
  /^\d{1,2}-\d{1,2}-\d{2,4}$/,              // DD-MM-YYYY
  /^\d{4}-\d{2}-\d{2}$/,                    // YYYY-MM-DD
  /^\d{1,2}\s+\w{3,9}\s+\d{2,4}$/,          // DD Mon YYYY or DD Month YYYY
  /^\w{3,9}\s+\d{1,2},?\s+\d{4}$/,          // Mon DD, YYYY
  /^\d{1,2}\.\d{1,2}\.\d{2,4}$/,            // DD.MM.YYYY (European)
];

// OCR-tolerant date patterns — OCR can mangle letters into digits/symbols
// e.g. "18 Feb 25" → "18 251 25" or "18 Fc6 25" or "18 F3b 25"
const OCR_DATE_PATTERNS = [
  ...DATE_PATTERNS,
  /^\d{1,2}\s+\S{2,9}\s+\d{2,4}$/,          // DD <anything> YY(YY) — OCR-garbled month
  /^\d{1,2}\s+\S{2,9}\s*$/,                  // DD <anything> (year might be on next token)
  /^\d{1,2}\s+\w{1,3}\d{0,3}\w{0,3}\s+\d{2,4}$/, // DD <garbled-month> YY(YY)
];

// Amount patterns
const AMOUNT_PATTERNS = [
  /^-?[\d,]+\.\d{2}$/,                       // 1,234.56 or -1,234.56
  /^-?€[\d,]+\.\d{2}$/,                      // €1,234.56
  /^-?\$[\d,]+\.\d{2}$/,                     // $1,234.56
  /^-?£[\d,]+\.\d{2}$/,                      // £1,234.56
  /^\([\d,]+\.\d{2}\)$/,                     // (1,234.56) — accounting negative
  /^-?[\d.]+,\d{2}$/,                        // European: 1.234,56
  /^-?€[\d.]+,\d{2}$/,                       // €1.234,56
  /^[\d,]+\.\d{2}\s*(DR|CR)$/i,              // 1,234.56 DR / CR
];

// ─── Main Detection Function ─────────────────────────────────────────────

/**
 * Detect transaction tables in extracted PDF text.
 * 
 * Strategy:
 * 1. Split text into lines
 * 2. Find header rows by matching financial column keywords
 * 3. Determine column boundaries from header positions
 * 4. Extract data rows below each header
 * 5. Validate rows match expected patterns (date + text + numbers)
 * 6. Merge tables from multiple pages if needed
 */
export function detectTables(extractedText: string): TableDetectionResult {
  const lines = extractedText.split('\n');

  if (lines.length < 3) {
    return {
      success: false,
      tables: [],
      mergedTable: null,
      rawLineCount: lines.length,
      error: 'PDF text too short to contain a transaction table',
    };
  }

  const warnings: string[] = [];

  console.log('PDF table detector: processing', lines.length, 'lines');

  // Strategy A: Try simple line-format detection first (e.g. "DD Mon Description Amount")
  // This handles credit card statements where each transaction is a single line
  const lineFormatResult = detectSimpleLineFormat(lines);
  if (lineFormatResult && lineFormatResult.dataRows.length >= 3) {
    console.log('PDF table detector: simple line format detected with', lineFormatResult.dataRows.length, 'rows');
    return {
      success: true,
      tables: [lineFormatResult],
      mergedTable: lineFormatResult,
      rawLineCount: lines.length,
    };
  }

  // Strategy B: Traditional multi-column table detection
  // Step 1: Find candidate header lines
  const headerCandidates = findHeaderCandidates(lines);

  if (headerCandidates.length === 0) {
    console.log('PDF table detector: no explicit headers found, trying inferred');
    // Try a more lenient search — look for lines followed by date-like rows
    const inferredHeaders = inferHeadersFromDataPatterns(lines);
    if (inferredHeaders.length === 0) {
      // If line format found some rows but < 3, still use it
      if (lineFormatResult && lineFormatResult.dataRows.length > 0) {
        console.log('PDF table detector: using line format with', lineFormatResult.dataRows.length, 'rows (below threshold but best available)');
        return {
          success: true,
          tables: [lineFormatResult],
          mergedTable: lineFormatResult,
          rawLineCount: lines.length,
        };
      }
      return {
        success: false,
        tables: [],
        mergedTable: null,
        rawLineCount: lines.length,
        error: 'Could not find a transaction table header in the PDF. Expected columns like Date, Description, Amount.',
      };
    }
    headerCandidates.push(...inferredHeaders);
    warnings.push('Headers were inferred from data patterns rather than explicit labels');
  }

  // Step 2: For each header, detect columns and extract data rows
  const tables: DetectedTable[] = [];

  for (const headerInfo of headerCandidates) {
    console.log('PDF table detector: trying header at line', headerInfo.lineNumber, ':', headerInfo.text.slice(0, 100));
    const table = extractTable(lines, headerInfo.lineNumber, headerInfo.text);
    if (table && table.dataRows.length > 0) {
      console.log('PDF table detector: extracted table with', table.dataRows.length, 'rows,', table.columns.length, 'columns');
      tables.push(table);
    } else {
      console.log('PDF table detector: no data rows found for this header');
    }
  }

  if (tables.length === 0) {
    // Fall back to line format if it had any results
    if (lineFormatResult && lineFormatResult.dataRows.length > 0) {
      console.log('PDF table detector: columnar failed, falling back to line format with', lineFormatResult.dataRows.length, 'rows');
      return {
        success: true,
        tables: [lineFormatResult],
        mergedTable: lineFormatResult,
        rawLineCount: lines.length,
      };
    }
    return {
      success: false,
      tables: [],
      mergedTable: null,
      rawLineCount: lines.length,
      error: 'Found potential headers but could not extract transaction data rows',
    };
  }

  // Step 3: Merge multi-page tables (same column structure = same table)
  const mergedTable = mergeTables(tables);

  return {
    success: true,
    tables,
    mergedTable,
    rawLineCount: lines.length,
  };
}

// ─── Simple Line-Format Detection ─────────────────────────────────────────

/**
 * Detect transactions in a simple line format commonly used by credit card statements.
 * Each transaction is on a single line: "DD Mon DESCRIPTION AMOUNT"
 * 
 * Examples:
 *   17 Jan TESCO STORES 3572 DUBLIN 4 17.18
 *   18 Jan Revolut**2587* Dublin IR 250.00
 *   25 Jan THE OLD SPOT Dublin 4 IR 105.00
 */
const SIMPLE_LINE_PATTERN = /^(\d{1,2})\s+(\w{3,9})\s+(.+?)\s+(-?[\d,]+\.\d{2})\s*$/;
const SIMPLE_LINE_PATTERN_EURO = /^(\d{1,2})\s+(\w{3,9})\s+(.+?)\s+€?(-?[\d,]+\.\d{2})\s*$/;

// OCR-tolerant version: month token can be garbled, optional minus for payments/refunds
// Also handles space between minus and digits from OCR, and CR/DR suffixes
const SIMPLE_LINE_PATTERN_OCR = /^(\d{1,2})\s+(\S{2,9})\s+(.+?)\s+€?(-?\s?[\d,]+\.\d{2})\s*(?:CR|DR)?\s*$/i;

function isSimpleTransactionLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    SIMPLE_LINE_PATTERN.test(trimmed) ||
    SIMPLE_LINE_PATTERN_EURO.test(trimmed) ||
    SIMPLE_LINE_PATTERN_OCR.test(trimmed)
  );
}

function parseSimpleTransactionLine(line: string): { date: string; description: string; amount: string } | null {
  const trimmed = line.trim();
  const match = trimmed.match(SIMPLE_LINE_PATTERN_OCR) ||
    trimmed.match(SIMPLE_LINE_PATTERN) ||
    trimmed.match(SIMPLE_LINE_PATTERN_EURO);
  if (!match) return null;

  const day = match[1];
  const month = match[2];
  const description = match[3].trim();
  const amount = match[4];

  return { date: `${day} ${month}`, description, amount };
}

function detectSimpleLineFormat(lines: string[]): DetectedTable | null {
  // Scan the ENTIRE document for all lines matching the simple transaction pattern.
  // Credit card statements often have multiple sections (Purchases, Payments, etc.)
  // so we must not stop at the first section boundary.
  const transactionLines: Array<{ lineNumber: number; line: string }> = [];
  let headerLineNumber = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (isSimpleTransactionLine(line)) {
      // If this is the first transaction line, look for a header above it
      if (transactionLines.length === 0 && i > 0) {
        headerLineNumber = i - 1;
        for (let h = i - 1; h >= Math.max(0, i - 3); h--) {
          const hl = lines[h].trim().toLowerCase();
          if (hl.includes('transaction') || hl.includes('detail') || hl.includes('date')) {
            headerLineNumber = h;
            break;
          }
        }
      }
      transactionLines.push({ lineNumber: i, line });
    }
    // Non-matching lines are simply skipped — we keep scanning the whole document
  }

  if (transactionLines.length === 0) return null;

  if (headerLineNumber === -1) headerLineNumber = transactionLines[0].lineNumber - 1;
  if (headerLineNumber < 0) headerLineNumber = 0;

  // Detect credit card context by scanning document text for keywords
  const keywordMatch = lines.slice(0, Math.min(60, lines.length)).some(l => {
    const lower = l.toLowerCase();
    return (
      lower.includes('credit card') ||
      lower.includes('card number') ||
      lower.includes('card statement') ||
      lower.includes('visa') ||
      lower.includes('mastercard') ||
      lower.includes('credit card statement')
    );
  });

  // Secondary heuristic: if the vast majority of amounts are positive (no minus sign),
  // this is almost certainly a credit card or expense-only statement where positive = expense.
  // A current/checking account statement would typically have a mix of + and - amounts.
  let negativeCount = 0;
  let positiveCount = 0;
  for (const { line } of transactionLines) {
    const parsed = parseSimpleTransactionLine(line);
    if (parsed) {
      if (parsed.amount.trim().startsWith('-')) {
        negativeCount++;
      } else {
        positiveCount++;
      }
    }
  }
  const totalParsed = positiveCount + negativeCount;
  const mostlyPositive = totalParsed >= 3 && (positiveCount / totalParsed) > 0.7;

  const isCreditCard = keywordMatch || mostlyPositive;
  if (isCreditCard) {
    console.log('PDF simple line detector: credit card detected',
      keywordMatch ? '(keyword match)' : `(${positiveCount}/${totalParsed} amounts positive — inferred)`,
      '— amounts will be treated as expenses');
  }

  // Build a synthetic 3-column table: Date, Description, Amount
  const columns: DetectedColumn[] = [
    { index: 0, startPos: 0, endPos: 10, name: 'Date', inferredType: 'date', sampleFormat: 'D Mon' },
    { index: 1, startPos: 10, endPos: 80, name: 'Description', inferredType: 'text' },
    { index: 2, startPos: 80, endPos: 100, name: 'Amount', inferredType: 'amount' },
  ];

  const dataRows: DetectedRow[] = transactionLines.map(({ lineNumber, line }) => {
    const parsed = parseSimpleTransactionLine(line);
    if (parsed) {
      return {
        lineNumber,
        rawText: line,
        fields: [parsed.date, parsed.description, parsed.amount],
        isDataRow: true,
      };
    }
    return {
      lineNumber,
      rawText: line,
      fields: [line],
      isDataRow: false,
    };
  }).filter(r => r.isDataRow);

  console.log('PDF simple line detector: found', dataRows.length, 'transaction lines, header at line', headerLineNumber, 'creditCard:', isCreditCard);

  return {
    headerLineNumber,
    headerText: lines[headerLineNumber]?.trim() || 'Transactions',
    columns,
    dataRows,
    startLine: headerLineNumber,
    endLine: transactionLines[transactionLines.length - 1].lineNumber,
    totalDataRows: dataRows.length,
    confidence: dataRows.length >= 5 ? 'high' : dataRows.length >= 3 ? 'medium' : 'low',
    warnings: [],
    isCreditCardFormat: isCreditCard,
  };
}

// ─── Header Detection ─────────────────────────────────────────────────────

interface HeaderCandidate {
  lineNumber: number;
  text: string;
  score: number;
}

function findHeaderCandidates(lines: string[]): HeaderCandidate[] {
  const candidates: HeaderCandidate[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase().trim();

    if (!lower || lower.length < 10) continue;

    let score = 0;

    // Check for financial header keywords
    const allKeywords = [
      ...DATE_KEYWORDS,
      ...AMOUNT_KEYWORDS,
      ...DEBIT_KEYWORDS,
      ...CREDIT_KEYWORDS,
      ...DESCRIPTION_KEYWORDS,
      ...BALANCE_KEYWORDS,
    ];

    const matchedKeywords: string[] = [];
    for (const keyword of allKeywords) {
      if (lower.includes(keyword)) {
        score += 2;
        matchedKeywords.push(keyword);
      }
    }

    // Must have at least a date-like keyword and one other
    const hasDate = DATE_KEYWORDS.some(k => lower.includes(k));
    const hasAmount = [...AMOUNT_KEYWORDS, ...DEBIT_KEYWORDS, ...CREDIT_KEYWORDS].some(k => lower.includes(k));
    const hasDesc = DESCRIPTION_KEYWORDS.some(k => lower.includes(k));

    if (hasDate && (hasAmount || hasDesc)) {
      score += 5;
    }

    // Bonus: line has multiple space-separated words (looks like column headers)
    const words = line.trim().split(/\s{2,}/);
    if (words.length >= 3) {
      score += 2;
    }

    // Bonus: next line contains date-like data
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      if (DATE_PATTERNS.some(p => {
        const firstToken = nextLine.split(/\s{2,}/)[0]?.trim();
        return firstToken && p.test(firstToken);
      })) {
        score += 3;
      }
    }

    if (score >= 7) {
      candidates.push({ lineNumber: i, text: line, score });
    }
  }

  // Sort by score descending, then by line number ascending
  candidates.sort((a, b) => b.score - a.score || a.lineNumber - b.lineNumber);

  return candidates;
}

/**
 * When explicit headers aren't found, look for patterns in the data itself.
 * Find runs of consecutive lines that start with dates — the line before the run is likely a header.
 */
function inferHeadersFromDataPatterns(lines: string[]): HeaderCandidate[] {
  const candidates: HeaderCandidate[] = [];

  let dateRunStart = -1;
  let dateRunLength = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const firstToken = line.split(/\s{2,}/)[0]?.trim() || '';
    const isDateLine = DATE_PATTERNS.some(p => p.test(firstToken)) || OCR_DATE_PATTERNS.some(p => p.test(firstToken));

    if (isDateLine) {
      if (dateRunStart === -1) {
        dateRunStart = i;
      }
      dateRunLength++;
    } else {
      if (dateRunLength >= 3 && dateRunStart > 0) {
        // The line before the date run is likely a header
        candidates.push({
          lineNumber: dateRunStart - 1,
          text: lines[dateRunStart - 1],
          score: dateRunLength,
        });
      }
      dateRunStart = -1;
      dateRunLength = 0;
    }
  }

  // Handle run that goes to end of text
  if (dateRunLength >= 3 && dateRunStart > 0) {
    candidates.push({
      lineNumber: dateRunStart - 1,
      text: lines[dateRunStart - 1],
      score: dateRunLength,
    });
  }

  return candidates;
}

// ─── Column Detection ─────────────────────────────────────────────────────

/**
 * Detect columns from a header line using whitespace boundaries.
 */
function detectColumns(headerLine: string): DetectedColumn[] {
  // Split header by 2+ whitespace characters to find column names
  const columns: DetectedColumn[] = [];

  // Find column boundaries using space gaps
  const tokens: Array<{ text: string; start: number; end: number }> = [];
  let inToken = false;
  let tokenStart = 0;
  let spaceCount = 0;

  for (let i = 0; i <= headerLine.length; i++) {
    const ch = i < headerLine.length ? headerLine[i] : ' ';
    const isSpace = ch === ' ';

    if (isSpace) {
      if (inToken) {
        spaceCount++;
        // Only break on 2+ consecutive spaces
        if (spaceCount >= 2 || i === headerLine.length) {
          const tokenText = headerLine.substring(tokenStart, i - spaceCount + 1).trim();
          if (tokenText) {
            tokens.push({
              text: tokenText,
              start: tokenStart,
              end: i - spaceCount + 1,
            });
          }
          inToken = false;
        }
      }
    } else {
      if (!inToken) {
        tokenStart = i;
        inToken = true;
      }
      spaceCount = 0;
    }
  }

  // Build columns from tokens
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const nextToken = tokens[i + 1];
    const prevToken = tokens[i - 1];

    // Column boundaries: midpoint between this token's end and next token's start
    const startPos = prevToken ? Math.floor((prevToken.end + token.start) / 2) : 0;
    const endPos = nextToken
      ? Math.floor((token.end + nextToken.start) / 2)
      : headerLine.length;

    const name = token.text;
    const lowerName = name.toLowerCase();

    // Infer type from header name
    let inferredType: DetectedColumn['inferredType'] = 'unknown';
    if (DATE_KEYWORDS.some(k => lowerName.includes(k))) {
      inferredType = 'date';
    } else if ([...AMOUNT_KEYWORDS, ...DEBIT_KEYWORDS, ...CREDIT_KEYWORDS].some(k => lowerName.includes(k))) {
      inferredType = 'amount';
    } else if (DESCRIPTION_KEYWORDS.some(k => lowerName.includes(k))) {
      inferredType = 'text';
    } else if (BALANCE_KEYWORDS.some(k => lowerName.includes(k))) {
      inferredType = 'amount'; // Balance is a numeric/amount type
    }

    columns.push({
      index: i,
      startPos,
      endPos,
      name,
      inferredType,
    });
  }

  return columns;
}

// ─── Row Extraction ───────────────────────────────────────────────────────

/**
 * Extract data rows from lines below a header, using column boundaries.
 */
function extractTable(lines: string[], headerLineNumber: number, headerText: string): DetectedTable | null {
  const columns = detectColumns(headerText);

  if (columns.length < 2) {
    return null;
  }

  const dataRows: DetectedRow[] = [];
  const warnings: string[] = [];
  let endLine = headerLineNumber;

  // Walk lines below the header
  for (let i = headerLineNumber + 1; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines
    if (!line.trim()) {
      // If we've already found data rows, a long gap of empty lines = end of table
      if (dataRows.length > 0) {
        // Check if next non-empty line is still data
        let nextNonEmpty = i + 1;
        while (nextNonEmpty < lines.length && !lines[nextNonEmpty].trim()) {
          nextNonEmpty++;
        }
        if (nextNonEmpty - i > 3) {
          endLine = i;
          break;
        }
      }
      continue;
    }

    // Skip separator lines (all dashes, equals, etc.)
    if (/^[-=_*]{3,}$/.test(line.trim())) {
      continue;
    }

    // Skip subtotal/total lines
    const lowerLine = line.toLowerCase().trim();
    if (
      lowerLine.startsWith('total') ||
      lowerLine.startsWith('subtotal') ||
      lowerLine.startsWith('opening balance') ||
      lowerLine.startsWith('closing balance') ||
      lowerLine.startsWith('page ') ||
      lowerLine.includes('continued on next page') ||
      lowerLine.includes('statement period')
    ) {
      // Could be end of table section
      if (dataRows.length > 0 && (lowerLine.startsWith('total') || lowerLine.startsWith('closing'))) {
        endLine = i;
        break;
      }
      continue;
    }

    // Check if this line looks like another header (multi-page table repeat)
    if (isRepeatedHeader(line, headerText)) {
      continue;
    }

    // Extract fields by column positions
    const fields = extractFieldsByPosition(line, columns);

    // Validate this looks like a data row (starts with a date or has numeric amounts)
    const isDataRow = validateDataRow(fields, columns);

    if (isDataRow) {
      dataRows.push({
        lineNumber: i,
        rawText: line,
        fields,
        isDataRow: true,
      });
      endLine = i;
    } else if (dataRows.length === 0 && line.trim().length > 10) {
      // Log first few rejected lines after header to help debug
      if (i <= headerLineNumber + 5) {
        console.log(`PDF row rejected (line ${i}):`, line.slice(0, 100), '| fields:', fields.slice(0, 5));
      }
    }
    
    if (!isDataRow && dataRows.length > 0) {
      // Could be a continuation line (description overflow) — attach to previous row
      const lastRow = dataRows[dataRows.length - 1];
      const descColIdx = columns.findIndex(c =>
        c.inferredType === 'text' || DESCRIPTION_KEYWORDS.some(k => c.name.toLowerCase().includes(k))
      );
      if (descColIdx !== -1 && lastRow.fields[descColIdx]) {
        lastRow.fields[descColIdx] += ' ' + line.trim();
        lastRow.rawText += '\n' + line;
      }
    }
  }

  if (dataRows.length === 0) {
    return null;
  }

  // Refine column types by analyzing actual data
  const refinedColumns = refineColumnTypes(columns, dataRows);

  // Calculate confidence
  const confidence = calculateConfidence(refinedColumns, dataRows);

  return {
    headerLineNumber,
    headerText: headerText.trim(),
    columns: refinedColumns,
    dataRows,
    startLine: headerLineNumber,
    endLine,
    totalDataRows: dataRows.length,
    confidence,
    warnings,
  };
}

/**
 * Extract field values from a line based on column character positions.
 */
function extractFieldsByPosition(line: string, columns: DetectedColumn[]): string[] {
  return columns.map(col => {
    const start = Math.min(col.startPos, line.length);
    const end = Math.min(col.endPos, line.length);
    return line.substring(start, end).trim();
  });
}

/**
 * Check if a line is a repeated table header (common in multi-page PDFs).
 */
function isRepeatedHeader(line: string, originalHeader: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const similarity = normalize(line) === normalize(originalHeader);
  if (similarity) return true;

  // Fuzzy match — if most header words appear in this line
  const headerWords = normalize(originalHeader).split(' ').filter(w => w.length > 2);
  const lineWords = new Set(normalize(line).split(' '));
  const matchCount = headerWords.filter(w => lineWords.has(w)).length;
  return headerWords.length > 0 && matchCount / headerWords.length > 0.7;
}

/**
 * Validate that a row of extracted fields looks like transaction data.
 */
function validateDataRow(fields: string[], columns: DetectedColumn[]): boolean {
  if (fields.every(f => !f)) return false;

  // Check: at least one field matches a date pattern (strict)
  const hasDate = fields.some(f => DATE_PATTERNS.some(p => p.test(f.trim())));

  // Check: at least one field looks like a date even with OCR noise
  const hasOcrDate = fields.some(f => OCR_DATE_PATTERNS.some(p => p.test(f.trim())));

  // Check: at least one field matches an amount pattern
  const hasAmount = fields.some(f => AMOUNT_PATTERNS.some(p => p.test(f.trim())));

  // Check: at least one field has text content (description)
  const hasText = fields.some(f => f.length > 3 && /[a-zA-Z]/.test(f));

  // A valid data row should have a date (or OCR date) and at least one of amount/text
  if (hasDate && (hasAmount || hasText)) return true;
  if (hasOcrDate && hasAmount) return true;

  return false;
}

// ─── Column Type Refinement ───────────────────────────────────────────────

/**
 * Refine column types by analyzing actual data values.
 * Headers might be ambiguous, but data patterns are definitive.
 */
function refineColumnTypes(columns: DetectedColumn[], rows: DetectedRow[]): DetectedColumn[] {
  return columns.map((col, colIdx) => {
    const values = rows.map(r => r.fields[colIdx]).filter(v => v && v.trim());

    if (values.length === 0) {
      return { ...col, inferredType: 'empty' };
    }

    // Check for date values
    const dateMatches = values.filter(v => DATE_PATTERNS.some(p => p.test(v.trim())));
    if (dateMatches.length > values.length * 0.6) {
      return {
        ...col,
        inferredType: 'date' as const,
        sampleFormat: detectDateFormat(values),
      };
    }

    // Check for amount values
    const amountMatches = values.filter(v => AMOUNT_PATTERNS.some(p => p.test(v.trim())));
    if (amountMatches.length > values.length * 0.5) {
      const amountInfo = detectAmountInfo(values);
      return {
        ...col,
        inferredType: 'amount' as const,
        hasNegatives: amountInfo.hasNegatives,
        currencySymbols: amountInfo.currencySymbols,
      };
    }

    // Check for pure numbers
    const numberMatches = values.filter(v => /^-?[\d,]+\.?\d*$/.test(v.trim()));
    if (numberMatches.length > values.length * 0.7) {
      return { ...col, inferredType: 'number' as const };
    }

    // Default to text
    if (col.inferredType === 'unknown') {
      return { ...col, inferredType: 'text' as const };
    }

    return col;
  });
}

function detectDateFormat(values: string[]): string {
  for (const value of values) {
    const v = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'YYYY-MM-DD';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return 'DD/MM/YYYY';
    if (/^\d{2}\/\d{2}\/\d{2}$/.test(v)) return 'DD/MM/YY';
    if (/^\d{1,2}\s+\w{3}\s+\d{4}$/.test(v)) return 'D Mon YYYY';
    if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(v)) return 'DD.MM.YYYY';
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(v)) return 'DD-MM-YYYY';
  }
  return 'UNKNOWN';
}

function detectAmountInfo(values: string[]): { hasNegatives: boolean; currencySymbols: string[] } {
  const hasNegatives = values.some(v => v.includes('-') || v.includes('(') || /DR$/i.test(v));
  const symbols: Set<string> = new Set();

  for (const v of values) {
    if (v.includes('€')) symbols.add('€');
    if (v.includes('$')) symbols.add('$');
    if (v.includes('£')) symbols.add('£');
  }

  return { hasNegatives, currencySymbols: Array.from(symbols) };
}

// ─── Confidence Scoring ───────────────────────────────────────────────────

function calculateConfidence(columns: DetectedColumn[], rows: DetectedRow[]): 'high' | 'medium' | 'low' {
  const hasDateCol = columns.some(c => c.inferredType === 'date');
  const hasAmountCol = columns.some(c => c.inferredType === 'amount');
  const hasTextCol = columns.some(c => c.inferredType === 'text');
  const hasEnoughRows = rows.length >= 3;

  // Validate row consistency — what % of rows have valid dates + amounts
  let validRows = 0;
  for (const row of rows) {
    const dateField = row.fields[columns.findIndex(c => c.inferredType === 'date')]?.trim();
    const isValid = dateField && DATE_PATTERNS.some(p => p.test(dateField));
    if (isValid) validRows++;
  }
  const rowConsistency = rows.length > 0 ? validRows / rows.length : 0;

  if (hasDateCol && hasAmountCol && hasTextCol && hasEnoughRows && rowConsistency > 0.8) {
    return 'high';
  }
  if (hasDateCol && hasAmountCol && rowConsistency > 0.5) {
    return 'medium';
  }
  return 'low';
}

// ─── Table Merging ────────────────────────────────────────────────────────

/**
 * Merge multiple detected tables (from multi-page PDFs) into one.
 * Only merges tables with compatible column structures.
 */
function mergeTables(tables: DetectedTable[]): DetectedTable | null {
  if (tables.length === 0) return null;
  if (tables.length === 1) return tables[0];

  // Use the first table as the base structure
  const base = tables[0];
  const allRows = [...base.dataRows];
  const allWarnings = [...base.warnings];

  for (let i = 1; i < tables.length; i++) {
    const table = tables[i];

    // Check column compatibility (same number and similar types)
    if (table.columns.length === base.columns.length) {
      allRows.push(...table.dataRows);
      allWarnings.push(...table.warnings);
    } else {
      allWarnings.push(
        `Table on line ${table.headerLineNumber} has ${table.columns.length} columns (expected ${base.columns.length}) - skipped`
      );
    }
  }

  return {
    ...base,
    dataRows: allRows,
    endLine: tables[tables.length - 1].endLine,
    totalDataRows: allRows.length,
    warnings: allWarnings,
    confidence: base.confidence,
  };
}
