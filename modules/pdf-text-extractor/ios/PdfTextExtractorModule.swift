import ExpoModulesCore
import PDFKit
import Vision

/// Expo Module that extracts text from PDF files entirely on-device.
/// Uses Apple PDFKit for text-layer PDFs, and Vision framework OCR for scanned/image PDFs.
/// No financial data ever leaves the device.
public class PdfTextExtractorModule: Module {

  public func definition() -> ModuleDefinition {
    Name("PdfTextExtractor")

    /// Extract text from a PDF file at the given URI path.
    /// Returns a structured result with per-page text and metadata.
    AsyncFunction("extractText") { (fileUri: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let result = try Self.extractTextFromPDF(fileUri: fileUri)
          promise.resolve(result)
        } catch {
          promise.reject("PDF_EXTRACTION_ERROR", error.localizedDescription)
        }
      }
    }

    /// Quick check: does the PDF have a text layer or is it scanned/image-based?
    AsyncFunction("detectPdfType") { (fileUri: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let pdfType = try Self.detectType(fileUri: fileUri)
          promise.resolve(pdfType)
        } catch {
          promise.reject("PDF_DETECTION_ERROR", error.localizedDescription)
        }
      }
    }
  }

  // MARK: - PDF Type Detection

  private static func detectType(fileUri: String) throws -> [String: Any] {
    guard let url = Self.resolveFileURL(fileUri) else {
      throw NSError(domain: "PdfTextExtractor", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid file path"])
    }

    guard let document = PDFDocument(url: url) else {
      throw NSError(domain: "PdfTextExtractor", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not open PDF"])
    }

    let pageCount = document.pageCount

    // Sample first few pages for text content
    var totalTextLength = 0
    let samplesToCheck = min(3, pageCount)

    for i in 0..<samplesToCheck {
      if let page = document.page(at: i), let text = page.string {
        totalTextLength += text.trimmingCharacters(in: .whitespacesAndNewlines).count
      }
    }

    let hasTextLayer = totalTextLength > 50 // Arbitrary threshold
    let pdfType: String = hasTextLayer ? "text" : "scanned"

    return [
      "type": pdfType,
      "pageCount": pageCount,
      "sampleTextLength": totalTextLength,
      "hasTextLayer": hasTextLayer
    ]
  }

  // MARK: - Text Extraction

  private static func extractTextFromPDF(fileUri: String) throws -> [String: Any] {
    guard let url = Self.resolveFileURL(fileUri) else {
      throw NSError(domain: "PdfTextExtractor", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid file path"])
    }

    guard let document = PDFDocument(url: url) else {
      throw NSError(domain: "PdfTextExtractor", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not open PDF"])
    }

    let pageCount = document.pageCount
    var pages: [[String: Any]] = []
    var fullText = ""
    var extractionMethod = "text_layer"

    for i in 0..<pageCount {
      guard let page = document.page(at: i) else { continue }

      // Try text layer first (digitally generated PDFs)
      let textLayerContent = page.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

      if textLayerContent.count > 30 {
        // Good text layer — use it directly
        pages.append([
          "pageNumber": i + 1,
          "text": textLayerContent,
          "method": "text_layer"
        ])
        fullText += textLayerContent + "\n\n"
      } else {
        // No/poor text layer — fall back to Vision OCR
        extractionMethod = "ocr"
        let ocrText = try Self.performOCR(on: page)
        pages.append([
          "pageNumber": i + 1,
          "text": ocrText,
          "method": "ocr"
        ])
        fullText += ocrText + "\n\n"
      }
    }

    return [
      "success": true,
      "pageCount": pageCount,
      "extractionMethod": extractionMethod,
      "fullText": fullText.trimmingCharacters(in: .whitespacesAndNewlines),
      "pages": pages
    ]
  }

  // MARK: - Vision OCR for scanned PDFs

  private static func performOCR(on page: PDFPage) throws -> String {
    // Render PDF page to image for Vision OCR
    let pageRect = page.bounds(for: .mediaBox)
    let scale: CGFloat = 2.0 // 2x for better OCR quality
    let renderSize = CGSize(width: pageRect.width * scale, height: pageRect.height * scale)

    let renderer = UIGraphicsImageRenderer(size: renderSize)
    let image = renderer.image { context in
      context.cgContext.setFillColor(UIColor.white.cgColor)
      context.cgContext.fill(CGRect(origin: .zero, size: renderSize))

      context.cgContext.translateBy(x: 0, y: renderSize.height)
      context.cgContext.scaleBy(x: scale, y: -scale)

      page.draw(with: .mediaBox, to: context.cgContext)
    }

    guard let cgImage = image.cgImage else {
      throw NSError(domain: "PdfTextExtractor", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to render PDF page to image"])
    }

    // Use Vision framework for text recognition (fully on-device)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    // Support common languages for bank statements
    request.recognitionLanguages = ["en-US", "en-GB", "en-IE"]

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try handler.perform([request])

    guard let observations = request.results else {
      return ""
    }

    // Sort observations by position (top-to-bottom, left-to-right)
    // This preserves the visual reading order of the bank statement
    let sorted = observations.sorted { a, b in
      // Vision coordinates have origin at bottom-left, y increases upward
      // We want top-to-bottom, so sort by descending y first
      let yDiff = abs(a.boundingBox.midY - b.boundingBox.midY)
      if yDiff > 0.01 { // Same row threshold
        return a.boundingBox.midY > b.boundingBox.midY
      }
      return a.boundingBox.midX < b.boundingBox.midX
    }

    // Group into lines based on y-position proximity
    var lines: [[VNRecognizedTextObservation]] = []
    var currentLine: [VNRecognizedTextObservation] = []
    var lastY: CGFloat = -1

    for obs in sorted {
      if lastY < 0 || abs(obs.boundingBox.midY - lastY) < 0.008 {
        currentLine.append(obs)
      } else {
        if !currentLine.isEmpty {
          lines.append(currentLine)
        }
        currentLine = [obs]
      }
      lastY = obs.boundingBox.midY
    }
    if !currentLine.isEmpty {
      lines.append(currentLine)
    }

    // Build text from grouped lines
    let text = lines.map { line in
      line.compactMap { obs in
        obs.topCandidates(1).first?.string
      }.joined(separator: "  ")
    }.joined(separator: "\n")

    return text
  }

  // MARK: - File URL Resolution

  private static func resolveFileURL(_ fileUri: String) -> URL? {
    // Handle file:// URIs
    if fileUri.hasPrefix("file://") {
      return URL(string: fileUri)
    }

    // Handle absolute paths
    if fileUri.hasPrefix("/") {
      return URL(fileURLWithPath: fileUri)
    }

    // Handle content:// or other URI schemes (shouldn't happen on iOS but be safe)
    if let url = URL(string: fileUri) {
      return url
    }

    return nil
  }
}
