import PDFDocument from "pdfkit";
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

export function renderReportPdf(focus: string, results: DeepResearchResults): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const h1 = (t: string) => doc.moveDown(0.6).fontSize(18).fillColor("#1A1714").text(t);
      const h2 = (t: string) => doc.moveDown(0.6).fontSize(13).fillColor("#C84A1F").text(t);
      const body = (t: string) => doc.moveDown(0.2).fontSize(10.5).fillColor("#1A1714").text(t);
      const meta = (t: string) => doc.moveDown(0.2).fontSize(9).fillColor("#8A8378").text(t);

      h1(`Deep Research — ${focus}`);
      meta(
        `Analyzed ${results.stats.totalSources} sources · ${results.stats.slackMessages} messages · ${results.stats.commits} commits · ${results.stats.docs} docs · ${results.stats.webSources} web sources · ${results.stats.duration}`
      );

      h2("Executive summary");
      body(results.executiveSummary || "No summary.");

      if (results.findings.length) {
        h2("Critical findings");
        for (const f of results.findings) {
          doc.moveDown(0.3).fontSize(11).fillColor("#1A1714").text(`[${f.severity}] ${f.category} — ${f.title}`);
          body(f.description);
          if (f.sources) meta(`Evidence: ${f.sources}`);
        }
      }

      if (results.marketContext.length) {
        h2("Domain & market context");
        for (const m of results.marketContext) {
          doc.moveDown(0.3).fontSize(11).fillColor("#1A1714").text(m.title);
          body(m.body);
        }
      }

      if (results.expansionOpportunities.length) {
        h2("Expansion opportunities");
        for (const o of results.expansionOpportunities) body(`• ${o}`);
      }

      if (results.recommendedActions.length) {
        h2("Recommended actions");
        for (const a of results.recommendedActions) {
          body(`${a.priority} — ${a.action}`);
          if (a.source) meta(`Evidence: ${a.source}`);
        }
      }

      if (results.sources.length) {
        h2("Sources");
        for (const source of results.sources) body(`${sourceRefsLabel(source)}${source.label} — ${source.provider}\n${source.href}`);
      }

      doc.end();
    } catch (error) {
      reject(error as Error);
    }
  });
}

function sourceRefsLabel(source: DeepResearchResults["sources"][number]) {
  const refs = source.refs?.length ? source.refs : source.ref ? [source.ref] : [];
  return refs.length ? `${refs.join(" · ")} — ` : "";
}
