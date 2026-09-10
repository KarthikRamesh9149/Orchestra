import { apiJson } from "./client";

export type TruthInboxAction =
  | "ask_socrates"
  | "assign_owner"
  | "request_clarification"
  | "create_review_item"
  | "accept"
  | "reject"
  | "defer"
  | "snooze"
  | "dismiss"
  | "promote_to_timeline";

export type TruthInboxEvidence = {
  id: string;
  source: string;
  label: string;
  excerpt: string | null;
  occurredAt: string | null;
  openTarget: { targetType: string; targetRef: Record<string, unknown> } | null;
};

export type TruthInboxItem = {
  id: string;
  sourceType: "suggestion" | "proposal" | "fde" | "agent_drift" | "connector";
  sourceId: string;
  category: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  status: "active" | "deferred" | "snoozed" | "dismissed" | "resolved" | "converted_to_review" | "converted_to_timeline";
  sourceLabels: string[];
  evidence: TruthInboxEvidence[];
  limitations: string[];
  owner: { userId: string; displayName: string; email: string } | null;
  clarification: { note: string; requestedAt: string; requestedByUserId: string } | null;
  deferredUntil: string | null;
  snoozedUntil: string | null;
  timelineEventRef: string | null;
  reviewProposalId: string | null;
  capabilities: Record<TruthInboxAction, boolean>;
  createdAt: string;
  updatedAt: string;
};

export type TruthInboxResponse = {
  items: TruthInboxItem[];
  members: Array<{ userId: string; displayName: string; email: string; projectRole: "manager" | "dev"; canApproveTruthChanges: boolean }>;
  summary: { active: number; critical: number; awaitingDecision: number; assignedToMe: number };
  countsByCategory: Record<string, number>;
  countsByStatus: Record<string, number>;
  sourceStates: Record<string, { state: string; label: string; detail: string | null }>;
  page: { limit: number; hasMore: boolean; nextCursor: string | null };
  generatedAt: string;
  cached: boolean;
  limitations: string[];
};

export type TruthInboxActionResponse = {
  item: TruthInboxItem | null;
  outcome: Record<string, unknown> | null;
  action: TruthInboxAction;
  summaryDelta?: { active: number; critical: number; awaitingDecision: number; assignedToMe: number };
  statusDelta?: { from: TruthInboxItem["status"]; to: TruthInboxItem["status"] } | null;
};

export type TruthInboxFilters = {
  category?: string;
  severity?: string;
  status?: string;
  owner?: string;
  source?: string;
  cursor?: string;
  limit?: number;
  refresh?: boolean;
};

export type TruthPacketReference = {
  id: string;
  type: "accepted_decision" | "brain_node" | "document_section" | "workflow_owner";
  label: string;
  detail: string;
  status: string | null;
  authority: "accepted_truth" | "affected_reference" | "workflow_assignment";
  openTarget: { targetType: string; targetRef: Record<string, unknown> } | null;
};

export type TruthImpactGroupKey =
  | "product_brain"
  | "requirements"
  | "live_doc"
  | "source_documents"
  | "previous_decisions"
  | "owners"
  | "repositories"
  | "files_modules"
  | "pull_requests"
  | "tests"
  | "context_packs"
  | "agent_files"
  | "client_commitments";

export type TruthImpactItem = {
  id: string;
  group: TruthImpactGroupKey;
  label: string;
  detail: string;
  status: string | null;
  relationship: {
    kind: "direct_proposal_link" | "persisted_graph_link" | "accepted_shared_reference" | "recorded_impact";
    label: string;
    reason: string;
  };
  confidence: "verified" | "recorded" | "related";
  openTarget: { targetType: string; targetRef: Record<string, unknown> } | null;
};

export type TruthImpactMap = {
  proposalId: string | null;
  status: "mapped" | "partial" | "review_only";
  groups: Array<{
    key: TruthImpactGroupKey;
    label: string;
    coverage: "mapped" | "not_recorded" | "not_applicable";
    items: TruthImpactItem[];
  }>;
  summary: {
    mappedGroups: number;
    totalGroups: number;
    mappedItems: number;
    verifiedItems: number;
    recordedItems: number;
  };
  generatedAt: string;
  limitations: string[];
};

export type TruthChangePacket = {
  id: string;
  projectId: string;
  item: TruthInboxItem;
  packetKind: "proposed_change" | "review_signal";
  readiness: "decision_ready" | "needs_context" | "review_only";
  newEvidence: TruthInboxEvidence[];
  currentAcceptedTruth: TruthPacketReference[];
  recordedPriorUnderstanding: string[];
  proposedChange: { proposalId: string | null; proposalType: string | null; status: string; title: string; summary: string; statements: string[] } | null;
  potentialConflict: { summary: string; basis: string[]; interpretationOnly: true } | null;
  affected: {
    productAreas: TruthPacketReference[];
    engineering: string[];
    owners: Array<{ userId: string; displayName: string; email: string; source: "truth_inbox_assignment" }>;
  };
  impactMap: TruthImpactMap;
  confidence: { score: number; label: "low" | "medium" | "high"; basis: string[] };
  decision: {
    required: boolean;
    options: Array<"accept" | "reject" | "request_clarification" | "defer">;
    blockers: string[];
  };
  boundaries: Array<{
    stage: "evidence" | "interpretation" | "proposed_change" | "accepted_truth";
    state: "present" | "pending" | "unchanged" | "missing";
    label: string;
    detail: string;
  }>;
  generatedAt: string;
  limitations: string[];
};

export function getTruthInbox(projectId: string, filters: TruthInboxFilters = {}) {
  const query = new URLSearchParams();
  if (filters.category) query.set("category", filters.category);
  if (filters.severity) query.set("severity", filters.severity);
  if (filters.status) query.set("status", filters.status);
  if (filters.owner) query.set("owner", filters.owner);
  if (filters.source) query.set("source", filters.source);
  if (filters.cursor) query.set("cursor", filters.cursor);
  query.set("limit", String(filters.limit ?? 30));
  if (filters.refresh) query.set("refresh", "true");
  return apiJson<TruthInboxResponse>(`/v1/projects/${projectId}/truth-inbox?${query}`);
}

export function getTruthChangePacket(projectId: string, itemId: string) {
  return apiJson<TruthChangePacket>(`/v1/projects/${projectId}/truth-inbox/${encodeURIComponent(itemId)}/packet`);
}
export function actOnTruthInboxItem(
  projectId: string,
  itemId: string,
  action: TruthInboxAction,
  input: { assignedUserId?: string | null; note?: string; until?: string } = {}
) {
  return apiJson<TruthInboxActionResponse>(
    `/v1/projects/${projectId}/truth-inbox/${encodeURIComponent(itemId)}/actions/${action}`,
    { method: "POST", body: JSON.stringify(input) }
  );
}
