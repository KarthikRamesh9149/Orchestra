import { describe, expect, it, vi } from "vitest";
import {
  buildProductBrainEvidenceMap,
  buildProductBrainEvidenceMapFromPayload,
  loadProductBrainEvidence,
} from "../src/lib/retrieval/brain-evidence.js";
import { buildRetrievalPlan } from "../src/lib/retrieval/planner.js";

describe("Product Brain evidence map", () => {
  it("normalizes traceability refs from source refs and payload", () => {
    const map = buildProductBrainEvidenceMapFromPayload(
      "artifact-1",
      {
        documentSectionIds: ["section-1"],
        messageIds: ["message-1"],
      },
      {
        modules: [
          {
            title: "Reporting",
            sourceRefs: [{ changeProposalId: "proposal-1", decisionRecordId: "decision-1" }],
          },
        ],
      }
    );

    expect(map).toEqual({
      artifactVersionId: "artifact-1",
      linkedSectionIds: ["section-1"],
      linkedMessageIds: ["message-1"],
      linkedChangeProposalIds: ["proposal-1"],
      decisionRecordIds: ["decision-1"],
    });
  });

  it("expands accepted proposal links into section/message refs", async () => {
    const prisma = {
      artifactVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: "artifact-1",
          sourceRefsJson: { changeProposalIds: ["proposal-1"] },
          payloadJson: {},
        }),
      },
      specChangeLink: {
        findMany: vi.fn().mockResolvedValue([
          { linkType: "document_section", linkRefId: "section-1" },
          { linkType: "message", linkRefId: "message-1" },
        ]),
      },
    } as any;

    const map = await buildProductBrainEvidenceMap(prisma, "project-1", "artifact-1");

    expect(map?.linkedSectionIds).toContain("section-1");
    expect(map?.linkedMessageIds).toContain("message-1");
  });

  it("loads Product Brain candidate with traceability metadata", async () => {
    const prisma = {
      artifactVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: "artifact-1",
          versionNumber: 3,
          sourceRefsJson: { documentSectionIds: ["section-1"] },
          payloadJson: {
            whatTheProductIs: "A launch planning brain",
            modules: ["Reporting"],
          },
        }),
      },
    } as any;
    const plan = buildRetrievalPlan({
      intent: "current_truth",
      pageContext: "brain_overview",
      selectedRefType: null,
      selectedRefId: null,
      viewerState: null,
      isClientContext: false,
      retrievalTopK: 32,
      rerankTopK: 8,
    });

    const candidates = await loadProductBrainEvidence(prisma, "project-1", plan, ["reporting"], 1.2);

    expect(candidates[0]).toMatchObject({
      id: "artifact-1",
      sourceType: "product_brain",
      artifactVersionId: "artifact-1",
      linkedSectionIds: ["section-1"],
      sourcePrecedence: "accepted_truth",
    });
  });

  it("uses client-safe Product Brain projection and strips internal refs in client context", async () => {
    const prisma = {
      artifactVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: "artifact-1",
          projectId: "project-1",
          versionNumber: 3,
          acceptedAt: new Date("2026-01-01T00:00:00.000Z"),
          sourceRefsJson: {
            documentSectionIds: ["section-1"],
            messageIds: ["message-1"],
            changeProposalIds: ["proposal-1"],
            decisionRecordIds: ["decision-1"],
          },
          payloadJson: {
            executiveSummary: "Client-safe reporting summary",
            targetAudience: "Managers",
            mainFlows: ["Shared reporting flow"],
            modules: ["Reporting"],
          },
        }),
      },
    } as any;
    const plan = buildRetrievalPlan({
      intent: "current_truth",
      pageContext: "client_view",
      selectedRefType: null,
      selectedRefId: null,
      viewerState: null,
      isClientContext: true,
      retrievalTopK: 32,
      rerankTopK: 8,
    });

    const candidates = await loadProductBrainEvidence(prisma, "project-1", plan, ["reporting"], 1.2);

    expect(candidates[0]).toMatchObject({
      domain: "client_safe_brain",
      sourcePrecedence: "client_safe_projection",
      linkedSectionIds: ["section-1"],
      linkedMessageIds: [],
      linkedChangeProposalIds: [],
      decisionRecordIds: [],
      isClientSafe: true,
      isInternalOnly: false,
    });
    expect(candidates[0].content).toContain("Client-safe reporting summary");
  });
});
