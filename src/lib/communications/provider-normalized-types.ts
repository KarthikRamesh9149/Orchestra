import type { CommunicationMessageType, CommunicationProvider } from "@prisma/client";

export type NormalizedParticipant = {
  label: string;
  externalRef?: string | null;
  email?: string | null;
};

export type NormalizedAttachment = {
  providerAttachmentId?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  providerUrl?: string | null;
  rawMetadata?: Record<string, unknown> | null;
};

export type NormalizedThread = {
  providerThreadId: string;
  subject?: string | null;
  participants: NormalizedParticipant[];
  startedAt?: string | Date | null;
  lastMessageAt?: string | Date | null;
  threadUrl?: string | null;
  rawMetadata?: Record<string, unknown> | null;
};

export type NormalizedMessage = {
  providerThreadId?: string | null;
  providerMessageId: string;
  senderLabel: string;
  senderExternalRef?: string | null;
  senderEmail?: string | null;
  sentAt: string | Date;
  bodyText: string;
  bodyHtml?: string | null;
  messageType: CommunicationMessageType;
  providerPermalink?: string | null;
  replyToProviderMessageId?: string | null;
  rawMetadata?: Record<string, unknown> | null;
  attachments?: NormalizedAttachment[];
};

export type NormalizedCommunicationBatch = {
  projectId: string;
  connectorId: string;
  provider: CommunicationProvider;
  syncRunId?: string | null;
  threads: NormalizedThread[];
  messages: NormalizedMessage[];
};
