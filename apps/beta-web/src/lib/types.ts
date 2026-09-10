export type UserRole = "manager" | "developer" | "client";

export interface Doc {
  id: string;
  name: string;
  fileName?: string;
  type: "prd" | "srs" | "spec";
  size: string;
  pages: number;
  status: "ready" | "processing" | "failed";
  uploadedBy: string;
  uploadedAt: string;
  excerpt: string;
}

export interface DocSection {
  id?: string;
  sectionId?: string;
  anchorId: string;
  type?: "heading" | "paragraph" | "list" | "code";
  level?: number;
  content?: string;
  text?: string;
  headingPath?: string[];
  pageNumber?: number | null;
  citationLabel?: string;
  orderIndex?: number;
  hasChange?: false;
  citationIds?: string[];
}

export interface DocViewerPayload {
  id?: string;
  title?: string;
  version?: string | {
    id: string;
    status: string;
    mimeType?: string | null;
    parseRevision: number;
    parseConfidence: number | null;
    sourceLabel: string | null;
    createdAt: string;
    processedAt: string | null;
    isCurrent: boolean;
  };
  uploadedBy?: string;
  uploadedAt?: string;
  totalPages?: number;
  document?: {
    id: string;
    projectId: string;
    title: string;
    kind: string;
    visibility: string;
    currentVersionId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  selected?: {
    anchorId: string;
    sectionId: string;
    pageNumber: number | null;
  } | null;
  highlight?: {
    anchorId: string;
    citationLabel: string;
    pageNumber: number | null;
  } | null;
  meta?: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
    hasMore: boolean;
  };
  sections: DocSection[];
}

export interface AnchorProvenance {
  anchorId: string;
  sourceDoc: string;
  excerpt: string;
  linkedMessages: [];
  sourceNotes: [];
}

export interface RoleOption {
  key: "manager" | "dev" | "client";
  label: "Manager" | "Dev" | "Client";
  icon: "briefcase" | "code" | "user";
}

export type IntegrationCategory =
  | "editor"
  | "comms"
  | "calendar"
  | "payments"
  | "infrastructure"
  | "database"
  | "hosting"
  | "monitoring"
  | "notifications";

export interface IntegrationStatus {
  id: string;
  name: string;
  category: IntegrationCategory;
  connected: boolean;
  accountConnected?: boolean;
  lastSyncedAt?: string;
}
