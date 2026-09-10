import { AppError } from "../../app/errors.js";

export const MAX_DOCUMENT_PARSE_BYTES = 50 * 1024 * 1024;
export const MAX_PARSED_TEXT_CHARS = 2_000_000;
export const MAX_PARSED_SECTIONS = 500;
export const MAX_PDF_PAGES = 200;
export const PARSER_TIMEOUT_MS = 30_000;
export const MAX_XLSX_ZIP_ENTRIES = 512;
export const MAX_XLSX_TOTAL_UNCOMPRESSED_BYTES = 40 * 1024 * 1024;
export const MAX_XLSX_ENTRY_UNCOMPRESSED_BYTES = 12 * 1024 * 1024;
export const MAX_XLSX_COMPRESSION_RATIO = 80;
export const MAX_DOCX_ZIP_ENTRIES = 384;
export const MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES = 30 * 1024 * 1024;
export const MAX_DOCX_ENTRY_UNCOMPRESSED_BYTES = 10 * 1024 * 1024;
export const MAX_DOCX_COMPRESSION_RATIO = 80;

export function assertDocumentBufferSafe(contentType: string, buffer: Buffer, fileName?: string) {
  const normalized = normalizeDocumentContentType(contentType);
  if (buffer.length > MAX_DOCUMENT_PARSE_BYTES) {
    throw new AppError(413, "Document is too large for parser safety limits", "document_parse_size_limit_exceeded");
  }

  if (normalized === "application/pdf" && !looksLikePdf(buffer)) {
    throw new AppError(422, "Document content does not match PDF signature", "document_file_signature_mismatch");
  }
  if (normalized === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && !looksLikeZip(buffer)) {
    throw new AppError(422, "Document content does not match DOCX signature", "document_file_signature_mismatch");
  }
  if ((normalized === "text/plain" || normalized === "text/markdown" || normalized === "text/csv") && !looksLikeUtf8Text(buffer)) {
    throw new AppError(422, "Document content is not valid text", "document_file_signature_mismatch");
  }
  if (normalized === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" && !looksLikeZip(buffer)) {
    throw new AppError(422, "Document content does not match XLSX signature", "document_file_signature_mismatch");
  }

  if (fileName && normalized === "application/pdf" && looksLikeFileName(fileName) && !fileName.toLowerCase().endsWith(".pdf")) {
    throw new AppError(422, "Document MIME type does not match filename extension", "document_file_type_mismatch");
  }
  return normalized;
}

function looksLikeFileName(value: string) {
  const baseName = value.split(/[\\/]/).pop() ?? "";
  return /^[^\s.][^\s]*\.[a-z0-9]{1,12}$/i.test(baseName);
}

export async function withParserTimeout<T>(work: Promise<T>, operation: string, timeoutMs = PARSER_TIMEOUT_MS): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new AppError(504, `${operation} timed out`, "document_parse_timeout")),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function assertParsedTextSafe(text: string) {
  if (text.length > MAX_PARSED_TEXT_CHARS) {
    throw new AppError(413, "Parsed document text exceeds safety limits", "document_parsed_text_limit_exceeded");
  }
}

export type ParsedTextBudget = { used: number };

export function consumeParsedTextBudget(budget: ParsedTextBudget, text: string) {
  if (budget.used + text.length > MAX_PARSED_TEXT_CHARS) {
    throw new AppError(413, "Derived document text exceeds safety limits", "document_derived_output_limit_exceeded");
  }
  budget.used += text.length;
}

export function assertXlsxZipStructureSafe(buffer: Buffer) {
  assertZipStructureSafe(buffer, {
    documentKind: "XLSX",
    codePrefix: "document_xlsx",
    maxEntries: MAX_XLSX_ZIP_ENTRIES,
    maxTotalUncompressedBytes: MAX_XLSX_TOTAL_UNCOMPRESSED_BYTES,
    maxEntryUncompressedBytes: MAX_XLSX_ENTRY_UNCOMPRESSED_BYTES,
    maxCompressionRatio: MAX_XLSX_COMPRESSION_RATIO,
    isCriticalEntry: isSpreadsheetXmlEntry,
    requiredEntries: ["xl/workbook.xml"]
  });
}

export function assertDocxZipStructureSafe(buffer: Buffer) {
  assertZipStructureSafe(buffer, {
    documentKind: "DOCX",
    codePrefix: "document_docx",
    maxEntries: MAX_DOCX_ZIP_ENTRIES,
    maxTotalUncompressedBytes: MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES,
    maxEntryUncompressedBytes: MAX_DOCX_ENTRY_UNCOMPRESSED_BYTES,
    maxCompressionRatio: MAX_DOCX_COMPRESSION_RATIO,
    isCriticalEntry: isWordprocessingEntry,
    requiredEntries: ["word/document.xml", "[Content_Types].xml"]
  });
}

function assertZipStructureSafe(
  buffer: Buffer,
  options: {
    documentKind: "DOCX" | "XLSX";
    codePrefix: "document_docx" | "document_xlsx";
    maxEntries: number;
    maxTotalUncompressedBytes: number;
    maxEntryUncompressedBytes: number;
    maxCompressionRatio: number;
    isCriticalEntry: (name: string) => boolean;
    requiredEntries: string[];
  }
) {
  const eocdOffset = findEndOfCentralDirectoryOffset(buffer);
  if (eocdOffset < 0 || eocdOffset + 22 > buffer.length) {
    throw new AppError(422, `${options.documentKind} zip directory is invalid`, `${options.codePrefix}_zip_directory_invalid`);
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount === 0 || entryCount > options.maxEntries) {
    throw new AppError(413, `${options.documentKind} contains too many zip entries`, `${options.codePrefix}_zip_entry_limit_exceeded`);
  }
  if (centralDirectoryOffset + centralDirectorySize > buffer.length) {
    throw new AppError(422, `${options.documentKind} zip directory is invalid`, `${options.codePrefix}_zip_directory_invalid`);
  }

  let offset = centralDirectoryOffset;
  let totalUncompressedBytes = 0;
  const foundEntries = new Set<string>();
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new AppError(422, `${options.documentKind} zip directory is invalid`, `${options.codePrefix}_zip_directory_invalid`);
    }
    const generalPurposeFlags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > centralDirectoryOffset + centralDirectorySize || entryEnd > buffer.length) {
      throw new AppError(422, `${options.documentKind} zip directory is invalid`, `${options.codePrefix}_zip_directory_invalid`);
    }
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    assertSafeZipEntryName(name, options);
    if ((generalPurposeFlags & 0x1) === 0x1 || ![0, 8].includes(method)) {
      throw new AppError(422, `${options.documentKind} contains unsupported encrypted or compressed entries`, `${options.codePrefix}_zip_entry_unsupported`);
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new AppError(413, `${options.documentKind} zip64 entries exceed parser safety limits`, `${options.codePrefix}_zip64_unsupported`);
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > options.maxTotalUncompressedBytes) {
      throw new AppError(413, `${options.documentKind} expands beyond parser safety limits`, `${options.codePrefix}_inflation_limit_exceeded`);
    }
    if (options.isCriticalEntry(name) && uncompressedSize > options.maxEntryUncompressedBytes) {
      throw new AppError(413, `${options.documentKind} entry exceeds parser safety limits`, `${options.codePrefix}_entry_size_limit_exceeded`);
    }
    if (compressedSize > 0 && uncompressedSize > 1024 * 1024 && uncompressedSize / compressedSize > options.maxCompressionRatio) {
      throw new AppError(413, `${options.documentKind} compression ratio exceeds parser safety limits`, `${options.codePrefix}_inflation_limit_exceeded`);
    }
    foundEntries.add(name);
    offset = entryEnd;
  }

  const missingEntry = options.requiredEntries.find((entry) => !foundEntries.has(entry));
  if (missingEntry) {
    throw new AppError(422, `${options.documentKind} required document metadata is missing`, `${options.codePrefix}_document_missing`);
  }
}

export function normalizeDocumentContentType(value: string) {
  return (value || "application/octet-stream").split(";")[0].trim().toLowerCase();
}

export function looksLikePdf(buffer: Buffer) {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

export function looksLikeZip(buffer: Buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(buffer[2]) && [0x04, 0x06, 0x08].includes(buffer[3]);
}

export function looksLikeUtf8Text(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.length === 0) return true;
  if (sample.includes(0)) return false;
  const text = sample.toString("utf8");
  if (text.includes("\uFFFD")) return false;
  let controlCount = 0;
  for (const byte of sample) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      controlCount += 1;
    }
  }
  return controlCount <= Math.max(1, sample.length * 0.02);
}

function findEndOfCentralDirectoryOffset(buffer: Buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function assertSafeZipEntryName(name: string, options: { documentKind: string; codePrefix: string }) {
  const normalized = name.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new AppError(422, `${options.documentKind} zip entry name is unsafe`, `${options.codePrefix}_zip_entry_unsafe`);
  }
}

function isSpreadsheetXmlEntry(name: string) {
  return /^xl\/(worksheets|sharedStrings|workbook|styles|charts|tables|pivotTables)\//i.test(`${name}/`) || /^xl\/(sharedStrings|workbook|styles)\.xml$/i.test(name);
}

function isWordprocessingEntry(name: string) {
  return /^word\/(document|styles|numbering|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/i.test(name);
}
