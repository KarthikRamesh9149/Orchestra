import { describe, expect, it, vi } from "vitest";
import type { EvidenceCard } from "../src/lib/retrieval/evidence-pack.js";
import { CitationValidationService, OpenTargetValidationService } from "../src/modules/socrates/validation.js";

const projectId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const sectionId = "11111111-1111-1111-1111-111111111111";
const chunkId = "22222222-2222-2222-2222-222222222222";
const messageId = "33333333-3333-3333-3333-333333333333";
const proposalId = "44444444-4444-4444-4444-444444444444";
const snapshotId = "55555555-5555-5555-5555-555555555555";
const responsibilityId = "55555555-6666-5555-5555-555555555555";
const contextId = "55555555-7777-5555-5555-555555555555";
const contextChunkId = "55555555-8888-5555-5555-555555555555";
const contextAttachmentId = "55555555-9999-5555-5555-555555555555";
const diagramId = "55555555-aaaa-4555-8555-555555555555";
const codingRequirementsId = "55555555-cccc-4555-8555-555555555555";
const engineeringArtifactId = "55555555-dddd-4555-8555-555555555555";
const brainNodeId = "66666666-1111-1111-1111-666666666666";
const currentGraphId = "66666666-2222-2222-2222-666666666666";
const oldGraphId = "66666666-3333-3333-3333-666666666666";
const oldVersionId = "77777777-7777-7777-7777-777777777777";
const currentVersionId = "88888888-8888-8888-8888-888888888888";

function card(overrides: Partial<EvidenceCard> = {}): EvidenceCard {
  return {
    evidenceId: "ev_1",
    sourceType: "document_section",
    title: "Backend label",
    excerpt: "Evidence excerpt",
    whySelected: "Selected by final rerank",
    confidence: 0.9,
    sourcePrecedence: "source_evidence",
    citationRef: { type: "document_section", id: sectionId, label: "Backend label" },
    openTarget: {
      targetType: "document_section",
      targetRef: {
        anchorId: "reporting",
        documentVersionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      },
    },
    trace: { documentSectionId: sectionId },
    ...overrides,
  };
}

function prismaMock() {
  return {
    artifactVersion: { findFirst: vi.fn() },
    documentSection: {
      findFirst: vi.fn().mockResolvedValue({
        id: sectionId,
        projectId,
        anchorId: "reporting",
        documentVersionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        parseRevision: 1,
        anchorText: "Backend section label",
        documentVersion: {
          id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          status: "ready",
          parseRevision: 1,
          document: { currentVersionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", visibility: "shared_with_client" },
        },
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: sectionId,
          projectId,
          anchorId: "reporting",
          documentVersionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          parseRevision: 1,
          documentVersion: {
            id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            status: "ready",
            parseRevision: 1,
            document: { currentVersionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", visibility: "shared_with_client" },
          },
        },
      ]),
    },
    documentChunk: {
      findFirst: vi.fn().mockResolvedValue({
        id: chunkId,
        projectId,
        sectionId,
        documentVersionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        parseRevision: 1,
        documentVersion: {
          id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          status: "ready",
          parseRevision: 1,
          document: { currentVersionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", visibility: "shared_with_client" },
        },
      }),
    },
    communicationMessage: {
      findFirst: vi.fn().mockImplementation(({ where }) => {
        if (where?.isDeletedByProvider === false) return null;
        return Promise.resolve({
          id: messageId,
          projectId,
          threadId: "66666666-6666-6666-6666-666666666666",
          isDeletedByProvider: true,
        });
      }),
    },
    communicationThread: { findFirst: vi.fn() },
    brainNode: { findFirst: vi.fn() },
    brainSectionLink: { findMany: vi.fn().mockResolvedValue([]) },
    specChangeProposal: {
      findFirst: vi.fn().mockResolvedValue({
        id: proposalId,
        projectId,
        status: "needs_review",
        title: "Unaccepted change",
      }),
    },
    decisionRecord: { findFirst: vi.fn() },
    dashboardSnapshot: {
      findFirst: vi.fn().mockResolvedValue({
        id: snapshotId,
        projectId,
        scope: "project",
      }),
    },
    projectResponsibility: {
      findFirst: vi.fn().mockResolvedValue({
        id: responsibilityId,
        projectId,
      }),
    },
    projectContextEntry: {
      findFirst: vi.fn().mockResolvedValue({
        id: contextId,
        projectId,
        status: "active",
      }),
    },
    projectContextChunk: {
      findFirst: vi.fn().mockResolvedValue({
        id: contextChunkId,
        contextEntryId: contextId,
        projectId,
      }),
    },
    projectContextAttachment: {
      findFirst: vi.fn().mockResolvedValue({
        id: contextAttachmentId,
        contextEntryId: contextId,
        projectId,
      }),
    },
    projectDiagram: {
      findFirst: vi.fn().mockResolvedValue({
        id: diagramId,
        projectId,
        status: "active",
      }),
    },
    projectCodingRequirements: {
      findFirst: vi.fn().mockResolvedValue({
        id: codingRequirementsId,
        projectId,
        artifactVersionId: engineeringArtifactId,
        artifactVersion: {
          id: engineeringArtifactId,
          projectId,
          artifactType: "engineering_requirements",
          status: "accepted",
        },
      }),
    },
    liveDocSectionDiagram: {
      findFirst: vi.fn().mockResolvedValue({
        id: "55555555-bbbb-4555-8555-555555555555",
        projectId,
        sectionKey: "overview",
        diagramId,
      }),
    },
  };
}

describe("CitationValidationService", () => {
  it("drops citations that are not in the final evidence pack and derives labels from backend evidence", async () => {
    const service = new CitationValidationService(prismaMock() as never);

    const result = await service.validate({
      citations: [
        { type: "document_section", refId: sectionId, label: "Model supplied label" },
        { type: "document_section", refId: "99999999-9999-9999-9999-999999999999", label: "Hallucinated" },
      ],
      evidenceCards: [card()],
      projectId,
      isClientContext: false,
      intent: "original_source",
    });

    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]?.label).toBe("Backend label");
    expect(result.dropped).toContainEqual(expect.objectContaining({ reason: "not_in_final_evidence" }));
  });

  it("drops provider-deleted messages and unaccepted proposals as current truth", async () => {
    const service = new CitationValidationService(prismaMock() as never);

    const result = await service.validate({
      citations: [
        { type: "message", refId: messageId, label: "Deleted message" },
        { type: "change_proposal", refId: proposalId, label: "Needs review" },
      ],
      evidenceCards: [
        card({
          evidenceId: "ev_msg",
          citationRef: { type: "message", id: messageId, label: "Deleted message" },
          trace: { messageId },
        }),
        card({
          evidenceId: "ev_change",
          citationRef: { type: "change_proposal", id: proposalId, label: "Needs review" },
          trace: { changeProposalId: proposalId },
        }),
      ],
      projectId,
      isClientContext: false,
      intent: "current_truth",
    });

    expect(result.valid).toHaveLength(0);
    expect(result.dropped.map((item) => item.reason)).toEqual(
      expect.arrayContaining(["missing_or_deleted", "not_accepted_truth"])
    );
  });

  it("drops internal citations in client context", async () => {
    const service = new CitationValidationService(prismaMock() as never);

    const result = await service.validate({
      citations: [{ type: "message", refId: messageId, label: "Internal message" }],
      evidenceCards: [
        card({
          citationRef: { type: "message", id: messageId, label: "Internal message" },
          trace: { messageId },
        }),
      ],
      projectId,
      isClientContext: true,
      intent: "communication_lookup",
    });

    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0]?.reason).toBe("client_forbidden");
  });

  it("validates active project diagram citations and blocks them from client context", async () => {
    const service = new CitationValidationService(prismaMock() as never);
    const evidence = card({
      sourceType: "project_diagram",
      citationRef: { type: "project_diagram", id: diagramId, label: "Overview flow" },
      trace: { diagramId },
    });

    const internalResult = await service.validate({
      citations: [{ type: "project_diagram", refId: diagramId, label: "Model label" }],
      evidenceCards: [evidence],
      projectId,
      isClientContext: false,
      intent: "diagram_lookup",
    });
    expect(internalResult.valid).toHaveLength(1);
    expect(internalResult.valid[0]?.label).toBe("Overview flow");

    const clientResult = await service.validate({
      citations: [{ type: "project_diagram", refId: diagramId, label: "Overview flow" }],
      evidenceCards: [evidence],
      projectId,
      isClientContext: true,
      intent: "diagram_lookup",
    });
    expect(clientResult.valid).toHaveLength(0);
    expect(clientResult.dropped[0]?.reason).toBe("client_forbidden");
  });

  it("validates coding requirements citations and blocks them from client context", async () => {
    const service = new CitationValidationService(prismaMock() as never);
    const evidence = card({
      sourceType: "coding_requirements",
      citationRef: { type: "coding_requirements", id: codingRequirementsId, label: "Current Coding Requirements" },
      trace: { codingRequirementsId, artifactVersionId: engineeringArtifactId },
    });

    const internalResult = await service.validate({
      citations: [{ type: "coding_requirements", refId: codingRequirementsId, label: "Model label" }],
      evidenceCards: [evidence],
      projectId,
      isClientContext: false,
      intent: "coding_requirements",
    });
    expect(internalResult.valid).toHaveLength(1);
    expect(internalResult.valid[0]).toMatchObject({ type: "coding_requirements", refId: codingRequirementsId, label: "Current Coding Requirements" });

    const clientResult = await service.validate({
      citations: [{ type: "coding_requirements", refId: codingRequirementsId, label: "Current Coding Requirements" }],
      evidenceCards: [evidence],
      projectId,
      isClientContext: true,
      intent: "coding_requirements",
    });
    expect(clientResult.valid).toHaveLength(0);
    expect(clientResult.dropped[0]?.reason).toBe("client_forbidden");
  });

  it("drops dashboard snapshot citations in client context", async () => {
    const service = new CitationValidationService(prismaMock() as never);

    const result = await service.validate({
      citations: [{ type: "dashboard_snapshot", refId: snapshotId, label: "Project dashboard" }],
      evidenceCards: [
        card({
          sourceType: "dashboard_snapshot",
          citationRef: { type: "dashboard_snapshot", id: snapshotId, label: "Project dashboard" },
          trace: { dashboardSnapshotId: snapshotId },
        }),
      ],
      projectId,
      isClientContext: true,
      intent: "dashboard_status",
    });

    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0]?.reason).toBe("client_forbidden");
  });

  it("keeps retrieved general dashboard snapshot citations with null projectId", async () => {
    const prisma = prismaMock();
    prisma.dashboardSnapshot.findFirst.mockResolvedValue({
      id: snapshotId,
      projectId: null,
      scope: "general",
    });
    const service = new CitationValidationService(prisma as never);

    const result = await service.validate({
      citations: [{ type: "dashboard_snapshot", refId: snapshotId, label: "General dashboard" }],
      evidenceCards: [
        card({
          sourceType: "dashboard_snapshot",
          citationRef: { type: "dashboard_snapshot", id: snapshotId, label: "General dashboard" },
          trace: { dashboardSnapshotId: snapshotId },
        }),
      ],
      projectId,
      isClientContext: false,
      intent: "dashboard_status",
    });

    expect(result.valid).toHaveLength(1);
    expect(prisma.dashboardSnapshot.findFirst).toHaveBeenCalledWith({
      where: {
        id: snapshotId,
        OR: [
          { projectId },
          { projectId: null, scope: "general", organization: { projects: { some: { id: projectId } } } },
        ],
      },
    });
  });

  it("validates project responsibility citations for internal evidence only", async () => {
    const service = new CitationValidationService(prismaMock() as never);

    const result = await service.validate({
      citations: [{ type: "project_responsibility", refId: responsibilityId, label: "Sara owns frontend" }],
      evidenceCards: [
        card({
          evidenceId: "ev_resp",
          sourceType: "project_responsibility",
          title: "Sara owns frontend",
          citationRef: { type: "project_responsibility", id: responsibilityId, label: "Sara owns frontend" },
          openTarget: {
            targetType: "project_responsibility",
            targetRef: { projectId, responsibilityId }
          },
          trace: { responsibilityId }
        })
      ],
      projectId,
      isClientContext: false,
      intent: "team_responsibility",
    });

    expect(result.valid).toEqual([
      expect.objectContaining({ type: "project_responsibility", refId: responsibilityId, label: "Sara owns frontend" })
    ]);
  });

  it("validates active manual context citations and open targets for internal evidence only", async () => {
    const prisma = prismaMock();
    const citationService = new CitationValidationService(prisma as never);
    const targetService = new OpenTargetValidationService(prisma as never);
    const evidenceCards = [
      card({
        evidenceId: "ev_context",
        sourceType: "project_context",
        title: "KYC onboarding decision",
        citationRef: { type: "project_context", id: contextId, label: "KYC onboarding decision" },
        openTarget: {
          targetType: "project_context",
          targetRef: { projectId, contextId, contextChunkId, attachmentId: contextAttachmentId }
        },
        trace: { contextId, contextChunkId }
      })
    ];

    const citations = await citationService.validate({
      citations: [{ type: "project_context", refId: contextId, label: "KYC onboarding decision" }],
      evidenceCards,
      projectId,
      isClientContext: false,
      intent: "manual_context",
    });
    expect(citations.valid).toEqual([
      expect.objectContaining({ type: "project_context", refId: contextId, label: "KYC onboarding decision" })
    ]);

    const targets = await targetService.validate({
      targets: [{ targetType: "project_context", targetRef: { projectId, contextId, contextChunkId, attachmentId: contextAttachmentId } }],
      citations: citations.valid,
      evidenceCards,
      projectId,
      isClientContext: false
    });
    expect(targets.valid).toHaveLength(1);
    expect(prisma.projectContextAttachment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: contextAttachmentId, contextEntryId: contextId, projectId }
      })
    );

    const client = await citationService.validate({
      citations: [{ type: "project_context", refId: contextId, label: "KYC onboarding decision" }],
      evidenceCards,
      projectId,
      isClientContext: true,
      intent: "manual_context",
    });
    expect(client.valid).toHaveLength(0);
    expect(client.dropped[0]?.reason).toBe("client_forbidden");
  });

  it("drops general dashboard snapshot citations that are not in the active project org", async () => {
    const prisma = prismaMock();
    prisma.dashboardSnapshot.findFirst.mockResolvedValue(null);
    const service = new CitationValidationService(prisma as never);

    const result = await service.validate({
      citations: [{ type: "dashboard_snapshot", refId: snapshotId, label: "Wrong org dashboard" }],
      evidenceCards: [
        card({
          sourceType: "dashboard_snapshot",
          citationRef: { type: "dashboard_snapshot", id: snapshotId, label: "Wrong org dashboard" },
          trace: { dashboardSnapshotId: snapshotId },
        }),
      ],
      projectId,
      isClientContext: false,
      intent: "dashboard_status",
    });

    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0]?.reason).toBe("missing_or_deleted");
  });


  it("drops stale document chunks after parse revision changes", async () => {
    const prisma = prismaMock();
    prisma.documentChunk.findFirst.mockResolvedValue({
      id: chunkId,
      projectId,
      sectionId,
      parseRevision: 1,
      documentVersion: {
        parseRevision: 2,
        document: { visibility: "shared_with_client" },
      },
    });
    const service = new CitationValidationService(prisma as never);

    const result = await service.validate({
      citations: [{ type: "document_chunk", refId: chunkId, label: "Old chunk" }],
      evidenceCards: [
        card({
          sourceType: "document_chunk",
          citationRef: { type: "document_chunk", id: chunkId, label: "Old chunk" },
          trace: { documentChunkId: chunkId },
        }),
      ],
      projectId,
      isClientContext: false,
      intent: "original_source",
    });

    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0]?.reason).toBe("stale_or_not_current");
  });

  it("drops document-section citations from a superseded ready version", async () => {
    const prisma = prismaMock();
    prisma.documentSection.findFirst.mockResolvedValue({
      id: sectionId,
      projectId,
      documentVersionId: oldVersionId,
      parseRevision: 1,
      documentVersion: {
        id: oldVersionId,
        status: "ready",
        parseRevision: 1,
        document: { currentVersionId, visibility: "shared_with_client" },
      },
    });
    const service = new CitationValidationService(prisma as never);

    const result = await service.validate({
      citations: [{ type: "document_section", refId: sectionId, label: "Old section" }],
      evidenceCards: [card()],
      projectId,
      isClientContext: false,
      intent: "original_source",
    });

    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0]?.reason).toBe("stale_or_not_current");
  });

  it("drops document-chunk citations from a non-current partial version", async () => {
    const prisma = prismaMock();
    prisma.documentChunk.findFirst.mockResolvedValue({
      id: chunkId,
      projectId,
      sectionId,
      documentVersionId: oldVersionId,
      parseRevision: 3,
      documentVersion: {
        id: oldVersionId,
        status: "partial",
        parseRevision: 3,
        document: { currentVersionId, visibility: "shared_with_client" },
      },
    });
    const service = new CitationValidationService(prisma as never);

    const result = await service.validate({
      citations: [{ type: "document_chunk", refId: chunkId, label: "Old chunk" }],
      evidenceCards: [
        card({
          sourceType: "document_chunk",
          citationRef: { type: "document_chunk", id: chunkId, label: "Old chunk" },
          trace: { documentChunkId: chunkId },
        }),
      ],
      projectId,
      isClientContext: false,
      intent: "original_source",
    });

    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0]?.reason).toBe("stale_or_not_current");
  });

  it("allows accepted proposal citations for current truth", async () => {
    const prisma = prismaMock();
    prisma.specChangeProposal.findFirst.mockResolvedValue({
      id: proposalId,
      projectId,
      status: "accepted",
      title: "Accepted change",
    });
    const service = new CitationValidationService(prisma as never);

    const result = await service.validate({
      citations: [{ type: "change_proposal", refId: proposalId, label: "Model label" }],
      evidenceCards: [
        card({
          sourceType: "accepted_change",
          title: "Backend accepted change",
          citationRef: { type: "change_proposal", id: proposalId, label: "Backend accepted change" },
          trace: { changeProposalId: proposalId },
        }),
      ],
      projectId,
      isClientContext: false,
      intent: "current_truth",
    });

    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]?.label).toBe("Backend accepted change");
  });

  it("drops brain-node citations from a superseded graph version", async () => {
    const prisma = prismaMock();
    prisma.artifactVersion.findFirst.mockResolvedValue({ id: currentGraphId, projectId, artifactType: "brain_graph", status: "accepted" });
    prisma.brainNode.findFirst.mockResolvedValue({
      id: brainNodeId,
      projectId,
      artifactVersionId: oldGraphId,
      title: "Old node",
    });
    const service = new CitationValidationService(prisma as never);

    const result = await service.validate({
      citations: [{ type: "brain_node", refId: brainNodeId, label: "Old node" }],
      evidenceCards: [
        card({
          sourceType: "brain_node",
          citationRef: { type: "brain_node", id: brainNodeId, label: "Old node" },
          trace: { brainNodeId },
        }),
      ],
      projectId,
      isClientContext: false,
      intent: "brain_local",
    });

    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0]?.reason).toBe("stale_or_not_current");
  });
});

describe("OpenTargetValidationService", () => {
  it("keeps resolvable document-section targets backed by validated citations", async () => {
    const service = new OpenTargetValidationService(prismaMock() as never);

    const result = await service.validate({
      targets: [
        {
          targetType: "document_section",
          targetRef: {
            anchorId: "reporting",
            documentVersionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          },
        },
      ],
      citations: [{ type: "document_section", refId: sectionId, label: "Backend label" }],
      evidenceCards: [card()],
      projectId,
      isClientContext: false,
    });

    expect(result.valid).toHaveLength(1);
  });

  it("drops document-section targets that resolve to a superseded document version", async () => {
    const prisma = prismaMock();
    prisma.documentSection.findMany.mockResolvedValue([
      {
        id: sectionId,
        projectId,
        anchorId: "reporting",
        documentVersionId: oldVersionId,
        parseRevision: 1,
        documentVersion: {
          id: oldVersionId,
          status: "ready",
          parseRevision: 1,
          document: { currentVersionId, visibility: "shared_with_client" },
        },
      },
    ]);
    const service = new OpenTargetValidationService(prisma as never);

    const result = await service.validate({
      targets: [
        {
          targetType: "document_section",
          targetRef: {
            anchorId: "reporting",
            documentVersionId: oldVersionId,
          },
        },
      ],
      citations: [{ type: "document_section", refId: sectionId, label: "Old section" }],
      evidenceCards: [card()],
      projectId,
      isClientContext: false,
    });

    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0]?.reason).toBe("stale_or_not_current");
  });

  it("drops client message targets and client dashboard filters", async () => {
    const service = new OpenTargetValidationService(prismaMock() as never);

    const result = await service.validate({
      targets: [
        { targetType: "message", targetRef: { messageId } },
        { targetType: "dashboard_filter", targetRef: { filter: "raw_sql", value: "select *" } },
      ],
      citations: [{ type: "dashboard_snapshot", refId: snapshotId, label: "Dashboard" }],
      evidenceCards: [
        card({
          citationRef: { type: "dashboard_snapshot", id: snapshotId, label: "Dashboard" },
          trace: { dashboardSnapshotId: snapshotId },
        }),
      ],
      projectId,
      isClientContext: true,
    });

    expect(result.valid).toHaveLength(0);
    expect(result.dropped.map((item) => item.reason)).toEqual(
      expect.arrayContaining(["client_forbidden"])
    );
  });

  it("drops non-whitelisted dashboard filters in internal context", async () => {
    const service = new OpenTargetValidationService(prismaMock() as never);

    const result = await service.validate({
      targets: [{ targetType: "dashboard_filter", targetRef: { filter: "raw_sql", value: "select *" } }],
      citations: [{ type: "dashboard_snapshot", refId: snapshotId, label: "Dashboard" }],
      evidenceCards: [
        card({
          citationRef: { type: "dashboard_snapshot", id: snapshotId, label: "Dashboard" },
          trace: { dashboardSnapshotId: snapshotId },
        }),
      ],
      projectId,
      isClientContext: false,
    });

    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0]?.reason).toBe("invalid_dashboard_filter");
  });

  it("drops dashboard filters in client context even when backed by a dashboard citation", async () => {
    const service = new OpenTargetValidationService(prismaMock() as never);

    const result = await service.validate({
      targets: [{ targetType: "dashboard_filter", targetRef: { filter: "status", value: "review_pressure" } }],
      citations: [{ type: "dashboard_snapshot", refId: snapshotId, label: "Dashboard" }],
      evidenceCards: [
        card({
          citationRef: { type: "dashboard_snapshot", id: snapshotId, label: "Dashboard" },
          trace: { dashboardSnapshotId: snapshotId },
        }),
      ],
      projectId,
      isClientContext: true,
    });

    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0]?.reason).toBe("client_forbidden");
  });


  it("drops live doc targets that are not backed by a validated live doc citation", async () => {
    const service = new OpenTargetValidationService(prismaMock() as never);

    const result = await service.validate({
      targets: [{ targetType: "live_doc_section", targetRef: { sectionKey: "overview" } }],
      citations: [],
      evidenceCards: [],
      projectId,
      isClientContext: false,
    });

    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0]?.reason).toBe("not_backed_by_citation");
  });

  it("drops brain-node targets from a superseded graph version", async () => {
    const prisma = prismaMock();
    prisma.artifactVersion.findFirst.mockResolvedValue({ id: currentGraphId, projectId, artifactType: "brain_graph", status: "accepted" });
    prisma.brainNode.findFirst.mockResolvedValue({
      id: brainNodeId,
      projectId,
      artifactVersionId: oldGraphId,
      title: "Old node",
    });
    const service = new OpenTargetValidationService(prisma as never);

    const result = await service.validate({
      targets: [{ targetType: "brain_node", targetRef: { nodeId: brainNodeId } }],
      citations: [{ type: "brain_node", refId: brainNodeId, label: "Old node" }],
      evidenceCards: [
        card({
          sourceType: "brain_node",
          citationRef: { type: "brain_node", id: brainNodeId, label: "Old node" },
          trace: { brainNodeId },
        }),
      ],
      projectId,
      isClientContext: false,
    });

    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0]?.reason).toBe("stale_or_not_current");
  });

  it("validates project diagram and embedded Live Doc open targets", async () => {
    const prisma = prismaMock();
    prisma.artifactVersion.findFirst.mockResolvedValue({
      id: "live-doc-1",
      projectId,
      artifactType: "live_doc",
      status: "accepted",
      payloadJson: {
        generatedFromProductBrainId: "11111111-1111-4111-8111-111111111111",
        sourceRefs: [],
        sections: [
          {
            sectionKey: "overview",
            anchorId: "overview",
            sectionLabel: "Overview",
            type: "body",
            content: "Current truth.",
            sourceRefs: [],
          },
        ],
      },
    });
    const service = new OpenTargetValidationService(prisma as never);
    const result = await service.validate({
      targets: [
        { targetType: "project_diagram", targetRef: { projectId, diagramId } },
        { targetType: "live_doc_section", targetRef: { sectionKey: "overview", diagramId } },
      ],
      citations: [{ type: "project_diagram", refId: diagramId, label: "Overview flow" }],
      evidenceCards: [
        card({
          sourceType: "project_diagram",
          citationRef: { type: "project_diagram", id: diagramId, label: "Overview flow" },
          trace: { diagramId },
        }),
      ],
      projectId,
      isClientContext: false,
    });

    expect(result.valid).toHaveLength(2);
  });

  it("validates coding requirements open targets against accepted engineering artifacts", async () => {
    const service = new OpenTargetValidationService(prismaMock() as never);
    const result = await service.validate({
      targets: [
        {
          targetType: "coding_requirements",
          targetRef: { projectId, codingRequirementsId, artifactVersionId: engineeringArtifactId }
        }
      ],
      citations: [{ type: "coding_requirements", refId: codingRequirementsId, label: "Current Coding Requirements" }],
      evidenceCards: [
        card({
          sourceType: "coding_requirements",
          citationRef: { type: "coding_requirements", id: codingRequirementsId, label: "Current Coding Requirements" },
          trace: { codingRequirementsId, artifactVersionId: engineeringArtifactId },
        }),
      ],
      projectId,
      isClientContext: false,
    });

    expect(result.valid).toHaveLength(1);

    const unbacked = await service.validate({
      targets: [
        {
          targetType: "coding_requirements",
          targetRef: { projectId, codingRequirementsId, artifactVersionId: engineeringArtifactId }
        }
      ],
      citations: [],
      evidenceCards: [],
      projectId,
      isClientContext: false,
    });
    expect(unbacked.valid).toHaveLength(0);
    expect(unbacked.dropped[0]?.reason).toBe("not_backed_by_citation");
  });
});
