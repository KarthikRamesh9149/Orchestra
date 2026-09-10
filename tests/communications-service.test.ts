import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAggregateCachesForTests } from "../src/lib/dashboard/aggregate-cache.js";
import { MessageIngestionService } from "../src/modules/communications/message-ingestion.service.js";
import { MessageIndexingService } from "../src/modules/communications/message-indexing.service.js";
import { TimelineService } from "../src/modules/communications/timeline.service.js";
import { stableBodyHash } from "../src/lib/communications/idempotency.js";

describe("Communication layer C1 services", () => {
  beforeEach(() => {
    clearAggregateCachesForTests();
  });

  it("ingests manual-import messages idempotently and stores attachment metadata", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      communicationConnector: {
        findFirst: vi.fn().mockResolvedValue({
          id: "connector-1",
          projectId: "project-1",
          provider: "manual_import"
        })
      },
      communicationThread: {
        upsert: vi.fn().mockResolvedValue({ id: "thread-1", lastMessageAt: null }),
        update: vi.fn().mockResolvedValue(undefined)
      },
      communicationMessage: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "msg-1" })
      },
      communicationAttachment: {
        upsert: vi.fn().mockResolvedValue(undefined)
      },
      communicationMessageRevision: {
        findFirst: vi.fn(),
        create: vi.fn()
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined)
      },
      project: {
        findUnique: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" })
      }
    } as any;

    const service = new MessageIngestionService(prisma, { enqueue } as any);

    const result = await service.ingestNormalizedBatch({
      projectId: "project-1",
      connectorId: "connector-1",
      provider: "manual_import",
      threads: [
        {
          providerThreadId: "thread-1",
          subject: "Kickoff",
          participants: [{ label: "Client" }]
        }
      ],
      messages: [
        {
          providerMessageId: "msg-1",
          senderLabel: "Client",
          sentAt: "2026-04-19T10:01:00.000Z",
          bodyText: "Need weekly reporting",
          messageType: "user",
          attachments: [
            { providerAttachmentId: "att-1", filename: "brief.pdf", mimeType: "application/pdf", fileSize: 128 },
            { filename: "notes.txt", mimeType: "text/plain", fileSize: 32 }
          ]
        }
      ]
    });

    expect(result.createdMessageCount).toBe(1);
    expect(prisma.communicationAttachment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          providerAttachmentId: "att-1",
          filename: "brief.pdf"
        })
      })
    );
    expect(prisma.communicationAttachment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          messageId_providerAttachmentId: {
            messageId: "msg-1",
            providerAttachmentId: expect.stringMatching(/^generated:/)
          }
        },
        create: expect.objectContaining({
          providerAttachmentId: expect.stringMatching(/^generated:/),
          filename: "notes.txt"
        })
      })
    );
    expect(enqueue).toHaveBeenCalledWith(
      "index_communication_message",
      expect.objectContaining({ messageId: "msg-1" }),
      expect.stringContaining("index-message:msg-1:")
    );
  });

  it("schedules communication indexing jobs in parallel so imports do not wait on serial enqueue latency", async () => {
    let startedEnqueues = 0;
    const enqueueResolvers: Array<() => void> = [];
    const enqueue = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          startedEnqueues += 1;
          enqueueResolvers.push(resolve);
          if (startedEnqueues >= 2) {
            enqueueResolvers.splice(0).forEach((resolver) => resolver());
          }
        })
    );
    const prisma = {
      communicationConnector: {
        findFirst: vi.fn().mockResolvedValue({
          id: "connector-1",
          projectId: "project-1",
          provider: "manual_import"
        })
      },
      communicationThread: {
        upsert: vi.fn().mockResolvedValue({ id: "thread-1", lastMessageAt: null }),
        update: vi.fn().mockResolvedValue(undefined)
      },
      communicationMessage: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(async (args) => ({ id: args.data.providerMessageId }))
      },
      communicationAttachment: {
        upsert: vi.fn().mockResolvedValue(undefined)
      },
      communicationMessageRevision: {
        findFirst: vi.fn(),
        create: vi.fn()
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined)
      }
    } as any;

    const service = new MessageIngestionService(prisma, { enqueue } as any, true);
    await Promise.race([
      service.ingestNormalizedBatch({
        projectId: "project-1",
        connectorId: "connector-1",
        provider: "manual_import",
        threads: [
          {
            providerThreadId: "thread-1",
            subject: "Kickoff",
            participants: [{ label: "Client" }]
          }
        ],
        messages: [
          {
            providerMessageId: "msg-1",
            senderLabel: "Client",
            sentAt: "2026-04-19T10:01:00.000Z",
            bodyText: "Need weekly reporting",
            messageType: "user"
          },
          {
            providerMessageId: "msg-2",
            senderLabel: "Client",
            sentAt: "2026-04-19T10:02:00.000Z",
            bodyText: "Need approval tracking",
            messageType: "user"
          }
        ]
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("index enqueue was serial")), 100))
    ]);

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(startedEnqueues).toBe(2);
  });

  it("does not block communication imports on slow queue dispatch", async () => {
    const enqueue = vi.fn(() => new Promise<void>(() => undefined));
    const prisma = {
      communicationConnector: {
        findFirst: vi.fn().mockResolvedValue({
          id: "connector-1",
          projectId: "project-1",
          provider: "manual_import"
        })
      },
      communicationThread: {
        upsert: vi.fn().mockResolvedValue({ id: "thread-1", lastMessageAt: null }),
        update: vi.fn().mockResolvedValue(undefined)
      },
      communicationMessage: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(async (args) => ({ id: args.data.providerMessageId }))
      },
      communicationAttachment: {
        upsert: vi.fn().mockResolvedValue(undefined)
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 0 })
      }
    } as any;

    const service = new MessageIngestionService(prisma, { enqueue } as any, true);
    const result = await Promise.race([
      service.ingestNormalizedBatch({
        projectId: "project-1",
        connectorId: "connector-1",
        provider: "manual_import",
        threads: [{ providerThreadId: "thread-1", subject: "Kickoff", participants: [] }],
        messages: [
          {
            providerMessageId: "msg-1",
            senderLabel: "Client",
            sentAt: "2026-04-19T10:01:00.000Z",
            bodyText: "Need weekly reporting",
            messageType: "user"
          }
        ]
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("import waited on queue dispatch")), 100))
    ]);

    expect(result).toMatchObject({ createdMessageCount: 1, indexedMessageCount: 1 });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("routes multi-thread provider batches by message providerThreadId", async () => {
    const prisma = {
      communicationConnector: {
        findFirst: vi.fn().mockResolvedValue({
          id: "connector-1",
          projectId: "project-1",
          provider: "manual_import"
        })
      },
      communicationThread: {
        upsert: vi.fn(async (args) => ({
          id: args.where.connectorId_providerThreadId.providerThreadId === "thread-a" ? "thread-a-id" : "thread-b-id",
          lastMessageAt: null
        })),
        update: vi.fn().mockResolvedValue(undefined)
      },
      communicationMessage: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(async (args) => ({ id: args.data.providerMessageId }))
      },
      communicationAttachment: {
        upsert: vi.fn().mockResolvedValue(undefined)
      },
      communicationMessageRevision: {
        findFirst: vi.fn(),
        create: vi.fn()
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined)
      },
      project: {
        findUnique: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" })
      }
    } as any;
    const service = new MessageIngestionService(prisma, { enqueue: vi.fn().mockResolvedValue(undefined) } as any);

    const result = await service.ingestNormalizedBatch({
      projectId: "project-1",
      connectorId: "connector-1",
      provider: "manual_import",
      threads: [
        { providerThreadId: "thread-a", participants: [] },
        { providerThreadId: "thread-b", participants: [] }
      ],
      messages: [
        { providerThreadId: "thread-a", providerMessageId: "msg-a", senderLabel: "A", sentAt: "2026-04-19T10:01:00.000Z", bodyText: "A", messageType: "user" },
        { providerThreadId: "thread-b", providerMessageId: "msg-b", senderLabel: "B", sentAt: "2026-04-19T10:02:00.000Z", bodyText: "B", messageType: "user" }
      ]
    });

    expect(result.threadIds).toEqual(["thread-a-id", "thread-b-id"]);
    expect(prisma.communicationMessage.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: expect.objectContaining({ threadId: "thread-a-id" }) })
    );
    expect(prisma.communicationMessage.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: expect.objectContaining({ threadId: "thread-b-id" }) })
    );

    prisma.communicationThread.upsert.mockClear();
    await expect(
      service.ingestNormalizedBatch({
        projectId: "project-1",
        connectorId: "connector-1",
        provider: "manual_import",
        threads: [
          { providerThreadId: "thread-a", participants: [] },
          { providerThreadId: "thread-b", participants: [] }
        ],
        messages: [
          { providerMessageId: "msg-c", senderLabel: "C", sentAt: "2026-04-19T10:03:00.000Z", bodyText: "C", messageType: "user" }
        ]
      })
    ).rejects.toMatchObject({ code: "communication_message_thread_required" });
    expect(prisma.communicationThread.upsert).not.toHaveBeenCalled();
  });

  it("creates a revision when an imported message body changes and skips duplicate same-body imports", async () => {
    const existing = {
      id: "msg-1",
      projectId: "project-1",
      threadId: "thread-1",
      providerMessageId: "msg-1",
      providerPermalink: null,
      senderLabel: "Client",
      senderExternalRef: null,
      senderEmail: null,
      sentAt: new Date("2026-04-19T10:01:00.000Z"),
      bodyText: "Need monthly reporting",
      bodyHtml: null,
      bodyHash: stableBodyHash("Need monthly reporting", null),
      isEdited: false,
      replyToMessageId: null,
      rawMetadataJson: {}
    };

    const findMany = vi
      .fn()
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([
        {
          ...existing,
          bodyText: "Need weekly reporting",
          bodyHash: stableBodyHash("Need weekly reporting", null)
        }
      ]);
    const findUnique = vi
      .fn()
      .mockResolvedValue({
        ...existing,
        bodyText: "Need weekly reporting",
        bodyHash: stableBodyHash("Need weekly reporting", null)
      });

    const prisma = {
      communicationConnector: {
        findFirst: vi.fn().mockResolvedValue({
          id: "connector-1",
          projectId: "project-1",
          provider: "manual_import"
        })
      },
      communicationThread: {
        upsert: vi.fn().mockResolvedValue({ id: "thread-1", lastMessageAt: new Date() }),
        update: vi.fn()
      },
      communicationMessage: {
        findMany,
        findUnique,
        update: vi.fn().mockResolvedValue({ id: "msg-1" })
      },
      communicationAttachment: {
        upsert: vi.fn().mockResolvedValue(undefined)
      },
      communicationMessageRevision: {
        findFirst: vi.fn().mockResolvedValue({ revisionIndex: 1 }),
        create: vi.fn().mockResolvedValue(undefined)
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined)
      },
      project: {
        findUnique: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" })
      }
    } as any;

    const service = new MessageIngestionService(prisma, { enqueue: vi.fn() } as any);

    const changed = await service.ingestNormalizedBatch({
      projectId: "project-1",
      connectorId: "connector-1",
      provider: "manual_import",
      threads: [{ providerThreadId: "thread-1", participants: [] }],
      messages: [
        {
          providerMessageId: "msg-1",
          senderLabel: "Client",
          sentAt: "2026-04-19T10:02:00.000Z",
          bodyText: "Need weekly reporting",
          messageType: "user"
        }
      ]
    });

    expect(changed.updatedRevisionCount).toBe(1);
    expect(prisma.communicationMessageRevision.create).toHaveBeenCalledTimes(1);

    const duplicate = await service.ingestNormalizedBatch({
      projectId: "project-1",
      connectorId: "connector-1",
      provider: "manual_import",
      threads: [{ providerThreadId: "thread-1", participants: [] }],
      messages: [
        {
          providerMessageId: "msg-1",
          senderLabel: "Client",
          sentAt: "2026-04-19T10:02:00.000Z",
          bodyText: "Need weekly reporting",
          messageType: "user"
        }
      ]
    });

    expect(duplicate.updatedRevisionCount).toBe(0);
    expect(prisma.communicationMessageRevision.create).toHaveBeenCalledTimes(1);
  });

  it("indexes imported messages into provider-aware communication chunks", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "msg-1",
      projectId: "project-1",
      connectorId: "connector-1",
      provider: "manual_import",
      threadId: "thread-1",
      senderLabel: "Client",
      senderEmail: "client@example.com",
      sentAt: new Date("2026-04-19T10:02:00.000Z"),
      bodyText: "Need weekly reporting for managers and owners.",
      bodyHtml: null,
      bodyHash: stableBodyHash("Need weekly reporting for managers and owners.", null),
      thread: {
        subject: "Reporting discussion",
        participantsJson: [{ label: "Client" }]
      },
      connector: { id: "connector-1", provider: "manual_import" },
      attachments: [],
      project: { orgId: "org-1" }
    });

    const prisma = {
      communicationMessage: {
        findUnique,
        update: vi.fn().mockResolvedValue(undefined)
      },
      communicationMessageChunk: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue({ id: "chunk-1" })
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined)
      },
      $executeRawUnsafe: vi.fn().mockResolvedValue(1)
    } as any;

    const enqueue = vi.fn().mockResolvedValue(undefined);
    const service = new MessageIndexingService(
      prisma,
      { embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) } as any,
      { record: vi.fn().mockResolvedValue(undefined) } as any,
      { enqueue } as any
    );

    await service.runIndexJob({ messageId: "msg-1", idempotencyKey: "index-message:msg-1:test" });

    expect(prisma.communicationMessageChunk.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          connectorId: "connector-1",
          provider: "manual_import"
        })
      })
    );
    expect(prisma.jobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: "index-message:msg-1:test" },
        data: expect.objectContaining({ status: "completed" })
      })
    );
    expect(enqueue).toHaveBeenCalledWith(
      "classify_message_insight",
      expect.objectContaining({ projectId: "project-1", messageId: "msg-1" }),
      expect.stringContaining("classify-message:msg-1:")
    );
  });

  it("cleans chunks and skips classification for provider-deleted messages", async () => {
    const prisma = {
      communicationMessage: {
        findUnique: vi.fn().mockResolvedValue({
          id: "msg-deleted",
          projectId: "project-1",
          connectorId: "connector-1",
          provider: "slack",
          threadId: "thread-1",
          senderLabel: "Client",
          senderEmail: "client@example.com",
          sentAt: new Date("2026-04-19T10:02:00.000Z"),
          bodyText: "Deleted provider message",
          bodyHtml: null,
          bodyHash: stableBodyHash("Deleted provider message", null),
          isDeletedByProvider: true,
          thread: { subject: "Deleted discussion", participantsJson: [] },
          connector: { id: "connector-1", provider: "slack" },
          attachments: [],
          project: { orgId: "org-1" }
        })
      },
      communicationMessageChunk: {
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
        findMany: vi.fn(),
        create: vi.fn()
      },
      jobRun: {
        upsert: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined)
      },
      $executeRawUnsafe: vi.fn()
    } as any;
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const service = new MessageIndexingService(
      prisma,
      { embedText: vi.fn() } as any,
      { record: vi.fn().mockResolvedValue(undefined) } as any,
      { enqueue } as any
    );

    const result = await service.indexCommunicationMessage("msg-deleted");

    expect(result).toEqual({ indexed: false, chunkCount: 0, skippedReason: "provider_deleted" });
    expect(prisma.communicationMessageChunk.deleteMany).toHaveBeenCalledWith({ where: { messageId: "msg-deleted" } });
    expect(prisma.communicationMessageChunk.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does not enqueue classification when beta auto-classify is disabled", async () => {
    const prisma = {
      communicationMessage: {
        findUnique: vi.fn().mockResolvedValue({
          id: "msg-1",
          projectId: "project-1",
          connectorId: "connector-1",
          provider: "manual_import",
          threadId: "thread-1",
          senderLabel: "Client",
          senderEmail: "client@example.com",
          sentAt: new Date("2026-04-19T10:02:00.000Z"),
          bodyText: "Need weekly reporting for managers and owners.",
          bodyHtml: null,
          bodyHash: stableBodyHash("Need weekly reporting for managers and owners.", null),
          thread: { subject: "Reporting discussion", participantsJson: [{ label: "Client" }] },
          connector: { id: "connector-1", provider: "manual_import" },
          attachments: [],
          project: { orgId: "org-1" }
        }),
        update: vi.fn().mockResolvedValue(undefined)
      },
      communicationMessageChunk: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue({ id: "chunk-1" })
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined)
      },
      $executeRawUnsafe: vi.fn().mockResolvedValue(1)
    } as any;

    const enqueue = vi.fn().mockResolvedValue(undefined);
    const service = new MessageIndexingService(
      prisma,
      { embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) } as any,
      { record: vi.fn().mockResolvedValue(undefined) } as any,
      { enqueue } as any,
      {
        BETA_COMMUNICATION_CHANGE_DETECTION_ENABLED: true,
        BETA_COMMUNICATION_AUTO_CLASSIFY_ENABLED: false
      } as any
    );

    await service.runIndexJob({ messageId: "msg-1", idempotencyKey: "index-message:msg-1:auto-off" });

    expect(enqueue).not.toHaveBeenCalledWith("classify_message_insight", expect.anything(), expect.anything());
  });

  it("preserves Slack and ClickUp provenance in communication chunk metadata", async () => {
    const runProviderIndex = async (provider: "slack" | "clickup", sourceSubType: string) => {
      const create = vi.fn().mockResolvedValue({ id: `chunk-${provider}` });
      const prisma = {
        communicationMessage: {
          findUnique: vi.fn().mockResolvedValue({
            id: `msg-${provider}`,
            projectId: "project-1",
            connectorId: `connector-${provider}`,
            provider,
            providerMessageId:
              provider === "slack" ? "C123:1716140000.000100" : "task:cu-1:comment:c1",
            providerPermalink:
              provider === "slack"
                ? "https://example.slack.com/archives/C123/p1716140000000100"
                : "https://app.clickup.com/t/cu-1?comment=c1",
            threadId: `thread-${provider}`,
            senderLabel: provider === "slack" ? "Client" : "PM",
            senderEmail: null,
            sentAt: new Date("2026-05-19T10:02:00.000Z"),
            bodyText: provider === "slack" ? "Slack says SSO is required." : "ClickUp confirms SSO acceptance.",
            bodyHtml: null,
            bodyHash: stableBodyHash(
              provider === "slack" ? "Slack says SSO is required." : "ClickUp confirms SSO acceptance.",
              null
            ),
            isDeletedByProvider: false,
            rawMetadataJson: { sourceSubType, providerSourceId: provider === "slack" ? "C123" : "cu-1" },
            thread: {
              id: `thread-${provider}`,
              subject: provider === "slack" ? "Slack auth thread" : "ClickUp auth task",
              participantsJson: []
            },
            connector: { id: `connector-${provider}`, provider },
            attachments: [],
            project: { orgId: "org-1" }
          }),
          update: vi.fn().mockResolvedValue(undefined)
        },
        communicationMessageChunk: {
          findMany: vi.fn().mockResolvedValue([]),
          deleteMany: vi.fn().mockResolvedValue(undefined),
          create
        },
        jobRun: {
          upsert: vi.fn().mockResolvedValue(undefined),
          update: vi.fn().mockResolvedValue(undefined)
        },
        $executeRawUnsafe: vi.fn().mockResolvedValue(1)
      } as any;
      const service = new MessageIndexingService(
        prisma,
        { embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) } as any,
        { record: vi.fn().mockResolvedValue(undefined) } as any,
        { enqueue: vi.fn().mockResolvedValue(undefined) } as any
      );

      await service.runIndexJob({ messageId: `msg-${provider}` });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider,
            metadataJson: expect.objectContaining({
              provider,
              connectorId: `connector-${provider}`,
              threadId: `thread-${provider}`,
              messageId: `msg-${provider}`,
              sourceSubType,
              providerMessageId:
                provider === "slack" ? "C123:1716140000.000100" : "task:cu-1:comment:c1",
              providerPermalink:
                provider === "slack"
                  ? "https://example.slack.com/archives/C123/p1716140000000100"
                  : "https://app.clickup.com/t/cu-1?comment=c1",
              unavailable: false
            })
          })
        })
      );
    };

    await runProviderIndex("slack", "slack_thread_reply");
    await runProviderIndex("clickup", "clickup_task_comment");
  });

  it("indexes Fireflies transcript messages as timestamped speaker-segment chunks", async () => {
    const prisma = {
      communicationMessage: {
        findUnique: vi.fn().mockResolvedValue({
          id: "msg-fireflies",
          projectId: "project-1",
          connectorId: "connector-1",
          provider: "fireflies_ai",
          threadId: "thread-1",
          senderLabel: "Fireflies.ai transcript",
          senderEmail: null,
          sentAt: new Date("2026-05-12T10:00:00.000Z"),
          bodyText: "[00:12:04] Sarah Client: Let's change reporting from monthly to weekly.",
          bodyHtml: null,
          bodyHash: stableBodyHash("[00:12:04] Sarah Client: Let's change reporting from monthly to weekly.", null),
          rawMetadataJson: {
            fireflies: {
              segments: [
                {
                  speakerName: "Sarah Client",
                  speakerEmail: "sarah@example.com",
                  speakerId: "speaker-1",
                  startMs: 724000,
                  endMs: 741000,
                  segmentIndex: 0,
                  transcriptId: "ff-1",
                  meetingTitle: "Client Kickoff",
                  text: "Let's change reporting from monthly to weekly."
                }
              ]
            }
          },
          thread: {
            subject: "Client Kickoff",
            participantsJson: [{ label: "Sarah Client" }]
          },
          connector: { id: "connector-1", provider: "fireflies_ai" },
          attachments: [],
          project: { orgId: "org-1" }
        }),
        update: vi.fn().mockResolvedValue(undefined)
      },
      communicationMessageChunk: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue({ id: "chunk-fireflies-1" })
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined)
      },
      $executeRawUnsafe: vi.fn().mockResolvedValue(1)
    } as any;
    const service = new MessageIndexingService(
      prisma,
      { embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) } as any,
      { record: vi.fn().mockResolvedValue(undefined) } as any,
      { enqueue: vi.fn().mockResolvedValue(undefined) } as any
    );

    await service.runIndexJob({ messageId: "msg-fireflies", idempotencyKey: "index-message:msg-fireflies:test" });

    expect(prisma.communicationMessageChunk.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: "fireflies_ai",
          chunkIndex: 0,
          content: "Let's change reporting from monthly to weekly.",
          metadataJson: expect.objectContaining({
            meetingTitle: "Client Kickoff",
            speakerName: "Sarah Client",
            startMs: 724000,
            endMs: 741000,
            timestampLabel: "00:12:04-00:12:21",
            transcriptId: "ff-1"
          })
        })
      })
    );
  });

  it("keeps filtered timelines from under-returning when matches fall outside the first page", async () => {
    const threads = Array.from({ length: 5 }, (_, index) => ({
      id: `thread-${index + 1}`,
      connectorId: "connector-1",
      provider: "manual_import",
      providerThreadId: `provider-thread-${index + 1}`,
      subject: `Thread ${index + 1}`,
      participantsJson: [],
      startedAt: new Date("2026-04-19T10:00:00.000Z"),
      lastMessageAt: new Date(Date.UTC(2026, 3, 19, 10, 5 - index)),
      connector: { accountLabel: "Manual import" },
      messages: [
        {
          id: `message-${index + 1}`,
          senderLabel: "Client",
          sentAt: new Date(Date.UTC(2026, 3, 19, 10, 5 - index)),
          bodyText: `Message ${index + 1}`
        }
      ]
    }));

    const prisma = {
      communicationThread: {
        findMany: vi.fn().mockResolvedValue(threads)
      },
      specChangeLink: {
        groupBy: vi.fn().mockResolvedValue([
          { linkRefId: "thread-4", _count: { _all: 1 } },
          { linkRefId: "thread-5", _count: { _all: 1 } }
        ])
      },
      specChangeProposal: {
        findMany: vi.fn().mockResolvedValue([])
      },
      messageInsight: {
        groupBy: vi.fn().mockResolvedValue([])
      },
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ orgId: "org-1" })
      }
    } as any;
    const service = new TimelineService(
      prisma,
      { ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn().mockResolvedValue(undefined) } as any
    );

    const result = await service.getTimeline("project-1", "manager-1", {
      hasChangeProposal: true,
      limit: 2
    });

    expect(prisma.communicationThread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 41
      })
    );
    expect(result.items.map((item: { threadId: string }) => item.threadId)).toEqual(["thread-4", "thread-5"]);
  });

  it("suppresses exact duplicate communication projections before returning Memory rows", async () => {
    const baseThread = {
      connectorId: "connector-duplicate",
      provider: "fireflies_ai",
      subject: "Weekly product review",
      participantsJson: [],
      threadUrl: null,
      rawMetadataJson: { sourceSubType: "fireflies_transcript" },
      startedAt: new Date("2026-08-20T10:00:00.000Z"),
      connector: { accountLabel: "Product calls" }
    };
    const threads = [
      {
        ...baseThread,
        id: "thread-newest",
        providerThreadId: "import-2",
        lastMessageAt: new Date("2026-08-20T10:05:00.000Z"),
        messages: [{ id: "message-newest", providerMessageId: "message-2", providerPermalink: null, senderLabel: "Karthik", sentAt: new Date("2026-08-20T10:05:00.000Z"), bodyText: "Ship the approved launch scope.", isDeletedByProvider: false, rawMetadataJson: {} }]
      },
      {
        ...baseThread,
        id: "thread-older",
        providerThreadId: "import-1",
        lastMessageAt: new Date("2026-08-20T10:04:00.000Z"),
        messages: [{ id: "message-older", providerMessageId: "message-1", providerPermalink: null, senderLabel: "Karthik", sentAt: new Date("2026-08-20T10:04:00.000Z"), bodyText: "  ship the approved launch scope.  ", isDeletedByProvider: false, rawMetadataJson: {} }]
      }
    ];
    const prisma = {
      communicationThread: { findMany: vi.fn().mockResolvedValue(threads) },
      specChangeLink: { groupBy: vi.fn().mockResolvedValue([]) },
      specChangeProposal: { findMany: vi.fn().mockResolvedValue([]) },
      messageInsight: { groupBy: vi.fn().mockResolvedValue([]) },
      project: { findUniqueOrThrow: vi.fn().mockResolvedValue({ orgId: "org-duplicate" }) }
    } as any;
    const service = new TimelineService(
      prisma,
      { ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn().mockResolvedValue(undefined) } as any
    );

    const result = await service.listThreads("project-duplicate", "manager-1", { limit: 25 });

    expect(result.items.map((item: { threadId: string }) => item.threadId)).toEqual(["thread-newest"]);
    expect(prisma.communicationThread.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 101 }));
  });

  it("reuses cached communication timeline payloads after checking project access", async () => {
    const threads = [
      {
        id: "thread-cache",
        connectorId: "connector-cache",
        provider: "manual_import",
        providerThreadId: "manual:thread-cache",
        subject: "Cached timeline",
        participantsJson: [{ label: "Client" }],
        threadUrl: null,
        rawMetadataJson: { sourceSubType: "manual_import" },
        startedAt: new Date("2026-05-19T10:00:00.000Z"),
        lastMessageAt: new Date("2026-05-19T10:05:00.000Z"),
        connector: { accountLabel: "Manual import" },
        messages: [
          {
            id: "message-cache",
            providerMessageId: "manual:message-cache",
            providerPermalink: null,
            senderLabel: "Client",
            sentAt: new Date("2026-05-19T10:05:00.000Z"),
            bodyText: "Please review delivery risk.",
            isDeletedByProvider: false,
            rawMetadataJson: { sourceSubType: "manual_import" }
          }
        ]
      }
    ];
    const prisma = {
      communicationThread: {
        findMany: vi.fn().mockResolvedValue(threads)
      },
      specChangeLink: {
        groupBy: vi.fn().mockResolvedValue([])
      },
      specChangeProposal: {
        findMany: vi.fn().mockResolvedValue([])
      },
      messageInsight: {
        groupBy: vi.fn().mockResolvedValue([])
      },
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ orgId: "org-1" })
      }
    } as any;
    const ensureProjectAccess = vi.fn().mockResolvedValue({ projectRole: "manager" });
    const service = new TimelineService(
      prisma,
      { ensureProjectAccess } as any,
      { record: vi.fn().mockResolvedValue(undefined) } as any
    );

    const first = await service.getTimeline("project-1", "manager-1", { limit: 10 });
    const second = await service.getTimeline("project-1", "manager-1", { limit: 10 });

    expect(first).toEqual(second);
    expect(ensureProjectAccess).toHaveBeenCalledTimes(2);
    expect(prisma.communicationThread.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.specChangeLink.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.specChangeProposal.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.messageInsight.groupBy).toHaveBeenCalledTimes(2);
  });

  it("does not fail timeline reads when read-audit storage fails", async () => {
    const threads = [
      {
        id: "thread-audit",
        connectorId: "connector-audit",
        provider: "manual_import",
        providerThreadId: "manual:thread-audit",
        subject: "Audit-safe timeline",
        participantsJson: [{ label: "Client" }],
        threadUrl: null,
        rawMetadataJson: { sourceSubType: "manual_import" },
        startedAt: new Date("2026-05-19T10:00:00.000Z"),
        lastMessageAt: new Date("2026-05-19T10:05:00.000Z"),
        connector: { accountLabel: "Manual import" },
        messages: [
          {
            id: "message-audit",
            providerMessageId: "manual:message-audit",
            providerPermalink: null,
            senderLabel: "Client",
            sentAt: new Date("2026-05-19T10:05:00.000Z"),
            bodyText: "Timeline should still load if audit storage is unavailable.",
            isDeletedByProvider: false,
            rawMetadataJson: { sourceSubType: "manual_import" }
          }
        ]
      }
    ];
    const prisma = {
      communicationThread: {
        findMany: vi.fn().mockResolvedValue(threads)
      },
      specChangeLink: {
        groupBy: vi.fn().mockResolvedValue([])
      },
      specChangeProposal: {
        findMany: vi.fn().mockResolvedValue([])
      },
      messageInsight: {
        groupBy: vi.fn().mockResolvedValue([])
      },
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ orgId: "org-1" })
      }
    } as any;
    const auditService = {
      record: vi.fn().mockRejectedValue(new Error("audit storage unavailable"))
    };
    const service = new TimelineService(
      prisma,
      { ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      auditService as any
    );

    const result = await service.getTimeline("project-1", "manager-1", { limit: 10 });
    await Promise.resolve();

    expect(result.items).toHaveLength(1);
    expect(result.items[0].threadId).toBe("thread-audit");
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "communication_timeline"
    }));
  });

  it("filters provider evidence timelines by connector, source subtype, insight status, and proposal status", async () => {
    const threads = [
      {
        id: "thread-slack",
        connectorId: "3322717f-2c10-4239-b525-6fbc9158f4fb",
        provider: "slack",
        providerThreadId: "C123:1716140000.000100",
        subject: "Slack auth thread",
        participantsJson: [{ label: "Client" }],
        threadUrl: "https://example.slack.com/archives/C123/p1716140000000100",
        rawMetadataJson: { channelId: "C123", teamId: "T123", sourceSubType: "slack_channel_thread" },
        startedAt: new Date("2026-05-19T10:00:00.000Z"),
        lastMessageAt: new Date("2026-05-19T10:05:00.000Z"),
        connector: { accountLabel: "Client Slack" },
        messages: [
          {
            id: "message-slack",
            providerMessageId: "C123:1716140000.000100",
            providerPermalink: "https://example.slack.com/archives/C123/p1716140000000100",
            senderLabel: "Client",
            sentAt: new Date("2026-05-19T10:05:00.000Z"),
            bodyText: "Slack says auth must support SSO.",
            isDeletedByProvider: false,
            rawMetadataJson: {
              sourceSubType: "slack_thread_reply",
              channelId: "C123",
              threadTs: "1716140000.000100",
              messageTs: "1716140300.000200"
            }
          }
        ]
      },
      {
        id: "thread-clickup",
        connectorId: "49c1df3a-6ad5-4b72-b0db-663b365b9c90",
        provider: "clickup",
        providerThreadId: "task:cu-1",
        subject: "ClickUp dashboard task",
        participantsJson: [],
        threadUrl: "https://app.clickup.com/t/cu-1",
        rawMetadataJson: { taskId: "cu-1", sourceSubType: "clickup_task" },
        startedAt: new Date("2026-05-19T09:00:00.000Z"),
        lastMessageAt: new Date("2026-05-19T09:01:00.000Z"),
        connector: { accountLabel: "ClickUp" },
        messages: [
          {
            id: "message-clickup",
            providerMessageId: "task:cu-1:comment:c1",
            providerPermalink: "https://app.clickup.com/t/cu-1?comment=c1",
            senderLabel: "PM",
            sentAt: new Date("2026-05-19T09:01:00.000Z"),
            bodyText: "ClickUp comment for a different connector.",
            isDeletedByProvider: false,
            rawMetadataJson: { sourceSubType: "clickup_task_comment", taskId: "cu-1", commentId: "c1" }
          }
        ]
      }
    ];

    const prisma = {
      communicationThread: {
        findMany: vi.fn().mockResolvedValue(threads)
      },
      specChangeLink: {
        groupBy: vi.fn().mockResolvedValue([{ linkRefId: "thread-slack", _count: { _all: 1 } }])
      },
      specChangeProposal: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "proposal-slack",
            status: "needs_review",
            links: [{ linkType: "thread", linkRefId: "thread-slack" }]
          }
        ])
      },
      messageInsight: {
        groupBy: vi.fn(async (args) => {
          if (args.where.status === "detected") {
            return [{ threadId: "thread-slack", status: "detected", _count: { _all: 1 } }];
          }
          if (args.where.insightType === "requirement_change") {
            return [{ threadId: "thread-slack", _count: { _all: 1 } }];
          }
          if (args.where.insightType === "blocker") {
            return [];
          }
          return [];
        })
      },
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ orgId: "org-1" })
      }
    } as any;
    const service = new TimelineService(
      prisma,
      { ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn().mockResolvedValue(undefined) } as any
    );

    const result = await service.getTimeline("project-1", "manager-1", {
      provider: "slack",
      connectorId: "3322717f-2c10-4239-b525-6fbc9158f4fb",
      sourceSubType: "slack_thread_reply",
      insightType: "requirement_change",
      insightStatus: "detected",
      proposalStatus: "needs_review",
      limit: 10
    } as any);

    expect(prisma.communicationThread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: "slack",
          connectorId: "3322717f-2c10-4239-b525-6fbc9158f4fb",
          OR: expect.arrayContaining([
            expect.objectContaining({
              rawMetadataJson: expect.objectContaining({
                path: ["sourceSubType"],
                equals: "slack_thread_reply"
              })
            }),
            expect.objectContaining({
              messages: expect.objectContaining({
                some: expect.objectContaining({
                  rawMetadataJson: expect.objectContaining({
                    path: ["sourceSubType"],
                    equals: "slack_thread_reply"
                  })
                })
              })
            })
          ])
        })
      })
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        threadId: "thread-slack",
        connectorId: "3322717f-2c10-4239-b525-6fbc9158f4fb",
        provider: "slack",
        sourceSubTypes: expect.arrayContaining(["slack_channel_thread", "slack_thread_reply"]),
        proposalStatuses: ["needs_review"],
        insightStatuses: ["detected"],
        providerOpenTarget: expect.objectContaining({
          provider: "slack",
          connectorId: "3322717f-2c10-4239-b525-6fbc9158f4fb",
          threadId: "thread-slack",
          messageId: "message-slack",
          sourceSubType: "slack_thread_reply",
          url: "https://example.slack.com/archives/C123/p1716140000000100",
          unavailable: false
        })
      })
    );
  });

  it("matches thread-level provider source subtypes and represents deleted provider evidence as unavailable", async () => {
    const prisma = {
      communicationThread: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "thread-clickup",
            connectorId: "49c1df3a-6ad5-4b72-b0db-663b365b9c90",
            provider: "clickup",
            providerThreadId: "task:cu-1",
            subject: "ClickUp dashboard task",
            participantsJson: [],
            threadUrl: "https://app.clickup.com/t/cu-1",
            rawMetadataJson: { taskId: "cu-1", sourceSubType: "clickup_task" },
            startedAt: new Date("2026-05-19T09:00:00.000Z"),
            lastMessageAt: new Date("2026-05-19T09:01:00.000Z"),
            connector: { accountLabel: "ClickUp" },
            messages: [
              {
                id: "message-clickup-deleted",
                providerMessageId: "task:cu-1:comment:c1",
                providerPermalink: "https://app.clickup.com/t/cu-1?comment=c1",
                senderLabel: "PM",
                sentAt: new Date("2026-05-19T09:01:00.000Z"),
                bodyText: "Deleted provider evidence should not be previewed.",
                isDeletedByProvider: true,
                rawMetadataJson: { sourceSubType: "clickup_task_comment", taskId: "cu-1", commentId: "c1" }
              }
            ]
          }
        ])
      },
      specChangeLink: {
        groupBy: vi.fn().mockResolvedValue([])
      },
      specChangeProposal: {
        findMany: vi.fn().mockResolvedValue([])
      },
      messageInsight: {
        groupBy: vi.fn().mockResolvedValue([])
      },
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ orgId: "org-1" })
      }
    } as any;
    const service = new TimelineService(
      prisma,
      { ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn().mockResolvedValue(undefined) } as any
    );

    const result = await service.getTimeline("project-1", "manager-1", {
      provider: "clickup",
      sourceSubType: "clickup_task",
      limit: 10
    } as any);

    expect(prisma.communicationThread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: "clickup",
          OR: expect.arrayContaining([
            expect.objectContaining({
              rawMetadataJson: expect.objectContaining({
                path: ["sourceSubType"],
                equals: "clickup_task"
              })
            })
          ])
        })
      })
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        provider: "clickup",
        sourceSubTypes: expect.arrayContaining(["clickup_task", "clickup_task_comment"]),
        latestMessage: expect.objectContaining({
          id: "message-clickup-deleted",
          excerpt: null,
          unavailable: true
        }),
        providerOpenTarget: expect.objectContaining({
          provider: "clickup",
          unavailable: true,
          visibility: "project_internal"
        })
      })
    );
  });
});
