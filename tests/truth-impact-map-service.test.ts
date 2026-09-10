import { describe, expect, it, vi } from "vitest";
import { TruthImpactMapService } from "../src/modules/truth-inbox/truth-impact-map.service.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PROPOSAL_ID = "22222222-2222-4222-8222-222222222222";

function group(map: Awaited<ReturnType<TruthImpactMapService["buildForProposal"]>>, key: string) {
  return map.groups.find((entry) => entry.key === key)!;
}

function harness() {
  const agentContextPackSource = {
    findMany: vi.fn()
      .mockResolvedValueOnce([{
        sourceRefType: "change_proposal",
        sourceRefId: PROPOSAL_ID,
        relationship: "task_seed",
        pack: { id: "pack-1", title: "Google login implementation", taskType: "implementation", status: "active", generatedAt: new Date("2026-08-23T01:00:00.000Z") }
      }])
      .mockResolvedValueOnce([
        { packId: "pack-1", sourceRefType: "coding_requirement", sourceRefId: "coding-1", relationship: "implementation_constraint" },
        { packId: "pack-1", sourceRefType: "project_context", sourceRefId: "context-1", relationship: "client_commitment" }
      ])
  };
  const prisma = {
    brainSectionLink: {
      findMany: vi.fn(async () => [{
        relationship: "supports",
        brainNode: {
          id: "node-constraint",
          artifactVersionId: "brain-v1",
          nodeType: "constraint",
          title: "Authentication requirement",
          summary: "Launch requires approved authentication scope.",
          status: "active",
          artifactVersion: { artifactType: "brain_graph", status: "accepted", acceptedAt: new Date("2026-08-20T00:00:00.000Z") }
        },
        documentSection: {
          id: "section-1",
          documentVersionId: "doc-v1",
          anchorId: "auth",
          headingPath: ["Authentication"],
          normalizedText: "Email and password authentication is in current scope.",
          pageNumber: 4,
          documentVersion: { id: "doc-v1", status: "ready", document: { id: "doc-1", title: "Launch PRD", currentVersionId: "doc-v1", visibility: "internal" } }
        }
      }])
    },
    liveDocSectionDraft: {
      findMany: vi.fn(async () => [{ id: "draft-1", sectionKey: "authentication", sectionLabel: "Authentication", proposedContent: "Add Google sign-in.", status: "pending", artifactVersionId: "live-v1", documentSectionId: "section-1" }])
    },
    projectLiveDocSource: { findMany: vi.fn(async () => [{ documentId: "doc-1", sourceKind: "uploaded_prd" }]) },
    specChangeLink: {
      findMany: vi.fn(async () => [{
        linkType: "document_section",
        linkRefId: "section-1",
        relationship: "affected",
        proposal: {
          id: "prior-proposal",
          title: "Email login accepted",
          summary: "Email login was the launch baseline.",
          status: "accepted",
          updatedAt: new Date("2026-08-20T00:00:00.000Z"),
          decisionRecord: { id: "decision-prior", title: "Email login baseline", statement: "Launch with email login.", status: "accepted" }
        }
      }])
    },
    agentContextPackSource,
    fdeDecisionEngineeringLink: {
      findMany: vi.fn(async () => [{
        id: "fde-link-1",
        decisionId: "decision-prior",
        targetType: "pull_request",
        targetRef: "orchestra/auth#42",
        relationshipType: "implements_decision",
        confidence: "exact_link",
        evidenceIdsJson: ["33333333-3333-4333-8333-333333333333"],
        openTargetsJson: []
      }])
    },
    agentMarkdownFileVersion: {
      findMany: vi.fn(async () => [{
        id: "agent-file-v2",
        versionNumber: 2,
        status: "generated",
        generatedAt: new Date("2026-08-23T02:00:00.000Z"),
        file: { id: "agent-file-1", title: "Agent instructions", filePath: "AGENTS.md", status: "current" },
        fileSet: { name: "Orchestra agent files", repoOwner: "orchestra", repoName: "web", targetBranch: "main" }
      }])
    },
    engineeringEvidenceItem: {
      findMany: vi.fn(async () => [{
        id: "33333333-3333-4333-8333-333333333333",
        provider: "github",
        sourceSubType: "github_check_run",
        repositoryOwner: "orchestra",
        repositoryName: "web",
        sha: "abcdef1234567890",
        pullRequestNumber: 42,
        filePath: "tests/auth.spec.ts",
        status: "success",
        title: "Authentication checks",
        summary: "Google login tests passed.",
        sourceUrl: "https://github.com/orchestra/web/pull/42"
      }])
    },
    gitHubEngineeringEvidence: { findMany: vi.fn(async () => []) },
    projectCodingRequirements: {
      findMany: vi.fn(async () => [{ id: "coding-1", artifactVersion: { versionNumber: 3, status: "accepted", payloadJson: { authentication: "Google login callback must be tested." } } }])
    },
    projectContextEntry: {
      findMany: vi.fn(async () => [
        { id: "context-1", title: "Client launch commitment", body: "Google login is required before launch.", tagsJson: ["client_commitment"], importance: "high" },
        { id: "context-2", title: "Internal delivery commitment", body: "Engineering will review this internally.", tagsJson: ["commitment"], importance: "medium" }
      ])
    }
  };
  return { service: new TruthImpactMapService(prisma as never), prisma };
}

describe("TruthImpactMapService", () => {
  it("maps only persisted proposal, graph, decision, delivery, agent, and client relationships", async () => {
    const { service, prisma } = harness();
    const map = await service.buildForProposal({
      projectId: PROJECT_ID,
      item: { owner: { userId: "user-1", displayName: "Karthik", email: "karthik@example.com" } } as never,
      proposal: {
        id: PROPOSAL_ID,
        title: "Add Google login",
        summary: "Google login is required before launch.",
        status: "needs_review",
        decisionRecordId: null,
        impactSummaryJson: { clientExpectationImpact: "Launch commitment may change." },
        links: [
          { linkType: "brain_node", linkRefId: "node-1", relationship: "affected" },
          { linkType: "document_section", linkRefId: "section-1", relationship: "affected" }
        ],
        decisionRecord: null
      },
      directNodes: [{
        id: "node-1",
        artifactVersionId: "brain-v1",
        nodeType: "flow",
        title: "Authentication",
        summary: "Email login flow.",
        status: "active",
        artifactVersion: { artifactType: "brain_graph", status: "accepted", acceptedAt: new Date("2026-08-20T00:00:00.000Z") }
      }],
      directSections: [{
        id: "section-1",
        documentVersionId: "doc-v1",
        anchorId: "auth",
        headingPath: ["Authentication"],
        normalizedText: "Email and password authentication is in current scope.",
        pageNumber: 4,
        documentVersion: { id: "doc-v1", status: "ready", document: { id: "doc-1", title: "Launch PRD", currentVersionId: "doc-v1", visibility: "internal" } }
      }]
    });

    expect(map.status).toBe("mapped");
    expect(map.summary.verifiedItems).toBeGreaterThan(10);
    expect(group(map, "product_brain").items.map((item) => item.label)).toEqual(expect.arrayContaining(["Authentication", "Authentication requirement"]));
    expect(group(map, "requirements").items.map((item) => item.label)).toEqual(expect.arrayContaining(["Authentication requirement", "Engineering requirements v3"]));
    expect(group(map, "live_doc").items.some((item) => item.label === "Authentication")).toBe(true);
    expect(group(map, "previous_decisions").items[0]?.label).toBe("Email login baseline");
    expect(group(map, "repositories").items[0]?.label).toBe("orchestra/web");
    expect(group(map, "files_modules").items[0]?.label).toBe("tests/auth.spec.ts");
    expect(group(map, "pull_requests").items.some((item) => item.label.includes("#42"))).toBe(true);
    expect(group(map, "tests").items[0]?.label).toBe("tests/auth.spec.ts");
    expect(group(map, "context_packs").items[0]?.label).toBe("Google login implementation");
    expect(group(map, "agent_files").items[0]?.label).toBe("AGENTS.md");
    expect(group(map, "client_commitments").items.map((item) => item.confidence)).toEqual(expect.arrayContaining(["verified", "recorded"]));
    expect(group(map, "client_commitments").items.map((item) => item.label)).not.toContain("Internal delivery commitment");
    expect(map.limitations.join(" ")).toContain("Title similarity");
    expect(prisma.agentContextPackSource.findMany).toHaveBeenCalledTimes(2);
    for (const delegate of [
      prisma.brainSectionLink,
      prisma.liveDocSectionDraft,
      prisma.projectLiveDocSource,
      prisma.specChangeLink,
      prisma.fdeDecisionEngineeringLink,
      prisma.agentMarkdownFileVersion,
      prisma.engineeringEvidenceItem,
      prisma.gitHubEngineeringEvidence,
      prisma.projectCodingRequirements,
      prisma.projectContextEntry
    ]) expect(delegate.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.brainSectionLink.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ projectId: PROJECT_ID })
    }));
    expect(prisma.engineeringEvidenceItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ projectId: PROJECT_ID })
    }));
  });

  it("keeps raw review signals explicitly unmapped", () => {
    const map = new TruthImpactMapService({} as never).reviewOnly();
    expect(map.status).toBe("review_only");
    expect(map.groups).toHaveLength(13);
    expect(map.groups.every((entry) => entry.coverage === "not_applicable" && entry.items.length === 0)).toBe(true);
  });
});
