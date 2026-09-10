import { describe, expect, it, vi } from "vitest";
import { expandBrainGraph } from "../src/lib/retrieval/graph-expansion.js";
import { buildRetrievalPlan } from "../src/lib/retrieval/planner.js";

function makePlan(isClientContext = false) {
  return buildRetrievalPlan({
    intent: "brain_local",
    pageContext: isClientContext ? "client_view" : "brain_graph",
    selectedRefType: "brain_node",
    selectedRefId: "node-a",
    viewerState: null,
    isClientContext,
    retrievalTopK: 32,
    rerankTopK: 8,
  });
}

describe("expandBrainGraph", () => {
  it("includes selected node, neighbors, linked sections, accepted changes, and linked messages", async () => {
    const prisma = {
      artifactVersion: {
        findFirst: vi.fn().mockResolvedValue({ id: "graph-1" }),
      },
      brainEdge: {
        findMany: vi.fn().mockResolvedValue([
          { id: "edge-1", fromNodeId: "node-a", toNodeId: "node-b" },
        ]),
      },
      brainNode: {
        findMany: vi.fn().mockResolvedValue([
          { id: "node-a", title: "Reporting", summary: "Manager reporting requirement", createdAt: new Date() },
          { id: "node-b", title: "Dashboard", summary: "Dashboard dependency", createdAt: new Date() },
        ]),
      },
      brainSectionLink: {
        findMany: vi.fn().mockResolvedValue([
          {
            brainNodeId: "node-a",
            documentSectionId: "section-1",
            documentSection: {
              documentVersion: {
                document: { visibility: "internal" },
              },
            },
          },
        ]),
      },
      specChangeLink: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              linkRefId: "node-a",
              specChangeProposalId: "proposal-1",
              proposal: { decisionRecordId: "decision-1" },
            },
          ])
          .mockResolvedValueOnce([
            { specChangeProposalId: "proposal-1", linkRefId: "message-1" },
          ]),
      },
    } as any;

    const candidates = await expandBrainGraph(prisma, "project-1", makePlan(), ["reporting"], 1.2);

    expect(candidates.map((candidate) => candidate.id)).toEqual(["node-a", "node-b"]);
    expect(candidates[0]).toMatchObject({
      brainNodeId: "node-a",
      brainEdgeId: "edge-1",
      linkedSectionIds: ["section-1"],
      linkedChangeProposalIds: ["proposal-1"],
      linkedMessageIds: ["message-1"],
      decisionRecordIds: ["decision-1"],
    });
    expect(candidates[1].isGraphNeighbor).toBe(true);
  });

  it("does not expose graph expansion in client context", async () => {
    const prisma = {
      artifactVersion: { findFirst: vi.fn() },
    } as any;

    const candidates = await expandBrainGraph(prisma, "project-1", makePlan(true), ["slack"], 1.2);

    expect(candidates).toEqual([]);
    expect(prisma.artifactVersion.findFirst).not.toHaveBeenCalled();
  });
});
