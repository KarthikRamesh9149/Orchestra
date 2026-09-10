import { describe, expect, it } from "vitest";
import { getModelForTask, validateProductionModelConfig } from "../src/lib/ai-ops/ai-model-strategy.js";

const env = {
  SOCRATES_MODEL: "gpt-5.4-mini",
  SOCRATES_ESCALATION_MODEL: "gpt-5.5",
  SOCRATES_ROUTER_MODEL: "gpt-5.4-nano",
  SOCRATES_RERANK_MODEL: "gpt-5.4-nano",
  SOCRATES_MODEL_STRATEGY: "auto",
  SOCRATES_ESCALATE_ON_LOW_CONFIDENCE: true,
  SOCRATES_ESCALATE_ON_MULTI_SOURCE_CONFLICT: true,
  SOCRATES_ESCALATE_ON_ARTIFACT_GENERATION: true,
  SOCRATES_ENABLE_MODEL_FALLBACK: true,
  SOCRATES_ENABLE_EVIDENCE_ONLY_DEGRADED_MODE: true
};

describe("AI model strategy", () => {
  it("uses high-quality tier for hard Socrates answers", () => {
    const selected = getModelForTask("socrates_answer", {
      intent: "comparison_or_diff",
      hardQuery: true,
      lowEvidence: false,
      isClientContext: false
    }, env);

    expect(selected.tier).toBe("high_quality");
    expect(selected.model).toBe("gpt-5.5");
    expect(selected.rationale).toContain("hard_query");
  });

  it("uses router model for suggestions and classification", () => {
    expect(getModelForTask("socrates_suggestion", {}, env).tier).toBe("fast");
    expect(getModelForTask("socrates_suggestion", {}, env).model).toBe("gpt-5.4-nano");
    expect(getModelForTask("message_classification", {}, env).model).toBe("gpt-5.4-nano");
  });

  it("uses the Socrates default model for normal answers", () => {
    const selected = getModelForTask("socrates_answer", {}, env);
    expect(selected.tier).toBe("fast");
    expect(selected.model).toBe("gpt-5.4-mini");
  });

  it("uses escalation model for low-confidence answers when enabled", () => {
    const selected = getModelForTask("socrates_answer", { lowEvidence: true }, env);
    expect(selected.tier).toBe("high_quality");
    expect(selected.model).toBe("gpt-5.5");
    expect(selected.rationale).toContain("low_confidence_escalation");
  });

  it("uses escalation model for multi-source conflicts", () => {
    const selected = getModelForTask("socrates_answer", { multiSourceConflict: true }, env);
    expect(selected.tier).toBe("high_quality");
    expect(selected.model).toBe("gpt-5.5");
    expect(selected.rationale).toContain("multi_source_conflict_escalation");
  });

  it("uses escalation model for artifact generation", () => {
    const selected = getModelForTask("socrates_answer", { artifactGeneration: true }, env);
    expect(selected.tier).toBe("high_quality");
    expect(selected.model).toBe("gpt-5.5");
    expect(selected.rationale).toContain("artifact_generation_escalation");
  });

  it("uses the rerank model for reranking", () => {
    const selected = getModelForTask("rerank", {}, env);
    expect(selected.model).toBe("gpt-5.4-nano");
  });

  it("honors explicit Socrates model strategy overrides", () => {
    expect(getModelForTask("socrates_answer", { hardQuery: true }, { ...env, SOCRATES_MODEL_STRATEGY: "fast" }).model).toBe("gpt-5.4-mini");
    expect(getModelForTask("socrates_answer", {}, { ...env, SOCRATES_MODEL_STRATEGY: "high_quality" }).model).toBe("gpt-5.5");
    expect(getModelForTask("socrates_answer", { hardQuery: true }, { ...env, SOCRATES_MODEL_STRATEGY: "deterministic" }).provider).toBe("deterministic");
  });

  it("selects OpenAI without allowing OPENAI_GENERATION_MODEL to override Socrates routing", () => {
    const selected = getModelForTask("socrates_answer", {}, {
      ...env,
      OPENAI_API_KEY: "sk-test-openai-key",
      OPENAI_GENERATION_MODEL: "gpt-4.1-mini"
    });

    expect(selected.provider).toBe("openai");
    expect(selected.model).toBe("gpt-5.4-mini");
  });

  it("rejects missing production model config", () => {
    const result = validateProductionModelConfig({ ...env, SOCRATES_ESCALATION_MODEL: "" });
    expect(result.valid).toBe(false);
    expect(result.reasons.join(" ")).toContain("SOCRATES_ESCALATION_MODEL");
  });
});
