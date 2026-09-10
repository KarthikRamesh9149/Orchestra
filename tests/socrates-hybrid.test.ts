import { describe, expect, it, vi } from "vitest";
import { hybridRetrieve } from "../src/lib/retrieval/hybrid.js";

describe("hybridRetrieve", () => {
  it("queries only current parse-revision chunks and sections", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe
    } as any;

    await hybridRetrieve(prisma, {} as any, "org-1", {
      projectId: "project-1",
      query: "auth requirement",
      queryEmbedding: [0.1, 0.2],
      intent: "doc_local",
      domains: {
        includeDocuments: true,
        includeBrainNodes: false,
        includeProductBrain: false,
        includeChanges: false,
        includeDecisions: false,
        includeDashboard: false,
        includeCommunications: false
      },
      topK: 5,
      minScore: 0,
      isClientContext: false,
      acceptedTruthBoost: 1.2,
      docWeight: 1,
      commWeight: 0.8
    });

    expect(queryRawUnsafe).toHaveBeenCalledTimes(2);
    for (const [sql] of queryRawUnsafe.mock.calls) {
      expect(sql).toContain("dc.parse_revision = dv.parse_revision");
      expect(sql).toContain("ds.parse_revision = dv.parse_revision");
    }
  });

  it("returns the accepted Product Brain as retrieval evidence for current-truth queries", async () => {
    const prisma = {
      artifactVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: "artifact-1",
          versionNumber: 4,
          payloadJson: {
            whatTheProductIs: "A product brain for client-facing software teams",
            mainFlows: ["Upload docs", "Accept changes"],
            modules: ["Product Brain", "Socrates"],
            constraints: ["Immutable evidence"],
            integrations: ["Slack"]
          }
        })
      }
    } as any;

    const result = await hybridRetrieve(prisma, {} as any, "org-1", {
      projectId: "project-1",
      query: "what is the current product",
      queryEmbedding: [0.1, 0.2],
      intent: "current_truth",
      domains: {
        includeDocuments: false,
        includeBrainNodes: false,
        includeProductBrain: true,
        includeChanges: false,
        includeDecisions: false,
        includeDashboard: false,
        includeCommunications: false
      },
      topK: 5,
      minScore: 0.2,
      isClientContext: false,
      acceptedTruthBoost: 1.2,
      docWeight: 1,
      commWeight: 0.8
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "artifact-1",
      sourceType: "product_brain"
    });
  });

  it("uses the selected section parse revision when expanding neighbor sections", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      documentVersionId: "version-1",
      orderIndex: 10,
      parseRevision: 3
    });
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      documentSection: {
        findFirst,
        findMany
      }
    } as any;

    await hybridRetrieve(prisma, {} as any, "org-1", {
      projectId: "project-1",
      query: "this section",
      queryEmbedding: [0.1, 0.2],
      intent: "doc_local",
      domains: {
        includeDocuments: false,
        includeBrainNodes: false,
        includeProductBrain: false,
        includeChanges: false,
        includeDecisions: false,
        includeDashboard: false,
        includeCommunications: false
      },
      selectedSectionId: "section-1",
      topK: 5,
      minScore: 0,
      isClientContext: false,
      acceptedTruthBoost: 1.2,
      docWeight: 1,
      commWeight: 0.8
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          parseRevision: 3
        })
      })
    );
  });

  it("indexes communication messages into semantic chunks before retrieval", async () => {
    const communicationMessageChunk = {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "chunk-1" })
    };
    const prisma = {
      communicationMessage: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "message-1",
            projectId: "project-1",
            connectorId: "connector-1",
            provider: "manual_import",
            threadId: "thread-1",
            senderLabel: "Founder",
            senderEmail: "founder@example.com",
            bodyText: "We should launch with a lightweight voice note input for early idea capture.",
            bodyHtml: null,
            thread: { subject: "Kickoff", participantsJson: [] },
            attachments: []
          }
        ])
      },
      communicationMessageChunk,
      $queryRawUnsafe: vi.fn().mockResolvedValue([
        {
          message_id: "message-1",
          thread_id: "thread-1",
          content: "voice note input for early idea capture",
          contextual_content: "Kickoff Founder voice note input for early idea capture",
          lexical_content: "Kickoff Founder voice note input for early idea capture",
          sender_label: "Founder",
          subject: "Kickoff",
          vec_dist: 0.08
        }
      ]),
      $executeRawUnsafe: vi.fn().mockResolvedValue(1)
    } as any;

    const embedProvider = {
      embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
    } as any;

    const result = await hybridRetrieve(prisma, embedProvider, "org-1", {
      projectId: "project-1",
      query: "did anyone mention voice notes?",
      queryEmbedding: [0.1, 0.2, 0.3],
      intent: "original_source",
      domains: {
        includeDocuments: false,
        includeBrainNodes: false,
        includeProductBrain: false,
        includeChanges: false,
        includeDecisions: false,
        includeDashboard: false,
        includeCommunications: true
      },
      topK: 5,
      minScore: 0,
      isClientContext: false,
      acceptedTruthBoost: 1.2,
      docWeight: 1,
      commWeight: 0.8
    });

    expect(communicationMessageChunk.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          connectorId: "connector-1",
          provider: "manual_import"
        })
      })
    );
    expect(embedProvider.embedText).toHaveBeenCalled();
    expect(result[0]).toMatchObject({
      id: "message-1",
      sourceType: "communication_message"
    });
  });

  it("excludes soft-deleted messages from communication retrieval indexing and chunk queries", async () => {
    const messagesFindMany = vi.fn().mockResolvedValue([
      {
        id: "message-live",
        projectId: "project-1",
        connectorId: "connector-1",
        provider: "slack",
        threadId: "thread-1",
        senderLabel: "PM",
        senderEmail: "pm@example.com",
        bodyText: "Active message that should be indexed.",
        bodyHtml: null,
        isDeletedByProvider: false,
        thread: { subject: "Planning", participantsJson: [] },
        attachments: []
      },
      {
        id: "message-deleted",
        projectId: "project-1",
        connectorId: "connector-1",
        provider: "slack",
        threadId: "thread-1",
        senderLabel: "PM",
        senderEmail: "pm@example.com",
        bodyText: "This message was deleted by the provider.",
        bodyHtml: null,
        isDeletedByProvider: true,
        thread: { subject: "Planning", participantsJson: [] },
        attachments: []
      }
    ]);

    const chunkCreate = vi.fn().mockResolvedValue({ id: "chunk-1" });
    const prisma = {
      communicationMessage: {
        findMany: messagesFindMany
      },
      communicationMessageChunk: {
        findMany: vi.fn().mockResolvedValue([]),
        create: chunkCreate
      },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      $executeRawUnsafe: vi.fn().mockResolvedValue(1)
    } as any;

    const embedProvider = {
      embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
    } as any;

    await hybridRetrieve(prisma, embedProvider, "org-1", {
      projectId: "project-1",
      query: "planning discussion",
      queryEmbedding: [0.1, 0.2, 0.3],
      intent: "original_source",
      domains: {
        includeDocuments: false,
        includeBrainNodes: false,
        includeProductBrain: false,
        includeChanges: false,
        includeDecisions: false,
        includeDashboard: false,
        includeCommunications: true
      },
      topK: 5,
      minScore: 0,
      isClientContext: false,
      acceptedTruthBoost: 1.2,
      docWeight: 1,
      commWeight: 0.8
    });

    // findMany must filter soft-deleted messages out at the query level
    expect(messagesFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isDeletedByProvider: false
        })
      })
    );

    // The chunk raw SQL must also filter soft-deleted messages
    const [chunkSql] = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(chunkSql).toContain("is_deleted_by_provider");
  });
});
