/**
 * Shared retrieval types used across the CHR-RAG pipeline.
 */

export type RetrievalSourceType =
  | "live_doc_section"
  | "document_chunk"
  | "brain_node"
  | "product_brain"
  | "change_proposal"
  | "decision_record"
  | "dashboard_snapshot"
  | "communication_message"
  | "project_responsibility"
  | "project_context"
  | "project_diagram"
  | "coding_requirements";

export type SocratesPageContext =
  | "dashboard_general"
  | "dashboard_project"
  | "brain_overview"
  | "brain_graph"
  | "doc_viewer"
  | "live_doc"
  | "coding_requirements"
  | "client_view";

export type SocratesSelectedRefType =
  | "document"
  | "document_section"
  | "live_doc_section"
  | "brain_node"
  | "change_proposal"
  | "decision_record"
  | "dashboard_scope"
  | "project_diagram"
  | "coding_requirements";

export type RetrievalIntent =
  | "current_truth"
  | "original_source"
  | "change_history"
  | "decision_history"
  | "communication_lookup"
  | "doc_local"
  | "brain_local"
  | "dashboard_status"
  | "team_responsibility"
  | "manual_context"
  | "diagram_lookup"
  | "coding_requirements"
  | "comparison_or_diff"
  | "explain_for_role"
  | "no_evidence_or_ambiguous";

export type RetrievalDomain =
  | "product_brain"
  | "accepted_changes"
  | "decisions"
  | "brain_nodes"
  | "brain_edges"
  | "document_sections"
  | "document_chunks"
  | "communication_threads"
  | "communication_messages"
  | "communication_message_chunks"
  | "dashboard_snapshots"
  | "project_responsibilities"
  | "project_context"
  | "project_diagrams"
  | "coding_requirements"
  | "live_doc_sections"
  | "client_safe_brain"
  | "client_safe_documents"
  | "internal_accepted_change_details"
  | "internal_decision_metadata"
  | "connector_metadata";

export type SourcePrecedence =
  | "accepted_truth"
  | "accepted_changes"
  | "accepted_decisions"
  | "brain_graph"
  | "source_evidence"
  | "communication_evidence"
  | "dashboard_facts"
  | "team_context"
  | "manual_context"
  | "visual_artifact"
  | "engineering_artifact"
  | "client_safe_projection";

export interface RetrievalPlan {
  intent: RetrievalIntent;
  pageContext: SocratesPageContext;
  selectedRef: {
    type: SocratesSelectedRefType;
    id: string;
  } | null;
  viewerState?: object | null;
  primaryDomains: RetrievalDomain[];
  supportingDomains: RetrievalDomain[];
  forbiddenDomains: RetrievalDomain[];
  sourcePrecedence: SourcePrecedence[];
  mustInclude: RetrievalDomain[];
  shouldInclude: RetrievalDomain[];
  maxEvidenceItems: number;
  initialCandidateLimit: number;
  rerankLimit: number;
  requiresOriginalEvidence: boolean;
  requiresAcceptedTruth: boolean;
  requiresBrainGraph: boolean;
  requiresCommunicationEvidence: boolean;
  requiresDashboardSnapshot: boolean;
  selectedObjectBoost: number;
  pageContextBoosts: Record<string, number>;
  roleSafety: {
    isClientSafe: boolean;
    allowInternalMessages: boolean;
    allowInternalChanges: boolean;
    allowInternalDecisions: boolean;
    allowConnectorMetadata: boolean;
  };
  explanation: string;
}

export interface RetrievalCandidate {
  id: string;
  sourceType: RetrievalSourceType;
  domain?: RetrievalDomain;
  /** Raw snippet to include in the prompt context pack. */
  content: string;
  /** Enriched contextual content (document title, heading path, etc.) */
  contextualContent?: string;
  /** Provenance / label used in citations. */
  label: string;
  /** Optional section / anchor that this chunk belongs to. */
  documentSectionId?: string;
  anchorId?: string;
  pageNumber?: number;
  /** ID of the containing document, thread, or artifact. */
  containerId?: string;
  /** Vector similarity score (0–1). */
  vectorScore?: number;
  /** Lexical BM25-style score (normalised 0–1). */
  lexicalScore?: number;
  /** Structured graph / evidence-link traversal score (normalised 0–1). */
  graphScore?: number;
  /** Score derived from the active RetrievalPlan source precedence. */
  sourcePrecedenceScore?: number;
  /** Score derived from page-context routing. */
  pageContextScore?: number;
  /** Score derived from selected section/node/object routing. */
  selectedObjectScore?: number;
  /** Recency score, primarily for communication evidence. */
  recencyScore?: number;
  /** Score for whether the candidate can safely back a citation/openTarget. */
  citationAvailabilityScore?: number;
  /** Final combined score after reranking. */
  finalScore: number;
  /** Is this candidate from client-safe sources only? */
  isClientSafe: boolean;
  /** Internal-only flag (should be hidden from client context). */
  isInternalOnly: boolean;
  artifactVersionId?: string;
  brainNodeId?: string;
  brainEdgeId?: string;
  documentChunkId?: string;
  messageId?: string;
  threadId?: string;
  changeProposalId?: string;
  decisionRecordId?: string;
  dashboardSnapshotId?: string;
  responsibilityId?: string;
  contextId?: string;
  contextChunkId?: string;
  contextType?: string;
  diagramId?: string;
  diagramType?: string;
  codingRequirementsId?: string;
  linkedSectionIds?: string[];
  linkedMessageIds?: string[];
  linkedChangeProposalIds?: string[];
  decisionRecordIds?: string[];
  sourcePrecedence?: SourcePrecedence;
  evidenceRole?:
    | "accepted_truth"
    | "accepted_change"
    | "accepted_decision"
    | "source_evidence"
    | "communication_evidence"
    | "linked_evidence"
    | "dashboard_fact"
    | "team_context"
    | "manual_context"
    | "visual_artifact"
    | "engineering_artifact"
    | "client_safe_projection";
  citationRef?: {
    type: string;
    id: string;
    label?: string;
  };
  openTarget?: {
    targetType: string;
    targetRef: Record<string, unknown>;
  };
  retrievalStage?: "dense" | "lexical" | "structured" | "graph" | "linked" | "reranked" | "compressed";
  whySelected?: string;
  metadata?: Record<string, unknown> | null;
  evidenceCompleteness?: "complete" | "partial" | "missing";
  /**
   * True when the candidate belongs to a section adjacent to the selected
   * section (hierarchical neighbor expansion).  The reranker applies a
   * moderate boost relative to the hard 3× selected-object boost.
   */
  isNeighborSection?: boolean;
  isGraphNeighbor?: boolean;
  isLinkedEvidence?: boolean;
}

export interface RetrievalDomains {
  includeDocuments: boolean;
  includeBrainNodes: boolean;
  includeProductBrain: boolean;
  includeChanges: boolean;
  includeDecisions: boolean;
  includeDashboard: boolean;
  includeCommunications: boolean;
  includeResponsibilities?: boolean;
  includeProjectContext?: boolean;
  includeProjectDiagrams?: boolean;
  includeCodingRequirements?: boolean;
}
