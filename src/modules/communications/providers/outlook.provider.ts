import type { CommunicationConnector } from "@prisma/client";
import type { AppEnv } from "../../../config/env.js";
import { AppError } from "../../../app/errors.js";
import { htmlToText } from "../../../lib/communications/html-to-text.js";
import {
  buildMicrosoftOAuthUrl,
  callMicrosoftGraph,
  exchangeMicrosoftCode,
  refreshMicrosoftAccessToken,
  verifyMicrosoftWebhookClientState,
  type MicrosoftCredential
} from "../../../lib/communications/microsoft-graph.js";
import type {
  NormalizedAttachment,
  NormalizedCommunicationBatch,
  NormalizedMessage,
  NormalizedParticipant,
  NormalizedThread
} from "../../../lib/communications/provider-normalized-types.js";
import type {
  CommunicationProviderAdapter,
  ProviderCallbackResult,
  ProviderSyncResult,
  ProviderWebhookVerificationResult
} from "./provider.interface.js";

type FetchLike = typeof fetch;

const OUTLOOK_SCOPES = ["offline_access", "openid", "profile", "https://graph.microsoft.com/Mail.Read"];

export class OutlookProvider implements CommunicationProviderAdapter {
  readonly provider = "outlook" as const;

  constructor(
    private readonly env: AppEnv,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async connect(input: { oauthState?: string }) {
    if (!input.oauthState) {
      throw new AppError(400, "Microsoft OAuth state is required", "microsoft_oauth_state_required");
    }

    return {
      mode: "oauth_pending" as const,
      status: "pending_auth" as const,
      redirectUrl: buildMicrosoftOAuthUrl(this.env, input.oauthState, OUTLOOK_SCOPES),
      accountLabel: "Outlook",
      config: {
        folderIds: ["Inbox"],
        query: "",
        backfillDays: Math.min(30, this.env.CONNECTOR_SYNC_MAX_BACKFILL_DAYS),
        includeAttachmentsMetadata: true
      }
    };
  }

  async handleOAuthCallback(input: { code: string }): Promise<ProviderCallbackResult> {
    const credential = await exchangeMicrosoftCode(this.env, this.fetchImpl, input.code, OUTLOOK_SCOPES);
    const profile = await callMicrosoftGraph<{ displayName?: string; userPrincipalName?: string; id?: string }>(
      this.fetchImpl,
      credential,
      "/me?$select=id,displayName,userPrincipalName"
    );

    return {
      accountLabel: profile.userPrincipalName ?? profile.displayName ?? "Outlook",
      credential: {
        ...credential,
        accountLabel: profile.userPrincipalName ?? profile.displayName ?? "Outlook",
        userId: profile.id
      },
      providerCursor: {
        latestReceivedDateTime: null,
        deltaLink: null
      },
      configPatch: {
        emailAddress: profile.userPrincipalName ?? null
      }
    };
  }

  async sync(input: {
    projectId: string;
    connector: CommunicationConnector;
    credential: Record<string, unknown> | null;
    syncType: "manual" | "webhook" | "backfill" | "incremental";
    webhookPayload?: Record<string, unknown>;
    batchSize: number;
    maxBackfillDays: number;
  }): Promise<ProviderSyncResult> {
    let credential = this.requireCredential(input.credential);
    if (credential.expiryDate && credential.expiryDate <= Date.now() + 60_000) {
      credential = {
        ...credential,
        ...(await refreshMicrosoftAccessToken(this.env, this.fetchImpl, credential, OUTLOOK_SCOPES))
      };
    }

    const config = this.parseConfig(input.connector.configJson);
    const cursor = this.parseCursor(input.connector.providerCursorJson);
    const threadMap = new Map<string, NormalizedThread>();
    const messageMap = new Map<string, NormalizedMessage>();
    let nextDeltaLink = cursor.deltaLink ?? null;
    let latestReceivedDateTime = cursor.latestReceivedDateTime ?? null;

    if (input.syncType === "incremental" && cursor.deltaLink) {
      const deltaPayload = await callMicrosoftGraph<{
        value?: Record<string, any>[];
        "@odata.deltaLink"?: string;
      }>(this.fetchImpl, credential, cursor.deltaLink);

      for (const item of deltaPayload.value ?? []) {
        const normalized = this.normalizeGraphMessage(item, config.includeAttachmentsMetadata);
        threadMap.set(normalized.thread.providerThreadId, normalized.thread);
        messageMap.set(normalized.message.providerMessageId, normalized.message);
        latestReceivedDateTime = this.maxIso(latestReceivedDateTime, this.toIsoString(normalized.message.sentAt));
      }
      nextDeltaLink = deltaPayload["@odata.deltaLink"] ?? nextDeltaLink;
    } else {
      const backfillDays = Math.min(config.backfillDays, input.maxBackfillDays);
      const sinceIso = new Date(Date.now() - backfillDays * 24 * 60 * 60 * 1000).toISOString();
      const filterParts = [
        config.query ? config.query : null,
        `receivedDateTime ge ${sinceIso}`
      ].filter(Boolean);

      for (const folderId of config.folderIds) {
        const url = new URL(`https://graph.microsoft.com/v1.0/me/mailFolders/${encodeURIComponent(folderId)}/messages`);
        url.searchParams.set(
          "$select",
          "id,conversationId,subject,from,toRecipients,ccRecipients,bccRecipients,body,bodyPreview,receivedDateTime,lastModifiedDateTime,webLink,isDraft,internetMessageId,hasAttachments"
        );
        url.searchParams.set("$top", String(Math.min(input.batchSize, 50)));
        url.searchParams.set("$orderby", "receivedDateTime desc");
        if (filterParts.length > 0) {
          url.searchParams.set("$filter", filterParts.join(" and "));
        }

        const page = await callMicrosoftGraph<{ value?: Record<string, any>[] }>(this.fetchImpl, credential, url.toString());
        for (const item of page.value ?? []) {
          const normalized = this.normalizeGraphMessage(item, config.includeAttachmentsMetadata);
          threadMap.set(normalized.thread.providerThreadId, normalized.thread);
          messageMap.set(normalized.message.providerMessageId, normalized.message);
          latestReceivedDateTime = this.maxIso(latestReceivedDateTime, this.toIsoString(normalized.message.sentAt));
        }
      }

      if (!config.query) {
        const deltaUrl = new URL("https://graph.microsoft.com/v1.0/me/messages/delta");
        deltaUrl.searchParams.set(
          "$select",
          "id,conversationId,subject,from,toRecipients,ccRecipients,bccRecipients,body,bodyPreview,receivedDateTime,lastModifiedDateTime,webLink,isDraft,internetMessageId,hasAttachments"
        );
        nextDeltaLink = deltaUrl.toString();
      }
    }

    const batches: NormalizedCommunicationBatch[] =
      messageMap.size === 0
        ? []
        : [
            {
              projectId: input.projectId,
              connectorId: input.connector.id,
              provider: "outlook",
              threads: [...threadMap.values()],
              messages: [...messageMap.values()]
            }
          ];

    return {
      queued: false,
      batches,
      status: "completed",
      cursorAfter: {
        latestReceivedDateTime,
        deltaLink: nextDeltaLink
      },
      updatedCredential: credential,
      summary: {
        provider: "outlook",
        threadCount: threadMap.size,
        messageCount: messageMap.size,
        latestReceivedDateTime
      }
    };
  }

  async verifyWebhook(input: {
    body: unknown;
    query?: Record<string, string | string[] | undefined>;
  }): Promise<ProviderWebhookVerificationResult> {
    const validationToken = input.query?.validationToken;
    const validationValue = Array.isArray(validationToken) ? validationToken[0] : validationToken;
    if (validationValue) {
      return {
        handledImmediately: {
          statusCode: 200,
          body: validationValue
        }
      };
    }

    const body = input.body as { value?: Array<Record<string, any>> };
    const notifications = body.value ?? [];
    if (notifications.length === 0) {
      throw new AppError(422, "Outlook webhook notification payload is empty", "outlook_webhook_empty");
    }
    const connectorIds = notifications.map((item) => {
      if (typeof item.clientState !== "string" || item.clientState.trim().length === 0) {
        throw new AppError(401, "Outlook webhook clientState is required", "microsoft_webhook_client_state_invalid");
      }
      return verifyMicrosoftWebhookClientState(
        item.clientState,
        this.env.CONNECTOR_OAUTH_STATE_SECRET,
        true
      );
    });

    const providerEventId =
      notifications[0]?.subscriptionId && notifications[0]?.resourceData?.id
        ? `${notifications[0].subscriptionId}:${notifications[0].resourceData.id}`
        : `outlook:${Date.now()}`;

    return {
      providerEventId,
      eventType: notifications[0]?.changeType ?? "notification",
      connectorIds,
      jobPayload: {
        notifications: notifications.slice(0, 20).map((item) => ({
          subscriptionId: typeof item.subscriptionId === "string" ? item.subscriptionId : null,
          changeType: typeof item.changeType === "string" ? item.changeType : null,
          tenantId: typeof item.tenantId === "string" ? item.tenantId : null,
          resource: typeof item.resource === "string" ? item.resource.slice(0, 500) : null,
          resourceData:
            item.resourceData && typeof item.resourceData === "object"
              ? {
                  id: typeof item.resourceData.id === "string" ? item.resourceData.id : null,
                  "@odata.type": typeof item.resourceData["@odata.type"] === "string" ? item.resourceData["@odata.type"] : null,
                  "@odata.id": typeof item.resourceData["@odata.id"] === "string" ? item.resourceData["@odata.id"].slice(0, 500) : null
                }
              : null
        }))
      }
    };
  }

  async revoke() {
    return { providerRevoked: false, reason: "Microsoft does not expose token revocation for this application flow; the local credential was removed." };
  }

  private requireCredential(credential: Record<string, unknown> | null): MicrosoftCredential {
    if (!credential || typeof credential.accessToken !== "string" || credential.accessToken.length === 0) {
      throw new AppError(409, "Outlook connector credential is missing", "outlook_credential_missing");
    }
    return credential as MicrosoftCredential;
  }

  private parseConfig(configJson: unknown) {
    const config = (configJson ?? {}) as Record<string, unknown>;
    return {
      folderIds:
        Array.isArray(config.folderIds) && config.folderIds.length > 0
          ? config.folderIds.filter((value): value is string => typeof value === "string")
          : ["Inbox"],
      query: typeof config.query === "string" ? config.query.trim() : "",
      backfillDays:
        typeof config.backfillDays === "number" && Number.isFinite(config.backfillDays) ? config.backfillDays : 30,
      includeAttachmentsMetadata: config.includeAttachmentsMetadata !== false
    };
  }

  private parseCursor(cursorJson: unknown) {
    const cursor = (cursorJson ?? {}) as Record<string, unknown>;
    return {
      latestReceivedDateTime:
        typeof cursor.latestReceivedDateTime === "string" ? cursor.latestReceivedDateTime : null,
      deltaLink: typeof cursor.deltaLink === "string" ? cursor.deltaLink : null
    };
  }

  private toIsoString(value: string | Date) {
    return value instanceof Date ? value.toISOString() : value;
  }

  private normalizeGraphMessage(message: Record<string, any>, includeAttachmentsMetadata: boolean) {
    const providerThreadId = typeof message.conversationId === "string" && message.conversationId.length > 0 ? message.conversationId : String(message.id);
    const participants = this.normalizeParticipants(message);
    const bodyHtml = typeof message.body?.content === "string" ? message.body.content : null;
    const bodyText = bodyHtml ? htmlToText(bodyHtml) : (typeof message.bodyPreview === "string" ? message.bodyPreview : "[empty message]");
    const sentAt = typeof message.receivedDateTime === "string" ? message.receivedDateTime : new Date().toISOString();
    const thread: NormalizedThread = {
      providerThreadId,
      subject: typeof message.subject === "string" ? message.subject : null,
      participants,
      startedAt: sentAt,
      lastMessageAt: sentAt,
      threadUrl: typeof message.webLink === "string" ? message.webLink : null,
      rawMetadata: {
        conversationId: message.conversationId ?? null
      }
    };
    const attachments: NormalizedAttachment[] =
      includeAttachmentsMetadata && Array.isArray(message.attachments)
        ? message.attachments.map((attachment) => ({
            providerAttachmentId: typeof attachment.id === "string" ? attachment.id : null,
            filename: typeof attachment.name === "string" ? attachment.name : null,
            mimeType: typeof attachment.contentType === "string" ? attachment.contentType : null,
            fileSize: typeof attachment.size === "number" ? attachment.size : null,
            providerUrl: null,
            rawMetadata: {
              isInline: attachment.isInline ?? false
            }
          }))
        : [];

    const from = message.from?.emailAddress;
    const normalizedMessage: NormalizedMessage = {
      providerMessageId: String(message.id),
      senderLabel: from?.name || from?.address || "Outlook sender",
      senderExternalRef: from?.address || null,
      senderEmail: from?.address || null,
      sentAt,
      bodyText,
      bodyHtml,
      messageType: message.isDraft ? "note" : "user",
      providerPermalink: typeof message.webLink === "string" ? message.webLink : null,
      replyToProviderMessageId: null,
      rawMetadata: {
        providerThreadId,
        internetMessageId: message.internetMessageId ?? null,
        lastModifiedDateTime: message.lastModifiedDateTime ?? null
      },
      attachments
    };

    return { thread, message: normalizedMessage };
  }

  private normalizeParticipants(message: Record<string, any>): NormalizedParticipant[] {
    const buckets = [
      ...(Array.isArray(message.toRecipients) ? message.toRecipients : []),
      ...(Array.isArray(message.ccRecipients) ? message.ccRecipients : []),
      ...(Array.isArray(message.bccRecipients) ? message.bccRecipients : []),
      ...(message.from ? [message.from] : [])
    ];

    return buckets
      .map((participant) => participant?.emailAddress)
      .filter((value): value is { name?: string; address?: string } => Boolean(value))
      .map((address) => ({
        label: address.name || address.address || "Participant",
        externalRef: address.address || null,
        email: address.address || null
      }));
  }

  private maxIso(current: string | null, candidate: string) {
    if (!current) {
      return candidate;
    }
    return Date.parse(candidate) > Date.parse(current) ? candidate : current;
  }
}
