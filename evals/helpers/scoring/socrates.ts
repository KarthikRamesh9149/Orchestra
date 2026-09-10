import type { EvalCaseResult, SocratesEvalCase } from "../types.js";

type SocratesEvalResponse = {
  answer_md: string;
  citations: Array<{ type: string; refId: string; label?: string }>;
  open_targets: Array<{ targetType: string; targetRef: unknown }>;
  suggested_prompts: string[];
  suggested_actions?: Array<unknown>;
  confidence: "high" | "medium" | "low";
  limitations: string[];
  debug: Record<string, any>;
};

export function scoreSocratesCase(testCase: SocratesEvalCase, response: SocratesEvalResponse, durationMs: number): EvalCaseResult {
  const answer = response.answer_md.toLowerCase();
  const citationTypes = response.citations.map((citation) => citation.type);
  const citationRefs = response.citations.map((citation) => citation.refId);
  const openTargetTypes = response.open_targets.map((target) => target.targetType);
  const suggestedActions = response.suggested_actions ?? [];
  const suggestedActionTypes = suggestedActions
    .map((action) => typeof action === "object" && action != null && "type" in action ? String((action as any).type) : "")
    .filter(Boolean);
  const finalEvidenceSourceTypes = Array.isArray(response.debug.evidence_cards)
    ? response.debug.evidence_cards.map((card: any) => card?.sourceType).filter(Boolean)
    : [];
  const checks: Record<string, boolean> = {};
  const scores: Record<string, number> = {};
  const reasons: string[] = [];

  checks.structured_answer_schema_pass =
    typeof response.answer_md === "string" &&
    response.answer_md.length > 0 &&
    Array.isArray(response.citations) &&
    Array.isArray(response.open_targets) &&
    Array.isArray(response.suggested_prompts) &&
    (response.suggested_actions == null || Array.isArray(response.suggested_actions)) &&
    ["high", "medium", "low"].includes(response.confidence) &&
    Array.isArray(response.limitations);
  mark(checks.structured_answer_schema_pass, "Structured answer schema was not satisfied", reasons);

  const expectedFacts = [...(testCase.expectedAnswerFacts ?? []), ...(testCase.expectations.mustMention ?? [])];
  const forbiddenClaims = [...(testCase.forbiddenAnswerClaims ?? []), ...(testCase.expectations.mustNotMention ?? [])];
  checks.answer_correctness =
    expectedFacts.every((phrase) => answer.includes(phrase.toLowerCase())) &&
    forbiddenClaims.every((phrase) => !answer.includes(phrase.toLowerCase()));
  scores.answer_correctness = ratio(expectedFacts, (phrase) => answer.includes(phrase.toLowerCase()));
  mark(checks.answer_correctness, "Answer text did not match expected/forbidden facts", reasons);

  const requiredCitationTypes = [...(testCase.expectedCitationTypes ?? []), ...(testCase.expectations.requiredCitationTypes ?? [])];
  const forbiddenCitationTypes = [...(testCase.forbiddenCitationTypes ?? []), ...(testCase.expectations.disallowedCitationTypes ?? [])];
  checks.citation_correctness =
    includesAll(citationTypes, requiredCitationTypes) &&
    includesAll(citationRefs, testCase.requiredCitationRefs ?? []) &&
    forbiddenCitationTypes.every((type) => !citationTypes.includes(type)) &&
    (testCase.forbiddenCitationRefs ?? []).every((ref) => !citationRefs.includes(ref)) &&
    ((testCase.expectations.allowedCitationTypes?.length ?? 0) === 0 || citationTypes.every((type) => testCase.expectations.allowedCitationTypes?.includes(type as any)));
  scores.citation_correctness = citationTypes.length > 0 || requiredCitationTypes.length === 0 ? 1 : 0;
  mark(checks.citation_correctness, "Citation requirements were not satisfied", reasons);

  const requiredOpenTargetTypes = [...(testCase.expectedOpenTargetTypes ?? []), ...(testCase.expectations.mustOpenTargetTypes ?? [])];
  const forbiddenOpenTargetTypes = [...(testCase.forbiddenOpenTargets ?? []), ...(testCase.expectations.disallowedOpenTargetTypes ?? [])];
  checks.open_target_correctness =
    includesAll(openTargetTypes, requiredOpenTargetTypes) &&
    forbiddenOpenTargetTypes.every((type) => !openTargetTypes.includes(type)) &&
    includesTargets(response.open_targets, testCase.requiredOpenTargets ?? []);
  scores.open_target_correctness = openTargetTypes.length > 0 || requiredOpenTargetTypes.length === 0 ? 1 : 0;
  mark(checks.open_target_correctness, "Open-target requirements were not satisfied", reasons);

  checks.expected_confidence_correctness =
    testCase.expectedConfidence == null || response.confidence === testCase.expectedConfidence;
  scores.expected_confidence_correctness = checks.expected_confidence_correctness ? 1 : 0;
  mark(checks.expected_confidence_correctness, "Answer confidence did not match expectation", reasons);

  const firstCitationType = citationTypes[0] ?? "";
  const firstEvidenceType = finalEvidenceSourceTypes[0] ?? "";
  const expectedPrecedence = testCase.expectedSourcePrecedence ?? [];
  const firstAllowedPrecedence =
    expectedPrecedence.length === 0 ||
    expectedPrecedence.includes(firstCitationType) ||
    expectedPrecedence.includes(mapEvidenceSourceType(firstEvidenceType));
  checks.source_precedence_correctness =
    firstAllowedPrecedence &&
    (!testCase.expectations.mustUseCurrentTruth && !testCase.expectedSourcePrecedence?.length ||
      citationTypes.some((type) => ["product_brain", "change_proposal", "decision_record", "brain_node", "dashboard_snapshot", "document_chunk"].includes(type)) ||
      finalEvidenceSourceTypes.some((type: string) => ["product_brain", "accepted_change", "decision_record", "brain_node", "dashboard_snapshot"].includes(type))) &&
    (!testCase.expectations.mustPreferOriginalEvidence ||
      ["message", "document_chunk", "document_section"].includes(citationTypes[0] ?? "") ||
      ["message", "document_chunk", "document_section"].includes(finalEvidenceSourceTypes[0] ?? "")) &&
    (!testCase.expectations.mustPreferCommunicationEvidence ||
      citationTypes[0] === "message" ||
      finalEvidenceSourceTypes[0] === "message");
  scores.source_precedence_correctness = checks.source_precedence_correctness ? 1 : 0;
  mark(checks.source_precedence_correctness, "Source precedence was not preserved", reasons);

  const clientSafe = testCase.clientSafeExpected === true || testCase.session.role === "client" || testCase.session.pageContext === "client_view";
  const publicPayload = {
    answer_md: response.answer_md,
    citations: response.citations,
    open_targets: response.open_targets,
    suggested_prompts: response.suggested_prompts,
    suggested_actions: response.suggested_actions ?? [],
    confidence: response.confidence,
    limitations: response.limitations
  };
  const clientForbiddenCitationTypes = [
    "message",
    "thread",
    "change_proposal",
    "decision_record",
    "product_brain",
    "dashboard_snapshot",
    "project_responsibility",
    "project_context",
    "project_diagram",
    "coding_requirements"
  ];
  const clientForbiddenOpenTargetTypes = [
    "message",
    "thread",
    "change_proposal",
    "decision_record",
    "dashboard_filter",
    "project_responsibility",
    "project_context",
    "project_diagram",
    "coding_requirements"
  ];
  checks.client_safety_correctness =
    !clientSafe ||
    citationTypes.every((type) => !clientForbiddenCitationTypes.includes(type)) &&
      openTargetTypes.every((type) => !clientForbiddenOpenTargetTypes.includes(type)) &&
      !/(providerPermalink|connectorId|credentialsRef|threadId|proposalId|acceptedBy)/i.test(JSON.stringify(publicPayload));
  scores.client_safety_correctness = checks.client_safety_correctness ? 1 : 0;
  mark(checks.client_safety_correctness, "Client-safe response leaked internal evidence", reasons);

  const maxEvidenceItems = testCase.tokenBudgetExpectation?.maxEvidenceItems;
  checks.token_budget_behavior =
    (maxEvidenceItems == null || Number(response.debug.evidence_card_count ?? response.debug.evidence_items_after_budget ?? 0) <= maxEvidenceItems) &&
    (testCase.tokenBudgetExpectation?.maxEstimatedInputTokens == null ||
      Number(response.debug.estimated_input_tokens ?? 0) <= testCase.tokenBudgetExpectation.maxEstimatedInputTokens) &&
    (testCase.tokenBudgetExpectation?.selectedEvidenceMustSurvive !== true ||
      citationTypes.some((type) => ["document_chunk", "document_section", "brain_node"].includes(type)) ||
      openTargetTypes.some((type) => ["document_section", "brain_node"].includes(type)) ||
      finalEvidenceSourceTypes.some((type: string) => ["document_chunk", "document_section", "brain_node"].includes(type)));
  scores.token_budget_behavior = checks.token_budget_behavior ? 1 : 0;
  mark(checks.token_budget_behavior, "Token budget expectation failed", reasons);

  checks.low_evidence_honesty =
    testCase.lowEvidenceExpected !== true ||
    response.confidence === "low" &&
      response.limitations.length > 0 &&
      response.answer_md.includes("I could not find enough project evidence to answer this confidently.");
  scores.low_evidence_honesty = checks.low_evidence_honesty ? 1 : 0;
  mark(checks.low_evidence_honesty, "Low-evidence answer was not honest", reasons);

  const expectedSuggestedActionTypes = testCase.expectations.expectedSuggestedActionTypes ?? [];
  const forbiddenSuggestedActionTypes = testCase.expectations.forbiddenSuggestedActionTypes ?? [];
  checks.suggested_action_correctness =
    includesAll(suggestedActionTypes, expectedSuggestedActionTypes) &&
    forbiddenSuggestedActionTypes.every((type) => !suggestedActionTypes.includes(type)) &&
    (testCase.expectations.expectedRequiresConfirmation !== true ||
      suggestedActions.length > 0 &&
      suggestedActions.every((action) => typeof action === "object" && action != null && (action as any).requiresConfirmation === true)) &&
    (testCase.expectations.expectedNoAutoApply !== true ||
      suggestedActions.every((action) => typeof action !== "object" || action == null || (action as any).status !== "applied") &&
      !/\b(applied|created automatically|already assigned|already created)\b/i.test(response.answer_md));
  scores.suggested_action_correctness = expectedSuggestedActionTypes.length === 0
    ? (checks.suggested_action_correctness ? 1 : 0)
    : ratio(expectedSuggestedActionTypes, (type) => suggestedActionTypes.includes(type));
  mark(checks.suggested_action_correctness, "Suggested action expectations were not satisfied", reasons);

  checks.debug_metadata_present =
    typeof response.debug.intent === "string" &&
    response.debug.retrievalPlan != null &&
    response.debug.prompt_version != null &&
    typeof response.debug.estimated_input_tokens === "number" &&
    typeof response.debug.estimated_output_tokens === "number" &&
    typeof response.debug.model_tier === "string" &&
    typeof response.debug.model_used === "string" &&
    typeof response.debug.model_provider === "string" &&
    typeof response.debug.estimated_cost_usd === "number" &&
    typeof response.debug.cache_hit === "boolean" &&
    typeof response.debug.degraded_mode === "boolean" &&
    "degradation_reason" in response.debug &&
    typeof response.debug.schema_repair_attempts === "number" &&
    typeof response.debug.low_evidence === "boolean" &&
    typeof response.debug.no_evidence === "boolean" &&
    typeof response.debug.no_citation === "boolean" &&
    typeof response.debug.retrieval_latency_ms === "number" &&
    typeof response.debug.embedding_latency_ms === "number" &&
    typeof response.debug.rerank_latency_ms === "number" &&
    typeof response.debug.generation_latency_ms === "number" &&
    typeof response.debug.validation_latency_ms === "number" &&
    typeof response.debug.budget_truncated === "boolean" &&
    typeof response.debug.dropped_citation_count === "number" &&
    typeof response.debug.dropped_open_target_count === "number";
  mark(checks.debug_metadata_present, "Required eval and AI ops debug metadata was missing", reasons);

  const passed = Object.values(checks).every(Boolean);
  return {
    id: testCase.id,
    materialityKey: testCase.materialityKey,
    category: testCase.category,
    title: testCase.title,
    fixture: testCase.projectFixtureId ?? testCase.setup.projectFixture,
    roleOrProvider: testCase.session.role,
    passed,
    checks,
    scores,
    reasons,
    durationMs,
    observed: {
      query: testCase.query,
      expected_behavior: testCase.expectedBehavior,
      intent: response.debug.intent,
      page_context: testCase.session.pageContext,
      retrieval_domains: response.debug.retrievalPlan?.primaryDomains ?? [],
      source_precedence: response.debug.retrievalPlan?.sourcePrecedence ?? [],
      dense_candidate_count: response.debug.dense_candidate_count,
      lexical_candidate_count: response.debug.lexical_candidate_count,
      graph_candidate_count: response.debug.graph_candidate_count,
      linked_evidence_candidate_count: response.debug.linked_evidence_candidate_count,
      merged_candidate_count: response.debug.merged_candidate_count,
      rerank_provider: response.debug.rerank_provider,
      rerank_count: response.debug.reranked_candidate_count,
      final_evidence_count: response.debug.finalEvidenceCount ?? response.debug.evidence_card_count,
      final_evidence_source_types: finalEvidenceSourceTypes,
      estimated_input_tokens: response.debug.estimated_input_tokens,
      estimated_output_tokens: response.debug.estimated_output_tokens,
      evidence_token_estimate: response.debug.evidence_token_estimate,
      estimated_cost_usd: response.debug.estimated_cost_usd,
      model_tier: response.debug.model_tier,
      model_used: response.debug.model_used,
      model_provider: response.debug.model_provider,
      cache_hit: response.debug.cache_hit,
      cache_namespace: response.debug.cache_namespace,
      degraded_mode: response.debug.degraded_mode,
      degradation_reason: response.debug.degradation_reason,
      schema_repair_attempts: response.debug.schema_repair_attempts,
      failed_answer_schema: response.debug.failed_answer_schema,
      low_evidence: response.debug.low_evidence,
      no_evidence: response.debug.no_evidence,
      no_citation: response.debug.no_citation,
      retrieval_latency_ms: response.debug.retrieval_latency_ms,
      embedding_latency_ms: response.debug.embedding_latency_ms,
      rerank_latency_ms: response.debug.rerank_latency_ms,
      generation_latency_ms: response.debug.generation_latency_ms,
      validation_latency_ms: response.debug.validation_latency_ms,
      budget_truncated: response.debug.budget_truncated,
      dropped_citation_count: response.debug.dropped_citation_count,
      dropped_open_target_count: response.debug.dropped_open_target_count,
      client_safety_drops: response.debug.dropped_for_client_safety_count,
      retrieval_confidence: response.debug.retrieval_confidence,
      retrieval_low_evidence_bypass: response.debug.retrieval_low_evidence_bypass,
      confidence: response.confidence,
      limitations: response.limitations,
      citations: response.citations,
      citationTypes,
      open_targets: response.open_targets,
      openTargetTypes,
      suggested_actions: suggestedActions,
      suggestedActionTypes,
      answer: response.answer_md,
      latency_ms: durationMs
    }
  };
}

function mapEvidenceSourceType(type: string) {
  switch (type) {
    case "accepted_change":
      return "change_proposal";
    case "communication_message":
      return "message";
    default:
      return type;
  }
}

function includesAll(values: string[], needles: string[]) {
  return needles.every((needle) => values.includes(needle));
}

function includesTargets(targets: Array<{ targetType: string; targetRef: unknown }>, required: string[]) {
  if (required.length === 0) return true;
  const serialized = targets.map((target) => JSON.stringify(target));
  return required.every((needle) => serialized.some((target) => target.includes(needle)));
}

function mark(value: boolean, reason: string, reasons: string[]) {
  if (!value) reasons.push(reason);
}

function ratio(values: string[], predicate: (value: string) => boolean) {
  if (values.length === 0) return 1;
  return values.filter(predicate).length / values.length;
}
