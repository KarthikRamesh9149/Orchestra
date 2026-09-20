import { AppError } from "../../app/errors.js";
import { createInflateRaw } from "node:zlib";

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

const xlsxZipSafety = {
  documentKind: "XLSX",
  codePrefix: "document_xlsx",
  maxEntries: MAX_XLSX_ZIP_ENTRIES,
  maxTotalUncompressedBytes: MAX_XLSX_TOTAL_UNCOMPRESSED_BYTES,
  maxEntryUncompressedBytes: MAX_XLSX_ENTRY_UNCOMPRESSED_BYTES,
  maxCompressionRatio: MAX_XLSX_COMPRESSION_RATIO,
  isCriticalEntry: isSpreadsheetXmlEntry,
  requiredEntries: ["xl/workbook.xml"]
};

const docxZipSafety = {
  documentKind: "DOCX",
  codePrefix: "document_docx",
  maxEntries: MAX_DOCX_ZIP_ENTRIES,
  maxTotalUncompressedBytes: MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES,
  maxEntryUncompressedBytes: MAX_DOCX_ENTRY_UNCOMPRESSED_BYTES,
  maxCompressionRatio: MAX_DOCX_COMPRESSION_RATIO,
  isCriticalEntry: isWordprocessingEntry,
  requiredEntries: ["word/document.xml", "[Content_Types].xml"]
};

export function assertXlsxZipStructureSafe(buffer: Buffer) {
  inspectZipStructure(buffer, xlsxZipSafety);
}

export function assertDocxZipStructureSafe(buffer: Buffer) {
  inspectZipStructure(buffer, docxZipSafety);
}

/** Validate actual output before JSZip/Mammoth can materialize an entry. ZIP
 * size fields are attacker-controlled and are not a decompression budget. */
export async function assertXlsxZipContentSafe(buffer: Buffer) {
  await assertZipContentSafe(buffer, xlsxZipSafety);
}

export async function assertDocxZipContentSafe(buffer: Buffer) {
  await assertZipContentSafe(buffer, docxZipSafety);
}

type ZipSafetyOptions = {
  documentKind: string;
  codePrefix: string;
  maxEntries: number;
  maxTotalUncompressedBytes: number;
  maxEntryUncompressedBytes: number;
  maxCompressionRatio: number;
  isCriticalEntry: (name: string) => boolean;
  requiredEntries: string[];
};
type ZipEntry = { critical: boolean; method: number; size: number; start: number; end: number };

function inspectZipStructure(
  buffer: Buffer,
  options: ZipSafetyOptions
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
  if (buffer.readUInt16LE(eocdOffset + 4) !== 0 || buffer.readUInt16LE(eocdOffset + 6) !== 0 ||
      buffer.readUInt16LE(eocdOffset + 8) !== entryCount ||
      eocdOffset + 22 + buffer.readUInt16LE(eocdOffset + 20) !== buffer.length ||
      centralDirectoryOffset + centralDirectorySize !== eocdOffset) {
    throw new AppError(422, `${options.documentKind} zip directory is invalid`, `${options.codePrefix}_zip_directory_invalid`);
  }

  let offset = centralDirectoryOffset;
  let totalUncompressedBytes = 0;
  const foundEntries = new Set<string>();
  const payloadInspections: Array<() => ZipEntry> = [];
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
    const isCriticalName = (candidate: string) => options.isCriticalEntry(candidate.replace(/\\/g, "/").split("/").filter(part => part && part !== ".").join("/"));
    let critical = isCriticalName(name);
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
    if (critical && uncompressedSize > options.maxEntryUncompressedBytes) {
      throw new AppError(413, `${options.documentKind} entry exceeds parser safety limits`, `${options.codePrefix}_entry_size_limit_exceeded`);
    }
    if (compressedSize > 0 && uncompressedSize > 1024 * 1024 && uncompressedSize / compressedSize > options.maxCompressionRatio) {
      throw new AppError(413, `${options.documentKind} compression ratio exceeds parser safety limits`, `${options.codePrefix}_inflation_limit_exceeded`);
    }
    // Finish all metadata budget checks before inspecting local payloads.
    const centralOffset = offset;
    payloadInspections.push(() => {
      // Use exactly the local payload offsets used by ZIP readers. Do not allow
      // hidden central entries or a payload extending into the directory itself.
      const localOffset = buffer.readUInt32LE(centralOffset + 42);
      if (localOffset + 30 > centralDirectoryOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50 ||
          buffer.readUInt16LE(localOffset + 8) !== method ||
          (buffer.readUInt16LE(localOffset + 6) & 1) !== 0) {
        throw new AppError(422, `${options.documentKind} local zip entry is invalid`, `${options.codePrefix}_zip_directory_invalid`);
      }
      const localNameEnd = localOffset + 30 + buffer.readUInt16LE(localOffset + 26);
      const start = localNameEnd + buffer.readUInt16LE(localOffset + 28);
      if (start > centralDirectoryOffset || compressedSize > centralDirectoryOffset - start) {
        throw new AppError(422, `${options.documentKind} zip payload is invalid`, `${options.codePrefix}_zip_directory_invalid`);
      }
      // JSZip uses the local filename and may replace it with a central Unicode
      // path extra field. Apply safety and critical-entry limits to every name
      // interpretation, not just the central directory's display name.
      const checkName = (candidate: string) => {
        assertSafeZipEntryName(candidate, options);
        critical ||= isCriticalName(candidate);
      };
      checkName(buffer.toString("utf8", localOffset + 30, localNameEnd));
      let extraOffset = centralOffset + 46 + nameLength;
      const extraEnd = extraOffset + extraLength;
      while (extraOffset < extraEnd) {
        if (extraOffset + 4 > extraEnd) {
          throw new AppError(422, `${options.documentKind} zip extra field is invalid`, `${options.codePrefix}_zip_directory_invalid`);
        }
        const kind = buffer.readUInt16LE(extraOffset), length = buffer.readUInt16LE(extraOffset + 2);
        const end = extraOffset + 4 + length;
        if (end > extraEnd || (kind === 0x7075 && length < 5)) {
          throw new AppError(422, `${options.documentKind} zip extra field is invalid`, `${options.codePrefix}_zip_directory_invalid`);
        }
        if (kind === 0x7075) checkName(buffer.toString("utf8", extraOffset + 9, end));
        extraOffset = end;
      }
      if (critical && uncompressedSize > options.maxEntryUncompressedBytes) {
        throw new AppError(413, `${options.documentKind} entry exceeds parser safety limits`, `${options.codePrefix}_entry_size_limit_exceeded`);
      }
      return { critical, method, size: uncompressedSize, start, end: start + compressedSize };
    });
    foundEntries.add(name);
    offset = entryEnd;
  }
  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    throw new AppError(422, `${options.documentKind} zip entry count is invalid`, `${options.codePrefix}_zip_directory_invalid`);
  }

  const missingEntry = options.requiredEntries.find((entry) => !foundEntries.has(entry));
  if (missingEntry) {
    throw new AppError(422, `${options.documentKind} required document metadata is missing`, `${options.codePrefix}_document_missing`);
  }
  return payloadInspections.map(inspect => inspect());
}

async function assertZipContentSafe(buffer: Buffer, options: ZipSafetyOptions) {
  const entries = inspectZipStructure(buffer, options);
  const deadline = Date.now() + PARSER_TIMEOUT_MS;
  let total = 0;
  for (const entry of entries) {
    if (Date.now() >= deadline) throw new AppError(504, `${options.documentKind} inspection timed out`, "document_parse_timeout");
    let size = 0;
    const consume = (length: number) => {
      size += length;
      total += length;
      if (size > entry.size || total > options.maxTotalUncompressedBytes ||
          (entry.critical && size > options.maxEntryUncompressedBytes)) {
        throw new AppError(413, `${options.documentKind} actual zip output exceeds safety limits`, `${options.codePrefix}_inflation_limit_exceeded`);
      }
    };
    if (entry.method === 0) {
      consume(entry.end - entry.start);
    } else {
      const inflate = createInflateRaw({ chunkSize: 16 * 1024 });
      const timer = setTimeout(() => inflate.destroy(new AppError(504, `${options.documentKind} inspection timed out`, "document_parse_timeout")), Math.max(0, deadline - Date.now()));
      try {
        inflate.end(buffer.subarray(entry.start, entry.end));
        for await (const chunk of inflate) consume((chunk as Buffer).length);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(422, `${options.documentKind} compressed content is invalid`, `${options.codePrefix}_zip_content_invalid`);
      } finally {
        clearTimeout(timer);
        inflate.destroy();
      }
    }
    if (size !== entry.size) {
      throw new AppError(422, `${options.documentKind} zip size does not match its content`, `${options.codePrefix}_zip_content_invalid`);
    }
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
