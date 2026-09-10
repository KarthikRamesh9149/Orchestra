import { describe, expect, it } from "vitest";
import { estimateAiCost, estimateTokens, pricingFromEnv } from "../src/lib/ai-ops/ai-cost.js";

describe("AI ops cost estimation", () => {
  it("estimates tokens from actual text length", () => {
    expect(estimateTokens("one two three four")).toBeGreaterThanOrEqual(4);
    expect(estimateTokens("")).toBe(0);
  });

  it("computes model, embedding, and rerank estimated cost", () => {
    const pricing = pricingFromEnv({
      SOCRATES_MODEL_FAST_INPUT_COST_PER_1M: 1,
      SOCRATES_MODEL_FAST_OUTPUT_COST_PER_1M: 2,
      SOCRATES_EMBEDDING_COST_PER_1M: 0.5,
      SOCRATES_RERANK_COST_PER_1K: 0.25
    });

    const cost = estimateAiCost({
      pricing,
      modelTier: "fast",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      embeddingTokens: 1_000_000,
      rerankUnits: 2_000
    });

    expect(cost.inputCostUsd).toBe(1);
    expect(cost.outputCostUsd).toBe(1);
    expect(cost.embeddingCostUsd).toBe(0.5);
    expect(cost.rerankCostUsd).toBe(0.5);
    expect(cost.totalCostUsd).toBe(3);
  });
});
