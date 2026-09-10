import { describe, expect, it } from "vitest";
import { compressEvidencePack } from "../src/lib/retrieval/evidence-pack.js";
import type { RetrievalCandidate } from "../src/lib/retrieval/types.js";

function candidate(overrides: Partial<RetrievalCandidate>): RetrievalCandidate {
  return {
    id: overrides.id ?? "c1",
    sourceType: overrides.sourceType ?? "document_chunk",
    content: overrides.content ?? "x".repeat(2000),
    label: overrides.label ?? "Evidence",
    finalScore: overrides.finalScore ?? 1,
    isClientSafe: overrides.isClientSafe ?? true,
    isInternalOnly: overrides.isInternalOnly ?? false,
    ...overrides
  };
}

const budget = {
  maxContextTokens: 4000,
  maxHistoryTurns: 8,
  maxEvidenceItems: 8,
  maxEvidenceExcerptChars: 120,
  maxSameSourceItems: 2,
  maxOutputTokens: 900
};

describe("evidence pack compressor", () => {
  it("creates compact deterministic cards with trace, citation, and open target", () => {
    const pack = compressEvidencePack({
      candidates: [
        candidate({
          id: "chunk_1",
          documentChunkId: "chunk_1",
          documentSectionId: "sec_1",
          citationRef: { type: "document_chunk", id: "chunk_1", label: "PRD" },
          openTarget: { targetType: "document_section", targetRef: { anchorId: "a1" } },
          whySelected: "exact lexical match"
        })
      ],
      intent: "original_source",
      userQuery: "Where was it first mentioned?",
      recentHistory: [],
      budget
    });

    expect(pack.evidenceCards).toHaveLength(1);
    expect(pack.evidenceCards[0].excerpt.length).toBeLessThanOrEqual(123);
    expect(pack.evidenceCards[0].trace.documentChunkId).toBe("chunk_1");
    expect(pack.evidenceCards[0].citationRef?.id).toBe("chunk_1");
    expect(pack.citationCandidateIds).toContain("chunk_1");
  });

  it("enforces same-source diversity while preserving selected evidence", () => {
    const pack = compressEvidencePack({
      candidates: [
        candidate({ id: "selected", containerId: "doc", documentSectionId: "sec_selected", finalScore: 0.1 }),
        candidate({ id: "doc_1", containerId: "doc", finalScore: 1 }),
        candidate({ id: "doc_2", containerId: "doc", finalScore: 0.9 }),
        candidate({ id: "doc_3", containerId: "doc", finalScore: 0.8 }),
        candidate({ id: "other", containerId: "other", finalScore: 0.7 })
      ],
      intent: "doc_local",
      userQuery: "Explain this section",
      recentHistory: [],
      selectedSectionId: "sec_selected",
      budget: { ...budget, maxSameSourceItems: 2 }
    });

    expect(pack.candidates[0].id).toBe("selected");
    expect(pack.telemetry.preservedSelectedEvidenceCount).toBe(1);
    expect(pack.telemetry.droppedForSourceDiversityCount).toBeGreaterThan(0);
  });

  it("strips internal trace fields from client packs", () => {
    const pack = compressEvidencePack({
      candidates: [
        candidate({
          id: "safe",
          domain: "client_safe_documents",
          documentSectionId: "sec_1",
          messageId: "msg_internal",
          threadId: "thr_internal",
          changeProposalId: "proposal_internal",
          isClientSafe: true,
          isInternalOnly: false
        })
      ],
      intent: "current_truth",
      userQuery: "What can the client see?",
      recentHistory: [],
      isClientContext: true,
      budget
    });

    expect(pack.evidenceCards[0].trace.messageId).toBeUndefined();
    expect(pack.evidenceCards[0].trace.threadId).toBeUndefined();
    expect(pack.evidenceCards[0].trace.changeProposalId).toBeUndefined();
  });
});
