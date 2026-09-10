import { z } from "zod";

export const aiModelTierSchema = z.enum(["fast", "high_quality", "fallback", "deterministic_fallback"]);
export type AiModelTier = z.infer<typeof aiModelTierSchema>;

export const aiModelTaskSchema = z.enum([
  "socrates_answer",
  "socrates_suggestion",
  "socrates_schema_repair",
  "message_classification",
  "thread_classification",
  "summary_generation",
  "rerank",
  "fallback_answer"
]);
export type AiModelTask = z.infer<typeof aiModelTaskSchema>;

export const degradationReasonSchema = z.enum([
  "none",
  "embedding_provider_failed",
  "retrieval_domain_failed",
  "all_retrieval_failed",
  "reranker_failed",
  "generation_provider_failed",
  "model_timeout",
  "malformed_json_answer",
  "schema_repair_failed",
  "citation_validation_failed",
  "open_target_validation_failed",
  "cache_unavailable",
  "telemetry_unavailable",
  "budget_exceeded_before_generation",
  "low_evidence"
]);
export type AiDegradationReason = z.infer<typeof degradationReasonSchema>;

export const aiCostEstimateSchema = z.object({
  inputCostUsd: z.number().min(0).default(0),
  outputCostUsd: z.number().min(0).default(0),
  embeddingCostUsd: z.number().min(0).default(0),
  rerankCostUsd: z.number().min(0).default(0),
  totalCostUsd: z.number().min(0)
});
export type AiCostEstimate = z.infer<typeof aiCostEstimateSchema>;

export const aiCacheTelemetrySchema = z.object({
  hit: z.boolean(),
  namespace: z.string(),
  safetyClass: z.enum(["no_cache", "role_project_context_safe", "suggestion_safe", "unavailable"]),
  keyClass: z.string().optional()
});
export type AiCacheTelemetry = z.infer<typeof aiCacheTelemetrySchema>;

export const aiLatencyBreakdownSchema = z.object({
  totalMs: z.number().min(0),
  retrievalMs: z.number().min(0).default(0),
  embeddingMs: z.number().min(0).default(0),
  rerankMs: z.number().min(0).default(0),
  promptBuildMs: z.number().min(0).default(0),
  generationMs: z.number().min(0).default(0),
  validationMs: z.number().min(0).default(0)
});
export type AiLatencyBreakdown = z.infer<typeof aiLatencyBreakdownSchema>;

export const aiLimitCodeSchema = z.enum([
  "allowed",
  "socrates_rate_limited",
  "socrates_project_rate_limited",
  "socrates_stream_limit_exceeded",
  "socrates_cost_budget_exceeded",
  "socrates_generation_timeout",
  "socrates_evidence_budget_exceeded",
  "socrates_classification_job_limit_exceeded"
]);
export type AiLimitCode = z.infer<typeof aiLimitCodeSchema>;
