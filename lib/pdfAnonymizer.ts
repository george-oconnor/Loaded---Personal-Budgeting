/**
 * PDF Anonymization Utility
 * 
 * SECURITY: This module ensures that NO personal financial data from PDFs is
 * ever sent to AI services. We only send:
 * - Column headers (e.g., "Date", "Amount", "Description")
 * - Data structure/format samples with SYNTHETIC data
 * - Column positions and types
 * - Row counts
 * 
 * We NEVER send:
 * - Actual transaction descriptions/merchant names
 * - Real monetary amounts
 * - Real dates that could identify the user
 * - Account numbers, names, or any PII
 * 
 * This is the PDF equivalent of csvAnonymizer.ts.
 */

import { DetectedColumn, DetectedRow, DetectedTable } from './pdfTableDetector';

// ─── Types ────────────────────────────────────────────────────────────────

export interface AnonymizedPdfStructure {
  columns: AnonymizedColumnInfo[];
  columnCount: number;
  rowCount: number;
  sampleRows: AnonymizedSampleRow[];
  sourceFormat: 'pdf_text_layer' | 'pdf_ocr';
  tableConfidence: 'high' | 'medium' | 'low';
}

export interface AnonymizedColumnInfo {
  index: number;
  name: string;
  inferredType: string;
  sampleFormat?: string;
  hasNegatives?: boolean;
  currencySymbols?: string[];
  positionStart: number;
  positionEnd: number;
}

export interface AnonymizedSampleRow {
  [columnIndex: number]: string;
}

// ─── Synthetic Data ───────────────────────────────────────────────────────

const SYNTHETIC_MERCHANTS = [
  'SAMPLE_MERCHANT_A',
  'SAMPLE_MERCHANT_B',
  'SAMPLE_MERCHANT_C',
  'SAMPLE_STORE_1',
  'SAMPLE_STORE_2',
  'SAMPLE_PAYMENT_X',
];

const SYNTHETIC_AMOUNTS = ['-50.00', '125.50', '-23.99', '500.00', '-89.95', '1200.00'];
const SYNTHETIC_BALANCES = ['1000.00', '1125.50', '1101.51', '1601.51', '1511.56', '2711.56'];

/**
 * Generate a synthetic value based on the detected column type.
 * This replaces real data with fake data that preserves the format pattern.
 */
function generateSyntheticValue(
  type: string,
  columnIndex: number,
  rowIndex: number,
  column: DetectedColumn
): string {
  switch (type) {
    case 'date': {
      const baseDate = new Date(2024, 0, 1);
      baseDate.setDate(baseDate.getDate() + rowIndex);

      // Match the detected date format
      if (column.sampleFormat?.includes('DD/MM/YYYY')) {
        const dd = String(baseDate.getDate()).padStart(2, '0');
        const mm = String(baseDate.getMonth() + 1).padStart(2, '0');
        return `${dd}/${mm}/${baseDate.getFullYear()}`;
      }
      if (column.sampleFormat?.includes('DD.MM.YYYY')) {
        const dd = String(baseDate.getDate()).padStart(2, '0');
        const mm = String(baseDate.getMonth() + 1).padStart(2, '0');
        return `${dd}.${mm}.${baseDate.getFullYear()}`;
      }
      return baseDate.toISOString().split('T')[0];
    }

    case 'amount': {
      const amount = SYNTHETIC_AMOUNTS[rowIndex % SYNTHETIC_AMOUNTS.length];
      const symbol = column.currencySymbols?.[0] || '';
      return symbol ? `${symbol}${amount}` : amount;
    }

    case 'text':
      return SYNTHETIC_MERCHANTS[rowIndex % SYNTHETIC_MERCHANTS.length];

    case 'number':
      return SYNTHETIC_BALANCES[rowIndex % SYNTHETIC_BALANCES.length];

    case 'empty':
      return '';

    default:
      return `SAMPLE_VALUE_${columnIndex}_${rowIndex}`;
  }
}

// ─── Main Anonymization ──────────────────────────────────────────────────

/**
 * Anonymize a detected PDF table for AI analysis.
 * 
 * SECURITY: Replaces ALL real data with synthetic samples.
 * Only structural information (headers, types, positions, formats) is preserved.
 * 
 * @param table - The detected table from pdfTableDetector
 * @param extractionMethod - How the text was extracted ('text_layer' or 'ocr')
 * @returns An anonymized structure safe to send to AI services
 */
export function anonymizePdfTable(
  table: DetectedTable,
  extractionMethod: 'pdf_text_layer' | 'pdf_ocr' = 'pdf_text_layer'
): AnonymizedPdfStructure {
  // Map columns to anonymized info (headers are safe to share)
  const columns: AnonymizedColumnInfo[] = table.columns.map(col => ({
    index: col.index,
    name: col.name,
    inferredType: col.inferredType,
    sampleFormat: col.sampleFormat,
    hasNegatives: col.hasNegatives,
    currencySymbols: col.currencySymbols,
    positionStart: col.startPos,
    positionEnd: col.endPos,
  }));

  // Generate synthetic sample rows (3 rows max, NEVER include real data)
  const sampleCount = Math.min(3, table.dataRows.length);
  const sampleRows: AnonymizedSampleRow[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const row: AnonymizedSampleRow = {};
    for (let j = 0; j < table.columns.length; j++) {
      row[j] = generateSyntheticValue(
        table.columns[j].inferredType,
        j,
        i,
        table.columns[j]
      );
    }
    sampleRows.push(row);
  }

  return {
    columns,
    columnCount: table.columns.length,
    rowCount: table.totalDataRows,
    sampleRows,
    sourceFormat: extractionMethod,
    tableConfidence: table.confidence,
  };
}

/**
 * Create a human-readable description of the anonymized PDF structure.
 * This is what gets sent to the AI — containing NO actual user data.
 */
export function createPdfStructureDescription(structure: AnonymizedPdfStructure): string {
  const lines: string[] = [
    '=== PDF BANK STATEMENT STRUCTURE (ANONYMIZED - NO REAL USER DATA) ===',
    '',
    `Source: PDF file (extracted via ${structure.sourceFormat === 'pdf_ocr' ? 'OCR' : 'text layer'})`,
    `Table Detection Confidence: ${structure.tableConfidence}`,
    `Total Columns: ${structure.columnCount}`,
    `Total Data Rows: ${structure.rowCount}`,
    '',
    '=== COLUMN DETAILS ===',
  ];

  for (const col of structure.columns) {
    let details = `Column ${col.index + 1}: "${col.name}" — Type: ${col.inferredType}`;
    details += ` (positions ${col.positionStart}-${col.positionEnd})`;

    if (col.sampleFormat) {
      details += ` [Format: ${col.sampleFormat}]`;
    }
    if (col.hasNegatives) {
      details += ' [Has negative values]';
    }
    if (col.currencySymbols && col.currencySymbols.length > 0) {
      details += ` [Currency: ${col.currencySymbols.join(', ')}]`;
    }

    lines.push(details);
  }

  lines.push('');
  lines.push('=== SYNTHETIC SAMPLE ROWS (NOT REAL DATA) ===');
  lines.push(`Headers: ${structure.columns.map(c => c.name).join(' | ')}`);

  for (let i = 0; i < structure.sampleRows.length; i++) {
    const row = structure.sampleRows[i];
    const values = Object.values(row);
    lines.push(`Row ${i + 1}: ${values.join(' | ')}`);
  }

  lines.push('');
  lines.push('NOTE: All values above are SYNTHETIC/FAKE. Only column names, types, and positions are real.');

  return lines.join('\n');
}

/**
 * Validate that an anonymized description contains no sensitive data patterns.
 * Extra security check before sending to AI.
 */
export function validateNoPdfSensitiveData(
  description: string
): { safe: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Check for potential real monetary values (unusual patterns beyond our synthetic data)
  const realAmountPattern = /\b\d{3,}\.\d{2}\b/g;
  const potentialAmounts = description.match(realAmountPattern);
  // Our synthetic data includes amounts like 1125.50, 1601.51 etc, so allow up to ~20
  if (potentialAmounts && potentialAmounts.length > 20) {
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

  // Check for IBAN patterns
  const ibanPattern = /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/;
  if (ibanPattern.test(description)) {
    warnings.push('Detected potential IBAN number');
  }

  // Check for names (titles followed by capitalized words)
  const namePattern = /\b(Mr|Mrs|Ms|Dr|Prof)\.\s+[A-Z][a-z]+/;
  if (namePattern.test(description)) {
    warnings.push('Detected potential personal names');
  }

  return {
    safe: warnings.length === 0,
    warnings,
  };
}
