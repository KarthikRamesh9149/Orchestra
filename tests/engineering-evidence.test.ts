import { describe, expect, it, vi } from "vitest";
import { EngineeringEvidenceService } from "../src/modules/engineering-evidence/service.js";

const actor = { userId: "user-1", orgId: "org-1" };
const projectId = "11111111-1111-4111-8111-111111111111";

function createService(overrides: Record<string, unknown> = {}) {
  const prisma = {
    project: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: projectId, orgId: actor.orgId }) },
    gitHubEngineeringEvidence: {
      findMany: vi.fn().mockResolvedValue([
        githubEvidence("github_pull_request", "pr:987:42", {
          title: "Implement billing endpoint",
          pullRequestNumber: 42,
          branch: "feature/billing",
          sourceUrl: "https://github.com/acme/app/pull/42"
        }),
        githubEvidence("github_pull_request_file", "pr_file:987:42:abc", {
          title: "src/billing/mock-client.ts",
          path: "src/billing/mock-client.ts",
          pullRequestNumber: 42,
          branch: "feature/billing",
          sourceUrl: "https://github.com/acme/app/pull/42/files"
        }),
        githubEvidence("github_review_comment", "review_comment:987:9002", {
          title: "src/billing/mock-client.ts",
          summary: "TODO replace mock billing API before launch",
          path: "src/billing/mock-client.ts",
          pullRequestNumber: 42,
          sourceUrl: "https://github.com/acme/app/pull/42#discussion_r9002"
        })
      ])
    },
    agentRun: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "22222222-2222-4222-8222-222222222222",
          orgId: actor.orgId,
          projectId,
          provider: "codex",
          agentLabel: "Codex",
          taskTitle: "Wire billing",
          status: "completed",
          branchName: "feature/billing",
          commitSha: "abc123",
          prUrl: "https://github.com/acme/app/pull/42",
          filesChangedJson: ["src/billing/mock-client.ts"],
          risksFoundJson: ["Billing API is still mocked"],
          followUpQuestionsJson: ["Who owns real billing credentials?"],
          humanReviewResult: "unreviewed",
          unverifiedClaims: true,
          createdAt: new Date("2026-05-24T00:00:00Z"),
          updatedAt: new Date("2026-05-24T00:00:00Z")
        }
      ])
    },
    engineeringEvidenceItem: {
      upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve({ id: `ev-${create.evidenceKey}`, ...create })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn()
    },
    engineeringEvidenceRefreshRun: {
      create: vi.fn().mockResolvedValue({ id: "refresh-1" }),
      update: vi.fn().mockResolvedValue({ id: "refresh-1" })
    },
    engineeringEvidenceManualEntry: {
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "manual-1", createdAt: new Date(), updatedAt: new Date(), ...data })),
      findMany: vi.fn().mockResolvedValue([])
    },
    ...overrides
  };
  const projectService = {
    ensureProjectAccess: vi.fn().mockResolvedValue({}),
    ensureProjectManager: vi.fn().mockResolvedValue({})
  };
  const auditService = { record: vi.fn().mockResolvedValue({}) };
  const transactionalPrisma = Object.assign(prisma, {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "active-link" }]),
    $transaction: (fn: any) => fn(prisma)
  });
  return {
    service: new EngineeringEvidenceService(transactionalPrisma as any, { ENGINEERING_EVIDENCE_CONTENT_SCAN_ENABLED: false } as any, projectService as any, auditService as any),
    prisma,
    projectService,
    auditService
  };
}

describe("EngineeringEvidenceService", () => {
  it("normalizes GitHub and agent run records into provider-neutral engineering evidence", async () => {
    const { service, prisma, projectService, auditService } = createService();

    const result = await service.refresh(projectId, actor, { sourceTypes: ["github", "agent_run"] });

    expect(projectService.ensureProjectAccess).toHaveBeenCalledWith(projectId, actor.userId);
    expect(result.counts).toMatchObject({ github: 3, agentRuns: 1, routeRegistry: expect.any(Number), normalized: expect.any(Number) });
    const created = prisma.engineeringEvidenceItem.upsert.mock.calls.map((call: any[]) => call[0].create);
    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "github", sourceType: "github", sourceSubType: "pull_request", pullRequestNumber: 42 }),
        expect.objectContaining({ provider: "github", sourceType: "github", sourceSubType: "changed_file", filePath: "src/billing/mock-client.ts" }),
        expect.objectContaining({ provider: "orchestra", sourceType: "agent_activity", sourceSubType: "agent_run", status: "unverified" })
      ])
    );
    expect(created.every((item: any) => Object.keys(item.citationJson).length > 0)).toBe(true);
    expect(created.every((item: any) => Object.keys(item.openTargetJson).length > 0)).toBe(true);
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "engineering_evidence.refresh_completed" }));
  });

  it("builds mock-real, seam, branch/deploy, and TODO views without treating evidence as truth", async () => {
    const item = evidenceItem({
      id: "ev-1",
      sourceSubType: "changed_file",
      filePath: "src/billing/mock-client.ts",
      title: "src/billing/mock-client.ts",
      summary: "TODO replace mock billing API",
      branch: "feature/billing",
      pullRequestNumber: 42,
      sourceUrl: "https://github.com/acme/app/pull/42/files"
    });
    const { service, prisma } = createService({
      engineeringEvidenceItem: {
        upsert: vi.fn(),
        findMany: vi.fn().mockResolvedValue([item]),
        findFirst: vi.fn().mockResolvedValue(item)
      },
      engineeringEvidenceManualEntry: {
        findMany: vi.fn().mockResolvedValue([])
      }
    });

    await expect(service.listEvidence(projectId, actor, { limit: 25 })).resolves.toMatchObject({
      projectId,
      readOnly: true,
      truthMutationAllowed: false
    });
    await expect(service.listMockRealRegistry(projectId, actor)).resolves.toMatchObject({
      items: [expect.objectContaining({ status: "mocked", targetKind: "file" })]
    });
    await expect(service.listIntegrationSeams(projectId, actor)).resolves.toMatchObject({
      limitations: expect.arrayContaining([expect.stringContaining("frontend")])
    });
    await expect(service.listBranchDeployTruth(projectId, actor)).resolves.toMatchObject({
      items: [expect.objectContaining({ status: "open_pr", branch: "feature/billing" })]
    });
    await expect(service.listTodoFixme(projectId, actor)).resolves.toMatchObject({
      items: [expect.objectContaining({ label: "TODO", filePath: "src/billing/mock-client.ts" })]
    });
    expect(prisma.engineeringEvidenceItem.findMany).toHaveBeenCalled();
  });

  it("classifies mock-real partial and assumed signals without overclaiming real status", async () => {
    const partial = evidenceItem({
      id: "ev-partial",
      sourceSubType: "changed_file",
      filePath: "src/billing/client.ts",
      title: "Billing integration partial implementation"
    });
    const assumed = evidenceItem({
      id: "ev-assumed",
      sourceSubType: "changed_file",
      filePath: "src/billing/contract.ts",
      summary: "Assumed API contract from frontend note"
    });
    const { service } = createService({
      engineeringEvidenceItem: {
        upsert: vi.fn(),
        findMany: vi.fn().mockResolvedValue([partial, assumed]),
        findFirst: vi.fn()
      },
      engineeringEvidenceManualEntry: {
        findMany: vi.fn().mockResolvedValue([])
      }
    });

    await expect(service.listMockRealRegistry(projectId, actor)).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ status: "partial", targetName: "src/billing/client.ts" }),
        expect.objectContaining({ status: "assumed", targetName: "src/billing/contract.ts" })
      ])
    });
  });

  it("creates manual registry evidence as manual evidence only", async () => {
    const { service, prisma } = createService();

    const result = await service.createManualEntry(projectId, actor, {
      entryType: "mock_real",
      targetKind: "api_route",
      title: "Billing route is mocked",
      summary: "Manual registry note from backend lead",
      status: "mocked",
      confidence: "high"
    });

    expect(result).toMatchObject({ entryType: "mock_real", manual: true, truthMutationAllowed: false });
    expect(prisma.engineeringEvidenceManualEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ createdByUserId: actor.userId, entryType: "mock_real", status: "mocked" })
    }));
    expect(prisma.engineeringEvidenceItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ provider: "manual", sourceType: "manual_registry", sourceSubType: "mock_real" })
    }));
  });

  it("deep-redacts secret-like content from manual evidence JSON before persistence", async () => {
    const { service, prisma } = createService();

    await service.createManualEntry(projectId, actor, {
      entryType: "general",
      targetKind: "repository_note",
      title: "Secret note github_pat_abcdefghijklmnopqrstuvwxyz1234567890",
      summary: "OPENAI_API_KEY=sk-1234567890abcdefghijklmnopqrst",
      status: "open",
      confidence: "medium",
      citations: [{ url: "https://example.test", token: "ghp_abcdefghijklmnopqrstuvwxyz123456" }],
      openTargets: [{ targetType: "file", ref: { bearer: "Bearer abcdefghijklmnopqrstuvwxyz123456" } }],
      metadata: {
        nested: {
          databaseUrl: "postgresql://user:pass@example.test:5432/orchestra",
          mcpToken: "mcp_abcdefghijklmnopqrstuvwxyz123456"
        }
      }
    });

    const manualCreate = prisma.engineeringEvidenceManualEntry.create.mock.calls.at(-1)?.[0].data;
    const evidenceCreate = prisma.engineeringEvidenceItem.upsert.mock.calls.at(-1)?.[0].create;
    const persisted = JSON.stringify({ manualCreate, evidenceCreate });

    expect(persisted).not.toContain("github_pat_");
    expect(persisted).not.toContain("ghp_");
    expect(persisted).not.toContain("sk-1234567890");
    expect(persisted).not.toContain("postgresql://user:pass");
    expect(persisted).not.toContain("mcp_abcdefghijklmnopqrstuvwxyz");
    expect(persisted).toContain("[redacted]");
  });
});

function githubEvidence(evidenceType: string, providerId: string, overrides: Record<string, unknown>) {
  return {
    id: `github-${providerId}`,
    orgId: actor.orgId,
    projectId,
    repositoryLinkId: "repo-link-1",
    repositoryOwner: "acme",
    repositoryName: "app",
    evidenceType,
    providerId,
    title: null,
    summary: null,
    branch: null,
    sha: null,
    pullRequestNumber: null,
    path: null,
    status: "active",
    actorGithubUserId: "77",
    actorGithubLogin: "octocat",
    mappedUserId: null,
    sourceUrl: null,
    occurredAt: new Date("2026-05-24T00:00:00Z"),
    citationJson: { source: "github", providerId },
    openTargetJson: { type: evidenceType, url: overrides.sourceUrl ?? null },
    payloadJson: {},
    createdAt: new Date("2026-05-24T00:00:00Z"),
    updatedAt: new Date("2026-05-24T00:00:00Z"),
    ...overrides
  };
}

function evidenceItem(overrides: Record<string, unknown>) {
  return {
    id: "ev",
    orgId: actor.orgId,
    projectId,
    provider: "github",
    sourceType: "github",
    sourceSubType: "pull_request",
    evidenceKey: "key",
    repositoryLinkId: "repo-link-1",
    repositoryOwner: "acme",
    repositoryName: "app",
    branch: null,
    sha: null,
    pullRequestNumber: null,
    filePath: null,
    routeMethod: null,
    routePath: null,
    status: "active",
    confidence: "medium",
    severity: null,
    actorGithubUserId: null,
    actorGithubLogin: null,
    mappedUserId: null,
    occurredAt: new Date("2026-05-24T00:00:00Z"),
    sourceUrl: null,
    providerRawId: "raw",
    title: null,
    summary: null,
    citationJson: {},
    openTargetJson: {},
    metadataJson: {},
    createdAt: new Date("2026-05-24T00:00:00Z"),
    updatedAt: new Date("2026-05-24T00:00:00Z"),
    archivedAt: null,
    ...overrides
  };
}
