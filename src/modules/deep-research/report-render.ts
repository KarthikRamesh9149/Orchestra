import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB } from "pdf-lib";
import { AppError } from "../../app/errors.js";
import type { DeepResearchResults } from "./schemas.js";

export function renderReportMarkdown(focus: string, results: DeepResearchResults): string {
  const lines: string[] = [];
  lines.push(`# Deep Research — ${focus}`);
  lines.push("");
  lines.push(
    `_Analyzed ${results.stats.totalSources} sources · ${results.stats.slackMessages} messages · ${results.stats.commits} commits · ${results.stats.docs} docs · ${results.stats.webSources} web sources · ${results.stats.duration}_`
  );
  lines.push("");
  lines.push("## Executive summary");
  lines.push(results.executiveSummary || "_No summary._");

  if (results.findings.length) {
    lines.push("");
    lines.push("## Critical findings");
    for (const f of results.findings) {
      lines.push(`### [${f.severity}] ${f.category} — ${f.title}`);
      lines.push(f.description);
      if (f.sources) lines.push(`_Evidence: ${f.sources}_`);
      lines.push("");
    }
  }

  if (results.marketContext.length) {
    lines.push("## Domain & market context");
    for (const m of results.marketContext) {
      lines.push(`### ${m.title}`);
      lines.push(m.body);
      lines.push("");
    }
  }

  if (results.expansionOpportunities.length) {
    lines.push("## Expansion opportunities");
    for (const o of results.expansionOpportunities) lines.push(`- ${o}`);
    lines.push("");
  }

  if (results.recommendedActions.length) {
    lines.push("## Recommended actions");
    for (const a of results.recommendedActions) {
      lines.push(`- **${a.priority}** — ${a.action}`);
      if (a.source) lines.push(`  - Evidence: ${a.source}`);
    }
    lines.push("");
  }

  if (results.sources.length) {
    lines.push("## Sources");
    for (const source of results.sources) lines.push(`- ${sourceRefsLabel(source)}[${source.label}](${source.href}) — ${source.provider}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function renderReportPdf(focus: string, results: DeepResearchResults): Promise<Buffer> {
  const ink = rgb(0x1a / 255, 0x17 / 255, 0x14 / 255);
  const accent = rgb(0xc8 / 255, 0x4a / 255, 0x1f / 255);
  const muted = rgb(0x8a / 255, 0x83 / 255, 0x78 / 255);
  const blocks: PdfTextBlock[] = [];
  const text = (value: string, size: number, color: RGB, gap: number, heading = false) => {
    blocks.push({ text: value, size, color, gap, heading });
  };
  const h1 = (value: string) => text(value, 18, ink, 0.6, true);
  const h2 = (value: string) => text(value, 13, accent, 0.6, true);
  const subtitle = (value: string) => text(value, 11, ink, 0.3, true);
  const body = (value: string) => text(value, 10.5, ink, 0.2);
  const meta = (value: string) => text(value, 9, muted, 0.2);

  h1(`Deep Research — ${focus}`);
  meta(
    `Analyzed ${results.stats.totalSources} sources · ${results.stats.slackMessages} messages · ${results.stats.commits} commits · ${results.stats.docs} docs · ${results.stats.webSources} web sources · ${results.stats.duration}`
  );
  h2("Executive summary");
  body(results.executiveSummary || "No summary.");

  if (results.findings.length) {
    h2("Critical findings");
    for (const finding of results.findings) {
      subtitle(`[${finding.severity}] ${finding.category} — ${finding.title}`);
      body(finding.description);
      if (finding.sources) meta(`Evidence: ${finding.sources}`);
    }
  }
  if (results.marketContext.length) {
    h2("Domain & market context");
    for (const market of results.marketContext) {
      subtitle(market.title);
      body(market.body);
    }
  }
  if (results.expansionOpportunities.length) {
    h2("Expansion opportunities");
    for (const opportunity of results.expansionOpportunities) body(`• ${opportunity}`);
  }
  if (results.recommendedActions.length) {
    h2("Recommended actions");
    for (const action of results.recommendedActions) {
      body(`${action.priority} — ${action.action}`);
      if (action.source) meta(`Evidence: ${action.source}`);
    }
  }
  if (results.sources.length) {
    h2("Sources");
    for (const source of results.sources) body(`${sourceRefsLabel(source)}${source.label} — ${source.provider}\n${source.href}`);
  }

  const doc = await PDFDocument.create();
  const font = doc.embedStandardFont(StandardFonts.Helvetica);
  const supported = new Set(font.getCharacterSet());
  // Validate before drawing: PDF-LIB's text helper silently cleans some control
  // characters. Only CR/LF are layout here; no content is replaced or discarded.
  for (const block of blocks) {
    for (const character of block.text) {
      if (character !== "\r" && character !== "\n" && !supported.has(character.codePointAt(0)!)) {
        throw new AppError(
          422,
          "This report contains characters the built-in PDF font cannot represent. Download Markdown to preserve the original text.",
          "report_pdf_unsupported_characters"
        );
      }
    }
  }

  const margin = 50;
  const pageWidth = 612;
  const pageHeight = 792;
  const width = pageWidth - 2 * margin;
  let page = doc.addPage([pageWidth, pageHeight]);
  let top = pageHeight - margin;
  let previousSize = 12;
  const advances = new Map<string, number>();
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    const lineHeight = block.size * 1.2;
    top -= previousSize * 1.2 * block.gap;
    const lines = wrapPdfText(block.text, font, block.size, width, advances);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const next = blocks[index + 1];
      // Keep the end of a heading with the first line of its following block.
      const following = block.heading && lineIndex === lines.length - 1 && next
        ? block.size * 1.2 * next.gap + next.size * 1.2
        : 0;
      if (top - lineHeight - following < margin) {
        page = doc.addPage([pageWidth, pageHeight]);
        top = pageHeight - margin;
      }
      const line = lines[lineIndex]!;
      if (line) page.drawText(line, { x: margin, y: top - block.size, font, size: block.size, color: block.color });
      top -= lineHeight;
    }
    previousSize = block.size;
  }
  return Buffer.from(await doc.save());
}

type PdfTextBlock = { text: string; size: number; color: RGB; gap: number; heading: boolean };

function wrapPdfText(text: string, font: PDFFont, size: number, width: number, advances: Map<string, number>): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    const characters = Array.from(paragraph);
    if (!characters.length) lines.push("");
    for (let start = 0; start < characters.length;) {
      let end = start;
      let lineWidth = 0;
      let lastSpace = -1;
      while (end < characters.length) {
        const character = characters[end]!;
        // Basic PDF text drawing uses glyph advances without pair kerning.
        // Measuring whole strings would underestimate some displayed lines.
        let advance = advances.get(character);
        if (advance === undefined) {
          advance = font.widthOfTextAtSize(character, 1);
          advances.set(character, advance);
        }
        if (end > start && lineWidth + advance * size > width) break;
        lineWidth += advance * size;
        if (character === " ") lastSpace = end;
        end++;
      }
      if (end < characters.length && lastSpace >= start) end = lastSpace + 1;
      lines.push(characters.slice(start, end).join(""));
      start = end;
    }
  }
  return lines;
}

function sourceRefsLabel(source: DeepResearchResults["sources"][number]) {
  const refs = source.refs?.length ? source.refs : source.ref ? [source.ref] : [];
  return refs.length ? `${refs.join(" · ")} — ` : "";
}
