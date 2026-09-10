import { describe, expect, it } from "vitest";
import { rerank } from "../src/lib/retrieval/rerank.js";
import type { RetrievalCandidate } from "../src/lib/retrieval/types.js";
import { buildRetrievalPlan } from "../src/lib/retrieval/planner.js";

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

describe("rerank", () => {
  it("applies page context boost to dashboard_snapshot on dashboard pages", () => {
    const docChunk = makeCandidate({ id: "doc-1", sourceType: "document_chunk", finalScore: 0.8 });
    const snapshot = makeCandidate({ id: "snap-1", sourceType: "dashboard_snapshot", finalScore: 0.5 });

    const result = rerank({
      candidates: [docChunk, snapshot],
      pageContext: "dashboard_general",
      intent: "dashboard_status",
      topK: 5,
      isClientContext: false,
    });

    // Dashboard snapshot should outrank the doc chunk after boost.
    const ids = result.map((c) => c.id);
    expect(ids[0]).toBe("snap-1");
  });

  it("applies selected-section hard boost (3×) to matching candidate", () => {
    // other: 0.6 × page(2.0) × intent(2.0) = 2.4
    // sec-1: 0.2 × page(2.0) × intent(2.0) × selected(3.0) = 2.4 at minimum, but
    //         selected boost is applied *after* score multiplication, so:
    //         score = 0.2 × 2.0 × 2.0 = 0.8, then × 3.0 = 2.4
    //         other = 0.6 × 2.0 × 2.0 = 2.4  — tie; use 0.5 to be safe
    const other = makeCandidate({ id: "other-1", sourceType: "document_chunk", finalScore: 0.5 });
    const selected = makeCandidate({
      id: "sec-1",
      sourceType: "document_chunk",
      finalScore: 0.2,
      documentSectionId: "sec-uuid",
    });

    const result = rerank({
      candidates: [other, selected],
      pageContext: "doc_viewer",
      intent: "doc_local",
      selectedSectionId: "sec-uuid",
      topK: 5,
      isClientContext: false,
    });

    expect(result[0].id).toBe("sec-1");
  });

  it("filters internal-only candidates in client context", () => {
    const internal = makeCandidate({ id: "int-1", isInternalOnly: true, finalScore: 1.0 });
    const safe = makeCandidate({ id: "safe-1", isInternalOnly: false, finalScore: 0.5 });

    const result = rerank({
      candidates: [internal, safe],
      pageContext: "client_view",
      intent: "current_truth",
      topK: 5,
      isClientContext: true,
    });

    expect(result.every((c) => !c.isInternalOnly)).toBe(true);
    expect(result.find((c) => c.id === "int-1")).toBeUndefined();
  });

  it("deduplicates candidates with same id", () => {
    const dup1 = makeCandidate({ id: "dup", finalScore: 0.8 });
    const dup2 = makeCandidate({ id: "dup", finalScore: 0.6 });

    const result = rerank({
      candidates: [dup1, dup2],
      pageContext: "brain_overview",
      intent: "current_truth",
      topK: 5,
      isClientContext: false,
    });

    expect(result.filter((c) => c.id === "dup").length).toBe(1);
  });

  it("enforces maxPerSource cap (default 2)", () => {
    const containerId = "container-A";
    const candidates = [1, 2, 3].map((i) =>
      makeCandidate({ id: `c-${i}`, containerId, finalScore: 1.0 - i * 0.1 })
    );

    const result = rerank({
      candidates,
      pageContext: "brain_overview",
      intent: "current_truth",
      topK: 10,
      isClientContext: false,
    });

    expect(result.filter((c) => c.containerId === containerId).length).toBeLessThanOrEqual(2);
  });

  it("returns at most topK results", () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      makeCandidate({ id: `c-${i}`, finalScore: Math.random() })
    );

    const result = rerank({
      candidates,
      pageContext: "brain_graph",
      intent: "brain_local",
      topK: 5,
      isClientContext: false,
    });

    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("applies brain_node boost on brain_graph page with brain_local intent", () => {
    const doc = makeCandidate({ id: "doc-1", sourceType: "document_chunk", finalScore: 0.9 });
    const node = makeCandidate({ id: "node-1", sourceType: "brain_node", finalScore: 0.4 });

    const result = rerank({
      candidates: [doc, node],
      pageContext: "brain_graph",
      intent: "brain_local",
      topK: 5,
      isClientContext: false,
    });

    // Brain node boosted by 2.0 (page) × 2.0 (intent) = 4× its base score.
    // 0.4 × 4 = 1.6 > 0.9 × 1.0 (doc chunk)
    expect(result[0].id).toBe("node-1");
  });

  it("applies generic selected-ref boost to a selected change proposal", () => {
    const proposal = makeCandidate({ id: "chg-1", sourceType: "change_proposal", finalScore: 0.4 });
    const doc = makeCandidate({ id: "doc-1", sourceType: "document_chunk", finalScore: 0.7 });

    const result = rerank({
      candidates: [doc, proposal],
      pageContext: "brain_overview",
      intent: "change_history",
      selectedRefId: "chg-1",
      topK: 5,
      isClientContext: false,
    });

    expect(result[0].id).toBe("chg-1");
  });

  it("current-truth intent boosts product_brain above document chunks on overview pages", () => {
    const productBrain = makeCandidate({ id: "brain-artifact-1", sourceType: "product_brain", finalScore: 0.5 });
    const doc = makeCandidate({ id: "doc-1", sourceType: "document_chunk", finalScore: 0.8 });

    const result = rerank({
      candidates: [doc, productBrain],
      pageContext: "brain_overview",
      intent: "current_truth",
      topK: 5,
      isClientContext: false,
    });

    expect(result[0].id).toBe("brain-artifact-1");
  });

  it("uses plan precedence so provenance ranks original evidence above Product Brain", () => {
    const plan = buildRetrievalPlan({
      intent: "original_source",
      pageContext: "doc_viewer",
      selectedRefType: null,
      selectedRefId: null,
      viewerState: null,
      isClientContext: false,
      retrievalTopK: 32,
      rerankTopK: 8,
    });
    const productBrain = makeCandidate({ id: "brain-artifact-1", sourceType: "product_brain", finalScore: 0.9 });
    const doc = makeCandidate({ id: "doc-1", sourceType: "document_chunk", finalScore: 0.5 });

    const result = rerank({
      candidates: [productBrain, doc],
      pageContext: "doc_viewer",
      intent: "original_source",
      topK: 5,
      isClientContext: false,
      plan,
    });

    expect(result[0].id).toBe("doc-1");
  });

  it("emits component scores and selection rationale for telemetry", () => {
    const plan = buildRetrievalPlan({
      intent: "brain_local",
      pageContext: "brain_graph",
      selectedRefType: "brain_node",
      selectedRefId: "node-1",
      viewerState: null,
      isClientContext: false,
      retrievalTopK: 32,
      rerankTopK: 8,
    });
    const node = makeCandidate({
      id: "node-1",
      sourceType: "brain_node",
      brainNodeId: "node-1",
      graphScore: 1,
      finalScore: 0.4,
    });

    const result = rerank({
      candidates: [node],
      pageContext: "brain_graph",
      intent: "brain_local",
      selectedNodeId: "node-1",
      topK: 5,
      isClientContext: false,
      plan,
    });

    expect(result[0].selectedObjectScore).toBeGreaterThan(1);
    expect(result[0].pageContextScore).toBeGreaterThan(1);
    expect(result[0].sourcePrecedenceScore).toBeGreaterThan(1);
    expect(result[0].citationAvailabilityScore).toBeGreaterThan(0);
    expect(result[0].whySelected).toContain("selectedBoost");
  });

  it("hard-filters plan-forbidden internal domains in client context", () => {
    const plan = buildRetrievalPlan({
      intent: "communication_lookup",
      pageContext: "client_view",
      selectedRefType: null,
      selectedRefId: null,
      viewerState: null,
      isClientContext: true,
      retrievalTopK: 32,
      rerankTopK: 8,
    });
    const internalChange = makeCandidate({
      id: "proposal-1",
      sourceType: "change_proposal",
      domain: "accepted_changes",
      isInternalOnly: false,
      finalScore: 2,
    });
    const safeDoc = makeCandidate({ id: "doc-1", sourceType: "document_chunk", domain: "client_safe_documents" });

    const result = rerank({
      candidates: [internalChange, safeDoc],
      pageContext: "client_view",
      intent: "communication_lookup",
      topK: 5,
      isClientContext: true,
      plan,
    });

    expect(result.map((candidate) => candidate.id)).toEqual(["doc-1"]);
  });
});
