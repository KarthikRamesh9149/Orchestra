import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { AppError } from "../src/app/errors.js";
import { ProjectContextService, buildManualContextSummary } from "../src/modules/projects/context.service.js";
import { createProjectContextEntrySchema } from "../src/modules/projects/context.schemas.js";

const createdAt = new Date("2026-05-01T10:00:00.000Z");
const updatedAt = new Date("2026-05-02T10:00:00.000Z");
const contextId = "11111111-1111-4111-8111-111111111111";
const chunkId = "22222222-2222-4222-8222-222222222222";
const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeContextRow(overrides: Record<string, unknown> = {}) {
  return {
    id: contextId,
    orgId: "org-1",
    projectId: "project-1",
    type: "decision_note",
    title: "KYC onboarding decision",
    body: "Client PM said onboarding must support KYC before payment setup.",
    sourceDate: new Date("2026-05-01T00:00:00.000Z"),
    participantsJson: ["Client PM", "Internal PM"],
    tagsJson: ["onboarding", "kyc"],
    linkedMemberId: "member-1",
    importance: "high",
    source: "manual",
    status: "active",
    bodyHash: "hash-old",
    createdByUserId: "manager-1",
    updatedByUserId: "manager-1",
    deletedAt: null,
    deletedByUserId: null,
    createdAt,
    updatedAt,
    linkedMember: {
      id: "member-1",
      userId: "user-2",
      roleInProject: "Product",
      user: {
        id: "user-2",
        email: "sara@example.com",
        displayName: "Sara",
        passwordHash: "must-not-leak"
      }
    },
    chunks: [{ id: chunkId, createdAt: updatedAt }],
    attachments: [],
    ...overrides
  };
}

function createDeps() {
  const prisma = {
    project: {
      findUnique: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" })
    },
    projectMember: {
      findFirst: vi.fn().mockResolvedValue({
        id: "member-1",
        projectId: "project-1",
        isActive: true,
        userId: "user-2",
        roleInProject: "Product",
        user: { id: "user-2", email: "sara@example.com", displayName: "Sara" }
      })
    },
    projectContextEntry: {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([makeContextRow()]),
      findFirst: vi.fn().mockResolvedValue(makeContextRow()),
      findUnique: vi.fn().mockResolvedValue(makeContextRow()),
      create: vi.fn().mockImplementation(async ({ data }: any) =>
        makeContextRow({
          ...data,
          attachments: data.attachments?.create
            ? [
                {
                  ...data.attachments.create,
                  createdAt,
                  storageStatus: data.attachments.create.storageStatus ?? "metadata_only"
                }
              ]
            : []
        })
      ),
      update: vi.fn().mockImplementation(async ({ data }: any) =>
        makeContextRow({
          title: data.title ?? "KYC onboarding decision",
          body: data.body ?? "Client PM said onboarding must support KYC before payment setup.",
          bodyHash: data.bodyHash ?? "hash-new",
          status: data.status ?? "active",
          deletedAt: data.deletedAt ?? null,
          deletedByUserId: data.deletedByUserId ?? null,
          updatedByUserId: data.updatedBy?.connect?.id ?? "manager-1",
          updatedAt: new Date("2026-05-03T10:00:00.000Z")
        })
      )
    },
    projectContextAttachment: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue({
        id: "attachment-1",
        contextEntryId: contextId,
        storageKey: "projects/project-1/context/ctx/attachment/hash.png",
        storageStatus: "stored",
        mimeType: "image/png",
        originalFilename: "chart.png",
        filename: "chart.png"
      })
    },
    projectContextChunk: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        id: chunkId,
        ...data,
        createdAt,
        updatedAt
      })),
      findMany: vi.fn().mockResolvedValue([
        {
          id: chunkId,
          contextEntryId: contextId,
          projectId: "project-1",
          chunkIndex: 0,
          rawText: "Client PM said onboarding must support KYC before payment setup.",
          contextualText: "Manual context: decision_note / KYC onboarding decision",
          lexicalText: "kyc onboarding decision",
          tokenEstimate: 24,
          metadataJson: {},
          contextEntry: makeContextRow({ chunks: [] })
        }
      ])
    },
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    jobRun: {
      upsert: vi.fn().mockResolvedValue({})
    }
  } as any;
  const projectService = {
    ensureProjectMemberCanUseSocrates: vi.fn().mockResolvedValue({ id: "member-1", projectRole: "dev", isActive: true }),
    ensureProjectMemberCanManageTeamContext: vi.fn().mockResolvedValue({ id: "member-1", projectRole: "manager", isActive: true })
  } as any;
  const auditService = {
    record: vi.fn().mockResolvedValue(undefined),
    recordWithClient: vi.fn().mockResolvedValue(undefined)
  } as any;
  const jobs = { enqueue: vi.fn().mockResolvedValue(undefined) } as any;
  const embeddings = { embedText: vi.fn().mockResolvedValue(Array.from({ length: 1536 }, () => 0.1)) } as any;
  const telemetry = { increment: vi.fn() } as any;
  const storage = {
    putObject: vi.fn().mockImplementation(async ({ key, body }: any) => ({ key, size: body.length })),
    getObject: vi.fn().mockResolvedValue(Buffer.from("stored-image")),
    getObjectStream: vi.fn().mockResolvedValue({
      stream: Readable.from(Buffer.from("stored-image")),
      size: 12
    }),
    deleteObject: vi.fn().mockResolvedValue(undefined),
    getSignedUrl: vi.fn().mockResolvedValue("signed://context-attachment")
  } as any;
  const env = {
    MVP_MODE: true,
    MVP_ENABLE_IMAGE_CONTEXT: true,
    MVP_ENABLE_IMAGE_VISION_SUMMARY: false,
    MVP_IMAGE_CONTEXT_MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
    MVP_CONTEXT_ATTACHMENT_MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,
    MVP_IMAGE_CONTEXT_ALLOWED_MIME_TYPES: ["image/png", "image/jpeg", "image/webp"],
    MVP_CONTEXT_ALLOWED_FILE_MIME_TYPES: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "text/markdown"],
    STORAGE_DRIVER: "s3",
    SIGNED_URL_TTL_SECONDS: 3600
  } as any;
  return { prisma, projectService, auditService, jobs, embeddings, telemetry, storage, env };
}

describe("ProjectContextService", () => {
  it("rejects unsafe markup and reserved generated types at schema boundary", () => {
    expect(() =>
      createProjectContextEntrySchema.parse({
        type: "manual_note",
        title: "<script>alert(1)</script>",
        body: "safe body"
      })
    ).toThrow();
    expect(() =>
      createProjectContextEntrySchema.parse({
        type: "generated_prd",
        title: "Generated PRD",
        body: "Generated documents stay in DocumentVersion"
      })
    ).toThrow();
  });

  it("creates active manual context with safe DTO, audit, index job, and dashboard refresh", async () => {
    const { prisma, projectService, auditService, jobs, embeddings, telemetry, storage, env } = createDeps();
    const service = new ProjectContextService(prisma, env, storage, projectService, auditService, jobs, embeddings, telemetry);

    const created = await service.createContext("project-1", "manager-1", {
      type: "decision_note",
      title: "KYC onboarding decision",
      body: "Client PM said onboarding must support KYC before payment setup.",
      sourceDate: "2026-05-01T00:00:00.000Z",
      participants: ["Client PM", "Internal PM"],
      tags: ["Onboarding", " KYC "],
      linkedMemberId: "member-1",
      importance: "high",
      attachments: []
    });

    expect(projectService.ensureProjectMemberCanManageTeamContext).toHaveBeenCalledWith("project-1", "manager-1");
    expect(prisma.projectMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "member-1", projectId: "project-1", isActive: true } })
    );
    expect(created).toMatchObject({
      id: contextId,
      projectId: "project-1",
      type: "decision_note",
      participants: ["Client PM", "Internal PM"],
      tags: ["onboarding", "kyc"],
      status: "active",
      linkedMember: {
        memberId: "member-1",
        displayName: "Sara"
      }
    });
    expect(JSON.stringify(created)).not.toContain("must-not-leak");
    expect(auditService.recordWithClient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "project_context_created",
        actorUserId: "manager-1",
        payload: expect.objectContaining({
          contextId,
          title: "KYC onboarding decision",
          bodyLength: 64,
          bodyHash: expect.any(String)
        })
      })
    );
    expect(JSON.stringify(auditService.recordWithClient.mock.calls)).not.toContain("Client PM said onboarding");
    expect(jobs.enqueue).toHaveBeenCalledWith(
      "index_project_context_entry",
      { contextId },
      expect.stringContaining(`context-entry:${contextId}:`)
    );
    expect(jobs.enqueue).toHaveBeenCalledWith(
      "refresh_dashboard_snapshot",
      expect.objectContaining({ projectId: "project-1", reason: "project_context_created" }),
      expect.stringContaining("dashboard:project:project-1:")
    );
  });

  it("preserves normal-mode manager-only mutation by delegating to project policy", async () => {
    const { prisma, projectService, auditService, jobs, embeddings, telemetry, storage, env } = createDeps();
    projectService.ensureProjectMemberCanManageTeamContext.mockRejectedValue(
      new AppError(403, "Manager access required", "manager_access_required")
    );
    const service = new ProjectContextService(prisma, env, storage, projectService, auditService, jobs, embeddings, telemetry);

    await expect(
      service.createContext("project-1", "dev-1", {
        type: "manual_note",
        title: "API note",
        body: "Use REST for v1.",
        participants: [],
        tags: [],
        importance: "normal",
        attachments: []
      })
    ).rejects.toMatchObject({ code: "manager_access_required" });
    expect(prisma.projectContextEntry.create).not.toHaveBeenCalled();
  });

  it("lists context through read policy and hides deleted rows by default", async () => {
    const { prisma, projectService, auditService, jobs, embeddings, telemetry, storage, env } = createDeps();
    const service = new ProjectContextService(prisma, env, storage, projectService, auditService, jobs, embeddings, telemetry);

    const result = await service.listContext("project-1", "dev-1", {
      q: "kyc",
      tag: "Onboarding",
      page: 1,
      pageSize: 10,
      includeDeleted: false
    });

    expect(projectService.ensureProjectMemberCanUseSocrates).toHaveBeenCalledWith("project-1", "dev-1");
    expect(prisma.projectContextEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: "project-1",
          status: "active",
          tagsJson: { array_contains: ["onboarding"] }
        }),
        take: 10
      })
    );
    expect(result.items[0]).toMatchObject({ id: contextId, title: "KYC onboarding decision" });
    expect(result.meta).toMatchObject({ page: 1, pageSize: 10, totalCount: 1 });
  });

  it("requires manage permission to include deleted context", async () => {
    const { prisma, projectService, auditService, jobs, embeddings, telemetry, storage, env } = createDeps();
    const service = new ProjectContextService(prisma, env, storage, projectService, auditService, jobs, embeddings, telemetry);

    await service.listContext("project-1", "manager-1", {
      page: 1,
      pageSize: 10,
      includeDeleted: true
    });

    expect(projectService.ensureProjectMemberCanManageTeamContext).toHaveBeenCalledWith("project-1", "manager-1");
    expect(prisma.projectContextEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ status: "active" })
      })
    );
  });

  it("updates and soft-deletes context with safe audit snapshots", async () => {
    const { prisma, projectService, auditService, jobs, embeddings, telemetry, storage, env } = createDeps();
    const service = new ProjectContextService(prisma, env, storage, projectService, auditService, jobs, embeddings, telemetry);

    await service.updateContext("project-1", contextId, "manager-1", {
      title: "Updated KYC decision",
      body: "Updated manual context body.",
      participants: ["Client PM"],
      tags: ["kyc"],
      importance: "high"
    });
    await service.deleteContext("project-1", contextId, "manager-1");

    expect(auditService.recordWithClient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "project_context_updated",
        payload: expect.objectContaining({
          before: expect.objectContaining({ title: "KYC onboarding decision", bodyHash: "hash-old" }),
          after: expect.objectContaining({ title: "Updated KYC decision", bodyLength: 28 })
        })
      })
    );
    expect(auditService.recordWithClient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "project_context_deleted",
        payload: expect.objectContaining({
          deleted: expect.objectContaining({ contextId, title: "KYC onboarding decision", bodyHash: "hash-old" })
        })
      })
    );
    expect(JSON.stringify(auditService.recordWithClient.mock.calls)).not.toContain("Updated manual context body");
    expect(prisma.projectContextChunk.deleteMany).toHaveBeenCalledWith({ where: { contextEntryId: contextId } });
  });

  it("creates image context uploads with stored attachment metadata, caption body, audit, and indexing", async () => {
    const { prisma, projectService, auditService, jobs, embeddings, telemetry, storage, env } = createDeps();
    const service = new ProjectContextService(prisma, env, storage, projectService, auditService, jobs, embeddings, telemetry);

    const created = await service.createContextFromUpload("project-1", "manager-1", {
      type: "chart_image",
      title: "Onboarding KYC chart",
      caption: "Chart shows onboarding drop-off at the KYC step.",
      description: "User-provided product analytics screenshot.",
      sourceDate: "2026-05-01T00:00:00.000Z",
      participants: ["Client PM"],
      tags: ["Onboarding", "Chart"],
      importance: "high",
      file: {
        filename: "../KYC Funnel Chart.PNG",
        mimeType: "image/png",
        size: pngHeader.length,
        buffer: pngHeader
      }
    });

    expect(projectService.ensureProjectMemberCanManageTeamContext).toHaveBeenCalledWith("project-1", "manager-1");
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringMatching(/^projects\/project-1\/context\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f]{64}\.png$/),
        contentType: "image/png"
      })
    );
    expect(created).toMatchObject({
      type: "chart_caption",
      title: "Onboarding KYC chart",
      attachments: [
        expect.objectContaining({
          attachmentKind: "image",
          originalFilename: "../KYC Funnel Chart.PNG",
          safeFilename: "kyc-funnel-chart.png",
          mimeType: "image/png",
          checksumSha256: expect.any(String),
          caption: "Chart shows onboarding drop-off at the KYC step.",
          description: "User-provided product analytics screenshot.",
          storageStatus: "stored"
        })
      ]
    });
    expect(created.body).toContain("Socrates only has the user-provided caption/description");
    expect(JSON.stringify(created)).not.toContain("storageKey");
    expect(auditService.recordWithClient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "project_context_attachment_uploaded",
        payload: expect.objectContaining({
          attachmentKind: "image",
          mimeType: "image/png",
          fileSize: pngHeader.length,
          captionLength: 48,
          descriptionLength: 43,
          checksumSha256: expect.any(String)
        })
      })
    );
    expect(JSON.stringify(auditService.recordWithClient.mock.calls)).not.toContain(pngHeader.toString("hex"));
    expect(jobs.enqueue).toHaveBeenCalledWith(
      "index_project_context_entry",
      { contextId: created.id },
      expect.stringContaining(`context-entry:${created.id}:`)
    );
  });

  it("rejects image uploads without captions and rejects audio in MVP mode", async () => {
    const { prisma, projectService, auditService, jobs, embeddings, telemetry, storage, env } = createDeps();
    const service = new ProjectContextService(prisma, env, storage, projectService, auditService, jobs, embeddings, telemetry);

    await expect(
      service.createContextFromUpload("project-1", "manager-1", {
        type: "screenshot",
        title: "Empty screenshot",
        file: { filename: "screen.png", mimeType: "image/png", size: pngHeader.length, buffer: pngHeader }
      })
    ).rejects.toMatchObject({ code: "image_context_caption_required" });

    await expect(
      service.createContextFromUpload("project-1", "manager-1", {
        type: "manual_transcript",
        title: "Audio transcript",
        caption: "Audio should not be transcribed in MVP.",
        file: { filename: "call.mp3", mimeType: "audio/mpeg", size: 3, buffer: Buffer.from("mp3") }
      })
    ).rejects.toMatchObject({ code: "audio_file_context_not_supported_in_mvp" });

    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("rejects MIME and extension spoofing, unsupported files, binary octet streams, and oversized uploads", async () => {
    const { prisma, projectService, auditService, jobs, embeddings, telemetry, storage, env } = createDeps();
    const service = new ProjectContextService(prisma, env, storage, projectService, auditService, jobs, embeddings, telemetry);

    const base = {
      type: "screenshot" as const,
      title: "Spoofed upload",
      caption: "Caption for validation."
    };

    await expect(
      service.createContextFromUpload("project-1", "manager-1", {
        ...base,
        file: { filename: "screen.png", mimeType: "text/plain", size: 4, buffer: Buffer.from("text") }
      })
    ).rejects.toMatchObject({ code: "unsupported_context_file_type" });
    await expect(
      service.createContextFromUpload("project-1", "manager-1", {
        ...base,
        file: { filename: "vector.svg", mimeType: "image/svg+xml", size: 4, buffer: Buffer.from("<svg") }
      })
    ).rejects.toMatchObject({ code: "unsupported_context_file_type" });
    await expect(
      service.createContextFromUpload("project-1", "manager-1", {
        ...base,
        file: { filename: "tool.exe", mimeType: "application/octet-stream", size: 4, buffer: Buffer.from("MZ..") }
      })
    ).rejects.toMatchObject({ code: "unsupported_context_file_type" });
    await expect(
      service.createContextFromUpload("project-1", "manager-1", {
        ...base,
        type: "chat_export",
        file: { filename: "chat.txt", mimeType: "application/octet-stream", size: 4, buffer: Buffer.from([0, 1, 2, 3]) }
      })
    ).rejects.toMatchObject({ code: "unsupported_context_file_type" });
    await expect(
      service.createContextFromUpload("project-1", "manager-1", {
        ...base,
        file: {
          filename: "large.png",
          mimeType: "image/png",
          size: env.MVP_IMAGE_CONTEXT_MAX_FILE_SIZE_BYTES + 1,
          buffer: pngHeader
        }
      })
    ).rejects.toMatchObject({ code: "context_file_too_large" });

    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("accepts bounded text octet-stream context only for text-like extensions", async () => {
    const { prisma, projectService, auditService, jobs, embeddings, telemetry, storage, env } = createDeps();
    const service = new ProjectContextService(prisma, env, storage, projectService, auditService, jobs, embeddings, telemetry);

    const created = await service.createContextFromUpload("project-1", "manager-1", {
      type: "chat_export",
      title: "WhatsApp text export",
      caption: "Manually exported WhatsApp text.",
      file: {
        filename: "whatsapp-export.txt",
        mimeType: "application/octet-stream",
        size: 28,
        buffer: Buffer.from("Sara: KYC is the first step")
      }
    });

    expect(created.type).toBe("chat_export");
    expect(created.body).toContain("Sara: KYC is the first step");
    expect(storage.putObject).toHaveBeenCalledWith(expect.objectContaining({ contentType: "application/octet-stream" }));
  });

  it("returns signed URLs only after scoped attachment validation", async () => {
    const { prisma, projectService, auditService, jobs, embeddings, telemetry, storage, env } = createDeps();
    const service = new ProjectContextService(prisma, env, storage, projectService, auditService, jobs, embeddings, telemetry);

    const result = await service.getContextAttachmentSignedUrl("project-1", contextId, "attachment-1", "manager-1");

    expect(projectService.ensureProjectMemberCanUseSocrates).toHaveBeenCalledWith("project-1", "manager-1");
    expect(prisma.projectContextAttachment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "attachment-1",
          projectId: "project-1",
          contextEntryId: contextId,
          contextEntry: { status: "active" }
        })
      })
    );
    expect(storage.getSignedUrl).toHaveBeenCalledWith("projects/project-1/context/ctx/attachment/hash.png");
    expect(result).toMatchObject({
      attachmentId: "attachment-1",
      contextId,
      url: "signed://context-attachment",
      expiresInSeconds: 3600
    });
  });

  it("returns authenticated local content URLs instead of raw filesystem paths", async () => {
    const { prisma, projectService, auditService, jobs, embeddings, telemetry, storage, env } = createDeps();
    const service = new ProjectContextService(
      prisma,
      { ...env, STORAGE_DRIVER: "local" },
      storage,
      projectService,
      auditService,
      jobs,
      embeddings,
      telemetry
    );

    const result = await service.getContextAttachmentSignedUrl("project-1", contextId, "attachment-1", "manager-1");

    expect(storage.getSignedUrl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      url: `/v1/projects/project-1/context/${contextId}/attachments/attachment-1/content`,
      expiresInSeconds: 0
    });
  });

  it("loads attachment content only after scoped attachment validation", async () => {
    const { prisma, projectService, auditService, jobs, embeddings, telemetry, storage, env } = createDeps();
    const service = new ProjectContextService(prisma, env, storage, projectService, auditService, jobs, embeddings, telemetry);

    const result = await service.getContextAttachmentFile("project-1", contextId, "attachment-1", "manager-1");

    expect(projectService.ensureProjectMemberCanUseSocrates).toHaveBeenCalledWith("project-1", "manager-1");
    expect(storage.getObjectStream).toHaveBeenCalledWith("projects/project-1/context/ctx/attachment/hash.png");
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toBe("stored-image");
    expect(JSON.stringify(result)).not.toContain("storageKey");
  });

  it("indexes active context entries into embedded chunks", async () => {
    const { prisma, projectService, auditService, jobs, embeddings, telemetry, storage, env } = createDeps();
    const service = new ProjectContextService(prisma, env, storage, projectService, auditService, jobs, embeddings, telemetry);

    const result = await service.indexContextEntry(contextId);

    expect(result).toMatchObject({ ok: true, contextId, chunkCount: 1 });
    expect(prisma.projectContextChunk.deleteMany).toHaveBeenCalledWith({ where: { contextEntryId: contextId } });
    expect(prisma.projectContextChunk.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contextEntryId: contextId,
          contextualText: expect.stringContaining("Manual context: decision_note / KYC onboarding decision"),
          lexicalText: expect.stringContaining("Client PM said onboarding")
        })
      })
    );
    expect(embeddings.embedText).toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      "UPDATE project_context_chunks SET embedding = CAST($1 AS extensions.vector) WHERE id = CAST($2 AS uuid)",
      expect.stringContaining("["),
      chunkId
    );
  });

  it("does not replace existing chunks if embedding preparation fails", async () => {
    const { prisma, projectService, auditService, jobs, embeddings, telemetry, storage, env } = createDeps();
    embeddings.embedText.mockRejectedValueOnce(new Error("embedding unavailable"));
    const service = new ProjectContextService(prisma, env, storage, projectService, auditService, jobs, embeddings, telemetry);

    await expect(service.indexContextEntry(contextId)).rejects.toThrow("embedding unavailable");

    expect(prisma.projectContextChunk.deleteMany).not.toHaveBeenCalled();
    expect(prisma.projectContextChunk.create).not.toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("does not index deleted context entries", async () => {
    const { prisma, projectService, auditService, jobs, embeddings, telemetry, storage, env } = createDeps();
    prisma.projectContextEntry.findUnique.mockResolvedValueOnce(makeContextRow({ status: "deleted" }));
    const service = new ProjectContextService(prisma, env, storage, projectService, auditService, jobs, embeddings, telemetry);

    const result = await service.indexContextEntry(contextId);

    expect(result).toMatchObject({ ok: true, contextId, chunkCount: 0, skipped: "deleted" });
    expect(prisma.projectContextChunk.deleteMany).toHaveBeenCalledWith({ where: { contextEntryId: contextId } });
    expect(prisma.projectContextChunk.create).not.toHaveBeenCalled();
  });

  it("builds bounded manual context dashboard summary without bodies", async () => {
    const summary = buildManualContextSummary("project-1", [
      makeContextRow(),
      makeContextRow({ id: "ctx-2", type: "manual_transcript", importance: "normal", updatedAt: new Date("2026-05-04T00:00:00.000Z") }),
      makeContextRow({ id: "ctx-3", type: "task_note", importance: "normal", status: "deleted" })
    ] as any);

    expect(summary).toEqual({
      totalCount: 2,
      highImportanceCount: 1,
      decisionNoteCount: 1,
      manualTranscriptCount: 1,
      imageContextCount: 0,
      chartContextCount: 0,
      screenshotContextCount: 0,
      latestContextAt: "2026-05-04T00:00:00.000Z",
      teamNoteCount: 0,
      taskNoteCount: 0,
      quickLinks: { contextPath: "/projects/project-1/context" }
    });
    expect(JSON.stringify(summary)).not.toContain("Client PM said");
  });
});
