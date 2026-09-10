import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/app/errors.js";
import { CodingRequirementsService } from "../src/modules/coding-requirements/service.js";
import { codingRequirementsPayloadSchema } from "../src/modules/coding-requirements/schemas.js";

const projectId = "37e6d602-cc1b-4cc9-bc6c-5547241fbf90";
const orgId = "8d1b9f96-b2e2-4e2f-9a50-000000000001";
const actorUserId = "11111111-1111-4111-8111-111111111111";
const artifactVersionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const codingRequirementsId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const diagramId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function payload(overrides: Record<string, unknown> = {}) {
  return codingRequirementsPayloadSchema.parse({
    summary: "Build authentication and dashboard modules from accepted evidence.",
    modules: [
      {
        name: "Authentication",
        purpose: "Authenticate internal users before project access.",
        requirements: ["Internal users must authenticate before using project routes."],
        apis: ["POST /v1/auth/login"],
        dataModels: ["User"],
        dependencies: [],
        risks: [],
        suggestedBuildOrder: 1,
        assumptions: [],
        unknowns: [],
        citations: [{ type: "product_brain", refId: "brain-artifact-1", label: "Accepted Product Brain" }],
        openTargets: []
      },
      {
        name: "Dashboard",
        purpose: "Expose project summary state.",
        requirements: ["Dashboard must show bounded engineering summaries."],
        apis: ["GET /v1/projects/:projectId/dashboard"],
        dataModels: ["DashboardSnapshot"],
        dependencies: ["Authentication"],
        risks: ["Evidence may not specify every metric."],
        suggestedBuildOrder: 2,
        assumptions: [],
        unknowns: ["Confirm exact frontend dashboard route."],
        citations: [],
        openTargets: []
      }
    ],
    globalRequirements: ["Do not mutate Product Brain truth from coding requirements."],
    integrationPoints: ["Dashboard reads latest accepted engineering requirements."],
    assumptions: [],
    unknowns: ["Confirm deployment target."],
    suggestedBuildOrder: [
      { order: 1, moduleName: "Authentication", reason: "Access control gates all other modules.", dependencies: [] },
      { order: 2, moduleName: "Dashboard", reason: "Dashboard depends on authenticated project access.", dependencies: ["Authentication"] }
    ],
    mermaid: "flowchart TD\n  auth[Authentication] --> dashboard[Dashboard]",
    citations: [{ type: "product_brain", refId: "brain-artifact-1", label: "Accepted Product Brain" }],
    openTargets: [],
    generatedAt: "2026-05-19T00:00:00.000Z",
    evidenceSummary: {
      sourceCounts: { product_brain: 1 },
      lowEvidence: false,
      limitations: []
    },
    ...overrides
  });
}

function row(payloadJson = payload(), diagramOverrides: Record<string, unknown> = {}, artifactOverrides: Record<string, unknown> = {}) {
  return {
    id: codingRequirementsId,
    orgId,
    projectId,
    artifactVersionId,
    mermaidDiagramId: diagramId,
    generatedByUserId: actorUserId,
    createdAt: new Date("2026-05-19T00:00:00.000Z"),
    updatedAt: new Date("2026-05-19T00:00:00.000Z"),
    artifactVersion: {
      id: artifactVersionId,
      projectId,
      artifactType: "engineering_requirements",
      versionNumber: 1,
      status: "accepted",
      payloadJson,
      createdAt: new Date("2026-05-19T00:00:00.000Z"),
      ...artifactOverrides
    },
    mermaidDiagram: {
      id: diagramId,
      projectId,
      title: "Main Coding Flowchart",
      description: "Derived from the current coding requirements artifact.",
      diagramType: "coding_flow",
      mermaidSource: payloadJson.mermaid,
      source: "socrates_generated",
      status: "active",
      createdAt: new Date("2026-05-19T00:00:00.000Z"),
      updatedAt: new Date("2026-05-19T00:00:00.000Z"),
      ...diagramOverrides
    }
  };
}

function createDeps(generatedPayload = payload()) {
  let createdArtifact: any;
  let createdCoding: any;
  let createdDiagram: any;
  const prisma: any = {
    project: {
      findUnique: vi.fn(async () => ({ id: projectId, orgId, name: "Project Alpha" }))
    },
    artifactVersion: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (where.artifactType === "product_brain" && where.status === "accepted") {
          return {
            id: "brain-artifact-1",
            projectId,
            artifactType: "product_brain",
            versionNumber: 3,
            status: "accepted",
            payloadJson: { modules: ["Authentication", "Dashboard"], constraints: ["Internal-only access"] }
          };
        }
        return null;
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async ({ data }: any) => {
        createdArtifact = { id: artifactVersionId, ...data, versionNumber: data.versionNumber ?? 1 };
        return createdArtifact;
      })
    },
    brainNode: { findMany: vi.fn(async () => []) },
    documentSection: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    projectContextEntry: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    projectResponsibility: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    projectDiagram: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => {
        createdDiagram = { id: diagramId, createdAt: new Date("2026-05-19T00:00:00.000Z"), updatedAt: new Date("2026-05-19T00:00:00.000Z"), ...data };
        return createdDiagram;
      }),
      update: vi.fn(async ({ data }: any) => ({ ...createdDiagram, ...data }))
    },
    decisionRecord: { findMany: vi.fn(async () => []) },
    specChangeProposal: { findMany: vi.fn(async () => []) },
    communicationMessage: { findMany: vi.fn(async () => []) },
    projectCodingRequirements: {
      create: vi.fn(async ({ data }: any) => {
        createdCoding = row(createdArtifact.payloadJson);
        return { ...createdCoding, ...data, id: codingRequirementsId, artifactVersion: createdArtifact, mermaidDiagram: createdDiagram };
      }),
      findFirst: vi.fn(async () => row(generatedPayload)),
      findFirstOrThrow: vi.fn(async () => row(generatedPayload)),
      findMany: vi.fn(async () => [row(generatedPayload)]),
      count: vi.fn(async () => 1)
    },
    socratesSuggestion: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    jobRun: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (callback: any) => callback(prisma))
  };
  const generationProvider = {
    generateObject: vi.fn(async () => generatedPayload)
  } as any;
  const projectService = {
    ensureProjectMemberCanUseSocrates: vi.fn(async () => ({ projectRole: "dev", isActive: true })),
    ensureProjectMemberCanManageTeamContext: vi.fn(async () => ({ projectRole: "manager", isActive: true })),
    ensureProjectTruthApprover: vi.fn(async () => ({ authority: "manager", delegatedApproverGrantId: null }))
  } as any;
  const auditService = { record: vi.fn(async () => undefined) } as any;
  const jobs = { enqueue: vi.fn(async () => undefined) } as any;
  return { prisma, generationProvider, projectService, auditService, jobs };
}

describe("CodingRequirementsService", () => {
  it("generates, validates, persists, audits, and creates a flowchart diagram", async () => {
    const deps = createDeps();
    const service = new CodingRequirementsService(
      deps.prisma,
      deps.generationProvider,
      deps.projectService,
      deps.auditService,
      deps.jobs
    );

    const result = await service.generate(projectId, actorUserId, {
      focus: "full_project",
      includeMermaid: true,
      saveFlowchart: true,
      sourceRefs: []
    });

    expect(result).toMatchObject({
      id: codingRequirementsId,
      artifactVersionId,
      mermaidDiagramId: null,
      moduleCount: 2,
      flowchartAvailable: false,
      reviewStatus: "draft"
    });
    expect(deps.prisma.artifactVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ artifactType: "engineering_requirements", status: "draft", acceptedAt: null })
    }));
    expect(deps.prisma.projectDiagram.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ diagramType: "coding_flow", linkedArtifactVersionId: artifactVersionId, status: "draft" })
    }));
    expect(deps.auditService.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "coding_requirements_generated",
      payload: expect.not.objectContaining({ prompt: expect.anything() })
    }));
    expect(deps.jobs.enqueue).toHaveBeenCalled();
  });

  it("returns current, history, flowchart, dashboard summary, and retrieval evidence", async () => {
    const deps = createDeps();
    const service = new CodingRequirementsService(
      deps.prisma,
      deps.generationProvider,
      deps.projectService,
      deps.auditService,
      deps.jobs
    );

    await expect(service.getCurrent(projectId, actorUserId)).resolves.toMatchObject({ id: codingRequirementsId, payload: expect.any(Object) });
    await expect(service.getHistory(projectId, actorUserId, { page: 1, pageSize: 20 })).resolves.toMatchObject({ items: [expect.objectContaining({ id: codingRequirementsId })] });
    await expect(service.getFlowchart(projectId, actorUserId)).resolves.toMatchObject({ mermaid: expect.stringContaining("flowchart TD"), diagram: expect.objectContaining({ id: diagramId }) });
    await expect(service.buildEngineeringSummary(projectId)).resolves.toMatchObject({ hasCodingRequirements: true, moduleCount: 2, flowchartAvailable: true });
    const candidates = await service.getCodingRequirementsForRetrieval(projectId, "what needs to be coded", 3);
    expect(candidates[0]).toMatchObject({
      sourceType: "coding_requirements",
      citationRef: { type: "coding_requirements", id: codingRequirementsId },
      openTarget: { targetType: "coding_requirements" }
    });
  });

  it("requires an authorized truth approver before a draft becomes current", async () => {
    const deps = createDeps();
    deps.prisma.projectCodingRequirements.findFirst.mockResolvedValueOnce(
      row(payload(), { status: "draft" }, { status: "draft", acceptedAt: null })
    );
    const service = new CodingRequirementsService(
      deps.prisma,
      deps.generationProvider,
      deps.projectService,
      deps.auditService,
      deps.jobs
    );

    const accepted = await service.acceptDraft(projectId, codingRequirementsId, actorUserId);
    expect(deps.projectService.ensureProjectTruthApprover).toHaveBeenCalledWith(projectId, actorUserId);
    expect(deps.prisma.artifactVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: artifactVersionId, status: "draft" }),
      data: expect.objectContaining({ status: "accepted", acceptedAt: expect.any(Date) })
    }));
    expect(deps.prisma.projectDiagram.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: diagramId },
      data: expect.objectContaining({ status: "active" })
    }));
    expect(accepted).toMatchObject({ reviewStatus: "accepted", flowchartAvailable: true });
  });

  it("does not expose a deleted linked diagram as an active flowchart", async () => {
    const deletedDiagramPayload = payload();
    const deps = createDeps(deletedDiagramPayload);
    deps.prisma.projectCodingRequirements.findFirst.mockResolvedValue(row(deletedDiagramPayload, { status: "deleted" }));
    deps.prisma.projectCodingRequirements.findMany.mockResolvedValue([row(deletedDiagramPayload, { status: "deleted" })]);
    const service = new CodingRequirementsService(
      deps.prisma,
      deps.generationProvider,
      deps.projectService,
      deps.auditService,
      deps.jobs
    );

    await expect(service.getCurrent(projectId, actorUserId)).resolves.toMatchObject({
      mermaidDiagramId: null,
      flowchartAvailable: false
    });
    await expect(service.getFlowchart(projectId, actorUserId)).resolves.toMatchObject({
      mermaid: expect.stringContaining("flowchart TD"),
      diagram: null
    });
    await expect(service.buildEngineeringSummary(projectId)).resolves.toMatchObject({
      flowchartAvailable: false
    });
    const candidates = await service.getCodingRequirementsForRetrieval(projectId, "main coding flow", 3);
    expect(candidates[0]).not.toHaveProperty("diagramId");
    expect(candidates[0].content).not.toContain("Flowchart diagram:");
  });

  it("returns honest low-evidence unknowns when no evidence exists", async () => {
    const deps = createDeps();
    deps.prisma.artifactVersion.findFirst.mockResolvedValue(null);
    const service = new CodingRequirementsService(
      deps.prisma,
      deps.generationProvider,
      deps.projectService,
      deps.auditService,
      deps.jobs
    );

    deps.generationProvider.generateObject.mockImplementationOnce(async ({ fallback }: any) => fallback());
    const result = await service.generate(projectId, actorUserId, {
      focus: "backend",
      includeMermaid: true,
      saveFlowchart: false,
      sourceRefs: []
    });

    expect(result.payload!.evidenceSummary.lowEvidence).toBe(true);
    expect(result.payload!.unknowns.length).toBeGreaterThan(0);
    expect(deps.prisma.projectDiagram.create).not.toHaveBeenCalled();
  });

  it("drops hallucinated citations and rejects unsafe generated flowcharts", async () => {
    const hallucinated = payload({
      citations: [{ type: "project_context", refId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", label: "Wrong project context" }],
      openTargets: [{ targetType: "project_context", targetRef: { projectId, contextId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" } }],
      modules: [
        {
          ...payload().modules[0],
          citations: [{ type: "project_context", refId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", label: "Wrong project context" }],
          openTargets: [{ targetType: "project_context", targetRef: { projectId, contextId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" } }]
        }
      ]
    });
    const deps = createDeps(hallucinated);
    const service = new CodingRequirementsService(
      deps.prisma,
      deps.generationProvider,
      deps.projectService,
      deps.auditService,
      deps.jobs
    );
    const result = await service.generate(projectId, actorUserId, {
      focus: "full_project",
      includeMermaid: true,
      saveFlowchart: false,
      sourceRefs: []
    });
    expect(result.payload!.citations).toHaveLength(0);
    expect(result.payload!.openTargets).toHaveLength(0);
    expect(result.payload!.modules[0].citations).toHaveLength(0);

    const unsafeDeps = createDeps({
      ...payload(),
      mermaid: "flowchart TD\n  A[Start] --> B[<script>alert(1)</script>]"
    } as any);
    const unsafeService = new CodingRequirementsService(
      unsafeDeps.prisma,
      unsafeDeps.generationProvider,
      unsafeDeps.projectService,
      unsafeDeps.auditService,
      unsafeDeps.jobs
    );
    await expect(
      unsafeService.generate(projectId, actorUserId, {
        focus: "full_project",
        includeMermaid: true,
        saveFlowchart: true,
        sourceRefs: []
      })
    ).rejects.toThrow(AppError);
    expect(unsafeDeps.prisma.artifactVersion.create).not.toHaveBeenCalled();
  });
});
