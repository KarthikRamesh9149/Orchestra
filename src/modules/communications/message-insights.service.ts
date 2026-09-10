import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { AppEnv } from "../../config/env.js";
import { buildMessageIntelligenceTelemetry, estimateAiCost, estimateTokens, getModelForTask, persistAiTelemetry, pricingFromEnv, type AiLimiter } from "../../lib/ai-ops/index.js";
import { getAggregateCache, setAggregateCache } from "../../lib/dashboard/aggregate-cache.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";
import { enqueueJobInBackground } from "../../lib/jobs/background-dispatch.js";
import { jobKeys } from "../../lib/jobs/keys.js";
import { JobNames, type JobDispatcher } from "../../lib/jobs/types.js";
import type { TelemetryService } from "../../lib/observability/telemetry.js";
import type { GenerationProvider } from "../../lib/ai/provider.js";
import { AuditService } from "../audit/service.js";
import { ProjectService } from "../projects/service.js";
import { ensureCommunicationManager, ensureCommunicationReadAccess } from "./authz.js";
import { CommunicationProposalsService } from "./communication-proposals.service.js";
import { evaluateCommunicationTruthPolicy } from "./communication-truth-policy.js";
import { buildInsightClassifierSystemPrompt, buildMessageInsightPrompt, communicationInsightOutputSchema, type CommunicationInsightOutput } from "./insight-classifier.prompt.js";
import { ImpactResolverService } from "./impact-resolver.service.js";

function toNumber(value: Prisma.Decimal | number) {
  return value instanceof Prisma.Decimal ? value.toNumber() : value;
}

const COMMUNICATION_REVIEW_CACHE_TTL_MS = 60_000;

function normalizeText(value: string) {
  return value.toLowerCase();
}

function containsAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(needle));
}

function toJsonInput(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value as Prisma.InputJsonValue;
}

function defaultAiOpsEnv(): AppEnv {
  return {
    SOCRATES_MODEL_FAST: process.env.SOCRATES_MODEL_FAST ?? "mock-fast",
    SOCRATES_MODEL_HIGH_QUALITY: process.env.SOCRATES_MODEL_HIGH_QUALITY ?? "mock-high-quality",
    SOCRATES_MODEL_FALLBACK: process.env.SOCRATES_MODEL_FALLBACK ?? "mock-fallback",
    SOCRATES_CLASSIFIER_MODEL: process.env.SOCRATES_CLASSIFIER_MODEL ?? "mock-classifier",
    SOCRATES_MODEL_STRATEGY: process.env.SOCRATES_MODEL_STRATEGY ?? "auto",
    SOCRATES_ENABLE_MODEL_FALLBACK: process.env.SOCRATES_ENABLE_MODEL_FALLBACK !== "false",
    SOCRATES_GENERATION_TIMEOUT_MS: Number(process.env.SOCRATES_GENERATION_TIMEOUT_MS ?? 30_000),
    SOCRATES_MAX_CLASSIFICATION_JOBS_PER_PROJECT: Number(process.env.SOCRATES_MAX_CLASSIFICATION_JOBS_PER_PROJECT ?? 2_000),
    SOCRATES_MODEL_FAST_INPUT_COST_PER_1M: Number(process.env.SOCRATES_MODEL_FAST_INPUT_COST_PER_1M ?? 0),
    SOCRATES_MODEL_FAST_OUTPUT_COST_PER_1M: Number(process.env.SOCRATES_MODEL_FAST_OUTPUT_COST_PER_1M ?? 0),
    SOCRATES_MODEL_HIGH_QUALITY_INPUT_COST_PER_1M: Number(process.env.SOCRATES_MODEL_HIGH_QUALITY_INPUT_COST_PER_1M ?? 0),
    SOCRATES_MODEL_HIGH_QUALITY_OUTPUT_COST_PER_1M: Number(process.env.SOCRATES_MODEL_HIGH_QUALITY_OUTPUT_COST_PER_1M ?? 0),
    SOCRATES_MODEL_FALLBACK_INPUT_COST_PER_1M: Number(process.env.SOCRATES_MODEL_FALLBACK_INPUT_COST_PER_1M ?? 0),
    SOCRATES_MODEL_FALLBACK_OUTPUT_COST_PER_1M: Number(process.env.SOCRATES_MODEL_FALLBACK_OUTPUT_COST_PER_1M ?? 0),
    SOCRATES_EMBEDDING_COST_PER_1M: Number(process.env.SOCRATES_EMBEDDING_COST_PER_1M ?? 0),
    SOCRATES_RERANK_COST_PER_1K: Number(process.env.SOCRATES_RERANK_COST_PER_1K ?? 0)
  } as AppEnv;
}

type ValidatedRefs = {
  documentSectionIds: string[];
  brainNodeIds: string[];
};

type CandidateRef = {
  id: string;
  label?: string;
  excerpt?: string;
  title?: string;
  summary?: string;
};

const FALLBACK_REF_STOPWORDS = new Set([
  "need",
  "must",
  "should",
  "please",
  "with",
  "from",
  "that",
  "this",
  "will",
  "would",
  "add",
  "change",
  "update",
  "client",
  "customer",
  "user",
  "users",
  "manager",
  "setting",
  "settings",
  "account",
  "accounts",
  "portal",
  "project",
  "product",
  "feature"
]);

function tokenizeFallbackRefText(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4 && !FALLBACK_REF_STOPWORDS.has(token))
    )
  );
}

function groundedFallbackRefs(sourceText: string, candidates: CandidateRef[]) {
  const sourceTokens = new Set(tokenizeFallbackRefText(sourceText));
  if (sourceTokens.size === 0) return [];

  return candidates
    .map((candidate) => {
      const candidateText = [
        candidate.label,
        candidate.excerpt,
        candidate.title,
        candidate.summary
      ].filter(Boolean).join(" ");
      const overlap = tokenizeFallbackRefText(candidateText).filter((token) => sourceTokens.has(token)).length;
      return {
        id: candidate.id,
        confidence: Math.min(0.88, 0.72 + overlap * 0.04),
        overlap
      };
    })
    .filter((candidate) => candidate.overlap > 0)
    .sort((left, right) => right.overlap - left.overlap || right.confidence - left.confidence)
    .slice(0, 2)
    .map(({ id, confidence }) => ({ id, confidence }));
}

function fallbackAffectedRefs(sourceText: string, candidateSections: CandidateRef[], candidateBrainNodes: CandidateRef[]) {
  return {
    sections: groundedFallbackRefs(sourceText, candidateSections),
    nodes: groundedFallbackRefs(sourceText, candidateBrainNodes)
  };
}

export class MessageInsightsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly generationProvider: GenerationProvider,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly jobs: JobDispatcher,
    private readonly impactResolver: ImpactResolverService,
    private readonly proposalService: CommunicationProposalsService,
    private readonly telemetry: TelemetryService,
    private readonly env: AppEnv = defaultAiOpsEnv(),
    private readonly aiLimiter?: AiLimiter
  ) {}
  async list(
    projectId: string,
    actorUserId: string,
    query: {
      status?: string;
      insightType?: string;
      threadId?: string;
      messageId?: string;
      provider?: string;
      minConfidence?: number;
      hasProposal?: boolean;
      cursor?: string;
      limit: number;
    }
  ) {
    await ensureCommunicationReadAccess(this.projectService, projectId, actorUserId);

    const items = await this.prisma.messageInsight.findMany({
      where: {
        projectId,
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.insightType ? { insightType: query.insightType as never } : {}),
        ...(query.threadId ? { threadId: query.threadId } : {}),
        ...(query.messageId ? { messageId: query.messageId } : {}),
        ...(query.provider ? { provider: query.provider as never } : {}),
        ...(query.minConfidence != null ? { confidence: { gte: new Prisma.Decimal(query.minConfidence) } } : {}),
        ...(query.hasProposal === true ? { generatedProposalId: { not: null } } : {}),
        ...(query.hasProposal === false ? { generatedProposalId: null } : {})
      },
      include: {
        message: true,
        thread: true
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1
    });

    const hasMore = items.length > query.limit;
    const page = items.slice(0, query.limit);

    return {
      items: page.map((item) => this.mapInsightSummary(item)),
      meta: {
        limit: query.limit,
        hasMore,
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null
      }
    };
  }

  async get(projectId: string, insightId: string, actorUserId: string) {
    await ensureCommunicationReadAccess(this.projectService, projectId, actorUserId);
    const insight = await this.prisma.messageInsight.findFirstOrThrow({
      where: { id: insightId, projectId },
      include: {
        message: true,
        thread: true,
        generatedProposal: {
          include: { links: true, decisionRecord: true }
        },
        generatedDecision: true
      }
    });

    return {
      ...this.mapInsightSummary(insight),
      evidence: insight.evidenceJson,
      oldUnderstanding: insight.oldUnderstandingJson,
      newUnderstanding: insight.newUnderstandingJson,
      impactSummary: insight.impactSummaryJson,
      uncertainty: Array.isArray(insight.uncertaintyJson) ? insight.uncertaintyJson : [],
      generatedProposal: insight.generatedProposal
        ? {
            id: insight.generatedProposal.id,
            title: insight.generatedProposal.title,
            status: insight.generatedProposal.status,
            proposalType: insight.generatedProposal.proposalType,
            decisionRecordId: insight.generatedProposal.decisionRecordId
          }
        : null,
      generatedDecision: insight.generatedDecision
        ? {
            id: insight.generatedDecision.id,
            title: insight.generatedDecision.title,
            status: insight.generatedDecision.status
          }
        : null
    };
  }

  async ignore(projectId: string, insightId: string, actorUserId: string) {
    await ensureCommunicationManager(this.projectService, projectId, actorUserId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { orgId: true }
    });

    const insight = await this.prisma.messageInsight.findFirstOrThrow({
      where: { id: insightId, projectId },
      select: { id: true }
    });
    await this.prisma.messageInsight.update({
      where: { id: insight.id },
      data: { status: "ignored" }
    });

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "message_insight_ignored",
      entityType: "message_insight",
      entityId: insightId,
      payload: {}
    });
    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, "message_insight_ignored");

    return this.get(projectId, insightId, actorUserId);
  }

  async classifyMessage(projectId: string, messageId: string, actorUserId: string | null) {
    if (actorUserId) {
      await this.projectService.ensureProjectTruthApprover(projectId, actorUserId);
    }
    const startedAt = Date.now();
    const classifyLimit = await this.aiLimiter?.checkRequestLimit({
      key: `classification-project:${projectId}`,
      maxRequests: this.env.SOCRATES_MAX_CLASSIFICATION_JOBS_PER_PROJECT,
      windowMs: 24 * 60 * 60 * 1000
    });
    if (classifyLimit && !classifyLimit.allowed) {
      this.telemetry.increment("orchestra_ai_limit_hits_total", { code: classifyLimit.code, scope: "classification_project" });
      throw new Error("Socrates classification job limit exceeded");
    }

    const context = await this.impactResolver.buildMessageContext(projectId, messageId);
    const existingInsight = await this.prisma.messageInsight.findUnique?.({
      where: {
        messageId_bodyHash: {
          messageId: context.target.id,
          bodyHash: context.target.bodyHash
        }
      },
      include: { message: true, thread: true }
    });
    if (existingInsight) {
      if (actorUserId) {
        return this.get(projectId, existingInsight.id, actorUserId);
      }
      return this.mapInsightSummary(existingInsight);
    }

    const targetContent = [
      `Thread subject: ${context.thread.subject ?? "(none)"}`,
      ...context.threadMessages.map((item) => `${item.senderLabel} @ ${item.sentAt.toISOString()}: ${item.bodyText}`)
    ].join("\n");
    const prompt = buildMessageInsightPrompt({
      targetKind: "message",
      content: targetContent,
      acceptedProductBrainSummary: context.acceptedProductBrainSummary,
      candidateSections: context.candidateSections,
      candidateBrainNodes: context.candidateBrainNodes,
      acceptedChanges: context.acceptedChanges,
      acceptedDecisions: context.acceptedDecisions,
      unresolvedProposals: context.unresolvedProposals
    });
    const modelSelection = getModelForTask("message_classification", {}, this.env);

    const output = await this.generationProvider.generateObject({
      schema: communicationInsightOutputSchema,
      systemPrompt: buildInsightClassifierSystemPrompt(),
      prompt,
      model: modelSelection.model,
      timeoutMs: this.env.SOCRATES_GENERATION_TIMEOUT_MS,
      task: "message_classification",
      fallback: () => this.heuristicFallback(context.target.bodyText, context.candidateSections, context.candidateBrainNodes)
    });

    const policy = evaluateCommunicationTruthPolicy(output, context.candidateSections, context.candidateBrainNodes, {
      requireBrainNodeRefs: this.env.BETA_PRODUCT_BRAIN_MUTATION_FROM_COMMUNICATIONS !== false,
      sourceText: targetContent
    });
    const validatedRefs = policy.validatedRefs;
    const confidence = policy.confidence;
    const shouldCreateProposal = policy.shouldCreateProposal;
    const shouldCreateDecision = policy.shouldCreateDecision;
    const promptTokens = estimateTokens(prompt);
    const estimatedOutputTokens = estimateTokens(output.summary) + estimateTokens(JSON.stringify(output.impactSummary ?? {}));
    const invalidAffectedRefsDropped = policy.invalidRefCounts.documentSections + policy.invalidRefCounts.brainNodes;
    const cost = estimateAiCost({
      pricing: pricingFromEnv(this.env),
      modelTier: modelSelection.tier,
      inputTokens: promptTokens,
      outputTokens: estimatedOutputTokens
    });
    const aiOpsModelJson = {
      classifierModel: modelSelection.model,
      modelTier: modelSelection.tier,
      tokenUsage: {
        input: promptTokens,
        output: estimatedOutputTokens,
        evidence: context.candidateSections.length + context.candidateBrainNodes.length
      },
      estimatedCostUsd: cost.totalCostUsd,
      schemaRepairAttempts: 0,
      invalidAffectedRefsDropped,
      classifierFallbackUsed: this.generationProvider.constructor.name.includes("Mock")
    };

    const insight = await this.prisma.messageInsight.upsert({
      where: {
        messageId_bodyHash: {
          messageId: context.target.id,
          bodyHash: context.target.bodyHash
        }
      },
      create: {
        projectId,
        connectorId: context.target.connectorId,
        provider: context.target.provider,
        messageId: context.target.id,
        threadId: context.thread.id,
        bodyHash: context.target.bodyHash,
        insightType: output.insightType,
        status: "detected",
        summary: output.summary,
        confidence: new Prisma.Decimal(confidence.toFixed(3)),
        shouldCreateProposal,
        shouldCreateDecision,
        proposalType: policy.proposalType,
        affectedRefsJson: {
          documentSectionIds: validatedRefs.documentSectionIds,
          brainNodeIds: validatedRefs.brainNodeIds
        },
        evidenceJson: {
          sourceMessageIds: [context.target.id],
          threadId: context.thread.id,
          candidateSectionIds: context.candidateSections.map((item) => item.id),
          candidateBrainNodeIds: context.candidateBrainNodes.map((item) => item.id)
        },
        oldUnderstandingJson: toJsonInput(output.oldUnderstanding ?? undefined),
        newUnderstandingJson: toJsonInput(output.newUnderstanding ?? undefined),
        decisionStatement: output.decisionStatement,
        impactSummaryJson: toJsonInput(output.impactSummary ?? undefined),
        uncertaintyJson: output.uncertainty,
        modelJson: {
          provider: this.generationProvider.constructor.name,
          aiOps: aiOpsModelJson,
          truthPolicy: {
            blockedReasons: policy.blockedReasons,
            invalidRefCounts: policy.invalidRefCounts,
            invalidAffectedRefsDropped,
            globalDecision: policy.globalDecision
          }
        }
      },
      update: {
        insightType: output.insightType,
        status: "detected",
        summary: output.summary,
        confidence: new Prisma.Decimal(confidence.toFixed(3)),
        shouldCreateProposal,
        shouldCreateDecision,
        proposalType: policy.proposalType,
        affectedRefsJson: {
          documentSectionIds: validatedRefs.documentSectionIds,
          brainNodeIds: validatedRefs.brainNodeIds
        },
        evidenceJson: {
          sourceMessageIds: [context.target.id],
          threadId: context.thread.id,
          candidateSectionIds: context.candidateSections.map((item) => item.id),
          candidateBrainNodeIds: context.candidateBrainNodes.map((item) => item.id)
        },
        oldUnderstandingJson: toJsonInput(output.oldUnderstanding ?? undefined),
        newUnderstandingJson: toJsonInput(output.newUnderstanding ?? undefined),
        decisionStatement: output.decisionStatement,
        impactSummaryJson: toJsonInput(output.impactSummary ?? undefined),
        uncertaintyJson: output.uncertainty,
        modelJson: {
          provider: this.generationProvider.constructor.name,
          aiOps: aiOpsModelJson,
          truthPolicy: {
            blockedReasons: policy.blockedReasons,
            invalidRefCounts: policy.invalidRefCounts,
            invalidAffectedRefsDropped,
            globalDecision: policy.globalDecision
          }
        }
      }
    });

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { orgId: true }
    });
    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId: actorUserId ?? undefined,
      eventType: "message_insight_created",
      entityType: "message_insight",
      entityId: insight.id,
      payload: {
        messageId,
        insightType: insight.insightType,
        confidence
      }
    });
    this.telemetry.increment("communication_insights_created_total", {
      insight_type: insight.insightType,
      provider: context.target.provider
    });
    const aiTelemetry = buildMessageIntelligenceTelemetry({
      projectId,
      provider: context.target.provider,
      threadId: context.thread.id,
      messageId: context.target.id,
      bodyHash: context.target.bodyHash,
      classifierModel: modelSelection.model,
      modelTier: modelSelection.tier,
      promptTokens,
      evidenceTokens: context.candidateSections.length + context.candidateBrainNodes.length,
      outputTokens: estimatedOutputTokens,
      retrievalCandidateCount: context.candidateSections.length + context.candidateBrainNodes.length,
      affectedRefsCandidateCount: (output.affectedDocumentSections?.length ?? 0) + (output.affectedBrainNodes?.length ?? 0),
      invalidAffectedRefsDropped,
      confidenceBeforePolicy: output.confidence,
      confidenceAfterPolicy: confidence,
      insightType: output.insightType,
      shouldCreateProposalModel: output.shouldCreateProposal,
      shouldCreateProposalBackend: shouldCreateProposal,
      shouldCreateDecisionModel: output.shouldCreateDecision,
      shouldCreateDecisionBackend: shouldCreateDecision,
      proposalGenerated: Boolean(insight.generatedProposalId),
      decisionGenerated: Boolean(insight.generatedDecisionId),
      latencyMs: Date.now() - startedAt,
      estimatedCostUsd: cost.totalCostUsd,
      schemaRepairAttempts: 0,
      classifierFallbackUsed: this.generationProvider.constructor.name.includes("Mock"),
      duplicateOutcome: existingInsight ? "same_body_reuses" : "created_or_updated"
    });
    this.telemetry.increment("orchestra_ai_message_classifications_total", {
      provider: context.target.provider,
      model_tier: modelSelection.tier,
      proposal: shouldCreateProposal
    });
    this.telemetry.setGauge?.("orchestra_ai_message_estimated_cost_usd", cost.totalCostUsd, { project_id: projectId });
    await persistAiTelemetry({
      auditService: this.auditService,
      metrics: this.telemetry,
      orgId: project.orgId,
      projectId,
      actorUserId: actorUserId ?? null,
      eventType: "message_intelligence_ai_telemetry",
      entityType: "message_insight",
      entityId: insight.id,
      payload: aiTelemetry
    }).catch(() => undefined);

    if ((shouldCreateProposal || shouldCreateDecision) && !insight.generatedProposalId && this.shouldAutoCreateProposalJobs()) {
      const key = jobKeys.generateChangeProposalFromInsight(insight.id);
      await this.prisma.jobRun.upsert({
        where: { idempotencyKey: key },
        update: {
          jobType: JobNames.generateChangeProposalFromInsight,
          status: "pending",
          payloadJson: { projectId, insightId: insight.id, idempotencyKey: key }
        },
        create: {
          jobType: JobNames.generateChangeProposalFromInsight,
          status: "pending",
          idempotencyKey: key,
          payloadJson: { projectId, insightId: insight.id, idempotencyKey: key }
        }
      });
      enqueueJobInBackground(
        this.prisma,
        this.jobs,
        JobNames.generateChangeProposalFromInsight,
        { projectId, insightId: insight.id, idempotencyKey: key },
        key
      );
    }

    if (this.shouldAutoClassifyThreads()) {
      const threadKey = jobKeys.classifyThreadInsight(context.thread.id, context.threadStateHash);
      await this.prisma.jobRun.upsert({
        where: { idempotencyKey: threadKey },
        update: {
          jobType: JobNames.classifyThreadInsight,
          status: "pending",
          payloadJson: { projectId, threadId: context.thread.id, idempotencyKey: threadKey }
        },
        create: {
          jobType: JobNames.classifyThreadInsight,
          status: "pending",
          idempotencyKey: threadKey,
          payloadJson: { projectId, threadId: context.thread.id, idempotencyKey: threadKey }
        }
      });
      enqueueJobInBackground(
        this.prisma,
        this.jobs,
        JobNames.classifyThreadInsight,
        { projectId, threadId: context.thread.id, idempotencyKey: threadKey },
        threadKey
      );
    }

    if (actorUserId) {
      return this.get(projectId, insight.id, actorUserId);
    }

    const stored = await this.prisma.messageInsight.findFirstOrThrow({
      where: { id: insight.id, projectId },
      include: { message: true, thread: true }
    });
    return this.mapInsightSummary(stored);
  }

  async runClassificationJob(input: { projectId: string; messageId: string; idempotencyKey?: string }) {
    if (input.idempotencyKey) {
      await this.prisma.jobRun.upsert({
        where: { idempotencyKey: input.idempotencyKey },
        update: {
          jobType: JobNames.classifyMessageInsight,
          status: "running",
          startedAt: new Date(),
          finishedAt: null,
          lastError: null,
          attemptCount: { increment: 1 }
        },
        create: {
          jobType: JobNames.classifyMessageInsight,
          status: "running",
          idempotencyKey: input.idempotencyKey,
          startedAt: new Date(),
          attemptCount: 1
        }
      });
    }

    try {
      const result = await this.classifyMessage(input.projectId, input.messageId, null);
      if (input.idempotencyKey) {
        await this.prisma.jobRun.update({
          where: { idempotencyKey: input.idempotencyKey },
          data: { status: "completed", finishedAt: new Date(), lastError: null }
        });
      }
      return result;
    } catch (error) {
      if (input.idempotencyKey) {
        await this.prisma.jobRun.update({
          where: { idempotencyKey: input.idempotencyKey },
          data: {
            status: "failed",
            finishedAt: new Date(),
            lastError: error instanceof Error ? error.message : "Unknown message insight classification error"
          }
        });
      }
      throw error;
    }
  }

  async createProposal(projectId: string, insightId: string, actorUserId: string) {
    await this.projectService.ensureProjectTruthApprover(projectId, actorUserId);
    return this.createProposalInternal(projectId, insightId, actorUserId);
  }

  async autoCreateProposal(projectId: string, insightId: string) {
    if (!this.shouldAutoCreateProposalJobs()) {
      return { insightId, proposalId: null, decisionId: null, deduped: false, skipped: "auto_proposals_disabled" };
    }
    return this.createProposalInternal(projectId, insightId, null);
  }

  private async createProposalInternal(projectId: string, insightId: string, actorUserId: string | null) {
    const insight = await this.prisma.messageInsight.findFirstOrThrow({
      where: { id: insightId, projectId }
    });
    const affectedRefs = this.parseAffectedRefs(insight.affectedRefsJson);
    const result = await this.proposalService.createProposalFromMessageInsight(projectId, insightId, actorUserId, {
      insight,
      messageId: insight.messageId,
      validatedRefs: affectedRefs
    });

    return {
      insightId,
      proposalId: result.proposalId,
      decisionId: result.decisionId,
      deduped: result.deduped
    };
  }

  async getReviewQueue(projectId: string, actorUserId: string) {
    await ensureCommunicationReadAccess(this.projectService, projectId, actorUserId);
    const cacheKey = `${projectId}:review-queue`;
    const cached = getAggregateCache<any>("communication-review", cacheKey, COMMUNICATION_REVIEW_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }

    const [insights, proposals, decisions] = await Promise.all([
      this.prisma.messageInsight.findMany({
        where: {
          projectId,
          status: { in: ["detected", "converted_to_proposal", "converted_to_decision"] },
          confidence: { gte: new Prisma.Decimal(0.6) }
        },
        select: {
          id: true,
          messageId: true,
          threadId: true,
          provider: true,
          insightType: true,
          status: true,
          summary: true,
          confidence: true,
          generatedProposalId: true,
          generatedDecisionId: true,
          affectedRefsJson: true,
          message: {
            select: {
              senderLabel: true,
              sentAt: true,
              bodyText: true
            }
          },
          thread: {
            select: {
              subject: true
            }
          }
        },
        orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
        take: 15
      }),
      this.prisma.specChangeProposal.findMany({
        where: {
          projectId,
          status: "needs_review",
          links: {
            some: {
              linkType: { in: ["message", "thread"] }
            }
          }
        },
        select: {
          id: true,
          title: true,
          summary: true,
          proposalType: true,
          status: true,
          links: {
            select: {
              linkType: true,
              linkRefId: true
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: 15
      }),
      this.prisma.decisionRecord.findMany({
        where: {
          projectId,
          status: "open",
          proposals: {
            some: {
              links: {
                some: {
                  linkType: { in: ["message", "thread"] }
                }
              }
            }
          }
        },
        select: {
          id: true,
          title: true,
          statement: true,
          status: true
        },
        orderBy: { createdAt: "desc" },
        take: 10
      })
    ]);

    const payload = {
      pendingInsights: insights.map((item) => this.mapInsightSummary(item)),
      generatedProposals: proposals.map((proposal) => ({
        proposalId: proposal.id,
        title: proposal.title,
        summary: proposal.summary,
        proposalType: proposal.proposalType,
        status: proposal.status,
        sourceLabels: proposal.links
          .filter((link) => link.linkType === "message" || link.linkType === "thread")
          .map((link) => ({ linkType: link.linkType, refId: link.linkRefId })),
        openTarget: {
          targetType: "change_proposal" as const,
          targetRef: { proposalId: proposal.id }
        }
      })),
      generatedDecisionCandidates: decisions.map((decision) => ({
        decisionId: decision.id,
        title: decision.title,
        statement: decision.statement,
        status: decision.status,
        openTarget: {
          targetType: "decision_record" as const,
          targetRef: { decisionId: decision.id }
        }
      }))
    };
    setAggregateCache("communication-review", cacheKey, payload);
    return payload;
  }

  private mapInsightSummary(
    item: {
      id: string;
      messageId: string;
      threadId: string;
      provider: string;
      insightType: string;
      status: string;
      summary: string;
      confidence: Prisma.Decimal | number;
      generatedProposalId?: string | null;
      generatedDecisionId?: string | null;
      affectedRefsJson?: unknown;
      message?: { senderLabel: string; sentAt: Date; bodyText: string } | null;
      thread?: { subject: string | null } | null;
    }
  ) {
    const refs = this.parseAffectedRefs(item.affectedRefsJson ?? null);
    return {
      id: item.id,
      messageId: item.messageId,
      threadId: item.threadId,
      provider: item.provider,
      insightType: item.insightType,
      status: item.status,
      summary: item.summary,
      confidence: toNumber(item.confidence),
      generatedProposalId: item.generatedProposalId ?? null,
      generatedDecisionId: item.generatedDecisionId ?? null,
      sourceLabel: item.message
        ? `${item.message.senderLabel} @ ${item.message.sentAt.toISOString()}`
        : null,
      threadLabel: item.thread?.subject ?? null,
      affectedDocumentSectionIds: refs.documentSectionIds,
      affectedBrainNodeIds: refs.brainNodeIds,
      openTargets: {
        message: {
          targetType: "message" as const,
          targetRef: { messageId: item.messageId }
        },
        thread: {
          targetType: "thread" as const,
          targetRef: { threadId: item.threadId }
        }
      }
    };
  }

  private heuristicFallback(
    bodyText: string,
    candidateSections: CandidateRef[] = [],
    candidateBrainNodes: CandidateRef[] = []
  ): CommunicationInsightOutput {
    const text = normalizeText(bodyText);
    const refs = fallbackAffectedRefs(bodyText, candidateSections, candidateBrainNodes);
    const isAmbiguousExploration = containsAny(text, [
      "maybe later",
      "maybe we could",
      "maybe we should",
      "perhaps",
      "could we explore",
      "can we explore",
      "might be useful",
      "not urgent",
      "for later",
      "sometime",
      "would be nice",
      "worth exploring"
    ]);

    if (isAmbiguousExploration) {
      return {
        insightType: "info",
        summary: "Message is exploratory and should not be treated as accepted product direction.",
        confidence: 0.46,
        shouldCreateProposal: false,
        shouldCreateDecision: false,
        proposalType: null,
        affectedDocumentSections: [],
        affectedBrainNodes: [],
        oldUnderstanding: null,
        newUnderstanding: null,
        decisionStatement: null,
        impactSummary: {
          scopeImpact: "low",
          engineeringImpact: "low",
          clientExpectationImpact: "low",
          summary: "Exploratory chatter detected; manager review is still required for any truth-affecting change."
        },
      uncertainty: ["Language is exploratory rather than directive."]
      };
    }

    if (containsAny(text, ["not this", "different project", "different initiative", "separate project", "off topic"])) {
      return {
        insightType: "info",
        summary: "Message appears off-topic relative to the current project context and should not create truth-affecting proposals.",
        confidence: 0.38,
        shouldCreateProposal: false,
        shouldCreateDecision: false,
        proposalType: null,
        affectedDocumentSections: [],
        affectedBrainNodes: [],
        oldUnderstanding: null,
        newUnderstanding: null,
        decisionStatement: null,
        impactSummary: {
          scopeImpact: "low",
          engineeringImpact: "low",
          clientExpectationImpact: "low",
          summary: "Off-topic context detected; do not treat this as a grounded project change."
        },
        uncertainty: ["The message references context outside the current project scope."]
      };
    }

    if (containsAny(text, ["blocked", "blocking", "waiting on", "stuck"])) {
      return {
        insightType: "blocker",
        summary: "Message describes a delivery blocker.",
        confidence: 0.86,
        shouldCreateProposal: false,
        shouldCreateDecision: false,
        proposalType: null,
        affectedDocumentSections: [],
        affectedBrainNodes: [],
        oldUnderstanding: null,
        newUnderstanding: null,
        decisionStatement: null,
        impactSummary: {
          scopeImpact: "low",
          engineeringImpact: "medium",
          clientExpectationImpact: "medium",
          summary: "Execution is blocked and needs review."
        },
        uncertainty: []
      };
    }

    if (containsAny(text, ["risk", "at risk", "might fail", "could fail"])) {
      return {
        insightType: "risk",
        summary: "Message identifies a delivery or product risk.",
        confidence: 0.79,
        shouldCreateProposal: false,
        shouldCreateDecision: false,
        proposalType: null,
        affectedDocumentSections: [],
        affectedBrainNodes: [],
        oldUnderstanding: null,
        newUnderstanding: null,
        decisionStatement: null,
        impactSummary: {
          scopeImpact: "low",
          engineeringImpact: "medium",
          clientExpectationImpact: "medium",
          summary: "A risk was identified and should remain insight-only until reviewed."
        },
        uncertainty: ["Risk severity may still need manager review."]
      };
    }

    if (containsAny(text, ["action needed", "follow up", "please confirm", "need confirmation"])) {
      return {
        insightType: "action_needed",
        summary: "Message requests follow-up or confirmation.",
        confidence: 0.76,
        shouldCreateProposal: false,
        shouldCreateDecision: false,
        proposalType: null,
        affectedDocumentSections: [],
        affectedBrainNodes: [],
        oldUnderstanding: null,
        newUnderstanding: null,
        decisionStatement: null,
        impactSummary: {
          scopeImpact: "low",
          engineeringImpact: "medium",
          clientExpectationImpact: "medium",
          summary: "Action is required, but accepted truth should not change automatically."
        },
        uncertainty: ["Follow-up is required before any truth-affecting change."]
      };
    }

    if (containsAny(text, ["status update", "moved to in progress", "moved to done", "marked complete", "changed status"])) {
      return {
        insightType: "info",
        summary: "Message is a provider status update and should remain source evidence unless separately accepted through review.",
        confidence: 0.66,
        shouldCreateProposal: false,
        shouldCreateDecision: false,
        proposalType: null,
        affectedDocumentSections: [],
        affectedBrainNodes: [],
        oldUnderstanding: null,
        newUnderstanding: null,
        decisionStatement: null,
        impactSummary: {
          scopeImpact: "low",
          engineeringImpact: "medium",
          clientExpectationImpact: "low",
          summary: "Status updates are operational evidence and do not update accepted product truth by themselves."
        },
        uncertainty: ["Status-only evidence requires review before any product-truth change."]
      };
    }

    if (containsAny(text, ["approved", "go ahead", "looks good", "ship it"])) {
      return {
        insightType: "approval",
        summary: "Message contains an approval signal.",
        confidence: 0.9,
        shouldCreateProposal: true,
        shouldCreateDecision: true,
        proposalType: "decision_change",
        affectedDocumentSections: refs.sections,
        affectedBrainNodes: refs.nodes,
        oldUnderstanding: null,
        newUnderstanding: null,
        decisionStatement: bodyText,
        impactSummary: {
          scopeImpact: "medium",
          engineeringImpact: "medium",
          clientExpectationImpact: "high",
          summary: "Approval may change accepted product direction."
        },
        uncertainty: refs.sections.length > 0 && refs.nodes.length > 0 ? [] : ["Approval scope may still need manager review."]
      };
    }

    if (containsAny(text, ["decided", "we will use", "let's use", "go with"])) {
      return {
        insightType: "decision",
        summary: "Message states a product or implementation decision.",
        confidence: 0.91,
        shouldCreateProposal: true,
        shouldCreateDecision: true,
        proposalType: "decision_change",
        affectedDocumentSections: refs.sections,
        affectedBrainNodes: refs.nodes,
        oldUnderstanding: null,
        newUnderstanding: null,
        decisionStatement: bodyText,
        impactSummary: {
          scopeImpact: "medium",
          engineeringImpact: "medium",
          clientExpectationImpact: "medium",
          summary: "A decision candidate was identified."
        },
        uncertainty: []
      };
    }

    if (containsAny(text, ["no longer", "change from", "not x but", "not email"])) {
      return {
        insightType: "contradiction",
        summary: "Message appears to contradict current understanding.",
        confidence: 0.88,
        shouldCreateProposal: true,
        shouldCreateDecision: false,
        proposalType: "contradiction_resolution",
        affectedDocumentSections: refs.sections,
        affectedBrainNodes: refs.nodes,
        oldUnderstanding: null,
        newUnderstanding: null,
        decisionStatement: null,
        impactSummary: {
          scopeImpact: "medium",
          engineeringImpact: "medium",
          clientExpectationImpact: "high",
          summary: "Potential contradiction to accepted truth."
        },
        uncertainty: []
      };
    }

    if (containsAny(text, ["require", "need", "must", "should", "please add", "remove", "update", "switch", "change reporting", "change requirement"])) {
      return {
        insightType: "requirement_change",
        summary: "Message suggests a requirement change.",
        confidence: 0.9,
        shouldCreateProposal: true,
        shouldCreateDecision: false,
        proposalType: "requirement_change",
        affectedDocumentSections: refs.sections,
        affectedBrainNodes: refs.nodes,
        oldUnderstanding: null,
        newUnderstanding: null,
        decisionStatement: null,
        impactSummary: {
          scopeImpact: "medium",
          engineeringImpact: "medium",
          clientExpectationImpact: "high",
          summary: "Potential product requirement change."
        },
        uncertainty: []
      };
    }

    if (containsAny(text, ["clarify", "confirm", "?"])) {
      return {
        insightType: "clarification",
        summary: "Message asks for clarification or confirms details.",
        confidence: 0.74,
        shouldCreateProposal: false,
        shouldCreateDecision: false,
        proposalType: "clarification",
        affectedDocumentSections: [],
        affectedBrainNodes: [],
        oldUnderstanding: null,
        newUnderstanding: null,
        decisionStatement: null,
        impactSummary: {
          scopeImpact: "low",
          engineeringImpact: "low",
          clientExpectationImpact: "medium",
          summary: "Clarification may affect accepted truth if confirmed."
        },
        uncertainty: ["Intent is ambiguous and may be only informational."]
      };
    }

    return {
      insightType: "info",
      summary: "Message is informational and does not clearly change accepted truth.",
      confidence: 0.58,
      shouldCreateProposal: false,
      shouldCreateDecision: false,
      proposalType: null,
      affectedDocumentSections: [],
      affectedBrainNodes: [],
      oldUnderstanding: null,
      newUnderstanding: null,
      decisionStatement: null,
      impactSummary: {
        scopeImpact: "low",
        engineeringImpact: "low",
        clientExpectationImpact: "low",
        summary: "No truth-affecting change detected."
      },
      uncertainty: []
    };
  }

  private parseAffectedRefs(value: unknown): ValidatedRefs {
    if (!value || typeof value !== "object") {
      return { documentSectionIds: [], brainNodeIds: [] };
    }
    const refs = value as { documentSectionIds?: unknown; brainNodeIds?: unknown };
    return {
      documentSectionIds: Array.isArray(refs.documentSectionIds)
        ? refs.documentSectionIds.filter((item): item is string => typeof item === "string")
        : [],
      brainNodeIds: Array.isArray(refs.brainNodeIds)
        ? refs.brainNodeIds.filter((item): item is string => typeof item === "string")
        : []
    };
  }

  private shouldAutoClassifyThreads() {
    return this.env.BETA_COMMUNICATION_CHANGE_DETECTION_ENABLED !== false &&
      this.env.BETA_COMMUNICATION_AUTO_CLASSIFY_ENABLED !== false;
  }

  private shouldAutoCreateProposalJobs() {
    return this.env.BETA_COMMUNICATION_CHANGE_DETECTION_ENABLED !== false &&
      this.env.BETA_COMMUNICATION_AUTO_CANDIDATES_ENABLED === true &&
      this.env.BETA_COMMUNICATION_AUTO_PROPOSALS_ENABLED === true;
  }

}
