import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import type { AppEnv } from "../../config/env.js";
import type { EmbeddingProvider, GenerationProvider } from "../../lib/ai/provider.js";
import { estimateAiCost, getModelForTask, pricingFromEnv, type AiLimiter } from "../../lib/ai-ops/index.js";
import { classifyIntent } from "../../lib/retrieval/intent.js";
import { buildRetrievalPlan, domainsFromPlan } from "../../lib/retrieval/planner.js";
import { hybridRetrieveDetailed } from "../../lib/retrieval/hybrid.js";
import { estimateTokens, type EvidenceCard } from "../../lib/retrieval/evidence-pack.js";
import { buildRecallPreservingWebsearchQuery, lexicalScore } from "../../lib/retrieval/lexical.js";
import type { RetrievalIntent } from "../../lib/retrieval/types.js";
import type { SearchProvider, SearchResult } from "../../lib/search/index.js";
import { JobNames } from "../../lib/jobs/types.js";
import type { JobDispatcher } from "../../lib/jobs/types.js";
import { jobKeys } from "../../lib/jobs/keys.js";
import { enqueueJobInBackground } from "../../lib/jobs/background-dispatch.js";
import { getMvpEnabledCommunicationProviders } from "../../lib/mvp/policy.js";
import type { AuditService } from "../audit/service.js";
import type { ProjectService } from "../projects/service.js";
import { buildDeepResearchEvidencePack } from "./evidence.js";
import { renderReportMarkdown, renderReportPdf } from "./report-render.js";
import { DEEP_RESEARCH_SYSTEM_PROMPT, buildDeepResearchUserPrompt, buildWebQueries } from "./prompts.js";
import {
  deepResearchLlmSchema,
  deepResearchStructuredSchema,
  deepResearchResultsSchema,
  type DeepResearchSource,
  type DeepResearchResults,
  type DeepResearchStats,
  type StartDeepResearchInput
} from "./schemas.js";

type Actor = { userId: string; orgId: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const RESEARCH_LEASE_MS = 120_000;
const RESEARCH_HEARTBEAT_MS = 20_000;

export class DeepResearchService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly generationProvider: GenerationProvider,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly searchProvider: SearchProvider,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly aiLimiter: AiLimiter,
    private readonly jobs: JobDispatcher
  ) {}

  private assertEnabled() {
    if (!this.env.BETA_DEEP_RESEARCH_ENABLED) {
      throw new AppError(403, "Deep Research is disabled", "feature_disabled");
    }
  }

  async getUsage(projectId: string, actor: Actor) {
    this.assertEnabled();
    await this.projectService.ensureProjectAccess(projectId, actor.userId);
    return this.computeUsage(projectId);
  }

  private async computeUsage(projectId: string) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const used = await this.prisma.deepResearchRun.count({
      where: {
        projectId,
        NOT: { status: "failed", startedAt: null },
        createdAt: { gte: monthStart, lt: nextMonth }
      }
    });
    return {
      used,
      limit: this.env.DEEP_RESEARCH_MONTHLY_LIMIT,
      resetLabel: `${MONTHS[nextMonth.getUTCMonth()]} ${nextMonth.getUTCDate()}`
    };
  }

  async startRun(projectId: string, actor: Actor, input: StartDeepResearchInput) {
    this.assertEnabled();
    await this.projectService.ensureProjectAccess(projectId, actor.userId);

    if (this.env.RUNTIME_PROFILE === 'desktop-local' && !this.env.OPENAI_API_KEY) throw new AppError(409, 'Configure desktop AI before starting research. No run was created or charged. Offline document reading and search remain available.', 'ai_not_configured');

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const resetLabel = `${MONTHS[nextMonth.getUTCMonth()]} ${nextMonth.getUTCDate()}`;
    const run = await this.prisma.$transaction(async (tx) => {
      // Serialize quota allocation per project/month so concurrent requests cannot
      // both observe the same remaining slot.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`deep-research:${projectId}:${monthStart.toISOString()}`}, 0))`);
      const used = await tx.deepResearchRun.count({
        where: { projectId, NOT: { status: "failed", startedAt: null }, createdAt: { gte: monthStart, lt: nextMonth } }
      });
      if (used >= this.env.DEEP_RESEARCH_MONTHLY_LIMIT) {
        throw new AppError(429, "Monthly Deep Research limit reached", "deep_research_limit_reached", { resetLabel });
      }
      return tx.deepResearchRun.create({
        data: {
          orgId: actor.orgId,
          projectId,
          createdByUserId: actor.userId,
          researchFocus: input.researchFocus,
          sourcesJson: input.sources as Prisma.InputJsonValue,
          outputFormat: input.outputFormat,
          privacyMode: input.privacyMode,
          webSearchRequested: input.webSearchEnabled,
          status: "queued",
          progressPercent: 0,
          progressStage: "queued"
        }
      });
    });

    await this.audit("deep_research.run_started", projectId, actor.orgId, actor.userId, { runId: run.id });
    enqueueJobInBackground(
      this.prisma,
      this.jobs,
      JobNames.deepResearchRun,
      { projectId, runId: run.id, actorUserId: actor.userId },
      jobKeys.deepResearchRun(projectId, run.id),
      () => this.prisma.deepResearchRun.updateMany({
        where: { id: run.id, projectId, status: "queued" },
        data: { status: "failed", progressStage: "failed", errorMessage: "Research could not be queued. Start research again; this attempt does not use your quota.", completedAt: new Date() }
      })
    );

    return this.toDto(run);
  }

  async getRun(projectId: string, runId: string, actor: Actor) {
    this.assertEnabled();
    await this.projectService.ensureProjectAccess(projectId, actor.userId);
    let run = await this.loadRun(projectId, runId);
    if (run.status === "running" && run.leaseExpiresAt && run.leaseExpiresAt.getTime() <= Date.now()) {
      await this.failExpiredRun(projectId, runId);
      run = await this.loadRun(projectId, runId);
    }
    // Also covers an API crash between committing the run and dispatching it.
    // CAS cannot clobber a worker that already claimed the run.
    if (run.status === "queued" && Date.now() - run.createdAt.getTime() > 5 * 60_000) {
      await this.prisma.deepResearchRun.updateMany({ where: { id: runId, projectId, status: "queued" }, data: {
        status: "failed", progressStage: "failed", completedAt: new Date(), errorMessage: "Research did not start within five minutes. Start research again; this attempt does not use your quota."
      } });
      run = await this.loadRun(projectId, runId);
    }
    return this.toDto(run);
  }

  async runResearchJob(projectId: string, runId: string, actorUserId: string | null) {
    let run = await this.prisma.deepResearchRun.findUnique({ where: { id: runId } });
    if (!run || run.projectId !== projectId) return;
    if (run.status === "running") {
      await this.failExpiredRun(projectId, runId);
      run = await this.prisma.deepResearchRun.findUnique({ where: { id: runId } });
      if (!run || run.projectId !== projectId) return;
      // A duplicate/retry is not successful work while another owner is active.
      // Legacy unleased runs also require explicit reconciliation, not an age reset.
      if (run.status === "running") throw new Error("Deep Research is still running under another active owner");
    }
    if (run.status !== "queued") return;

    const ownerToken = randomUUID();
    const claimed = await this.prisma.deepResearchRun.updateMany({
      where: { id: runId, projectId, status: "queued" },
      data: { status: "running", startedAt: run.startedAt ?? new Date(), progressPercent: 10, progressStage: "retrieving_evidence",
        leaseOwnerToken: ownerToken, leaseExpiresAt: new Date(Date.now() + RESEARCH_LEASE_MS) }
    });
    if (claimed.count !== 1) {
      const current = await this.prisma.deepResearchRun.findUnique({ where: { id: runId } });
      if (current?.status === "running") throw new Error("Deep Research is already running under another active owner");
      return;
    }
    const startedAtMs = (run.startedAt ?? new Date()).getTime();
    let leaseLost = false;
    let heartbeatPending: Promise<void> | null = null;
    const heartbeat = setInterval(() => {
      if (heartbeatPending || leaseLost) return;
      heartbeatPending = this.prisma.deepResearchRun.updateMany({
        where: this.ownedRun(runId, ownerToken),
        data: { leaseExpiresAt: new Date(Date.now() + RESEARCH_LEASE_MS) }
      }).then(({ count }) => { if (count !== 1) leaseLost = true; })
        .catch(() => { leaseLost = true; })
        .finally(() => { heartbeatPending = null; });
    }, RESEARCH_HEARTBEAT_MS);
    heartbeat.unref();
    const progress = async (percent: number, stage: string) => {
      if (leaseLost) throw new Error("Deep Research worker ownership was lost; start research again");
      await this.updateProgress(runId, ownerToken, percent, stage);
    };

    try {
      const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
      const focus = run.researchFocus;
      const sources = ((run.sourcesJson as unknown as string[]) ?? []).filter(Boolean);
      const wantWeb = run.webSearchRequested && run.privacyMode === "internal_plus_web" && sources.includes("web");

      // 1-3. internal evidence retrieval (reuse Socrates pipeline)
      const intent = classifyIntent(focus);
      const retrievalPlan = buildRetrievalPlan({
        intent,
        pageContext: "dashboard_general",
        selectedRefType: null,
        selectedRefId: null,
        viewerState: null,
        isClientContext: false,
        retrievalTopK: this.env.SOCRATES_RETRIEVAL_TOP_K,
        rerankTopK: this.env.SOCRATES_RERANK_TOP_K
      });
      const domains = domainsFromPlan(retrievalPlan);
      const queryEmbedding = await this.embeddingProvider.embedText(focus);
      const retrieval = await hybridRetrieveDetailed(this.prisma, this.embeddingProvider, project.orgId, {
        projectId,
        pageContext: "dashboard_general",
        query: focus,
        queryEmbedding,
        intent,
        domains,
        topK: this.env.SOCRATES_RETRIEVAL_TOP_K,
        minScore: this.env.RETRIEVAL_MIN_SCORE,
        isClientContext: false,
        acceptedTruthBoost: this.env.RETRIEVAL_ACCEPTED_TRUTH_BOOST,
        docWeight: this.env.RETRIEVAL_DOC_WEIGHT,
        commWeight: this.env.RETRIEVAL_COMM_WEIGHT,
        plan: retrievalPlan
      });
      assertDeepResearchRetrievalAvailable(retrieval);
      const pack = buildDeepResearchEvidencePack({
        candidates: retrieval.candidates,
        userQuery: focus,
        recentHistory: [],
        intent: intent as RetrievalIntent,
        isClientContext: false,
        budget: {
          maxContextTokens: this.env.SOCRATES_MAX_CONTEXT_TOKENS,
          maxHistoryTurns: 0,
          rerankTopK: this.env.SOCRATES_RERANK_TOP_K,
          maxEvidenceItems: this.env.SOCRATES_MAX_EVIDENCE_ITEMS,
          maxEvidenceExcerptChars: this.env.SOCRATES_MAX_EVIDENCE_EXCERPT_CHARS,
          maxSameSourceItems: this.env.SOCRATES_MAX_SAME_SOURCE_ITEMS,
          maxOutputTokens: this.env.SOCRATES_MAX_OUTPUT_TOKENS
        }
      });
      const selectedSources = new Set(sources);
      const explicitSourceCards = await collectExplicitDeepResearchSourceCards(
        this.prisma,
        this.env,
        projectId,
        focus,
        selectedSources
      );
      const cards = mergeDeepResearchCards(
        filterCardsBySources(pack.evidenceCards, selectedSources),
        explicitSourceCards,
        Math.max(this.env.SOCRATES_MAX_EVIDENCE_ITEMS, Math.min(16, selectedSources.size * 3)),
        focus
      );
      await progress(40, "evidence_ready");

      // 5. optional public web search (focus-derived queries only)
      let webResults: SearchResult[] = [];
      if (wantWeb && this.env.DEEP_RESEARCH_WEB_SEARCH_ENABLED) {
        await progress(50, "searching_public_web");
        const queries = buildWebQueries(focus, this.env.DEEP_RESEARCH_MAX_WEB_QUERIES);
        webResults = await this.searchProvider.search(queries, this.env.DEEP_RESEARCH_MAX_WEB_QUERIES * 3);
      }
      await progress(65, "preparing_synthesis");

      // 6. cost estimate + guard
      const prompt = buildDeepResearchUserPrompt({
        researchFocus: focus,
        outputFormat: run.outputFormat as StartDeepResearchInput["outputFormat"],
        sources: sources as StartDeepResearchInput["sources"],
        evidenceCards: cards,
        webResults
      });
      const inputTokens = estimateTokens(prompt);
      const outputTokens = 2200;
      const model = getModelForTask("socrates_answer", { intent, hardQuery: true, artifactGeneration: true }, this.env);
      const cost = estimateAiCost({ pricing: pricingFromEnv(this.env), modelTier: model.tier, inputTokens, outputTokens });
      const decision = await this.aiLimiter.checkDailyCost({
        key: `deep_research:project:${projectId}`,
        maxDailyCostUsd: this.env.DEEP_RESEARCH_MAX_COST_USD,
        addCostUsd: cost.totalCostUsd
      });
      if (decision && decision.allowed === false) {
        throw new AppError(429, "Deep Research cost budget exceeded", "deep_research_cost_exceeded");
      }

      // 7. synthesis
      await progress(75, "synthesizing_report");
      const llm = await this.generationProvider.generateObject({
        systemPrompt: DEEP_RESEARCH_SYSTEM_PROMPT,
        prompt,
        schema: this.env.RUNTIME_PROFILE === 'desktop-local' ? deepResearchStructuredSchema : deepResearchLlmSchema,
        model: model.model,
        maxOutputTokens: 4000,
        timeoutMs: 60_000,
        task: "socrates_answer",
        fallback: () => { throw new AppError(503, "Research synthesis was unavailable or returned an invalid report. Start research again; this is not evidence that your sources contain no answers.", "deep_research_synthesis_unavailable"); }
      });

      const stats = computeStats(cards, webResults, startedAtMs);
      const sourceItems = buildDeepResearchSources(cards, webResults);
      const grounded = groundDeepResearchOutput(llm, cards, webResults);
      const results: DeepResearchResults = deepResearchResultsSchema.parse({
        ...grounded,
        marketContext: wantWeb ? llm.marketContext : [],
        stats,
        sources: sourceItems
      });

      if (leaseLost) throw new Error("Deep Research worker ownership was lost; start research again");
      const completed = await this.prisma.deepResearchRun.updateMany({
        where: this.ownedRun(runId, ownerToken),
        data: {
          status: "completed",
          progressPercent: 100,
          progressStage: "completed",
          resultsJson: results as unknown as Prisma.InputJsonValue,
          statsJson: stats as unknown as Prisma.InputJsonValue,
          webSearchUsed: webResults.length > 0,
          estimatedCostUsd: cost.totalCostUsd,
          completedAt: new Date(),
          leaseOwnerToken: null,
          leaseExpiresAt: null
        }
      });
      if (completed.count !== 1) throw new Error("Deep Research worker ownership expired; start research again");
      await this.audit("deep_research.run_completed", projectId, project.orgId, actorUserId, {
        runId,
        findings: results.findings.length,
        webSearchUsed: webResults.length > 0
      });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Deep Research failed";
      const failed = await this.prisma.deepResearchRun.updateMany({
        where: { id: runId, projectId, status: "running", leaseOwnerToken: ownerToken },
        data: { status: "failed", progressPercent: 100, progressStage: "failed", errorMessage: message, completedAt: new Date(),
          leaseOwnerToken: null, leaseExpiresAt: null }
      });
      if (failed.count === 1) await this.audit("deep_research.run_failed", projectId, run.orgId, actorUserId, { runId, error: message });
      // swallow: failure is terminal for this run (avoids re-running expensive LLM on retry)
    } finally {
      clearInterval(heartbeat);
      if (heartbeatPending) await heartbeatPending;
    }
  }

  async addToMemory(projectId: string, runId: string, actor: Actor) {
    this.assertEnabled();
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actor.userId);
    const run = await this.loadRun(projectId, runId);
    if (run.status !== "completed" || !run.resultsJson) {
      throw new AppError(409, "Deep Research run is not complete", "deep_research_not_complete");
    }
    const results = deepResearchResultsSchema.parse(run.resultsJson);
    const markdown = renderReportMarkdown(run.researchFocus, results);
    const title = `Deep Research — ${run.researchFocus}`.slice(0, 200);
    const bodyHash = createHash("sha256").update(markdown).digest("hex");

    const entry = await this.prisma.projectContextEntry.upsert({
      where: { deepResearchRunId: runId },
      update: {},
      create: {
        orgId: run.orgId,
        projectId,
        deepResearchRunId: runId,
        type: "manual_note",
        title,
        body: markdown,
        participantsJson: [] as Prisma.InputJsonValue,
        tagsJson: ["deep-research"] as Prisma.InputJsonValue,
        importance: "normal",
        source: "generated",
        status: "active",
        bodyHash,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId
      }
    });

    await this.jobs.enqueue(
      JobNames.indexProjectContextEntry,
      { contextId: entry.id },
      jobKeys.indexProjectContextEntry(entry.id, bodyHash)
    );
    await this.audit("deep_research.added_to_memory", projectId, run.orgId, actor.userId, {
      runId,
      contextEntryId: entry.id
    });

    return {
      success: true,
      memoryEntryId: entry.id,
      createdAt: entry.createdAt.toISOString(),
      destination: {
        type: "project_context",
        route: `/memory/context/${entry.id}`,
        apiPath: `/v1/projects/${projectId}/context/${entry.id}`
      }
    };
  }

  async exportReport(projectId: string, runId: string, actor: Actor, format: "pdf" | "markdown") {
    this.assertEnabled();
    await this.projectService.ensureProjectAccess(projectId, actor.userId);
    const run = await this.loadRun(projectId, runId);
    if (run.status !== "completed" || !run.resultsJson) {
      throw new AppError(409, "Deep Research run is not complete", "deep_research_not_complete");
    }
    const results = deepResearchResultsSchema.parse(run.resultsJson);
    const safeName = run.researchFocus.replace(/[^a-z0-9]+/gi, "-").slice(0, 40).replace(/^-+|-+$/g, "") || "report";
    if (format === "markdown") {
      return {
        format: "markdown" as const,
        filename: `deep-research-${safeName}.md`,
        contentType: "text/markdown; charset=utf-8",
        body: renderReportMarkdown(run.researchFocus, results)
      };
    }
    const pdf = await renderReportPdf(run.researchFocus, results);
    return {
      format: "pdf" as const,
      filename: `deep-research-${safeName}.pdf`,
      contentType: "application/pdf",
      body: pdf
    };
  }

  private async loadRun(projectId: string, runId: string) {
    const run = await this.prisma.deepResearchRun.findUnique({ where: { id: runId } });
    if (!run || run.projectId !== projectId) {
      throw new AppError(404, "Deep Research run not found", "deep_research_not_found");
    }
    return run;
  }

  private toDto(run: {
    id: string;
    projectId: string;
    status: string;
    researchFocus: string;
    resultsJson: unknown;
    errorMessage: string | null;
    sourcesJson: unknown;
    outputFormat: string;
    privacyMode: string;
    webSearchRequested: boolean;
    webSearchUsed: boolean;
    progressPercent: number;
    progressStage: string;
    createdAt: Date;
    completedAt: Date | null;
  }) {
    return {
      id: run.id,
      projectId: run.projectId,
      status: run.status,
      researchFocus: run.researchFocus,
      sources: Array.isArray(run.sourcesJson) ? run.sourcesJson : [],
      outputFormat: run.outputFormat,
      privacyMode: run.privacyMode,
      webSearchRequested: run.webSearchRequested,
      webSearchUsed: run.webSearchUsed,
      progress: { percent: run.progressPercent, stage: run.progressStage },
      results: run.status === "completed" && run.resultsJson ? deepResearchResultsSchema.parse(run.resultsJson) : null,
      error: run.errorMessage ?? null,
      createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt ? run.completedAt.toISOString() : null
    };
  }

  private ownedRun(runId: string, ownerToken: string) {
    return { id: runId, status: "running" as const, leaseOwnerToken: ownerToken, leaseExpiresAt: { gt: new Date() } };
  }

  private async failExpiredRun(projectId: string, runId: string) {
    return this.prisma.deepResearchRun.updateMany({
      where: { id: runId, projectId, status: "running", leaseExpiresAt: { lte: new Date() } },
      data: { status: "failed", progressStage: "failed", completedAt: new Date(), leaseOwnerToken: null, leaseExpiresAt: null,
        errorMessage: "Research was interrupted because its worker stopped renewing ownership. Start research again." }
    });
  }

  private async updateProgress(runId: string, ownerToken: string, percent: number, stage: string) {
    const updated = await this.prisma.deepResearchRun.updateMany({
      where: this.ownedRun(runId, ownerToken),
      data: { progressPercent: percent, progressStage: stage, leaseExpiresAt: new Date(Date.now() + RESEARCH_LEASE_MS) }
    });
    if (updated.count !== 1) throw new Error("Deep Research worker ownership was lost; start research again");
  }

  private async audit(
    eventType: string,
    projectId: string,
    orgId: string,
    actorUserId: string | null,
    payload: Record<string, unknown>
  ) {
    await this.auditService.record({
      orgId,
      projectId,
      actorUserId: actorUserId ?? null,
      eventType,
      entityType: "deep_research_run",
      payload
    });
  }
}

export async function collectExplicitDeepResearchSourceCards(
  prisma: PrismaClient,
  env: AppEnv,
  projectId: string,
  focus: string,
  selected: Set<string>
): Promise<EvidenceCard[]> {
  const tasks: Array<Promise<EvidenceCard[]>> = [];
  if (selected.has("docs") && typeof prisma.document?.findMany === "function" && typeof prisma.documentChunk?.findMany === "function") {
    tasks.push(collectNamedDocumentCards(prisma, projectId, focus));
  }

  if (selected.has("slack")) {
    tasks.push(collectCommunicationCards(prisma, env, projectId, focus));
  }
  if (selected.has("github")) {
    tasks.push(collectGitHubCards(prisma, projectId, focus));
  }

  return (await Promise.all(tasks)).flat();
}

async function collectNamedDocumentCards(prisma: PrismaClient, projectId: string, focus: string): Promise<EvidenceCard[]> {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normalizedFocus = normalize(focus);
  const documents = await prisma.document.findMany({
    where: { projectId, archivedAt: null, currentVersionId: { not: null } },
    select: { id: true, title: true, currentVersionId: true }
  });
  const named = documents.filter(document => normalize(document.title).split(" ").length >= 2
    && normalizedFocus.includes(normalize(document.title)));
  if (!named.length) return [];
  const rows = await prisma.documentChunk.findMany({
    where: { projectId, documentVersionId: { in: named.map(document => document.currentVersionId!) },
      documentVersion: { status: { in: ["ready", "partial"] } } },
    include: { section: true, documentVersion: { include: { document: true } } },
    orderBy: { chunkIndex: "asc" }, take: 40
  });
  return rows.filter(row => row.parseRevision === row.documentVersion.parseRevision).slice(0, 8).map(row => ({
    evidenceId: `document:${row.id}`, sourceType: "document_chunk", title: row.documentVersion.document.title,
    excerpt: cleanExcerpt(row.content), whySelected: "Explicitly named current document source text",
    confidence: 0.9, sourcePrecedence: "source_evidence", trace: { documentChunkId: row.id },
    citationRef: { type: "document_chunk", id: row.id, label: row.documentVersion.document.title },
    openTarget: row.section ? { targetType: "document_section", targetRef: {
      documentId: row.documentVersion.document.id, documentVersionId: row.documentVersionId,
      anchorId: row.section.anchorId
    } } : undefined
  }));
}

async function collectCommunicationCards(
  prisma: PrismaClient,
  env: AppEnv,
  projectId: string,
  focus: string
): Promise<EvidenceCard[]> {
  const communicationProviders = getMvpEnabledCommunicationProviders(env).filter((provider) => provider !== "manual_import");
  if (communicationProviders.length === 0) return [];
  const recentRows = await prisma.communicationMessageChunk.findMany({
    where: {
      projectId,
      provider: { in: communicationProviders },
      message: { isDeletedByProvider: false },
      connector: { status: { in: ["connected", "syncing", "error"] } }
    },
    include: { message: true, thread: true, connector: true },
    orderBy: [{ createdAt: "desc" }],
    take: 80
  });
  const indexedIds = await deepResearchCommunicationIds(prisma, projectId, focus, communicationProviders);
  const indexedRows = indexedIds.length > 0
    ? await prisma.communicationMessageChunk.findMany({
        where: {
          id: { in: indexedIds },
          projectId,
          provider: { in: communicationProviders },
          message: { isDeletedByProvider: false },
          connector: { status: { in: ["connected", "syncing", "error"] } }
        },
        include: { message: true, thread: true, connector: true }
      })
    : [];
  const indexRank = new Map(indexedIds.map((id, index) => [id, index]));
  indexedRows.sort((a, b) => (indexRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (indexRank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  const seen = new Set<string>();
  const allowedProviders = new Set<string>(communicationProviders);
  const rows = [...indexedRows, ...recentRows].filter((row) => allowedProviders.has(String(row.provider)) && !seen.has(row.id) && Boolean(seen.add(row.id)));

  return rankExplicitRows(rows, focus, (row) =>
    [row.provider, row.connector.accountLabel, row.thread.subject, row.message.senderLabel, row.lexicalContent, row.content]
      .filter(Boolean)
      .join(" ")
  ).filter(({ score }) => score > 0).slice(0, 4).map(({ row, score }) => {
    const provider = String(row.provider);
    const channel = readJsonString(row.thread.rawMetadataJson, "channelName") ?? row.thread.subject ?? row.connector.accountLabel;
    const providerName = communicationProviderLabel(provider);
    return {
      evidenceId: `deep-research-communication:${row.id}`,
      sourceType: provider === "slack" ? "slack_message" : "communication_message",
      title: `${providerName} - ${channel}`,
      excerpt: cleanExcerpt(row.contextualContent ?? row.content ?? row.lexicalContent),
      whySelected: `Explicitly requested communication evidence; lexical relevance ${score.toFixed(3)}`,
      confidence: Math.min(0.9, 0.58 + score * 0.28),
      sourcePrecedence: "communication_evidence",
      citationRef: { type: "message", id: row.messageId, label: `${providerName} - ${channel}` },
      openTarget: {
        targetType: "message",
        targetRef: {
          messageId: row.messageId,
          threadId: row.threadId,
          highlightChunkId: row.id,
          provider,
          providerPermalink: row.message.providerPermalink ?? undefined
        }
      },
      trace: { messageId: row.messageId, threadId: row.threadId }
    } satisfies EvidenceCard;
  });
}

async function collectGitHubCards(prisma: PrismaClient, projectId: string, focus: string): Promise<EvidenceCard[]> {
  const recentRows = await prisma.gitHubEngineeringEvidence.findMany({
    where: {
      projectId,
      evidenceStatus: "active",
      repositoryLink: { status: "active", archivedAt: null }
    },
    include: { mappedUser: true },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: 60
  });
  const indexedIds = await deepResearchGitHubIds(prisma, projectId, focus);
  const indexedRows = indexedIds.length > 0
    ? await prisma.gitHubEngineeringEvidence.findMany({
        where: {
          id: { in: indexedIds },
          projectId,
          evidenceStatus: "active",
          repositoryLink: { status: "active", archivedAt: null }
        },
        include: { mappedUser: true }
      })
    : [];
  const indexRank = new Map(indexedIds.map((id, index) => [id, index]));
  indexedRows.sort((a, b) => (indexRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (indexRank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  const seen = new Set<string>();
  const rows = [...indexedRows, ...recentRows].filter((row) => !seen.has(row.id) && Boolean(seen.add(row.id)));

  return rankExplicitRows(rows, focus, (row) =>
    [row.evidenceType, row.title, row.summary, row.repositoryOwner, row.repositoryName, row.branch, row.sha, row.status]
      .filter(Boolean)
      .join(" ")
  ).filter(({ score }) => score > 0).slice(0, 4).map(({ row, score }) => {
    const repository = `${row.repositoryOwner}/${row.repositoryName}`;
    const title = row.title ?? row.sha ?? `${repository} ${row.evidenceType}`;
    return {
      evidenceId: `deep-research-github:${row.id}`,
      sourceType: "github_evidence",
      title,
      excerpt: cleanExcerpt([row.title, row.summary, repository, row.branch, row.sha, row.status].filter(Boolean).join("\n")),
      whySelected: `Explicitly requested GitHub evidence; lexical relevance ${score.toFixed(3)}`,
      confidence: Math.min(0.88, 0.56 + score * 0.28),
      sourcePrecedence: "engineering_artifact",
      citationRef: { type: "github_evidence", id: row.id, label: title },
      openTarget: {
        targetType: "github_evidence",
        targetRef: {
          projectId,
          evidenceId: row.id,
          repo: repository,
          sha: row.sha ?? undefined,
          url: row.sourceUrl ?? undefined
        }
      },
      trace: {}
    } satisfies EvidenceCard;
  });
}

function rankExplicitRows<T>(rows: T[], focus: string, textFor: (row: T) => string) {
  return rows
    .map((row, index) => ({ row, score: lexicalScore(focus, textFor(row)), index }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

function mergeDeepResearchCards(base: EvidenceCard[], explicit: EvidenceCard[], limit: number, focus: string) {
  const merged: EvidenceCard[] = [];
  const seen = new Set<string>();
  const ranked = [...base, ...explicit]
    .map((card, index) => ({
      card,
      index,
      score: lexicalScore(focus, `${card.title} ${card.excerpt} ${card.whySelected}`)
    }))
    .sort((a, b) => b.score - a.score || b.card.confidence - a.card.confidence || a.index - b.index);
  for (const { card } of ranked) {
    const key = `${card.sourceType}:${card.citationRef?.id ?? card.evidenceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(card);
    if (merged.length >= limit) break;
  }
  return merged;
}

async function deepResearchCommunicationIds(
  prisma: PrismaClient,
  projectId: string,
  focus: string,
  providers: string[]
) {
  const searchQuery = buildRecallPreservingWebsearchQuery(focus);
  if (typeof (prisma as any).$queryRaw !== "function" || providers.length === 0 || !searchQuery) return [];
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT cmc.id
    FROM communication_message_chunks cmc
    JOIN communication_messages cm ON cm.id = cmc.message_id
    JOIN communication_connectors cc ON cc.id = cmc.connector_id
    WHERE cmc.project_id = ${projectId}::uuid
      AND cmc.provider::text IN (${Prisma.join(providers)})
      AND cm.is_deleted_by_provider = false
      AND cc.status::text IN ('connected', 'syncing', 'error')
      AND to_tsvector('english', cmc.lexical_content) @@ websearch_to_tsquery('english', ${searchQuery})
    ORDER BY ts_rank_cd(to_tsvector('english', cmc.lexical_content), websearch_to_tsquery('english', ${searchQuery})) DESC,
             cmc.created_at DESC
    LIMIT 48
  `);
  return rows.map((row) => row.id);
}

async function deepResearchGitHubIds(prisma: PrismaClient, projectId: string, focus: string) {
  const searchQuery = buildRecallPreservingWebsearchQuery(focus);
  if (typeof (prisma as any).$queryRaw !== "function" || !searchQuery) return [];
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT ge.id
    FROM github_engineering_evidence ge
    JOIN github_repository_project_links grpl ON grpl.id = ge.repository_link_id
    WHERE ge.project_id = ${projectId}::uuid
      AND ge.evidence_status::text = 'active'
      AND grpl.status::text = 'active'
      AND grpl.archived_at IS NULL
      AND to_tsvector('english',
        coalesce(ge.title, '') || ' ' || coalesce(ge.summary, '') || ' ' ||
        coalesce(ge.repository_owner, '') || ' ' || coalesce(ge.repository_name, '') || ' ' ||
        coalesce(ge.branch, '') || ' ' || coalesce(ge.sha, '') || ' ' ||
        coalesce(ge.path, '') || ' ' || coalesce(ge.status, '')
      ) @@ websearch_to_tsquery('english', ${searchQuery})
    ORDER BY ts_rank_cd(
      to_tsvector('english',
        coalesce(ge.title, '') || ' ' || coalesce(ge.summary, '') || ' ' ||
        coalesce(ge.repository_owner, '') || ' ' || coalesce(ge.repository_name, '') || ' ' ||
        coalesce(ge.branch, '') || ' ' || coalesce(ge.sha, '') || ' ' ||
        coalesce(ge.path, '') || ' ' || coalesce(ge.status, '')
      ),
      websearch_to_tsquery('english', ${searchQuery})
    ) DESC,
    ge.occurred_at DESC NULLS LAST,
    ge.created_at DESC
    LIMIT 48
  `);
  return rows.map((row) => row.id);
}

function communicationProviderLabel(provider: string) {
  if (provider === "fireflies_ai") return "Fireflies.ai";
  if (provider === "microsoft_teams") return "Microsoft Teams";
  if (provider === "zoho_mail") return "Zoho Mail";
  if (provider === "zoho_cliq") return "Zoho Cliq";
  if (provider === "zoho_crm") return "Zoho CRM";
  if (provider === "manual_import") return "Imported communication";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function readJsonString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function cleanExcerpt(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 1600);
}

export function filterCardsBySources(cards: EvidenceCard[], selected: Set<string>): EvidenceCard[] {
  return cards.filter((card) => {
    const t = card.sourceType.toLowerCase();
    const isComm = /message|thread|comm|slack|teams|chat/.test(t);
    const isDoc = /document|doc|section|chunk|brain|live_doc|product_brain/.test(t);
    const isGithub = /github|commit|pull_request|\bpr\b/.test(t);
    const isCalendar = /calendar|meeting|event/.test(t);
    if (isComm) return selected.has("slack");
    if (isGithub) return selected.has("github");
    if (isCalendar) return selected.has("calendar");
    if (isDoc) return selected.has("docs");
    // Unknown source domains fail closed: selecting one source must never admit
    // an unclassified card from another domain.
    return false;
  });
}

export function buildDeepResearchSources(cards: EvidenceCard[], webResults: SearchResult[]): DeepResearchSource[] {
  const items: DeepResearchSource[] = [];
  for (const [index, card] of cards.entries()) {
    const label = safeSourceLabel(card.citationRef?.label ?? card.title, "Project evidence");
    items.push({
      provider: providerLabel(card.sourceType),
      ref: `E${index + 1}`,
      label,
      kind: "internal",
      href: safeInternalHref(card)
    });
  }
  for (const [index, result] of webResults.entries()) {
    const href = safeExternalHref(result.url);
    if (!href) continue;
    items.push({ provider: "Web", ref: `W${index + 1}`, label: safeSourceLabel(result.title, "Public source"), kind: "web", href });
  }
  return Array.from(new Map(items.map((item) => {
    const documentPath = item.kind === "internal" && item.href?.match(/^\/memory\/docs\/[^/?#]+\/view/);
    return [documentPath ? `document:${documentPath[0]}` : `${item.kind}:${item.href}:${item.label}`, item];
  })).values()).slice(0, 40);
}

export function assertDeepResearchRetrievalAvailable(retrieval: { candidates: unknown[]; telemetry: { retrievalBranchFailureCount: number } }) {
  if (retrieval.candidates.length === 0 && retrieval.telemetry.retrievalBranchFailureCount > 0) {
    throw new AppError(503, "Research retrieval could not complete. Start research again; source availability could not be verified.", "deep_research_retrieval_unavailable");
  }
}

export function groundDeepResearchOutput(
  output: { executiveSummary: string; findings: Array<{ category: string; severity: "HIGH" | "MEDIUM"; title: string; description: string; sources: string }>; marketContext: Array<{ title: string; body: string }>; expansionOpportunities: string[]; recommendedActions: Array<{ priority: "IMMEDIATE" | "THIS WEEK" | "THIS SPRINT"; action: string; source: string }> },
  cards: EvidenceCard[],
  webResults: SearchResult[]
) {
  const allowed = new Set([
    ...cards.map((_, index) => `E${index + 1}`),
    ...webResults.map((_, index) => `W${index + 1}`)
  ]);
  // Older prompts allowed source titles. Resolve only exact, unambiguous aliases;
  // never fuzzy-match a title or map a duplicate title to an arbitrary excerpt.
  const aliases = new Map<string, string | null>();
  const alias = (label: string | undefined, ref: string) => {
    const key = label?.trim().toLowerCase();
    if (!key) return;
    aliases.set(key, aliases.has(key) && aliases.get(key) !== ref ? null : ref);
  };
  cards.forEach((card, i) => { alias(card.title, `E${i + 1}`); if (card.citationRef) alias(`${card.citationRef.type}:${card.citationRef.id}`, `E${i + 1}`); });
  webResults.forEach((result, i) => { alias(result.title, `W${i + 1}`); alias(result.url, `W${i + 1}`); });
  const numberedRefs = (value: string) => (value.match(/\b[EW]\d+\b/gi) ?? []).map(ref => ref.toUpperCase()).filter(ref => allowed.has(ref));
  const refs = (value: string) => Array.from(new Set([
    ...numberedRefs(value),
    ...value.split(/\s*[·;\n]\s*/).flatMap(part => {
      const resolved = aliases.get(part.trim().toLowerCase());
      return resolved ? [resolved] : [];
    })
  ]));
  const findings = output.findings.flatMap((finding) => {
    const valid = refs(finding.sources);
    return valid.length ? [{ ...finding, sources: valid.join(" · ") }] : [];
  });
  const recommendedActions = output.recommendedActions.flatMap((action) => {
    const valid = refs(action.source);
    return valid.length ? [{ ...action, source: valid.join(" · ") }] : [];
  });
  return {
    ...output,
    executiveSummary: findings.length || recommendedActions.length || numberedRefs(output.executiveSummary).length
      ? output.executiveSummary
      : cards.length || webResults.length
        ? "Sources were retrieved, but a citation-backed answer could not be established. Try narrowing the focus; this does not mean the sources contain no answer."
        : "No evidence-grounded findings could be established for this focus from the selected sources.",
    findings,
    recommendedActions
  };
}

function safeSourceLabel(value: string, fallback: string) {
  const withoutIdentifiers = String(value ?? "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, "")
    .replace(/\b(?:chunk|section|message|thread)[-_:][a-z0-9_-]+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return (withoutIdentifiers || fallback).slice(0, 240);
}

function providerLabel(sourceType: string) {
  const value = sourceType.toLowerCase();
  if (/github|commit|pull_request|\bpr\b/.test(value)) return "GitHub";
  if (/message|thread|comm|slack|teams|chat/.test(value)) return value.includes("teams") ? "Microsoft Teams" : "Communications";
  if (/calendar|meeting|event/.test(value)) return "Calendar";
  if (/document|doc|section|chunk/.test(value)) return "Documents";
  if (/brain|live_doc|product_brain/.test(value)) return "Product Memory";
  return "Project Memory";
}

function safeExternalHref(value: unknown) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeInternalHref(card: EvidenceCard) {
  const ref = card.openTarget?.targetRef ?? {};
  const external = safeExternalHref(ref.url);
  if (external) return external;
  const targetType = card.openTarget?.targetType ?? "";
  if ((targetType.includes("document") || card.sourceType.includes("document")) && typeof ref.documentId === "string") {
    return `/memory/docs/${encodeURIComponent(ref.documentId)}/view`;
  }
  if (targetType === "project_context" && typeof ref.contextId === "string") {
    return `/memory/context/${encodeURIComponent(ref.contextId)}`;
  }
  const source = providerLabel(card.sourceType).toLowerCase().includes("github") ? "github" : "all";
  return source === "all" ? "/memory" : `/timeline?source=${source}`;
}

export function computeStats(cards: EvidenceCard[], webResults: SearchResult[], startedAtMs: number): DeepResearchStats {
  const messages = new Set<string>();
  const documents = new Set<string>();
  const engineering = new Set<string>();
  const sources = new Set<string>();
  for (const card of cards) {
    const t = card.sourceType.toLowerCase();
    const ref = card.openTarget?.targetRef ?? {};
    const id = card.citationRef?.id ?? card.evidenceId;
    const documentId = typeof ref.documentId === "string" ? ref.documentId : null;
    const key = documentId ? `document:${documentId}` : `${t}:${id}`;
    sources.add(key);
    if (/message|thread|comm|slack|teams|chat/.test(t)) messages.add(String(card.trace?.messageId ?? ref.messageId ?? id));
    else if (/github|commit|pull_request|pr\b/.test(t)) engineering.add(id);
    // Derived Product Brain/Live Doc cards and unidentified chunks are not
    // additional uploaded documents. Never deduplicate by a display title.
    else if (documentId && /document|doc|section|chunk/.test(t) && !/brain|live_doc/.test(t)) documents.add(documentId);
  }
  const web = new Set(webResults.map(result => safeExternalHref(result.url)).filter(Boolean));
  const elapsedSec = Math.max(1, Math.round((Date.now() - startedAtMs) / 1000));
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  return {
    totalSources: sources.size + web.size,
    slackMessages: messages.size,
    commits: engineering.size,
    docs: documents.size,
    webSources: web.size,
    duration: mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  };
}
