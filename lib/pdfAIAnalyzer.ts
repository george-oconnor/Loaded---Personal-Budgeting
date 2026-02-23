/**
 * PDF AI Analysis Service
 * 
 * SECURITY ARCHITECTURE (mirrors csvAIAnalyzer.ts):
 * 1. PDF text is extracted ON-DEVICE using Apple PDFKit/Vision
 * 2. Table structure is detected locally by pdfTableDetector
 * 3. Real data is anonymized locally by pdfAnonymizer — ONLY structure is extracted
 * 4. The anonymized structure description (with synthetic data) is sent to AI
 * 5. AI returns column mapping instructions
 * 6. Actual data parsing happens LOCALLY using the mapping — real data never leaves the device
 * 
 * This ensures user financial data NEVER leaves the device to AI services.
 */

import { ColumnMapping, CSVAnalysisResult } from './csvAIAnalyzer';
import {
  anonymizePdfTable,
  createPdfStructureDescription,
  validateNoPdfSensitiveData,
} from './pdfAnonymizer';
import { DetectedTable } from './pdfTableDetector';

// Re-export for convenience
export type { ColumnMapping, CSVAnalysisResult as PdfAnalysisResult };

// OpenAI API endpoint (same as CSV analyzer uses)
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Get the OpenAI API key from environment variable
 */
function getAIApiKey(): string | null {
  return process.env.EXPO_PUBLIC_OPENAI_API_KEY || null;
}

/**
 * Build the analysis prompt specifically for PDF bank statement structures
 */
function buildPdfAnalysisPrompt(structureDescription: string): string {
  return `You are a bank statement PDF format analyzer. Analyze this ANONYMIZED PDF table structure and determine the column mappings for importing financial transactions.

IMPORTANT: The data shown below is SYNTHETIC/FAKE for privacy. Only the column names, types, and positions are real.

${structureDescription}

This is extracted from a PDF bank statement. PDF text extraction may have minor alignment issues, so be flexible with column identification.

Analyze this structure and respond with a JSON object containing:
1. "isValidForImport": boolean - true if the table has the required fields for financial transactions
2. "mapping": object with these fields (use -1 if not found):
   - "dateColumn": column index (0-based) containing transaction dates
   - "amountColumn": column index for transaction amounts (use -1 if split into debit/credit)
   - "descriptionColumn": column index for merchant/description
   - "debitColumn": column index for debit amounts (if split, else -1)
   - "creditColumn": column index for credit amounts (if split, else -1)
   - "currencyColumn": column index for currency (if present, else -1)
   - "balanceColumn": column index for running balance (if present, else -1)
   - "categoryColumn": column index for category (if present, else -1)
   - "dateFormat": string describing the date format (e.g., "YYYY-MM-DD", "DD/MM/YYYY")
   - "amountFormat": "single" if one amount column, "split" if separate debit/credit
   - "amountSignConvention": "standard" if negative=expense/positive=income, "inverted" if opposite
3. "confidence": "high", "medium", or "low"
4. "missingFields": array of required fields that couldn't be identified
5. "warnings": array of potential issues
6. "suggestion": helpful message for the user if import isn't possible

REQUIRED fields for valid import: date, amount (or debit+credit), description

Respond ONLY with valid JSON, no explanation text.`;
}

/**
 * Parse the AI response into a structured result
 */
function parseAIResponse(response: string): CSVAnalysisResult {
  try {
    let jsonStr = response;

    // Remove markdown code blocks if present
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    const parsed = JSON.parse(jsonStr.trim());

    const mapping: ColumnMapping | null =
      parsed.mapping && parsed.isValidForImport
        ? {
            dateColumn: parsed.mapping.dateColumn ?? -1,
            amountColumn: parsed.mapping.amountColumn ?? -1,
            descriptionColumn: parsed.mapping.descriptionColumn ?? -1,
            debitColumn:
              parsed.mapping.debitColumn !== -1 ? parsed.mapping.debitColumn : undefined,
            creditColumn:
              parsed.mapping.creditColumn !== -1 ? parsed.mapping.creditColumn : undefined,
            currencyColumn:
              parsed.mapping.currencyColumn !== -1
                ? parsed.mapping.currencyColumn
                : undefined,
            balanceColumn:
              parsed.mapping.balanceColumn !== -1
                ? parsed.mapping.balanceColumn
                : undefined,
            categoryColumn:
              parsed.mapping.categoryColumn !== -1
                ? parsed.mapping.categoryColumn
                : undefined,
            dateFormat: parsed.mapping.dateFormat || 'DD/MM/YYYY',
            amountFormat: parsed.mapping.amountFormat || 'single',
            amountSignConvention: parsed.mapping.amountSignConvention || 'standard',
          }
        : null;

    return {
      isValidForImport: parsed.isValidForImport ?? false,
      mapping,
      confidence: parsed.confidence || 'low',
      missingFields: parsed.missingFields || [],
      warnings: parsed.warnings || [],
      suggestion: parsed.suggestion,
    };
  } catch (error) {
    console.error('Failed to parse AI response for PDF:', error);
    return {
      isValidForImport: false,
      mapping: null,
      confidence: 'low',
      missingFields: ['Unable to parse AI response'],
      warnings: ['The AI response could not be parsed. Please try again.'],
      suggestion:
        'The analysis failed. You can try re-uploading the PDF or contact support.',
    };
  }
}

/**
 * Analyze a detected PDF table using AI.
 * 
 * SECURITY FLOW:
 * 1. Anonymize the detected table locally (only structure, no real data)
 * 2. Validate the anonymized description contains no sensitive data
 * 3. Send ONLY the anonymized structure to AI
 * 4. Receive column mapping instructions
 * 5. Apply mapping LOCALLY to real data (which never left the device)
 */
export async function analyzePdfWithAI(
  table: DetectedTable,
  extractionMethod: 'pdf_text_layer' | 'pdf_ocr' = 'pdf_text_layer'
): Promise<CSVAnalysisResult> {
  try {
    // Step 1: Anonymize the detected table
    const anonymized = anonymizePdfTable(table, extractionMethod);
    const structureDescription = createPdfStructureDescription(anonymized);

    // Step 2: Validate no sensitive data leaked
    const validation = validateNoPdfSensitiveData(structureDescription);
    if (!validation.safe) {
      console.warn('PDF anonymization warnings:', validation.warnings);
    }

    // Step 3: Get AI API key
    const apiKey = getAIApiKey();

    if (!apiKey) {
      // Fall back to heuristic analysis
      console.log('No AI API key configured, using heuristic PDF analysis');
      return analyzePdfHeuristically(table);
    }

    // Step 4: Send anonymized structure to AI
    const prompt = buildPdfAnalysisPrompt(structureDescription);

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content:
              'You are a bank statement PDF format analyzer. Respond only with valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unable to read body');
      console.warn(
        `AI API call failed for PDF (${response.status} ${response.statusText}):`,
        errorBody
      );
      return analyzePdfHeuristically(table);
    }

    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content || '';

    const result = parseAIResponse(aiResponse);

    // Override sign convention for credit card statements regardless of AI response
    if (table.isCreditCardFormat && result.mapping) {
      console.log('PDF AI: overriding sign convention to inverted for credit card statement');
      result.mapping.amountSignConvention = 'inverted';
    }

    return result;
  } catch (error) {
    console.error('PDF AI analysis error:', error);
    // Fall back to heuristic analysis
    return analyzePdfHeuristically(table);
  }
}

/**
 * Heuristic-based PDF table analysis (fallback when AI is not available).
 * Uses the column types already detected by pdfTableDetector.
 */
export function analyzePdfHeuristically(table: DetectedTable): CSVAnalysisResult {
  console.log('PDF heuristic analysis starting:', table.columns.length, 'columns,', table.dataRows.length, 'data rows');
  console.log('Column details:', table.columns.map(c => ({ i: c.index, name: c.name, type: c.inferredType, sampleFormat: c.sampleFormat })));
  console.log('Sample row fields:', table.dataRows.slice(0, 3).map(r => r.fields));
  const columns = table.columns;
  const headers = columns.map(c => c.name.toLowerCase().trim());

  // Pattern lists for name matching
  const datePatterns = [
    'date', 'posted', 'transaction date', 'value date', 'booking',
    'effective date', 'posting date',
  ];
  const amountPatterns = ['amount', 'value', 'sum', 'total', 'money out', 'money in'];
  const debitPatterns = ['debit', 'dr', 'withdrawal', 'money out', 'payments', 'out'];
  const creditPatterns = ['credit', 'cr', 'deposit', 'money in', 'receipts', 'in'];
  const descPatterns = [
    'description', 'details', 'particulars', 'narrative', 'reference',
    'payee', 'merchant', 'transaction',
  ];
  const balancePatterns = ['balance', 'running balance', 'available'];

  // Find columns by name
  const findByName = (patterns: string[]): number => {
    for (let i = 0; i < headers.length; i++) {
      if (patterns.some(p => headers[i].includes(p))) return i;
    }
    return -1;
  };

  // Find columns by detected type
  const findByType = (type: string): number => {
    return columns.findIndex(c => c.inferredType === type);
  };

  // Try name matching first, then type detection
  let dateColumn = findByName(datePatterns);
  if (dateColumn === -1) dateColumn = findByType('date');

  let amountColumn = findByName(amountPatterns);
  let debitColumn = findByName(debitPatterns);
  let creditColumn = findByName(creditPatterns);

  if (amountColumn === -1 && debitColumn === -1) {
    const amountCols = columns.filter(c => c.inferredType === 'amount');
    if (amountCols.length === 1) {
      amountColumn = amountCols[0].index;
    } else if (amountCols.length === 2) {
      debitColumn = amountCols[0].index;
      creditColumn = amountCols[1].index;
    } else if (amountCols.length > 2) {
      // More than 2 amount columns — pick the most likely ones
      // Balance is usually the last amount column
      amountColumn = amountCols[0].index;
    }
  }

  let descriptionColumn = findByName(descPatterns);
  if (descriptionColumn === -1) {
    // Find first text column that we haven't assigned yet
    const usedCols = new Set([dateColumn, amountColumn, debitColumn, creditColumn]);
    const textCol = columns.find(
      c => c.inferredType === 'text' && !usedCols.has(c.index)
    );
    if (textCol) descriptionColumn = textCol.index;
  }

  let balanceColumn = findByName(balancePatterns);
  if (balanceColumn === -1) {
    // Balance is often the last amount-type column
    const usedCols = new Set([amountColumn, debitColumn, creditColumn]);
    const remainingAmounts = columns.filter(
      c => c.inferredType === 'amount' && !usedCols.has(c.index)
    );
    if (remainingAmounts.length > 0) {
      balanceColumn = remainingAmounts[remainingAmounts.length - 1].index;
    }
  }

  const hasDate = dateColumn !== -1;
  const hasAmount = amountColumn !== -1 || (debitColumn !== -1 && creditColumn !== -1);
  const hasDescription = descriptionColumn !== -1;

  const missingFields: string[] = [];
  if (!hasDate) missingFields.push('date');
  if (!hasAmount) missingFields.push('amount');
  if (!hasDescription) missingFields.push('description');

  const isValidForImport = hasDate && hasAmount && hasDescription;

  console.log('PDF heuristic column mapping:', {
    dateColumn, amountColumn, debitColumn, creditColumn,
    descriptionColumn, balanceColumn,
    hasDate, hasAmount, hasDescription, isValidForImport, missingFields, headers,
  });

  // Determine date format from the date column detection
  let dateFormat = 'DD/MM/YYYY';
  if (dateColumn !== -1 && columns[dateColumn]?.sampleFormat) {
    dateFormat = columns[dateColumn].sampleFormat!;
  }

  const amountFormat: 'single' | 'split' =
    amountColumn !== -1 ? 'single' : 'split';

  let amountSignConvention: 'standard' | 'inverted' = 'standard';
  if (table.isCreditCardFormat) {
    // Credit card statements: positive amounts are expenditures
    amountSignConvention = 'inverted';
    console.log('PDF heuristic: credit card detected — using inverted sign convention (positive = expense)');
  } else if (amountColumn !== -1 && columns[amountColumn]?.hasNegatives) {
    amountSignConvention = 'standard';
  }

  const warnings: string[] = [];
  if (table.confidence === 'low') {
    warnings.push('Table detection confidence is low — review results carefully');
  }

  const mapping: ColumnMapping | null = isValidForImport
    ? {
        dateColumn,
        amountColumn: amountColumn !== -1 ? amountColumn : -1,
        descriptionColumn,
        debitColumn: debitColumn !== -1 ? debitColumn : undefined,
        creditColumn: creditColumn !== -1 ? creditColumn : undefined,
        balanceColumn: balanceColumn !== -1 ? balanceColumn : undefined,
        dateFormat,
        amountFormat,
        amountSignConvention,
      }
    : null;

  return {
    isValidForImport,
    mapping,
    confidence: isValidForImport
      ? warnings.length === 0
        ? 'high'
        : 'medium'
      : 'low',
    missingFields,
    warnings,
    suggestion: isValidForImport
      ? undefined
      : `Could not identify required columns in the PDF statement: ${missingFields.join(', ')}. The PDF may need a different layout.`,
  };
}
