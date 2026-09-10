import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAggregateCachesForTests } from "../src/lib/dashboard/aggregate-cache.js";
import { buildDocumentStorageKey, DocumentService } from "../src/modules/documents/service.js";

describe("DocumentService", () => {
  beforeEach(() => {
    clearAggregateCachesForTests();
  });

  it("builds upload storage keys without embedding raw filenames", () => {
    const key = buildDocumentStorageKey(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "abcdef",
      "../client kickoff final!!.PDF"
    );

    expect(key).toBe("11111111-1111-4111-8111-111111111111/documents/22222222-2222-4222-8222-222222222222/abcdef.pdf");
    expect(key).not.toContain("client kickoff");
    expect(key).not.toContain("..");
  });

  it("caches document list payloads after checking project access", async () => {
    const document = {
      id: "document-1",
      projectId: "project-1",
      title: "Core PRD",
      kind: "prd",
      visibility: "internal",
      currentVersionId: "version-1",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      updatedAt: new Date("2026-05-02T00:00:00.000Z")
    };
    const version = {
      id: "version-1",
      status: "ready",
      parseRevision: 1,
      parseConfidence: null,
      sourceLabel: "Upload",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      processedAt: new Date("2026-05-01T00:01:00.000Z")
    };
    const prisma = {
      document: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([document])
      },
      documentVersion: {
        findMany: vi.fn().mockResolvedValue([version])
      },
      projectNotionResource: {
        findMany: vi.fn().mockResolvedValue([])
      }
    } as any;
    const ensureProjectAccess = vi.fn().mockResolvedValue({ projectRole: "manager" });
    const service = new DocumentService(
      prisma,
      { putObject: vi.fn(), getObject: vi.fn() } as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectAccess } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const first = await service.listDocuments("project-1", "manager-1", { page: 1, pageSize: 25 });
    const second = await service.listDocuments("project-1", "manager-1", { page: 1, pageSize: 25 });

    expect(first).toEqual(second);
    expect(ensureProjectAccess).toHaveBeenCalledTimes(2);
    expect(prisma.document.count).toHaveBeenCalledTimes(1);
    expect(prisma.document.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.documentVersion.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.projectNotionResource.findMany).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported document uploads before storage writes", async () => {
    const storage = { putObject: vi.fn() };
    const prisma = {
      project: { findUniqueOrThrow: vi.fn() },
      document: { findFirst: vi.fn() },
      documentVersion: {},
      auditEvent: { create: vi.fn() }
    } as any;
    const service = new DocumentService(
      prisma,
      storage as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectMemberCanUploadContext: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await expect(
      service.uploadFile({
        projectId: "project-1",
        actorUserId: "user-1",
        kind: "other",
        title: "Executable",
        visibility: "internal",
        fileName: "payload.exe",
        contentType: "application/octet-stream",
        buffer: Buffer.from([0x4d, 0x5a, 0x00, 0x01])
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "unsupported_document_file_type"
    });

    expect(storage.putObject).not.toHaveBeenCalled();
    expect(prisma.project.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("rejects document upload MIME and extension mismatches before storage writes", async () => {
    const storage = { putObject: vi.fn() };
    const service = new DocumentService(
      {} as any,
      storage as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectMemberCanUploadContext: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await expect(
      service.uploadFile({
        projectId: "project-1",
        actorUserId: "user-1",
        kind: "other",
        title: "Fake image",
        visibility: "internal",
        fileName: "screenshot.png",
        contentType: "text/plain",
        buffer: Buffer.from("this is not an allowed document")
      })
    ).rejects.toMatchObject({
      code: "document_file_type_mismatch"
    });

    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("rejects forged document signatures before storage writes", async () => {
    const storage = { putObject: vi.fn() };
    const service = new DocumentService(
      {} as any,
      storage as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectMemberCanUploadContext: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await expect(
      service.uploadFile({
        projectId: "project-1",
        actorUserId: "user-1",
        kind: "other",
        title: "Forged PDF",
        visibility: "internal",
        fileName: "forged.pdf",
        contentType: "application/pdf",
        buffer: Buffer.from("not a pdf")
      })
    ).rejects.toMatchObject({
      code: "document_file_signature_mismatch"
    });

    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("[R03] records the client upload operation on a deduplicated retry", async () => {
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new DocumentService(
      {
        project: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" }) },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: "document-1",
          versions: [{ id: "version-1", status: "pending", parseRevision: 1 }]
        })
      },
      documentVersion: { findUnique: vi.fn().mockResolvedValue(null) }
      } as any,
      { putObject: vi.fn() } as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectMemberCanUploadContext: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      audit as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const result = await service.uploadFile({
      projectId: "project-1",
      actorUserId: "user-1",
      kind: "reference",
      title: "Core upload",
      visibility: "internal",
      fileName: "core.txt",
      contentType: "text/plain",
      buffer: Buffer.from("A valid text upload"),
      operationId: "11111111-1111-4111-8111-111111111111"
    });

    expect(result).toMatchObject({ documentId: "document-1", documentVersionId: "version-1", deduplicated: true, operationId: "11111111-1111-4111-8111-111111111111" });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "document_upload_deduplicated",
      payload: expect.objectContaining({ operationId: "11111111-1111-4111-8111-111111111111" })
    }));
  });

  it("[R03] reconciles a completed upload by its durable operation id", async () => {
    const access = vi.fn().mockResolvedValue({ projectRole: "manager" });
    const service = new DocumentService(
      {
        documentVersion: {
          findFirst: vi.fn().mockResolvedValue({
            id: "11111111-1111-4111-8111-111111111111",
            documentId: "document-1",
            projectId: "project-1",
            status: "pending",
            parseRevision: 1
          })
        }
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { ensureProjectMemberCanUploadContext: access } as any,
      {} as any,
      {} as any
    );

    await expect(service.getUploadOperation("project-1", "user-1", "11111111-1111-4111-8111-111111111111"))
      .resolves.toEqual({ documentId: "document-1", documentVersionId: "11111111-1111-4111-8111-111111111111", status: "pending", parseRevision: 1, operationId: "11111111-1111-4111-8111-111111111111" });
    expect(access).toHaveBeenCalledWith("project-1", "user-1");
  });

  it("[R03] reconciles a deduplicated upload from its durable audit operation", async () => {
    const operationId = "11111111-1111-4111-8111-111111111111";
    const version = { id: "version-1", documentId: "document-1", projectId: "project-1", status: "pending", parseRevision: 1 };
    const service = new DocumentService(
      {
        documentVersion: { findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(version) },
        auditEvent: {
          findFirst: vi.fn().mockResolvedValue({
            entityType: "document_version",
            entityId: "version-1",
            payloadJson: { operationId }
          })
        }
      } as any,
      {} as any, {} as any, {} as any, {} as any,
      { ensureProjectMemberCanUploadContext: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      {} as any, {} as any
    );

    await expect(service.getUploadOperation("project-1", "user-1", operationId))
      .resolves.toEqual({ documentId: "document-1", documentVersionId: "version-1", status: "pending", parseRevision: 1, operationId });
  });

  it("[R05] keeps the winner's storage object and dispatches one job when concurrent uploads claim one operation", async () => {
    const operationId = "11111111-1111-4111-8111-111111111111";
    const keys = new Map<string, Buffer>();
    const storage = {
      putObject: vi.fn(async ({ key, body }) => { keys.set(key, body); return { key, size: body.length }; }),
      deleteObject: vi.fn(async (key) => { keys.delete(key); })
    };
    let operationLookups = 0;
    let releaseOperationLookups!: () => void;
    const bothOperationLookups = new Promise<void>((resolve) => { releaseOperationLookups = resolve; });
    let versionCreates = 0;
    const canonical = {
      id: operationId,
      documentId: "document-1",
      projectId: "project-1",
      checksumSha256: createHash("sha256").update("Concurrent document upload").digest("hex"),
      mimeType: "text/plain",
      fileSize: BigInt(Buffer.byteLength("Concurrent document upload")),
      sourceLabel: "Synthetic upload",
      uploadedBy: "user-1",
      status: "pending",
      parseRevision: 1,
      document: { id: "document-1", projectId: "project-1", kind: "other", title: "Concurrent upload", visibility: "internal" }
    };
    const prisma = {
      project: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" }) },
      document: { findFirst: vi.fn().mockResolvedValue({ id: "document-1", versions: [] }) },
      documentVersion: {
        findUnique: vi.fn(async () => {
          operationLookups += 1;
          if (operationLookups <= 2) {
            if (operationLookups === 2) releaseOperationLookups();
            await bothOperationLookups;
            return null;
          }
          return canonical;
        })
      },
      jobRun: { upsert: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (callback) => callback({
        document: { update: vi.fn().mockResolvedValue({}) },
        documentVersion: {
          create: vi.fn(async () => {
            versionCreates += 1;
            if (versionCreates === 2) throw Object.assign(new Error("unique operation id"), { code: "P2002" });
            return canonical;
          })
        }
      }))
    } as any;
    const jobs = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const service = new DocumentService(
      prisma,
      storage as any,
      jobs as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectMemberCanUploadContext: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn().mockResolvedValue(undefined) } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any,
      { ORCHESTRA_PROFILE: "mvp_beta", MVP_BETA_MODE: true } as any
    );
    const input = {
      projectId: "project-1",
      actorUserId: "user-1",
      kind: "other" as const,
      title: "Concurrent upload",
      visibility: "internal" as const,
      sourceLabel: "Synthetic upload",
      fileName: "concurrent.txt",
      contentType: "text/plain",
      buffer: Buffer.from("Concurrent document upload"),
      operationId
    };

    const [first, second] = await Promise.all([service.uploadFile(input), service.uploadFile(input)]);

    expect([first.documentVersionId, second.documentVersionId]).toEqual([operationId, operationId]);
    expect(storage.putObject).toHaveBeenCalledTimes(2);
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(keys.size).toBe(1);
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
  });

  it("[R05] fails closed when an operation id is already claimed by another project", async () => {
    const storage = { putObject: vi.fn() };
    const service = new DocumentService(
      {
        project: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" }) },
        documentVersion: {
          findUnique: vi.fn().mockResolvedValue({
            id: "11111111-1111-4111-8111-111111111111",
            projectId: "project-2",
            checksumSha256: "different",
            mimeType: "text/plain",
            fileSize: BigInt(1),
            sourceLabel: null,
            uploadedBy: "user-2",
            status: "pending",
            parseRevision: 1,
            document: { id: "document-2", projectId: "project-2", kind: "other", title: "Other", visibility: "internal" }
          })
        }
      } as any,
      storage as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectMemberCanUploadContext: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await expect(service.uploadFile({
      projectId: "project-1", actorUserId: "user-1", kind: "other", title: "Concurrent upload", visibility: "internal",
      fileName: "concurrent.txt", contentType: "text/plain", buffer: Buffer.from("Concurrent document upload"),
      operationId: "11111111-1111-4111-8111-111111111111"
    })).rejects.toMatchObject({ statusCode: 409, code: "document_upload_operation_conflict" });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("does not enqueue dashboard refresh jobs for beta document uploads", async () => {
    const storage = { putObject: vi.fn() };
    const jobs = { enqueue: vi.fn() };
    const prisma = {
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" }),
        findUnique: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" })
      },
      document: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue({})
      },
      $transaction: vi.fn(async (callback) =>
        callback({
          document: {
            create: vi.fn().mockResolvedValue({ id: "document-1" }),
            update: vi.fn().mockResolvedValue({})
          },
          documentVersion: {
            create: vi.fn().mockResolvedValue({
              id: "version-1",
              status: "pending",
              parseRevision: 1
            })
          }
        })
      )
    } as any;

    const service = new DocumentService(
      prisma,
      storage as any,
      jobs as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectMemberCanUploadContext: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any,
      {
        ORCHESTRA_PROFILE: "mvp_beta",
        MVP_BETA_MODE: true
      } as any
    );

    await service.uploadFile({
      projectId: "project-1",
      actorUserId: "user-1",
      kind: "other",
      title: "Beta QA Note",
      visibility: "internal",
      fileName: "beta-note.txt",
      contentType: "text/plain",
      buffer: Buffer.from("Beta QA Socrates document upload.")
    });

    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(jobs.enqueue).toHaveBeenCalledWith("parse_document", expect.any(Object), expect.any(String));
    expect(jobs.enqueue).not.toHaveBeenCalledWith("refresh_dashboard_snapshot", expect.anything(), expect.anything());
  });

  it("skips stale parse jobs instead of mutating newer parse revisions", async () => {
    const prisma = {
      documentVersion: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "ver-1",
          projectId: "project-1",
          parseRevision: 2,
          fileKey: "file-key",
          mimeType: "text/markdown",
          document: {
            title: "Core PRD"
          }
        })
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined)
      }
    } as any;

    const storage = {
      getObject: vi.fn()
    } as any;

    const service = new DocumentService(
      prisma,
      storage,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectManager: vi.fn(), ensureProjectAccess: vi.fn() } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const result = await service.processDocumentVersion("ver-1", 1);

    expect(result).toEqual({ skipped: true, reason: "stale_parse_revision" });
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it("assigns chunk indices monotonically across sections within a parse revision", async () => {
    const createChunk = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      documentVersion: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "ver-1",
          projectId: "project-1",
          parseRevision: 1,
          document: {
            title: "Core PRD",
            kind: "prd"
          }
        })
      },
      documentSection: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "sec-1",
            normalizedText: "one two three four five six",
            headingPath: ["Overview"],
            pageNumber: 1,
            anchorId: "overview-1",
            orderIndex: 0
          },
          {
            id: "sec-2",
            normalizedText: "seven eight nine ten eleven twelve",
            headingPath: ["Flow"],
            pageNumber: 2,
            anchorId: "flow-1",
            orderIndex: 1
          }
        ])
      },
      documentChunk: {
        deleteMany: vi.fn().mockResolvedValue(undefined),
        create: createChunk
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined)
      }
    } as any;

    const jobs = {
      enqueue: vi.fn().mockResolvedValue(undefined)
    };

    const service = new DocumentService(
      prisma,
      {} as any,
      jobs as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectManager: vi.fn(), ensureProjectAccess: vi.fn() } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await service.chunkDocumentVersion("ver-1", 1);

    const chunkIndexes = createChunk.mock.calls.map(([call]) => call.data.chunkIndex);
    expect(chunkIndexes).toEqual([0, 1]);
    expect(createChunk.mock.calls[0][0].data.parseRevision).toBe(1);
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
  });

  it("returns viewer markers with linked decisions and message refs", async () => {
    const prisma = {
      document: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "doc-1",
          title: "Core PRD",
          kind: "prd",
          visibility: "internal",
          currentVersionId: "ver-1",
          projectId: "project-1",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z")
        })
      },
      documentVersion: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "ver-1",
          status: "ready",
          parseRevision: 2,
          parseConfidence: "0.900",
          sourceLabel: "Uploaded PRD",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          processedAt: new Date("2026-01-02T00:00:00.000Z")
        })
      },
      documentSection: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "sec-1",
            anchorId: "overview-1",
            pageNumber: 1,
            headingPath: ["Overview"],
            normalizedText: "Product overview",
            orderIndex: 0
          }
        ])
      },
      specChangeLink: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              specChangeProposalId: "proposal-1",
              linkRefId: "sec-1",
              proposal: {
                id: "proposal-1",
                proposalType: "requirement_update",
                status: "accepted",
                acceptedAt: new Date("2026-01-01T00:00:00.000Z"),
                acceptedBy: "manager-1",
                decisionRecordId: "decision-1",
                title: "Update requirement",
                summary: "The requirement changed after client feedback"
              }
            }
          ])
          .mockResolvedValueOnce([
            {
              specChangeProposalId: "proposal-1",
              linkType: "message",
              linkRefId: "msg-1"
            },
            {
              specChangeProposalId: "proposal-1",
              linkType: "message",
              linkRefId: "msg-deleted"
            }
          ])
      },
      communicationMessage: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "msg-1",
            senderLabel: "Client",
            sentAt: new Date("2026-01-02T00:00:00.000Z"),
            threadId: "thread-1"
          },
          {
            id: "msg-deleted",
            senderLabel: "Deleted Client",
            sentAt: new Date("2026-01-03T00:00:00.000Z"),
            threadId: "thread-1",
            isDeletedByProvider: true
          }
        ])
      },
      communicationThread: {
        findMany: vi.fn().mockResolvedValue([])
      }
    } as any;

    const service = new DocumentService(
      prisma,
      {} as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectManager: vi.fn(), ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const payload = await service.getViewerPayload("project-1", "doc-1", "user-1");
    const section = payload.sections[0];

    expect(section.linkedDecisionIds).toEqual(["decision-1"]);
    expect(section.linkedMessageRefs[0]).toMatchObject({
      type: "message",
      id: "msg-1",
      senderLabel: "Client"
    });
    expect(section.linkedMessageRefs.map((ref: any) => ref.id)).not.toContain("msg-deleted");
    expect(prisma.communicationMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isDeletedByProvider: false
        })
      })
    );
    expect(section.changeMarkers[0]).toMatchObject({
      changeProposalId: "proposal-1",
      status: "accepted"
    });
  });

  it("filters document listing for client members to shared documents only", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      document: {
        count,
        findMany
      }
    } as any;

    const service = new DocumentService(
      prisma,
      {} as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectManager: vi.fn(), ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "client" }) } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await service.listDocuments("project-1", "client-1");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: "project-1",
          visibility: "shared_with_client"
        })
      })
    );
    expect(count).toHaveBeenCalled();
  });

  it("looks up anchors directly from the selected version instead of the first page window", async () => {
    const findFirstOrThrow = vi
      .fn()
      .mockResolvedValueOnce({
        id: "doc-1",
        title: "Core PRD",
        kind: "prd",
        visibility: "internal",
        currentVersionId: "ver-1",
        projectId: "project-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z")
      })
      .mockResolvedValueOnce({
        id: "ver-1",
        status: "ready",
        parseRevision: 4,
        parseConfidence: "0.900",
        sourceLabel: "Uploaded PRD",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        processedAt: new Date("2026-01-02T00:00:00.000Z")
      })
      .mockResolvedValueOnce({
        id: "sec-anchor",
        anchorId: "deep-anchor",
        pageNumber: 42,
        headingPath: ["Appendix", "Deep requirement"],
        normalizedText: "Deep requirement text",
        orderIndex: 401
      });

    const prisma = {
      document: {
        findFirstOrThrow
      },
      documentVersion: {
        findFirstOrThrow
      },
      documentSection: {
        findFirstOrThrow,
        findMany: vi.fn().mockResolvedValue([])
      },
      specChangeLink: {
        findMany: vi.fn().mockResolvedValue([])
      }
    } as any;

    const service = new DocumentService(
      prisma,
      {} as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectManager: vi.fn(), ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const payload = await service.getAnchor("project-1", "doc-1", "deep-anchor", "user-1");

    expect(payload.viewerState.pageNumber).toBe(42);
    expect(payload.section.anchorId).toBe("deep-anchor");
    expect(findFirstOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          documentVersionId: "ver-1",
          parseRevision: 4,
          anchorId: "deep-anchor"
        })
      })
    );
  });

  it("strips message refs and decision ids from client-safe viewer payloads", async () => {
    const prisma = {
      document: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "doc-1",
          title: "Shared PRD",
          kind: "prd",
          visibility: "shared_with_client",
          currentVersionId: "ver-1",
          projectId: "project-1",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z")
        })
      },
      documentVersion: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "ver-1",
          status: "ready",
          parseRevision: 1,
          parseConfidence: "0.900",
          sourceLabel: "Uploaded PRD",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          processedAt: new Date("2026-01-02T00:00:00.000Z")
        })
      },
      documentSection: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "sec-1",
            anchorId: "overview-1",
            pageNumber: 1,
            headingPath: ["Overview"],
            normalizedText: "Shared requirement",
            orderIndex: 0
          }
        ])
      },
      specChangeLink: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              specChangeProposalId: "proposal-1",
              linkRefId: "sec-1",
              proposal: {
                id: "proposal-1",
                proposalType: "requirement_update",
                status: "accepted",
                acceptedAt: new Date("2026-01-01T00:00:00.000Z"),
                acceptedBy: "manager-1",
                decisionRecordId: "decision-1",
                title: "Update requirement",
                summary: "Accepted client-safe summary"
              }
            }
          ])
          .mockResolvedValueOnce([
            { specChangeProposalId: "proposal-1", linkType: "message", linkRefId: "msg-1" },
            { specChangeProposalId: "proposal-1", linkType: "thread", linkRefId: "thread-1" },
            { specChangeProposalId: "proposal-1", linkType: "brain_node", linkRefId: "node-1" }
          ])
      }
    } as any;

    const service = new DocumentService(
      prisma,
      {} as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectManager: vi.fn(), ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "client" }) } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const payload = await service.getViewerPayload("project-1", "doc-1", "client-1");
    const section = payload.sections[0];

    expect(section.linkedDecisionIds).toEqual([]);
    expect(section.linkedMessageRefs).toEqual([]);
    expect(section.changeMarkers[0]).toMatchObject({
      changeProposalId: null,
      decisionRecordId: null,
      linkedBrainNodeIds: [],
      linkedThreadIds: [],
      linkedMessageRefs: []
    });
  });

  it("returns section search results with snippets and open targets", async () => {
    const prisma = {
      document: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "doc-1",
          title: "Core PRD",
          kind: "prd",
          visibility: "internal",
          currentVersionId: "ver-1",
          projectId: "project-1",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z")
        })
      },
      documentVersion: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "ver-1",
          status: "ready",
          parseRevision: 2,
          parseConfidence: "0.900",
          sourceLabel: "Uploaded PRD",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          processedAt: new Date("2026-01-02T00:00:00.000Z")
        })
      },
      documentSection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "sec-1",
            anchorId: "voice-notes",
            pageNumber: 3,
            headingPath: ["Input", "Voice notes"],
            normalizedText: "The system should support lightweight voice note capture for early product idea intake.",
            orderIndex: 8
          }
        ])
      }
    } as any;

    const service = new DocumentService(
      prisma,
      {} as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectManager: vi.fn(), ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const result = await service.searchDocument("project-1", "doc-1", "user-1", { q: "voice note", limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      anchorId: "voice-notes",
      pageNumber: 3,
      openTarget: {
        targetType: "document_section",
        targetRef: expect.objectContaining({
          documentId: "doc-1",
          documentVersionId: "ver-1",
          anchorId: "voice-notes"
        })
      }
    });
    expect(result.items[0].snippet.toLowerCase()).toContain("voice note");
  });

  it("returns provenance bundles with linked graph, changes, decisions, and messages", async () => {
    const specChangeLinkFindMany = vi.fn((args?: any) => {
      const linkType = args?.where?.linkType;
      const sectionLinkIds = args?.where?.linkRefId?.in;

      if (linkType === "document_section" && Array.isArray(sectionLinkIds)) {
        if (sectionLinkIds.includes("sec-1")) {
          return Promise.resolve([
            {
              specChangeProposalId: "proposal-1",
              linkRefId: "sec-1",
              proposal: {
                id: "proposal-1",
                proposalType: "requirement_update",
                status: "accepted",
                title: "Weekly reporting",
                summary: "Client requested weekly reporting",
                acceptedAt: new Date("2026-01-03T00:00:00.000Z"),
                acceptedBy: "manager-1",
                decisionRecordId: "decision-1",
                decisionRecord: {
                  id: "decision-1",
                  title: "Weekly reporting approved",
                  statement: "Use weekly reporting",
                  status: "accepted"
                }
              }
            }
          ]);
        }

        return Promise.resolve([]);
      }

      if (linkType === "document_section" && args?.where?.linkRefId === "sec-1") {
        return Promise.resolve([
          {
            specChangeProposalId: "proposal-1",
            linkRefId: "sec-1",
            proposal: {
              id: "proposal-1",
              proposalType: "requirement_update",
              status: "accepted",
              title: "Weekly reporting",
              summary: "Client requested weekly reporting",
              acceptedAt: new Date("2026-01-03T00:00:00.000Z"),
              acceptedBy: "manager-1",
              decisionRecordId: "decision-1",
              decisionRecord: {
                id: "decision-1",
                title: "Weekly reporting approved",
                statement: "Use weekly reporting",
                status: "accepted"
              }
            }
          }
        ]);
      }

      if (args?.where?.specChangeProposalId?.in) {
        return Promise.resolve([
          { specChangeProposalId: "proposal-1", linkType: "message", linkRefId: "msg-1" },
          { specChangeProposalId: "proposal-1", linkType: "thread", linkRefId: "thread-1" },
          { specChangeProposalId: "proposal-1", linkType: "brain_node", linkRefId: "node-1" }
        ]);
      }

      return Promise.resolve([]);
    });

    const prisma = {
      document: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "doc-1",
          title: "Core PRD",
          kind: "prd",
          visibility: "internal",
          currentVersionId: "ver-1",
          projectId: "project-1",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z")
        })
      },
      documentVersion: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "ver-1",
          status: "ready",
          parseRevision: 2,
          parseConfidence: "0.900",
          sourceLabel: "Uploaded PRD",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          processedAt: new Date("2026-01-02T00:00:00.000Z")
        })
      },
      documentSection: {
        findFirstOrThrow: vi
          .fn()
          .mockResolvedValueOnce({
            id: "sec-1",
            anchorId: "reporting",
            pageNumber: 6,
            headingPath: ["Features", "Reporting"],
            normalizedText: "The product should support weekly reporting.",
            orderIndex: 12
          }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "sec-2",
            anchorId: "reporting-context",
            pageNumber: 6,
            headingPath: ["Features", "Reporting"],
            normalizedText: "Reporting context section",
            orderIndex: 13
          }
        ])
      },
      documentChunk: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "chunk-1",
            chunkIndex: 0,
            pageNumber: 6,
            tokenCount: 42,
            content: "weekly reporting"
          }
        ])
      },
      artifactVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: "graph-1"
        })
      },
      brainSectionLink: {
        findMany: vi.fn().mockResolvedValue([
          {
            brainNodeId: "node-1",
            relationship: "supports",
            brainNode: {
              id: "node-1",
              title: "Reporting module",
              nodeType: "module",
              status: "active"
            }
          }
        ])
      },
      brainEdge: {
        findMany: vi.fn().mockResolvedValue([
          {
            edgeType: "depends_on",
            fromNodeId: "node-1",
            toNodeId: "node-2"
          }
        ])
      },
      specChangeLink: {
        findMany: specChangeLinkFindMany
      },
      communicationMessage: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "msg-1",
            senderLabel: "Client",
            sentAt: new Date("2026-01-02T00:00:00.000Z"),
            threadId: "thread-1"
          }
        ])
      },
      communicationThread: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "thread-1",
            subject: "Reporting feedback",
            lastMessageAt: new Date("2026-01-02T00:00:00.000Z")
          }
        ])
      }
    } as any;

    const service = new DocumentService(
      prisma,
      {} as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectManager: vi.fn(), ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const result = await service.getAnchorProvenance("project-1", "doc-1", "reporting", "user-1");

    expect(result.currentTruth).toEqual({
      differsFromSource: true,
      summaries: ["Client requested weekly reporting"]
    });
    expect(result.linkedBrainNodes[0]).toMatchObject({
      nodeId: "node-1",
      relationship: "supports"
    });
    expect(result.linkedChanges[0]).toMatchObject({
      proposalId: "proposal-1",
      title: "Weekly reporting"
    });
    expect(result.linkedDecisions[0]).toMatchObject({
      id: "decision-1"
    });
    expect(result.linkedMessageRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "message", id: "msg-1" }),
        expect.objectContaining({ type: "thread", id: "thread-1" })
      ])
    );
    expect(result.openTargets.selectedSection).toMatchObject({
      targetType: "document_section",
      targetRef: expect.objectContaining({ anchorId: "reporting" })
    });
  });

  it("transcribes audio uploads before creating sections", async () => {
    const createSection = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      documentVersion: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "ver-audio",
          projectId: "project-1",
          parseRevision: 1,
          fileKey: "audio-key",
          mimeType: "audio/mpeg",
          document: {
            title: "Founder note"
          }
        }),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue(undefined)
      },
      documentChunk: {
        deleteMany: vi.fn().mockResolvedValue(undefined)
      },
      documentSection: {
        deleteMany: vi.fn().mockResolvedValue(undefined),
        create: createSection
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined)
      }
    } as any;

    const jobs = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const transcribeAudio = vi.fn().mockResolvedValue({
      text: "# Vision\nVoice-captured product idea",
      provider: "mock-transcription"
    });
    const telemetry = { increment: vi.fn(), observeDuration: vi.fn() };

    const service = new DocumentService(
      prisma,
      { getObject: vi.fn().mockResolvedValue(Buffer.from("audio-bytes")) } as any,
      jobs as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio } as any,
      { ensureProjectManager: vi.fn(), ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn() } as any,
      telemetry as any
    );

    await service.processDocumentVersion("ver-audio", 1);

    expect(transcribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "audio/mpeg"
      })
    );
    expect(createSection).toHaveBeenCalled();
    expect(telemetry.increment).toHaveBeenCalledWith("orchestra_voice_transcriptions_total", {
      provider: "mock-transcription"
    });
    expect(jobs.enqueue).toHaveBeenCalledWith(
      "chunk_document",
      { documentVersionId: "ver-audio", parseRevision: 1 },
      expect.any(String)
    );
  });

  it("rejects the current unviewable version instead of silently opening an older parsed version", async () => {
    const telemetry = { increment: vi.fn(), observeDuration: vi.fn() };
    const auditRecord = vi.fn().mockResolvedValue(undefined);
    const documentVersionFindFirstOrThrow = vi
      .fn()
      .mockResolvedValueOnce({
        id: "ver-pending",
        status: "processing",
        parseRevision: 3,
        parseConfidence: null,
        sourceLabel: "Fresh upload",
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
        processedAt: null
      })
      .mockResolvedValueOnce({
        id: "ver-ready",
        status: "ready",
        parseRevision: 2,
        parseConfidence: "0.900",
        sourceLabel: "Previous ready version",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        processedAt: new Date("2026-01-02T01:00:00.000Z")
      });

    const prisma = {
      document: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "doc-1",
          title: "Core PRD",
          kind: "prd",
          visibility: "internal",
          currentVersionId: "ver-pending",
          projectId: "project-1",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-03T00:00:00.000Z")
        })
      },
      documentVersion: {
        findFirstOrThrow: documentVersionFindFirstOrThrow,
        findFirst: vi.fn().mockResolvedValue({
          id: "ver-ready",
          status: "ready",
          parseRevision: 2,
          parseConfidence: "0.900",
          sourceLabel: "Previous ready version",
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
          processedAt: new Date("2026-01-02T01:00:00.000Z")
        })
      },
      documentSection: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "sec-1",
            anchorId: "overview-1",
            pageNumber: 1,
            headingPath: ["Overview"],
            normalizedText: "Ready section",
            orderIndex: 0
          }
        ])
      },
      specChangeLink: {
        findMany: vi.fn().mockResolvedValue([])
      },
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ orgId: "org-1" })
      },
      auditEvent: {
        create: vi.fn().mockResolvedValue(undefined)
      }
    } as any;

    const service = new DocumentService(
      prisma,
      {} as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectManager: vi.fn(), ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: auditRecord } as any,
      telemetry as any
    );

    await expect(service.getViewerPayload("project-1", "doc-1", "user-1")).rejects.toMatchObject({
      code: "document_version_not_viewable",
      statusCode: 409
    });
    expect(prisma.documentVersion.findFirst).not.toHaveBeenCalled();
    expect(telemetry.increment).not.toHaveBeenCalledWith(
      "orchestra_viewer_requests_total",
      expect.objectContaining({ action: "open_document", project_role: "manager" })
    );
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it("rejects an explicit unviewable version instead of silently falling back", async () => {
    const prisma = {
      document: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "doc-1",
          title: "Core PRD",
          kind: "prd",
          visibility: "internal",
          currentVersionId: "ver-ready",
          projectId: "project-1",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z")
        })
      },
      documentVersion: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "ver-processing",
          status: "processing",
          parseRevision: 3,
          parseConfidence: null,
          sourceLabel: "Fresh upload",
          createdAt: new Date("2026-01-03T00:00:00.000Z"),
          processedAt: null
        }),
        findFirst: vi.fn()
      }
    } as any;

    const service = new DocumentService(
      prisma,
      {} as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectManager: vi.fn(), ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await expect(
      service.getViewerPayload("project-1", "doc-1", "user-1", { versionId: "ver-processing" })
    ).rejects.toMatchObject({
      code: "document_version_not_viewable",
      statusCode: 409
    });
    expect(prisma.documentVersion.findFirst).not.toHaveBeenCalled();
  });

  it("rejects highlight citations from stale non-current document versions", async () => {
    const prisma = {
      document: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "doc-1",
          title: "Core PRD",
          kind: "prd",
          visibility: "internal",
          currentVersionId: "ver-current",
          projectId: "project-1",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-04T00:00:00.000Z")
        })
      },
      documentVersion: {
        findFirstOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          documentId: "doc-1",
          projectId: "project-1",
          status: "ready",
          parseRevision: where.id === "ver-current" ? 3 : 2,
          parseConfidence: "0.900",
          sourceLabel: where.id === "ver-current" ? "Current version" : "Old version",
          createdAt: new Date("2026-01-04T00:00:00.000Z"),
          processedAt: new Date("2026-01-04T01:00:00.000Z")
        })),
        findFirst: vi.fn()
      },
      socratesCitation: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "11111111-1111-1111-1111-111111111111",
          projectId: "project-1",
          citationType: "document_chunk",
          refId: "chunk-old"
        })
      },
      documentChunk: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "chunk-old",
          projectId: "project-1",
          documentVersionId: "ver-old",
          parseRevision: 2,
          sectionId: "sec-old",
          documentVersion: {
            id: "ver-old",
            documentId: "doc-1",
            projectId: "project-1",
            status: "ready",
            parseRevision: 2,
            document: {
              id: "doc-1",
              visibility: "internal",
              currentVersionId: "ver-current"
            }
          }
        })
      },
      documentSection: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "sec-old",
          projectId: "project-1",
          documentVersionId: "ver-old",
          parseRevision: 2,
          anchorId: "old-anchor",
          pageNumber: 1,
          headingPath: ["Old"],
          normalizedText: "Old text",
          orderIndex: 0
        }),
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "sec-old",
            projectId: "project-1",
            documentVersionId: "ver-old",
            parseRevision: 2,
            anchorId: "old-anchor",
            pageNumber: 1,
            headingPath: ["Old"],
            normalizedText: "Old text",
            orderIndex: 0
          }
        ])
      },
      specChangeLink: {
        findMany: vi.fn().mockResolvedValue([])
      },
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ orgId: "org-1" })
      }
    } as any;

    const service = new DocumentService(
      prisma,
      {} as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectManager: vi.fn(), ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }) } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await expect(
      service.getViewerPayload("project-1", "doc-1", "user-1", {
        highlightCitationId: "11111111-1111-1111-1111-111111111111"
      })
    ).rejects.toMatchObject({
      code: "stale_viewer_highlight",
      statusCode: 409
    });
  });

  it("embeds contextual chunk content while keeping raw chunk content intact", async () => {
    const embedText = vi.fn().mockResolvedValue(Array.from({ length: 1536 }, () => 0.1));
    const executeRaw = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      documentVersion: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "ver-1",
          projectId: "project-1",
          parseRevision: 2
        }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "ver-1",
            checksumSha256: "checksum-1",
            parseRevision: 2,
            processedAt: new Date("2026-01-01T00:00:00.000Z")
          }
        ]),
        updateMany: vi.fn().mockResolvedValue(undefined)
      },
      document: {
        findMany: vi.fn().mockResolvedValue([{ id: "doc-1", currentVersionId: "ver-1" }])
      },
      documentChunk: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "chunk-1",
            content: "Raw viewer-safe requirement text.",
            contextualContent: "Core PRD > Billing\nRaw viewer-safe requirement text."
          }
        ])
      },
      socratesSuggestion: {
        deleteMany: vi.fn().mockResolvedValue(undefined)
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined)
      },
      $executeRawUnsafe: executeRaw
    } as any;
    const jobs = { enqueue: vi.fn().mockResolvedValue(undefined) };

    const service = new DocumentService(
      prisma,
      {} as any,
      jobs as any,
      { embedText } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectManager: vi.fn(), ensureProjectAccess: vi.fn() } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await service.embedDocumentChunks("ver-1", 2);

    expect(embedText).toHaveBeenCalledWith("Core PRD > Billing\nRaw viewer-safe requirement text.");
    expect(executeRaw).toHaveBeenCalledWith(
      "UPDATE document_chunks SET embedding = CAST($1 AS extensions.vector) WHERE id = CAST($2 AS uuid)",
      expect.stringContaining("[0.1"),
      "chunk-1"
    );
    expect(jobs.enqueue).toHaveBeenCalledWith("generate_source_package", { projectId: "project-1" }, expect.any(String));
  });

  it("does not enqueue source-package or dashboard jobs after beta embeddings", async () => {
    const prisma = {
      documentVersion: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "ver-1",
          projectId: "project-1",
          parseRevision: 2
        }),
        updateMany: vi.fn().mockResolvedValue(undefined)
      },
      documentChunk: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "chunk-1",
            content: "Raw beta memory text.",
            contextualContent: "Helios Beta\nRaw beta memory text."
          }
        ])
      },
      socratesSuggestion: {
        deleteMany: vi.fn().mockResolvedValue(undefined)
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined)
      },
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined)
    } as any;
    const jobs = { enqueue: vi.fn().mockResolvedValue(undefined) };

    const service = new DocumentService(
      prisma,
      {} as any,
      jobs as any,
      { embedText: vi.fn().mockResolvedValue(Array.from({ length: 1536 }, () => 0.1)) } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectManager: vi.fn(), ensureProjectAccess: vi.fn() } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any,
      {
        ORCHESTRA_PROFILE: "mvp_beta",
        MVP_BETA_MODE: true
      } as any
    );

    await service.embedDocumentChunks("ver-1", 2);

    expect(jobs.enqueue).not.toHaveBeenCalledWith("generate_source_package", expect.anything(), expect.anything());
    expect(jobs.enqueue).not.toHaveBeenCalledWith("refresh_dashboard_snapshot", expect.anything(), expect.anything());
  });

  it("queues source package generation using only current parsed document versions", async () => {
    const processedAt = new Date("2026-01-04T00:00:00.000Z");
    const embedText = vi.fn().mockResolvedValue(Array.from({ length: 1536 }, () => 0.2));
    const prisma = {
      document: {
        findMany: vi.fn().mockResolvedValue([
          { id: "doc-1", title: "Core PRD", kind: "prd", currentVersionId: "ver-current" },
          { id: "doc-2", title: "Support SRS", kind: "srs", currentVersionId: "ver-partial" }
        ])
      },
      documentVersion: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "ver-current",
          projectId: "project-1",
          parseRevision: 2
        }),
        findMany: vi.fn(async (args?: any) => {
          if (args?.where?.id?.in) {
            return [
              {
                id: "ver-current",
                checksumSha256: "current-checksum",
                parseRevision: 2,
                processedAt,
                status: "ready",
                createdAt: processedAt
              },
              {
                id: "ver-partial",
                checksumSha256: "partial-checksum",
                parseRevision: 1,
                processedAt,
                status: "partial",
                createdAt: processedAt
              }
            ];
          }
          return [
            {
              id: "ver-old",
              checksumSha256: "old-checksum",
              parseRevision: 1,
              processedAt: new Date("2026-01-01T00:00:00.000Z")
            },
            {
              id: "ver-current",
              checksumSha256: "current-checksum",
              parseRevision: 2,
              processedAt
            }
          ];
        }),
        updateMany: vi.fn().mockResolvedValue(undefined)
      },
      documentChunk: {
        findMany: vi.fn().mockResolvedValue([{ id: "chunk-1", content: "Raw text", contextualContent: "Context\nRaw text" }])
      },
      socratesSuggestion: {
        deleteMany: vi.fn().mockResolvedValue(undefined)
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined)
      },
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined)
    } as any;
    const jobs = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const expectedHash = createHash("sha256")
      .update(
        JSON.stringify([
          {
            id: "ver-current",
            checksumSha256: "current-checksum",
            parseRevision: 2,
            processedAt: processedAt.toISOString()
          },
          {
            id: "ver-partial",
            checksumSha256: "partial-checksum",
            parseRevision: 1,
            processedAt: processedAt.toISOString()
          }
        ])
      )
      .digest("hex")
      .slice(0, 16);

    const service = new DocumentService(
      prisma,
      {} as any,
      jobs as any,
      { embedText } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectManager: vi.fn(), ensureProjectAccess: vi.fn() } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await service.embedDocumentChunks("ver-current", 2);

    expect(jobs.enqueue).toHaveBeenCalledWith(
      "generate_source_package",
      { projectId: "project-1" },
      `source-package:project-1:${expectedHash}`
    );
  });

  it("moves document status from processing during parse to ready after embeddings", async () => {
    const parsePrisma = {
      project: { findUnique: vi.fn().mockResolvedValue(null) },
      documentVersion: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "ver-status",
          projectId: "project-1",
          parseRevision: 1,
          fileKey: "storage-key",
          mimeType: "text/plain",
          document: { title: "Status PRD", kind: "prd" }
        }),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue(undefined)
      },
      documentChunk: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      documentSection: {
        deleteMany: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue(undefined)
      },
      jobRun: { upsert: vi.fn().mockResolvedValue(undefined) }
    } as any;
    const jobs = { enqueue: vi.fn().mockResolvedValue(undefined) };
    const service = new DocumentService(
      parsePrisma,
      { getObject: vi.fn().mockResolvedValue(Buffer.from("The beta document moves through parse status.")) } as any,
      jobs as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectManager: vi.fn(), ensureProjectAccess: vi.fn() } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await service.processDocumentVersion("ver-status", 1);

    expect(parsePrisma.documentVersion.update).toHaveBeenCalledWith({
      where: { id: "ver-status" },
      data: { status: "processing" }
    });
    expect(parsePrisma.documentVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ver-status", parseRevision: 1 },
        data: expect.objectContaining({ status: "processing" })
      })
    );

    const embedPrisma = {
      project: { findUnique: vi.fn().mockResolvedValue(null) },
      document: {
        findMany: vi.fn().mockResolvedValue([{ id: "doc-status", currentVersionId: "ver-status" }])
      },
      documentVersion: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "ver-status", projectId: "project-1", parseRevision: 1 }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: "ver-status",
            checksumSha256: "checksum",
            parseRevision: 1,
            processedAt: new Date("2026-05-01T00:00:00.000Z"),
            status: "processing",
            createdAt: new Date("2026-05-01T00:00:00.000Z")
          }
        ]),
        updateMany: vi.fn().mockResolvedValue(undefined)
      },
      documentChunk: {
        findMany: vi.fn().mockResolvedValue([{ id: "chunk-status", content: "Ready text", contextualContent: "Status PRD\nReady text" }])
      },
      socratesSuggestion: { deleteMany: vi.fn().mockResolvedValue(undefined) },
      jobRun: { upsert: vi.fn().mockResolvedValue(undefined) },
      $executeRawUnsafe: vi.fn().mockResolvedValue(undefined)
    } as any;
    const embedService = new DocumentService(
      embedPrisma,
      {} as any,
      jobs as any,
      { embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) } as any,
      { transcribeAudio: vi.fn() } as any,
      { ensureProjectManager: vi.fn(), ensureProjectAccess: vi.fn() } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await embedService.embedDocumentChunks("ver-status", 1);

    expect(embedPrisma.documentVersion.updateMany).toHaveBeenCalledWith({
      where: { id: "ver-status", parseRevision: 1 },
      data: { status: "ready" }
    });
  });

  it("returns message evidence with linked documents, changes, and decisions", async () => {
    const prisma = {
      communicationMessage: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "msg-1",
          threadId: "thread-1",
          senderLabel: "Client stakeholder",
          sentAt: new Date("2026-02-01T10:00:00.000Z"),
          bodyText: "We need the reporting feature to show weekly summaries.",
          messageType: "email",
          replyToMessageId: null,
          thread: {
            id: "thread-1",
            subject: "Reporting feature request",
            participantsJson: ["client@acme.com"],
            startedAt: new Date("2026-02-01T09:00:00.000Z"),
            lastMessageAt: new Date("2026-02-01T10:00:00.000Z")
          }
        })
      },
      specChangeLink: {
        findMany: vi.fn((args?: any) => {
          // First call: links from message / thread to proposals
          if (args?.where?.OR) {
            return Promise.resolve([
              {
                specChangeProposalId: "proposal-1",
                linkType: "message",
                linkRefId: "msg-1",
                proposal: {
                  id: "proposal-1",
                  title: "Add weekly reporting",
                  summary: "Client requested weekly reporting summaries",
                  proposalType: "requirement_update",
                  status: "accepted",
                  decisionRecordId: "decision-1",
                  decisionRecord: {
                    id: "decision-1",
                    title: "Weekly reporting accepted",
                    statement: "Implement weekly digest endpoint",
                    status: "accepted"
                  }
                }
              }
            ]);
          }
          // Second call: section links for the proposal
          if (args?.where?.specChangeProposalId?.in) {
            return Promise.resolve([
              { specChangeProposalId: "proposal-1", linkType: "document_section", linkRefId: "sec-1" }
            ]);
          }
          return Promise.resolve([]);
        })
      },
      documentSection: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "sec-1",
            anchorId: "reporting",
            pageNumber: 5,
            headingPath: ["Features", "Reporting"],
            normalizedText: "The system shall support weekly reporting.",
            orderIndex: 10,
            documentVersionId: "ver-1",
            documentVersion: {
              documentId: "doc-1",
              document: { title: "Core PRD" }
            }
          }
        ])
      },
      auditEvent: {
        create: vi.fn().mockResolvedValue(undefined)
      }
    } as any;

    const telemetry = { increment: vi.fn(), observeDuration: vi.fn() };

    const service = new DocumentService(
      prisma,
      {} as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      {
        ensureProjectManager: vi.fn(),
        ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" })
      } as any,
      { record: vi.fn() } as any,
      telemetry as any
    );

    const result = await service.getMessageEvidence("project-1", "msg-1", "user-1");

    expect(result.message.id).toBe("msg-1");
    expect(result.message.senderLabel).toBe("Client stakeholder");
    expect(result.thread.id).toBe("thread-1");
    expect(result.thread.subject).toBe("Reporting feature request");

    expect(result.linkedDocuments).toHaveLength(1);
    expect(result.linkedDocuments[0]).toMatchObject({
      sectionId: "sec-1",
      anchorId: "reporting",
      pageNumber: 5,
      documentId: "doc-1",
      documentTitle: "Core PRD",
      openTarget: expect.objectContaining({ targetType: "document_section" })
    });

    expect(result.linkedChanges).toHaveLength(1);
    expect(result.linkedChanges[0]).toMatchObject({
      proposalId: "proposal-1",
      title: "Add weekly reporting",
      status: "accepted"
    });

    expect(result.linkedDecisions).toHaveLength(1);
    expect(result.linkedDecisions[0]).toMatchObject({
      id: "decision-1",
      title: "Weekly reporting accepted"
    });

    expect(result.openTargets.thread).toMatchObject({ targetType: "thread" });
    expect(result.openTargets.documents).toHaveLength(1);
  });

  it("returns empty linked arrays when message has no proposal associations", async () => {
    const prisma = {
      communicationMessage: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "msg-orphan",
          threadId: "thread-orphan",
          senderLabel: "Client",
          sentAt: new Date("2026-03-01T08:00:00.000Z"),
          bodyText: "Just a general question.",
          messageType: "slack",
          replyToMessageId: null,
          thread: {
            id: "thread-orphan",
            subject: "General question",
            participantsJson: [],
            startedAt: new Date("2026-03-01T08:00:00.000Z"),
            lastMessageAt: new Date("2026-03-01T08:00:00.000Z")
          }
        })
      },
      specChangeLink: {
        findMany: vi.fn().mockResolvedValue([])
      },
      auditEvent: {
        create: vi.fn().mockResolvedValue(undefined)
      }
    } as any;

    const service = new DocumentService(
      prisma,
      {} as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      {
        ensureProjectManager: vi.fn(),
        ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "dev" })
      } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    const result = await service.getMessageEvidence("project-1", "msg-orphan", "dev-1");

    expect(result.linkedDocuments).toEqual([]);
    expect(result.linkedChanges).toEqual([]);
    expect(result.linkedDecisions).toEqual([]);
    expect(result.openTargets.documents).toEqual([]);
  });

  it("rejects client role access to message evidence", async () => {
    const prisma = {} as any;

    const service = new DocumentService(
      prisma,
      {} as any,
      { enqueue: vi.fn() } as any,
      { embedText: vi.fn() } as any,
      { transcribeAudio: vi.fn() } as any,
      {
        ensureProjectManager: vi.fn(),
        ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "client" })
      } as any,
      { record: vi.fn() } as any,
      { increment: vi.fn(), observeDuration: vi.fn() } as any
    );

    await expect(service.getMessageEvidence("project-1", "msg-1", "client-1")).rejects.toMatchObject({
      statusCode: 403,
      code: "client_message_access_forbidden"
    });
  });
});
