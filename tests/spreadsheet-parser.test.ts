import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseDocumentBuffer } from "../src/lib/parsers/index.js";

describe("spreadsheet document parsing", () => {
  it("indexes CSV rows as retrieval-ready document sections", async () => {
    const parsed = await parseDocumentBuffer(
      "text/csv",
      Buffer.from("feature,owner,status\nGitHub sync,Devraj,ready\nCalendar sync,Maya,blocked\n", "utf8"),
      "roadmap.csv"
    );

    expect(parsed.sections.length).toBeGreaterThan(0);
    expect(parsed.sections[0].metadataJson).toMatchObject({ datasetProfileKind: "tabular" });
    expect(parsed.text).toContain("Dataset analysis profile");
    expect(parsed.text).toContain("Rows: 2 data rows");
    expect(parsed.text).toContain("Columns: feature, owner, status");
    expect(parsed.text).toContain("feature: GitHub sync");
    expect(parsed.text).toContain("status: blocked");
  });

  it("indexes XLSX worksheet rows without executing spreadsheet content", async () => {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="Roadmap" sheetId="1" r:id="rId1"/></sheets>
      </workbook>`);
    zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
      </Relationships>`);
    zip.file("xl/sharedStrings.xml", `<?xml version="1.0" encoding="UTF-8"?>
      <sst><si><t>feature</t></si><si><t>owner</t></si><si><t>RAG</t></si><si><t>Karthik</t></si></sst>`);
    zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?>
      <worksheet>
        <sheetData>
          <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
          <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>
        </sheetData>
      </worksheet>`);
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const parsed = await parseDocumentBuffer(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
      "roadmap.xlsx"
    );

    expect(parsed.sections.length).toBeGreaterThan(0);
    expect(parsed.sections[0].metadataJson).toMatchObject({ datasetProfileKind: "tabular" });
    expect(parsed.text).toContain("Dataset analysis profile");
    expect(parsed.text).toContain("Worksheet: Roadmap");
    expect(parsed.text).toContain("feature: RAG");
    expect(parsed.text).toContain("owner: Karthik");
  });

  it("rejects XLSX files that would inflate beyond parser limits before JSZip parsing", async () => {
    const buffer = fakeXlsxZipCentralDirectory([
      { name: "xl/workbook.xml", compressedSize: 64, uncompressedSize: 1024 },
      { name: "xl/worksheets/sheet1.xml", compressedSize: 1024, uncompressedSize: 100 * 1024 * 1024 }
    ]);

    await expect(
      parseDocumentBuffer(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer,
        "unsafe.xlsx"
      )
    ).rejects.toMatchObject({ code: "document_xlsx_inflation_limit_exceeded" });
  });

  it("rejects DOCX files that would inflate beyond parser limits before mammoth parsing", async () => {
    const buffer = fakeXlsxZipCentralDirectory([
      { name: "[Content_Types].xml", compressedSize: 64, uncompressedSize: 1024 },
      { name: "word/document.xml", compressedSize: 1024, uncompressedSize: 100 * 1024 * 1024 }
    ]);

    await expect(
      parseDocumentBuffer(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer,
        "unsafe.docx"
      )
    ).rejects.toMatchObject({ code: "document_docx_inflation_limit_exceeded" });
  });

  it("bounds attacker-controlled XLSX cell coordinates before allocating rows", async () => {
    const buffer = await makeXlsxBuffer(`
      <row r="1"><c r="A1" t="inlineStr"><is><t>feature</t></is></c></row>
      <row r="2"><c r="ZZZZZZZ2" t="inlineStr"><is><t>unreachable</t></is></c><c r="A2" t="inlineStr"><is><t>safe</t></is></c></row>
    `);

    const parsed = await parseDocumentBuffer(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
      "bounded.xlsx"
    );

    expect(parsed.text).toContain("feature: safe");
    expect(parsed.text).not.toContain("unreachable");
  });

  it("caps repeated spreadsheet and CSV headers and retained row cardinality", async () => {
    const hugeHeader = "h".repeat(100_000);
    const csv = `${hugeHeader}\n${Array.from({ length: 10_000 }, (_, index) => `value-${index}`).join("\n")}`;
    const parsedCsv = await parseDocumentBuffer("text/csv", Buffer.from(csv), "bounded.csv");
    expect(parsedCsv.text.length).toBeLessThan(2_000_000);
    expect(parsedCsv.text).toContain("sampled to the first 2000");
    expect(parsedCsv.text).not.toContain("h".repeat(201));

    const buffer = await makeXlsxBuffer(`
      <row r="1"><c r="A1" t="inlineStr"><is><t>${hugeHeader}</t></is></c></row>
      ${Array.from({ length: 300 }, (_, index) => `<row r="${index + 2}"><c r="A${index + 2}" t="inlineStr"><is><t>value-${index}</t></is></c></row>`).join("")}
    `);
    const parsedXlsx = await parseDocumentBuffer(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
      "bounded.xlsx"
    );
    expect(parsedXlsx.text.length).toBeLessThan(2_000_000);
    expect(parsedXlsx.text).not.toContain("h".repeat(201));
  });
});

async function makeXlsxBuffer(rowsXml: string) {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets><sheet name="Sheet" sheetId="1" r:id="rId1"/></sheets>
    </workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
    </Relationships>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet><sheetData>${rowsXml}</sheetData></worksheet>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

function fakeXlsxZipCentralDirectory(entries: Array<{ name: string; compressedSize: number; uncompressedSize: number }>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(entry.compressedSize, 18);
    local.writeUInt32LE(entry.uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(entry.compressedSize, 20);
    central.writeUInt32LE(entry.uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centrals.push(central);
    localOffset += local.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, centralDirectory, eocd]);
}
