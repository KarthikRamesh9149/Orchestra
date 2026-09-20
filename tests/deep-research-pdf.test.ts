import { PDFDocument, PDFPage } from "pdf-lib";
import { PDFParse } from "pdf-parse";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toAppError } from "../src/app/errors.js";
import { renderReportMarkdown, renderReportPdf } from "../src/modules/deep-research/report-render.js";
import { deepResearchResultsSchema, type DeepResearchResults } from "../src/modules/deep-research/schemas.js";

const compact = (text: string) => text.replace(/\s+/g, "");
function report(overrides: Partial<DeepResearchResults> = {}): DeepResearchResults {
  return {
    executiveSummary: "Café owners agree — résumé ready; costs are €20. “Evidence” stays exact [E1].",
    findings: [{ category: "DELIVERY", severity: "HIGH", title: "Owner confirmed", description: "Zoë owns launch readiness [E1].", sources: "E1 · E2" }],
    marketContext: [{ title: "Public benchmark", body: "The public report is evidence, not accepted truth [W1]." }],
    expansionOpportunities: ["Evaluate the façade design [E2]."],
    recommendedActions: [{ priority: "THIS WEEK", action: "Review the launch gate", source: "E1 · W1" }],
    sources: [
      { provider: "docs", ref: "E1", refs: ["E1", "E2"], kind: "internal", label: "Launch PRD", href: "/memory/docs/launch/view" },
      { provider: "web", ref: "W1", kind: "web", label: "Public source", href: "https://example.com/report?q=complete&version=2#evidence" }
    ],
    stats: { totalSources: 2, docs: 1, slackMessages: 0, commits: 0, webSources: 1, duration: "20s" },
    ...overrides
  };
}

async function extract(buffer: Buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    return await parser.getText({ pageJoiner: "" });
  } finally {
    await parser.destroy();
  }
}

afterEach(() => vi.restoreAllMocks());

describe("Deep Research PDF export", () => {
  it("exports real PDF bytes with supported Unicode, all sections, evidence aliases and complete URLs", async () => {
    const results = deepResearchResultsSchema.parse(report());
    const original = JSON.stringify(results);
    const buffer = await renderReportPdf("Café launch — Q4", results);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    const extracted = await extract(buffer);
    const text = compact(extracted.text);
    for (const expected of [
      "Deep Research — Café launch — Q4",
      "Analyzed 2 sources · 0 messages · 0 commits · 1 docs · 1 web sources · 20s",
      "Executive summary", results.executiveSummary,
      "Critical findings", "[HIGH] DELIVERY — Owner confirmed", results.findings[0]!.description, "Evidence: E1 · E2",
      "Domain & market context", results.marketContext[0]!.title, results.marketContext[0]!.body,
      "Expansion opportunities", `• ${results.expansionOpportunities[0]}`,
      "Recommended actions", "THIS WEEK — Review the launch gate", "Evidence: E1 · W1",
      "Sources", "E1 · E2 — Launch PRD — docs", "W1 — Public source — web",
      ...results.sources.map(source => source.href)
    ]) expect(text).toContain(compact(expected));
    expect(JSON.stringify(results)).toBe(original);
  });

  it("preserves every field of a maximum-sized valid report across many pages, including the summary tail", async () => {
    const fit = (prefix: string, length: number, tail: string) => (prefix + "Evidence remains attributable. ".repeat(length)).slice(0, length - tail.length) + tail;
    const results = deepResearchResultsSchema.parse(report({
      executiveSummary: fit("SUMMARY_START ", 4000, " SUMMARY_FINAL_SENTENCE [E1]."),
      findings: Array.from({ length: 12 }, (_, index) => ({
        category: `CATEGORY_${index}`, severity: "HIGH" as const, title: `FINDING_${index}`,
        description: fit(`DESCRIPTION_${index} `, 2000, ` END_FINDING_${index} [E${index + 1}].`), sources: `E${index + 1}`
      })),
      marketContext: Array.from({ length: 8 }, (_, index) => ({ title: `MARKET_${index}`, body: fit(`CONTEXT_${index} `, 1200, ` END_MARKET_${index} [W1].`) })),
      expansionOpportunities: Array.from({ length: 8 }, (_, index) => fit(`EXPANSION_${index} `, 600, ` END_EXPANSION_${index} [E1].`)),
      recommendedActions: Array.from({ length: 12 }, (_, index) => ({ priority: "THIS SPRINT" as const, action: fit(`ACTION_${index} `, 400, ` END_ACTION_${index}.`), source: `E${index + 1}` })),
      sources: Array.from({ length: 64 }, (_, index) => ({
        provider: "docs", ref: `E${index + 1}`, refs: [`E${index + 1}`, `E${index + 101}`], kind: "web" as const, label: `SOURCE_${index}`,
        href: `https://example.com/${index}/${"AV".repeat(970)}?tail=${index}`
      }))
    }));
    const buffer = await renderReportPdf("Maximum report", results);
    const extracted = await extract(buffer);
    expect(extracted.total).toBeGreaterThan(20);
    const text = compact(extracted.text);
    expect(text).toContain(compact(results.executiveSummary));
    for (const finding of results.findings) {
      expect(text).toContain(compact(`[${finding.severity}] ${finding.category} — ${finding.title}`));
      expect(text).toContain(compact(finding.description));
      expect(text).toContain(compact(`Evidence: ${finding.sources}`));
    }
    for (const market of results.marketContext) {
      expect(text).toContain(compact(market.title));
      expect(text).toContain(compact(market.body));
    }
    for (const opportunity of results.expansionOpportunities) expect(text).toContain(compact(opportunity));
    for (const action of results.recommendedActions) {
      expect(text).toContain(compact(action.action));
      expect(text).toContain(compact(`Evidence: ${action.source}`));
    }
    for (const source of results.sources) {
      expect(text).toContain(compact(`${source.refs!.join(" · ")} — ${source.label} — ${source.provider}`));
      expect(text).toContain(source.href);
    }
    expect(extracted.pages.at(-1)!.text).toContain("?tail=63");
  }, 20_000);

  it("wraps an exceptionally long unbroken URL without dropping its tail or overflowing the page", async () => {
    // Deliberately exceeds today's stored href limit to exercise the renderer's
    // splitting algorithm independently of validation at the service boundary.
    const href = `https://example.com/${"AV".repeat(12_000)}?tail=unique-final-marker`;
    const draw = vi.spyOn(PDFPage.prototype, "drawText");
    const buffer = await renderReportPdf("URL wrapping", report({ sources: [{ provider: "web", kind: "web", label: "Huge URL", ref: "W1", href }] }));
    const extracted = await extract(buffer);
    expect(extracted.total).toBeGreaterThan(5);
    expect(compact(extracted.text)).toContain(href);
    for (const [line, options] of draw.mock.calls) {
      expect(options!.x).toBe(50);
      expect(options!.y).toBeGreaterThanOrEqual(50);
      expect(options!.y).toBeLessThanOrEqual(742);
      const advance = Array.from(line).reduce((sum, character) => sum + options!.font!.widthOfTextAtSize(character, options!.size!), 0);
      expect(advance).toBeLessThanOrEqual(512 + 1e-7);
    }
  });

  it("retains Letter pages, Helvetica, the existing typography sizes and colours", async () => {
    const draw = vi.spyOn(PDFPage.prototype, "drawText");
    const buffer = await renderReportPdf("Style contract", report());
    const pdf = await PDFDocument.load(buffer);
    for (const page of pdf.getPages()) expect(page.getSize()).toEqual({ width: 612, height: 792 });
    expect(new Set(draw.mock.calls.map(([, options]) => options!.size))).toEqual(new Set([18, 13, 11, 10.5, 9]));
    for (const [, options] of draw.mock.calls) expect(options!.font!.name).toBe("Helvetica");
    expect(draw.mock.calls.find(([line]) => line === "Executive summary")![1]!.color).toMatchObject({ red: 0xc8 / 255, green: 0x4a / 255, blue: 0x1f / 255 });
    expect(draw.mock.calls.find(([line]) => line.startsWith("Analyzed"))![1]!.color).toMatchObject({ red: 0x8a / 255, green: 0x83 / 255, blue: 0x78 / 255 });
    expect(draw.mock.calls[0]![1]!.color).toMatchObject({ red: 0x1a / 255, green: 0x17 / 255, blue: 0x14 / 255 });
  });

  it("preserves explicit paragraph breaks and the legacy empty-summary behaviour", async () => {
    const breaks = await extract(await renderReportPdf("Paragraphs", report({ executiveSummary: "First paragraph\r\n\r\nSecond paragraph\rThird paragraph\nFinal paragraph." })));
    expect(breaks.text).toMatch(/First paragraph\s+Second paragraph\s+Third paragraph\s+Final paragraph\./);
    const empty = await extract(await renderReportPdf("Empty summary", report({ executiveSummary: "", findings: [], marketContext: [], expansionOpportunities: [], recommendedActions: [], sources: [] })));
    expect(empty.text).toContain("No summary.");
    expect(empty.text).not.toContain("Critical findings");
  });

  it.each(["漢字", "தமிழ்", "😀", "Ω", "e\u0301", "\u0008", "\u000b", "\t", "\u200b", "\ud800"])(
    "rejects unsupported text explicitly without substitution or leaking report content (%j)", async (unsupported) => {
      const original = `private-marker ${unsupported} end-marker`;
      const result = await renderReportPdf("Encoding safety", report({ executiveSummary: original })).catch(error => toAppError(error));
      expect(result).toMatchObject({ statusCode: 422, code: "report_pdf_unsupported_characters", details: undefined });
      expect((result as Error).message).toContain("Download Markdown");
      expect((result as Error).message).not.toContain("private-marker");
      expect(renderReportMarkdown("Encoding safety", report({ executiveSummary: original }))).toContain(original);
    }
  );

  it.each([
    ["focus", (result: DeepResearchResults) => result, "漢字"],
    ["finding category", (result: DeepResearchResults) => { result.findings[0]!.category = "漢字"; return result; }],
    ["finding title", (result: DeepResearchResults) => { result.findings[0]!.title = "漢字"; return result; }],
    ["finding description", (result: DeepResearchResults) => { result.findings[0]!.description = "漢字"; return result; }],
    ["finding evidence", (result: DeepResearchResults) => { result.findings[0]!.sources = "漢字"; return result; }],
    ["market title", (result: DeepResearchResults) => { result.marketContext[0]!.title = "漢字"; return result; }],
    ["market body", (result: DeepResearchResults) => { result.marketContext[0]!.body = "漢字"; return result; }],
    ["opportunity", (result: DeepResearchResults) => { result.expansionOpportunities[0] = "漢字"; return result; }],
    ["action", (result: DeepResearchResults) => { result.recommendedActions[0]!.action = "漢字"; return result; }],
    ["action evidence", (result: DeepResearchResults) => { result.recommendedActions[0]!.source = "漢字"; return result; }],
    ["source label", (result: DeepResearchResults) => { result.sources[0]!.label = "漢字"; return result; }],
    ["source provider", (result: DeepResearchResults) => { result.sources[0]!.provider = "漢字"; return result; }],
    ["source URL", (result: DeepResearchResults) => { result.sources[0]!.href = "https://example.com/漢字"; return result; }],
    ["duration", (result: DeepResearchResults) => { result.stats.duration = "漢字"; return result; }]
  ] as const)("validates unsupported characters in %s before drawing any report", async (_name, change, focus: string = "Field safety") => {
    const draw = vi.spyOn(PDFPage.prototype, "drawText");
    await expect(renderReportPdf(focus, change(report()))).rejects.toMatchObject({ statusCode: 422, code: "report_pdf_unsupported_characters" });
    expect(draw).not.toHaveBeenCalled();
  });
});
