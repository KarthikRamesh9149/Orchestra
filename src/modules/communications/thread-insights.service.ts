import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { AppEnv } from "../../config/env.js";
import { buildMessageIntelligenceTelemetry, estimateAiCost, estimateTokens, getModelForTask, persistAiTelemetry, pricingFromEnv, type AiLimiter } from "../../lib/ai-ops/index.js";
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

export class ThreadInsightsService {
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

  async classifyThread(projectId: string, threadId: string, actorUserId: string | null) {
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
      this.telemetry.increment("orchestra_ai_limit_hits_total", { code: classifyLimit.code, scope: "thread_classification_project" });
      throw new Error("Socrates classification job limit exceeded");
    }

    const context = await this.impactResolver.buildThreadContext(projectId, threadId);
    const existingInsight = await this.prisma.threadInsight.findUnique?.({
      where: {
        threadId_threadStateHash: {
          threadId: context.thread.id,
          threadStateHash: context.threadStateHash
        }
      },
      include: { thread: true, generatedProposal: true, generatedDecision: true }
    });
    if (existingInsight) {
      if (actorUserId) {
        return this.get(projectId, existingInsight.id, actorUserId);
      }
      const refs = (existingInsight.affectedRefsJson ?? {}) as { documentSectionIds?: string[]; brainNodeIds?: string[] };
      return {
        id: existingInsight.id,
        threadId: existingInsight.threadId,
        provider: existingInsight.provider,
        insightType: existingInsight.insightType,
        status: existingInsight.status,
        summary: existingInsight.summary,
        confidence: toNumber(existingInsight.confidence),
        sourceMessageIds: Array.isArray(existingInsight.sourceMessageIdsJson) ? existingInsight.sourceMessageIdsJson : [],
        affectedDocumentSectionIds: Array.isArray(refs.documentSectionIds) ? refs.documentSectionIds : [],
        affectedBrainNodeIds: Array.isArray(refs.brainNodeIds) ? refs.brainNodeIds : [],
        generatedProposalId: existingInsight.generatedProposalId,
        generatedDecisionId: existingInsight.generatedDecisionId,
        openTargets: {
          thread: { targetType: "thread" as const, targetRef: { threadId: existingInsight.threadId } }
        }
      };
    }

    const prompt = buildMessageInsightPrompt({
      targetKind: "thread",
      content: [
        `Thread subject: ${context.thread.subject ?? "(none)"}`,
        ...context.threadMessages.map((item) => `${item.senderLabel} @ ${item.sentAt.toISOString()}: ${item.bodyText}`)
      ].join("\n"),
      acceptedProductBrainSummary: context.acceptedProductBrainSummary,
      candidateSections: context.candidateSections,
      candidateBrainNodes: context.candidateBrainNodes,
      acceptedChanges: context.acceptedChanges,
      acceptedDecisions: context.acceptedDecisions,
      unresolvedProposals: context.unresolvedProposals
    });
    const modelSelection = getModelForTask("thread_classification", {}, this.env);

    const output = await this.generationProvider.generateObject({
      schema: communicationInsightOutputSchema,
      systemPrompt: buildInsightClassifierSystemPrompt(),
      prompt,
      model: modelSelection.model,
      timeoutMs: this.env.SOCRATES_GENERATION_TIMEOUT_MS,
      task: "thread_classification",
      fallback: () =>
        this.threadFallback(
          context.thread.subject ?? "",
          context.threadMessages.map((item) => item.bodyText).join("\n"),
          context.candidateSections,
          context.candidateBrainNodes
        )
    });

    const policy = evaluateCommunicationTruthPolicy(output, context.candidateSections, context.candidateBrainNodes, {
      requireBrainNodeRefs: this.env.BETA_PRODUCT_BRAIN_MUTATION_FROM_COMMUNICATIONS !== false
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

    const insight = await this.prisma.threadInsight.upsert({
      where: {
        threadId_threadStateHash: {
          threadId: context.thread.id,
          threadStateHash: context.threadStateHash
        }
      },
      create: {
        projectId,
        connectorId: context.thread.connectorId,
        provider: context.thread.provider,
        threadId: context.thread.id,
        threadStateHash: context.threadStateHash,
        insightType: output.insightType,
        status: "detected",
        summary: output.summary,
        confidence: new Prisma.Decimal(confidence.toFixed(3)),
        shouldCreateProposal,
        shouldCreateDecision,
        proposalType: policy.proposalType,
        sourceMessageIdsJson: context.threadMessages.map((item) => item.id),
        affectedRefsJson: validatedRefs,
        evidenceJson: { sourceMessageIds: context.threadMessages.map((item) => item.id) },
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
        sourceMessageIdsJson: context.threadMessages.map((item) => item.id),
        affectedRefsJson: validatedRefs,
        evidenceJson: { sourceMessageIds: context.threadMessages.map((item) => item.id) },
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
      eventType: "thread_insight_created",
      entityType: "thread_insight",
      entityId: insight.id,
      payload: { threadId, insightType: insight.insightType, confidence }
    });
    this.telemetry.increment("communication_thread_insights_created_total", {
      insight_type: insight.insightType,
      provider: context.thread.provider
    });
    await persistAiTelemetry({
      auditService: this.auditService,
      metrics: this.telemetry,
      orgId: project.orgId,
      projectId,
      actorUserId: actorUserId ?? null,
      eventType: "message_intelligence_ai_telemetry",
      entityType: "thread_insight",
      entityId: insight.id,
      payload: buildMessageIntelligenceTelemetry({
        projectId,
        provider: context.thread.provider,
        threadId: context.thread.id,
        threadStateHash: context.threadStateHash,
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
      })
    }).catch(() => undefined);

    if ((shouldCreateProposal || shouldCreateDecision) && !insight.generatedProposalId && this.shouldAutoCreateProposalJobs()) {
      const key = jobKeys.generateChangeProposalFromInsight(insight.id);
      await this.prisma.jobRun.upsert({
        where: { idempotencyKey: key },
        update: {
          jobType: JobNames.generateChangeProposalFromInsight,
          status: "pending",
          payloadJson: { projectId, threadInsightId: insight.id, idempotencyKey: key }
        },
        create: {
          jobType: JobNames.generateChangeProposalFromInsight,
          status: "pending",
          idempotencyKey: key,
          payloadJson: { projectId, threadInsightId: insight.id, idempotencyKey: key }
        }
      });
      enqueueJobInBackground(
        this.prisma,
        this.jobs,
        JobNames.generateChangeProposalFromInsight,
        { projectId, threadInsightId: insight.id, idempotencyKey: key },
        key
      );
    }

    if (actorUserId) {
      return this.get(projectId, insight.id, actorUserId);
    }

    return {
      id: insight.id,
      threadId: insight.threadId,
      provider: insight.provider,
      insightType: insight.insightType,
      status: insight.status,
      summary: insight.summary,
      confidence: toNumber(insight.confidence),
      sourceMessageIds: Array.isArray(insight.sourceMessageIdsJson) ? insight.sourceMessageIdsJson : [],
      affectedDocumentSectionIds: Array.isArray((insight.affectedRefsJson as { documentSectionIds?: unknown })?.documentSectionIds)
        ? ((insight.affectedRefsJson as { documentSectionIds?: unknown }).documentSectionIds as string[])
        : [],
      affectedBrainNodeIds: Array.isArray((insight.affectedRefsJson as { brainNodeIds?: unknown })?.brainNodeIds)
        ? ((insight.affectedRefsJson as { brainNodeIds?: unknown }).brainNodeIds as string[])
        : [],
      generatedProposalId: insight.generatedProposalId,
      generatedDecisionId: insight.generatedDecisionId,
      openTargets: {
        thread: { targetType: "thread" as const, targetRef: { threadId: insight.threadId } }
      }
    };
  }

  async runClassificationJob(input: { projectId: string; threadId: string; idempotencyKey?: string }) {
    if (input.idempotencyKey) {
      await this.prisma.jobRun.upsert({
        where: { idempotencyKey: input.idempotencyKey },
        update: {
          jobType: JobNames.classifyThreadInsight,
          status: "running",
          startedAt: new Date(),
          finishedAt: null,
          lastError: null,
          attemptCount: { increment: 1 }
        },
        create: {
          jobType: JobNames.classifyThreadInsight,
          status: "running",
          idempotencyKey: input.idempotencyKey,
          startedAt: new Date(),
          attemptCount: 1
        }
      });
    }
    try {
      const result = await this.classifyThread(input.projectId, input.threadId, null);
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
            lastError: error instanceof Error ? error.message : "Unknown thread insight classification error"
          }
        });
      }
      throw error;
    }
  }

  async get(projectId: string, insightId: string, actorUserId: string) {
    await ensureCommunicationReadAccess(this.projectService, projectId, actorUserId);
    const insight = await this.prisma.threadInsight.findFirstOrThrow({
      where: { id: insightId, projectId },
      include: {
        thread: true,
        generatedProposal: true,
        generatedDecision: true
      }
    });

    const refs = (insight.affectedRefsJson ?? {}) as { documentSectionIds?: string[]; brainNodeIds?: string[] };
    return {
      id: insight.id,
      threadId: insight.threadId,
      provider: insight.provider,
      insightType: insight.insightType,
      status: insight.status,
      summary: insight.summary,
      confidence: toNumber(insight.confidence),
      sourceMessageIds: Array.isArray(insight.sourceMessageIdsJson) ? insight.sourceMessageIdsJson : [],
      affectedDocumentSectionIds: Array.isArray(refs.documentSectionIds) ? refs.documentSectionIds : [],
      affectedBrainNodeIds: Array.isArray(refs.brainNodeIds) ? refs.brainNodeIds : [],
      generatedProposalId: insight.generatedProposalId,
      generatedDecisionId: insight.generatedDecisionId,
      openTargets: {
        thread: { targetType: "thread" as const, targetRef: { threadId: insight.threadId } }
      }
    };
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
    const insight = await this.prisma.threadInsight.findFirstOrThrow({
      where: { id: insightId, projectId }
    });
    const refs = (insight.affectedRefsJson ?? {}) as { documentSectionIds?: string[]; brainNodeIds?: string[] };
    const sourceMessageIds = Array.isArray(insight.sourceMessageIdsJson)
      ? insight.sourceMessageIdsJson.filter((item): item is string => typeof item === "string")
      : [];
    if (sourceMessageIds.length === 0) {
      throw new Error("Thread insight has no source messages");
    }

    return this.proposalService.createProposalFromMessageInsight(projectId, insightId, actorUserId, {
      insight: {
        ...insight,
        messageId: sourceMessageIds[0]
      } as any,
      messageId: sourceMessageIds[0],
      sourceMessageIds,
      validatedRefs: {
        documentSectionIds: Array.isArray(refs.documentSectionIds) ? refs.documentSectionIds : [],
        brainNodeIds: Array.isArray(refs.brainNodeIds) ? refs.brainNodeIds : []
      },
      sourceKind: "thread"
    });
  }

  private threadFallback(
    subject: string,
    combinedText: string,
    candidateSections: CandidateRef[] = [],
    candidateBrainNodes: CandidateRef[] = []
  ): CommunicationInsightOutput {
    const text = `${subject}\n${combinedText}`.toLowerCase();
    const refs = fallbackAffectedRefs(text, candidateSections, candidateBrainNodes);
    if (text.includes("approved") || text.includes("go ahead")) {
      return {
        insightType: "approval",
        summary: "Thread contains an approval signal.",
        confidence: 0.9,
        shouldCreateProposal: true,
        shouldCreateDecision: true,
        proposalType: "decision_change",
        affectedDocumentSections: refs.sections,
        affectedBrainNodes: refs.nodes,
        oldUnderstanding: null,
        newUnderstanding: null,
        decisionStatement: combinedText,
        impactSummary: {
          scopeImpact: "medium",
          engineeringImpact: "medium",
          clientExpectationImpact: "high",
          summary: "Thread appears to approve a product direction."
        },
        uncertainty: refs.sections.length > 0 && refs.nodes.length > 0 ? [] : ["Exact approval scope may still need manager confirmation."]
      };
    }

    if (text.includes("decided") || text.includes("go with") || text.includes("let's go with")) {
      return {
        insightType: "decision",
        summary: "Thread contains a concrete decision signal.",
        confidence: 0.91,
        shouldCreateProposal: true,
        shouldCreateDecision: true,
        proposalType: "decision_change",
        affectedDocumentSections: refs.sections,
        affectedBrainNodes: refs.nodes,
        oldUnderstanding: null,
        newUnderstanding: null,
        decisionStatement: combinedText,
        impactSummary: {
          scopeImpact: "medium",
          engineeringImpact: "medium",
          clientExpectationImpact: "high",
          summary: "Thread appears to contain a concrete decision."
        },
        uncertainty: []
      };
    }

    return {
      insightType: "info",
      summary: "Thread is informational and does not clearly change accepted truth.",
      confidence: 0.55,
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
        summary: "No clear truth-affecting change was detected."
      },
      uncertainty: []
    };
  }

  private shouldAutoCreateProposalJobs() {
    return this.env.BETA_COMMUNICATION_CHANGE_DETECTION_ENABLED !== false &&
      this.env.BETA_COMMUNICATION_AUTO_CANDIDATES_ENABLED === true &&
      this.env.BETA_COMMUNICATION_AUTO_PROPOSALS_ENABLED === true;
  }

}
