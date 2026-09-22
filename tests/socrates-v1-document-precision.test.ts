import { describe, expect, it, vi } from "vitest";
import { SocratesService } from "../src/modules/socrates/service.js";

function chunk(id: string, text: string) {
  return { id, documentVersionId: `version-${id}`, content: text, lexicalContent: text,
    section: { headingPath: ["Operating detail"] },
    documentVersion: { document: { id: `document-${id}`, title: `Operating memo ${id}` } } };
}
function documentRetrieval(relevant: ReturnType<typeof chunk>, filler: ReturnType<typeof chunk>[], named = false) {
  const instance = Object.create(SocratesService.prototype) as any;
  instance.env = { OPENAI_EMBEDDING_MODEL: "mock" };
  instance.prisma = { documentChunk: { findMany: vi.fn(async ({ where }) =>
    [relevant, ...filler].filter((row) => where.id.in.includes(row.id))) } };
  instance.findSocratesV1ExplicitDocumentScope = vi.fn(async () => named
    ? [{ id: relevant.documentVersion.document.id, title: "Control Handbook" }] : []);
  instance.cachedV1Evidence = vi.fn(async () => filler);
  instance.findSocratesV1DocumentEvidenceIds = vi.fn(async () => [relevant.id]);
  instance.enrichSocratesV1DocumentRows = vi.fn(async (_project: string, rows: unknown[]) => rows);
  instance.isCurrentParsedChunk = () => true;
  return instance;
}

describe("Socrates v1 document topical admission", () => {
  it("does not let query scaffolding admit recent passages with no topic overlap", async () => {
    const relevant = chunk("routing", "Handover routing requires acknowledgement from the dispatch owner.");
    const filler = Array.from({ length: 12 }, (_, i) => chunk(`finance-${i}`, "The finance team files the daily receipt checks in the documents archive."));
    const result = await documentRetrieval(relevant, filler).findSocratesV1DocumentEvidence("project", "Find the handover routing evidence in the project documents.");
    expect(result.map((row: any) => row.id)).toEqual([relevant.id]);
  });

  it("keeps relevant common-word domain questions without requiring a proper noun", async () => {
    const relevant = chunk("invoice", "Invoice reconciliation connects receipts, adjustments and settlement entries.");
    const filler = [chunk("devices", "The equipment team schedules the annual inspection.")];
    const result = await documentRetrieval(relevant, filler).findSocratesV1DocumentEvidence("project", "What is the invoice reconciliation process?");
    expect(result.map((row: any) => row.id)).toEqual([relevant.id]);
  });

  it("keeps authoritative English stem matches while excluding unrelated recent fillers", async () => {
    const relevant = chunk("policy", "The policy controls invoice approvals.");
    const filler = [chunk("devices", "The equipment team schedules the annual inspection.")];
    const result = await documentRetrieval(relevant, filler).findSocratesV1DocumentEvidence("project", "Find the policies in the project documents.", false);
    expect(result.map((row: any) => row.id)).toEqual([relevant.id]);
  });

  it("retains explicit document scope and excludes the recent fallback for named requests", async () => {
    const relevant = chunk("control", "Control Handbook: handover routing requires the dispatch owner.");
    const instance = documentRetrieval(relevant, [chunk("other", "Handover routing elsewhere.")], true);
    const result = await instance.findSocratesV1DocumentEvidence("project", "In Control Handbook only, find the handover routing evidence.");
    expect(result.map((row: any) => row.id)).toEqual([relevant.id]);
    expect(instance.findSocratesV1DocumentEvidenceIds).toHaveBeenCalledWith("project", expect.any(String), [relevant.documentVersion.document.id]);
    expect(instance.cachedV1Evidence).not.toHaveBeenCalled();
  });

  it("keeps broad document summaries even without a shared narrow topic", async () => {
    const relevant = chunk("finance", "Invoice reconciliation connects settlement entries.");
    const other = chunk("equipment", "Annual equipment inspections require signoff.");
    const result = await documentRetrieval(relevant, [other]).findSocratesV1DocumentEvidence("project", "Summarize project documents.");
    expect(result.map((row: any) => row.id)).toEqual([relevant.id, other.id]);
  });

  it("preserves a legitimate list request when scaffold removal leaves no lexical terms", async () => {
    const first = chunk("finance", "Invoice reconciliation connects settlement entries.");
    const second = chunk("equipment", "Annual equipment inspections require signoff.");
    const result = await documentRetrieval(first, [second]).findSocratesV1DocumentEvidence("project", "Show project documents.");
    expect(result.map((row: any) => row.id)).toEqual([first.id, second.id]);
  });

  it.each(["What is this project and what evidence supports it?", "What is the latest current state?"])("retains broad overview evidence for %s", async (question) => {
    const first = chunk("backend", "The backend exposes authenticated application routes.");
    const second = chunk("requirements", "Users can export accepted rows.");
    const result = await documentRetrieval(first, [second]).findSocratesV1DocumentEvidence("project", question);
    expect(result.map((row: any) => row.id)).toEqual([first.id, second.id]);
  });

  it("does not classify a possessive project topic as an unrestricted overview", async () => {
    const relevant = chunk("routing", "Handover routing requires dispatch acknowledgement.");
    const result = await documentRetrieval(relevant, [chunk("finance", "The finance team maintains the documents archive.")])
      .findSocratesV1DocumentEvidence("project", "What is this project's handover routing?");
    expect(result.map((row: any) => row.id)).toEqual([relevant.id]);
  });
});
