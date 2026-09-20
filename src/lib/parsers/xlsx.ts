import JSZip from "jszip";
import {
  assertParsedTextSafe,
  assertXlsxZipContentSafe,
  consumeParsedTextBudget,
  withParserTimeout,
  type ParsedTextBudget
} from "./file-safety.js";
import { buildTabularDatasetProfile, renderDatasetProfileText } from "../datasets/profile.js";
import type { ParsedDocument, ParsedSection } from "./types.js";

const MAX_WORKSHEETS = 12;
const MAX_ROWS_PER_SHEET = 1_500;
const MAX_COLUMNS_PER_ROW = 80;
const ROWS_PER_SECTION = 100;
const MAX_HEADER_CHARS = 200;
const MAX_CELL_CHARS = 500;

export async function parseXlsxDocument(buffer: Buffer, title = "Spreadsheet"): Promise<ParsedDocument> {
  await assertXlsxZipContentSafe(buffer);
  const zip = await withParserTimeout(JSZip.loadAsync(buffer), "XLSX zip parsing");
  const sharedStrings = await loadSharedStrings(zip);
  const sheets = await loadWorkbookSheets(zip);
  const sections: ParsedSection[] = [];
  const outputBudget: ParsedTextBudget = { used: 0 };

  for (const sheet of sheets.slice(0, MAX_WORKSHEETS)) {
    const file = zip.file(sheet.path);
    if (!file) continue;
    const xml = await withParserTimeout(file.async("string"), `XLSX sheet parsing: ${sheet.name}`);
    const totalRows = xml.match(/<row\b/g)?.length ?? 0;
    sections.push(...sheetToSections(
      normalizeLabel(sheet.name, "Worksheet"),
      parseSheetRows(xml, sharedStrings),
      normalizeLabel(title, "Spreadsheet"),
      totalRows,
      totalRows > MAX_ROWS_PER_SHEET,
      outputBudget
    ));
  }

  if (sections.length === 0) {
    sections.push({
      title,
      headingPath: [title],
      pageNumber: null,
      text: "Spreadsheet contained no readable worksheet rows."
    });
  }

  const text = sections.map((section) => `# ${section.title}\n${section.text}`).join("\n\n");
  assertParsedTextSafe(text);
  return { text, sections };
}

async function loadSharedStrings(zip: JSZip) {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) return [];
  const xml = await withParserTimeout(file.async("string"), "XLSX shared string parsing");
  return [...xml.matchAll(/<si\b[\s\S]*?<\/si>/g)].map((match) => {
    const textParts = [...match[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1]));
    return textParts.join("");
  });
}

async function loadWorkbookSheets(zip: JSZip) {
  const workbookFile = zip.file("xl/workbook.xml");
  const relsFile = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookFile || !relsFile) return fallbackSheets(zip);
  const [workbookXml, relsXml] = await Promise.all([workbookFile.async("string"), relsFile.async("string")]);
  const rels = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const attrs = parseAttrs(match[1]);
    if (attrs.Id && attrs.Target) {
      rels.set(attrs.Id, attrs.Target.startsWith("/") ? attrs.Target.slice(1) : `xl/${attrs.Target}`);
    }
  }
  const sheets = [...workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)]
    .map((match, index) => {
      const attrs = parseAttrs(match[1]);
      const relationId = attrs["r:id"];
      const path = relationId ? rels.get(relationId) : null;
      return path ? { name: attrs.name ? decodeXml(attrs.name) : `Sheet ${index + 1}`, path } : null;
    })
    .filter((sheet): sheet is { name: string; path: string } => Boolean(sheet));
  return sheets.length > 0 ? sheets : fallbackSheets(zip);
}

function fallbackSheets(zip: JSZip) {
  return Object.keys(zip.files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort()
    .map((path, index) => ({ name: `Sheet ${index + 1}`, path }));
}

function parseSheetRows(xml: string, sharedStrings: string[]) {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = parseAttrs(cellMatch[1]);
      const columnIndex = columnIndexFromRef(attrs.r);
      if (columnIndex === null || columnIndex >= MAX_COLUMNS_PER_ROW) continue;
      while (row.length < columnIndex) row.push("");
      row[columnIndex] = normalizeCellValue(readCellValue(cellMatch[2], attrs.t, sharedStrings));
      if (row.length >= MAX_COLUMNS_PER_ROW) break;
    }
    if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
    if (rows.length >= MAX_ROWS_PER_SHEET) break;
  }
  return rows;
}

function sheetToSections(
  sheetName: string,
  rows: string[][],
  workbookTitle: string,
  totalRowCount: number,
  truncated: boolean,
  outputBudget: ParsedTextBudget
): ParsedSection[] {
  if (rows.length === 0) return [];
  const headers = rows[0]
    .map((cell, index) => normalizeLabel(cell, `Column ${index + 1}`))
    .slice(0, MAX_COLUMNS_PER_ROW);
  const dataRows = rows.slice(1);
  const profile = buildTabularDatasetProfile({
    title: workbookTitle,
    sourceType: "xlsx",
    sheetName,
    rows: [headers, ...dataRows],
    totalRowCount,
    maxColumns: MAX_COLUMNS_PER_ROW,
    sampled: truncated
  });
  const profileSection: ParsedSection = {
    title: `${sheetName} dataset profile`,
    headingPath: [workbookTitle, sheetName, "Dataset profile"],
    pageNumber: null,
    text: renderDatasetProfileText(profile),
    metadataJson: {
      datasetProfileKind: "tabular",
      datasetProfile: profile
    }
  };
  consumeParsedTextBudget(outputBudget, profileSection.text);
  const sections: ParsedSection[] = [profileSection];
  for (let offset = 0; offset < dataRows.length; offset += ROWS_PER_SECTION) {
    const chunk = dataRows.slice(offset, offset + ROWS_PER_SECTION);
    const sectionTitle = `${sheetName} rows ${offset + 1}-${offset + chunk.length}`;
    const text = [
      `Workbook: ${workbookTitle}`,
      `Worksheet: ${sheetName}`,
      `Columns: ${headers.join(", ")}`,
      truncated ? `Indexing note: this worksheet was sampled to the first ${MAX_ROWS_PER_SHEET} non-empty rows for Socrates retrieval.` : "",
      "",
      ...chunk.map((row, rowIndex) => {
        const values = headers.map((header, index) => `${header}: ${normalizeCell(row[index] ?? "")}`);
        return `Row ${offset + rowIndex + 1}: ${values.join(" | ")}`;
      })
    ].join("\n").trim();
    consumeParsedTextBudget(outputBudget, text);
    sections.push({
      title: sectionTitle,
      headingPath: [workbookTitle, sheetName, sectionTitle],
      pageNumber: null,
      text
    });
  }
  if (sections.length === 0) {
    sections.push({
      title: sheetName,
      headingPath: [workbookTitle, sheetName],
      pageNumber: null,
      text: `Workbook: ${workbookTitle}\nWorksheet: ${sheetName}\nColumns: ${headers.join(", ")}\nNo data rows.`
    });
  }
  return sections;
}

function readCellValue(cellXml: string, type: string | undefined, sharedStrings: string[]) {
  if (type === "inlineStr") {
    return [...cellXml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1])).join("");
  }
  const value = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
  if (type === "s") return sharedStrings[Number(value)] ?? "";
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  return decodeXml(value);
}

function columnIndexFromRef(ref: string | undefined) {
  const letters = ref?.match(/^[A-Z]+/i)?.[0].toUpperCase();
  if (!letters) return 0;
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
    if (index > MAX_COLUMNS_PER_ROW) return null;
  }
  return Math.max(0, index - 1);
}

function parseAttrs(raw: string) {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[match[1]] = match[2];
  return attrs;
}

function decodeXml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function normalizeCell(value: string) {
  return normalizeCellValue(value) || "(blank)";
}

function normalizeCellValue(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_CELL_CHARS);
}

function normalizeLabel(value: string, fallback: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_HEADER_CHARS) || fallback;
}
