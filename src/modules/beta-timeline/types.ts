export type TimelineSource =
  | "manual"
  | "calendar"
  | "slack"
  | "clickup"
  | "granola"
  | "fireflies_ai"
  | "manual_import"
  | "microsoft_teams"
  | "zoho_mail"
  | "zoho_cliq"
  | "zoho_crm"
  | "github"
  | "google_drive"
  | "notion"
  | "socrates"
  | "vscode"
  | "document"
  | "approval"
  | "system";

export type TimelineEventType =
  | "note"
  | "milestone"
  | "decision"
  | "change"
  | "commit"
  | "message"
  | "upload"
  | "approval"
  | "rejection"
  | "connector"
  | "query";

export type TimelineStatus = "informational" | "pending" | "accepted" | "rejected" | "superseded" | "failed";

export type TimelineTier = "milestone" | "atomic";

export type TimelineActor = {
  userId: string | null;
  name: string;
  initials: string;
  role: string | null;
};

export type TimelineOpenTarget = {
  targetType: string;
  targetRef: Record<string, unknown>;
};

export type TimelineDiff = {
  field: string;
  old: string | null;
  new: string | null;
};

export type TimelineEventDto = {
  id: string;
  source: TimelineSource;
  type: TimelineEventType;
  title: string;
  description: string | null;
  timestamp: string;
  status: TimelineStatus;
  author: TimelineActor | null;
  sourceRef: string | null;
  tier: TimelineTier;
  diff: TimelineDiff[] | null;
  openTarget: TimelineOpenTarget | null;
  proposalId: string | null;
  reviewItemId: string | null;
  sectionKey: string | null;
  documentSectionId: string | null;
  sourceMessageId: string | null;
  sourceThreadId: string | null;
  sourceDocumentId: string | null;
  acceptedBy: TimelineActor | null;
  acceptedAt: string | null;
  rejectedBy: TimelineActor | null;
  rejectedAt: string | null;
  metadataSummary: string | null;
};
