import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { CommunicationConnector } from "@prisma/client";
import type { AppEnv } from "../../../config/env.js";
import { AppError } from "../../../app/errors.js";
import type {
  NormalizedAttachment,
  NormalizedCommunicationBatch,
  NormalizedMessage,
  NormalizedParticipant,
  NormalizedThread
} from "../../../lib/communications/provider-normalized-types.js";
import type {
  CommunicationProviderAdapter,
  ProviderSyncResult,
  ProviderWebhookVerificationResult
} from "./provider.interface.js";

export class WhatsAppBusinessProvider implements CommunicationProviderAdapter {
  readonly provider = "whatsapp_business" as const;

  constructor(private readonly env: AppEnv) {}

  async connect() {
    return {
      mode: "connected" as const,
      status: this.env.WHATSAPP_READINESS_MODE === "webhook_inbound" ? "connected" as const : "pending_auth" as const,
      accountLabel: "WhatsApp Business",
      config: {
        phoneNumberIds: [],
        readinessMode: this.env.WHATSAPP_READINESS_MODE,
        includeMediaMetadata: true
      }
    };
  }

  async sync(input: {
    projectId: string;
    connector: CommunicationConnector;
    syncType: "manual" | "webhook" | "backfill" | "incremental";
    webhookPayload?: Record<string, unknown>;
  }): Promise<ProviderSyncResult> {
    if (input.syncType !== "webhook") {
      return {
        queued: false,
        summary: {
          provider: "whatsapp_business",
          messageCount: 0,
          threadCount: 0,
          readinessMode: this.env.WHATSAPP_READINESS_MODE,
          note: "WhatsApp Business is webhook-first; manual sync is a safe no-op."
        }
      };
    }

    const change = (input.webhookPayload?.change ?? null) as Record<string, any> | null;
    const value = change?.value as Record<string, any> | undefined;
    const messages = Array.isArray(value?.messages) ? value.messages : [];
    const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
    if (messages.length === 0) {
      return {
        queued: false,
        summary: {
          provider: "whatsapp_business",
          statusEventCount: statuses.length,
          messageCount: 0,
          threadCount: 0
        }
      };
    }

    const normalizedThreads = new Map<string, NormalizedThread>();
    const normalizedMessages = new Map<string, NormalizedMessage>();
    const metadata = Array.isArray(value?.metadata) ? value.metadata[0] : value?.metadata;
    const phoneNumberId = typeof metadata?.phone_number_id === "string" ? metadata.phone_number_id : null;

    for (const message of messages) {
      const normalized = this.normalizeInboundMessage(phoneNumberId, value, message);
      normalizedThreads.set(normalized.thread.providerThreadId, normalized.thread);
      normalizedMessages.set(normalized.message.providerMessageId, normalized.message);
    }

    const batches: NormalizedCommunicationBatch[] = [
      {
        projectId: input.projectId,
        connectorId: input.connector.id,
        provider: "whatsapp_business",
        threads: [...normalizedThreads.values()],
        messages: [...normalizedMessages.values()]
      }
    ];

    return {
      queued: false,
      status: "completed",
      batches,
      summary: {
        provider: "whatsapp_business",
        messageCount: normalizedMessages.size,
        threadCount: normalizedThreads.size,
        statusEventCount: statuses.length
      }
    };
  }

  async verifyWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
    body: unknown;
    query?: Record<string, string | string[] | undefined>;
    connectors: CommunicationConnector[];
  }): Promise<ProviderWebhookVerificationResult> {
    const mode = Array.isArray(input.query?.["hub.mode"]) ? input.query?.["hub.mode"]?.[0] : input.query?.["hub.mode"];
    const challenge = Array.isArray(input.query?.["hub.challenge"])
      ? input.query?.["hub.challenge"]?.[0]
      : input.query?.["hub.challenge"];
    const verifyToken = Array.isArray(input.query?.["hub.verify_token"])
      ? input.query?.["hub.verify_token"]?.[0]
      : input.query?.["hub.verify_token"];

    if (mode === "subscribe") {
      if (!this.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || verifyToken !== this.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
        throw new AppError(401, "WhatsApp webhook verify token is invalid", "whatsapp_webhook_verify_failed");
      }
      return {
        handledImmediately: {
          statusCode: 200,
          body: challenge ?? "ok"
        }
      };
    }

    if (this.env.WHATSAPP_READINESS_MODE === "webhook_inbound" && !this.env.WHATSAPP_APP_SECRET) {
      throw new AppError(503, "WhatsApp app secret is required for inbound webhooks", "whatsapp_webhook_app_secret_missing");
    }

    if (this.env.WHATSAPP_APP_SECRET) {
      const signatureHeader = input.headers["x-hub-signature-256"];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      if (!signature) {
        throw new AppError(401, "WhatsApp webhook signature is missing", "whatsapp_webhook_signature_missing");
      }
      const expected = `sha256=${createHmac("sha256", this.env.WHATSAPP_APP_SECRET).update(input.rawBody).digest("hex")}`;
      const expectedBuffer = Buffer.from(expected, "utf8");
      const actualBuffer = Buffer.from(signature, "utf8");
      if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
        throw new AppError(401, "WhatsApp webhook signature is invalid", "whatsapp_webhook_signature_invalid");
      }
    }

    const body = input.body as { entry?: Array<Record<string, any>> };
    const entries = body.entry ?? [];
    const change = entries[0]?.changes?.[0] as Record<string, any> | undefined;
    const value = change?.value as Record<string, any> | undefined;
    const metadata = value?.metadata as Record<string, any> | undefined;
    const phoneNumberId = typeof metadata?.phone_number_id === "string" ? metadata.phone_number_id : null;

    const connectorIds = input.connectors
      .filter((connector) => {
        const config = (connector.configJson ?? {}) as Record<string, unknown>;
        const phoneNumberIds = Array.isArray(config.phoneNumberIds)
          ? config.phoneNumberIds.filter((item): item is string => typeof item === "string")
          : [];
        return phoneNumberId ? phoneNumberIds.includes(phoneNumberId) : false;
      })
      .map((connector) => connector.id);

    const firstMessageId = Array.isArray(value?.messages) && value.messages[0]?.id ? value.messages[0].id : null;
    const firstStatusId = Array.isArray(value?.statuses) && value.statuses[0]?.id ? value.statuses[0].id : null;

    return {
      providerEventId: String(firstMessageId ?? firstStatusId ?? `${phoneNumberId ?? "unknown"}:${Date.now()}`),
      eventType: Array.isArray(value?.messages) && value.messages.length > 0 ? "message" : "status",
      connectorIds,
      jobPayload: {
        change: buildSafeWhatsAppWebhookChange(change)
      }
    };
  }

  async revoke() {
    return { providerRevoked: false, reason: "WhatsApp access must also be removed in Meta Business settings; the local credential was removed." };
  }

  private normalizeInboundMessage(phoneNumberId: string | null, value: Record<string, any> | undefined, message: Record<string, any>) {
    const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
    const contact = contacts.find((item) => item.wa_id === message.from) ?? contacts[0];
    const conversationId = typeof message.context?.conversation?.id === "string" ? message.context.conversation.id : null;
    const providerThreadId = conversationId ?? `${phoneNumberId ?? "unknown"}:${String(message.from ?? "unknown")}`;
    const participant: NormalizedParticipant = {
      label: contact?.profile?.name ?? String(message.from ?? "WhatsApp contact"),
      externalRef: String(message.from ?? contact?.wa_id ?? ""),
      email: null
    };
    const sentAt = typeof message.timestamp === "string" && /^\d+$/.test(message.timestamp)
      ? new Date(Number(message.timestamp) * 1000).toISOString()
      : new Date().toISOString();
    const { bodyText, attachments, bodyHtml } = this.extractBodyAndAttachments(message);

    const thread: NormalizedThread = {
      providerThreadId,
      subject: `WhatsApp ${participant.label}`,
      participants: [participant],
      startedAt: sentAt,
      lastMessageAt: sentAt,
      threadUrl: null,
      rawMetadata: {
        phoneNumberId,
        waId: participant.externalRef
      }
    };

    const normalizedMessage: NormalizedMessage = {
      providerMessageId: String(message.id),
      senderLabel: participant.label,
      senderExternalRef: participant.externalRef,
      senderEmail: null,
      sentAt,
      bodyText,
      bodyHtml,
      messageType: attachments.length > 0 ? "file_share" : "user",
      providerPermalink: null,
      replyToProviderMessageId: message.context?.id ? String(message.context.id) : null,
      rawMetadata: {
        providerThreadId,
        messageType: message.type ?? "text",
        phoneNumberId
      },
      attachments
    };

    return { thread, message: normalizedMessage };
  }

  private extractBodyAndAttachments(message: Record<string, any>) {
    const attachments: NormalizedAttachment[] = [];
    let bodyText = "[empty whatsapp message]";
    let bodyHtml: string | null = null;

    switch (message.type) {
      case "text":
        bodyText = typeof message.text?.body === "string" ? message.text.body : bodyText;
        break;
      case "image":
      case "video":
      case "audio":
      case "document":
        bodyText = typeof message[message.type]?.caption === "string" ? message[message.type].caption : `[${message.type}]`;
        attachments.push({
          providerAttachmentId: typeof message[message.type]?.id === "string" ? message[message.type].id : null,
          filename: typeof message.document?.filename === "string" ? message.document.filename : null,
          mimeType: typeof message[message.type]?.mime_type === "string" ? message[message.type].mime_type : null,
          fileSize: null,
          providerUrl: null,
          rawMetadata: {
            sha256: message[message.type]?.sha256 ?? null
          }
        });
        break;
      default:
        bodyText = `[${String(message.type ?? "message")}]`;
        bodyHtml = null;
        break;
    }

    return { bodyText, bodyHtml, attachments };
  }
}

function buildSafeWhatsAppWebhookChange(change: Record<string, any> | undefined) {
  const value = change?.value as Record<string, any> | undefined;
  const metadata = value?.metadata as Record<string, any> | undefined;
  return {
    field: typeof change?.field === "string" ? change.field : null,
    value: {
      metadata: {
        phone_number_id: typeof metadata?.phone_number_id === "string" ? metadata.phone_number_id : null,
        display_phone_number: typeof metadata?.display_phone_number === "string" ? metadata.display_phone_number : null
      },
      contacts: sanitizeWhatsAppContacts(value?.contacts),
      messages: sanitizeWhatsAppMessages(value?.messages),
      statuses: sanitizeWhatsAppStatuses(value?.statuses)
    }
  };
}

function sanitizeWhatsAppContacts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((item) => ({
    wa_id: typeof item?.wa_id === "string" ? item.wa_id : null,
    profile: { name: typeof item?.profile?.name === "string" ? item.profile.name.slice(0, 200) : null }
  }));
}

function sanitizeWhatsAppMessages(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((message) => {
    const textBody = typeof message?.text?.body === "string" ? message.text.body.slice(0, 20_000) : null;
    return {
      id: typeof message?.id === "string" ? message.id : null,
      from: typeof message?.from === "string" ? message.from : null,
      timestamp: typeof message?.timestamp === "string" ? message.timestamp : null,
      type: typeof message?.type === "string" ? message.type : null,
      text: textBody ? { body: textBody } : undefined,
      context:
        message?.context && typeof message.context === "object"
          ? {
              id: typeof message.context.id === "string" ? message.context.id : null,
              from: typeof message.context.from === "string" ? message.context.from : null,
              conversation:
                message.context.conversation && typeof message.context.conversation.id === "string"
                  ? { id: message.context.conversation.id }
                  : undefined
            }
          : undefined,
      bodyHash: textBody ? createHash("sha256").update(textBody).digest("hex") : null
    };
  });
}

function sanitizeWhatsAppStatuses(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((status) => ({
    id: typeof status?.id === "string" ? status.id : null,
    status: typeof status?.status === "string" ? status.status : null,
    timestamp: typeof status?.timestamp === "string" ? status.timestamp : null,
    recipient_id: typeof status?.recipient_id === "string" ? status.recipient_id : null
  }));
}
