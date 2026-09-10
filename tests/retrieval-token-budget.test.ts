import { describe, expect, it } from "vitest";
import { compressEvidencePack } from "../src/lib/retrieval/evidence-pack.js";
import type { RetrievalCandidate, RetrievalIntent } from "../src/lib/retrieval/types.js";

function candidate(id: string, overrides: Partial<RetrievalCandidate> = {}): RetrievalCandidate {
  return {
    id,
    sourceType: overrides.sourceType ?? "document_chunk",
    content: overrides.content ?? `Evidence ${id} ${"x".repeat(600)}`,
    label: overrides.label ?? `Evidence ${id}`,
    finalScore: overrides.finalScore ?? 1,
    isClientSafe: overrides.isClientSafe ?? true,
    isInternalOnly: overrides.isInternalOnly ?? false,
    containerId: overrides.containerId ?? id,
    ...overrides,
  };
}

const budget = {
  maxContextTokens: 8000,
  maxHistoryTurns: 8,
  maxEvidenceItems: 20,
  maxEvidenceExcerptChars: 160,
  maxSameSourceItems: 2,
  maxOutputTokens: 900,
};

describe("retrieval token budgets", () => {
  it.each([
    ["dashboard_status", 5],
    ["current_truth", 8],
    ["original_source", 10],
    ["communication_lookup", 10],
    ["change_history", 12],
    ["comparison_or_diff", 12],
    ["no_evidence_or_ambiguous", 4],
  ] as Array<[RetrievalIntent, number]>)("caps %s evidence to the intent limit", (intent, limit) => {
    const pack = compressEvidencePack({
      candidates: Array.from({ length: 20 }, (_, index) => candidate(`c${index}`, { containerId: `src${index}` })),
      intent,
      userQuery: "What should Socrates use?",
      recentHistory: Array.from({ length: 12 }, (_, index) => ({ role: "user" as const, content: `history ${index}` })),
      budget,
    });

    expect(pack.evidenceCards.length).toBeLessThanOrEqual(limit);
    expect(pack.telemetry.finalEvidenceCount).toBe(pack.evidenceCards.length);
    expect(pack.telemetry.estimatedInputTokens).toBeLessThanOrEqual(budget.maxContextTokens);
  });

  it("does not include raw full Product Brain JSON in compact evidence cards", () => {
    const rawPayload = JSON.stringify({
      whatTheProductIs: "A product brain",
      modules: Array.from({ length: 80 }, (_, index) => ({ id: index, text: "raw module payload" })),
      sourceRefsJson: { messageIds: ["internal-message"], providerPermalink: "https://provider.example/raw" },
    });

    const pack = compressEvidencePack({
      candidates: [
        candidate("brain", {
          sourceType: "product_brain",
          domain: "product_brain",
          content: rawPayload,
          artifactVersionId: "brain-version",
          citationRef: { type: "product_brain", id: "brain-version" },
        }),
      ],
      intent: "current_truth",
      userQuery: "What is current?",
      recentHistory: [],
      budget: { ...budget, maxEvidenceExcerptChars: 120 },
    });

    expect(pack.evidenceCards[0].excerpt.length).toBeLessThanOrEqual(123);
    expect(pack.evidenceCards[0].excerpt).not.toContain("internal-message");
    expect(pack.evidenceCards[0].excerpt).not.toContain("provider.example/raw");
    expect(pack.citationCandidateIds).toContain("brain-version");
  });
});
