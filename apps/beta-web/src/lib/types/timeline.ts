export type TimelineSource =
  | "manual" | "calendar" | "slack" | "clickup" | "granola" | "fireflies_ai"
  | "manual_import" | "microsoft_teams" | "zoho_mail" | "zoho_cliq" | "zoho_crm"
  | "github" | "google_drive" | "notion" | "socrates" | "vscode" | "document"
  | "approval" | "system";
export type TimelineTier = "milestone" | "atomic";
export type TimelineEventType = "decision" | "change" | "commit" | "message" | "note" | "milestone" | "upload" | "approval" | "rejection" | "connector" | "query";
export type TimelineStatus = "approved" | "pending";
export type TimelineCategory = "frontend" | "backend" | "database" | "design" | "product";

export type TimelineDiff = {
  field: string;
  old: string;
  new: string;
};

export type TimelineAuthor = {
  name: string;
  initials: string;
  color: string;
};

export type TimelineEvent = {
  id: string;
  title: string;
  description: string;
  source: TimelineSource;
  sourceRef: string;
  sourceUrl?: string;
  author: TimelineAuthor;
  timestamp: string;
  tier: TimelineTier;
  type: TimelineEventType;
  status: TimelineStatus;
  approvedBy?: string;
  approvedAt?: string;
  diff?: TimelineDiff[];
  category?: TimelineCategory;
  categories?: TimelineCategory[];
  proposalId?: string | null;
  metadataSummary?: string | null;
  openTarget?: { targetType: string; targetRef: Record<string, unknown> } | null;
};
