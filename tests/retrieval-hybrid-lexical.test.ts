import { describe, expect, it, vi } from "vitest";
import { hybridRetrieveDetailed } from "../src/lib/retrieval/hybrid.js";
import { buildRetrievalPlan, domainsFromPlan } from "../src/lib/retrieval/planner.js";

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

describe("hybrid retrieval independent lexical branches", () => {
  it.each(["dense", "lexical"])("keeps document provenance for sectionless %s chunks", async (branch) => {
    const prisma = {
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        if ((branch === "dense") !== sql.includes("ORDER BY dc.embedding")) return [];
        return [{ id: "chunk", section_id: null, anchor_id: null, content: "Release checklist approval",
          contextual_content: null, lexical_content: "release checklist approval", page_number: 7,
          document_version_id: "version-1", document_id: "document-1", metadata_json: {},
          visibility: "internal", doc_title: "Release checklist", distance: 0.1 }];
      })
    } as any;
    const result = await hybridRetrieveDetailed(prisma, {} as any, "org-1", {
      ...baseInput, query: "Release checklist", intent: "doc_local",
      domains: { includeDocuments: true, includeBrainNodes: false, includeProductBrain: false,
        includeChanges: false, includeDecisions: false, includeDashboard: false, includeCommunications: false }
    });
    expect(result.candidates).toEqual(expect.arrayContaining([expect.objectContaining({
      id: "chunk", openTarget: { targetType: "document", targetRef: { documentId: "document-1", documentVersionId: "version-1", pageNumber: 7 } }
    })]));
  });
  it("filters dense and lexical document retrieval to current parsed document versions", async () => {
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

    const prisma = {
      artifactVersion: { findFirst: vi.fn().mockResolvedValue(null) },
      documentSection: { findMany: vi.fn().mockResolvedValue([]) },
      specChangeLink: { findMany: vi.fn().mockResolvedValue([]) },
      specChangeProposal: { findMany: vi.fn().mockResolvedValue([]) },
      decisionRecord: { findMany: vi.fn().mockResolvedValue([]) },
      communicationMessage: { findMany: vi.fn().mockResolvedValue([]) },
      dashboardSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as any;

    await hybridRetrieveDetailed(prisma, {} as any, "org-1", {
      ...baseInput,
      query: "Where is current onboarding evidence?",
      intent: "original_source",
      domains: domainsFromPlan(plan),
      plan,
    });

    const sqlCalls = prisma.$queryRawUnsafe.mock.calls.map(([sql]: [string]) => sql.replace(/\s+/g, " "));
    const denseSql = sqlCalls.find((sql: string) => sql.includes("FROM document_chunks dc") && sql.includes("ORDER BY dc.embedding"));
    const lexicalSql = sqlCalls.find((sql: string) => sql.includes("FROM document_chunks dc") && sql.includes("ORDER BY dc.created_at DESC"));
    expect(denseSql).toContain("OPERATOR(extensions.<=>)");

    for (const sql of [denseSql, lexicalSql]) {
      expect(sql).toBeDefined();
      expect(sql).toContain("dc.project_id = $1::uuid");
      expect(sql).toContain("d.current_version_id = dv.id");
      expect(sql).toContain("dv.status IN ('ready', 'partial')");
      expect(sql).toContain("dc.parse_revision = dv.parse_revision");
      expect(sql).toContain("d.id AS document_id");
    }
  });

  it("returns exact document lexical matches even when dense chunk retrieval misses", async () => {
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

    const prisma = {
      artifactVersion: { findFirst: vi.fn().mockResolvedValue(null) },
      documentSection: { findMany: vi.fn().mockResolvedValue([]) },
      specChangeLink: { findMany: vi.fn().mockResolvedValue([]) },
      specChangeProposal: { findMany: vi.fn().mockResolvedValue([]) },
      decisionRecord: { findMany: vi.fn().mockResolvedValue([]) },
      communicationMessage: { findMany: vi.fn().mockResolvedValue([]) },
      dashboardSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        if (sql.includes("ORDER BY dc.embedding")) {
          return [];
        }
        return [
          {
            id: "chunk-lexical",
            section_id: "section-lexical",
            content: "The launch checklist requires zephyr-gate approval before activation.",
            contextual_content: "PRD / Launch Checklist - zephyr-gate approval before activation.",
            lexical_content: "launch checklist zephyr-gate approval activation",
            page_number: 7,
            document_version_id: "version-1",
            document_id: "document-1",
            metadata_json: {},
            visibility: "internal",
            doc_title: "Launch PRD",
            anchor_id: "anchor-zephyr",
          },
        ];
      }),
    } as any;

    const result = await hybridRetrieveDetailed(prisma, {} as any, "org-1", {
      ...baseInput,
      query: "Where is zephyr-gate approval documented?",
      intent: "original_source",
      domains: domainsFromPlan(plan),
      plan,
    });

    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "chunk-lexical",
          retrievalStage: "lexical",
          documentChunkId: "chunk-lexical",
          openTarget: expect.objectContaining({ targetType: "document_section", targetRef: expect.objectContaining({ documentId: "document-1" }) }),
        }),
      ])
    );
    expect(result.telemetry.denseCandidateCount).toBe(0);
    expect(result.telemetry.lexicalCandidateCount).toBeGreaterThan(0);
  });

  it("returns exact communication chunk lexical matches even when dense message retrieval misses", async () => {
    const plan = buildRetrievalPlan({
      intent: "communication_lookup",
      pageContext: "brain_overview",
      selectedRefType: null,
      selectedRefId: null,
      viewerState: null,
      isClientContext: false,
      retrievalTopK: 32,
      rerankTopK: 8,
    });

    const prisma = {
      artifactVersion: { findFirst: vi.fn().mockResolvedValue(null) },
      documentSection: { findMany: vi.fn().mockResolvedValue([]) },
      specChangeLink: { findMany: vi.fn().mockResolvedValue([]) },
      specChangeProposal: { findMany: vi.fn().mockResolvedValue([]) },
      decisionRecord: { findMany: vi.fn().mockResolvedValue([]) },
      dashboardSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
      communicationMessage: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "message-1",
            bodyText: "A generic customer note that does not contain the rare keyword.",
            senderLabel: "Client",
            senderEmail: "client@example.com",
            sentAt: new Date("2026-04-19T10:00:00Z"),
            threadId: "thread-1",
            connectorId: "connector-1",
            provider: "slack",
            projectId: "project-1",
            thread: { subject: "Approval wording", participantsJson: [] },
            attachments: [],
          },
        ]),
      },
      communicationMessageChunk: {
        findMany: vi.fn().mockResolvedValue([{ messageId: "message-1" }]),
      },
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        if (sql.includes("ORDER BY cmc.embedding")) {
          return [];
        }
        if (!sql.includes("communication_message_chunks")) {
          return [];
        }
        return [
          {
            message_id: "message-1",
            thread_id: "thread-1",
            content: "Client explicitly requested zephyr-gate approval wording.",
            contextual_content: "Slack thread: Approval wording / Sender: Client - zephyr-gate approval wording.",
            lexical_content: "slack approval wording zephyr-gate client",
            sender_label: "Client",
            subject: "Approval wording",
          },
        ];
      }),
    } as any;

    const result = await hybridRetrieveDetailed(prisma, { embedText: vi.fn() } as any, "org-1", {
      ...baseInput,
      query: "Which Slack message mentions zephyr-gate?",
      intent: "communication_lookup",
      domains: domainsFromPlan(plan),
      plan,
    });

    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "message-1",
          retrievalStage: "lexical",
          sourceType: "communication_message",
          messageId: "message-1",
          threadId: "thread-1",
          openTarget: expect.objectContaining({ targetType: "message" }),
        }),
      ])
    );
    expect(result.telemetry.lexicalCandidateCount).toBeGreaterThan(0);
  });

  it("retrieves persisted diagrams as internal visual artifacts", async () => {
    const plan = buildRetrievalPlan({
      intent: "diagram_lookup",
      pageContext: "live_doc",
      selectedRefType: null,
      selectedRefId: null,
      viewerState: null,
      isClientContext: false,
      retrievalTopK: 32,
      rerankTopK: 8,
    });

    const prisma = {
      artifactVersion: { findFirst: vi.fn().mockResolvedValue(null) },
      documentSection: { findMany: vi.fn().mockResolvedValue([]) },
      specChangeLink: { findMany: vi.fn().mockResolvedValue([]) },
      specChangeProposal: { findMany: vi.fn().mockResolvedValue([]) },
      decisionRecord: { findMany: vi.fn().mockResolvedValue([]) },
      communicationMessage: { findMany: vi.fn().mockResolvedValue([]) },
      dashboardSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
      projectContextChunk: { findMany: vi.fn().mockResolvedValue([]) },
      projectDiagram: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "diagram-1",
            projectId: "project-1",
            title: "Onboarding flow",
            description: "Flowchart for KYC onboarding.",
            diagramType: "flowchart",
            mermaidSource: "flowchart TD\n  KYC[KYC step] --> Approval[Approval]",
            source: "user_created",
            status: "active",
            updatedAt: new Date("2026-05-01T00:00:00.000Z"),
            liveDocEmbeds: [{ sectionKey: "overview", sortOrder: 1, embeddedAt: new Date("2026-05-01T00:00:00.000Z") }],
          },
        ]),
      },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as any;

    const result = await hybridRetrieveDetailed(prisma, {} as any, "org-1", {
      ...baseInput,
      query: "Show the KYC onboarding flow diagram",
      intent: "diagram_lookup",
      domains: domainsFromPlan(plan),
      plan,
    });

    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "project_diagram",
          domain: "project_diagrams",
          diagramId: "diagram-1",
          evidenceRole: "visual_artifact",
          citationRef: { type: "project_diagram", id: "diagram-1", label: "Onboarding flow" },
          openTarget: { targetType: "project_diagram", targetRef: { projectId: "project-1", diagramId: "diagram-1" } },
        }),
      ])
    );
  });
});
