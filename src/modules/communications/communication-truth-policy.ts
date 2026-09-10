import type { ProposalType } from "@prisma/client";
import type { CommunicationInsightOutput } from "./insight-classifier.prompt.js";

export type ValidatedCommunicationRefs = {
  documentSectionIds: string[];
  brainNodeIds: string[];
};

export type CommunicationTruthPolicyResult = {
  validatedRefs: ValidatedCommunicationRefs;
  confidence: number;
  shouldCreateProposal: boolean;
  shouldCreateDecision: boolean;
  proposalType: ProposalType | null;
  globalDecision: boolean;
  blockedReasons: string[];
  invalidRefCounts: {
    documentSections: number;
    brainNodes: number;
  };
};

type CandidateRef = {
  id: string;
};

const INSIGHT_ONLY_TYPES = new Set(["info", "blocker", "risk", "action_needed"]);
const TRUTH_AFFECTING_TYPES = new Set(["clarification", "decision", "requirement_change", "contradiction", "approval"]);

function clampConfidence(value: number) {
  return Math.max(0, Math.min(0.999, value));
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function mapProposalType(insightType: string): ProposalType | null {
  switch (insightType) {
    case "decision":
    case "approval":
      return "decision_change";
    case "contradiction":
      return "contradiction_resolution";
    case "clarification":
      return "clarification";
    case "requirement_change":
      return "requirement_change";
    default:
      return null;
  }
}

export function evaluateCommunicationTruthPolicy(
  output: CommunicationInsightOutput,
  candidateSections: CandidateRef[],
  candidateBrainNodes: CandidateRef[],
  options?: { requireBrainNodeRefs?: boolean; sourceText?: string }
): CommunicationTruthPolicyResult {
  const sectionIds = new Set(candidateSections.map((item) => item.id));
  const nodeIds = new Set(candidateBrainNodes.map((item) => item.id));
  const nominatedSectionIds = unique(output.affectedDocumentSections.map((item) => item.id));
  const nominatedNodeIds = unique(output.affectedBrainNodes.map((item) => item.id));
  const validatedRefs = {
    documentSectionIds: nominatedSectionIds.filter((id) => sectionIds.has(id)),
    brainNodeIds: nominatedNodeIds.filter((id) => nodeIds.has(id))
  };
  const invalidRefCounts = {
    documentSections: nominatedSectionIds.length - validatedRefs.documentSectionIds.length,
    brainNodes: nominatedNodeIds.length - validatedRefs.brainNodeIds.length
  };
  const blockedReasons: string[] = [];
  let confidence = clampConfidence(output.confidence);
  const truthAffecting = TRUTH_AFFECTING_TYPES.has(output.insightType);
  const requireBrainNodeRefs = options?.requireBrainNodeRefs ?? true;
  const missingAffectedRefs =
    validatedRefs.documentSectionIds.length === 0 ||
    (requireBrainNodeRefs && validatedRefs.brainNodeIds.length === 0);
  const invalidRefsPresent = invalidRefCounts.documentSections > 0 || invalidRefCounts.brainNodes > 0;
  const globalDecision = false;
  const sourceText = options?.sourceText ?? "";
  const instructionLikeContent = /\b(?:ignore|disregard|override)\b[\s\S]{0,60}\b(?:previous|prior|system|instruction|prompt)\b|\b(?:system prompt|developer message|you are chatgpt|return (?:only )?json|shouldCreateProposal|shouldCreateDecision)\b/i.test(sourceText);
  const explicitDecisionLanguage = /\b(?:approved?|approval|final decision|client confirmed|confirmed|we (?:have )?decided|decision (?:is|was)|signed off|agreed|go ahead|proceed|ship it|let(?:'|’)s go with|must|shall|required?)\b/i.test(sourceText);
  const explicitChangeLanguage = /\b(?:need(?:s|ed)?|request(?:ed)?|require(?:d|s)?|must|shall|change(?:d)?|switch(?:ed)?|replace(?:d)?|remove(?:d)?|add(?:ed)?|include(?:d)?|exclude(?:d)?|instead|no longer)\b/i.test(sourceText);

  if (truthAffecting && invalidRefCounts.documentSections > 0) {
    confidence *= 0.78;
    blockedReasons.push("invalid_document_section_refs_dropped");
  }
  if (truthAffecting && invalidRefCounts.brainNodes > 0) {
    confidence *= 0.78;
    blockedReasons.push("invalid_brain_node_refs_dropped");
  }
  if (truthAffecting && missingAffectedRefs) {
    confidence *= 0.72;
    blockedReasons.push("missing_required_affected_refs");
  }

  confidence = clampConfidence(confidence);

  if (instructionLikeContent && truthAffecting) {
    confidence = Math.min(confidence, 0.49);
    blockedReasons.push("source_contains_instruction_like_content");
  }

  if (INSIGHT_ONLY_TYPES.has(output.insightType)) {
    return {
      validatedRefs,
      confidence,
      shouldCreateProposal: false,
      shouldCreateDecision: false,
      proposalType: null,
      globalDecision: false,
      blockedReasons: [...blockedReasons, "insight_type_is_review_only"],
      invalidRefCounts
    };
  }

  let eligible = false;
  let shouldCreateDecision = false;
  switch (output.insightType) {
    case "requirement_change":
      eligible = !missingAffectedRefs && confidence >= 0.86 && (!sourceText || explicitChangeLanguage);
      if (sourceText && !explicitChangeLanguage) blockedReasons.push("explicit_change_wording_missing");
      break;
    case "contradiction":
      eligible = !missingAffectedRefs && confidence >= 0.84;
      break;
    case "clarification":
      eligible = !missingAffectedRefs && confidence >= 0.9;
      break;
    case "decision":
    case "approval":
      eligible = !missingAffectedRefs && confidence >= 0.88 && (!sourceText || explicitDecisionLanguage);
      if (sourceText && !explicitDecisionLanguage) blockedReasons.push("explicit_decision_wording_missing");
      shouldCreateDecision = eligible;
      break;
    default:
      eligible = false;
      break;
  }

  if (!eligible) {
    blockedReasons.push("below_conservative_truth_threshold");
  }

  return {
    validatedRefs,
    confidence,
    shouldCreateProposal: eligible,
    shouldCreateDecision,
    proposalType: eligible ? mapProposalType(output.insightType) : null,
    globalDecision: eligible && globalDecision,
    blockedReasons,
    invalidRefCounts
  };
}
