import type { EvalCaseResult, MessageEvalCase } from "../types.js";

export type MessageObserved = {
  insightType: string;
  shouldCreateProposal: boolean;
  shouldCreateDecision: boolean;
  uncertainty: unknown[];
  affectedDocumentSectionIds: string[];
  affectedBrainNodeIds: string[];
  proposalId: string | null;
  decisionId: string | null;
  confidence?: number;
  latencyMs?: number;
  duplicateBehavior?: "same_body_reuses" | "created_duplicate" | "not_observed";
  classifierModel?: string;
  modelTier?: string;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  estimatedCostUsd?: number;
  schemaRepairAttempts?: number;
  invalidAffectedRefsDropped?: number;
  truthPolicyBackendDecision?: {
    shouldCreateProposal: boolean;
    shouldCreateDecision: boolean;
  };
  classifierFallbackUsed?: boolean;
};

export function scoreMessageCase(testCase: MessageEvalCase, observed: MessageObserved): EvalCaseResult {
  const checks: Record<string, boolean> = {};
  const scores: Record<string, number> = {};
  const reasons: string[] = [];

  checks.insight_type_correctness =
    (testCase.expectedInsightType == null || observed.insightType === testCase.expectedInsightType) &&
    (testCase.expectations.allowedInsightTypes ?? [observed.insightType]).includes(observed.insightType) &&
    !(testCase.expectations.disallowedInsightTypes ?? []).includes(observed.insightType);
  scores.insight_type_correctness = checks.insight_type_correctness ? 1 : 0;
  mark(checks.insight_type_correctness, `Unexpected insight type: ${observed.insightType}`, reasons);

  checks.proposal_creation_correctness =
    (testCase.expectedProposalCreation == null || Boolean(observed.proposalId) === testCase.expectedProposalCreation) &&
    (testCase.expectations.mustCreateProposal !== true || Boolean(observed.proposalId)) &&
    (testCase.expectations.mustNotCreateProposal !== true || !observed.proposalId);
  scores.proposal_creation_correctness = checks.proposal_creation_correctness ? 1 : 0;
  mark(checks.proposal_creation_correctness, "Proposal creation behavior did not match expectations", reasons);

  checks.decision_creation_correctness =
    (testCase.expectedDecisionCreation == null || Boolean(observed.decisionId) === testCase.expectedDecisionCreation) &&
    (testCase.expectations.mustCreateDecision !== true || Boolean(observed.decisionId)) &&
    (testCase.expectations.mustNotCreateDecision !== true || !observed.decisionId);
  scores.decision_creation_correctness = checks.decision_creation_correctness ? 1 : 0;
  mark(checks.decision_creation_correctness, "Decision creation behavior did not match expectations", reasons);

  checks.false_positive_resistance =
    !["false_positive_guard", "false_positive", "ambiguous_chat", "invalid_ref"].includes(testCase.category) ||
    (!observed.proposalId && !observed.decisionId);
  scores.false_positive_resistance = checks.false_positive_resistance ? 1 : 0;
  mark(checks.false_positive_resistance, "False-positive guard failed", reasons);

  checks.affected_ref_correctness =
    (!testCase.expectations.requireAffectedRefs ||
      (observed.affectedDocumentSectionIds.length > 0 && observed.affectedBrainNodeIds.length > 0)) &&
    includesAll(observed.affectedDocumentSectionIds, testCase.expectedAffectedDocumentSectionRefs ?? []) &&
    includesAll(observed.affectedBrainNodeIds, testCase.expectedAffectedBrainNodeRefs ?? []);
  scores.affected_ref_correctness = checks.affected_ref_correctness ? 1 : 0;
  mark(checks.affected_ref_correctness, "Affected refs were missing", reasons);

  const allRefs = [...observed.affectedDocumentSectionIds, ...observed.affectedBrainNodeIds];
  checks.invalid_ref_handling =
    !(testCase.expectations.mustFilterInvalidRefs || testCase.expectedInvalidRefHandling) ||
    ((testCase.forbiddenAffectedRefs?.length ?? 0) > 0 &&
      (testCase.forbiddenAffectedRefs ?? []).every((ref) => !allRefs.includes(ref)) &&
      (testCase.expectedInvalidRefHandling !== "block_proposal" || !observed.proposalId));
  scores.invalid_ref_handling = checks.invalid_ref_handling ? 1 : 0;
  mark(checks.invalid_ref_handling, "Invalid refs were not handled safely", reasons);

  checks.uncertainty_preservation =
    !(testCase.expectations.mustPreserveUncertainty || testCase.expectedUncertainty) ||
    observed.uncertainty.length > 0;
  scores.uncertainty_preservation = checks.uncertainty_preservation ? 1 : 0;
  mark(checks.uncertainty_preservation, "Expected uncertainty annotations were missing", reasons);

  checks.duplicate_supersession_behavior =
    testCase.expectedDuplicateBehavior == null ||
    testCase.expectedDuplicateBehavior === "not_applicable" ||
    observed.duplicateBehavior === "same_body_reuses";
  scores.duplicate_supersession_behavior = checks.duplicate_supersession_behavior ? 1 : 0;
  mark(checks.duplicate_supersession_behavior, "Duplicate/supersession behavior was not observable", reasons);

  checks.truth_gating_correctness =
    !["false_positive_guard", "false_positive", "ambiguous_chat", "invalid_ref", "blocker_risk_action"].includes(testCase.category) ||
    !observed.proposalId;
  scores.truth_gating_correctness = checks.truth_gating_correctness ? 1 : 0;
  mark(checks.truth_gating_correctness, "Unaccepted or weak intelligence would create truth-changing proposal", reasons);

  checks.confidence_range_pass =
    testCase.expectedConfidenceRange == null ||
    ((testCase.expectedConfidenceRange.min == null || Number(observed.confidence ?? 0) >= testCase.expectedConfidenceRange.min) &&
      (testCase.expectedConfidenceRange.max == null || Number(observed.confidence ?? 0) <= testCase.expectedConfidenceRange.max));
  scores.confidence_range_pass = checks.confidence_range_pass ? 1 : 0;
  mark(checks.confidence_range_pass, "Confidence was outside expected range", reasons);

  checks.ai_ops_metadata_present =
    typeof observed.classifierModel === "string" &&
    observed.classifierModel.length > 0 &&
    typeof observed.modelTier === "string" &&
    typeof observed.estimatedInputTokens === "number" &&
    typeof observed.estimatedOutputTokens === "number" &&
    typeof observed.estimatedCostUsd === "number" &&
    typeof observed.schemaRepairAttempts === "number" &&
    typeof observed.invalidAffectedRefsDropped === "number" &&
    typeof observed.classifierFallbackUsed === "boolean" &&
    observed.truthPolicyBackendDecision != null;
  scores.ai_ops_metadata_present = checks.ai_ops_metadata_present ? 1 : 0;
  mark(checks.ai_ops_metadata_present, "Message AI ops metadata was missing", reasons);

  const passed = Object.values(checks).every(Boolean);
  return {
    id: testCase.id,
    materialityKey: testCase.materialityKey,
    category: testCase.category,
    title: testCase.title,
    fixture: testCase.projectFixtureId ?? testCase.setup.projectFixture,
    roleOrProvider: testCase.provider ?? "manual_import",
    passed,
    checks,
    scores,
    reasons,
    durationMs: observed.latencyMs,
    observed: {
      ...observed,
      expected_behavior: testCase.notes,
      provider: testCase.provider ?? "manual_import",
      message_or_thread_input: testCase.inputMessageBody ?? testCase.inputThreadMessages ?? testCase.setup.messages,
      classifier_model: observed.classifierModel,
      model_tier: observed.modelTier,
      estimated_input_tokens: observed.estimatedInputTokens,
      estimated_output_tokens: observed.estimatedOutputTokens,
      estimated_cost_usd: observed.estimatedCostUsd,
      schema_repair_attempts: observed.schemaRepairAttempts,
      invalid_affected_refs_dropped: observed.invalidAffectedRefsDropped,
      truth_policy_backend_decision: observed.truthPolicyBackendDecision,
      classifier_fallback_used: observed.classifierFallbackUsed,
      latency_ms: observed.latencyMs ?? 0
    }
  };
}

function includesAll(values: string[], expected: string[]) {
  return expected.every((value) => values.includes(value));
}

function mark(value: boolean, reason: string, reasons: string[]) {
  if (!value) reasons.push(reason);
}
