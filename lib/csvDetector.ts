/**
 * CSV Format Detection Utility
 * Detects whether a CSV file is from AIB or Revolut based on headers and structure
 */

export type CSVProvider = 'aib' | 'revolut' | 'unknown';

/**
 * Detect the CSV provider based on the file content
 * @param csvContent - The raw CSV file content
 * @returns The detected provider ('aib', 'revolut', or 'unknown')
 */
export function detectCSVProvider(csvContent: string): CSVProvider {
  if (!csvContent || csvContent.trim().length === 0) {
    return 'unknown';
  }

  const lines = csvContent.trim().split('\n');
  if (lines.length === 0) {
    return 'unknown';
  }

  // Get the first non-empty line (should be the header)
  const headerLine = lines.find(line => line.trim().length > 0);
  if (!headerLine) {
    return 'unknown';
  }

  const headerLower = headerLine.toLowerCase();

  // AIB Detection:
  // AIB CSV headers typically include: "Posted Transactions", "Posted Account", "Date", "Description", "Debit", "Credit", "Balance"
  // Check for distinctive AIB headers
  if (
    headerLower.includes('posted transactions') ||
    headerLower.includes('posted account') ||
    (headerLower.includes('debit') && headerLower.includes('credit') && headerLower.includes('balance'))
  ) {
    return 'aib';
  }

  // Revolut Detection:
  // Revolut CSV headers typically include: "Type", "Product", "Started Date", "Completed Date", "Description", "Amount", "Fee", "Currency", "State", "Balance"
  // Check for distinctive Revolut headers
  if (
    (headerLower.includes('type') && headerLower.includes('product') && headerLower.includes('state')) ||
    (headerLower.includes('started date') && headerLower.includes('completed date')) ||
    (headerLower.includes('amount') && headerLower.includes('fee') && headerLower.includes('currency') && headerLower.includes('state'))
  ) {
    return 'revolut';
  }

  // If we can't detect from headers, try looking at the second line structure
  if (lines.length > 1) {
    const firstDataLine = lines[1];
    const columns = firstDataLine.split(',').map(col => col.trim());

    // AIB typically has 7 columns: Date, Description, Debit, Credit, Balance
    // Revolut typically has 10+ columns
    if (columns.length >= 10) {
      // Likely Revolut (more columns)
      return 'revolut';
    } else if (columns.length >= 4 && columns.length <= 7) {
      // Could be AIB (fewer columns)
      // Check if there's a date pattern that looks like AIB (DD/MM/YYYY or DD/MM/YY)
      const datePattern = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
      if (columns.some(col => datePattern.test(col))) {
        return 'aib';
      }
    }
  }

  return 'unknown';
}
