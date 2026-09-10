import type { QueryIntent } from "./intent.js";
import type {
  RetrievalDomain,
  RetrievalDomains,
  RetrievalIntent,
  RetrievalPlan,
  SocratesPageContext,
  SocratesSelectedRefType,
  SourcePrecedence,
} from "./types.js";

interface BuildRetrievalPlanInput {
  intent: QueryIntent;
  pageContext: SocratesPageContext;
  selectedRefType?: SocratesSelectedRefType | null;
  selectedRefId?: string | null;
  viewerState?: object | null;
  isClientContext: boolean;
  retrievalTopK: number;
  rerankTopK: number;
}

function hasDomain(plan: RetrievalPlan, domains: RetrievalDomain[]): boolean {
  return domains.some((domain) => plan.primaryDomains.includes(domain) || plan.supportingDomains.includes(domain));
}

export function domainsFromPlan(plan: RetrievalPlan): RetrievalDomains {
  return {
    includeDocuments: hasDomain(plan, ["document_sections", "document_chunks", "client_safe_documents"]),
    includeBrainNodes: hasDomain(plan, ["brain_nodes", "brain_edges", "client_safe_brain"]),
    includeProductBrain: hasDomain(plan, ["product_brain", "client_safe_brain"]),
    includeChanges: plan.roleSafety.allowInternalChanges && hasDomain(plan, ["accepted_changes"]),
    includeDecisions: plan.roleSafety.allowInternalDecisions && hasDomain(plan, ["decisions"]),
    includeDashboard: hasDomain(plan, ["dashboard_snapshots"]),
    includeProjectContext: hasDomain(plan, ["project_context"]),
    includeProjectDiagrams: hasDomain(plan, ["project_diagrams"]),
    includeCodingRequirements: hasDomain(plan, ["coding_requirements"]),
    includeCommunications:
      plan.roleSafety.allowInternalMessages &&
      plan.requiresCommunicationEvidence &&
      hasDomain(plan, ["communication_threads", "communication_messages", "communication_message_chunks"]),
    includeResponsibilities: hasDomain(plan, ["project_responsibilities"]),
  };
}

const CLIENT_FORBIDDEN_DOMAINS: RetrievalDomain[] = [
  "communication_messages",
  "communication_threads",
  "communication_message_chunks",
  "accepted_changes",
  "decisions",
  "internal_accepted_change_details",
  "internal_decision_metadata",
  "connector_metadata",
  "project_context",
  "project_diagrams",
  "coding_requirements",
];

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function selectedRef(
  type?: SocratesSelectedRefType | null,
  id?: string | null
): RetrievalPlan["selectedRef"] {
  return type && id ? { type, id } : null;
}

function pageContextBoosts(pageContext: SocratesPageContext): Record<string, number> {
  switch (pageContext) {
    case "dashboard_general":
    case "dashboard_project":
      return { dashboard_snapshots: 2.2, project_responsibilities: 1.8, project_context: 1.5, project_diagrams: 1.2, coding_requirements: 1.4, product_brain: 1.2, accepted_changes: 1.2 };
    case "brain_graph":
      return { brain_nodes: 2.2, brain_edges: 1.8, product_brain: 1.4, document_sections: 1.2 };
    case "brain_overview":
      return { product_brain: 2.0, brain_nodes: 1.8, accepted_changes: 1.4 };
    case "doc_viewer":
      return { document_sections: 2.2, document_chunks: 2.0, accepted_changes: 1.3 };
    case "live_doc":
      return { live_doc_sections: 2.2, project_diagrams: 1.8, coding_requirements: 1.6, product_brain: 1.5, accepted_changes: 1.3 };
    case "coding_requirements":
      return { coding_requirements: 2.4, project_diagrams: 1.8, product_brain: 1.6, brain_nodes: 1.4, document_sections: 1.2, project_context: 1.2 };
    case "client_view":
      return { client_safe_brain: 1.8, client_safe_documents: 1.8, dashboard_snapshots: 1.1 };
  }
}

function basePlan(input: BuildRetrievalPlanInput, intent: RetrievalIntent): RetrievalPlan {
  return {
    intent,
    pageContext: input.pageContext,
    selectedRef: selectedRef(input.selectedRefType, input.selectedRefId),
    viewerState: input.viewerState ?? null,
    primaryDomains: [],
    supportingDomains: [],
    forbiddenDomains: input.isClientContext ? CLIENT_FORBIDDEN_DOMAINS : [],
    sourcePrecedence: [],
    mustInclude: [],
    shouldInclude: [],
    maxEvidenceItems: Math.max(4, input.rerankTopK),
    initialCandidateLimit: Math.max(input.retrievalTopK, input.rerankTopK),
    rerankLimit: input.rerankTopK,
    requiresOriginalEvidence: false,
    requiresAcceptedTruth: false,
    requiresBrainGraph: false,
    requiresCommunicationEvidence: false,
    requiresDashboardSnapshot: false,
    selectedObjectBoost: 3,
    pageContextBoosts: pageContextBoosts(input.pageContext),
    roleSafety: {
      isClientSafe: input.isClientContext,
      allowInternalMessages: !input.isClientContext,
      allowInternalChanges: !input.isClientContext,
      allowInternalDecisions: !input.isClientContext,
      allowConnectorMetadata: false,
    },
    explanation: "",
  };
}

function applyClientProjection(plan: RetrievalPlan): RetrievalPlan {
  if (!plan.roleSafety.isClientSafe) return plan;
  const provenanceFirst = plan.requiresOriginalEvidence && !plan.requiresAcceptedTruth;
  return {
    ...plan,
    primaryDomains: provenanceFirst
      ? ["client_safe_documents", "client_safe_brain"]
      : ["client_safe_brain", "client_safe_documents"],
    supportingDomains: [],
    forbiddenDomains: unique([...plan.forbiddenDomains, ...CLIENT_FORBIDDEN_DOMAINS]),
    sourcePrecedence: provenanceFirst
      ? ["source_evidence", "client_safe_projection"]
      : ["client_safe_projection"],
    mustInclude: provenanceFirst ? ["client_safe_documents"] : ["client_safe_brain", "client_safe_documents"],
    shouldInclude: ["client_safe_documents"],
    requiresDashboardSnapshot: false,
    requiresCommunicationEvidence: false,
    requiresAcceptedTruth: false,
    requiresBrainGraph: false,
    explanation: `${plan.explanation} Client-safe projection removes internal communications, proposals, decisions, connector metadata, and provider refs.`.trim(),
  };
}

export function buildRetrievalPlan(input: BuildRetrievalPlanInput): RetrievalPlan {
  const intent = input.intent as RetrievalIntent;
  const plan = basePlan(input, intent);

  switch (intent) {
    case "current_truth":
      plan.primaryDomains = ["product_brain", "accepted_changes", "decisions", "brain_nodes", "brain_edges"];
      plan.supportingDomains = ["document_sections", "document_chunks", "project_context", "project_diagrams", "communication_messages", "communication_message_chunks"];
      plan.sourcePrecedence = ["accepted_truth", "accepted_changes", "accepted_decisions", "brain_graph", "source_evidence", "manual_context", "visual_artifact", "communication_evidence"];
      plan.mustInclude = ["product_brain"];
      plan.shouldInclude = ["accepted_changes", "decisions", "brain_nodes", "document_sections"];
      plan.requiresAcceptedTruth = true;
      plan.requiresOriginalEvidence = true;
      plan.requiresBrainGraph = true;
      plan.requiresCommunicationEvidence = !input.isClientContext;
      plan.explanation = "Current-truth retrieval starts from the latest accepted Product Brain, then accepted changes, decisions, graph context, and supporting source evidence.";
      break;
    case "original_source":
      plan.primaryDomains = ["document_sections", "document_chunks", "project_context", "project_diagrams", "communication_messages", "communication_message_chunks"];
      plan.supportingDomains = ["accepted_changes", "decisions", "product_brain", "brain_nodes"];
      plan.sourcePrecedence = ["source_evidence", "communication_evidence", "manual_context", "accepted_changes", "accepted_truth"];
      plan.mustInclude = ["document_sections", "document_chunks"];
      plan.shouldInclude = ["communication_messages", "accepted_changes", "product_brain"];
      plan.requiresOriginalEvidence = true;
      plan.requiresCommunicationEvidence = !input.isClientContext;
      plan.explanation = "Provenance retrieval starts with original documents/messages and uses accepted truth only as explanatory context.";
      break;
    case "change_history":
      plan.primaryDomains = ["accepted_changes", "communication_messages", "communication_threads", "document_sections"];
      plan.supportingDomains = ["product_brain", "brain_nodes", "decisions"];
      plan.sourcePrecedence = ["accepted_changes", "communication_evidence", "source_evidence", "accepted_truth"];
      plan.mustInclude = ["accepted_changes"];
      plan.shouldInclude = ["communication_messages", "document_sections", "product_brain"];
      plan.requiresOriginalEvidence = true;
      plan.requiresAcceptedTruth = true;
      plan.requiresCommunicationEvidence = !input.isClientContext;
      plan.explanation = "Change-history retrieval starts with accepted changes and follows linked communication/source evidence.";
      break;
    case "decision_history":
      plan.primaryDomains = ["decisions", "accepted_changes", "communication_messages", "document_sections"];
      plan.supportingDomains = ["product_brain", "brain_nodes"];
      plan.sourcePrecedence = ["accepted_decisions", "accepted_changes", "communication_evidence", "source_evidence", "accepted_truth"];
      plan.mustInclude = ["decisions"];
      plan.shouldInclude = ["accepted_changes", "communication_messages", "document_sections"];
      plan.requiresAcceptedTruth = true;
      plan.requiresOriginalEvidence = true;
      plan.requiresCommunicationEvidence = !input.isClientContext;
      plan.explanation = "Decision-history retrieval starts with accepted decisions and their linked change/source evidence.";
      break;
    case "communication_lookup":
      plan.primaryDomains = ["communication_messages", "communication_threads", "communication_message_chunks"];
      plan.supportingDomains = ["accepted_changes", "product_brain", "document_sections", "brain_nodes"];
      plan.sourcePrecedence = ["communication_evidence", "accepted_changes", "source_evidence", "accepted_truth"];
      plan.mustInclude = ["communication_messages"];
      plan.shouldInclude = ["accepted_changes", "document_sections", "product_brain"];
      plan.requiresOriginalEvidence = true;
      plan.requiresCommunicationEvidence = !input.isClientContext;
      plan.explanation = "Communication lookup starts with original messages/threads and then linked accepted changes/doc sections.";
      break;
    case "manual_context":
      plan.primaryDomains = ["project_context"];
      plan.supportingDomains = ["document_sections", "communication_messages", "project_responsibilities", "product_brain"];
      plan.sourcePrecedence = ["manual_context", "source_evidence", "communication_evidence", "team_context", "accepted_truth"];
      plan.mustInclude = ["project_context"];
      plan.shouldInclude = ["project_context", "project_responsibilities", "document_sections"];
      plan.requiresOriginalEvidence = true;
      plan.requiresCommunicationEvidence = !input.isClientContext;
      plan.explanation = "Manual-context retrieval starts from explicitly added notes, decisions, transcripts, captions, and team/task context.";
      break;
    case "diagram_lookup":
      plan.primaryDomains = ["project_diagrams"];
      plan.supportingDomains = ["live_doc_sections", "product_brain", "brain_nodes", "document_sections", "project_context"];
      plan.sourcePrecedence = ["visual_artifact", "accepted_truth", "brain_graph", "source_evidence", "manual_context"];
      plan.mustInclude = ["project_diagrams"];
      plan.shouldInclude = ["live_doc_sections", "product_brain", "brain_nodes", "project_context"];
      plan.requiresOriginalEvidence = true;
      plan.requiresBrainGraph = true;
      plan.explanation = "Diagram lookup starts from persisted Mermaid diagrams and uses Live Doc/Product Brain/source context as supporting evidence.";
      break;
    case "coding_requirements":
      plan.primaryDomains = ["coding_requirements"];
      plan.supportingDomains = ["product_brain", "brain_nodes", "document_sections", "project_context", "project_responsibilities", "project_diagrams"];
      plan.sourcePrecedence = ["engineering_artifact", "accepted_truth", "brain_graph", "source_evidence", "manual_context", "team_context", "visual_artifact"];
      plan.mustInclude = ["coding_requirements"];
      plan.shouldInclude = ["product_brain", "brain_nodes", "document_sections", "project_context"];
      plan.requiresAcceptedTruth = true;
      plan.requiresOriginalEvidence = true;
      plan.requiresBrainGraph = true;
      plan.explanation = "Coding-requirements retrieval starts from the persisted engineering artifact and uses Product Brain/source evidence as support.";
      break;
    case "doc_local":
      plan.primaryDomains = ["document_sections", "document_chunks"];
      plan.supportingDomains = ["accepted_changes", "communication_messages", "product_brain", "brain_nodes"];
      plan.sourcePrecedence = ["source_evidence", "accepted_changes", "communication_evidence", "accepted_truth", "brain_graph"];
      plan.mustInclude = input.selectedRefType === "document_section" ? ["document_sections"] : ["document_chunks"];
      plan.shouldInclude = ["accepted_changes", "communication_messages", "product_brain"];
      plan.requiresOriginalEvidence = true;
      plan.requiresCommunicationEvidence = !input.isClientContext;
      plan.explanation = "Document-local retrieval starts with the selected/nearby section, then linked changes/messages and Product Brain context.";
      break;
    case "brain_local":
      plan.primaryDomains = ["brain_nodes", "brain_edges", "product_brain"];
      plan.supportingDomains = ["document_sections", "accepted_changes", "decisions", "communication_messages"];
      plan.sourcePrecedence = ["brain_graph", "accepted_truth", "source_evidence", "accepted_changes", "accepted_decisions", "communication_evidence"];
      plan.mustInclude = input.selectedRefType === "brain_node" ? ["brain_nodes", "brain_edges"] : ["brain_nodes"];
      plan.shouldInclude = ["document_sections", "accepted_changes", "communication_messages"];
      plan.requiresBrainGraph = true;
      plan.requiresAcceptedTruth = true;
      plan.requiresOriginalEvidence = true;
      plan.requiresCommunicationEvidence = !input.isClientContext;
      plan.explanation = "Brain-local retrieval expands the selected node and graph neighborhood before linked source evidence.";
      break;
    case "dashboard_status":
      plan.primaryDomains = ["dashboard_snapshots"];
      plan.supportingDomains = ["project_responsibilities", "project_context", "product_brain", "accepted_changes", "decisions", "communication_messages"];
      plan.sourcePrecedence = ["dashboard_facts", "team_context", "manual_context", "accepted_changes", "accepted_truth", "source_evidence"];
      plan.mustInclude = ["dashboard_snapshots"];
      plan.shouldInclude = ["project_responsibilities", "project_context", "accepted_changes", "product_brain"];
      plan.requiresDashboardSnapshot = true;
      plan.explanation = "Dashboard retrieval starts with the latest dashboard snapshot and only adds accepted truth/source support if needed.";
      break;
    case "team_responsibility":
      plan.primaryDomains = ["project_responsibilities"];
      plan.supportingDomains = ["project_context", "project_diagrams", "dashboard_snapshots", "product_brain"];
      plan.sourcePrecedence = ["team_context", "manual_context", "visual_artifact", "dashboard_facts", "accepted_truth"];
      plan.mustInclude = ["project_responsibilities"];
      plan.shouldInclude = ["project_context", "dashboard_snapshots"];
      plan.explanation = "Team-responsibility retrieval starts from manually tracked project responsibilities and uses dashboard facts only as summary context.";
      break;
    case "comparison_or_diff":
      plan.primaryDomains = ["product_brain", "accepted_changes", "document_sections", "communication_messages"];
      plan.supportingDomains = ["decisions", "brain_nodes"];
      plan.sourcePrecedence = ["accepted_truth", "accepted_changes", "source_evidence", "communication_evidence", "accepted_decisions"];
      plan.mustInclude = ["product_brain", "accepted_changes"];
      plan.shouldInclude = ["document_sections", "communication_messages"];
      plan.requiresAcceptedTruth = true;
      plan.requiresOriginalEvidence = true;
      plan.requiresCommunicationEvidence = !input.isClientContext;
      plan.explanation = "Comparison retrieval contrasts accepted current truth with original source and communication evidence.";
      break;
    case "explain_for_role":
      plan.primaryDomains = ["product_brain", "brain_nodes", "accepted_changes", "decisions"];
      plan.supportingDomains = ["document_sections", "communication_messages"];
      plan.sourcePrecedence = ["accepted_truth", "brain_graph", "accepted_changes", "accepted_decisions", "source_evidence"];
      plan.mustInclude = ["product_brain"];
      plan.shouldInclude = ["brain_nodes", "accepted_changes", "document_sections"];
      plan.requiresAcceptedTruth = true;
      plan.requiresBrainGraph = true;
      plan.requiresOriginalEvidence = true;
      plan.requiresCommunicationEvidence = !input.isClientContext;
      plan.explanation = "Role explanations start from accepted Product Brain and graph context, with source support for grounding.";
      break;
    default:
      plan.intent = "no_evidence_or_ambiguous";
      plan.primaryDomains = ["product_brain", "document_sections"];
      plan.supportingDomains = ["document_chunks"];
      plan.sourcePrecedence = ["accepted_truth", "source_evidence"];
      plan.maxEvidenceItems = Math.min(plan.maxEvidenceItems, 4);
      plan.initialCandidateLimit = Math.min(plan.initialCandidateLimit, 8);
      plan.rerankLimit = Math.min(plan.rerankLimit, 4);
      plan.explanation = "Ambiguous retrieval stays narrow and should return low confidence when evidence is missing.";
      break;
  }

  if (input.pageContext === "brain_graph") {
    plan.requiresBrainGraph = !input.isClientContext;
    plan.mustInclude = unique([...plan.mustInclude, "brain_nodes"]);
    plan.shouldInclude = unique([...plan.shouldInclude, "brain_edges", "document_sections"]);
  }

  if (input.pageContext === "doc_viewer") {
    plan.mustInclude = unique([...plan.mustInclude, "document_sections"]);
    plan.shouldInclude = unique([...plan.shouldInclude, "document_chunks", "accepted_changes"]);
  }

  if (input.pageContext === "dashboard_general" || input.pageContext === "dashboard_project") {
    plan.requiresDashboardSnapshot = true;
    plan.mustInclude = unique(["dashboard_snapshots", ...plan.mustInclude]);
    plan.shouldInclude = unique(["project_responsibilities", "project_context", ...plan.shouldInclude]);
  }

  return applyClientProjection({
    ...plan,
    primaryDomains: unique(plan.primaryDomains),
    supportingDomains: unique(plan.supportingDomains),
    forbiddenDomains: unique(plan.forbiddenDomains),
    mustInclude: unique(plan.mustInclude),
    shouldInclude: unique(plan.shouldInclude),
    sourcePrecedence: unique(plan.sourcePrecedence),
  });
}
