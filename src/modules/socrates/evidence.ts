import type { RetrievalCandidate, RetrievalIntent } from "../../lib/retrieval/types.js";
import {
  compressEvidencePack,
  estimateTokens,
  type CompressedEvidencePack,
  type EvidenceBudgetConfig,
  type EvidencePackTelemetry
} from "../../lib/retrieval/evidence-pack.js";

export interface SocratesBudgetConfig {
  maxContextTokens: number;
  maxHistoryTurns: number;
  rerankTopK: number;
  maxEvidenceItems?: number;
  maxEvidenceExcerptChars?: number;
  maxSameSourceItems?: number;
  maxOutputTokens?: number;
  perIntentLimits?: EvidenceBudgetConfig["perIntentLimits"];
}

export type SocratesEvidenceTelemetry = EvidencePackTelemetry;

export type SocratesEvidencePack = CompressedEvidencePack;

export { estimateTokens };

export function buildSocratesEvidencePack(input: {
  candidates: RetrievalCandidate[];
  userQuery: string;
  recentHistory: Array<{ role: "user" | "assistant"; content: string }>;
  selectedRefId?: string;
  selectedSectionId?: string;
  selectedNodeId?: string;
  intent?: RetrievalIntent;
  isClientContext?: boolean;
  budget: SocratesBudgetConfig;
}): SocratesEvidencePack {
  return compressEvidencePack({
    candidates: input.candidates.slice(0, input.budget.rerankTopK),
    intent: input.intent ?? "current_truth",
    userQuery: input.userQuery,
    recentHistory: input.recentHistory,
    selectedRefId: input.selectedRefId,
    selectedSectionId: input.selectedSectionId,
    selectedNodeId: input.selectedNodeId,
    isClientContext: input.isClientContext,
    budget: {
      maxContextTokens: input.budget.maxContextTokens,
      maxHistoryTurns: input.budget.maxHistoryTurns,
      maxEvidenceItems: input.budget.maxEvidenceItems ?? input.budget.rerankTopK,
      maxEvidenceExcerptChars: input.budget.maxEvidenceExcerptChars ?? 900,
      maxSameSourceItems: input.budget.maxSameSourceItems ?? 2,
      maxOutputTokens: input.budget.maxOutputTokens ?? 900,
      perIntentLimits: input.budget.perIntentLimits
    }
  });
}
