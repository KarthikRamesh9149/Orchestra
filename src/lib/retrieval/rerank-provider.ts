import type { GenerationProvider } from "../ai/provider.js";
import { rerank, type RerankInput } from "./rerank.js";
import { detectHardQuery, type HardQueryResult } from "./hard-query.js";
import { llmRerank } from "./llm-reranker.js";
import type { RetrievalCandidate, RetrievalIntent } from "./types.js";

export type RerankProviderName = "none" | "deterministic" | "openai" | "llm";

export interface RerankProviderConfig {
  provider: RerankProviderName;
  maxCandidates: number;
  minCandidates?: number;
  topK: number;
  minScore: number;
  timeoutMs?: number;
  llmMaxCandidates: number;
  llmModel?: string;
  llmMaxOutputTokens?: number;
  llmEnabledForIntents: RetrievalIntent[];
  failOpenToDeterministic: boolean;
  generationProvider?: GenerationProvider;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(label)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
export interface RerankProviderTelemetry {
  rerankProvider: RerankProviderName;
  providerUsed: RerankProviderName;
  rerankCandidateCount: number;
  rerankLatencyMs: number;
  fallbackUsed: boolean;
  hardQuery: HardQueryResult;
  error?: string;
}

function externalSafeCandidates(candidates: RetrievalCandidate[], isClientContext: boolean) {
  return candidates.filter((candidate) => {
    if (!isClientContext) {
      return true;
    }
    return candidate.isClientSafe && !candidate.isInternalOnly;
  });
}

export async function rerankWithProvider(input: {
  deterministicInput: RerankInput;
  query: string;
  config: RerankProviderConfig;
}): Promise<{ candidates: RetrievalCandidate[]; telemetry: RerankProviderTelemetry }> {
  const started = Date.now();
  const deterministic = rerank(input.deterministicInput);
  const hardQuery = detectHardQuery({
    intent: input.deterministicInput.intent,
    candidates: deterministic,
    isClientContext: input.deterministicInput.isClientContext
  });
  const baseTelemetry = {
    rerankProvider: input.config.provider,
    rerankCandidateCount: Math.min(input.config.maxCandidates, input.deterministicInput.candidates.length),
    hardQuery
  };

  if (
    input.config.provider === "none" ||
    input.config.provider === "deterministic" ||
    deterministic.length < (input.config.minCandidates ?? 1)
  ) {
    return {
      candidates: deterministic.slice(0, input.config.topK),
      telemetry: {
        ...baseTelemetry,
        providerUsed: input.config.provider === "deterministic" ? "deterministic" : "none",
        fallbackUsed: false,
        rerankLatencyMs: Date.now() - started
      }
    };
  }

  try {
    const providerCandidates = externalSafeCandidates(
      deterministic.slice(0, input.config.maxCandidates),
      input.deterministicInput.isClientContext
    );
    if (providerCandidates.length === 0) {
      throw new Error("no_provider_safe_candidates");
    }

    const llmAllowed =
      hardQuery.isHard &&
      input.config.generationProvider &&
      input.config.llmEnabledForIntents.includes(input.deterministicInput.intent);
    if (!llmAllowed) {
      return {
        candidates: deterministic.slice(0, input.config.topK),
        telemetry: {
          ...baseTelemetry,
          providerUsed: "none",
          fallbackUsed: false,
          rerankLatencyMs: Date.now() - started
        }
      };
    }

    const candidates = await withTimeout(llmRerank({
      generationProvider: input.config.generationProvider!,
      query: input.query,
      candidates: providerCandidates.slice(0, input.config.llmMaxCandidates),
      topK: input.config.topK,
      model: input.config.llmModel,
      maxOutputTokens: input.config.llmMaxOutputTokens,
      timeoutMs: input.config.timeoutMs
    }), input.config.timeoutMs ?? 10_000, "reranker_timeout");
    return {
      candidates,
      telemetry: {
        ...baseTelemetry,
        providerUsed: input.config.provider,
        fallbackUsed: false,
        rerankLatencyMs: Date.now() - started
      }
    };
  } catch (error) {
    if (!input.config.failOpenToDeterministic) {
      throw error;
    }
    return {
      candidates: deterministic.slice(0, input.config.topK),
      telemetry: {
        ...baseTelemetry,
        providerUsed: "none",
        fallbackUsed: true,
        rerankLatencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}
