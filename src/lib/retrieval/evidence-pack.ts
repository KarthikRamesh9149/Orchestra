import type { RetrievalCandidate, RetrievalIntent, SourcePrecedence } from "./types.js";

export interface EvidenceCard {
  evidenceId: string;
  sourceType: string;
  title: string;
  excerpt: string;
  whySelected: string;
  confidence: number;
  sourcePrecedence: SourcePrecedence | "unknown";
  citationRef?: {
    type: string;
    id: string;
    label?: string;
  };
  openTarget?: {
    targetType: string;
    targetRef: Record<string, unknown>;
  };
  trace: {
    artifactVersionId?: string;
    brainNodeId?: string;
    brainEdgeId?: string;
    documentSectionId?: string;
    documentChunkId?: string;
    messageId?: string;
    threadId?: string;
    changeProposalId?: string;
    decisionRecordId?: string;
    dashboardSnapshotId?: string;
    responsibilityId?: string;
    contextId?: string;
    contextChunkId?: string;
    diagramId?: string;
    codingRequirementsId?: string;
  };
}

export interface EvidenceBudgetConfig {
  maxContextTokens: number;
  maxHistoryTurns: number;
  maxEvidenceItems: number;
  maxEvidenceExcerptChars: number;
  maxSameSourceItems: number;
  maxOutputTokens: number;
  perIntentLimits?: Partial<Record<RetrievalIntent, number>>;
}

export interface EvidencePackTelemetry {
  requestedEvidenceCount: number;
  finalEvidenceCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  droppedCandidateCount: number;
  droppedForBudgetCount: number;
  droppedForSourceDiversityCount: number;
  preservedSelectedEvidenceCount: number;
  evidenceItemsBeforeBudget: number;
  evidenceItemsAfterBudget: number;
  budgetTruncated: boolean;
  truncationReason: string | null;
}

export interface CompressedEvidencePack {
  candidates: RetrievalCandidate[];
  evidenceCards: EvidenceCard[];
  citationCandidateIds: string[];
  telemetry: EvidencePackTelemetry;
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function defaultIntentLimit(intent: RetrievalIntent): number {
  switch (intent) {
    case "dashboard_status":
    case "team_responsibility":
      return 5;
    case "current_truth":
    case "doc_local":
    case "brain_local":
    case "explain_for_role":
      return 8;
    case "original_source":
    case "decision_history":
    case "communication_lookup":
    case "manual_context":
    case "diagram_lookup":
    case "coding_requirements":
      return 10;
    case "change_history":
    case "comparison_or_diff":
      return 12;
    case "no_evidence_or_ambiguous":
      return 4;
  }
}

function candidateText(candidate: RetrievalCandidate): string {
  return candidate.contextualContent ?? candidate.content;
}

function clampExcerpt(text: string, maxChars: number) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
}

function citationRefForCandidate(candidate: RetrievalCandidate): EvidenceCard["citationRef"] {
  if (candidate.citationRef?.id) return candidate.citationRef;
  if (candidate.documentChunkId) return { type: "document_chunk", id: candidate.documentChunkId, label: candidate.label };
  if (candidate.documentSectionId) return { type: "document_section", id: candidate.documentSectionId, label: candidate.label };
  if (candidate.messageId) return { type: "message", id: candidate.messageId, label: candidate.label };
  if (candidate.changeProposalId) return { type: "change_proposal", id: candidate.changeProposalId, label: candidate.label };
  if (candidate.decisionRecordId) return { type: "decision_record", id: candidate.decisionRecordId, label: candidate.label };
  if (candidate.dashboardSnapshotId) return { type: "dashboard_snapshot", id: candidate.dashboardSnapshotId, label: candidate.label };
  if (candidate.responsibilityId) return { type: "project_responsibility", id: candidate.responsibilityId, label: candidate.label };
  if (candidate.contextId) return { type: "project_context", id: candidate.contextId, label: candidate.label };
  if (candidate.diagramId) return { type: "project_diagram", id: candidate.diagramId, label: candidate.label };
  if (candidate.codingRequirementsId) {
    return { type: "coding_requirements", id: candidate.codingRequirementsId, label: candidate.label };
  }
  if (candidate.artifactVersionId && candidate.sourceType === "product_brain") {
    return { type: "product_brain", id: candidate.artifactVersionId, label: candidate.label };
  }
  if (candidate.brainNodeId) return { type: "brain_node", id: candidate.brainNodeId, label: candidate.label };
  return undefined;
}

function confidence(candidate: RetrievalCandidate) {
  return Math.max(0, Math.min(1, candidate.finalScore / Math.max(1, candidate.finalScore + 1)));
}

function sourceDiversityKey(candidate: RetrievalCandidate): string {
  return `${candidate.sourceType}:${candidate.containerId ?? candidate.documentSectionId ?? candidate.messageId ?? candidate.id}`;
}

function isSelectedCandidate(
  candidate: RetrievalCandidate,
  selectedRefId?: string,
  selectedSectionId?: string,
  selectedNodeId?: string
): boolean {
  return (
    Boolean(selectedRefId && candidate.id === selectedRefId) ||
    Boolean(selectedSectionId && candidate.documentSectionId === selectedSectionId) ||
    Boolean(selectedNodeId && (candidate.brainNodeId === selectedNodeId || candidate.id === selectedNodeId))
  );
}

export function buildEvidenceCards(input: {
  candidates: RetrievalCandidate[];
  maxExcerptChars: number;
  isClientContext?: boolean;
}): EvidenceCard[] {
  return input.candidates
    .filter((candidate) => !input.isClientContext || !candidate.isInternalOnly)
    .map((candidate, index) => {
      const citationRef = input.isClientContext && candidate.isInternalOnly ? undefined : citationRefForCandidate(candidate);
      const trace: EvidenceCard["trace"] = input.isClientContext
        ? {
            artifactVersionId: candidate.domain === "client_safe_brain" ? candidate.artifactVersionId : undefined,
            documentSectionId: candidate.documentSectionId,
            documentChunkId: candidate.documentChunkId,
            dashboardSnapshotId: candidate.dashboardSnapshotId,
            responsibilityId: candidate.responsibilityId
          }
        : {
            artifactVersionId: candidate.artifactVersionId,
            brainNodeId: candidate.brainNodeId,
            brainEdgeId: candidate.brainEdgeId,
            documentSectionId: candidate.documentSectionId,
            documentChunkId: candidate.documentChunkId,
            messageId: candidate.messageId,
            threadId: candidate.threadId,
            changeProposalId: candidate.changeProposalId,
            decisionRecordId: candidate.decisionRecordId,
            dashboardSnapshotId: candidate.dashboardSnapshotId,
            responsibilityId: candidate.responsibilityId,
            contextId: candidate.contextId,
            contextChunkId: candidate.contextChunkId,
            diagramId: candidate.diagramId,
            codingRequirementsId: candidate.codingRequirementsId
          };

      return {
        evidenceId: `ev_${index + 1}`,
        sourceType: candidate.domain === "client_safe_brain" ? "client_safe_brain" : candidate.sourceType,
        title: candidate.label,
        excerpt: clampExcerpt(candidateText(candidate), input.maxExcerptChars),
        whySelected:
          candidate.whySelected ??
          `${candidate.sourcePrecedence ?? "unknown"} evidence selected by deterministic reranker`,
        confidence: confidence(candidate),
        sourcePrecedence: candidate.sourcePrecedence ?? "unknown",
        citationRef,
        openTarget: input.isClientContext && candidate.isInternalOnly ? undefined : candidate.openTarget,
        trace
      };
    });
}

export function compressEvidencePack(input: {
  candidates: RetrievalCandidate[];
  intent: RetrievalIntent;
  userQuery: string;
  recentHistory: Array<{ role: "user" | "assistant"; content: string }>;
  selectedRefId?: string;
  selectedSectionId?: string;
  selectedNodeId?: string;
  isClientContext?: boolean;
  budget: EvidenceBudgetConfig;
}): CompressedEvidencePack {
  const intentLimit = input.budget.perIntentLimits?.[input.intent] ?? defaultIntentLimit(input.intent);
  const maxEvidenceItems = Math.min(input.budget.maxEvidenceItems, intentLimit);
  const selected = input.candidates.filter((candidate) =>
    isSelectedCandidate(candidate, input.selectedRefId, input.selectedSectionId, input.selectedNodeId)
  );
  const regular = input.candidates.filter((candidate) => !selected.includes(candidate));
  const ordered = [...selected, ...regular].filter((candidate) => !input.isClientContext || !candidate.isInternalOnly);

  const reservedPromptTokens = 900;
  const historyTokens = input.recentHistory
    .slice(-input.budget.maxHistoryTurns)
    .reduce((sum, turn) => sum + estimateTokens(turn.content.slice(0, 400)), 0);
  const queryTokens = estimateTokens(input.userQuery);
  const evidenceBudget = Math.max(0, input.budget.maxContextTokens - reservedPromptTokens - historyTokens - queryTokens);

  const kept: RetrievalCandidate[] = [];
  const sourceCounts = new Map<string, number>();
  const hasDiverseSources = new Set(ordered.map(sourceDiversityKey)).size > 1;
  let usedEvidenceTokens = 0;
  let droppedForSourceDiversityCount = 0;
  let droppedForBudgetCount = 0;
  let preservedSelectedEvidenceCount = 0;

  for (const candidate of ordered) {
    if (kept.length >= maxEvidenceItems) {
      droppedForBudgetCount++;
      continue;
    }

    const selectedCandidate = isSelectedCandidate(candidate, input.selectedRefId, input.selectedSectionId, input.selectedNodeId);
    const sourceKey = sourceDiversityKey(candidate);
    const sourceCount = sourceCounts.get(sourceKey) ?? 0;
    const sameSourceLimit = !hasDiverseSources
      ? Number.POSITIVE_INFINITY
      : selectedCandidate
        ? Math.max(input.budget.maxSameSourceItems, 3)
        : input.budget.maxSameSourceItems;
    if (sourceCount >= sameSourceLimit) {
      droppedForSourceDiversityCount++;
      continue;
    }

    const nextTokens = estimateTokens(candidateText(candidate).slice(0, input.budget.maxEvidenceExcerptChars)) + 80;
    if (kept.length > 0 && usedEvidenceTokens + nextTokens > evidenceBudget) {
      droppedForBudgetCount++;
      continue;
    }

    kept.push(candidate);
    sourceCounts.set(sourceKey, sourceCount + 1);
    usedEvidenceTokens += nextTokens;
    if (selectedCandidate) preservedSelectedEvidenceCount++;
  }

  const evidenceCards = buildEvidenceCards({
    candidates: kept,
    maxExcerptChars: input.budget.maxEvidenceExcerptChars,
    isClientContext: input.isClientContext
  });
  const citationCandidateIds = Array.from(
    new Set([
      ...kept.map((candidate) => candidate.id),
      ...kept.map((candidate) => candidate.citationRef?.id).filter((id): id is string => Boolean(id)),
      ...evidenceCards.map((card) => card.citationRef?.id).filter((id): id is string => Boolean(id))
    ])
  );
  const droppedCandidateCount = input.candidates.length - kept.length;
  const budgetTruncated = droppedCandidateCount > 0;

  return {
    candidates: kept,
    evidenceCards,
    citationCandidateIds,
    telemetry: {
      requestedEvidenceCount: input.candidates.length,
      finalEvidenceCount: kept.length,
      estimatedInputTokens: reservedPromptTokens + historyTokens + queryTokens + usedEvidenceTokens,
      estimatedOutputTokens: input.budget.maxOutputTokens,
      droppedCandidateCount,
      droppedForBudgetCount,
      droppedForSourceDiversityCount,
      preservedSelectedEvidenceCount,
      evidenceItemsBeforeBudget: input.candidates.length,
      evidenceItemsAfterBudget: kept.length,
      budgetTruncated,
      truncationReason: budgetTruncated
        ? droppedForBudgetCount > 0
          ? "context_budget"
          : "source_diversity"
        : null
    }
  };
}
