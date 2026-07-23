/**
 * CSV Format Detection Utility
 * Detects whether a CSV file is from AIB, Revolut, or a generic format based on headers and structure
 */

export type CSVProvider = 'aib' | 'revolut' | 'generic' | 'unknown';

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
  // AIB CSV headers are distinctively "Posted Account" / "Posted Transactions Date".
  // A generic debit/credit/balance check is NOT specific enough on its own — other
  // banks (e.g. Bank of Ireland's own CSV export: "Date,Details,Debit,Credit,Balance")
  // use those same generic column names and would be misdetected as AIB.
  if (
    headerLower.includes('posted transactions') ||
    headerLower.includes('posted account')
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

  // If we can't detect from headers, fall back to structure — but only for Revolut,
  // whose 10+ column export is a distinctive shape. A handful of columns with a
  // DD/MM/YYYY date is not distinctive to AIB — most Irish banks export that shape,
  // so guessing 'aib' here caused BOI (and likely other banks') CSVs to be misrouted.
  // Anything not confidently AIB/Revolut goes through the generic AI-assisted importer.
  if (lines.length > 1) {
    const firstDataLine = lines[1];
    const columns = firstDataLine.split(',').map(col => col.trim());

    if (columns.length >= 10) {
      return 'revolut';
    }
  }

  return 'unknown';
}
