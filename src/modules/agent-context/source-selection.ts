import type { AgentContextPackBudgetPreset } from "@prisma/client";
import type { AgentContextEvidenceCandidate, AgentContextSeedReference } from "./types.js";

const statusWeight: Record<string, number> = {
  current_accepted_truth: 100,
  accepted_change: 95,
  accepted_decision: 94,
  coding_requirement: 86,
  diagram: 70,
  original_source: 68,
  manual_context: 64,
  transcript_evidence: 62,
  communication_evidence: 60,
  responsibility_task: 58,
  dashboard_signal: 45,
  pending_suggestion: 20,
  limitation: 0
};

const budgetLimit: Record<AgentContextPackBudgetPreset, number> = {
  compact: 6,
  normal: 10,
  detailed: 16
};

export function filterAgentContextEvidenceForMvp(
  candidates: AgentContextEvidenceCandidate[],
  options: { mvpMode: boolean; enabledProviders: string[] }
) {
  if (!options.mvpMode) return { allowed: candidates, excluded: [] as AgentContextEvidenceCandidate[] };
  const allowedProviders = new Set(
    options.enabledProviders.length
      ? options.enabledProviders
      : ["manual_import", "fireflies_ai", "slack", "clickup", "granola", "microsoft_teams"]
  );
  const allowed: AgentContextEvidenceCandidate[] = [];
  const excluded: AgentContextEvidenceCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate.provider || allowedProviders.has(candidate.provider)) {
      allowed.push(candidate);
    } else {
      excluded.push(candidate);
    }
  }
  return { allowed, excluded };
}

export function rankAgentContextSources(
  candidates: AgentContextEvidenceCandidate[],
  options: { budgetPreset: AgentContextPackBudgetPreset; seedReference?: AgentContextSeedReference }
) {
  const deduped = new Map<string, AgentContextEvidenceCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.sourceRefType}:${candidate.sourceRefId}`;
    const previous = deduped.get(key);
    if (!previous || score(candidate, options.seedReference) >= score(previous, options.seedReference)) {
      deduped.set(key, candidate);
    }
  }
  return Array.from(deduped.values())
    .sort((left, right) => score(right, options.seedReference) - score(left, options.seedReference))
    .slice(0, budgetLimit[options.budgetPreset])
    .map((candidate, index) => ({ ...candidate, sortOrder: index }));
}

function score(candidate: AgentContextEvidenceCandidate, seedReference?: AgentContextSeedReference) {
  const seedBoost =
    seedReference &&
    (candidate.sourceRefId === seedReference.id ||
      candidate.sourceRefType === seedReference.type ||
      candidate.id === seedReference.id)
      ? 40
      : 0;
  return (statusWeight[candidate.evidenceStatus] ?? 10) + candidate.score + seedBoost + (candidate.citation ? 5 : 0);
}

export function isCurrentTruthEvidence(candidate: Pick<AgentContextEvidenceCandidate, "sourceRefType" | "evidenceStatus">) {
  // Generated aggregate artifacts use an "accepted" lifecycle status too. That
  // status (or a projected boolean) cannot approve the raw material they contain.
  return (candidate.sourceRefType === "change_proposal" && candidate.evidenceStatus === "accepted_change")
    || (candidate.sourceRefType === "decision_record" && candidate.evidenceStatus === "accepted_decision");
}
