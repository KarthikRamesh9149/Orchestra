import { describe, expect, it } from "vitest";
import { buildDeepResearchEvidencePack } from "../src/modules/deep-research/evidence.js";
import { collectExplicitDeepResearchSourceCards } from "../src/modules/deep-research/service.js";

describe("Deep Research evidence coverage", () => {
  it("loads current chunks of an explicitly named document independently of summary retrieval", async () => {
    const prisma = {
      document: { findMany: async (args: any) => {
        expect(args.where).toMatchObject({ projectId: "project", archivedAt: null });
        return [{ id: "doc", title: "Northstar-Launch-PRD", currentVersionId: "version" }];
      } },
      documentChunk: { findMany: async (args: any) => {
        expect(args.where).toMatchObject({ projectId: "project", documentVersionId: { in: ["version"] } });
        const row = { id: "chunk", content: "CSV fields: item_id, title, owner, status.", parseRevision: 2,
          documentVersionId: "version", documentVersion: { parseRevision: 2, document: { id: "doc", title: "Northstar-Launch-PRD" } },
          section: { anchorId: "requirements" } };
        return [row, { ...row, id: "stale", parseRevision: 1 }];
      } }
    };
    const cards = await collectExplicitDeepResearchSourceCards(prisma as any, {} as any, "project",
      "Audit Northstar-Launch-PRD launch readiness", new Set(["docs"]));
    expect(cards).toHaveLength(1);
    expect(cards[0].excerpt).toContain("item_id, title, owner, status");
    expect(cards[0].openTarget?.targetRef).toMatchObject({ documentId: "doc", anchorId: "requirements" });
    expect(await collectExplicitDeepResearchSourceCards(prisma as any, {} as any, "project", "Audit another PRD", new Set(["docs"]))).toEqual([]);
  });
  it("does not replace source text with a short contextual retrieval summary", () => {
    const content = "CSV fields: item_id, title, owner, status. Empty projects return column headers without invented rows.";
    const pack = buildDeepResearchEvidencePack({
      candidates: [{ id: "source", sourceType: "document_chunk", domain: "document_chunks",
        content, contextualContent: "Northstar PRD. Introduction. Synthetic demo.", label: "Northstar PRD", score: 1,
        sourcePrecedence: "source_evidence" } as any],
      userQuery: "Audit CSV fields and empty-project behavior", recentHistory: [],
      budget: { maxContextTokens: 12000, maxHistoryTurns: 0, rerankTopK: 8, maxEvidenceItems: 8 }
    });
    expect(pack.evidenceCards[0].excerpt).toContain(content);
  });
  it("retains owners beyond the interactive chat excerpt boundary", () => {
    const content = "PRD introduction. ".repeat(60) + "Product Lead: Maya Reddy. Backend Lead: Devraj Patel. Non-goals: no provider writes.";
    const pack = buildDeepResearchEvidencePack({
      candidates: [{ id: "chunk", sourceType: "document_chunk", domain: "document_chunks", content, label: "Delivery PRD", score: 1, sourcePrecedence: "supporting_context" } as any],
      userQuery: "Identify the Product Lead, Backend Lead and non-goals in Delivery PRD", recentHistory: [],
      budget: { maxContextTokens: 12000, maxHistoryTurns: 0, rerankTopK: 8, maxEvidenceExcerptChars: 900, maxEvidenceItems: 8 }
    });
    expect(pack.evidenceCards[0].excerpt).toContain("Maya Reddy");
    expect(pack.evidenceCards[0].excerpt).toContain("Devraj Patel");
  });
  it("still bounds large evidence excerpts", () => {
    const pack = buildDeepResearchEvidencePack({
      candidates: [{ id: "chunk", sourceType: "document_chunk", domain: "document_chunks", content: "x".repeat(10000), label: "PRD", score: 1 } as any],
      userQuery: "Review PRD", recentHistory: [],
      budget: { maxContextTokens: 12000, maxHistoryTurns: 0, rerankTopK: 8, maxEvidenceExcerptChars: 900 }
    });
    expect(pack.evidenceCards[0].excerpt.length).toBeLessThanOrEqual(4000);
  });
});
