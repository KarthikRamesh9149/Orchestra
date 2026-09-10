import type { RetrievalCandidate, RetrievalIntent } from "./types.js";

export interface HardQueryResult {
  isHard: boolean;
  reasons: string[];
  scoreVariance: number;
}
export function detectHardQuery(input: {
  intent: RetrievalIntent;
  candidates: RetrievalCandidate[];
  isClientContext?: boolean;
}): HardQueryResult {
  const reasons: string[] = [];
  if (input.intent === "no_evidence_or_ambiguous" || input.intent === "comparison_or_diff") {
    reasons.push(`intent=${input.intent}`);
  }

  const scores = input.candidates.map((candidate) => candidate.finalScore).sort((a, b) => b - a);
  const top = scores[0] ?? 0;
  const second = scores[1] ?? 0;
  const scoreVariance = Math.abs(top - second);
  if (input.candidates.length > 3 && scoreVariance < 0.08) {
    reasons.push("low_score_variance");
  }
  if (top > 0 && top < 0.45) {
    reasons.push("weak_top_score");
  }

  const hasAcceptedTruth = input.candidates.some((candidate) =>
    ["accepted_truth", "accepted_change", "accepted_decision"].includes(candidate.evidenceRole ?? "")
  );
  const hasOriginalEvidence = input.candidates.some((candidate) =>
    ["source_evidence", "communication_evidence"].includes(candidate.evidenceRole ?? "")
  );
  if (hasAcceptedTruth && hasOriginalEvidence && scoreVariance < 0.15) {
    reasons.push("accepted_truth_and_source_evidence_close");
  }

  if (input.isClientContext) {
    reasons.push("client_context_external_rerank_blocked");
  }

  return {
    isHard: reasons.some((reason) => reason !== "client_context_external_rerank_blocked"),
    reasons,
    scoreVariance
  };
}
