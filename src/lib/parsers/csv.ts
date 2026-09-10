import { assertParsedTextSafe, consumeParsedTextBudget, type ParsedTextBudget } from "./file-safety.js";
import { buildTabularDatasetProfile, renderDatasetProfileText } from "../datasets/profile.js";
import type { ParsedDocument, ParsedSection } from "./types.js";

const MAX_CSV_ROWS = 2_000;
const MAX_CSV_COLUMNS = 80;
const ROWS_PER_SECTION = 120;
const MAX_HEADER_CHARS = 200;
const MAX_CELL_CHARS = 500;

export function parseCsvDocument(buffer: Buffer, title = "CSV dataset"): ParsedDocument {
  const content = buffer.toString("utf8").replace(/^\uFEFF/, "");
  assertParsedTextSafe(content);
  const parsedRows = parseCsvRows(content);
  const sections = rowsToSections(parsedRows.rows, title, parsedRows.truncated, parsedRows.totalRowCount);
  const text = sections.map((section) => `# ${section.title}\n${section.text}`).join("\n\n");
  assertParsedTextSafe(text);
  return {
    text,
    sections
  };
}

function rowsToSections(rows: string[][], title: string, truncated: boolean, totalRowCount: number): ParsedSection[] {
  if (rows.length === 0) {
    return [{ title, headingPath: [title], pageNumber: null, text: "Empty CSV dataset." }];
  }
  const headers = rows[0]
    .slice(0, MAX_CSV_COLUMNS)
    .map((cell, index) => normalizeLabel(cell, `Column ${index + 1}`));
  const dataRows = rows.slice(1);
  const profile = buildTabularDatasetProfile({
    title,
    sourceType: "csv",
    rows: [headers, ...dataRows],
    totalRowCount,
    maxColumns: MAX_CSV_COLUMNS,
    sampled: truncated
  });
  const budget: ParsedTextBudget = { used: 0 };
  const profileSection: ParsedSection = {
    title: `${title} dataset profile`,
    headingPath: [title, "Dataset profile"],
    pageNumber: null,
    text: renderDatasetProfileText(profile),
    metadataJson: {
      datasetProfileKind: "tabular",
      datasetProfile: profile
    }
  };
  consumeParsedTextBudget(budget, profileSection.text);
  const sections: ParsedSection[] = [profileSection];

  for (let offset = 0; offset < dataRows.length; offset += ROWS_PER_SECTION) {
    const chunk = dataRows.slice(offset, offset + ROWS_PER_SECTION);
    const sectionTitle = `${title} rows ${offset + 1}-${offset + chunk.length}`;
    const lines = [
      `Dataset: ${title}`,
      `Columns: ${headers.join(", ")}`,
      truncated ? `Indexing note: this CSV was sampled to the first ${MAX_CSV_ROWS} non-empty rows for Socrates retrieval.` : "",
      "",
      ...chunk.map((row, rowIndex) => {
        const cells = row.slice(0, MAX_CSV_COLUMNS);
        const values = headers.map((header, index) => `${header}: ${normalizeCell(cells[index] ?? "")}`);
        return `Row ${offset + rowIndex + 1}: ${values.join(" | ")}`;
      })
    ];
    const text = lines.join("\n").trim();
    consumeParsedTextBudget(budget, text);
    sections.push({
      title: sectionTitle,
      headingPath: [title, sectionTitle],
      pageNumber: null,
      text
    });
  }

  if (sections.length === 0) {
    sections.push({
      title,
      headingPath: [title],
      pageNumber: null,
      text: `Dataset: ${title}\nColumns: ${headers.join(", ")}\nNo data rows.`
    });
  }
  return sections;
}

function parseCsvRows(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let totalRowCount = 0;

  const appendCellCharacter = (char: string) => {
    if (row.length < MAX_CSV_COLUMNS && cell.length < MAX_CELL_CHARS) cell += char;
  };

  const finishCell = () => {
    if (row.length < MAX_CSV_COLUMNS) row.push(cell);
    cell = "";
  };

  const finishRow = () => {
    finishCell();
    if (row.some((value) => value.trim().length > 0)) {
      totalRowCount += 1;
      if (rows.length < MAX_CSV_ROWS) rows.push(row);
    }
    row = [];
  };

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        appendCellCharacter('"');
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      finishCell();
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      finishRow();
      continue;
    }
    appendCellCharacter(char);
  }

  finishRow();
  return { rows, totalRowCount, truncated: totalRowCount > MAX_CSV_ROWS };
}

function normalizeCell(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_CELL_CHARS) || "(blank)";
}

function normalizeLabel(value: string, fallback: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_HEADER_CHARS) || fallback;
}
