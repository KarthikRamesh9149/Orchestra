import { parseCsvDocument } from "./csv.js";
import { parseDocxDocument } from "./docx.js";
import { parsePdfDocument } from "./pdf.js";
import { parseTextDocument } from "./text.js";
import { parseXlsxDocument } from "./xlsx.js";
import { AppError } from "../../app/errors.js";
import { assertDocumentBufferSafe, assertParsedTextSafe, normalizeDocumentContentType } from "./file-safety.js";

export async function parseDocumentBuffer(contentType: string, buffer: Buffer, fallbackFileName?: string) {
  const normalized = normalizeDocumentContentType(contentType);
  const fileName = fallbackFileName?.toLowerCase() ?? "";
  assertDocumentBufferSafe(normalized, buffer, fileName);

  if (normalized === "application/pdf") {
    return parsePdfDocument(buffer);
  }

  if (
    normalized === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return parseDocxDocument(buffer);
  }

  if (
    normalized === "text/plain" ||
    normalized === "text/markdown"
  ) {
    const text = buffer.toString("utf8");
    assertParsedTextSafe(text);
    return parseTextDocument(text);
  }

  if (normalized === "text/csv") {
    return parseCsvDocument(buffer, fallbackFileName);
  }

  if (normalized === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return parseXlsxDocument(buffer, fallbackFileName);
  }

  throw new AppError(422, "Unsupported document file type", "unsupported_document_file_type");
}
