import { describe, expect, it } from "vitest";
import { evaluateRetrievalConfidence } from "../src/modules/socrates/retrieval-confidence.js";
import type { EvidenceCard } from "../src/lib/retrieval/evidence-pack.js";

const card = (sourceType: string, confidence = 0.8): EvidenceCard => ({
  evidenceId: `ev_${sourceType}`,
  sourceType,
  title: sourceType,
  excerpt: "Evidence",
  whySelected: "Selected",
  confidence,
  sourcePrecedence: "source_evidence",
  citationRef: { type: sourceType === "product_brain" ? "product_brain" : "document_section", id: "11111111-1111-1111-1111-111111111111" },
  trace: {},
});

describe("evaluateRetrievalConfidence", () => {
  it("bypasses model generation when no evidence exists", () => {
    const result = evaluateRetrievalConfidence({
      intent: "no_evidence_or_ambiguous",
      evidenceCards: [],
      validatedCitationCount: 0,
      validatedOpenTargetCount: 0,
      selectedObjectWasRequested: false,
      selectedObjectWasFound: false,
      budgetTruncated: false,
    });

    expect(result.confidence).toBe("low");
    expect(result.shouldBypassModel).toBe(true);
    expect(result.limitations).toContain("No final evidence cards were available.");
    expect(result.limitations).toContain("No backend-validated citations were available.");
  });

  it("marks current-truth answers low when accepted truth evidence is missing", () => {
    const result = evaluateRetrievalConfidence({
      intent: "current_truth",
      evidenceCards: [card("document_section", 0.9)],
      validatedCitationCount: 1,
      validatedOpenTargetCount: 1,
      selectedObjectWasRequested: false,
      selectedObjectWasFound: false,
      budgetTruncated: false,
    });

    expect(result.confidence).toBe("low");
    expect(result.shouldBypassModel).toBe(true);
    expect(result.limitations).toContain("No accepted Product Brain, accepted change, or accepted decision evidence was retrieved.");
  });

  it("marks provenance answers low when original source evidence is missing", () => {
    const result = evaluateRetrievalConfidence({
      intent: "original_source",
      evidenceCards: [card("product_brain", 0.9)],
      validatedCitationCount: 1,
      validatedOpenTargetCount: 1,
      selectedObjectWasRequested: false,
      selectedObjectWasFound: false,
      budgetTruncated: false,
    });

    expect(result.confidence).toBe("low");
    expect(result.shouldBypassModel).toBe(true);
    expect(result.limitations).toContain("No original document or communication source evidence was retrieved.");
  });

  it("allows model generation when required evidence and citations are present", () => {
    const result = evaluateRetrievalConfidence({
      intent: "current_truth",
      evidenceCards: [card("product_brain", 0.86), card("document_section", 0.75)],
      validatedCitationCount: 2,
      validatedOpenTargetCount: 1,
      selectedObjectWasRequested: false,
      selectedObjectWasFound: false,
      budgetTruncated: false,
    });

    expect(result.confidence).toBe("high");
    expect(result.shouldBypassModel).toBe(false);
  });
});
