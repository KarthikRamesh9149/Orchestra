import { describe, expect, it, vi, beforeEach } from "vitest";
import { LiveDocService } from "../src/modules/live-doc/service.js";

const productBrainPayload = {
  whatTheProductIs: "A project brain for client-facing software teams.",
  whoItIsFor: ["Managers", "Developers"],
  mainFlows: ["Collect source docs", "Accept reviewed changes"],
  modules: ["Dashboard", "Product Brain", "Live Doc Viewer"],
  constraints: ["Only accepted changes become truth"],
  integrations: ["Slack", "Gmail"],
  unresolvedAreas: ["None"],
  acceptedDecisions: [],
  recentAcceptedChanges: [],
  evidenceRefs: []
};

describe("LiveDocService", () => {
  let prisma: any;
  let projectService: any;
  let auditService: any;
  let changeProposalService: any;
  let generationProvider: any;
  let service: LiveDocService;

  beforeEach(() => {
    prisma = {
      artifactVersion: {
        findFirst: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn()
      },
      projectLiveDocSource: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn()
      },
      documentVersion: {
        findFirst: vi.fn()
      },
      documentSection: {
        findMany: vi.fn(async () => [])
      },
      specChangeProposal: {
        findMany: vi.fn(async () => [])
      },
      specChangeLink: {
        findMany: vi.fn(async () => [])
      },
      decisionRecord: {
        findMany: vi.fn(async () => [])
      },
      communicationMessage: {
        findMany: vi.fn(async () => [])
      },
      liveDocSectionRevision: {
        upsert: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(async () => [])
      },
      liveDocSectionDraft: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        findMany: vi.fn(async () => [])
      },
      liveDocComment: {
        create: vi.fn(),
        findMany: vi.fn(async () => [])
      },
      liveDocSectionDiagram: {
        findMany: vi.fn(async () => [])
      },
      projectCodingRequirements: {
        findFirst: vi.fn(async () => null)
      },
      project: {
        findUniqueOrThrow: vi.fn(async () => ({ id: "project-1", orgId: "org-1", name: "Project Alpha" }))
      },
      $transaction: vi.fn(async (callback: (tx: any) => Promise<any>) => callback(prisma))
    };

    projectService = {
      ensureProjectAccess: vi.fn(async () => ({ projectRole: "manager" }))
    };
    auditService = {
      record: vi.fn(async () => undefined)
    };
    changeProposalService = {
      createOrUpdateSystemProposal: vi.fn(async () => ({
        id: "proposal-1",
        title: "Live doc update: Product Overview",
        status: "needs_review"
      }))
    };
    generationProvider = {
      generateObject: vi.fn(async ({ fallback }: { fallback: () => unknown }) => fallback())
    };

    service = new LiveDocService(prisma, generationProvider, projectService, auditService, changeProposalService);
  });

  it("lists communication-derived change markers with Slack provenance", async () => {
    const createdAt = new Date("2026-05-29T01:00:00.000Z");
    prisma.specChangeProposal.findMany.mockResolvedValue([
      {
        id: "proposal-1",
        title: "Update onboarding requirement",
        summary: "Slack clarified that manager approval is required.",
        status: "needs_review",
        oldUnderstandingJson: { text: "Approval optional" },
        newUnderstandingJson: { text: "Manager approval required" },
        acceptedAt: null,
        createdAt,
        accepter: null,
        links: [
          { linkType: "message", linkRefId: "message-1" },
          { linkType: "document_section", linkRefId: "section-1" }
        ]
      }
    ]);
    prisma.communicationMessage.findMany.mockResolvedValue([
      {
        id: "message-1",
        threadId: "thread-1",
        senderLabel: "PM",
        sentAt: createdAt,
        bodyText: "For onboarding, manager approval is required before activation.",
        providerPermalink: "https://example.slack.com/archives/C123/p1"
      }
    ]);

    const markers = await service.listChangeMarkers("project-1", "manager-1");

    expect(projectService.ensureProjectAccess).toHaveBeenCalledWith("project-1", "manager-1");
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      proposalId: "proposal-1",
      status: "pending",
      documentSectionId: "section-1",
      sourceMessages: [
        expect.objectContaining({
          messageId: "message-1",
          threadId: "thread-1",
          providerPermalink: "https://example.slack.com/archives/C123/p1"
        })
      ]
    });
  });

  it("materializes a live doc artifact from the accepted product brain", async () => {
    prisma.artifactVersion.findFirst.mockImplementation(async ({ where }: { where: { artifactType: string } }) => {
      if (where.artifactType === "product_brain") {
        return {
          id: "brain-1",
          projectId: "project-1",
          artifactType: "product_brain",
          versionNumber: 3,
          payloadJson: productBrainPayload,
          status: "accepted",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          acceptedAt: new Date("2026-01-01T00:00:00.000Z"),
          changeSummary: "brain"
        };
      }

      return null;
    });
    prisma.artifactVersion.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "live-doc-1",
      ...data
    }));

    const artifact = await service.refreshCurrentArtifact("project-1", "user-1", { reason: "test_refresh" });

    expect(artifact.id).toBe("live-doc-1");
    expect(prisma.artifactVersion.create).toHaveBeenCalled();
    expect(prisma.liveDocSectionRevision.upsert).toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalled();
  });

  it("returns PRD-backed sections when a primary Live Doc source exists", async () => {
    prisma.projectLiveDocSource.findUnique.mockResolvedValue({
      id: "source-1",
      orgId: "org-1",
      projectId: "project-1",
      documentId: "doc-1",
      documentVersionId: "ver-1",
      sourceKind: "uploaded_prd",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      setByUserId: "user-1",
      document: {
        id: "doc-1",
        title: "Core PRD",
        kind: "prd",
        currentVersionId: "ver-1"
      },
      documentVersion: {
        id: "ver-1",
        status: "ready",
        parseRevision: 2,
        sourceLabel: "Uploaded PRD",
        processedAt: new Date("2026-01-02T00:00:00.000Z")
      },
      setter: { id: "user-1", displayName: "Dana Manager" }
    });
    prisma.documentSection.findMany.mockResolvedValue([
      {
        id: "section-1",
        documentVersionId: "ver-1",
        projectId: "project-1",
        anchorId: "overview",
        headingPath: ["Overview"],
        pageNumber: 1,
        normalizedText: "Original overview text.",
        orderIndex: 0
      }
    ]);

    const current = await service.getCurrent("project-1", "user-1") as any;

    expect(current.sourceStatus).toBe("ready");
    expect(current.source.documentId).toBe("doc-1");
    expect(current.sections[0]).toMatchObject({
      id: "doc:section-1",
      sectionKey: "doc:section-1",
      documentSectionId: "section-1",
      sourceDocumentId: "doc-1",
      sourceDocumentVersionId: "ver-1",
      originalText: "Original overview text.",
      currentText: "Original overview text.",
      effectiveText: "Original overview text.",
      content: "Original overview text.",
      hasCurrentTruthOverlay: false,
      hasPendingReview: false
    });
  });

  it("shows communication proposals as PRD-backed review markers without changing current truth until accepted", async () => {
    prisma.projectLiveDocSource.findUnique.mockResolvedValue({
      id: "source-1",
      orgId: "org-1",
      projectId: "project-1",
      documentId: "doc-1",
      documentVersionId: "ver-1",
      sourceKind: "uploaded_prd",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      setByUserId: "user-1",
      document: { id: "doc-1", title: "Core PRD", kind: "prd", currentVersionId: "ver-1" },
      documentVersion: { id: "ver-1", status: "ready", parseRevision: 2, processedAt: new Date("2026-01-02T00:00:00.000Z") },
      setter: { id: "user-1", displayName: "Dana Manager" }
    });
    prisma.documentSection.findMany.mockResolvedValue([
      {
        id: "section-1",
        documentVersionId: "ver-1",
        projectId: "project-1",
        anchorId: "payments",
        headingPath: ["Payments"],
        pageNumber: 2,
        normalizedText: "Original payment text.",
        orderIndex: 0
      }
    ]);
    prisma.specChangeLink.findMany.mockResolvedValue([
      {
        linkRefId: "section-1",
        proposal: {
          id: "proposal-pending",
          title: "Client asked for ACH payments",
          summary: "Fireflies transcript suggests ACH support.",
          status: "needs_review",
          links: [
            { linkType: "document_section", linkRefId: "section-1" },
            { linkType: "brain_node", linkRefId: "brain-1" },
            { linkType: "message", linkRefId: "msg-1" },
            { linkType: "thread", linkRefId: "thread-1" }
          ]
        }
      },
      {
        linkRefId: "section-1",
        proposal: {
          id: "proposal-rejected",
          title: "Rejected change",
          summary: "Rejected changes are not current truth.",
          status: "rejected",
          links: [{ linkType: "document_section", linkRefId: "section-1" }]
        }
      }
    ]);

    const current = await service.getCurrent("project-1", "user-1") as any;
    const section = current.sections[0];

    expect(section.currentText).toBe("Original payment text.");
    expect(section.hasPendingReview).toBe(true);
    expect(section.pendingMarkers).toHaveLength(1);
    expect(section.pendingMarkers[0]).toMatchObject({
      markerType: "pending_review_internal_only",
      proposalId: "proposal-pending",
      affectedDocumentSectionId: "section-1",
      linkedBrainNodeIds: ["brain-1"],
      linkedMessageRefs: [{ messageId: "msg-1" }],
      linkedThreadRefs: [{ threadId: "thread-1" }]
    });
    expect(JSON.stringify(section)).not.toContain("proposal-rejected");
  });

  it("lists Live Doc review items for a mapped PRD section", async () => {
    prisma.specChangeProposal.findMany.mockResolvedValue([
      {
        id: "proposal-pending",
        title: "Client asked for ACH payments",
        summary: "Fireflies transcript suggests ACH support.",
        status: "needs_review",
        proposalType: "requirement_change",
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
        updatedAt: new Date("2026-01-03T00:00:00.000Z"),
        links: [
          { linkType: "document_section", linkRefId: "section-1" },
          { linkType: "brain_node", linkRefId: "brain-1" },
          { linkType: "message", linkRefId: "msg-1" },
          { linkType: "thread", linkRefId: "thread-1" }
        ],
        decisionRecord: null
      }
    ]);

    const items = await service.listReviewItems("project-1", "user-1", { sectionKey: "doc:section-1" }) as any;

    expect(prisma.specChangeProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["detected", "needs_review"] },
          links: { some: { linkType: "document_section", linkRefId: "section-1" } }
        })
      })
    );
    expect(items[0]).toMatchObject({
      proposalId: "proposal-pending",
      markerType: "pending_review_internal_only",
      sectionKeys: ["doc:section-1"],
      linkedBrainNodeIds: ["brain-1"],
      linkedMessageRefs: [{ messageId: "msg-1" }],
      linkedThreadRefs: [{ threadId: "thread-1" }]
    });
  });

  it("creates a draft revision and linked proposal when a section is edited", async () => {
    vi.spyOn(service as any, "ensureCurrentArtifact").mockResolvedValue({
      id: "live-doc-1",
      versionNumber: 1,
      payloadJson: {
        generatedFromProductBrainId: "11111111-1111-1111-1111-111111111111",
        sourceRefs: [],
        sections: [
          {
            sectionKey: "overview",
            anchorId: "overview",
            sectionLabel: "Product Overview",
            type: "highlighted",
            content: "Manager approval is required.",
            highlight: "Current accepted product truth",
            sourceRefs: []
          }
        ]
      }
    });
    vi.spyOn(service as any, "resolveImpact").mockResolvedValue({
      affectedDocumentSectionIds: ["section-1"],
      affectedBrainNodeIds: ["node-1"],
      communicationMessageIds: []
    });
    vi.spyOn(service as any, "getSectionHistory").mockResolvedValue({
      section: { sectionKey: "overview", sectionLabel: "Product Overview", anchorId: "overview", currentContent: "Manager approval is required." },
      revisions: [{ revisionId: "revision-1", eventType: "draft_created" }]
    });
    vi.spyOn(service as any, "getCurrent").mockResolvedValue({
      status: "review"
    });

    prisma.liveDocSectionDraft.findUnique.mockResolvedValue(null);
    prisma.liveDocSectionDraft.upsert.mockResolvedValue({
      id: "draft-1",
      sectionKey: "overview",
      sectionLabel: "Product Overview",
      proposedContent: "Manager approval is required and logged.",
      status: "needs_review",
      linkedProposalId: "proposal-1",
      updatedAt: new Date("2026-01-02T00:00:00.000Z")
    });

    const result = await service.patchSection("project-1", "overview", "user-1", {
      content: "Manager approval is required and logged."
    });

    expect(changeProposalService.createOrUpdateSystemProposal).toHaveBeenCalled();
    expect(prisma.liveDocSectionDraft.upsert).toHaveBeenCalled();
    expect(prisma.liveDocSectionRevision.create).toHaveBeenCalled();
    expect(result.draft.status).toBe("needs_review");
    expect(result.linkedProposal).toMatchObject({ id: "proposal-1" });
  });

  it("edits PRD-backed sections as drafts without mutating original document sections", async () => {
    prisma.projectLiveDocSource.findUnique.mockResolvedValue({
      id: "source-1",
      orgId: "org-1",
      projectId: "project-1",
      documentId: "doc-1",
      documentVersionId: "ver-1",
      sourceKind: "uploaded_prd",
      document: {
        id: "doc-1",
        title: "Core PRD",
        kind: "prd",
        currentVersionId: "ver-1"
      },
      documentVersion: {
        id: "ver-1",
        status: "ready",
        parseRevision: 2
      },
      setter: { id: "user-1", displayName: "Dana Manager" }
    });
    prisma.documentSection.findMany.mockResolvedValue([
      {
        id: "section-1",
        documentVersionId: "ver-1",
        projectId: "project-1",
        anchorId: "overview",
        headingPath: ["Overview"],
        pageNumber: 1,
        normalizedText: "Original overview text.",
        orderIndex: 0
      }
    ]);
    vi.spyOn(service as any, "resolveImpact").mockResolvedValue({
      affectedDocumentSectionIds: ["section-1"],
      affectedBrainNodeIds: ["node-1"],
      communicationMessageIds: []
    });
    prisma.liveDocSectionDraft.findUnique.mockResolvedValue(null);
    prisma.liveDocSectionDraft.upsert.mockResolvedValue({
      id: "draft-1",
      sectionKey: "doc:section-1",
      sectionLabel: "Overview",
      proposedContent: "Accepted users can invite teammates.",
      status: "needs_review",
      linkedProposalId: "proposal-1",
      updatedAt: new Date("2026-01-02T00:00:00.000Z")
    });
    prisma.documentSection.update = vi.fn();

    const result = await service.patchSection("project-1", "doc:section-1", "user-1", {
      content: "Accepted users can invite teammates."
    });

    expect(prisma.documentSection.update).not.toHaveBeenCalled();
    expect(prisma.liveDocSectionDraft.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          sectionKey: "doc:section-1",
          sourceDocumentId: "doc-1",
          sourceDocumentVersionId: "ver-1",
          documentSectionId: "section-1",
          anchorId: "overview",
          baseContent: "Original overview text."
        })
      })
    );
    expect(result.draft.status).toBe("needs_review");
  });

  it("returns actor-attributed section history", async () => {
    vi.spyOn(service as any, "ensureCurrentArtifact").mockResolvedValue({
      id: "live-doc-1",
      versionNumber: 1,
      payloadJson: {
        generatedFromProductBrainId: "11111111-1111-1111-1111-111111111111",
        sourceRefs: [],
        sections: [
          {
            sectionKey: "overview",
            anchorId: "overview",
            sectionLabel: "Product Overview",
            type: "highlighted",
            content: "Current truth.",
            highlight: null,
            sourceRefs: []
          }
        ]
      }
    });

    prisma.liveDocSectionRevision.findMany.mockResolvedValue([
      {
        id: "revision-1",
        sectionKey: "overview",
        eventType: "draft_updated",
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
        previousContent: "Old truth.",
        nextContent: "Current truth.",
        changeSummary: "Updated wording",
        actor: {
          id: "user-1",
          displayName: "Dana Manager"
        },
        proposal: null
      }
    ]);

    const history = await service.getSectionHistory("project-1", "overview", "user-1");

    expect(history.section.sectionKey).toBe("overview");
    expect(history.revisions[0].actor?.displayName).toBe("Dana Manager");
    expect(history.revisions[0].previousContent).toBe("Old truth.");
  });

  it("projects overlay marker taxonomy for accepted and internal-only section state", async () => {
    vi.spyOn(service as any, "ensureCurrentArtifact").mockResolvedValue({
      id: "live-doc-1",
      versionNumber: 1,
      acceptedAt: new Date("2026-01-04T00:00:00.000Z"),
      createdAt: new Date("2026-01-04T00:00:00.000Z"),
      payloadJson: {
        generatedFromProductBrainId: "11111111-1111-1111-1111-111111111111",
        sourceRefs: [],
        sections: [
          {
            sectionKey: "reporting",
            anchorId: "reporting",
            sectionLabel: "Reporting",
            type: "body",
            content: "Weekly reporting is current truth.",
            highlight: null,
            sourceRefs: [
              {
                refType: "change_proposal",
                refId: "proposal-accepted",
                label: "Weekly reporting accepted"
              },
              {
                refType: "decision_record",
                refId: "decision-accepted",
                label: "Weekly cadence decision"
              }
            ]
          }
        ]
      }
    });

    prisma.liveDocSectionDraft.findMany.mockResolvedValue([
      {
        id: "draft-1",
        sectionKey: "reporting",
        status: "needs_review",
        proposedContent: "Weekly reporting is current truth with exports.",
        updatedAt: new Date("2026-01-05T00:00:00.000Z"),
        creator: { id: "user-1", displayName: "Dana Manager" },
        linkedProposal: { id: "proposal-pending", title: "Pending export change", status: "needs_review" }
      }
    ]);

    const current = await service.getCurrent("project-1", "user-1") as any;
    const section = current.sections.find((candidate: any) => candidate.id === "reporting");

    expect(section).toBeDefined();
    if (!section) throw new Error("Expected reporting section");
    expect(section.overlayMarkers.map((marker: any) => marker.markerType)).toEqual(
      expect.arrayContaining(["accepted_change", "accepted_decision", "pending_review_internal_only"])
    );
    expect(section.overlayMarkers.find((marker: any) => marker.markerType === "pending_review_internal_only")?.visibility).toBe("internal");
  });

  it("includes active embedded diagrams in current Live Doc sections", async () => {
    vi.spyOn(service as any, "ensureCurrentArtifact").mockResolvedValue({
      id: "live-doc-1",
      versionNumber: 1,
      acceptedAt: new Date("2026-01-04T00:00:00.000Z"),
      createdAt: new Date("2026-01-04T00:00:00.000Z"),
      payloadJson: {
        generatedFromProductBrainId: "11111111-1111-1111-1111-111111111111",
        sourceRefs: [],
        sections: [
          {
            sectionKey: "overview",
            anchorId: "overview",
            sectionLabel: "Product Overview",
            type: "body",
            content: "Current truth.",
            highlight: null,
            sourceRefs: []
          }
        ]
      }
    });
    prisma.liveDocSectionDiagram.findMany.mockResolvedValue([
      {
        id: "embed-1",
        sectionKey: "overview",
        sortOrder: 1,
        embeddedAt: new Date("2026-01-05T00:00:00.000Z"),
        diagram: {
          id: "diagram-1",
          title: "Overview flow",
          description: "Embedded diagram",
          diagramType: "flowchart",
          mermaidSource: "flowchart TD\n  A --> B",
          source: "user_created"
        }
      }
    ]);

    const current = await service.getCurrent("project-1", "user-1") as any;

    expect(current.sections[0].diagrams).toEqual([
      expect.objectContaining({
        id: "diagram-1",
        title: "Overview flow",
        mermaidSource: "flowchart TD\n  A --> B",
        sortOrder: 1
      })
    ]);
  });

  it("injects read-only coding requirements sections without rewriting accepted Live Doc content", async () => {
    vi.spyOn(service as any, "ensureCurrentArtifact").mockResolvedValue({
      id: "live-doc-1",
      versionNumber: 1,
      acceptedAt: new Date("2026-01-04T00:00:00.000Z"),
      createdAt: new Date("2026-01-04T00:00:00.000Z"),
      payloadJson: {
        generatedFromProductBrainId: "11111111-1111-1111-1111-111111111111",
        sourceRefs: [],
        sections: [
          {
            sectionKey: "overview",
            anchorId: "overview",
            sectionLabel: "Product Overview",
            type: "body",
            content: "Accepted Live Doc content.",
            highlight: null,
            sourceRefs: []
          }
        ]
      }
    });
    prisma.projectCodingRequirements.findFirst.mockResolvedValue({
      id: "coding-1",
      projectId: "project-1",
      artifactVersionId: "artifact-1",
      mermaidDiagramId: "diagram-1",
      createdAt: new Date("2026-01-05T00:00:00.000Z"),
      artifactVersion: {
        id: "artifact-1",
        payloadJson: {
          summary: "Build authentication before dashboard.",
          modules: [
            {
              name: "Authentication",
              purpose: "Protect internal routes.",
              requirements: ["Require internal auth."],
              apis: [],
              dataModels: [],
              dependencies: [],
              risks: [],
              suggestedBuildOrder: 1,
              assumptions: [],
              unknowns: [],
              citations: [],
              openTargets: []
            }
          ],
          globalRequirements: [],
          integrationPoints: [],
          assumptions: [],
          unknowns: ["Confirm deployment target."],
          suggestedBuildOrder: [{ order: 1, moduleName: "Authentication", reason: "Auth gates internal routes.", dependencies: [] }],
          mermaid: "flowchart TD\n  auth[Authentication] --> dashboard[Dashboard]",
          citations: [],
          openTargets: [],
          generatedAt: "2026-05-19T00:00:00.000Z",
          evidenceSummary: { sourceCounts: {}, lowEvidence: false, limitations: [] }
        }
      },
      mermaidDiagram: {
        id: "diagram-1",
        title: "Main Coding Flowchart",
        diagramType: "coding_flow",
        mermaidSource: "flowchart TD\n  auth[Authentication] --> dashboard[Dashboard]",
        source: "socrates_generated",
        description: "Derived flowchart.",
        status: "active"
      }
    });

    const current = await service.getCurrent("project-1", "user-1") as any;

    expect(current.sections.find((section: any) => section.id === "overview")?.content).toBe("Accepted Live Doc content.");
    expect(current.sections.find((section: any) => section.id === "coding_requirements")?.content).toContain("Build authentication");
    expect(current.sections.find((section: any) => section.id === "main_coding_flowchart")?.diagrams[0]).toMatchObject({
      id: "diagram-1",
      diagramType: "coding_flow"
    });
    expect(current.sections.find((section: any) => section.id === "implementation_unknowns")?.content).toContain("Confirm deployment target");
  });

  it("omits deleted coding flowchart diagrams from derived Live Doc sections", async () => {
    vi.spyOn(service as any, "ensureCurrentArtifact").mockResolvedValue({
      id: "live-doc-1",
      versionNumber: 1,
      acceptedAt: new Date("2026-01-04T00:00:00.000Z"),
      createdAt: new Date("2026-01-04T00:00:00.000Z"),
      payloadJson: {
        generatedFromProductBrainId: "11111111-1111-1111-1111-111111111111",
        sourceRefs: [],
        sections: [
          {
            sectionKey: "overview",
            anchorId: "overview",
            sectionLabel: "Product Overview",
            type: "body",
            content: "Accepted Live Doc content.",
            highlight: null,
            sourceRefs: []
          }
        ]
      }
    });
    prisma.projectCodingRequirements.findFirst.mockResolvedValue({
      id: "coding-1",
      projectId: "project-1",
      artifactVersionId: "artifact-1",
      mermaidDiagramId: "diagram-1",
      createdAt: new Date("2026-01-05T00:00:00.000Z"),
      artifactVersion: {
        id: "artifact-1",
        payloadJson: {
          summary: "Build authentication before dashboard.",
          modules: [
            {
              name: "Authentication",
              purpose: "Protect internal routes.",
              requirements: ["Require internal auth."],
              apis: [],
              dataModels: [],
              dependencies: [],
              risks: [],
              suggestedBuildOrder: 1,
              assumptions: [],
              unknowns: [],
              citations: [],
              openTargets: []
            }
          ],
          globalRequirements: [],
          integrationPoints: [],
          assumptions: [],
          unknowns: [],
          suggestedBuildOrder: [{ order: 1, moduleName: "Authentication", reason: "Auth gates internal routes.", dependencies: [] }],
          mermaid: "flowchart TD\n  auth[Authentication] --> dashboard[Dashboard]",
          citations: [],
          openTargets: [],
          generatedAt: "2026-05-19T00:00:00.000Z",
          evidenceSummary: { sourceCounts: {}, lowEvidence: false, limitations: [] }
        }
      },
      mermaidDiagram: {
        id: "diagram-1",
        title: "Main Coding Flowchart",
        diagramType: "coding_flow",
        mermaidSource: "flowchart TD\n  auth[Authentication] --> dashboard[Dashboard]",
        source: "socrates_generated",
        description: "Deleted flowchart.",
        status: "deleted"
      }
    });

    const current = await service.getCurrent("project-1", "user-1") as any;
    expect(current.sections.find((section: any) => section.id === "main_coding_flowchart")?.diagrams).toEqual([]);
  });

  it("excludes provider-deleted source messages from generated live doc provenance refs", async () => {
    prisma.documentSection.findMany.mockResolvedValue([]);
    prisma.specChangeProposal.findMany.mockResolvedValue([
      {
        id: "proposal-1",
        title: "Accepted reporting change",
        links: [
          { linkType: "message", linkRefId: "msg-active" },
          { linkType: "message", linkRefId: "msg-deleted" }
        ]
      }
    ]);
    prisma.communicationMessage.findMany.mockImplementation(async ({ where }: any) => {
      const messages = [
        {
          id: "msg-active",
          senderLabel: "Client",
          bodyText: "Please add weekly reporting.",
          isDeletedByProvider: false
        },
        {
          id: "msg-deleted",
          senderLabel: "Client",
          bodyText: "Deleted source request.",
          isDeletedByProvider: true
        }
      ];
      const scoped = messages.filter((message) => where.id.in.includes(message.id));
      return where.isDeletedByProvider === false
        ? scoped.filter((message) => message.isDeletedByProvider === false)
        : scoped;
    });

    const sections = await (service as any).compileSections("project-1", {
      ...productBrainPayload,
      recentAcceptedChanges: [
        {
          proposalId: "proposal-1",
          title: "Accepted reporting change",
          summary: "Weekly reporting was accepted."
        }
      ]
    });

    const recentChanges = sections.find((section: any) => section.sectionKey === "recent-changes");
    expect(recentChanges?.sourceRefs.filter((ref: any) => ref.refType === "message").map((ref: any) => ref.refId))
      .toEqual(["msg-active"]);
    expect(prisma.communicationMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isDeletedByProvider: false
        })
      })
    );
  });
});
