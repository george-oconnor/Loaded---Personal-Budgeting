import { analyzePdfWithAI, PdfAnalysisResult } from "@/lib/pdfAIAnalyzer";
import { extractTextFromPdf, detectPdfType } from "@/lib/pdfTextExtractor";
import { detectTables, TableDetectionResult, DetectedTable } from "@/lib/pdfTableDetector";
import { processPdfTable } from "@/lib/pdfParser";
import { ColumnMapping } from "@/lib/csvAIAnalyzer";
import { ParsedTransaction, SkippedRow } from "@/lib/csvParser";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ─── In-Memory Cache (same pattern as CSV import) ─────────────────────────
type ParsedCache = {
  transactions: ParsedTransaction[];
  parsedRows: number;
  totalRows: number;
  skippedRows: number;
  skippedDetails: SkippedRow[];
};

let parsedTransactionsCache: ParsedCache | null = null;

export function getParsedPdfTransactions(): ParsedCache | null {
  return parsedTransactionsCache;
}

export function clearParsedPdfTransactions() {
  parsedTransactionsCache = null;
}

// ─── Types ────────────────────────────────────────────────────────────────
type AnalysisStatus =
  | "idle"
  | "reading"
  | "extracting"
  | "detecting"
  | "anonymizing"
  | "analyzing"
  | "parsing"
  | "done"
  | "error";

// ─── Component ────────────────────────────────────────────────────────────
export default function PdfPickScreen() {
  const { sharedFileUri } = useLocalSearchParams<{ sharedFileUri?: string }>();
  const [loading, setLoading] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [hasAutoAnalyzed, setHasAutoAnalyzed] = useState(false);
  const [pdfInfo, setPdfInfo] = useState<{
    pageCount: number;
    type: "text" | "scanned";
  } | null>(null);
  const [tableResult, setTableResult] = useState<TableDetectionResult | null>(null);
  const [analysisResult, setAnalysisResult] = useState<PdfAnalysisResult | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping | null>(null);
  const [extractedTextPreview, setExtractedTextPreview] = useState<string>("");

  // Handle shared PDF file URI from deep link / share sheet
  useEffect(() => {
    if (sharedFileUri && !hasAutoAnalyzed) {
      setHasAutoAnalyzed(true);
      const name = decodeURIComponent(sharedFileUri.split('/').pop() || 'statement.pdf');
      setFileName(name);
      setFileUri(sharedFileUri);
      // Auto-start analysis
      setTimeout(() => {
        analyzeFile(sharedFileUri);
      }, 100);
    }
  }, [sharedFileUri, hasAutoAnalyzed]);

  // ─── Pick PDF ─────────────────────────────────────────────────────────
  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf"],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const file = result.assets[0];
      const name = file.name || "statement.pdf";

      if (!name.toLowerCase().endsWith(".pdf")) {
        Alert.alert("Invalid File", "Please select a PDF file.");
        return;
      }

      setFileName(name);
      setFileUri(file.uri);
      setPdfInfo(null);
      setTableResult(null);
      setAnalysisResult(null);
      setColumnMapping(null);
      setExtractedTextPreview("");

      // Auto-start analysis
      await analyzeFile(file.uri);
    } catch (err) {
      console.error("File picker error:", err);
      Alert.alert("Error", "Failed to pick file. Please try again.");
    }
  };

  // ─── Full Analysis Pipeline ───────────────────────────────────────────
  const analyzeFile = async (uri: string) => {
    setLoading(true);
    setAnalysisStatus("reading");
    setAnalysisResult(null);
    setColumnMapping(null);

    try {
      // Step 1: Detect PDF type (text layer vs scanned)
      setAnalysisStatus("extracting");
      const pdfType = await detectPdfType(uri);
      setPdfInfo({
        pageCount: pdfType.pageCount,
        type: pdfType.type,
      });

      // Step 2: Extract text on-device (Apple PDFKit + Vision OCR)
      const extraction = await extractTextFromPdf(uri);

      if (!extraction.fullText || extraction.fullText.trim().length < 20) {
        setAnalysisStatus("error");
        Alert.alert(
          "Extraction Failed",
          "Could not extract enough text from the PDF. The file may be encrypted, empty, or in an unsupported format."
        );
        setLoading(false);
        return;
      }

      // Show a preview of extracted text
      setExtractedTextPreview(extraction.fullText.slice(0, 300));

      // Step 3: Detect transaction tables in extracted text
      setAnalysisStatus("detecting");
      const tables = detectTables(extraction.fullText);
      setTableResult(tables);

      if (!tables.success || !tables.mergedTable) {
        setAnalysisStatus("error");
        Alert.alert(
          "No Table Found",
          tables.error ||
            "Could not find a transaction table in the PDF. Make sure the file is a bank statement with transaction data."
        );
        setLoading(false);
        return;
      }

      // Step 4: Anonymize structure + analyze with AI (or heuristics)
      setAnalysisStatus("anonymizing");
      await new Promise((resolve) => setTimeout(resolve, 200)); // Brief UI update

      setAnalysisStatus("analyzing");
      const extractionMethod =
        pdfType.type === "scanned" ? "pdf_ocr" : "pdf_text_layer";
      const analysis = await analyzePdfWithAI(
        tables.mergedTable,
        extractionMethod as "pdf_text_layer" | "pdf_ocr"
      );
      setAnalysisResult(analysis);

      if (!analysis.isValidForImport || !analysis.mapping) {
        setAnalysisStatus("error");
        Alert.alert(
          "Cannot Import",
          analysis.suggestion ||
            `Missing required columns: ${analysis.missingFields.join(", ")}`
        );
        setLoading(false);
        return;
      }

      setColumnMapping(analysis.mapping);
      setAnalysisStatus("done");
    } catch (err) {
      console.error("PDF analysis error:", err);
      setAnalysisStatus("error");
      Alert.alert(
        "Error",
        `Failed to analyze the PDF: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setLoading(false);
    }
  };

  // ─── Continue to Preview ──────────────────────────────────────────────
  const handleContinue = async () => {
    if (!columnMapping || !tableResult?.mergedTable) {
      Alert.alert("Error", "Please analyze the PDF first");
      return;
    }

    setLoading(true);
    setAnalysisStatus("parsing");

    try {
      const { transactions, parseResult } = await processPdfTable(
        tableResult.mergedTable,
        columnMapping
      );

      if (transactions.length === 0) {
        Alert.alert(
          "No Transactions",
          "No valid transactions could be extracted from the PDF."
        );
        setLoading(false);
        return;
      }

      // Extract latest balance
      const sortedByDate = [...parseResult.transactions].sort(
        (a, b) =>
          new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      const mostRecentBalance = sortedByDate[0]?.balance;
      let latestBalance = "";
      if (mostRecentBalance) {
        const parsed = parseFloat(
          mostRecentBalance.replace(/[^0-9.-]/g, "")
        );
        if (!isNaN(parsed)) {
          latestBalance = parsed.toFixed(2);
        }
      }

      // Store for the preview screen
      parsedTransactionsCache = {
        transactions,
        parsedRows: parseResult.transactions.length,
        totalRows: parseResult.totalRows,
        skippedRows: parseResult.skipped,
        skippedDetails: parseResult.skippedDetails,
      };

      router.push({
        pathname: "/import/pdf/select-account",
        params: {
          transactionCount: String(transactions.length),
          detectedBalance: latestBalance,
        },
      } as any);
    } catch (error) {
      console.error("Parse error:", error);
      Alert.alert("Parse Failed", "Failed to parse transactions from the PDF.");
    } finally {
      setLoading(false);
      setAnalysisStatus("idle");
    }
  };

  // ─── Status Messages ─────────────────────────────────────────────────
  const getStatusMessage = () => {
    switch (analysisStatus) {
      case "reading":
        return "Reading PDF file...";
      case "extracting":
        return "Extracting text on-device (Apple PDFKit)...";
      case "detecting":
        return "Detecting transaction table...";
      case "anonymizing":
        return "Preparing anonymized structure (no personal data sent)...";
      case "analyzing":
        return "Analyzing column format...";
      case "parsing":
        return "Processing transactions...";
      case "done":
        return "Analysis complete!";
      case "error":
        return "Analysis failed";
      default:
        return "";
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 20,
          paddingTop: 20,
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View className="mb-6">
          <Pressable
            onPress={() => router.back()}
            className="mb-4 flex-row items-center gap-2"
          >
            <Text className="text-primary text-base">← Back</Text>
          </Pressable>
          <Text className="text-2xl font-bold text-dark-100">
            Import PDF Statement
          </Text>
          <Text className="text-sm text-gray-500 mt-1">
            Select a bank statement PDF from your device
          </Text>
        </View>

        {/* Privacy Notice */}
        <View className="mb-6 p-3 bg-violet-50 rounded-xl flex-row items-center gap-3">
          <Feather name="smartphone" size={20} color="#8B5CF6" />
          <Text className="text-xs text-violet-700 flex-1">
            PDF text extraction runs 100% on your device using Apple's built-in
            technology. Your financial data never leaves your phone.
          </Text>
        </View>

        {/* File Picker */}
        <View className="gap-3 mb-6">
          <Pressable
            onPress={handlePickFile}
            disabled={loading}
            className="border-2 border-dashed border-violet-300 rounded-2xl p-6 items-center justify-center bg-violet-50 active:bg-violet-100"
          >
            <Feather
              name="file"
              size={32}
              color={loading ? "#9CA3AF" : "#8B5CF6"}
            />
            <Text
              className={`text-base font-semibold mt-2 ${
                loading ? "text-gray-400" : "text-violet-700"
              }`}
            >
              {fileName ? "Change PDF File" : "Choose PDF File"}
            </Text>
            <Text className="text-xs text-gray-500 mt-1">
              Select a bank statement PDF
            </Text>
          </Pressable>
        </View>

        {/* File Info */}
        {fileName && (
          <View className="mb-6 p-3 bg-gray-50 rounded-xl">
            <View className="flex-row items-center gap-3">
              <View className="w-10 h-10 rounded-lg bg-violet-100 items-center justify-center">
                <Feather name="file-text" size={20} color="#8B5CF6" />
              </View>
              <View className="flex-1">
                <Text
                  className="text-sm font-semibold text-dark-100"
                  numberOfLines={1}
                >
                  {fileName}
                </Text>
                {pdfInfo && (
                  <Text className="text-xs text-gray-500 mt-0.5">
                    {pdfInfo.pageCount} page{pdfInfo.pageCount !== 1 ? "s" : ""}{" "}
                    •{" "}
                    {pdfInfo.type === "scanned"
                      ? "Scanned (using OCR)"
                      : "Digital (text layer)"}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={() => {
                  setFileName(null);
                  setFileUri(null);
                  setPdfInfo(null);
                  setTableResult(null);
                  setAnalysisResult(null);
                  setColumnMapping(null);
                  setExtractedTextPreview("");
                  setAnalysisStatus("idle");
                }}
              >
                <Feather name="x" size={20} color="#9CA3AF" />
              </Pressable>
            </View>
          </View>
        )}

        {/* Extracted Text Preview */}
        {extractedTextPreview && (
          <View className="mb-6">
            <Text className="text-sm font-bold text-dark-100 mb-2">
              Extracted Text Preview
            </Text>
            <View className="bg-gray-50 rounded-xl p-3 max-h-28 overflow-hidden">
              <Text
                className="text-xs font-mono text-gray-600"
                numberOfLines={5}
              >
                {extractedTextPreview}
                {extractedTextPreview.length >= 300 ? "..." : ""}
              </Text>
            </View>
          </View>
        )}

        {/* Analysis Status */}
        {loading && (
          <View className="mb-6 p-4 bg-violet-50 rounded-xl">
            <View className="flex-row items-center gap-3 mb-2">
              <ActivityIndicator size="small" color="#8B5CF6" />
              <Text className="text-sm font-medium text-violet-700">
                {getStatusMessage()}
              </Text>
            </View>
            {/* Progress steps */}
            <View className="gap-1.5 mt-2">
              {[
                { key: "extracting", label: "Text extraction (on-device)" },
                { key: "detecting", label: "Table detection" },
                { key: "anonymizing", label: "Anonymizing structure" },
                { key: "analyzing", label: "Column analysis" },
              ].map((step) => {
                const steps = [
                  "extracting",
                  "detecting",
                  "anonymizing",
                  "analyzing",
                  "parsing",
                  "done",
                ];
                const currentIdx = steps.indexOf(analysisStatus);
                const stepIdx = steps.indexOf(step.key);
                const isComplete = currentIdx > stepIdx;
                const isCurrent = currentIdx === stepIdx;

                return (
                  <View
                    key={step.key}
                    className="flex-row items-center gap-2"
                  >
                    {isComplete ? (
                      <Feather name="check-circle" size={14} color="#8B5CF6" />
                    ) : isCurrent ? (
                      <ActivityIndicator size={14} color="#8B5CF6" />
                    ) : (
                      <Feather name="circle" size={14} color="#D1D5DB" />
                    )}
                    <Text
                      className={`text-xs ${
                        isComplete
                          ? "text-violet-600"
                          : isCurrent
                          ? "text-violet-700 font-medium"
                          : "text-gray-400"
                      }`}
                    >
                      {step.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Table Detection Result */}
        {tableResult?.success && tableResult.mergedTable && !loading && (
          <View className="mb-6 p-3 bg-emerald-50 rounded-xl">
            <View className="flex-row items-center gap-2 mb-2">
              <Feather name="grid" size={16} color="#10B981" />
              <Text className="text-sm font-semibold text-emerald-800">
                Transaction Table Found
              </Text>
            </View>
            <Text className="text-xs text-emerald-700">
              {tableResult.mergedTable.totalDataRows} data rows •{" "}
              {tableResult.mergedTable.columns.length} columns detected •{" "}
              {tableResult.mergedTable.confidence} confidence
            </Text>
            <View className="flex-row flex-wrap gap-1.5 mt-2">
              {tableResult.mergedTable.columns.map((col) => (
                <View
                  key={col.index}
                  className="px-2 py-1 bg-white rounded border border-emerald-200"
                >
                  <Text className="text-[10px] text-emerald-700">
                    {col.name} ({col.inferredType})
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Analysis Result */}
        {analysisResult && !loading && (
          <View
            className={`mb-6 p-4 rounded-xl ${
              analysisResult.isValidForImport ? "bg-emerald-50" : "bg-red-50"
            }`}
          >
            <View className="flex-row items-center gap-2 mb-3">
              <Feather
                name={
                  analysisResult.isValidForImport
                    ? "check-circle"
                    : "alert-circle"
                }
                size={20}
                color={
                  analysisResult.isValidForImport ? "#10B981" : "#EF4444"
                }
              />
              <Text
                className={`text-base font-bold ${
                  analysisResult.isValidForImport
                    ? "text-emerald-800"
                    : "text-red-800"
                }`}
              >
                {analysisResult.isValidForImport
                  ? "Ready to Import"
                  : "Cannot Import"}
              </Text>
              <View
                className={`ml-auto px-2 py-1 rounded ${
                  analysisResult.confidence === "high"
                    ? "bg-emerald-100"
                    : analysisResult.confidence === "medium"
                    ? "bg-yellow-100"
                    : "bg-red-100"
                }`}
              >
                <Text
                  className={`text-xs font-medium ${
                    analysisResult.confidence === "high"
                      ? "text-emerald-700"
                      : analysisResult.confidence === "medium"
                      ? "text-yellow-700"
                      : "text-red-700"
                  }`}
                >
                  {analysisResult.confidence} confidence
                </Text>
              </View>
            </View>

            {/* Column Mapping */}
            {analysisResult.mapping && (
              <View className="mb-3">
                <Text className="text-sm font-semibold text-gray-700 mb-2">
                  Detected Columns:
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {analysisResult.mapping.dateColumn >= 0 && (
                    <View className="px-2 py-1 bg-white rounded border border-gray-200">
                      <Text className="text-xs text-gray-600">
                        📅 Date: Col {analysisResult.mapping.dateColumn + 1}
                      </Text>
                    </View>
                  )}
                  {analysisResult.mapping.amountColumn >= 0 && (
                    <View className="px-2 py-1 bg-white rounded border border-gray-200">
                      <Text className="text-xs text-gray-600">
                        💰 Amount: Col{" "}
                        {analysisResult.mapping.amountColumn + 1}
                      </Text>
                    </View>
                  )}
                  {analysisResult.mapping.descriptionColumn >= 0 && (
                    <View className="px-2 py-1 bg-white rounded border border-gray-200">
                      <Text className="text-xs text-gray-600">
                        📝 Description: Col{" "}
                        {analysisResult.mapping.descriptionColumn + 1}
                      </Text>
                    </View>
                  )}
                  {analysisResult.mapping.debitColumn !== undefined &&
                    analysisResult.mapping.debitColumn >= 0 && (
                      <View className="px-2 py-1 bg-white rounded border border-gray-200">
                        <Text className="text-xs text-gray-600">
                          📤 Debit: Col{" "}
                          {analysisResult.mapping.debitColumn + 1}
                        </Text>
                      </View>
                    )}
                  {analysisResult.mapping.creditColumn !== undefined &&
                    analysisResult.mapping.creditColumn >= 0 && (
                      <View className="px-2 py-1 bg-white rounded border border-gray-200">
                        <Text className="text-xs text-gray-600">
                          📥 Credit: Col{" "}
                          {analysisResult.mapping.creditColumn + 1}
                        </Text>
                      </View>
                    )}
                </View>
              </View>
            )}

            {/* Warnings */}
            {analysisResult.warnings.length > 0 && (
              <View className="mb-2">
                {analysisResult.warnings.map((warning, index) => (
                  <View key={index} className="flex-row items-start gap-2">
                    <Feather
                      name="alert-triangle"
                      size={14}
                      color="#F59E0B"
                    />
                    <Text className="text-xs text-yellow-700 flex-1">
                      {warning}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Missing Fields */}
            {analysisResult.missingFields.length > 0 && (
              <Text className="text-xs text-red-700">
                Missing: {analysisResult.missingFields.join(", ")}
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      {/* Bottom Actions */}
      <View className="absolute bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-100">
        {!analysisResult?.isValidForImport ? (
          <Pressable
            onPress={handlePickFile}
            disabled={loading}
            className={`w-full py-4 rounded-2xl items-center ${
              loading ? "bg-gray-300" : "bg-violet-500 active:opacity-80"
            }`}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <View className="flex-row items-center gap-2">
                <Feather name="file" size={18} color="white" />
                <Text className="text-white font-bold text-base">
                  {fileName ? "Try Different PDF" : "Select PDF File"}
                </Text>
              </View>
            )}
          </Pressable>
        ) : (
          <View className="gap-3">
            <Pressable
              onPress={handleContinue}
              disabled={loading}
              className={`w-full py-4 rounded-2xl items-center ${
                loading
                  ? "bg-gray-300"
                  : "bg-emerald-500 active:opacity-80"
              }`}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <View className="flex-row items-center gap-2">
                  <Feather name="arrow-right" size={18} color="white" />
                  <Text className="text-white font-bold text-base">
                    Continue to Preview
                  </Text>
                </View>
              )}
            </Pressable>
            <Pressable
              onPress={() => {
                setAnalysisResult(null);
                setColumnMapping(null);
                if (fileUri) analyzeFile(fileUri);
              }}
              className="w-full py-3 items-center"
            >
              <Text className="text-gray-500 font-medium">Re-analyze</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
