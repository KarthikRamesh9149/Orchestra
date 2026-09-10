/**
 * CHR-RAG Layer 5: Reranking.
 *
 * Applies page-context and selected-object biasing on top of raw scores,
 * deduplicates by source object, caps citations from the same source,
 * and returns the top-N final candidates.
 */

import type { RetrievalCandidate, RetrievalPlan, RetrievalSourceType, SourcePrecedence } from "./types.js";
import type { QueryIntent } from "./intent.js";

type PageContext =
  | "dashboard_general"
  | "dashboard_project"
  | "brain_overview"
  | "brain_graph"
  | "doc_viewer"
  | "live_doc"
  | "coding_requirements"
  | "client_view";

/** Source-type boost multipliers per page context. */
const PAGE_BOOST: Record<PageContext, Partial<Record<RetrievalSourceType, number>>> = {
  dashboard_general: {
    dashboard_snapshot: 2.0,
    change_proposal: 1.4,
    product_brain: 1.3,
    brain_node: 1.1,
  },
  dashboard_project: {
    dashboard_snapshot: 1.8,
    project_responsibility: 1.7,
    project_context: 1.45,
    project_diagram: 1.25,
    coding_requirements: 1.5,
    change_proposal: 1.5,
    decision_record: 1.3,
    product_brain: 1.5,
    brain_node: 1.2,
  },
  brain_overview: {
    brain_node: 1.8,
    product_brain: 2.0,
    change_proposal: 1.5,
    decision_record: 1.4,
    document_chunk: 1.0,
  },
  brain_graph: {
    brain_node: 2.0,
    product_brain: 1.4,
    change_proposal: 1.4,
    document_chunk: 1.1,
  },
  doc_viewer: {
    document_chunk: 2.0,
    product_brain: 1.1,
    change_proposal: 1.3,
    communication_message: 1.2,
  },
  live_doc: {
    live_doc_section: 2.2,
    project_diagram: 1.8,
    coding_requirements: 1.7,
    product_brain: 1.6,
    change_proposal: 1.3,
    decision_record: 1.2,
    communication_message: 1.1,
    document_chunk: 1.0,
  },
  coding_requirements: {
    coding_requirements: 2.4,
    project_diagram: 1.8,
    product_brain: 1.5,
    brain_node: 1.3,
    document_chunk: 1.2,
    project_context: 1.2,
  },
  client_view: {
    document_chunk: 1.5,
    brain_node: 1.2,
    dashboard_snapshot: 1.0,
  },
};

/** Intent-based source-type boost multipliers. */
const INTENT_BOOST: Record<QueryIntent, Partial<Record<RetrievalSourceType, number>>> = {
  current_truth: {
    live_doc_section: 2.2,
    brain_node: 1.5,
    product_brain: 2.0,
    change_proposal: 1.4,
    decision_record: 1.3,
  },
  original_source: {
    live_doc_section: 0.8,
    document_chunk: 1.8,
    project_context: 1.6,
    communication_message: 1.5,
  },
  change_history: {
    change_proposal: 2.0,
    communication_message: 1.4,
  },
  decision_history: {
    decision_record: 2.0,
    change_proposal: 1.3,
  },
  doc_local: {
    document_chunk: 2.0,
  },
  brain_local: {
    brain_node: 2.0,
  },
  communication_lookup: {
    communication_message: 2.0,
    project_context: 1.3,
  },
  manual_context: {
    project_context: 2.6,
    project_responsibility: 1.3,
    document_chunk: 1.1,
    communication_message: 1.1,
  },
  diagram_lookup: {
    project_diagram: 2.8,
    live_doc_section: 1.5,
    product_brain: 1.2,
    brain_node: 1.2,
    document_chunk: 1.1,
  },
  coding_requirements: {
    coding_requirements: 3.0,
    product_brain: 1.5,
    brain_node: 1.3,
    document_chunk: 1.2,
    project_context: 1.2,
    project_diagram: 1.1,
  },
  team_responsibility: {
    project_responsibility: 2.4,
    project_context: 1.5,
    dashboard_snapshot: 1.2,
  },
  comparison_or_diff: {
    live_doc_section: 1.4,
    change_proposal: 1.8,
    document_chunk: 1.3,
    brain_node: 1.2,
  },
  explain_for_role: {
    live_doc_section: 1.5,
    brain_node: 1.4,
    document_chunk: 1.3,
  },
  dashboard_status: {
    dashboard_snapshot: 2.0,
    change_proposal: 1.2,
  },
};

export interface RerankInput {
  candidates: RetrievalCandidate[];
  pageContext: PageContext;
  intent: QueryIntent;
  selectedRefId?: string;
  selectedSectionId?: string;
  selectedNodeId?: string;
  topK: number;
  /** Max citations from the same source container. */
  maxPerSource?: number;
  isClientContext: boolean;
  plan?: RetrievalPlan;
}

const PRECEDENCE_BOOST: Record<SourcePrecedence, number> = {
  accepted_truth: 2.2,
  accepted_changes: 1.8,
  accepted_decisions: 1.7,
  brain_graph: 1.6,
  source_evidence: 1.5,
  manual_context: 1.55,
  communication_evidence: 1.4,
  dashboard_facts: 2.4,
  team_context: 2.3,
  visual_artifact: 2.1,
  engineering_artifact: 2.5,
  client_safe_projection: 2.0,
};

const SOURCE_TO_PRECEDENCE: Record<RetrievalSourceType, SourcePrecedence> = {
  live_doc_section: "accepted_truth",
  document_chunk: "source_evidence",
  brain_node: "brain_graph",
  product_brain: "accepted_truth",
  change_proposal: "accepted_changes",
  decision_record: "accepted_decisions",
  dashboard_snapshot: "dashboard_facts",
  communication_message: "communication_evidence",
  project_responsibility: "team_context",
  project_context: "manual_context",
  project_diagram: "visual_artifact",
  coding_requirements: "engineering_artifact",
};

function planSourceBoost(candidate: RetrievalCandidate, plan?: RetrievalPlan): number {
  if (!plan) return 1.0;
  const precedence = candidate.sourcePrecedence ?? SOURCE_TO_PRECEDENCE[candidate.sourceType];
  const index = plan.sourcePrecedence.indexOf(precedence);
  if (index === -1) return 0.95;
  const positionalBoost = 1 + (plan.sourcePrecedence.length - index) * 0.08;
  return (PRECEDENCE_BOOST[precedence] ?? 1.0) * positionalBoost;
}

function citationAvailability(candidate: RetrievalCandidate): number {
  if (candidate.citationRef?.id && candidate.openTarget) return 1;
  if (candidate.openTarget) return 0.85;
  if (candidate.documentChunkId || candidate.documentSectionId || candidate.messageId || candidate.changeProposalId || candidate.decisionRecordId || candidate.artifactVersionId || candidate.responsibilityId || candidate.contextId || candidate.diagramId || candidate.codingRequirementsId) {
    return 0.65;
  }
  return 0.35;
}

export function rerank(input: RerankInput): RetrievalCandidate[] {
  const { candidates, pageContext, intent, selectedRefId, selectedSectionId, selectedNodeId, topK } = input;
  const maxPerSource = input.maxPerSource ?? 2;

  if (topK <= 0 || candidates.length === 0) return [];

  // Apply boosts and filter client-context.
  const scored = candidates
    .filter((c) => !input.isClientContext || !c.isInternalOnly)
    .filter((c) => !input.plan || !c.domain || !input.plan.forbiddenDomains.includes(c.domain))
    .map((c) => {
      let score = c.finalScore;
      const baseScore = score;

      // Page context boost.
      const pageBoost = PAGE_BOOST[pageContext]?.[c.sourceType] ?? 1.0;
      score *= pageBoost;

      // Intent boost.
      const intentBoost = INTENT_BOOST[intent]?.[c.sourceType] ?? 1.0;
      score *= intentBoost;

      const sourcePrecedenceBoost = planSourceBoost(c, input.plan);
      score *= sourcePrecedenceBoost;

      // Selected-object hard boost (3×).
      let selectedObjectBoost = 1.0;
      if (c.documentSectionId && c.documentSectionId === selectedSectionId) {
        selectedObjectBoost = input.plan?.selectedObjectBoost ?? 3.0;
        score *= selectedObjectBoost;
      }
      if (selectedRefId && c.id === selectedRefId) {
        selectedObjectBoost = input.plan?.selectedObjectBoost ?? 3.0;
        score *= selectedObjectBoost;
      }
      if (c.id === selectedNodeId) {
        selectedObjectBoost = input.plan?.selectedObjectBoost ?? 3.0;
        score *= selectedObjectBoost;
      }

      // Neighbor-section moderate boost (1.5×) for sections adjacent to the
      // selected section — weaker than the selected-object boost but still
      // surfaces nearby context above unrelated chunks.
      if (c.isNeighborSection) {
        score *= 1.5;
      }

      if (c.isGraphNeighbor) {
        score *= 1.45;
      }

      if (c.isLinkedEvidence) {
        score *= 1.25;
      }

      const graphScore = c.graphScore ?? (c.isGraphNeighbor || c.brainNodeId || c.brainEdgeId ? 1 : 0);
      const citationAvailabilityScore = c.citationAvailabilityScore ?? citationAvailability(c);
      score *= 1 + citationAvailabilityScore * 0.03;

      return {
        ...c,
        graphScore,
        sourcePrecedenceScore: c.sourcePrecedenceScore ?? sourcePrecedenceBoost,
        pageContextScore: c.pageContextScore ?? pageBoost,
        selectedObjectScore: c.selectedObjectScore ?? selectedObjectBoost,
        citationAvailabilityScore,
        finalScore: score,
        retrievalStage: "reranked" as const,
        whySelected:
          c.whySelected ??
          [
            c.sourcePrecedence ? `precedence=${c.sourcePrecedence}` : null,
            pageBoost !== 1 ? `pageBoost=${pageBoost.toFixed(2)}` : null,
            selectedObjectBoost !== 1 ? `selectedBoost=${selectedObjectBoost.toFixed(2)}` : null,
            graphScore > 0 ? "graph-linked" : null,
            `base=${baseScore.toFixed(3)}`
          ]
            .filter((part): part is string => Boolean(part))
            .join("; ")
      };
    });

  // Sort descending by final score.
  scored.sort((a, b) => b.finalScore - a.finalScore);

  // Deduplicate by id and enforce per-source cap.
  const seen = new Set<string>();
  const sourceCount = new Map<string, number>();
  const result: RetrievalCandidate[] = [];

  for (const candidate of scored) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);

    const sourceKey = candidate.containerId ?? candidate.id;
    const count = sourceCount.get(sourceKey) ?? 0;
    if (count >= maxPerSource) continue;

    sourceCount.set(sourceKey, count + 1);
    result.push(candidate);

    if (result.length >= topK) break;
  }

  return result;
}
