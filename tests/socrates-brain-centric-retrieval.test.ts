import { describe, expect, it, vi } from "vitest";
import { hybridRetrieveDetailed } from "../src/lib/retrieval/hybrid.js";
import { buildRetrievalPlan, domainsFromPlan } from "../src/lib/retrieval/planner.js";
import { rerank } from "../src/lib/retrieval/rerank.js";

const baseInput = {
  projectId: "project-1",
  queryEmbedding: [0.1, 0.2],
  topK: 8,
  minScore: 0,
  isClientContext: false,
  acceptedTruthBoost: 1.2,
  docWeight: 1,
  commWeight: 0.8,
};

function makePrisma() {
  const artifactVersion = {
    findFirst: vi.fn(async ({ where }: any) => {
      if (where.artifactType === "product_brain") {
        return {
          id: "brain-1",
          versionNumber: 5,
          sourceRefsJson: { documentSectionIds: ["section-1"] },
          payloadJson: {
            whatTheProductIs: "Current accepted reporting requires managers to get weekly exception reports.",
            modules: ["Manager reporting"],
          },
        };
      }
      return null;
    }),
  };

  return {
    artifactVersion,
    documentSection: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    specChangeLink: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    specChangeProposal: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "proposal-1",
          title: "Weekly exception reporting",
          summary: "Accepted change: managers get weekly exception reports.",
        },
      ]),
    },
    decisionRecord: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    communicationMessage: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    dashboardSnapshot: {
      findFirst: vi.fn().mockResolvedValue({
        id: "snapshot-1",
        payloadJson: { brainFreshness: { status: "fresh" }, communicationSummary: { openItems: 1 } },
      }),
    },
    $queryRawUnsafe: vi.fn().mockResolvedValue([
      {
        id: "chunk-1",
        section_id: "section-1",
        content: "Old PRD says managers get monthly static reports.",
        contextual_content: "Reporting\nOld PRD says managers get monthly static reports.",
        lexical_content: "reporting managers monthly static reports",
        page_number: 2,
        document_version_id: "version-1",
        metadata_json: {},
        visibility: "internal",
        doc_title: "Original PRD",
        anchor_id: "anchor-reporting",
        vec_dist: 0.05,
      },
    ]),
  } as any;
}

function makeDocViewerPrisma() {
  const selectedSection = {
    id: "section-selected",
    documentVersionId: "version-1",
    parseRevision: 1,
    orderIndex: 10,
    normalizedText: "Selected section says managers approve assignment activation before launch.",
    anchorText: "Assignment activation approval",
    anchorId: "anchor-selected",
    headingPath: ["Assignments"],
    pageNumber: 4,
    documentVersion: {
      document: { title: "Launch PRD", visibility: "internal" },
    },
  };
  const neighborSection = {
    ...selectedSection,
    id: "section-neighbor",
    orderIndex: 11,
    normalizedText: "Neighbor section describes activation audit notifications.",
    anchorId: "anchor-neighbor",
  };

  return {
    artifactVersion: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.artifactType === "product_brain") {
          return {
            id: "brain-1",
            versionNumber: 2,
            sourceRefsJson: {},
            payloadJson: { whatTheProductIs: "Assignment activation brain", modules: ["Assignments"] },
          };
        }
        return null;
      }),
    },
    documentSection: {
      findFirst: vi.fn().mockResolvedValue({
        documentVersionId: "version-1",
        orderIndex: 10,
        parseRevision: 1,
      }),
      findMany: vi.fn(async ({ where, select }: any) => {
        if (select?.id) return [{ id: "section-neighbor" }];
        const ids = where.id?.in ?? [];
        return [selectedSection, neighborSection].filter((section) => ids.includes(section.id));
      }),
    },
    specChangeLink: {
      findMany: vi
        .fn()
        .mockImplementation(async ({ where }: any) => {
          if (where.linkType === "document_section") {
            return [
              {
                specChangeProposalId: "proposal-1",
                linkRefId: "section-selected",
                proposal: {
                  id: "proposal-1",
                  title: "Assignment approval",
                  summary: "Accepted change requires manager approval before assignment activation.",
                  decisionRecordId: "decision-1",
                },
              },
            ];
          }
          if (where.linkType === "message") {
            return [{ specChangeProposalId: "proposal-1", linkRefId: "message-1" }];
          }
          return [];
        }),
    },
    specChangeProposal: { findMany: vi.fn().mockResolvedValue([]) },
    decisionRecord: { findMany: vi.fn().mockResolvedValue([]) },
    communicationMessage: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "message-1",
          bodyText: "Client confirmed manager approval is required.",
          senderLabel: "Client",
          threadId: "thread-1",
          thread: { subject: "Assignment approval" },
        },
      ]),
    },
    dashboardSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
    $queryRawUnsafe: vi.fn().mockResolvedValue([
      {
        id: "chunk-unrelated",
        section_id: "section-other",
        content: "Unrelated billing section",
        contextual_content: "Billing\nUnrelated billing section",
        lexical_content: "billing invoice payment",
        page_number: 9,
        document_version_id: "version-1",
        metadata_json: {},
        visibility: "internal",
        doc_title: "Launch PRD",
        anchor_id: "anchor-other",
        vec_dist: 0.01,
      },
    ]),
  } as any;
}

describe("brain-centric retrieval orchestration", () => {
  it("ranks accepted Product Brain before stale source chunks for current-truth questions", async () => {
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

    const raw = await hybridRetrieveDetailed(makePrisma(), {} as any, "org-1", {
      ...baseInput,
      query: "What is the current reporting requirement?",
      intent: "current_truth",
      domains: domainsFromPlan(plan),
      plan,
    });
    const ranked = rerank({
      candidates: raw.candidates,
      pageContext: "brain_overview",
      intent: "current_truth",
      topK: 8,
      isClientContext: false,
      plan,
    });

    expect(raw.telemetry.brainCandidateCount).toBe(1);
    expect(ranked[0].sourceType).toBe("product_brain");
  });

  it("ranks original source evidence before Product Brain for provenance questions", async () => {
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

    const raw = await hybridRetrieveDetailed(makePrisma(), {} as any, "org-1", {
      ...baseInput,
      query: "Where was reporting first mentioned?",
      intent: "original_source",
      domains: domainsFromPlan(plan),
      plan,
    });
    const ranked = rerank({
      candidates: raw.candidates,
      pageContext: "doc_viewer",
      intent: "original_source",
      topK: 8,
      isClientContext: false,
      plan,
    });

    expect(ranked[0].sourceType).toBe("document_chunk");
  });

  it("ranks dashboard snapshot first for dashboard status questions", async () => {
    const plan = buildRetrievalPlan({
      intent: "dashboard_status",
      pageContext: "dashboard_project",
      selectedRefType: null,
      selectedRefId: null,
      viewerState: null,
      isClientContext: false,
      retrievalTopK: 32,
      rerankTopK: 8,
    });

    const raw = await hybridRetrieveDetailed(makePrisma(), {} as any, "org-1", {
      ...baseInput,
      query: "What is the project status?",
      intent: "dashboard_status",
      domains: domainsFromPlan(plan),
      plan,
    });
    const ranked = rerank({
      candidates: raw.candidates,
      pageContext: "dashboard_project",
      intent: "dashboard_status",
      topK: 8,
      isClientContext: false,
      plan,
    });

    expect(ranked[0].sourceType).toBe("dashboard_snapshot");
  });

  it("retrieves project responsibilities first for team ownership questions", async () => {
    const prisma = {
      ...makePrisma(),
      projectResponsibility: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "resp-frontend",
            projectId: "project-1",
            title: "Own frontend shell",
            description: "Sara owns the MVP frontend shell and onboarding page.",
            area: "frontend",
            status: "open",
            assigneeName: null,
            memberId: "member-sara",
            createdAt: new Date("2026-05-01T00:00:00.000Z"),
            updatedAt: new Date("2026-05-02T00:00:00.000Z"),
            member: {
              id: "member-sara",
              userId: "user-sara",
              user: { displayName: "Sara", email: "sara@example.com" }
            }
          }
        ])
      }
    } as any;
    const plan = buildRetrievalPlan({
      intent: "team_responsibility",
      pageContext: "dashboard_project",
      selectedRefType: null,
      selectedRefId: null,
      viewerState: null,
      isClientContext: false,
      retrievalTopK: 32,
      rerankTopK: 8,
    });

    const raw = await hybridRetrieveDetailed(prisma, {} as any, "org-1", {
      ...baseInput,
      query: "Who owns frontend?",
      intent: "team_responsibility",
      domains: domainsFromPlan(plan),
      plan,
    });
    const ranked = rerank({
      candidates: raw.candidates,
      pageContext: "dashboard_project",
      intent: "team_responsibility",
      topK: 8,
      isClientContext: false,
      plan,
    });

    expect(prisma.projectResponsibility.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "project-1" }
      })
    );
    expect(ranked[0]).toMatchObject({
      sourceType: "project_responsibility",
      responsibilityId: "resp-frontend",
      sourcePrecedence: "team_context",
      citationRef: { type: "project_responsibility", id: "resp-frontend" },
      openTarget: {
        targetType: "project_responsibility",
        targetRef: { projectId: "project-1", responsibilityId: "resp-frontend" }
      }
    });
  });

  it("does not use flat chunks as the universal first path", async () => {
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

    const raw = await hybridRetrieveDetailed(makePrisma(), {} as any, "org-1", {
      ...baseInput,
      query: "What is current truth?",
      intent: "current_truth",
      domains: domainsFromPlan(plan),
      plan,
    });

    expect(raw.candidates[0].sourceType).toBe("product_brain");
  });

  it("directly includes selected and nearby doc-viewer sections before unrelated vector chunks", async () => {
    const plan = buildRetrievalPlan({
      intent: "doc_local",
      pageContext: "doc_viewer",
      selectedRefType: "document_section",
      selectedRefId: "section-selected",
      viewerState: null,
      isClientContext: false,
      retrievalTopK: 32,
      rerankTopK: 8,
    });

    const raw = await hybridRetrieveDetailed(makeDocViewerPrisma(), {} as any, "org-1", {
      ...baseInput,
      query: "Explain this assignment activation section",
      intent: "doc_local",
      pageContext: "doc_viewer",
      selectedSectionId: "section-selected",
      selectedRefId: "section-selected",
      domains: domainsFromPlan(plan),
      plan,
    });
    const ranked = rerank({
      candidates: raw.candidates,
      pageContext: "doc_viewer",
      intent: "doc_local",
      selectedRefId: "section-selected",
      selectedSectionId: "section-selected",
      topK: 8,
      isClientContext: false,
      plan,
    });

    expect(raw.candidates.map((candidate) => candidate.id)).toEqual(
      expect.arrayContaining(["section-selected", "section-neighbor", "chunk-unrelated"])
    );
    expect(ranked[0]).toMatchObject({
      id: "section-selected",
      documentSectionId: "section-selected",
      sourcePrecedence: "source_evidence",
      openTarget: {
        targetType: "document_section",
      },
    });
    const neighborIndex = ranked.findIndex((candidate) => candidate.id === "section-neighbor");
    const unrelatedIndex = ranked.findIndex((candidate) => candidate.id === "chunk-unrelated");
    expect(neighborIndex).toBeGreaterThanOrEqual(0);
    expect(unrelatedIndex === -1 || neighborIndex < unrelatedIndex).toBe(true);
  });

  it("includes accepted changes and linked messages for selected sections only for internal users", async () => {
    const internalPlan = buildRetrievalPlan({
      intent: "doc_local",
      pageContext: "doc_viewer",
      selectedRefType: "document_section",
      selectedRefId: "section-selected",
      viewerState: null,
      isClientContext: false,
      retrievalTopK: 32,
      rerankTopK: 8,
    });
    const internal = await hybridRetrieveDetailed(makeDocViewerPrisma(), {} as any, "org-1", {
      ...baseInput,
      query: "What changed this section?",
      intent: "doc_local",
      pageContext: "doc_viewer",
      selectedSectionId: "section-selected",
      selectedRefId: "section-selected",
      domains: domainsFromPlan(internalPlan),
      plan: internalPlan,
    });

    expect(internal.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "proposal-1", sourceType: "change_proposal", linkedMessageIds: ["message-1"] }),
        expect.objectContaining({ id: "message-1", sourceType: "communication_message", threadId: "thread-1" }),
      ])
    );

    const clientPlan = buildRetrievalPlan({
      intent: "doc_local",
      pageContext: "client_view",
      selectedRefType: "document_section",
      selectedRefId: "section-selected",
      viewerState: null,
      isClientContext: true,
      retrievalTopK: 32,
      rerankTopK: 8,
    });
    const client = await hybridRetrieveDetailed(makeDocViewerPrisma(), {} as any, "org-1", {
      ...baseInput,
      query: "Which Slack message changed this section?",
      intent: "doc_local",
      pageContext: "doc_viewer",
      selectedSectionId: "section-selected",
      selectedRefId: "section-selected",
      isClientContext: true,
      domains: domainsFromPlan(clientPlan),
      plan: clientPlan,
    });

    expect(client.candidates.some((candidate) => candidate.sourceType === "communication_message")).toBe(false);
    expect(client.candidates.some((candidate) => candidate.sourceType === "change_proposal")).toBe(false);
  });

  it("records required branch failures instead of silently treating them as normal retrieval", async () => {
    const plan = buildRetrievalPlan({
      intent: "dashboard_status",
      pageContext: "dashboard_project",
      selectedRefType: null,
      selectedRefId: null,
      viewerState: null,
      isClientContext: false,
      retrievalTopK: 32,
      rerankTopK: 8,
    });
    const prisma = makePrisma();
    prisma.dashboardSnapshot.findFirst = vi.fn().mockRejectedValue(new Error("dashboard unavailable"));

    await expect(
      hybridRetrieveDetailed(prisma, {} as any, "org-1", {
        ...baseInput,
        query: "What is project status?",
        intent: "dashboard_status",
        domains: domainsFromPlan(plan),
        plan,
      })
    ).rejects.toMatchObject({ code: "required_retrieval_branch_failed" });
  });

  it("preserves traceability metadata for document, change, decision, message, and dashboard candidates", async () => {
    const prisma = makePrisma();
    prisma.decisionRecord.findMany = vi.fn().mockResolvedValue([
      {
        id: "decision-1",
        title: "Reporting cadence",
        statement: "Use weekly exception reporting.",
      },
    ]);
    prisma.communicationMessage.findMany = vi.fn().mockResolvedValue([
      {
        id: "message-1",
        bodyText: "Please use weekly exception reports.",
        senderLabel: "Client",
        threadId: "thread-1",
        connectorId: "connector-1",
        provider: "manual_import",
        projectId: "project-1",
        thread: { subject: "Reporting", participantsJson: [] },
        attachments: [],
      },
    ]);
    prisma.communicationMessageChunk = {
      findMany: vi.fn().mockResolvedValue([{ messageId: "message-1" }]),
    };
    prisma.specChangeProposal.findMany = vi.fn().mockResolvedValue([
      {
        id: "proposal-1",
        title: "Weekly exception reporting",
        summary: "Accepted change: managers get weekly exception reports.",
        decisionRecordId: "decision-1",
      },
    ]);
    prisma.specChangeLink.findMany = vi.fn().mockResolvedValue([
      { specChangeProposalId: "proposal-1", linkType: "document_section", linkRefId: "section-1" },
      { specChangeProposalId: "proposal-1", linkType: "message", linkRefId: "message-1" },
    ]);
    prisma.$queryRawUnsafe = vi.fn(async (query: string) => {
      if (query.includes("communication_message_chunks")) {
        return [
          {
            message_id: "message-1",
            thread_id: "thread-1",
            content: "Please use weekly exception reports.",
            contextual_content: "Reporting\nPlease use weekly exception reports.",
            lexical_content: "weekly exception reports client",
            sender_label: "Client",
            subject: "Reporting",
            vec_dist: 0.1,
          },
        ];
      }
      return [
        {
          id: "chunk-1",
          section_id: "section-1",
          content: "Old PRD says managers get monthly static reports.",
          contextual_content: "Reporting\nOld PRD says managers get monthly static reports.",
          lexical_content: "reporting managers monthly static reports",
          page_number: 2,
          document_version_id: "version-1",
          metadata_json: {},
          visibility: "internal",
          doc_title: "Original PRD",
          anchor_id: "anchor-reporting",
          vec_dist: 0.05,
        },
      ];
    });

    const plan = buildRetrievalPlan({
      intent: "comparison_or_diff",
      pageContext: "dashboard_project",
      selectedRefType: null,
      selectedRefId: null,
      viewerState: null,
      isClientContext: false,
      retrievalTopK: 32,
      rerankTopK: 12,
    });
    plan.primaryDomains = ["document_chunks", "accepted_changes", "decisions", "communication_messages", "dashboard_snapshots"];
    plan.supportingDomains = ["product_brain"];
    plan.sourcePrecedence = ["dashboard_facts", "accepted_changes", "accepted_decisions", "communication_evidence", "source_evidence", "accepted_truth"];
    plan.requiresCommunicationEvidence = true;
    plan.requiresDashboardSnapshot = true;

    const raw = await hybridRetrieveDetailed(prisma, { embedText: vi.fn().mockResolvedValue([0.1, 0.2]) } as any, "org-1", {
      ...baseInput,
      query: "Compare reporting status with the client message",
      intent: "comparison_or_diff",
      domains: domainsFromPlan(plan),
      plan,
    });

    expect(raw.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "chunk-1", documentChunkId: "chunk-1", domain: "document_chunks", sourcePrecedence: "source_evidence" }),
        expect.objectContaining({ id: "proposal-1", changeProposalId: "proposal-1", linkedMessageIds: ["message-1"], decisionRecordIds: ["decision-1"] }),
        expect.objectContaining({ id: "decision-1", decisionRecordId: "decision-1", sourcePrecedence: "accepted_decisions" }),
        expect.objectContaining({ id: "message-1", messageId: "message-1", threadId: "thread-1", sourcePrecedence: "communication_evidence" }),
        expect.objectContaining({ id: "snapshot-1", domain: "dashboard_snapshots", sourcePrecedence: "dashboard_facts" }),
      ])
    );
  });
});
