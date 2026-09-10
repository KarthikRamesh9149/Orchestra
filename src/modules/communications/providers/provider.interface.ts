import type {
  CommunicationConnector,
  CommunicationProvider,
  CommunicationSyncType
} from "@prisma/client";
import type { NormalizedCommunicationBatch } from "../../../lib/communications/provider-normalized-types.js";

export interface NormalizedDocumentWorkspaceResource {
  provider: "notion";
  providerResourceId: string;
  resourceType: "page" | "database" | "data_source" | "database_item" | "child_page";
  parentResourceId?: string | null;
  selectedResourceId?: string | null;
  selectedResourceLabel?: string | null;
  title: string;
  url?: string | null;
  lastEditedAt?: string | Date | null;
  content: string;
  contentHash: string;
  fileName?: string | null;
  metadata?: Record<string, unknown> | null;
  skipped?: false;
}

export interface SkippedDocumentWorkspaceResource {
  provider: "notion";
  providerResourceId: string;
  resourceType: "page" | "database" | "data_source" | "database_item" | "child_page";
  selectedResourceId?: string | null;
  selectedResourceLabel?: string | null;
  title?: string | null;
  skipped: true;
  skipReason: "inaccessible" | "unsupported" | "empty" | "unselected" | "rate_limited" | "provider_error";
  error?: string | null;
}

export type ProviderResourceCandidate = {
  id: string;
  type: "page" | "database" | "data_source" | "team" | "channel" | "chat";
  title: string;
  url?: string | null;
  parentLabel?: string | null;
  lastEditedAt?: string | null;
  selected: boolean;
  inaccessible?: boolean;
  tenantId?: string | null;
  teamId?: string | null;
  channelId?: string | null;
  chatId?: string | null;
  resourceSubType?: string | null;
  description?: string | null;
  lastUpdatedAt?: string | null;
};

export interface ProviderConnectResult {
  mode: "connected" | "oauth_pending";
  status: "pending_auth" | "connected";
  redirectUrl?: string;
  accountLabel?: string;
  config?: Record<string, unknown>;
  credential?: Record<string, unknown> | null;
}

export interface ProviderCallbackResult {
  accountLabel: string;
  credential: Record<string, unknown>;
  providerCursor?: Record<string, unknown> | null;
  configPatch?: Record<string, unknown>;
}

export interface ProviderSyncResult {
  queued: boolean;
  batches?: NormalizedCommunicationBatch[];
  documentResources?: NormalizedDocumentWorkspaceResource[];
  skippedDocumentResources?: SkippedDocumentWorkspaceResource[];
  cursorAfter?: Record<string, unknown> | null;
  summary?: Record<string, unknown>;
  deletedProviderMessageIds?: string[];
  updatedCredential?: Record<string, unknown> | null;
  status?: "completed" | "partial";
}

export interface ProviderWebhookVerificationResult {
  handledImmediately?: { statusCode?: number; body: unknown };
  providerEventId?: string;
  eventType?: string;
  connectorIds?: string[];
  jobPayload?: Record<string, unknown>;
  projectIdHints?: string[];
}

export interface ProviderWebhookRegistrationResult {
  webhookId: string;
  webhookSecret?: string | null;
  configPatch?: Record<string, unknown>;
  updatedCredential?: Record<string, unknown> | null;
}

export interface ProviderChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isArchived: boolean;
}

export interface CommunicationProviderAdapter {
  readonly provider: CommunicationProvider;
  connect(input: {
    projectId: string;
    actorUserId: string;
    oauthState?: string;
    body?: unknown;
  }): Promise<ProviderConnectResult>;
  handleOAuthCallback?(input: {
    code: string;
    redirectUri: string;
  }): Promise<ProviderCallbackResult>;
  sync(input: {
    projectId: string;
    connector: CommunicationConnector;
    credential: Record<string, unknown> | null;
    syncType: CommunicationSyncType;
    webhookPayload?: Record<string, unknown>;
    batchSize: number;
    maxBackfillDays: number;
  }): Promise<ProviderSyncResult>;
  testConnection?(input: {
    connector?: CommunicationConnector;
    credential: Record<string, unknown> | null;
  }): Promise<{ ok: boolean; accountLabel?: string | null; details?: Record<string, unknown> }>;
  verifyWebhook?(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
    body: unknown;
    query?: Record<string, string | string[] | undefined>;
    connectors: CommunicationConnector[];
    credentialsByConnectorId?: Record<string, Record<string, unknown> | null>;
  }): Promise<ProviderWebhookVerificationResult>;
  registerWebhook?(input: {
    connector: CommunicationConnector;
    credential: Record<string, unknown> | null;
    endpointUrl: string;
  }): Promise<ProviderWebhookRegistrationResult>;
  listChannels?(input: {
    credential: Record<string, unknown> | null;
    includePrivateChannels?: boolean;
  }): Promise<ProviderChannel[]>;
  listResources?(input: {
    connector: CommunicationConnector;
    credential: Record<string, unknown> | null;
    query?: { search?: string; limit?: number; cursor?: string };
  }): Promise<{
    resources: ProviderResourceCandidate[];
    nextCursor?: string | null;
  }>;
  revoke?(input: {
    connector: CommunicationConnector;
    credential: Record<string, unknown> | null;
  }): Promise<{ providerRevoked: boolean; reason?: string }>;
  normalizeImport?(input: unknown): Promise<NormalizedCommunicationBatch>;
}
