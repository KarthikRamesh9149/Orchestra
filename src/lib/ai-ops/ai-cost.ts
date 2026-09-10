import type { AiCostEstimate, AiModelTier } from "./ai-ops-schemas.js";

export interface AiPricing {
  fastInputPer1M: number;
  fastOutputPer1M: number;
  highQualityInputPer1M: number;
  highQualityOutputPer1M: number;
  fallbackInputPer1M: number;
  fallbackOutputPer1M: number;
  embeddingPer1M: number;
  rerankPer1K: number;
}

type PricingEnv = Partial<Record<
  | "SOCRATES_MODEL_FAST_INPUT_COST_PER_1M"
  | "SOCRATES_MODEL_FAST_OUTPUT_COST_PER_1M"
  | "SOCRATES_MODEL_HIGH_QUALITY_INPUT_COST_PER_1M"
  | "SOCRATES_MODEL_HIGH_QUALITY_OUTPUT_COST_PER_1M"
  | "SOCRATES_MODEL_FALLBACK_INPUT_COST_PER_1M"
  | "SOCRATES_MODEL_FALLBACK_OUTPUT_COST_PER_1M"
  | "SOCRATES_EMBEDDING_COST_PER_1M"
  | "SOCRATES_RERANK_COST_PER_1K",
  string | number | undefined
>>;

function numeric(value: string | number | undefined, fallback: number) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function estimateTokens(input: string | null | undefined) {
  if (!input) return 0;
  const words = input.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(words, Math.ceil(input.length / 4));
}

export function pricingFromEnv(env: PricingEnv): AiPricing {
  return {
    fastInputPer1M: numeric(env.SOCRATES_MODEL_FAST_INPUT_COST_PER_1M, 0),
    fastOutputPer1M: numeric(env.SOCRATES_MODEL_FAST_OUTPUT_COST_PER_1M, 0),
    highQualityInputPer1M: numeric(env.SOCRATES_MODEL_HIGH_QUALITY_INPUT_COST_PER_1M, 0),
    highQualityOutputPer1M: numeric(env.SOCRATES_MODEL_HIGH_QUALITY_OUTPUT_COST_PER_1M, 0),
    fallbackInputPer1M: numeric(env.SOCRATES_MODEL_FALLBACK_INPUT_COST_PER_1M, 0),
    fallbackOutputPer1M: numeric(env.SOCRATES_MODEL_FALLBACK_OUTPUT_COST_PER_1M, 0),
    embeddingPer1M: numeric(env.SOCRATES_EMBEDDING_COST_PER_1M, 0),
    rerankPer1K: numeric(env.SOCRATES_RERANK_COST_PER_1K, 0)
  };
}

function tierPricing(pricing: AiPricing, tier: AiModelTier) {
  if (tier === "high_quality") {
    return { input: pricing.highQualityInputPer1M, output: pricing.highQualityOutputPer1M };
  }
  if (tier === "fallback" || tier === "deterministic_fallback") {
    return { input: pricing.fallbackInputPer1M, output: pricing.fallbackOutputPer1M };
  }
  return { input: pricing.fastInputPer1M, output: pricing.fastOutputPer1M };
}

export function estimateAiCost(input: {
  pricing: AiPricing;
  modelTier: AiModelTier;
  inputTokens: number;
  outputTokens: number;
  embeddingTokens?: number;
  rerankUnits?: number;
}): AiCostEstimate {
  const selected = tierPricing(input.pricing, input.modelTier);
  const inputCostUsd = (Math.max(0, input.inputTokens) / 1_000_000) * selected.input;
  const outputCostUsd = (Math.max(0, input.outputTokens) / 1_000_000) * selected.output;
  const embeddingCostUsd = (Math.max(0, input.embeddingTokens ?? 0) / 1_000_000) * input.pricing.embeddingPer1M;
  const rerankCostUsd = (Math.max(0, input.rerankUnits ?? 0) / 1_000) * input.pricing.rerankPer1K;
  const totalCostUsd = inputCostUsd + outputCostUsd + embeddingCostUsd + rerankCostUsd;
  return {
    inputCostUsd,
    outputCostUsd,
    embeddingCostUsd,
    rerankCostUsd,
    totalCostUsd: Number(totalCostUsd.toFixed(8))
  };
}
