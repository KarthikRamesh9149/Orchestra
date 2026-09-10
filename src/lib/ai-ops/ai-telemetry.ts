import type { Prisma } from "@prisma/client";
import type { Logger } from "pino";
import type { AuditService } from "../../modules/audit/service.js";
import type { TelemetryService } from "../observability/telemetry.js";
import { aiCostEstimateSchema, aiLatencyBreakdownSchema, type AiCacheTelemetry, type AiCostEstimate, type AiLatencyBreakdown, type AiModelTier } from "./ai-ops-schemas.js";

const SENSITIVE_KEY_PATTERN = /(api[-_]?key|secret|token|authorization|password|credential|oauth|prompt|messagebody|bodytext|bodyhtml|providerpermalink|rawmetadata)/i;
const SAFE_ACCOUNTING_KEYS = new Set([
  "tokencount",
  "tokenestimate",
  "tokenestimates",
  "tokenusage",
  "inputtokens",
  "outputtokens",
  "prompttokens",
  "completiontokens",
  "evidencetokens",
  "historytokens",
  "totaltokens",
  "promptbuildms"
]);

function isClientSafeInternalKey(key: string) {
  const normalized = key.toLowerCase();
  if (
    normalized === "actorid" ||
    normalized === "userid" ||
    normalized === "acceptedby" ||
    normalized.includes("messageid") ||
    normalized.includes("threadid") ||
    normalized.includes("proposalid") ||
    normalized.includes("decisionid") ||
    normalized.includes("connectorid") ||
    normalized.includes("credentialsref") ||
    normalized.includes("providerpermalink")
  ) {
    return true;
  }

  if (normalized.includes("provider") && (normalized.includes("ref") || normalized.includes("id"))) {
    return true;
  }

  return (
    (normalized.includes("message") || normalized.includes("thread") || normalized.includes("proposal")) &&
    (normalized.includes("ref") || normalized.includes("link"))
  );
}

export function redactAiTelemetry(value: unknown, options: { clientSafe?: boolean } = {}): unknown {
  if (Array.isArray(value)) return value.map((item) => redactAiTelemetry(item, options));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();
    if (
      !SAFE_ACCOUNTING_KEYS.has(normalizedKey) &&
      (SENSITIVE_KEY_PATTERN.test(key) || (options.clientSafe && isClientSafeInternalKey(key)))
    ) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = redactAiTelemetry(nested, options);
    }
  }
  return result;
}

export interface SocratesAiTelemetryInput {
  requestId: string;
  orgId: string;
  projectId: string;
  actorId: string | null;
  actorRole: string;
  sessionId: string;
  assistantMessageId?: string | null;
  intent: string;
  pageContext: string;
  selectedRef?: unknown;
  viewerStatePresent?: boolean;
  retrievalDomains: string[];
  rawCandidateCount: number;
  candidateCountByDomain: Record<string, number>;
  rerankedCandidateCount: number;
  finalEvidenceCount: number;
  finalEvidenceCountByDomain: Record<string, number>;
  finalEvidence: Array<{ id: string; type: string }>;
  citationsReturned: unknown[];
  openTargetsReturned: unknown[];
  droppedCitations: Array<{ type?: string; refId?: string; reason: string }>;
  droppedOpenTargets: Array<{ type?: string; refId?: string; reason: string }>;
  tokenUsage: { input: number; output: number; evidence: number; history: number; total: number };
  cache: AiCacheTelemetry;
  model: { provider: string; model: string; tier: AiModelTier; strategy: string; rationale?: string[] };
  rerank: { provider: string; count: number; latencyMs: number; fallbackReason?: string | null };
  latency: AiLatencyBreakdown;
  cost: Partial<AiCostEstimate> & { totalCostUsd: number };
  degraded: boolean;
  degradationReason?: string | null;
  schemaRepairAttemptCount: number;
  failedAnswerSchema: boolean;
  lowEvidence: boolean;
  noCitation: boolean;
  roleSafetyFilterCount: number;
  budgetTruncated: boolean;
  truncationReason?: string | null;
  selectedEvidencePreserved: boolean;
}

export function buildSocratesAiTelemetry(input: SocratesAiTelemetryInput) {
  const cost = aiCostEstimateSchema.parse({
    inputCostUsd: input.cost.inputCostUsd ?? 0,
    outputCostUsd: input.cost.outputCostUsd ?? 0,
    embeddingCostUsd: input.cost.embeddingCostUsd ?? 0,
    rerankCostUsd: input.cost.rerankCostUsd ?? 0,
    totalCostUsd: input.cost.totalCostUsd
  });
  return {
    telemetrySchemaVersion: 1,
    kind: "socrates_answer",
    ...input,
    latency: aiLatencyBreakdownSchema.parse(input.latency),
    cost,
    droppedCitationCount: input.droppedCitations.length,
    droppedOpenTargetCount: input.droppedOpenTargets.length
  };
}

export function buildMessageIntelligenceTelemetry(input: {
  projectId: string;
  provider: string;
  threadId?: string | null;
  messageId?: string | null;
  bodyHash?: string | null;
  threadStateHash?: string | null;
  classifierModel: string;
  modelTier: AiModelTier;
  promptTokens: number;
  evidenceTokens: number;
  outputTokens: number;
  retrievalCandidateCount: number;
  affectedRefsCandidateCount: number;
  invalidAffectedRefsDropped: number;
  confidenceBeforePolicy: number;
  confidenceAfterPolicy: number;
  insightType: string;
  shouldCreateProposalModel: boolean;
  shouldCreateProposalBackend: boolean;
  shouldCreateDecisionModel: boolean;
  shouldCreateDecisionBackend: boolean;
  proposalGenerated: boolean;
  decisionGenerated: boolean;
  latencyMs: number;
  estimatedCostUsd: number;
  schemaRepairAttempts: number;
  classifierFallbackUsed: boolean;
  duplicateOutcome: string;
}) {
  return {
    telemetrySchemaVersion: 1,
    kind: "message_intelligence",
    ...input
  };
}

export async function persistAiTelemetry(input: {
  auditService: AuditService;
  logger?: Logger;
  metrics?: TelemetryService;
  orgId: string;
  projectId?: string | null;
  actorUserId?: string | null;
  eventType: "socrates_ai_telemetry" | "message_intelligence_ai_telemetry";
  entityType: string;
  entityId?: string | null;
  payload: unknown;
  clientSafe?: boolean;
}) {
  const redacted = redactAiTelemetry(input.payload, { clientSafe: input.clientSafe }) as Prisma.InputJsonValue;
  input.logger?.info({ aiTelemetry: redacted }, input.eventType);
  input.metrics?.increment("orchestra_ai_telemetry_events_total", { event_type: input.eventType });
  await input.auditService.record({
    orgId: input.orgId,
    projectId: input.projectId ?? undefined,
    actorUserId: input.actorUserId ?? undefined,
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId ?? undefined,
    payload: redacted
  });
}
