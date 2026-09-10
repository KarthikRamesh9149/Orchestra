export type SocratesEvalCategory =
  | "current_truth"
  | "provenance"
  | "communication_origin"
  | "citation_correctness"
  | "role_safety"
  | "doc_viewer_selected_section"
  | "brain_graph_selected_node"
  | "dashboard_status"
  | "client_safe_leakage"
  | "bad_ambiguous_no_evidence"
  | "coding_requirements"
  | "socrates_actions"
  | "mvp_generated_prd_srs_quality"
  | "mvp_manual_context_retrieval"
  | "mvp_image_caption_retrieval"
  | "mvp_coding_requirements_extraction"
  | "mvp_mermaid_diagram_safety"
  | "mvp_responsibility_task_qa"
  | "mvp_socrates_action_suggestions"
  | "mvp_fireflies_transcript_retrieval"
  | "mvp_provider_gating"
  | "mvp_low_evidence_honesty";

export type MessageEvalCategory =
  | "classification"
  | "false_positive_guard"
  | "proposal_generation"
  | "decision_candidate"
  | "false_positive"
  | "real_requirement_change"
  | "decision_approval"
  | "blocker_risk_action"
  | "ambiguous_chat"
  | "duplicate_supersession"
  | "invalid_ref";

export type ProjectFixtureKey =
  | "project_alpha"
  | "project_beta"
  | "project_gamma"
  | "project_notion_teams"
  | "project_client_safe";

export type EvalRole = "manager" | "dev" | "client";

export interface SocratesEvalCase {
  id: string;
  materialityKey?: string;
  category: SocratesEvalCategory;
  title: string;
  projectFixtureId?: string;
  actorRole?: EvalRole;
  pageContext?: SocratesEvalCase["session"]["pageContext"];
  selectedRef?: {
    type: NonNullable<SocratesEvalCase["session"]["selectedRefType"]>;
    id: string;
  } | null;
  viewerState?: SocratesEvalCase["session"]["viewerState"];
  setup: {
    projectFixture: ProjectFixtureKey;
    documents?: string[];
    messages?: string[];
    acceptedChanges?: string[];
    acceptedDecisions?: string[];
  };
  session: {
    pageContext: "dashboard_general" | "dashboard_project" | "brain_overview" | "brain_graph" | "doc_viewer" | "live_doc" | "coding_requirements" | "client_view";
    selectedRefType: "document" | "document_section" | "brain_node" | "change_proposal" | "decision_record" | "dashboard_scope" | null;
    selectedRefId: string | null;
    viewerState: {
      documentId?: string;
      documentVersionId?: string;
      pageNumber?: number;
      anchorId?: string;
      scrollHint?: string;
    } | null;
    role: EvalRole;
  };
  query: string;
  expectedBehavior?: string;
  expectedAnswerFacts?: string[];
  forbiddenAnswerClaims?: string[];
  expectedCitationTypes?: string[];
  requiredCitationRefs?: string[];
  forbiddenCitationTypes?: string[];
  forbiddenCitationRefs?: string[];
  expectedOpenTargetTypes?: string[];
  requiredOpenTargets?: string[];
  forbiddenOpenTargets?: string[];
  expectedSourcePrecedence?: string[];
  expectedConfidence?: "high" | "medium" | "low";
  lowEvidenceExpected?: boolean;
  clientSafeExpected?: boolean;
  tokenBudgetExpectation?: {
    maxEstimatedInputTokens?: number;
    maxEvidenceItems?: number;
    selectedEvidenceMustSurvive?: boolean;
  };
  tags?: string[];
  notes?: string;
  expectations: {
    mustUseCurrentTruth?: boolean;
    mustPreferOriginalEvidence?: boolean;
    mustPreferCommunicationEvidence?: boolean;
    mustNotPreferStaleOriginalOnly?: boolean;
    requiredCitationTypes?: string[];
    allowedCitationTypes?: string[];
    disallowedCitationTypes?: string[];
    mustOpenTargetTypes?: string[];
    disallowedOpenTargetTypes?: string[];
    mustMention?: string[];
    mustNotMention?: string[];
    expectedSuggestedActionTypes?: string[];
    forbiddenSuggestedActionTypes?: string[];
    expectedRequiresConfirmation?: boolean;
    expectedNoAutoApply?: boolean;
  };
}

export interface MessageEvalCase {
  id: string;
  materialityKey?: string;
  category: MessageEvalCategory;
  title: string;
  projectFixtureId?: string;
  provider?: "manual_import" | "slack" | "gmail" | "outlook" | "microsoft_teams" | "teams" | "whatsapp_business" | "whatsapp" | "fireflies_ai" | "clickup" | "granola";
  threadId?: string;
  messageId?: string;
  threadStateId?: string;
  inputMessageBody?: string;
  inputThreadMessages?: string[];
  setup: {
    projectFixture: ProjectFixtureKey;
    documents?: string[];
    messages: string[];
  };
  targetKind?: "message" | "thread";
  messageIdRef?: string;
  expectations: {
    allowedInsightTypes?: string[];
    disallowedInsightTypes?: string[];
    mustCreateProposal?: boolean;
    mustNotCreateProposal?: boolean;
    mustCreateDecision?: boolean;
    mustNotCreateDecision?: boolean;
    mustPreserveUncertainty?: boolean;
    requireAffectedRefs?: boolean;
    mustFilterInvalidRefs?: boolean;
  };
  expectedInsightType?: string;
  expectedProposalCreation?: boolean;
  expectedDecisionCreation?: boolean;
  expectedAffectedDocumentSectionRefs?: string[];
  expectedAffectedBrainNodeRefs?: string[];
  forbiddenAffectedRefs?: string[];
  expectedUncertainty?: boolean;
  expectedSupersessionBehavior?: "reuse_existing" | "create_new_revision" | "supersede_previous" | "not_applicable";
  expectedDuplicateBehavior?: "no_duplicate" | "same_body_reuses" | "not_applicable";
  expectedInvalidRefHandling?: "drop" | "degrade" | "block_proposal" | "not_applicable";
  expectedConfidenceRange?: { min?: number; max?: number };
  tags?: string[];
  notes?: string;
}

export interface EvalCaseResult {
  id: string;
  materialityKey?: string;
  category: string;
  title: string;
  fixture?: string;
  roleOrProvider?: string;
  passed: boolean;
  checks: Record<string, boolean>;
  scores?: Record<string, number>;
  reasons: string[];
  observed: Record<string, unknown>;
  durationMs?: number;
}

export interface EvalSuiteReport {
  suite: "socrates" | "message_intelligence" | "all";
  generatedAt: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    byCategory: Record<string, { total: number; passed: number; failed: number }>;
    byFixture?: Record<string, { total: number; passed: number; failed: number }>;
    topFailureReasons?: Array<{ reason: string; count: number }>;
    averageLatencyMs?: number;
    p95LatencyMs?: number;
    averageEstimatedInputTokens?: number;
    averageEstimatedOutputTokens?: number;
    totalEstimatedCostUsd?: number;
    averageEstimatedCostUsd?: number;
    degradedCount?: number;
    schemaRepairCount?: number;
    lowEvidenceCount?: number;
    noEvidenceCount?: number;
    budgetTruncatedCount?: number;
    droppedCitationCount?: number;
    droppedOpenTargetCount?: number;
    clientSafetyFailures?: number;
    falsePositiveFailures?: number;
    invalidRefFailures?: number;
  };
  gate?: {
    passed: boolean;
    reasons: string[];
    minimums: Record<string, number>;
  };
  results: EvalCaseResult[];
}
