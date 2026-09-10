import type { AiModelTask, AiModelTier } from "./ai-ops-schemas.js";

export interface AiModelStrategyEnv {
  SOCRATES_MODEL?: string;
  SOCRATES_ESCALATION_MODEL?: string;
  SOCRATES_ROUTER_MODEL?: string;
  SOCRATES_MODEL_FAST?: string;
  SOCRATES_MODEL_HIGH_QUALITY?: string;
  SOCRATES_MODEL_FALLBACK?: string;
  SOCRATES_CLASSIFIER_MODEL?: string;
  SOCRATES_SUMMARY_MODEL?: string;
  SOCRATES_RERANK_MODEL?: string;
  SOCRATES_MODEL_STRATEGY?: string;
  SOCRATES_ESCALATE_ON_LOW_CONFIDENCE?: boolean;
  SOCRATES_ESCALATE_ON_MULTI_SOURCE_CONFLICT?: boolean;
  SOCRATES_ESCALATE_ON_ARTIFACT_GENERATION?: boolean;
  SOCRATES_ENABLE_MODEL_FALLBACK?: boolean;
  SOCRATES_ENABLE_EVIDENCE_ONLY_DEGRADED_MODE?: boolean;
  OPENAI_API_KEY?: string;
  OPENAI_GENERATION_MODEL?: string;
}

export interface AiModelSelection {
  task: AiModelTask;
  tier: AiModelTier;
  model: string;
  provider: "openai" | "mock" | "deterministic";
  strategy: string;
  rationale: string[];
}

export function getModelForTask(
  task: AiModelTask,
  context: {
    intent?: string;
    pageContext?: string;
    hardQuery?: boolean;
    lowEvidence?: boolean;
    multiSourceConflict?: boolean;
    artifactGeneration?: boolean;
    providerFailure?: boolean;
    isClientContext?: boolean;
  },
  env: AiModelStrategyEnv
): AiModelSelection {
  const strategy = env.SOCRATES_MODEL_STRATEGY ?? "auto";
  const rationale: string[] = [];
  let tier: AiModelTier = "fast";

  if (context.providerFailure) {
    tier = env.SOCRATES_ENABLE_MODEL_FALLBACK === false ? "deterministic_fallback" : "fallback";
    rationale.push("provider_failure");
  } else if (["fast", "cheap", "low_cost"].includes(strategy)) {
    tier = "fast";
    rationale.push(`strategy:${strategy}`);
  } else if (["high_quality", "quality", "escalated"].includes(strategy)) {
    tier = "high_quality";
    rationale.push(`strategy:${strategy}`);
  } else if (["deterministic", "deterministic_fallback"].includes(strategy)) {
    tier = "deterministic_fallback";
    rationale.push(`strategy:${strategy}`);
  } else if (context.lowEvidence && env.SOCRATES_ESCALATE_ON_LOW_CONFIDENCE) {
    tier = "high_quality";
    rationale.push("low_confidence_escalation");
  } else if (context.multiSourceConflict && env.SOCRATES_ESCALATE_ON_MULTI_SOURCE_CONFLICT) {
    tier = "high_quality";
    rationale.push("multi_source_conflict_escalation");
  } else if (context.artifactGeneration && env.SOCRATES_ESCALATE_ON_ARTIFACT_GENERATION) {
    tier = "high_quality";
    rationale.push("artifact_generation_escalation");
  } else if (context.lowEvidence) {
    tier = "deterministic_fallback";
    rationale.push("low_evidence");
  } else if (
    task === "socrates_answer" &&
    (context.hardQuery ||
      ["comparison_or_diff", "current_truth", "original_source", "change_history", "decision_history", "brain_local", "doc_local"].includes(context.intent ?? ""))
  ) {
    tier = "high_quality";
    rationale.push(context.hardQuery ? "hard_query" : `intent:${context.intent}`);
  } else if (task === "fallback_answer") {
    tier = "fallback";
    rationale.push("fallback_task");
  } else if (task === "socrates_schema_repair" || task === "socrates_suggestion" || task.includes("classification")) {
    tier = "fast";
    rationale.push("fast_task");
  }

  return {
    task,
    tier,
    model: modelForTier(task, tier, env),
    provider: providerForTier(tier, env),
    strategy,
    rationale: rationale.length > 0 ? rationale : ["default_fast"]
  };
}

function modelForTier(task: AiModelTask, tier: AiModelTier, env: AiModelStrategyEnv) {
  const defaultModel = env.SOCRATES_MODEL || env.SOCRATES_MODEL_FAST || env.OPENAI_GENERATION_MODEL || "gpt-5.4-mini";
  const escalationModel =
    env.SOCRATES_ESCALATION_MODEL || env.SOCRATES_MODEL_HIGH_QUALITY || env.SOCRATES_MODEL_FALLBACK || defaultModel;
  const routerModel =
    env.SOCRATES_ROUTER_MODEL || env.SOCRATES_CLASSIFIER_MODEL || env.SOCRATES_SUMMARY_MODEL || defaultModel;
  const rerankModel = env.SOCRATES_RERANK_MODEL || routerModel;

  if (task === "message_classification" || task === "thread_classification") {
    return routerModel;
  }
  if (task === "summary_generation" || task === "socrates_schema_repair" || task === "socrates_suggestion") {
    return routerModel;
  }
  if (task === "rerank") {
    return rerankModel;
  }
  if (tier === "high_quality") return escalationModel;
  if (tier === "fallback") return escalationModel;
  if (tier === "deterministic_fallback") return "deterministic";
  return defaultModel;
}

function providerForTier(tier: AiModelTier, env: AiModelStrategyEnv): AiModelSelection["provider"] {
  if (tier === "deterministic_fallback") return "deterministic";
  if (env.OPENAI_API_KEY) return "openai";
  return "mock";
}

export function validateProductionModelConfig(env: AiModelStrategyEnv) {
  const reasons: string[] = [];
  for (const field of ["SOCRATES_MODEL", "SOCRATES_ESCALATION_MODEL", "SOCRATES_ROUTER_MODEL", "SOCRATES_RERANK_MODEL"] as const) {
    if (!env[field]?.trim()) reasons.push(`${field} is required in production`);
  }
  if (env.SOCRATES_ENABLE_MODEL_FALLBACK === false) {
    reasons.push("SOCRATES_ENABLE_MODEL_FALLBACK must be true in production");
  }
  if (env.SOCRATES_ENABLE_EVIDENCE_ONLY_DEGRADED_MODE === false) {
    reasons.push("SOCRATES_ENABLE_EVIDENCE_ONLY_DEGRADED_MODE must be true in production");
  }
  return { valid: reasons.length === 0, reasons };
}
