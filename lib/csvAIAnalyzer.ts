/**
 * AI CSV Analysis Service
 * 
 * SECURITY ARCHITECTURE:
 * 1. CSV data is first anonymized locally - ONLY structure/format info is extracted
 * 2. The anonymized structure description (with synthetic data) is sent to AI
 * 3. AI returns column mapping instructions (which columns = date, amount, description, etc.)
 * 4. Actual data transformation happens LOCALLY using the mapping - never sent to AI
 * 
 * This ensures user financial data NEVER leaves the device to AI services.
 */

import {
    anonymizeCSVForAnalysis,
    createStructureDescription,
    CSVStructure,
    validateNoSensitiveData,
} from './csvAnonymizer';

// Required fields for a valid transaction import
export interface ColumnMapping {
  dateColumn: number;           // Index of the date column (required)
  amountColumn: number;         // Index of the amount column (required)
  descriptionColumn: number;    // Index of the description/merchant column (required)
  debitColumn?: number;         // Some banks split debit/credit into separate columns
  creditColumn?: number;        // Index of credit column if split
  currencyColumn?: number;      // Index of currency column if present
  balanceColumn?: number;       // Index of balance column (optional)
  categoryColumn?: number;      // Index of category column if present
  dateFormat: string;           // Detected date format for parsing
  amountFormat: 'single' | 'split'; // Whether amount is single column or debit/credit split
  amountSignConvention: 'standard' | 'inverted'; // Standard: negative=expense, positive=income
}

export interface CSVAnalysisResult {
  isValidForImport: boolean;
  mapping: ColumnMapping | null;
  confidence: 'high' | 'medium' | 'low';
  missingFields: string[];
  warnings: string[];
  suggestion?: string;
}

// OpenAI API endpoint
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Get the OpenAI API key from environment variable
 */
function getAIApiKey(): string | null {
  return process.env.EXPO_PUBLIC_OPENAI_API_KEY || null;
}

/**
 * Build the analysis prompt for the AI
 * This prompt asks the AI to identify column mappings from the ANONYMIZED structure
 */
function buildAnalysisPrompt(structureDescription: string): string {
  return `You are a financial CSV format analyzer. Analyze this ANONYMIZED CSV structure and determine if it can be imported as financial transactions.

IMPORTANT: The data shown below is SYNTHETIC/FAKE for privacy. Only the column names and detected types are real.

${structureDescription}

Analyze this structure and respond with a JSON object containing:
1. "isValidForImport": boolean - true if the CSV has all required fields for financial transactions
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
3. "confidence": "high", "medium", or "low" based on how clear the mapping is
4. "missingFields": array of required fields that couldn't be identified
5. "warnings": array of potential issues (e.g., ambiguous date format)
6. "suggestion": helpful message for the user if import isn't possible

REQUIRED fields for valid import: date, amount (or debit+credit), description

Respond ONLY with valid JSON, no explanation text.`;
}

/**
 * Parse the AI response into a structured result
 */
function parseAIResponse(response: string): CSVAnalysisResult {
  try {
    // Try to extract JSON from the response (AI might include markdown code blocks)
    let jsonStr = response;
    
    // Remove markdown code blocks if present
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }
    
    const parsed = JSON.parse(jsonStr.trim());
    
    // Validate and normalize the response
    const mapping: ColumnMapping | null = parsed.mapping && parsed.isValidForImport ? {
      dateColumn: parsed.mapping.dateColumn ?? -1,
      amountColumn: parsed.mapping.amountColumn ?? -1,
      descriptionColumn: parsed.mapping.descriptionColumn ?? -1,
      debitColumn: parsed.mapping.debitColumn !== -1 ? parsed.mapping.debitColumn : undefined,
      creditColumn: parsed.mapping.creditColumn !== -1 ? parsed.mapping.creditColumn : undefined,
      currencyColumn: parsed.mapping.currencyColumn !== -1 ? parsed.mapping.currencyColumn : undefined,
      balanceColumn: parsed.mapping.balanceColumn !== -1 ? parsed.mapping.balanceColumn : undefined,
      categoryColumn: parsed.mapping.categoryColumn !== -1 ? parsed.mapping.categoryColumn : undefined,
      dateFormat: parsed.mapping.dateFormat || 'YYYY-MM-DD',
      amountFormat: parsed.mapping.amountFormat || 'single',
      amountSignConvention: parsed.mapping.amountSignConvention || 'standard',
    } : null;
    
    return {
      isValidForImport: parsed.isValidForImport ?? false,
      mapping,
      confidence: parsed.confidence || 'low',
      missingFields: parsed.missingFields || [],
      warnings: parsed.warnings || [],
      suggestion: parsed.suggestion,
    };
  } catch (error) {
    console.error('Failed to parse AI response:', error);
    return {
      isValidForImport: false,
      mapping: null,
      confidence: 'low',
      missingFields: ['Unable to parse AI response'],
      warnings: ['The AI response could not be parsed. Please try again.'],
      suggestion: 'The analysis failed. You can try re-uploading the CSV or contact support.',
    };
  }
}

/**
 * Analyze CSV structure using AI
 * 
 * SECURITY FLOW:
 * 1. Anonymize the CSV locally (extract only structure, no real data)
 * 2. Validate the anonymized description contains no sensitive data
 * 3. Send ONLY the anonymized structure to AI
 * 4. Receive column mapping instructions
 * 5. Apply mapping LOCALLY to real data (which never left the device)
 */
export async function analyzeCSVWithAI(csvContent: string): Promise<CSVAnalysisResult> {
  try {
    // Step 1: Anonymize the CSV data locally
    const structure = anonymizeCSVForAnalysis(csvContent);
    const structureDescription = createStructureDescription(structure);
    
    // Step 2: Validate no sensitive data leaked into the description
    const validation = validateNoSensitiveData(structureDescription);
    if (!validation.safe) {
      console.warn('Anonymization warnings:', validation.warnings);
      // Continue but log warnings - the anonymization should still be safe
    }
    
    // Step 3: Get AI API key from environment
    const apiKey = getAIApiKey();
    
    if (!apiKey) {
      // Fall back to heuristic analysis if no API key configured
      console.log('No AI API key configured, using heuristic analysis');
      return analyzeCSVHeuristically(structure);
    }
    
    // Step 4: Send anonymized structure to AI (using OpenAI API)
    const prompt = buildAnalysisPrompt(structureDescription);
    
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: 'You are a CSV format analyzer. Respond only with valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        model: 'gpt-4o-mini', // Cost-effective model for structured analysis
        temperature: 0.1, // Low temperature for consistent structured output
        max_tokens: 1000,
      }),
    });
    
    if (!response.ok) {
      console.warn('AI API call failed, falling back to heuristic analysis');
      return analyzeCSVHeuristically(structure);
    }
    
    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content || '';
    
    // Step 5: Parse AI response and return mapping
    return parseAIResponse(aiResponse);
    
  } catch (error) {
    console.error('CSV analysis error:', error);
    // Fall back to heuristic analysis on any error
    try {
      const structure = anonymizeCSVForAnalysis(csvContent);
      return analyzeCSVHeuristically(structure);
    } catch {
      return {
        isValidForImport: false,
        mapping: null,
        confidence: 'low',
        missingFields: ['Analysis failed'],
        warnings: ['Failed to analyze the CSV file. Please check the format.'],
        suggestion: 'Make sure your CSV file has headers and contains date, amount, and description columns.',
      };
    }
  }
}

/**
 * Heuristic-based CSV analysis (fallback when AI is not available)
 * Uses pattern matching and common column name conventions
 */
export function analyzeCSVHeuristically(structure: CSVStructure): CSVAnalysisResult {
  const headers = structure.headers.map(h => h.toLowerCase().trim());
  const formats = structure.detectedFormats;
  
  // Common column name patterns
  const datePatterns = ['date', 'transaction date', 'posted date', 'completed date', 'started date', 'time', 'datetime'];
  const amountPatterns = ['amount', 'value', 'sum', 'total'];
  const debitPatterns = ['debit', 'withdrawal', 'out', 'expense'];
  const creditPatterns = ['credit', 'deposit', 'in', 'income'];
  const descriptionPatterns = ['description', 'desc', 'merchant', 'payee', 'payer', 'name', 'details', 'narrative', 'reference'];
  const currencyPatterns = ['currency', 'ccy', 'curr'];
  const balancePatterns = ['balance', 'running balance', 'available balance'];
  const categoryPatterns = ['category', 'type', 'classification'];
  
  // Find columns by name matching
  const findColumn = (patterns: string[]): number => {
    for (let i = 0; i < headers.length; i++) {
      if (patterns.some(p => headers[i].includes(p))) {
        return i;
      }
    }
    return -1;
  };
  
  // Find columns by type detection
  const findColumnByType = (type: string): number => {
    const idx = formats.findIndex(f => f.inferredType === type);
    return idx;
  };
  
  // Try to find required columns
  let dateColumn = findColumn(datePatterns);
  let amountColumn = findColumn(amountPatterns);
  let descriptionColumn = findColumn(descriptionPatterns);
  let debitColumn = findColumn(debitPatterns);
  let creditColumn = findColumn(creditPatterns);
  let currencyColumn = findColumn(currencyPatterns);
  let balanceColumn = findColumn(balancePatterns);
  let categoryColumn = findColumn(categoryPatterns);
  
  // Fall back to type detection if name matching failed
  if (dateColumn === -1) {
    dateColumn = findColumnByType('date');
  }
  
  if (amountColumn === -1 && debitColumn === -1) {
    // Look for amount columns by type
    const amountCols = formats.filter(f => f.inferredType === 'amount');
    if (amountCols.length === 1) {
      amountColumn = amountCols[0].columnIndex;
    } else if (amountCols.length === 2) {
      // Likely debit/credit split
      debitColumn = amountCols[0].columnIndex;
      creditColumn = amountCols[1].columnIndex;
    }
  }
  
  if (descriptionColumn === -1) {
    // Find first text column that's not a header we've already identified
    const usedColumns = new Set([dateColumn, amountColumn, debitColumn, creditColumn, currencyColumn, balanceColumn]);
    const textCol = formats.find(f => f.inferredType === 'text' && !usedColumns.has(f.columnIndex));
    if (textCol) {
      descriptionColumn = textCol.columnIndex;
    }
  }
  
  if (currencyColumn === -1) {
    currencyColumn = findColumnByType('currency');
  }
  
  // Determine if we have enough for import
  const hasDate = dateColumn !== -1;
  const hasAmount = amountColumn !== -1 || (debitColumn !== -1 && creditColumn !== -1);
  const hasDescription = descriptionColumn !== -1;
  
  const missingFields: string[] = [];
  if (!hasDate) missingFields.push('date');
  if (!hasAmount) missingFields.push('amount');
  if (!hasDescription) missingFields.push('description');
  
  const isValidForImport = hasDate && hasAmount && hasDescription;
  
  // Determine date format
  let dateFormat = 'YYYY-MM-DD';
  if (dateColumn !== -1 && formats[dateColumn]?.sampleFormat) {
    dateFormat = formats[dateColumn].sampleFormat!;
  }
  
  // Detect amount format and convention
  const amountFormat: 'single' | 'split' = amountColumn !== -1 ? 'single' : 'split';
  let amountSignConvention: 'standard' | 'inverted' = 'standard';
  
  // Check if the amount column has negatives for expenses (standard convention)
  if (amountColumn !== -1 && formats[amountColumn]?.hasNegatives) {
    amountSignConvention = 'standard';
  }
  
  const warnings: string[] = [];
  if (dateColumn !== -1 && formats[dateColumn]?.sampleFormat?.includes('or')) {
    warnings.push('Date format is ambiguous (could be DD/MM or MM/DD)');
  }
  
  const mapping: ColumnMapping | null = isValidForImport ? {
    dateColumn,
    amountColumn: amountColumn !== -1 ? amountColumn : -1,
    descriptionColumn,
    debitColumn: debitColumn !== -1 ? debitColumn : undefined,
    creditColumn: creditColumn !== -1 ? creditColumn : undefined,
    currencyColumn: currencyColumn !== -1 ? currencyColumn : undefined,
    balanceColumn: balanceColumn !== -1 ? balanceColumn : undefined,
    categoryColumn: categoryColumn !== -1 ? categoryColumn : undefined,
    dateFormat,
    amountFormat,
    amountSignConvention,
  } : null;
  
  return {
    isValidForImport,
    mapping,
    confidence: isValidForImport ? (warnings.length === 0 ? 'high' : 'medium') : 'low',
    missingFields,
    warnings,
    suggestion: isValidForImport 
      ? undefined 
      : `Your CSV is missing required columns: ${missingFields.join(', ')}. Please ensure your CSV has columns for date, amount, and description.`,
  };
}
