import { requireNativeModule } from 'expo-modules-core';

interface PdfPage {
  pageNumber: number;
  text: string;
  method: 'text_layer' | 'ocr';
}

export interface PdfExtractionResult {
  success: boolean;
  pageCount: number;
  extractionMethod: 'text_layer' | 'ocr';
  fullText: string;
  pages: PdfPage[];
}

export interface PdfTypeResult {
  type: 'text' | 'scanned';
  pageCount: number;
  sampleTextLength: number;
  hasTextLayer: boolean;
}

interface PdfTextExtractorType {
  extractText(fileUri: string): Promise<PdfExtractionResult>;
  detectPdfType(fileUri: string): Promise<PdfTypeResult>;
}

let PdfTextExtractor: PdfTextExtractorType | null = null;
try {
  PdfTextExtractor = requireNativeModule<PdfTextExtractorType>('PdfTextExtractor');
} catch (e) {
  console.warn(
    'PdfTextExtractor native module not available. PDF import requires a development build (not Expo Go).'
  );
}

export default PdfTextExtractor;
