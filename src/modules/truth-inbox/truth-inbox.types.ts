export type TruthInboxSourceType = "suggestion" | "proposal" | "fde" | "agent_drift" | "connector";

export type TruthInboxCategory =
  | "merge_conflicts"
  | "spec_drift"
  | "stalled_work"
  | "risk_flags"
  | "decision_conflicts"
  | "ownership_gaps"
  | "missing_evidence"
  | "connector_health"
  | "agent_drift"
  | "safe_to_touch";

export type TruthInboxSeverity = "low" | "medium" | "high" | "critical";
export type TruthInboxStatus =
  | "active"
  | "deferred"
  | "snoozed"
  | "dismissed"
  | "resolved"
  | "converted_to_review"
  | "converted_to_timeline";

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

export type TruthInboxOpenTarget = {
  targetType: string;
  targetRef: Record<string, unknown>;
};
export type TruthInboxEvidence = {
  id: string;
  source: string;
  label: string;
  excerpt: string | null;
  occurredAt: string | null;
  openTarget: TruthInboxOpenTarget | null;
};

export type TruthInboxOwner = {
  userId: string;
  displayName: string;
  email: string;
};

export type TruthInboxItem = {
  id: string;
  projectId: string;
  sourceType: TruthInboxSourceType;
  sourceId: string;
  sourceFingerprint: string | null;
  category: TruthInboxCategory;
  title: string;
  description: string;
  severity: TruthInboxSeverity;
  confidence: number;
  status: TruthInboxStatus;
  sourceLabels: string[];
  evidence: TruthInboxEvidence[];
  limitations: string[];
  owner: TruthInboxOwner | null;
  clarification: {
    note: string;
    requestedAt: string;
    requestedByUserId: string;
  } | null;
  deferredUntil: string | null;
  snoozedUntil: string | null;
  timelineEventRef: string | null;
  reviewProposalId: string | null;
  capabilities: Record<TruthInboxAction, boolean>;
  createdAt: string;
  updatedAt: string;
};

export type TruthInboxMember = TruthInboxOwner & {
  projectRole: "manager" | "dev";
  canApproveTruthChanges: boolean;
};

export type TruthInboxListResponse = {
  items: TruthInboxItem[];
  members: TruthInboxMember[];
  summary: {
    active: number;
    critical: number;
    awaitingDecision: number;
    assignedToMe: number;
  };
  countsByCategory: Partial<Record<TruthInboxCategory, number>>;
  countsByStatus: Partial<Record<TruthInboxStatus, number>>;
  sourceStates: Record<string, { state: string; label: string; detail: string | null }>;
  page: { limit: number; hasMore: boolean; nextCursor: string | null };
  generatedAt: string;
  cached: boolean;
  limitations: string[];
};
