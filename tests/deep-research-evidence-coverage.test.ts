import { describe, expect, it } from "vitest";
import { buildDeepResearchEvidencePack } from "../src/modules/deep-research/evidence.js";

describe("Deep Research evidence coverage", () => {
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
