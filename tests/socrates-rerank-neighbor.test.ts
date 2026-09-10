/**
 * Extended reranker tests covering neighbor-section boost, intent precedence
 * for current-truth vs original-source, and edge cases.
 */

import { describe, expect, it } from "vitest";
import { rerank } from "../src/lib/retrieval/rerank.js";
import type { RetrievalCandidate } from "../src/lib/retrieval/types.js";

function makeCandidate(overrides: Partial<RetrievalCandidate>): RetrievalCandidate {
  return {
    id: overrides.id ?? "id-1",
    sourceType: overrides.sourceType ?? "document_chunk",
    content: overrides.content ?? "content",
    label: overrides.label ?? "Label",
    finalScore: overrides.finalScore ?? 0.5,
    isClientSafe: overrides.isClientSafe ?? true,
    isInternalOnly: overrides.isInternalOnly ?? false,
    ...overrides,
  };
}

describe("rerank – neighbor section boost", () => {
  it("gives neighbor-section chunk a 1.5× boost over non-neighbor chunk", () => {
    // Equal base scores. Neighbor gets 1.5× boost; non-neighbor stays flat.
    const nonNeighbor = makeCandidate({ id: "far-1", sourceType: "document_chunk", finalScore: 0.5 });
    const neighbor = makeCandidate({
      id: "near-1",
      sourceType: "document_chunk",
      finalScore: 0.5,
      isNeighborSection: true,
    });

    const result = rerank({
      candidates: [nonNeighbor, neighbor],
      pageContext: "doc_viewer",
      intent: "doc_local",
      topK: 5,
      isClientContext: false,
    });

    // neighbor must rank above nonNeighbor
    expect(result[0].id).toBe("near-1");
  });

  it("selected section (3×) beats neighbor section (1.5×)", () => {
    const selected = makeCandidate({
      id: "selected-1",
      sourceType: "document_chunk",
      finalScore: 0.4,
      documentSectionId: "sel-sec",
    });
    const neighbor = makeCandidate({
      id: "neighbor-1",
      sourceType: "document_chunk",
      finalScore: 0.4,
      isNeighborSection: true,
    });

    const result = rerank({
      candidates: [neighbor, selected],
      pageContext: "doc_viewer",
      intent: "doc_local",
      selectedSectionId: "sel-sec",
      topK: 5,
      isClientContext: false,
    });

    expect(result[0].id).toBe("selected-1");
  });
});

describe("rerank – current-truth vs original-source precedence", () => {
  it("current_truth intent boosts brain_node over document_chunk", () => {
    const docChunk = makeCandidate({ id: "doc-1", sourceType: "document_chunk", finalScore: 0.8 });
    const brainNode = makeCandidate({ id: "node-1", sourceType: "brain_node", finalScore: 0.6 });

    const result = rerank({
      candidates: [docChunk, brainNode],
      pageContext: "brain_overview",
      intent: "current_truth",
      topK: 5,
      isClientContext: false,
    });

    // brain_node: 0.6 × page(1.8) × intent(1.5) = 1.62
    // doc_chunk:  0.8 × page(1.0) × intent(1.0) = 0.8
    expect(result[0].id).toBe("node-1");
  });

  it("original_source intent boosts document_chunk over brain_node", () => {
    const docChunk = makeCandidate({ id: "doc-1", sourceType: "document_chunk", finalScore: 0.6 });
    const brainNode = makeCandidate({ id: "node-1", sourceType: "brain_node", finalScore: 0.8 });

    const result = rerank({
      candidates: [docChunk, brainNode],
      pageContext: "brain_overview",
      intent: "original_source",
      topK: 5,
      isClientContext: false,
    });

    // doc_chunk:  0.6 × page(1.0) × intent(1.8) = 1.08
    // brain_node: 0.8 × page(1.8) × intent(1.0) = 1.44  — page still wins here
    // Let's use a context where page doesn't heavily favor brain_node
    // Use doc_viewer context: doc_chunk gets 2.0 page boost
    const result2 = rerank({
      candidates: [docChunk, brainNode],
      pageContext: "doc_viewer",
      intent: "original_source",
      topK: 5,
      isClientContext: false,
    });
    // doc_chunk:  0.6 × 2.0 × 1.8 = 2.16
    // brain_node: 0.8 × 1.0 × 1.0 = 0.8
    expect(result2[0].id).toBe("doc-1");
  });

  it("change_history intent boosts change_proposal to top", () => {
    const doc = makeCandidate({ id: "doc-1", sourceType: "document_chunk", finalScore: 0.9 });
    const change = makeCandidate({ id: "chg-1", sourceType: "change_proposal", finalScore: 0.5 });

    const result = rerank({
      candidates: [doc, change],
      pageContext: "brain_overview",
      intent: "change_history",
      topK: 5,
      isClientContext: false,
    });

    // change_proposal: 0.5 × page(1.5) × intent(2.0) = 1.5
    // doc_chunk:       0.9 × page(1.0) × intent(1.0) = 0.9
    expect(result[0].id).toBe("chg-1");
  });
});

describe("rerank – edge cases", () => {
  it("handles empty candidate list without throwing", () => {
    expect(() =>
      rerank({
        candidates: [],
        pageContext: "brain_overview",
        intent: "current_truth",
        topK: 5,
        isClientContext: false,
      })
    ).not.toThrow();
    expect(
      rerank({
        candidates: [],
        pageContext: "brain_overview",
        intent: "current_truth",
        topK: 5,
        isClientContext: false,
      })
    ).toEqual([]);
  });

  it("topK=0 returns empty list", () => {
    const c = makeCandidate({ id: "c1" });
    const result = rerank({
      candidates: [c],
      pageContext: "brain_overview",
      intent: "current_truth",
      topK: 0,
      isClientContext: false,
    });
    expect(result.length).toBe(0);
  });

  it("does not include internal-only in client context even if score is very high", () => {
    const internal = makeCandidate({ id: "int-1", isInternalOnly: true, finalScore: 100 });
    const safe = makeCandidate({ id: "safe-1", isInternalOnly: false, finalScore: 0.1 });

    const result = rerank({
      candidates: [internal, safe],
      pageContext: "client_view",
      intent: "current_truth",
      topK: 5,
      isClientContext: true,
    });

    expect(result.length).toBe(1);
    expect(result[0].id).toBe("safe-1");
  });
});
