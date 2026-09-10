/**
 * CHR-RAG Layer 1: Contextual domain selection.
 *
 * Determines which retrieval domains to activate based on page context
 * and query intent.  This is deterministic — no LLM calls.
 */

import type { QueryIntent } from "./intent.js";
import type { RetrievalDomains } from "./types.js";

type PageContext =
  | "dashboard_general"
  | "dashboard_project"
  | "brain_overview"
  | "brain_graph"
  | "doc_viewer"
  | "live_doc"
  | "client_view";

export function selectDomains(pageContext: PageContext, intent: QueryIntent): RetrievalDomains {
  const base = BASE_DOMAINS[pageContext];
  const isClientContext = pageContext === "client_view";

  // Intent overrides: always include the primary source for the intent.
  // Client context is never allowed to see changes, decisions, or communications —
  // those are internal-only domains regardless of intent.
  const overrides: Partial<RetrievalDomains> = {};

  if (intent === "original_source" || intent === "doc_local") {
    overrides.includeDocuments = true;
    if (!isClientContext) {
      overrides.includeCommunications = true;
    }
  }
  if (!isClientContext && (intent === "change_history" || intent === "comparison_or_diff")) {
    overrides.includeChanges = true;
    overrides.includeCommunications = true;
  }
  if (!isClientContext && intent === "decision_history") {
    overrides.includeDecisions = true;
  }
  if (!isClientContext && intent === "communication_lookup") {
    overrides.includeCommunications = true;
  }
  if (!isClientContext && intent === "dashboard_status") {
    overrides.includeDashboard = true;
  }
  if (!isClientContext && intent === "team_responsibility") {
    overrides.includeResponsibilities = true;
    overrides.includeDashboard = true;
  }
  if (intent === "brain_local") {
    overrides.includeBrainNodes = true;
  }
  if (intent === "current_truth") {
    overrides.includeProductBrain = !isClientContext;
    overrides.includeBrainNodes = true;
    if (!isClientContext) {
      overrides.includeChanges = true;
      overrides.includeDecisions = true;
    }
  }
  if (intent === "explain_for_role" && !isClientContext) {
    overrides.includeProductBrain = true;
  }

  return { ...base, ...overrides };
}

const BASE_DOMAINS: Record<PageContext, RetrievalDomains> = {
  dashboard_general: {
    includeDocuments: false,
    includeBrainNodes: true,
    includeProductBrain: false,
    includeChanges: true,
    includeDecisions: false,
    includeDashboard: true,
    includeCommunications: false,
    includeResponsibilities: false,
  },
  dashboard_project: {
    includeDocuments: false,
    includeBrainNodes: true,
    includeProductBrain: true,
    includeChanges: true,
    includeDecisions: true,
    includeDashboard: true,
    includeCommunications: false,
    includeResponsibilities: false,
  },
  brain_overview: {
    includeDocuments: true,
    includeBrainNodes: true,
    includeProductBrain: true,
    includeChanges: true,
    includeDecisions: true,
    includeDashboard: false,
    includeCommunications: false,
    includeResponsibilities: false,
  },
  brain_graph: {
    includeDocuments: true,
    includeBrainNodes: true,
    includeProductBrain: true,
    includeChanges: true,
    includeDecisions: false,
    includeDashboard: false,
    includeCommunications: false,
    includeResponsibilities: false,
  },
  doc_viewer: {
    includeDocuments: true,
    includeBrainNodes: true,
    includeProductBrain: false,
    includeChanges: true,
    includeDecisions: false,
    includeDashboard: false,
    includeCommunications: true,
    includeResponsibilities: false,
  },
  live_doc: {
    includeDocuments: true,
    includeBrainNodes: true,
    includeProductBrain: true,
    includeChanges: true,
    includeDecisions: true,
    includeDashboard: false,
    includeCommunications: true,
    includeResponsibilities: false,
  },
  client_view: {
    includeDocuments: true,
    includeBrainNodes: true,
    includeProductBrain: false,
    includeChanges: false,
    includeDecisions: false,
    includeDashboard: false,
    includeCommunications: false,
    includeResponsibilities: false,
  },
};
