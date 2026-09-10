import { describe, expect, it } from "vitest";
import { buildSocratesEvidencePack, estimateTokens } from "../src/modules/socrates/evidence.js";
import type { RetrievalCandidate } from "../src/lib/retrieval/types.js";

function candidate(overrides: Partial<RetrievalCandidate>): RetrievalCandidate {
  return {
    id: overrides.id ?? "candidate-1",
    sourceType: overrides.sourceType ?? "document_chunk",
    content: overrides.content ?? "short evidence",
    label: overrides.label ?? "Evidence",
    finalScore: overrides.finalScore ?? 1,
    isClientSafe: overrides.isClientSafe ?? true,
    isInternalOnly: overrides.isInternalOnly ?? false,
    ...overrides,
  };
}

describe("Socrates evidence packing", () => {
  it("caps evidence to the configured token budget", () => {
    const candidates = Array.from({ length: 8 }, (_, index) =>
      candidate({
        id: `candidate-${index}`,
        content: "x".repeat(1600),
        contextualContent: "context ".repeat(300),
      })
    );

    const pack = buildSocratesEvidencePack({
      candidates,
      userQuery: "What is the current truth?",
      recentHistory: [],
      budget: {
        maxContextTokens: 1400,
        maxHistoryTurns: 8,
        rerankTopK: 8,
      },
    });

    expect(pack.candidates.length).toBeGreaterThan(0);
    expect(pack.candidates.length).toBeLessThan(candidates.length);
    expect(pack.telemetry.budgetTruncated).toBe(true);
    expect(pack.telemetry.estimatedInputTokens).toBeLessThanOrEqual(1400);
  });

  it("preserves selected-object evidence before other candidates during truncation", () => {
    const selected = candidate({
      id: "selected-chunk",
      documentSectionId: "selected-section",
      content: "selected evidence ".repeat(80),
    });
    const others = Array.from({ length: 5 }, (_, index) =>
      candidate({ id: `other-${index}`, content: "other evidence ".repeat(120) })
    );

    const pack = buildSocratesEvidencePack({
      candidates: [...others, selected],
      userQuery: "Explain this section",
      recentHistory: [{ role: "user", content: "Earlier question ".repeat(60) }],
      selectedSectionId: "selected-section",
      budget: {
        maxContextTokens: 1300,
        maxHistoryTurns: 8,
        rerankTopK: 6,
      },
    });

    expect(pack.candidates[0].id).toBe("selected-chunk");
  });

  it("caps repeated evidence from the same source when diverse candidates exist", () => {
    const sameDocument = Array.from({ length: 5 }, (_, index) =>
      candidate({
        id: `same-doc-${index}`,
        containerId: "doc-1",
        sourceType: "document_chunk",
        content: `same document evidence ${index}`,
      })
    );
    const otherDocument = candidate({
      id: "other-doc",
      containerId: "doc-2",
      sourceType: "document_chunk",
      content: "other document evidence",
    });

    const pack = buildSocratesEvidencePack({
      candidates: [...sameDocument, otherDocument],
      userQuery: "Compare the evidence",
      recentHistory: [],
      budget: {
        maxContextTokens: 5000,
        maxHistoryTurns: 8,
        rerankTopK: 6,
      },
    });

    expect(pack.candidates.filter((item) => item.containerId === "doc-1")).toHaveLength(2);
    expect(pack.candidates.some((item) => item.id === "other-doc")).toBe(true);
  });

  it("does not diversity-drop evidence when only one source is available", () => {
    const sameDocument = Array.from({ length: 4 }, (_, index) =>
      candidate({
        id: `only-doc-${index}`,
        containerId: "doc-1",
        sourceType: "document_chunk",
        content: `only document evidence ${index}`,
      })
    );

    const pack = buildSocratesEvidencePack({
      candidates: sameDocument,
      userQuery: "Explain the only available document evidence",
      recentHistory: [],
      budget: {
        maxContextTokens: 5000,
        maxHistoryTurns: 8,
        rerankTopK: 4,
      },
    });

    expect(pack.candidates).toHaveLength(4);
  });

  it("estimates non-empty token counts defensively", () => {
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});
