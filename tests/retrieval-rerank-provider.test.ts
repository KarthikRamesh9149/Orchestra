import { describe, expect, it, vi } from "vitest";
import { rerankWithProvider } from "../src/lib/retrieval/rerank-provider.js";
import type { GenerationProvider } from "../src/lib/ai/provider.js";
import type { RetrievalCandidate } from "../src/lib/retrieval/types.js";

function candidate(overrides: Partial<RetrievalCandidate>): RetrievalCandidate {
  return {
    id: overrides.id ?? "c1",
    sourceType: overrides.sourceType ?? "document_chunk",
    content: overrides.content ?? "content",
    label: overrides.label ?? "Evidence",
    finalScore: overrides.finalScore ?? 0.5,
    isClientSafe: overrides.isClientSafe ?? true,
    isInternalOnly: overrides.isInternalOnly ?? false,
    ...overrides
  };
}

const deterministicInput = {
  candidates: [candidate({ id: "a", finalScore: 0.7 }), candidate({ id: "b", finalScore: 0.6 })],
  pageContext: "brain_overview" as const,
  intent: "current_truth" as const,
  topK: 2,
  isClientContext: false
};

describe("rerank provider layer", () => {
  it("uses deterministic reranking by default", async () => {
    const result = await rerankWithProvider({
      deterministicInput,
      query: "What is current?",
      config: {
        provider: "deterministic",
        maxCandidates: 10,
        topK: 2,
        minScore: 0,
        llmMaxCandidates: 5,
        llmEnabledForIntents: ["comparison_or_diff"],
        failOpenToDeterministic: true
      }
    });

    expect(result.telemetry.providerUsed).toBe("deterministic");
    expect(result.candidates).toHaveLength(2);
  });

  it("uses OpenAI LLM reranker only for hard eligible queries and never sends client internal evidence", async () => {
    const provider: GenerationProvider = {
      generateObject: vi.fn(async () => ({ ranked: [{ id: "safe", score: 0.9, reason: "safe" }] }))
    };
    const result = await rerankWithProvider({
      deterministicInput: {
        candidates: [
          candidate({ id: "internal", isInternalOnly: true, finalScore: 0.99 }),
          candidate({ id: "safe", isInternalOnly: false, finalScore: 0.4 })
        ],
        pageContext: "client_view",
        intent: "comparison_or_diff",
        topK: 2,
        isClientContext: true
      },
      query: "Compare these",
      config: {
        provider: "openai",
        maxCandidates: 10,
        topK: 2,
        minScore: 0,
        llmMaxCandidates: 5,
        llmModel: "gpt-5.4-nano",
        llmMaxOutputTokens: 222,
        timeoutMs: 1234,
        llmEnabledForIntents: ["comparison_or_diff"],
        failOpenToDeterministic: true,
        generationProvider: provider
      }
    });

    expect(result.candidates.every((item) => !item.isInternalOnly)).toBe(true);
    expect(provider.generateObject).toHaveBeenCalledWith(expect.objectContaining({
      task: "rerank",
      model: "gpt-5.4-nano",
      maxOutputTokens: 222,
      timeoutMs: 1234
    }));
  });

  it("does not send client candidates to external rerankers unless explicitly client-safe", async () => {
    const provider: GenerationProvider = {
      generateObject: vi.fn(async () => ({ ranked: [{ id: "unsafe", score: 0.9, reason: "unsafe" }] }))
    };

    const result = await rerankWithProvider({
      deterministicInput: {
        candidates: [
          candidate({ id: "unsafe", isInternalOnly: false, isClientSafe: false, finalScore: 0.9 })
        ],
        pageContext: "client_view",
        intent: "comparison_or_diff",
        topK: 2,
        isClientContext: true
      },
      query: "Compare these",
      config: {
        provider: "openai",
        maxCandidates: 10,
        topK: 2,
        minScore: 0,
        llmMaxCandidates: 5,
        llmEnabledForIntents: ["comparison_or_diff"],
        failOpenToDeterministic: true,
        generationProvider: provider
      }
    });

    expect(provider.generateObject).not.toHaveBeenCalled();
    expect(result.telemetry.fallbackUsed).toBe(true);
    expect(result.telemetry.error).toBe("no_provider_safe_candidates");
  });
});
