import { z } from "zod";

const evalRoleSchema = z.enum(["manager", "dev", "client"]);
const citationTypeSchema = z.enum([
  "live_doc_section",
  "document_section",
  "document_chunk",
  "message",
  "thread",
  "brain_node",
  "product_brain",
  "change_proposal",
  "decision_record",
  "dashboard_snapshot",
  "project_responsibility",
  "project_context",
  "project_diagram",
  "coding_requirements"
]);

const openTargetTypeSchema = z.enum([
  "live_doc_section",
  "document_section",
  "message",
  "thread",
  "brain_node",
  "change_proposal",
  "decision_record",
  "dashboard_filter",
  "client_view",
  "project_responsibility",
  "project_context",
  "project_diagram",
  "coding_requirements"
]);

export const projectFixtureKeySchema = z.enum([
  "project_alpha",
  "project_beta",
  "project_gamma",
  "project_notion_teams",
  "project_client_safe"
]);

const socratesPageContextSchema = z.enum([
  "dashboard_general",
  "dashboard_project",
  "brain_overview",
  "brain_graph",
  "doc_viewer",
  "live_doc",
  "coding_requirements",
  "client_view"
]);

const selectedRefTypeSchema = z.enum([
  "document",
  "document_section",
  "brain_node",
  "change_proposal",
  "decision_record",
  "dashboard_scope",
  "project_diagram",
  "coding_requirements"
]);

const socratesSuggestedActionTypeSchema = z.enum([
  "generate_prd",
  "generate_srs",
  "create_context_note",
  "create_diagram",
  "embed_diagram_in_live_doc",
  "generate_coding_requirements",
  "create_responsibility",
  "assign_task",
  "update_team_member_responsibility",
  "create_calendar_event"
]);

export const socratesEvalCategorySchema = z.enum([
  "current_truth",
  "provenance",
  "communication_origin",
  "citation_correctness",
  "role_safety",
  "doc_viewer_selected_section",
  "brain_graph_selected_node",
  "dashboard_status",
  "client_safe_leakage",
  "bad_ambiguous_no_evidence",
  "coding_requirements",
  "socrates_actions",
  "mvp_generated_prd_srs_quality",
  "mvp_manual_context_retrieval",
  "mvp_image_caption_retrieval",
  "mvp_coding_requirements_extraction",
  "mvp_mermaid_diagram_safety",
  "mvp_responsibility_task_qa",
  "mvp_socrates_action_suggestions",
  "mvp_fireflies_transcript_retrieval",
  "mvp_provider_gating",
  "mvp_low_evidence_honesty"
]);

export const messageEvalCategorySchema = z.enum([
  "classification",
  "false_positive_guard",
  "proposal_generation",
  "decision_candidate",
  "false_positive",
  "real_requirement_change",
  "decision_approval",
  "blocker_risk_action",
  "ambiguous_chat",
  "duplicate_supersession",
  "invalid_ref"
]);

const viewerStateSchema = z.object({
  documentId: z.string().optional(),
  documentVersionId: z.string().optional(),
  pageNumber: z.number().int().positive().optional(),
  anchorId: z.string().optional(),
  scrollHint: z.string().optional()
}).strict();

export const tokenBudgetExpectationSchema = z.object({
  maxEstimatedInputTokens: z.number().int().positive().optional(),
  maxEvidenceItems: z.number().int().positive().optional(),
  selectedEvidenceMustSurvive: z.boolean().optional()
}).strict();

export const socratesEvalCaseSchema = z.object({
  id: z.string().min(1),
  materialityKey: z.string().min(1).optional(),
  title: z.string().min(1),
  category: socratesEvalCategorySchema,
  projectFixtureId: z.string().min(1).optional(),
  actorRole: evalRoleSchema.optional(),
  pageContext: socratesPageContextSchema.optional(),
  selectedRef: z.object({ type: selectedRefTypeSchema, id: z.string().min(1) }).strict().nullable().optional(),
  viewerState: viewerStateSchema.nullable().optional(),
  setup: z.object({
    projectFixture: projectFixtureKeySchema,
    documents: z.array(z.string()).optional(),
    messages: z.array(z.string()).optional(),
    acceptedChanges: z.array(z.string()).optional(),
    acceptedDecisions: z.array(z.string()).optional()
  }).strict(),
  session: z.object({
    pageContext: socratesPageContextSchema,
    selectedRefType: selectedRefTypeSchema.nullable(),
    selectedRefId: z.string().nullable(),
    viewerState: viewerStateSchema.nullable(),
    role: evalRoleSchema
  }).strict(),
  query: z.string().min(1),
  expectedBehavior: z.string().optional(),
  expectedAnswerFacts: z.array(z.string()).optional(),
  forbiddenAnswerClaims: z.array(z.string()).optional(),
  expectedCitationTypes: z.array(citationTypeSchema).optional(),
  requiredCitationRefs: z.array(z.string()).optional(),
  forbiddenCitationTypes: z.array(citationTypeSchema).optional(),
  forbiddenCitationRefs: z.array(z.string()).optional(),
  expectedOpenTargetTypes: z.array(openTargetTypeSchema).optional(),
  requiredOpenTargets: z.array(z.string()).optional(),
  forbiddenOpenTargets: z.array(openTargetTypeSchema).optional(),
  expectedSourcePrecedence: z.array(z.string()).optional(),
  expectedConfidence: z.enum(["high", "medium", "low"]).optional(),
  lowEvidenceExpected: z.boolean().optional(),
  clientSafeExpected: z.boolean().optional(),
  tokenBudgetExpectation: tokenBudgetExpectationSchema.optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  expectations: z.object({
    mustUseCurrentTruth: z.boolean().optional(),
    mustPreferOriginalEvidence: z.boolean().optional(),
    mustPreferCommunicationEvidence: z.boolean().optional(),
    mustNotPreferStaleOriginalOnly: z.boolean().optional(),
    requiredCitationTypes: z.array(citationTypeSchema).optional(),
    allowedCitationTypes: z.array(citationTypeSchema).optional(),
    disallowedCitationTypes: z.array(citationTypeSchema).optional(),
    mustOpenTargetTypes: z.array(openTargetTypeSchema).optional(),
    disallowedOpenTargetTypes: z.array(openTargetTypeSchema).optional(),
    mustMention: z.array(z.string()).optional(),
    mustNotMention: z.array(z.string()).optional(),
    mustMentionProvider: z.string().optional(),
    expectedSuggestedActionTypes: z.array(socratesSuggestedActionTypeSchema).optional(),
    forbiddenSuggestedActionTypes: z.array(socratesSuggestedActionTypeSchema).optional(),
    expectedRequiresConfirmation: z.boolean().optional(),
    expectedNoAutoApply: z.boolean().optional()
  }).strict()
}).strict();

export const messageEvalCaseSchema = z.object({
  id: z.string().min(1),
  materialityKey: z.string().min(1).optional(),
  title: z.string().min(1),
  category: messageEvalCategorySchema,
  projectFixtureId: z.string().min(1).optional(),
  provider: z.enum(["manual_import", "slack", "gmail", "outlook", "microsoft_teams", "teams", "whatsapp_business", "whatsapp", "fireflies_ai", "clickup", "granola"]).optional(),
  threadId: z.string().optional(),
  messageId: z.string().optional(),
  threadStateId: z.string().optional(),
  inputMessageBody: z.string().optional(),
  inputThreadMessages: z.array(z.string()).optional(),
  setup: z.object({
    projectFixture: projectFixtureKeySchema,
    documents: z.array(z.string()).optional(),
    messages: z.array(z.string()).min(1)
  }).strict(),
  targetKind: z.enum(["message", "thread"]).optional(),
  messageIdRef: z.string().optional(),
  expectations: z.object({
    allowedInsightTypes: z.array(z.string()).optional(),
    disallowedInsightTypes: z.array(z.string()).optional(),
    mustCreateProposal: z.boolean().optional(),
    mustNotCreateProposal: z.boolean().optional(),
    mustCreateDecision: z.boolean().optional(),
    mustNotCreateDecision: z.boolean().optional(),
    mustPreserveUncertainty: z.boolean().optional(),
    requireAffectedRefs: z.boolean().optional(),
    mustFilterInvalidRefs: z.boolean().optional(),
    provider: z.string().optional(),
    mustPreserveEvidenceFields: z.array(z.string()).optional()
  }).strict(),
  expectedInsightType: z.string().optional(),
  expectedProposalCreation: z.boolean().optional(),
  expectedDecisionCreation: z.boolean().optional(),
  expectedAffectedDocumentSectionRefs: z.array(z.string()).optional(),
  expectedAffectedBrainNodeRefs: z.array(z.string()).optional(),
  forbiddenAffectedRefs: z.array(z.string()).optional(),
  expectedUncertainty: z.boolean().optional(),
  expectedSupersessionBehavior: z.enum(["reuse_existing", "create_new_revision", "supersede_previous", "not_applicable"]).optional(),
  expectedDuplicateBehavior: z.enum(["no_duplicate", "same_body_reuses", "not_applicable"]).optional(),
  expectedInvalidRefHandling: z.enum(["drop", "degrade", "block_proposal", "not_applicable"]).optional(),
  expectedConfidenceRange: z.object({ min: z.number().min(0).max(1).optional(), max: z.number().min(0).max(1).optional() }).strict().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional()
}).strict();

export const goldenProjectFixtureSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  mappedProjectFixture: projectFixtureKeySchema,
  documents: z.array(z.object({
    key: z.string().min(1),
    title: z.string().min(1),
    kind: z.string().min(1),
    visibility: z.enum(["internal", "client_shared"])
  }).strict()).min(1),
  communications: z.array(z.object({
    key: z.string().min(1),
    provider: z.enum(["manual_import", "slack", "gmail", "outlook", "microsoft_teams", "teams", "whatsapp_business", "whatsapp", "fireflies_ai", "clickup", "granola"]),
    subject: z.string().min(1),
    body: z.string().min(1),
    expectedUse: z.string().min(1)
  }).strict()).min(1),
  expectedArtifacts: z.object({
    supportingDocs: z.boolean(),
    acceptedProposals: z.boolean(),
    rejectedProposals: z.boolean(),
    decisions: z.boolean(),
    productBrain: z.boolean(),
    brainGraph: z.boolean(),
    viewerSections: z.boolean(),
    dashboardSnapshot: z.boolean(),
    expectedSocrates: z.boolean(),
    expectedMessageIntelligence: z.boolean()
  }).strict().optional(),
  expectedSocratesCategories: z.array(socratesEvalCategorySchema).min(1),
  expectedMessageCategories: z.array(messageEvalCategorySchema).min(1)
}).strict();

export type SocratesEvalCaseInput = z.infer<typeof socratesEvalCaseSchema>;
export type MessageEvalCaseInput = z.infer<typeof messageEvalCaseSchema>;
