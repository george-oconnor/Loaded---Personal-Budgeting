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

const PdfTextExtractor = requireNativeModule<PdfTextExtractorType>('PdfTextExtractor');

export default PdfTextExtractor;
