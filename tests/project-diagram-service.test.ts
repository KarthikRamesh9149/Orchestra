import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/app/errors.js";
import { ProjectDiagramService } from "../src/modules/diagrams/service.js";

const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
const orgId = "8d1b9f96-b2e2-4e2f-9a50-000000000001";
const actorUserId = "11111111-1111-4111-8111-111111111111";
const diagramId = "44444444-4444-4444-8444-444444444444";

function diagramRow(overrides: Record<string, unknown> = {}) {
  return {
    id: diagramId,
    orgId,
    projectId,
    title: "Onboarding flow",
    description: "Shows the onboarding handoff.",
    diagramType: "flowchart",
    mermaidSource: "flowchart TD\n  A[Start] --> B[Done]",
    source: "user_created",
    status: "active",
    linkedDocumentSectionIdsJson: [],
    linkedBrainNodeIdsJson: [],
    linkedContextEntryIdsJson: [],
    linkedArtifactVersionId: null,
    createdByUserId: actorUserId,
    updatedByUserId: actorUserId,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-02T00:00:00.000Z"),
    liveDocEmbeds: [],
    ...overrides
  };
}

function createDeps() {
  const prisma = {
    project: {
      findUnique: vi.fn(async () => ({ id: projectId, orgId, name: "Project Alpha" }))
    },
    projectDiagram: {
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [diagramRow()]),
      findFirst: vi.fn(async () => diagramRow()),
      create: vi.fn(async ({ data }: any) => diagramRow(data)),
      update: vi.fn(async ({ data }: any) => diagramRow({ ...data, updatedAt: new Date("2026-05-03T00:00:00.000Z") }))
    },
    documentSection: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) },
    brainNode: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) },
    projectContextEntry: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) },
    projectResponsibility: { findFirst: vi.fn(async () => null) },
    artifactVersion: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.artifactType === "live_doc") {
          return {
            id: "66666666-6666-4666-8666-666666666666",
            projectId,
            artifactType: "live_doc",
            status: "accepted",
            versionNumber: 1,
            payloadJson: {
              generatedFromProductBrainId: "77777777-7777-4777-8777-777777777777",
              sourceRefs: [],
              sections: [
                {
                  sectionKey: "overview",
                  anchorId: "overview",
                  sectionLabel: "Overview",
                  type: "body",
                  content: "Current truth",
                  sourceRefs: []
                }
              ]
            }
          };
        }
        return null;
      })
    },
    liveDocSectionDiagram: {
      upsert: vi.fn(async ({ create }: any) => ({
        id: "55555555-5555-4555-8555-555555555555",
        ...create,
        embeddedAt: new Date("2026-05-04T00:00:00.000Z"),
        diagram: diagramRow()
      })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 1),
      findFirst: vi.fn(async () => ({ id: "55555555-5555-4555-8555-555555555555" }))
    },
    auditEvent: { create: vi.fn(async () => ({})) },
    jobRun: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (callback: any) => callback(prisma))
  } as any;
  const generationProvider = {
    generateObject: vi.fn(async () => ({
      title: "Generated onboarding flow",
      description: "Generated from prompt only.",
      mermaidSource: "flowchart TD\n  prompt[Prompt] --> diagram[Diagram]"
    }))
  } as any;
  const projectService = {
    ensureProjectMemberCanUseSocrates: vi.fn(async () => ({ projectRole: "dev", isActive: true })),
    ensureProjectMemberCanManageTeamContext: vi.fn(async () => ({ projectRole: "manager", isActive: true }))
  } as any;
  const auditService = { record: vi.fn(async () => undefined) } as any;
  const jobs = { enqueue: vi.fn(async () => undefined) } as any;
  return { prisma, generationProvider, projectService, auditService, jobs };
}

describe("ProjectDiagramService", () => {
  it("creates, lists, updates, soft-deletes, audits, and refreshes dashboard", async () => {
    const deps = createDeps();
    const service = new ProjectDiagramService(
      deps.prisma,
      deps.generationProvider,
      deps.projectService,
      deps.auditService,
      deps.jobs
    );

    const created = await service.createDiagram(projectId, actorUserId, {
      title: "Onboarding flow",
      description: "Shows onboarding",
      diagramType: "flowchart",
      mermaidSource: "flowchart TD\n  A[Start] --> B[Done]",
      source: "user_created",
      linkedDocumentSectionIds: [],
      linkedBrainNodeIds: [],
      linkedContextEntryIds: [],
      linkedArtifactVersionId: null
    });
    expect(created).toMatchObject({ id: diagramId, diagramType: "flowchart", status: "active" });
    expect(deps.auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "project_diagram_created" }));
    expect(deps.jobs.enqueue).toHaveBeenCalled();

    const listed = await service.listDiagrams(projectId, actorUserId, { page: 1, pageSize: 25, includeDeleted: false });
    expect(listed.items).toHaveLength(1);
    expect(deps.projectService.ensureProjectMemberCanUseSocrates).toHaveBeenCalledWith(projectId, actorUserId);

    const updated = await service.updateDiagram(projectId, diagramId, actorUserId, { title: "Updated flow" });
    expect(updated.title).toBe("Updated flow");
    expect(deps.auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "project_diagram_updated" }));

    const deleted = await service.deleteDiagram(projectId, diagramId, actorUserId);
    expect(deleted).toEqual({ ok: true, deletedId: diagramId });
    expect(deps.prisma.liveDocSectionDiagram.deleteMany).toHaveBeenCalledWith({ where: { projectId, diagramId } });
  });

  it("generates proposed diagrams without persistence and saved diagrams with source refs", async () => {
    const deps = createDeps();
    const service = new ProjectDiagramService(
      deps.prisma,
      deps.generationProvider,
      deps.projectService,
      deps.auditService,
      deps.jobs
    );

    const proposed = await service.generateDiagram(projectId, actorUserId, {
      diagramType: "flowchart",
      prompt: "Generate onboarding flow",
      sourceRefs: [],
      save: false
    });
    expect(proposed).toMatchObject({ validation: { ok: true }, next: { canSave: true } });
    expect(deps.prisma.projectDiagram.create).not.toHaveBeenCalled();

    await service.generateDiagram(projectId, actorUserId, {
      diagramType: "flowchart",
      prompt: "Generate onboarding flow",
      sourceRefs: [],
      save: true
    });
    expect(deps.prisma.projectDiagram.create).toHaveBeenCalled();
    expect(deps.auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "project_diagram_generated" }));
  });

  it("embeds and removes active diagrams in Live Doc sections", async () => {
    const deps = createDeps();
    const service = new ProjectDiagramService(
      deps.prisma,
      deps.generationProvider,
      deps.projectService,
      deps.auditService,
      deps.jobs
    );

    const embed = await service.embedDiagramInLiveDoc(projectId, "overview", diagramId, actorUserId, { sortOrder: 2 });
    expect(embed).toMatchObject({ sectionKey: "overview", diagramId, sortOrder: 2 });
    expect(deps.prisma.liveDocSectionDiagram.upsert).toHaveBeenCalled();

    await service.removeDiagramFromLiveDoc(projectId, "overview", diagramId, actorUserId);
    expect(deps.prisma.liveDocSectionDiagram.deleteMany).toHaveBeenCalledWith({
      where: { projectId, sectionKey: "overview", diagramId }
    });
  });

  it("rejects unsafe Mermaid and wrong-project linked refs", async () => {
    const deps = createDeps();
    deps.prisma.documentSection.count.mockResolvedValue(0);
    const service = new ProjectDiagramService(
      deps.prisma,
      deps.generationProvider,
      deps.projectService,
      deps.auditService,
      deps.jobs
    );

    await expect(
      service.createDiagram(projectId, actorUserId, {
        title: "Unsafe",
        description: null,
        diagramType: "flowchart",
        mermaidSource: "flowchart TD\n  A[<script>alert(1)</script>]",
        source: "user_created",
        linkedDocumentSectionIds: [],
        linkedBrainNodeIds: [],
        linkedContextEntryIds: [],
        linkedArtifactVersionId: null
      })
    ).rejects.toThrow(AppError);

    await expect(
      service.createDiagram(projectId, actorUserId, {
        title: "Bad ref",
        description: null,
        diagramType: "flowchart",
        mermaidSource: "flowchart TD\n  A --> B",
        source: "user_created",
        linkedDocumentSectionIds: ["99999999-9999-4999-8999-999999999999"],
        linkedBrainNodeIds: [],
        linkedContextEntryIds: [],
        linkedArtifactVersionId: null
      })
    ).rejects.toThrow(/linked references/);
  });

  it("rejects multiple artifact_version source refs instead of silently dropping provenance", async () => {
    const deps = createDeps();
    const service = new ProjectDiagramService(
      deps.prisma,
      deps.generationProvider,
      deps.projectService,
      deps.auditService,
      deps.jobs
    );

    await expect(
      service.generateDiagram(projectId, actorUserId, {
        diagramType: "flowchart",
        prompt: "Generate architecture diagram",
        sourceRefs: [
          { type: "artifact_version", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
          { type: "artifact_version", id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }
        ],
        save: true
      })
    ).rejects.toMatchObject({ code: "invalid_diagram_reference" });
    expect(deps.generationProvider.generateObject).not.toHaveBeenCalled();
    expect(deps.prisma.projectDiagram.create).not.toHaveBeenCalled();
  });
});
