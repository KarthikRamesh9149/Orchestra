import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDeepResearchSources,
  collectExplicitDeepResearchSourceCards,
  DeepResearchService,
  filterCardsBySources,
  groundDeepResearchOutput
} from "../src/modules/deep-research/service.js";

const now = new Date("2026-08-20T00:00:00.000Z");
const results = {
  executiveSummary: "Authoritative report",
  findings: [],
  marketContext: [],
  expansionOpportunities: [],
  recommendedActions: [],
  stats: { totalSources: 1, slackMessages: 0, commits: 0, docs: 1, webSources: 0, duration: "2s" },
  sources: [{ provider: "Documents", label: "Product brief", kind: "internal", href: "/memory" }]
};

function createService() {
  const run = {
    id: "11111111-1111-4111-8111-111111111111",
    orgId: "22222222-2222-4222-8222-222222222222",
    projectId: "33333333-3333-4333-8333-333333333333",
    createdByUserId: "44444444-4444-4444-8444-444444444444",
    researchFocus: "release readiness",
    sourcesJson: ["docs"],
    outputFormat: "full_report",
    privacyMode: "internal_only",
    webSearchRequested: false,
    webSearchUsed: false,
    status: "completed",
    progressPercent: 100,
    progressStage: "completed",
    resultsJson: results,
    statsJson: results.stats,
    estimatedCostUsd: null,
    errorMessage: null,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now
  };
  const prisma = {
    deepResearchRun: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ ...run, status: "queued", progressPercent: 0, progressStage: "queued", resultsJson: null, completedAt: null }),
      findUnique: vi.fn().mockResolvedValue(run),
      update: vi.fn().mockResolvedValue(run),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    projectContextEntry: {
      upsert: vi.fn().mockResolvedValue({ id: "55555555-5555-4555-8555-555555555555", createdAt: now })
    },
    $executeRaw: vi.fn().mockResolvedValue(1)
  } as any;
  prisma.$transaction = vi.fn(async (callback: (tx: any) => unknown) => callback(prisma));
  const projectService = {
    ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager" }),
    ensureProjectMemberCanManageTeamContext: vi.fn().mockResolvedValue({ projectRole: "manager" })
  } as any;
  const jobs = { enqueue: vi.fn().mockResolvedValue(undefined) } as any;
  const audit = { record: vi.fn().mockResolvedValue(undefined) } as any;
  const service = new DeepResearchService(
    prisma,
    { BETA_DEEP_RESEARCH_ENABLED: true, DEEP_RESEARCH_MONTHLY_LIMIT: 20 } as any,
    {} as any,
    {} as any,
    {} as any,
    projectService,
    audit,
    {} as any,
    jobs
  );
  return { service, prisma, projectService, jobs, audit, run };
}

describe("[FIX-22] Deep Research authoritative contracts", () => {
  afterEach(() => vi.useRealTimers());

  it("[LR-01] keeps a healthy owner alive through pending work and fences a late failure", async () => {
    vi.useFakeTimers();
    const { service, prisma, run } = createService();
    const state: any = { ...run, status: "queued", completedAt: null, leaseOwnerToken: null, leaseExpiresAt: null };
    prisma.deepResearchRun.findUnique.mockImplementation(async () => ({ ...state }));
    prisma.deepResearchRun.updateMany.mockImplementation(async ({ where, data }: any) => {
      if (where.status !== state.status || (where.leaseOwnerToken && where.leaseOwnerToken !== state.leaseOwnerToken)
        || (where.leaseExpiresAt?.gt && !(state.leaseExpiresAt > where.leaseExpiresAt.gt))
        || (where.leaseExpiresAt?.lte && !(state.leaseExpiresAt <= where.leaseExpiresAt.lte))) return { count: 0 };
      Object.assign(state, data); return { count: 1 };
    });
    let rejectProvider!: (error: Error) => void;
    prisma.project = { findUniqueOrThrow: () => new Promise((_resolve, reject) => { rejectProvider = reject; }) };
    const working = service.runResearchJob(run.projectId, run.id, run.createdByUserId);
    await vi.advanceTimersByTimeAsync(180000);
    expect(state.status).toBe("running");
    expect(state.leaseExpiresAt.getTime()).toBeGreaterThan(Date.now());
    const healthy = await service.getRun(run.projectId, run.id, { userId: run.createdByUserId, orgId: run.orgId });
    expect(healthy.status).toBe("running");
    // Simulate an owner losing its lease while the external call remains pending.
    state.status = "failed"; state.errorMessage = "Reconciled interruption"; state.leaseOwnerToken = null;
    rejectProvider(new Error("late provider failure must not overwrite recovery"));
    await working;
    expect(state.errorMessage).toBe("Reconciled interruption");
    expect(state.status).toBe("failed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[LR-01] polling makes an expired owned research run explicitly failed", async () => {
    const { service, prisma, run } = createService();
    const abandoned = { ...run, status: "running", completedAt: null, resultsJson: null,
      leaseOwnerToken: "55555555-5555-4555-8555-555555555555", leaseExpiresAt: new Date(Date.now() - 1000) };
    prisma.deepResearchRun.findUnique.mockImplementation(async () => abandoned);
    prisma.deepResearchRun.updateMany.mockImplementation(async ({ where, data }: any) => {
      if (where.status === "running" && where.leaseExpiresAt.lte >= abandoned.leaseExpiresAt) {
        Object.assign(abandoned, data); return { count: 1 };
      }
      return { count: 0 };
    });
    const result = await service.getRun(run.projectId, run.id, { userId: run.createdByUserId, orgId: run.orgId });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/interrupt|restart|again/i);
    expect(result.results).toBeNull();
  });

  it("[LR-01] a retry cannot report success while a healthy owner is still running", async () => {
    const { service, prisma, run } = createService();
    prisma.deepResearchRun.findUnique.mockResolvedValue({ ...run, status: "running", completedAt: null,
      leaseOwnerToken: "55555555-5555-4555-8555-555555555555", leaseExpiresAt: new Date(Date.now() + 120000) });
    await expect(service.runResearchJob(run.projectId, run.id, run.createdByUserId)).rejects.toThrow(/running|owned|active/i);
    expect(prisma.deepResearchRun.update).not.toHaveBeenCalled();
  });

  it("[R10] cannot resurrect a run failed by polling after the worker's read", async () => {
    const { service, prisma, run } = createService();
    prisma.deepResearchRun.findUnique.mockResolvedValue({ ...run, status: "queued" });
    // The database CAS loses to the poller's queued -> failed transition.
    prisma.deepResearchRun.updateMany.mockResolvedValue({ count: 0 });
    await service.runResearchJob(run.projectId, run.id, run.createdByUserId);
    expect(prisma.deepResearchRun.update).not.toHaveBeenCalled();
    expect(prisma.deepResearchRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: run.id, projectId: run.projectId, status: "queued" },
      data: expect.objectContaining({ status: "running" })
    }));
  });

  it("persists explicit privacy, web choice, and initial real progress", async () => {
    const { service, prisma } = createService();
    const created = await service.startRun(
      "33333333-3333-4333-8333-333333333333",
      { userId: "44444444-4444-4444-8444-444444444444", orgId: "22222222-2222-4222-8222-222222222222" },
      { researchFocus: "market readiness", sources: ["docs", "web"], outputFormat: "full_report", privacyMode: "internal_plus_web", webSearchEnabled: true }
    );

    expect(prisma.deepResearchRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      privacyMode: "internal_plus_web",
      webSearchRequested: true,
      progressPercent: 0,
      progressStage: "queued"
    }) });
    expect(created.progress).toEqual({ percent: 0, stage: "queued" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("counts failed attempts against the monthly quota", async () => {
    const { service, prisma } = createService();
    await service.getUsage(
      "33333333-3333-4333-8333-333333333333",
      { userId: "44444444-4444-4444-8444-444444444444", orgId: "22222222-2222-4222-8222-222222222222" }
    );
    const where = prisma.deepResearchRun.count.mock.calls.at(-1)?.[0].where;
    expect(where).toEqual(expect.objectContaining({ projectId: "33333333-3333-4333-8333-333333333333" }));
    expect(where).not.toHaveProperty("status");
    expect(where.NOT).toEqual({ status: "failed", startedAt: null });
  });

  it("persists a retryable domain failure when dispatch is rejected", async () => {
    const { service, prisma, jobs, run } = createService();
    prisma.deepResearchRun.updateMany = vi.fn().mockResolvedValue({ count: 1 });
    jobs.enqueue.mockRejectedValue(new Error("Queue unavailable"));
    await service.startRun(run.projectId, { userId: run.createdByUserId, orgId: run.orgId }, {
      researchFocus: "release readiness", sources: ["docs"], outputFormat: "full_report", privacyMode: "internal_only", webSearchEnabled: false
    });
    await vi.waitFor(() => expect(prisma.deepResearchRun.updateMany).toHaveBeenCalledWith({
      where: { id: run.id, projectId: run.projectId, status: "queued" },
      data: expect.objectContaining({ status: "failed", progressStage: "failed", errorMessage: expect.stringContaining("Start research again") })
    }));
  });

  it("returns the queued run without waiting for inline research execution", async () => {
    const { service, jobs } = createService();
    let finishJob!: () => void;
    jobs.enqueue.mockReturnValueOnce(new Promise<void>((resolve) => { finishJob = resolve; }));

    const started = service.startRun(
      "33333333-3333-4333-8333-333333333333",
      { userId: "44444444-4444-4444-8444-444444444444", orgId: "22222222-2222-4222-8222-222222222222" },
      { researchFocus: "release readiness", sources: ["docs"], outputFormat: "full_report", privacyMode: "internal_only", webSearchEnabled: false }
    );

    await expect(Promise.race([
      started,
      new Promise((_, reject) => setTimeout(() => reject(new Error("startRun waited for inline execution")), 100))
    ])).resolves.toEqual(expect.objectContaining({ status: "queued" }));
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    finishJob();
  });

  it("saves one idempotent, manager-authorized Memory artifact and returns its destination", async () => {
    const { service, prisma, projectService } = createService();
    const actor = { userId: "44444444-4444-4444-8444-444444444444", orgId: "22222222-2222-4222-8222-222222222222" };
    const saved = await service.addToMemory("33333333-3333-4333-8333-333333333333", "11111111-1111-4111-8111-111111111111", actor);
    const retried = await service.addToMemory("33333333-3333-4333-8333-333333333333", "11111111-1111-4111-8111-111111111111", actor);

    expect(projectService.ensureProjectMemberCanManageTeamContext).toHaveBeenCalledTimes(2);
    expect(prisma.projectContextEntry.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { deepResearchRunId: "11111111-1111-4111-8111-111111111111" },
      create: expect.objectContaining({ deepResearchRunId: "11111111-1111-4111-8111-111111111111", source: "generated" })
    }));
    expect(retried.memoryEntryId).toBe(saved.memoryEntryId);
    expect(saved.destination.route).toBe("/memory/context/55555555-5555-4555-8555-555555555555");
  });

  it("projects clickable source labels without exposing raw chunk identifiers", () => {
    const projected = buildDeepResearchSources([
      {
        evidenceId: "chunk-secret",
        sourceType: "document_chunk",
        title: "Product brief",
        excerpt: "Evidence",
        whySelected: "match",
        confidence: 0.9,
        sourcePrecedence: "uploaded_document",
        citationRef: { type: "document_chunk", id: "chunk-secret", label: "Product brief 66666666-6666-4666-8666-666666666666" },
        openTarget: { targetType: "document_section", targetRef: { documentId: "77777777-7777-4777-8777-777777777777" } },
        trace: {}
      }
    ] as any, [{ title: "Public benchmark", url: "https://example.com/report", snippet: "Public" }]);

    expect(projected).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Product brief", href: "/memory/docs/77777777-7777-4777-8777-777777777777/view" }),
      expect.objectContaining({ label: "Public benchmark", href: "https://example.com/report" })
    ]));
    expect(JSON.stringify(projected)).not.toContain("chunk-secret");
    expect(projected[0].label).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
  });

  it("treats selected Communications and GitHub sources as retrieval instructions", async () => {
    const prisma = {
      communicationMessageChunk: {
        findMany: vi.fn().mockResolvedValue([{
          id: "comm-chunk-1",
          messageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          threadId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          provider: "fireflies_ai",
          content: "Pilot readiness review requires a live walkthrough before onboarding.",
          contextualContent: null,
          lexicalContent: "pilot readiness live walkthrough onboarding",
          message: { senderLabel: "Product lead", providerPermalink: null },
          thread: { subject: "Pilot readiness review", rawMetadataJson: {} },
          connector: { accountLabel: "Fireflies QA" }
        }])
      },
      gitHubEngineeringEvidence: {
        findMany: vi.fn().mockResolvedValue([{
          id: "github-evidence-1",
          projectId: "33333333-3333-4333-8333-333333333333",
          evidenceType: "github_commit",
          title: "Fix beta onboarding reliability",
          summary: "Release readiness fixes for the beta pilot",
          repositoryOwner: "orchestra",
          repositoryName: "app",
          branch: "mvp-beta-beta",
          sha: "abcdef1",
          status: "success",
          sourceUrl: "https://github.com/orchestra/app/commit/abcdef1",
          mappedUser: null
        }])
      }
    } as any;

    const cards = await collectExplicitDeepResearchSourceCards(
      prisma,
      {} as any,
      "33333333-3333-4333-8333-333333333333",
      "five-customer beta pilot readiness",
      new Set(["docs", "slack", "github"])
    );

    expect(prisma.communicationMessageChunk.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ projectId: "33333333-3333-4333-8333-333333333333" })
    }));
    expect(prisma.gitHubEngineeringEvidence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ projectId: "33333333-3333-4333-8333-333333333333", evidenceStatus: "active" })
    }));
    expect(cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: "communication_message", title: expect.stringContaining("Fireflies.ai") }),
      expect.objectContaining({ sourceType: "github_evidence", openTarget: expect.objectContaining({ targetType: "github_evidence" }) })
    ]));
  });

  it("does not present unrelated recent communication or GitHub rows as matching evidence", async () => {
    const prisma = {
      communicationMessageChunk: {
        findMany: vi.fn().mockResolvedValue([{
          id: "comm-unrelated",
          messageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          threadId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          provider: "slack",
          content: "Lunch menu and office coffee order.",
          contextualContent: null,
          lexicalContent: "lunch menu office coffee",
          message: { senderLabel: "Office", providerPermalink: null },
          thread: { subject: "Social", rawMetadataJson: {} },
          connector: { accountLabel: "Slack" }
        }])
      },
      gitHubEngineeringEvidence: {
        findMany: vi.fn().mockResolvedValue([{
          id: "github-unrelated",
          evidenceType: "github_commit",
          title: "Update icon padding",
          summary: "Cosmetic icon adjustment",
          repositoryOwner: "orchestra",
          repositoryName: "app",
          branch: "main",
          sha: "abcdef1",
          status: "success",
          sourceUrl: null,
          mappedUser: null
        }])
      }
    } as any;

    const cards = await collectExplicitDeepResearchSourceCards(
      prisma,
      { MVP_ENABLED_COMMUNICATION_PROVIDERS: ["slack"] } as any,
      "33333333-3333-4333-8333-333333333333",
      "enterprise authentication threat model",
      new Set(["slack", "github"])
    );

    expect(cards).toEqual([]);
    expect(JSON.stringify(cards)).not.toContain("recent-source fallback");
  });

  it("uses recall-preserving content terms for complete-corpus communication and GitHub search", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      communicationMessageChunk: { findMany: vi.fn().mockResolvedValue([]) },
      gitHubEngineeringEvidence: { findMany: vi.fn().mockResolvedValue([]) }
    } as any;

    await collectExplicitDeepResearchSourceCards(
      prisma,
      { MVP_ENABLED_COMMUNICATION_PROVIDERS: ["slack"] } as any,
      "33333333-3333-4333-8333-333333333333",
      "What did Slack say about OAuth replay in GitHub evidence?",
      new Set(["slack", "github"])
    );

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    for (const [sql] of prisma.$queryRaw.mock.calls as Array<[{ values: unknown[] }]>) {
      expect(sql.values).toEqual(expect.arrayContaining(["oauth OR replay"]));
    }
  });

  it("fails closed for unclassified source domains", () => {
    const cards = filterCardsBySources([{
      evidenceId: "unknown-1",
      sourceType: "mystery_provider_payload",
      title: "Unknown",
      excerpt: "Should not leak into a selected-source report",
      whySelected: "unknown",
      confidence: 0.5,
      sourcePrecedence: "unknown",
      trace: {}
    } as any], new Set(["docs"]));
    expect(cards).toEqual([]);
  });

  it("drops findings and actions whose claimed citations do not resolve", () => {
    const grounded = groundDeepResearchOutput({
      executiveSummary: "Claimed summary",
      findings: [
        { category: "RISK", severity: "HIGH", title: "Grounded", description: "Supported", sources: "E1" },
        { category: "RISK", severity: "HIGH", title: "Invented", description: "Unsupported", sources: "E99" }
      ],
      marketContext: [],
      expansionOpportunities: [],
      recommendedActions: [
        { priority: "THIS WEEK", action: "Grounded action", source: "E1" },
        { priority: "THIS WEEK", action: "Invented action", source: "W22" }
      ]
    }, [{ evidenceId: "e1" } as any], []);
    expect(grounded.findings).toEqual([expect.objectContaining({ title: "Grounded", sources: "E1" })]);
    expect(grounded.recommendedActions).toEqual([expect.objectContaining({ action: "Grounded action", source: "E1" })]);
  });

  it("ships the additive progress, privacy, and one-run-one-artifact migration", () => {
    const sql = readFileSync(resolve("prisma/migrations/20260820103000_deep_research_truth_contract/migration.sql"), "utf8");
    expect(sql).toContain('"privacy_mode"');
    expect(sql).toContain('"progress_percent"');
    expect(sql).toContain('"deep_research_run_id"');
    expect(sql).toContain("CREATE UNIQUE INDEX");
  });

  it("ships the evidence-backed GitHub full-text index used by complete-corpus retrieval", () => {
    const sql = readFileSync(resolve("prisma/migrations/20260823090000_socrates_full_corpus_github_search/migration.sql"), "utf8");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS");
    expect(sql).toContain("github_engineering_evidence_lexical_content_idx");
    expect(sql).toContain("to_tsvector");
  });
});
