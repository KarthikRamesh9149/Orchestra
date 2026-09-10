export type SuggestionCategory =
  | "merge_conflicts"
  | "spec_drift"
  | "stalled_work"
  | "reviewer_suggestions"
  | "risk_flags"
  | "decision_conflicts"
  | "ownership_gaps"
  | "coverage_gaps";

export type SuggestionSeverity = "low" | "medium" | "high" | "critical";
export type SuggestionStatus = "active" | "dismissed" | "converted_to_timeline" | "converted_to_review" | "resolved" | "superseded";
export type SuggestionSourceState = "ready" | "empty" | "not_connected" | "not_configured" | "degraded";

export type SuggestionSourceType =
  | "slack_message"
  | "microsoft_teams_message"
  | "message_insight"
  | "communication_thread"
  | "spec_change_proposal"
  | "live_doc_marker"
  | "timeline_event"
  | "activity_item"
  | "google_calendar_event"
  | "document_section"
  | "notion_document"
  | "google_drive_file"
  | "google_drive_document"
  | "socrates_artifact"
  | "github_pull_request"
  | "github_commit"
  | "github_check"
  | "github_branch"
  | "vscode_activity"
  | "project_member"
  | "project_subscription"
  | "audit_event";

export type SuggestionSourceRef = {
  type: SuggestionSourceType;
  id: string;
  label: string;
  openTarget?: {
    targetType: string;
    targetRef: Record<string, unknown>;
  } | null;
};

export type SuggestionEvidence = {
  source: SuggestionSourceType;
  refId: string;
  label: string;
  excerpt: string | null;
  occurredAt: string | null;
  openTarget?: {
    targetType: string;
    targetRef: Record<string, unknown>;
  } | null;
};

export type SuggestionActionKey = "dismiss" | "promote_to_timeline" | "create_review_item" | "ask_socrates";

export type ProjectSuggestion = {
  id: string;
  projectId: string;
  category: SuggestionCategory;
  title: string;
  description: string;
  severity: SuggestionSeverity;
  confidence: number;
  status: SuggestionStatus;
  sourceRefs: SuggestionSourceRef[];
  evidence: SuggestionEvidence[];
  recommendedActions: Array<{ key: SuggestionActionKey; label: string; description: string }>;
  limitations: string[];
  detectorKey: string;
  sourceFingerprint: string;
  staleAfter: string | null;
  createdAt: string;
  updatedAt: string;
  dismissedAt: string | null;
  dismissedByUserId: string | null;
  promotedTimelineEventId: string | null;
  createdProposalId: string | null;
  metadata: Record<string, unknown>;
};

export type SuggestionsSourceStates = Record<
  | "slack"
  | "microsoft_teams"
  | "livedoc"
  | "timeline"
  | "calendar"
  | "documents"
  | "notion"
  | "google_drive"
  | "socrates"
  | "github"
  | "vscode",
  { state: SuggestionSourceState; label: string; detail: string | null }
>;

export type SuggestionsListResponse = {
  items: ProjectSuggestion[];
  sourceStates: SuggestionsSourceStates;
  countsByCategory: Record<SuggestionCategory, number>;
  countsBySeverity: Record<SuggestionSeverity, number>;
  generatedAt: string;
  limitations: string[];
};
