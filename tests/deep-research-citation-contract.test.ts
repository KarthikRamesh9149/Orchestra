import { describe, expect, it } from "vitest";
import { groundDeepResearchOutput, assertDeepResearchRetrievalAvailable } from "../src/modules/deep-research/service.js";
import { DEEP_RESEARCH_SYSTEM_PROMPT, buildDeepResearchUserPrompt } from "../src/modules/deep-research/prompts.js";

const card = { evidenceId: "ev_1", title: "Delivery PRD", sourceType: "document_chunk", excerpt: "Product Lead: Maya. Backend Lead: Dev.", citationRef: { type: "document_chunk", id: "chunk-1" } } as any;
const report = { executiveSummary: "Maya is Product Lead.", findings: [{ category: "PROJECT FACT", severity: "MEDIUM" as const, title: "Owner", description: "Maya is Product Lead.", sources: "Delivery PRD" }], recommendedActions: [], marketContext: [], expansionOpportunities: [] };

describe("Deep Research citation contract", () => {
  it("does not present failed retrieval branches as a successful empty search", () => {
    expect(() => assertDeepResearchRetrievalAvailable({ candidates: [], telemetry: { retrievalBranchFailureCount: 1 } })).toThrow(/retrieval/i);
    expect(() => assertDeepResearchRetrievalAvailable({ candidates: [], telemetry: { retrievalBranchFailureCount: 0 } })).not.toThrow();
  });
  it("resolves the exact unambiguous titles the prior prompt explicitly allowed", () => {
    expect(groundDeepResearchOutput(report, [card], []).findings[0]?.sources).toBe("E1");
  });
  it("never guesses ambiguous titles or unknown references", () => {
    expect(groundDeepResearchOutput(report, [card, { ...card, evidenceId: "ev_2" }], []).findings).toEqual([]);
    expect(groundDeepResearchOutput({ ...report, findings: [{ ...report.findings[0], sources: "Other PRD" }] }, [card], []).findings).toEqual([]);
  });
  it("preserves a citation-backed executive answer without manufactured risks or actions", () => {
    const output = { ...report, executiveSummary: "Maya is Product Lead [E1].", findings: [] };
    expect(groundDeepResearchOutput(output, [card], []).executiveSummary).toBe(output.executiveSummary);
  });
  it("requests the same E/W identifiers the verifier consumes", () => {
    const prompt = buildDeepResearchUserPrompt({ researchFocus: "Who owns delivery?", outputFormat: "exec_summary", sources: ["docs"], evidenceCards: [card], webResults: [] });
    expect(DEEP_RESEARCH_SYSTEM_PROMPT).toContain("E1");
    expect(prompt).toContain('"sources": "E1"');
    expect(prompt).not.toContain("cite by title/ref");
  });
});
