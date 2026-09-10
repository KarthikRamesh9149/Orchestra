import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/app/errors.js";
import { buildFallbackGeneratedMarkdown } from "../src/modules/documents/document-generation-templates.js";
import { ProjectDocumentGenerationService } from "../src/modules/documents/document-generation.service.js";
import { parseTextDocument } from "../src/lib/parsers/text.js";

const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
const actorUserId = "3322717f-2c10-4239-b525-6fbc9158f4fb";
const documentId = "4c753b88-5cd1-42aa-aae1-88ee5e7800c1";
const responsibilityId = "5a6f06ba-0580-4b56-9f98-bcbac014a9b1";
const contextId = "22222222-2222-4222-8222-222222222222";

function markdown(kind: "prd" | "srs", prompt = "Build a rental management MVP for landlords and tenants") {
  return buildFallbackGeneratedMarkdown({
    kind,
    templateId: kind === "prd" ? "basic_mvp" : "basic_srs",
    title: kind === "prd" ? "Generated PRD" : "Generated SRS",
    prompt,
    includeCodingHints: true,
    contextSummary: []
  });
}

function createDeps() {
  const prisma = {
    project: {
      findUnique: vi.fn(async () => ({
        id: projectId,
        orgId: "org-1",
        name: "Rental MVP",
        description: "A small rental workflow product"
      }))
    },
    document: {
      findFirst: vi.fn(async () => ({
        id: documentId,
        title: "Existing PRD",
        kind: "prd",
        currentVersionId: "ver-ctx"
      }))
    },
    documentSection: {
      findMany: vi.fn(async () => [
        {
          headingPath: ["Problem"],
          normalizedText: "Landlords need a simpler maintenance request workflow."
        }
      ])
    },
    projectResponsibility: {
      findFirst: vi.fn(async () => ({
        id: responsibilityId,
        title: "Own frontend",
        area: "frontend",
        status: "open",
        assigneeName: "Sara",
        description: "Build the Live Doc shell"
      }))
    },
    projectContextEntry: {
      findFirst: vi.fn(async () => ({
        id: contextId,
        type: "decision_note",
        title: "KYC onboarding decision",
        body: "Client PM said onboarding must support KYC before payment setup.",
        participantsJson: ["Client PM"],
        tagsJson: ["kyc"],
        sourceDate: new Date("2026-05-01T00:00:00.000Z"),
        importance: "high"
      }))
    },
    jobRun: {
      upsert: vi.fn(async () => ({}))
    }
  } as any;
  const env = {
    SOCRATES_GENERATION_TIMEOUT_MS: 1500
  } as any;
  const generationProvider = {
    generateObject: vi.fn(async (input: any) => input.schema.parse(input.fallback()))
  };
  const projectService = {
    ensureProjectMemberCanUploadContext: vi.fn(async () => ({ id: "member-1", projectRole: "manager", isActive: true }))
  } as any;
  const documentService = {
    uploadFile: vi.fn(async () => ({
      documentId: "generated-doc-1",
      documentVersionId: "generated-version-1",
      status: "pending",
      parseRevision: 1
    }))
  } as any;
  const auditService = {
    record: vi.fn(async () => undefined)
  } as any;
  const jobs = {
    enqueue: vi.fn(async () => undefined)
  } as any;
  const brainService = {
    rebuild: vi.fn(async () => ({ queued: true }))
  } as any;
  const telemetry = {
    increment: vi.fn()
  } as any;
  const service = new ProjectDocumentGenerationService(
    prisma,
    env,
    generationProvider as any,
    projectService,
    documentService,
    auditService,
    jobs,
    brainService,
    telemetry
  );

  return { service, prisma, generationProvider, projectService, documentService, auditService, jobs, brainService };
}

describe("ProjectDocumentGenerationService", () => {
  it("generates a PRD and persists it through DocumentService", async () => {
    const { service, documentService, auditService, jobs } = createDeps();

    const result = await service.generateDocument(projectId, actorUserId, {
      kind: "prd",
      template: "basic_mvp",
      prompt: "Build a rental management MVP for landlords and tenants",
      contextIds: [],
      tone: "plain",
      includeCodingHints: true,
      rebuildBrain: false
    });

    expect(result).toMatchObject({
      documentId: "generated-doc-1",
      documentVersionId: "generated-version-1",
      status: "queued",
      kind: "prd",
      next: {
        viewerUrl: `/v1/projects/${projectId}/documents/generated-doc-1/view`,
        rebuildBrainRecommended: true,
        brainRebuildQueued: false
      }
    });
    expect(documentService.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        actorUserId,
        kind: "prd",
        visibility: "internal",
        sourceLabel: "generated_by_socrates",
        contentType: "text/markdown"
      })
    );
    const upload = documentService.uploadFile.mock.calls[0][0];
    expect(upload.buffer.toString("utf8")).toContain("## Open Questions");
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "generated_document_created",
        entityType: "document",
        entityId: "generated-doc-1",
        payload: expect.objectContaining({
          promptHash: expect.any(String),
          promptLength: 55,
          contextRefCount: 0,
          sourceLabel: "generated_by_socrates"
        })
      })
    );
    expect(jobs.enqueue).toHaveBeenCalled();
  });

  it("generates an SRS and can queue Product Brain rebuild", async () => {
    const { service, documentService, brainService } = createDeps();

    const result = await service.generateDocument(projectId, actorUserId, {
      kind: "srs",
      template: "basic_srs",
      prompt: "Build a rental management MVP for landlords and tenants",
      contextIds: [],
      tone: "plain",
      includeCodingHints: true,
      rebuildBrain: true
    });

    expect(result.next).toMatchObject({
      rebuildBrainRecommended: false,
      brainRebuildQueued: true
    });
    expect(brainService.rebuild).toHaveBeenCalledWith(projectId, actorUserId);
    expect(documentService.uploadFile.mock.calls[0][0]).toMatchObject({
      kind: "srs",
      sourceLabel: "generated_by_socrates"
    });
  });

  it("rejects invalid typed context refs", async () => {
    const { service, documentService } = createDeps();

    await expect(
      service.generateDocument(projectId, actorUserId, {
        kind: "prd",
        template: "basic_mvp",
        prompt: "Build a rental management MVP for landlords and tenants",
        contextIds: ["not-a-typed-ref"],
        tone: "plain",
        includeCodingHints: true,
        rebuildBrain: false
      })
    ).rejects.toMatchObject({ statusCode: 422, code: "invalid_generation_context_ref" });
    expect(documentService.uploadFile).not.toHaveBeenCalled();
  });

  it("includes same-project document and responsibility context in generation prompt", async () => {
    const { service, generationProvider, prisma } = createDeps();

    await service.generateDocument(projectId, actorUserId, {
      kind: "prd",
      template: "basic_mvp",
      prompt: "Build a rental management MVP for landlords and tenants",
      contextIds: [`document:${documentId}`, `responsibility:${responsibilityId}`],
      tone: "plain",
      includeCodingHints: true,
      rebuildBrain: false
    });

    expect(prisma.document.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: documentId, projectId } }));
    expect(prisma.projectResponsibility.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: responsibilityId, projectId } }));
    const prompt = generationProvider.generateObject.mock.calls[0][0].prompt;
    expect(prompt).toContain("Document: Existing PRD");
    expect(prompt).toContain("Responsibility: Own frontend");
    expect(prompt).toContain("Landlords need a simpler maintenance request workflow.");
  });

  it("includes same-project active manual context refs in generation prompt", async () => {
    const { service, generationProvider, prisma } = createDeps();

    await service.generateDocument(projectId, actorUserId, {
      kind: "prd",
      template: "basic_mvp",
      prompt: "Build a rental management MVP for landlords and tenants",
      contextIds: [`context:${contextId}`],
      tone: "plain",
      includeCodingHints: true,
      rebuildBrain: false
    });

    expect(prisma.projectContextEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: contextId, projectId, status: "active" } })
    );
    const prompt = generationProvider.generateObject.mock.calls[0][0].prompt;
    expect(prompt).toContain("Manual context: KYC onboarding decision");
    expect(prompt).toContain("Client PM said onboarding must support KYC before payment setup.");
  });

  it("rejects deleted or wrong-project manual context refs", async () => {
    const { service, prisma, generationProvider, documentService } = createDeps();
    prisma.projectContextEntry.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.generateDocument(projectId, actorUserId, {
        kind: "prd",
        template: "basic_mvp",
        prompt: "Build a rental management MVP for landlords and tenants",
        contextIds: [`context:${contextId}`],
        tone: "plain",
        includeCodingHints: true,
        rebuildBrain: false
      })
    ).rejects.toMatchObject({ statusCode: 422, code: "invalid_generation_context_ref" });

    expect(generationProvider.generateObject).not.toHaveBeenCalled();
    expect(documentService.uploadFile).not.toHaveBeenCalled();
  });

  it("rejects typed context refs that do not belong to the project", async () => {
    const { service, prisma, generationProvider, documentService } = createDeps();
    prisma.document.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.generateDocument(projectId, actorUserId, {
        kind: "prd",
        template: "basic_mvp",
        prompt: "Build a rental management MVP for landlords and tenants",
        contextIds: [`document:${documentId}`],
        tone: "plain",
        includeCodingHints: true,
        rebuildBrain: false
      })
    ).rejects.toMatchObject({ statusCode: 422, code: "invalid_generation_context_ref" });

    expect(generationProvider.generateObject).not.toHaveBeenCalled();
    expect(documentService.uploadFile).not.toHaveBeenCalled();
  });

  it("rejects responsibility refs that do not belong to the project", async () => {
    const { service, prisma, generationProvider, documentService } = createDeps();
    prisma.projectResponsibility.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.generateDocument(projectId, actorUserId, {
        kind: "prd",
        template: "basic_mvp",
        prompt: "Build a rental management MVP for landlords and tenants",
        contextIds: [`responsibility:${responsibilityId}`],
        tone: "plain",
        includeCodingHints: true,
        rebuildBrain: false
      })
    ).rejects.toMatchObject({ statusCode: 422, code: "invalid_generation_context_ref" });

    expect(generationProvider.generateObject).not.toHaveBeenCalled();
    expect(documentService.uploadFile).not.toHaveBeenCalled();
  });

  it("sanitizes generated markdown before persistence", async () => {
    const { service, generationProvider, documentService } = createDeps();
    generationProvider.generateObject.mockImplementationOnce(async (input: any) => input.schema.parse({
      title: "Generated PRD",
      markdown: `${markdown("prd")}\n<script>alert('x')</script>\n<div>remove tags but keep text</div>`,
      model: "test"
    }));

    await service.generateDocument(projectId, actorUserId, {
      kind: "prd",
      template: "basic_mvp",
      prompt: "Build a rental management MVP for landlords and tenants",
      contextIds: [],
      tone: "plain",
      includeCodingHints: true,
      rebuildBrain: false
    });

    const persistedMarkdown = documentService.uploadFile.mock.calls[0][0].buffer.toString("utf8");
    expect(persistedMarkdown).not.toContain("<script");
    expect(persistedMarkdown).not.toContain("<div>");
    expect(persistedMarkdown).toContain("remove tags but keep text");
  });

  it("sanitizes generated titles before persistence and audit", async () => {
    const { service, generationProvider, documentService, auditService } = createDeps();
    generationProvider.generateObject.mockImplementationOnce(async (input: any) => input.schema.parse({
      title: "<script>alert('x')</script><strong>Generated Safe PRD</strong>",
      markdown: markdown("prd"),
      model: "test"
    }));

    const result = await service.generateDocument(projectId, actorUserId, {
      kind: "prd",
      template: "basic_mvp",
      prompt: "Build a rental management MVP for landlords and tenants",
      contextIds: [],
      tone: "plain",
      includeCodingHints: true,
      rebuildBrain: false
    });

    expect(result.title).toBe("Generated Safe PRD");
    expect(documentService.uploadFile.mock.calls[0][0].title).toBe("Generated Safe PRD");
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          title: "Generated Safe PRD"
        })
      })
    );
  });

  it("allows generated PRD markdown without optional coding hints when not requested", () => {
    const { service } = createDeps();
    const generated = buildFallbackGeneratedMarkdown({
      kind: "prd",
      templateId: "basic_mvp",
      title: "Generated PRD",
      prompt: "Build a rental management MVP for landlords and tenants",
      includeCodingHints: false,
      contextSummary: []
    });

    expect(generated).not.toContain("## Coding Hints");
    expect(service.validateGeneratedPrdSrs("prd", "basic_mvp", generated, false)).toBe(generated);
  });

  it("produces markdown that parses into document sections for viewer and RAG", () => {
    const parsed = parseTextDocument(markdown("prd"));
    const headings = parsed.sections.map((section) => section.title);

    expect(headings).toEqual(expect.arrayContaining(["Title", "Project Summary", "Functional Requirements", "Open Questions"]));
    expect(parsed.text).toContain("Build a rental management MVP");
  });

  it("rejects missing required sections", () => {
    const { service } = createDeps();

    expect(() => service.validateGeneratedPrdSrs("prd", "basic_mvp", "## Title\nOnly a title", true)).toThrow(AppError);
  });
});
