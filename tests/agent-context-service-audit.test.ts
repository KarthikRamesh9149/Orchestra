import { describe, expect, it, vi } from "vitest";
import { AgentContextPackService } from "../src/modules/agent-context/service.js";
import { AgentRunMemoryService } from "../src/modules/agent-context/agent-runs.service.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const reviewerId = "99999999-9999-4999-8999-999999999999";

function buildService() {
  const prisma = {
    project: {
      findUnique: vi.fn(async () => ({ id: projectId, orgId: "33333333-3333-4333-8333-333333333333", name: "Project" }))
    },
    artifactVersion: { findFirst: vi.fn() },
    brainNode: { findFirst: vi.fn(), findMany: vi.fn() },
    documentSection: { findFirst: vi.fn(), findMany: vi.fn() },
    specChangeProposal: { findMany: vi.fn() },
    decisionRecord: { findMany: vi.fn() },
    communicationMessage: { findMany: vi.fn() },
    dashboardSnapshot: { findFirst: vi.fn() },
    agentContextPack: { create: vi.fn() },
    $transaction: vi.fn()
  };
  const projectService = { ensureProjectAccess: vi.fn(async () => ({ id: projectId })) };
  const auditService = { record: vi.fn() };
  return {
    prisma,
    service: new AgentContextPackService(prisma as any, {} as any, projectService as any, auditService as any)
  };
}

describe("AgentContextPackService audit hardening", () => {
  it("blocks project-role clients from internal Agent Context packs", async () => {
    const { service, prisma } = buildService();
    (service as any).projectService.ensureProjectAccess.mockResolvedValueOnce({ id: "client-member", projectRole: "client" });

    await expect(
      service.listPacks(projectId, userId, { page: 1, pageSize: 20 } as any)
    ).rejects.toMatchObject({ code: "client_agent_context_access_forbidden", statusCode: 403 });
    expect(prisma.agentContextPack.create).not.toHaveBeenCalled();
  });

  it("requires project-scoped seed references for seeded source modes before generation", async () => {
    const { service, prisma } = buildService();

    await expect(
      service.createPack(projectId, userId, {
        taskPrompt: "Implement checkout",
        taskType: "implementation",
        sourceMode: "document_section",
        budgetPreset: "normal",
        visibility: "internal"
      })
    ).rejects.toMatchObject({ code: "agent_context_seed_required", statusCode: 400 });
    expect(prisma.agentContextPack.create).not.toHaveBeenCalled();
  });

  it("rejects seed references that do not match the requested source mode", async () => {
    const { service, prisma } = buildService();

    await expect(
      service.createPack(projectId, userId, {
        taskPrompt: "Implement checkout",
        taskType: "implementation",
        sourceMode: "document_section",
        seedReference: { type: "brain_node", id: "node-1" },
        budgetPreset: "normal",
        visibility: "internal"
      })
    ).rejects.toMatchObject({ code: "agent_context_seed_type_mismatch", statusCode: 400 });
    expect(prisma.agentContextPack.create).not.toHaveBeenCalled();
  });

  it("does not seed agent work from a superseded Product Brain", async () => {
    const { service, prisma } = buildService();
    prisma.artifactVersion.findFirst.mockResolvedValue(null);

    await expect(service.createPack(projectId, userId, {
      taskPrompt: "Implement the current approved checkout flow",
      taskType: "implementation",
      sourceMode: "product_brain_area",
      seedReference: { type: "product_brain", id: "44444444-4444-4444-8444-444444444444" },
      budgetPreset: "normal",
      visibility: "internal"
    })).rejects.toMatchObject({ code: "agent_context_seed_not_found", statusCode: 404 });
    expect(prisma.artifactVersion.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ artifactType: "product_brain", status: "accepted" })
    });
  });

  it("redacts source excerpts, provider metadata, and body evidence in redacted responses", () => {
    const { service } = buildService();
    const now = new Date("2026-01-01T00:00:00.000Z");
    const dto = (service as any).toDto({
      id: "44444444-4444-4444-8444-444444444444",
      status: "active",
      title: "Redacted",
      taskPrompt: "Review private evidence",
      taskType: "review",
      sourceMode: "task_prompt",
      seedRefJson: null,
      targetAgentJson: null,
      budgetPreset: "normal",
      visibility: "redacted",
      sectionsJson: {
        mission: { title: "Mission", items: ["Review private evidence"] },
        currentAcceptedTruth: { title: "Current accepted truth", items: ["Private customer statement should not echo."] },
        relevantSourceEvidence: {
          title: "Relevant source evidence",
          items: [{ title: "Private message", excerpt: "Private customer statement should not echo.", evidenceStatus: "communication_evidence" }]
        },
        implementationConstraints: { title: "Implementation constraints", items: [] },
        relevantImplementationSurfaces: { title: "Relevant implementation surfaces", items: [] },
        openQuestions: { title: "Open questions", items: [] },
        acceptanceChecklist: { title: "Acceptance checklist", items: [] },
        limitations: { title: "Limitations", items: [] }
      },
      bodyMarkdown: "Private customer statement should not echo.",
      sourceCount: 1,
      evidenceCount: 1,
      citationCount: 0,
      openTargetCount: 0,
      tokenEstimate: 100,
      tokenEstimateMethod: "chars_div_4",
      productBrainVersionId: null,
      liveDocVersionId: null,
      documentVersionId: null,
      artifactVersionId: null,
      limitationsJson: [],
      warningsJson: [],
      errorsJson: null,
      generatedAt: now,
      refreshedAt: null,
      archivedAt: null,
      deletedAt: null,
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: now,
      updatedAt: now,
      sources: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          sourceType: "communication_message",
          sourceRefType: "communication_message",
          sourceRefId: "66666666-6666-4666-8666-666666666666",
          relationship: "communication_evidence",
          title: "Private message",
          excerpt: "Private customer statement should not echo.",
          summary: null,
          whyItMatters: "Relevant",
          citationJson: null,
          openTargetJson: null,
          evidenceStatus: "communication_evidence",
          confidence: 0.5,
          sortOrder: 0,
          provider: "slack",
          sourceDomain: "communication_messages",
          visibility: "internal",
          createdAt: now
        }
      ]
    });

    expect(dto.bodyMarkdown).not.toContain("Private customer statement should not echo");
    expect(dto.sources[0].excerpt).toBeNull();
    expect(dto.sources[0].provider).toBeNull();
    expect(dto.sources[0].sourceDomain).toBeNull();
    expect(dto.sections.relevantSourceEvidence.items[0].excerpt).toBe("[redacted]");
  });
});

describe("AgentRunMemoryService audit hardening", () => {
  it("blocks project-role clients from internal Agent Run memory", async () => {
    const prisma = {
      project: {
        findUnique: vi.fn()
      },
      agentRun: {
        count: vi.fn(),
        findMany: vi.fn()
      }
    };
    const projectService = { ensureProjectAccess: vi.fn(async () => ({ id: "client-member", projectRole: "client" })) };
    const auditService = { record: vi.fn() };
    const service = new AgentRunMemoryService(prisma as any, projectService as any, auditService as any);

    await expect(
      service.listRuns(projectId, userId, { page: 1, pageSize: 20 } as any)
    ).rejects.toMatchObject({ code: "client_agent_run_access_forbidden", statusCode: 403 });
    expect(prisma.agentRun.findMany).not.toHaveBeenCalled();
  });

  it("requires a different truth approver to record terminal review metadata", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const run = {
      id: "77777777-7777-4777-8777-777777777777",
      orgId: "33333333-3333-4333-8333-333333333333",
      projectId,
      contextPackId: null,
      contextPackGeneratedAt: null,
      exportRefJson: null,
      exportFormat: null,
      createdByUserId: userId,
      updatedByUserId: userId,
      reviewedByUserId: null,
      targetAgentJson: null,
      provider: "codex",
      agentLabel: "Codex",
      taskTitle: "Implement auth routes",
      taskType: "implementation",
      taskDescription: null,
      promptSource: "manually_pasted",
      promptSent: null,
      promptHash: null,
      status: "completed",
      outputSummary: "Agent output is pending review.",
      fullOutput: null,
      implementationNotes: null,
      branchName: null,
      commitSha: null,
      prUrl: null,
      filesChangedJson: [],
      modulesTouchedJson: [],
      testsRunJson: [],
      testStatus: null,
      docsUpdatedJson: [],
      risksFoundJson: [],
      followUpQuestionsJson: [],
      humanReviewResult: "unreviewed",
      humanReviewNotes: null,
      possibleProductBrainImplications: false,
      productBrainImplicationsJson: [],
      limitationsJson: [],
      warningsJson: [],
      unverifiedClaims: true,
      requiresHumanReview: true,
      visibility: "internal",
      indexedForSocrates: true,
      indexedAt: now,
      retrievalSummary: "Implement auth routes",
      citationJson: { type: "agent_run", id: "77777777-7777-4777-8777-777777777777" },
      openTargetJson: { targetType: "agent_run", targetRef: { agentRunId: "77777777-7777-4777-8777-777777777777" } },
      reviewedAt: null,
      archivedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    };
    const prisma = {
      project: {
        findUnique: vi.fn(async () => ({ id: projectId, orgId: "33333333-3333-4333-8333-333333333333" }))
      },
      agentRun: {
        findFirst: vi.fn(async () => run),
        update: vi.fn(async ({ data }) => ({ ...run, ...data, status: data.status, updatedAt: now }))
      }
    };
    const projectService = {
      ensureProjectAccess: vi.fn(async () => ({ id: projectId })),
      ensureProjectTruthApprover: vi.fn(async () => ({ authority: "manager" }))
    };
    const auditService = { record: vi.fn() };
    const service = new AgentRunMemoryService(prisma as any, projectService as any, auditService as any);

    await expect(service.reviewRun(projectId, run.id, userId, {
      reviewResult: "accepted"
    })).rejects.toMatchObject({ code: "agent_run_self_review_forbidden", statusCode: 409 });

    const result = await service.reviewRun(projectId, run.id, reviewerId, {
      reviewResult: "accepted",
      humanReviewNotes: "Human reviewed; github_pat_abcdefghijklmnopqrstuvwxyz123456 was pasted and must redact."
    });

    expect(prisma.agentRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "accepted",
        humanReviewResult: "accepted",
        reviewedByUserId: reviewerId,
        reviewedAt: expect.any(Date),
        requiresHumanReview: false,
        unverifiedClaims: false,
        humanReviewNotes: expect.stringContaining("[redacted]")
      })
    }));
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "agent_run_accepted",
      payload: expect.objectContaining({ previousStatus: "completed", newStatus: "accepted", reviewResult: "accepted" })
    }));
    expect(projectService.ensureProjectTruthApprover).toHaveBeenCalledWith(projectId, reviewerId);
    expect(result.humanReviewResult).toBe("accepted");
  });
});
