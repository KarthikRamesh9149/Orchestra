import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import mammoth from "mammoth";
import { assertDocumentBufferSafe, assertDocxZipContentSafe, assertXlsxZipContentSafe, assertXlsxZipStructureSafe } from "../src/lib/parsers/file-safety.js";
import { parseXlsxDocument } from "../src/lib/parsers/xlsx.js";
import { parseDocxDocument } from "../src/lib/parsers/docx.js";

afterEach(() => vi.restoreAllMocks());

async function archive(kind: "xlsx" | "docx", content: string, compression: "STORE" | "DEFLATE" = "DEFLATE") {
  const zip = new JSZip();
  if (kind === "xlsx") {
    zip.file("xl/workbook.xml", "<workbook/>");
    zip.file("xl/worksheets/sheet1.xml", content);
  } else {
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file("word/document.xml", content);
  }
  return zip.generateAsync({ type: "nodebuffer", compression });
}

function alterDeclaredSize(input: Buffer, name: string, size: number) {
  const bytes = Buffer.from(input);
  const eocd = bytes.length - 22;
  let offset = bytes.readUInt32LE(eocd + 16);
  while (offset < eocd) {
    const length = bytes.readUInt16LE(offset + 28);
    if (bytes.toString("utf8", offset + 46, offset + 46 + length) === name) {
      bytes.writeUInt32LE(size, offset + 24);
      return bytes;
    }
    offset += 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  throw new Error("Fixture entry missing");
}

describe("parser file safety", () => {
  it("does not treat a document title without an extension as a filename mismatch", () => {
    expect(() => {
      assertDocumentBufferSafe("application/pdf", Buffer.from("%PDF-1.4\n%%EOF\n"), "Helios Beta PRD");
    }).not.toThrow();
  });

  it("still rejects explicit PDF filename mismatches", () => {
    expect(() => {
      assertDocumentBufferSafe("application/pdf", Buffer.from("%PDF-1.4\n%%EOF\n"), "helios-beta-prd.txt");
    }).toThrow(/filename extension/i);
  });
});

describe("actual ZIP inflation budgets", () => {
  it.each(["STORE", "DEFLATE"] as const)("accepts bounded %s DOCX and XLSX archives", async compression => {
    await expect(assertXlsxZipContentSafe(await archive("xlsx", "<worksheet/>", compression))).resolves.toBeUndefined();
    await expect(assertDocxZipContentSafe(await archive("docx", "<document/>", compression))).resolves.toBeUndefined();
  });

  it("rejects an understated 13 MiB worksheet before JSZip materializes it", async () => {
    const bytes = await archive("xlsx", "x".repeat(13 * 1024 * 1024));
    expect(bytes.length).toBeLessThan(20_000);
    expect(() => assertXlsxZipStructureSafe(bytes)).toThrow(/entry exceeds/);
    const forged = alterDeclaredSize(bytes, "xl/worksheets/sheet1.xml", 100);
    // Metadata alone cannot distinguish this malicious archive.
    expect(() => assertXlsxZipStructureSafe(forged)).not.toThrow();
    const load = vi.spyOn(JSZip, "loadAsync");
    await expect(parseXlsxDocument(forged)).rejects.toMatchObject({ code: "document_xlsx_inflation_limit_exceeded" });
    expect(load).not.toHaveBeenCalled();
  });

  it("rejects understated DOCX content before Mammoth starts parsing", async () => {
    const forged = alterDeclaredSize(await archive("docx", "x".repeat(64 * 1024)), "word/document.xml", 1);
    const extract = vi.spyOn(mammoth, "extractRawText");
    await expect(parseDocxDocument(forged)).rejects.toMatchObject({ code: "document_docx_inflation_limit_exceeded" });
    expect(extract).not.toHaveBeenCalled();
  });

  it("checks stored payload sizes and rejects overclaimed content", async () => {
    const bytes = await archive("xlsx", "<worksheet/>", "STORE");
    await expect(assertXlsxZipContentSafe(alterDeclaredSize(bytes, "xl/worksheets/sheet1.xml", 1))).rejects.toMatchObject({ code: "document_xlsx_inflation_limit_exceeded" });
    await expect(assertXlsxZipContentSafe(alterDeclaredSize(bytes, "xl/worksheets/sheet1.xml", 100))).rejects.toMatchObject({ code: "document_xlsx_zip_content_invalid" });
  });

  it("rejects uninspected central entries and invalid local payload offsets", async () => {
    const bytes = await archive("xlsx", "<worksheet/>");
    const hidden = Buffer.from(bytes), eocd = hidden.length - 22;
    const count = hidden.readUInt16LE(eocd + 10) - 1;
    hidden.writeUInt16LE(count, eocd + 8);
    hidden.writeUInt16LE(count, eocd + 10);
    await expect(assertXlsxZipContentSafe(hidden)).rejects.toMatchObject({ code: "document_xlsx_zip_directory_invalid" });
    const badOffset = Buffer.from(bytes);
    badOffset.writeUInt32LE(0xffffffff, badOffset.readUInt32LE(eocd + 16) + 42);
    await expect(assertXlsxZipContentSafe(badOffset)).rejects.toMatchObject({ code: "document_xlsx_zip_directory_invalid" });
  });

  it.each(["xl/./worksheets/sheet1.xml", "xl//worksheets/sheet1.xml"])("applies critical limits to canonical path %s", async name => {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", "<workbook/>");
    zip.file(name, "<worksheet/>");
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
    // Tiny metadata-only fixture: no large decompression is needed to reject it.
    await expect(assertXlsxZipContentSafe(alterDeclaredSize(bytes, name, 13 * 1024 * 1024))).rejects.toMatchObject({ code: "document_xlsx_entry_size_limit_exceeded" });
  });

  it("accepts Unicode extras and streamed data descriptors from ordinary ZIP writers", async () => {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", "<workbook/>");
    zip.file("xl/worksheets/sheet1.xml", "<worksheet/>");
    zip.file("添付.txt", "Synthetic attachment");
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", streamFiles: true });
    await expect(assertXlsxZipContentSafe(bytes)).resolves.toBeUndefined();
  });
});
