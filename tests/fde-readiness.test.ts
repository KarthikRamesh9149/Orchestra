import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/app/errors.js";
import { FdeReadinessIntelligenceService } from "../src/modules/fde-readiness/service.js";

const actor = { userId: "user-1", orgId: "org-1" };
const projectId = "11111111-1111-4111-8111-111111111111";

function createService(evidence: any[] = [], overrides: Record<string, any> = {}) {
  const traceRow = {
    id: "trace-1",
    orgId: actor.orgId,
    projectId,
    anchorType: "file",
    anchorRef: "src/api/billing.ts",
    status: "complete",
    overallConfidence: "exact_link",
    summary: "Trace",
    citationsJson: [],
    openTargetsJson: [],
    limitationsJson: [],
    warningsJson: [],
    generatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    hops: []
  };
  const prisma = {
    project: { findFirstOrThrow: vi.fn().mockResolvedValue({ id: projectId, orgId: actor.orgId }) },
    engineeringEvidenceItem: { findMany: vi.fn().mockResolvedValue(evidence) },
    gitHubEngineeringEvidence: { findMany: vi.fn().mockResolvedValue([]) },
    decisionRecord: {
      findMany: vi.fn().mockResolvedValue([
        { id: "decision-1", projectId, title: "Use billing API", statement: "src/api/billing.ts implements billing", status: "accepted", acceptedAt: new Date("2026-05-20T00:00:00Z"), acceptedBy: "user-1" }
      ]),
      findFirst: vi.fn().mockResolvedValue({ id: "decision-1", projectId, status: "accepted" })
    },
    fdeReadinessRun: {
      create: vi.fn().mockResolvedValue({ id: "run-1" }),
      update: vi.fn().mockResolvedValue({ id: "run-1" })
    },
    fdeReadinessFinding: {
      upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve({ id: `finding-${create.findingKey}`, ...create, updatedAt: new Date() })),
      findMany: vi.fn().mockResolvedValue([])
    },
    fdeRationaleTrace: {
      create: vi.fn().mockResolvedValue(traceRow),
      findFirst: vi.fn().mockResolvedValue({ ...traceRow, hops: [] }),
      findMany: vi.fn().mockResolvedValue([traceRow])
    },
    fdeRationaleTraceHop: { create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: `hop-${data.hopOrder}`, ...data })) },
    fdeDecisionEngineeringLink: {
      upsert: vi.fn().mockImplementation(({ create }) => Promise.resolve({ id: "decision-link-1", createdAt: new Date(), ...create })),
      findMany: vi.fn().mockResolvedValue([])
    },
    ...overrides
  };
  const projectService = { ensureProjectAccess: vi.fn().mockResolvedValue({}) };
  const auditService = { record: vi.fn().mockResolvedValue({}) };
  return {
    service: new FdeReadinessIntelligenceService(
      prisma as any,
      { FDE_READINESS_INTELLIGENCE_ENABLED: true, FDE_READINESS_MAX_EVIDENCE_ITEMS: 500, MVP_MODE: false } as any,
      projectService as any,
      auditService as any
    ),
    prisma,
    projectService,
    auditService
  };
}

describe("FdeReadinessIntelligenceService", () => {
  it("detects overlapping PR edits, duplicate work, live activity, and safe-to-touch red", async () => {
    const evidence = [
      evidenceItem({ id: "ev-pr-1", filePath: "src/api/billing.ts", pullRequestNumber: 10, branch: "feature/billing-a", sourceSubType: "changed_file" }),
      evidenceItem({ id: "ev-pr-2", filePath: "src/api/billing.ts", pullRequestNumber: 11, branch: "feature/billing-b", sourceSubType: "changed_file" })
    ];
    const { service, prisma, auditService } = createService(evidence);

    await service.refreshAll(projectId, actor);
    const created = prisma.fdeReadinessFinding.upsert.mock.calls.map((call: any[]) => call[0].create);

    expect(created).toEqual(expect.arrayContaining([
      expect.objectContaining({ findingType: "conflict", findingSubType: "overlapping_edit", severity: "blocking" }),
      expect.objectContaining({ findingType: "safe_to_touch", findingSubType: "red", targetRef: "src/api/billing.ts" }),
      expect.objectContaining({ findingType: "duplicate_work", findingSubType: "file_overlap" }),
      expect.objectContaining({ findingType: "live_working_signal", targetRef: "src/api/billing.ts" })
    ]));
    expect(JSON.stringify(created)).toContain("no GitHub writes");
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "fde_readiness.refresh_completed" }));
  });

  it("returns yellow/green/unknown safe-to-touch without pretending absence of evidence is safe", async () => {
    const warning = evidenceItem({ id: "ev-todo", filePath: "src/api/todos.ts", title: "TODO follow up", sourceSubType: "todo_comment" });
    const clear = evidenceItem({ id: "ev-clear", filePath: "src/api/health.ts", title: "Health route", sourceSubType: "changed_file" });
    const { service, prisma } = createService([warning, clear]);

    await service.refreshSafeToTouch(projectId, actor);
    const created = prisma.fdeReadinessFinding.upsert.mock.calls.map((call: any[]) => call[0].create);
    expect(created).toEqual(expect.arrayContaining([
      expect.objectContaining({ findingType: "safe_to_touch", findingSubType: "yellow", targetRef: "src/api/todos.ts" }),
      expect.objectContaining({ findingType: "safe_to_touch", findingSubType: "green", targetRef: "src/api/health.ts" })
    ]));
    await expect(service.getSafeToTouchForFile(projectId, actor, "src/missing.ts")).resolves.toMatchObject({
      item: expect.objectContaining({ status: "unknown" }),
      truthMutationAllowed: false
    });
  });

  it("creates rationale traces with evidence/decision hops and redacts secret-like excerpts", async () => {
    const secretSummary = "Billing route from PR. OPENAI_API_KEY=sk-1234567890abcdefghijklmnopqrst";
    const evidence = [evidenceItem({ id: "ev-pr", filePath: "src/api/billing.ts", sourceSubType: "pull_request", summary: secretSummary, sourceUrl: "https://github.com/acme/app/pull/7" })];
    const { service, prisma } = createService(evidence, {
      fdeRationaleTrace: {
        create: vi.fn().mockResolvedValue({ id: "trace-1" }),
        findFirst: vi.fn().mockImplementation(async () => ({
          id: "trace-1",
          projectId,
          anchorType: "file",
          anchorRef: "src/api/billing.ts",
          status: "complete",
          overallConfidence: "exact_link",
          summary: "Trace",
          citationsJson: [],
          openTargetsJson: [],
          limitationsJson: [],
          warningsJson: [],
          hops: prisma.fdeRationaleTraceHop.create.mock.calls.map((call: any[]) => ({ id: `hop-${call[0].data.hopOrder}`, ...call[0].data }))
        }))
      }
    });

    const result = await service.createRationaleTrace(projectId, actor, { anchorType: "file", anchorRef: "src/api/billing.ts", includeWeakSemantic: false });
    expect(result).toMatchObject({ projectId, truthMutationAllowed: false, readOnly: true });
    expect(prisma.fdeRationaleTraceHop.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ hopType: "pull_request", confidence: "exact_link" })
    }));
    const persisted = JSON.stringify(prisma.fdeRationaleTraceHop.create.mock.calls);
    expect(persisted).not.toContain("sk-1234567890");
    expect(persisted).toContain("[redacted]");
  });

  it("creates decision engineering links only for existing accepted decisions", async () => {
    const { service, prisma } = createService();

    const created = await service.createDecisionEngineeringLink(projectId, actor, {
      decisionId: "33333333-3333-4333-8333-333333333333",
      targetType: "file",
      targetRef: "src/api/billing.ts",
      relationshipType: "implements_decision",
      confidence: "manual_linked",
      evidenceIds: [],
      citations: [],
      openTargets: [],
      limitations: [],
      metadata: {}
    });

    expect(created).toMatchObject({ truthMutationAllowed: false, decisionId: "33333333-3333-4333-8333-333333333333" });
    expect(prisma.decisionRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "accepted" })
    }));
  });

  it("rejects cross-project or nonexistent evidence IDs in decision links", async () => {
    const { service, prisma } = createService();
    const missingEvidenceId = "44444444-4444-4444-8444-444444444444";

    await expect(service.createDecisionEngineeringLink(projectId, actor, {
      decisionId: "33333333-3333-4333-8333-333333333333",
      targetType: "file",
      targetRef: "src/api/billing.ts",
      relationshipType: "implements_decision",
      confidence: "manual_linked",
      evidenceIds: [missingEvidenceId],
      citations: [],
      openTargets: [],
      limitations: [],
      metadata: {}
    })).rejects.toMatchObject({ code: "decision_evidence_invalid", statusCode: 400 });
    expect(prisma.fdeDecisionEngineeringLink.upsert).not.toHaveBeenCalled();
  });

  it("orders listed findings by readiness severity before recency", async () => {
    const older = new Date("2026-05-23T00:00:00Z");
    const newer = new Date("2026-05-24T00:00:00Z");
    const row = (id: string, severity: string, updatedAt: Date) => ({
      id,
      projectId,
      findingType: "conflict",
      findingSubType: "overlapping_edit",
      findingKey: id,
      targetKind: "file",
      targetRef: `src/${id}.ts`,
      status: "active",
      severity,
      confidence: "high",
      summary: id,
      whyItMatters: null,
      suggestedAction: null,
      sourceDomainsJson: ["github"],
      evidenceIdsJson: [],
      affectedJson: {},
      actorsJson: [],
      citationsJson: [],
      openTargetsJson: [],
      reasonsJson: [],
      limitationsJson: [],
      warningsJson: [],
      updatedAt
    });
    const { service, prisma } = createService([], {
      fdeReadinessFinding: {
        upsert: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          row("recent-watch", "watch", newer),
          row("old-blocking", "blocking", older),
          row("recent-info", "info", newer)
        ])
      }
    });

    const result = await service.listConflicts(projectId, actor, { limit: 3 });

    expect(prisma.fdeReadinessFinding.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 15 }));
    expect(result.items.map((item: any) => item.severity)).toEqual(["blocking", "watch", "info"]);
  });

  it("fails disabled mode and does not call Product Brain, Live Doc, proposal, or GitHub write services", async () => {
    const { service, prisma } = createService([], {});
    (service as any).env.FDE_READINESS_INTELLIGENCE_ENABLED = false;

    await expect(service.refreshAll(projectId, actor)).rejects.toMatchObject(new AppError(403, "FDE readiness intelligence is disabled", "fde_readiness_disabled"));
    expect(prisma.fdeReadinessRun.create).not.toHaveBeenCalled();
  });

  it("excludes hidden provider evidence in MVP mode without leaking provider names", async () => {
    const hidden = evidenceItem({ id: "ev-hidden", provider: "slack", sourceType: "slack", filePath: "src/api/billing.ts", pullRequestNumber: 10 });
    const visible = evidenceItem({ id: "ev-visible", provider: "github", sourceType: "github", filePath: "src/api/billing.ts", pullRequestNumber: 11 });
    const { service, prisma, auditService } = createService([hidden, visible]);
    (service as any).env.MVP_MODE = true;

    await service.refreshAll(projectId, actor);
    const serializedFindings = JSON.stringify(prisma.fdeReadinessFinding.upsert.mock.calls);
    expect(serializedFindings).not.toContain("slack");
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "readiness_intelligence.disabled_provider_evidence_excluded",
      payload: { excludedCount: 1 }
    }));
  });
});

function evidenceItem(overrides: Record<string, unknown>) {
  return {
    id: "ev",
    orgId: actor.orgId,
    projectId,
    provider: "github",
    sourceType: "github",
    sourceSubType: "changed_file",
    repositoryLinkId: "repo-link-1",
    repositoryOwner: "acme",
    repositoryName: "app",
    branch: null,
    sha: "abc123",
    pullRequestNumber: null,
    filePath: null,
    routeMethod: null,
    routePath: null,
    environment: null,
    actorGithubLogin: "octocat",
    mappedUserId: null,
    occurredAt: new Date("2026-05-24T00:00:00Z"),
    status: "active",
    confidence: "medium",
    severity: null,
    sourceUrl: "https://github.com/acme/app",
    providerRawId: "raw",
    title: null,
    summary: null,
    citationJson: { source: "github" },
    openTargetJson: { targetType: "github" },
    metadataJson: {},
    archivedAt: null,
    createdAt: new Date("2026-05-24T00:00:00Z"),
    updatedAt: new Date("2026-05-24T00:00:00Z"),
    ...overrides
  };
}
