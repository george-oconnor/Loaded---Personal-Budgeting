/**
 * PDF Text Extractor
 * 
 * SECURITY: All text extraction happens ENTIRELY ON-DEVICE using Apple's
 * PDFKit (for text-layer PDFs) and Vision framework (OCR for scanned PDFs).
 * No PDF content or financial data is ever transmitted off the device.
 * 
 * This module wraps the native PdfTextExtractor Expo module and provides
 * a clean TypeScript interface for the rest of the app.
 */

import PdfTextExtractor, {
  PdfExtractionResult,
  PdfTypeResult,
} from '../modules/pdf-text-extractor';

export type { PdfExtractionResult, PdfTypeResult };

/**
 * Detect whether a PDF contains a text layer or is a scanned image.
 * Runs fully on-device using Apple PDFKit.
 * 
 * @param fileUri - Local file URI of the PDF
 * @returns Type information about the PDF
 */
export const isPdfExtractorAvailable = PdfTextExtractor !== null;

export async function detectPdfType(fileUri: string): Promise<PdfTypeResult> {
  if (!PdfTextExtractor) {
    throw new Error('PDF extraction requires a development build (not Expo Go).');
  }
  try {
    return await PdfTextExtractor.detectPdfType(fileUri);
  } catch (error) {
    console.error('PDF type detection failed:', error);
    throw new Error(
      `Failed to detect PDF type: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Extract all text from a PDF file, on-device.
 * 
 * For text-layer PDFs (digitally generated), uses Apple PDFKit for fast extraction.
 * For scanned/image PDFs, uses Apple Vision framework OCR (accurate, on-device).
 * 
 * SECURITY: The PDF never leaves the device. All processing is local.
 * 
 * @param fileUri - Local file URI of the PDF
 * @returns Extraction result with full text and per-page breakdown
 */
export async function extractTextFromPdf(fileUri: string): Promise<PdfExtractionResult> {
  if (!PdfTextExtractor) {
    throw new Error('PDF extraction requires a development build (not Expo Go).');
  }
  try {
    const result = await PdfTextExtractor.extractText(fileUri);

    if (!result.success) {
      throw new Error('PDF extraction returned unsuccessful result');
    }

    // Post-process: clean up common OCR artifacts in bank statements
    const cleanedResult: PdfExtractionResult = {
      ...result,
      fullText: cleanExtractedText(result.fullText),
      pages: result.pages.map(page => ({
        ...page,
        text: cleanExtractedText(page.text),
      })),
    };

    return cleanedResult;
  } catch (error) {
    console.error('PDF text extraction failed:', error);
    throw new Error(
      `Failed to extract text from PDF: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Clean up common artifacts from extracted/OCR'd text.
 * Normalizes whitespace, fixes common OCR misreads in financial documents.
 */
function cleanExtractedText(text: string): string {
  let cleaned = text;

  // Normalize various whitespace characters to standard space
  cleaned = cleaned.replace(/[\t\f\v]/g, ' ');

  // Collapse multiple spaces into consistent spacing (preserve intentional column gaps)
  // Bank statements use multiple spaces for column alignment, so we preserve 2+ spaces
  cleaned = cleaned.replace(/ {4,}/g, '    '); // Normalize large gaps to 4 spaces

  // Fix common OCR misreads in financial contexts
  // 'O' misread as '0' in amounts — we leave these as-is since context matters
  // 'l' misread as '1' in amounts — similarly left for context

  // Remove form-feed / page-break characters
  cleaned = cleaned.replace(/\f/g, '\n');

  // Normalize line endings
  cleaned = cleaned.replace(/\r\n/g, '\n');
  cleaned = cleaned.replace(/\r/g, '\n');

  // Remove excessive blank lines (keep max 2)
  cleaned = cleaned.replace(/\n{4,}/g, '\n\n\n');

  // Trim trailing whitespace on each line
  cleaned = cleaned
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n');

  return cleaned.trim();
}
