import type { ProviderChannel } from "./provider.interface.js";
import type { CommunicationConnector, CommunicationSyncType } from "@prisma/client";
import type { AppEnv } from "../../../config/env.js";
import type {
  NormalizedCommunicationBatch,
  NormalizedMessage,
  NormalizedThread
} from "../../../lib/communications/provider-normalized-types.js";
import { ZohoProviderBase } from "./zoho/zoho-provider-base.js";
import type { ZohoCredential } from "./zoho/zoho-types.js";
import {
  zohoArrayFromPayload,
  zohoBound,
  zohoDate,
  zohoIso,
  zohoParticipant,
  zohoSafeMetadata,
  zohoString,
  zohoStringArray,
  zohoText,
  zohoUniqueParticipants
} from "./zoho/zoho-normalization.js";

export class ZohoCliqProvider extends ZohoProviderBase {
  readonly provider = "zoho_cliq" as const;
  protected readonly service = "cliq" as const;
  protected readonly defaultAccountLabel = "Zoho Cliq";

  constructor(env: AppEnv, fetchImpl: typeof fetch = fetch) {
    super(env, fetchImpl);
  }

  protected providerConfigDefaults() {
    return {
      orgId: null,
      teamId: null,
      selectedChannelIds: [],
      selectedChannelNames: [],
      selectedChatIds: [],
      includeThreads: true,
      includeDirectChats: false,
      maxBackfillDays: this.env.CONNECTOR_SYNC_MAX_BACKFILL_DAYS,
      syncBatchSize: this.env.ZOHO_CLIQ_SYNC_BATCH_SIZE,
      defaultChannelScope: this.env.ZOHO_CLIQ_DEFAULT_CHANNEL_SCOPE,
      writeActionsEnabled: false
    };
  }

  protected async resolveAccountLabel(credential: ZohoCredential) {
    const { payload } = await this.client.getCliqChannels(credential);
    return {
      label: "Zoho Cliq",
      configPatch: {
        channelCountAtConnect: this.arrayFromPayload(payload, ["channels", "data"]).length
      }
    };
  }

  async testConnection(input: { credential: Record<string, unknown> | null }) {
    const credential = this.requireCredential(input.credential);
    const { payload } = await this.client.getCliqChannels(credential);
    return {
      ok: true,
      accountLabel: "Zoho Cliq",
      details: { channelCount: this.arrayFromPayload(payload, ["channels", "data"]).length }
    };
  }

  async listChannels(input: { credential: Record<string, unknown> | null }): Promise<ProviderChannel[]> {
    const credential = this.requireCredential(input.credential);
    const channelPayload = await this.client.getCliqChannels(credential);
    const chatPayload = await this.client.getCliqChats(credential).catch(() => ({ payload: {} as Record<string, any> }));
    const channels: ProviderChannel[] = [];
    for (const channel of this.arrayFromPayload(channelPayload.payload, ["channels", "data"])) {
      const record = channel as Record<string, unknown>;
      const id = this.stringValue(record.id ?? record.channel_id ?? record.unique_name);
      if (!id) continue;
      channels.push({
        id: `channel:${id}`,
        name: this.stringValue(record.name ?? record.display_name ?? record.unique_name) ?? id,
        isPrivate: Boolean(record.is_private ?? record.private),
        isArchived: Boolean(record.is_archived ?? record.archived)
      });
    }
    for (const chat of this.arrayFromPayload(chatPayload.payload, ["chats", "data"])) {
      const record = chat as Record<string, unknown>;
      const id = this.stringValue(record.id ?? record.chat_id);
      if (!id) continue;
      channels.push({
        id: `chat:${id}`,
        name: this.stringValue(record.name ?? record.title) ?? `Chat ${id}`,
        isPrivate: true,
        isArchived: false
      });
    }
    return channels;
  }

  async sync(input: {
    projectId: string;
    connector: CommunicationConnector;
    credential: Record<string, unknown> | null;
    syncType: CommunicationSyncType;
    batchSize: number;
    maxBackfillDays: number;
  }) {
    let credential = this.requireCredential(input.credential);
    const config = this.parseConfig(input.connector.configJson, input.batchSize, input.maxBackfillDays);
    const cursor = this.parseCursor(input.connector.providerCursorJson);
    const resources = this.selectedResources(config);
    if (resources.length === 0) {
      return {
        queued: false,
        batches: [],
        cursorAfter: {
          ...cursor,
          lastSyncedAt: new Date().toISOString(),
          selectionRequired: true
        },
        updatedCredential: credential,
        summary: {
          provider: this.provider,
          providerMode: "read_only",
          writesEnabled: false,
          reason: "selected_cliq_channels_or_chats_required"
        },
        status: "partial" as const
      };
    }

    const threads = new Map<string, NormalizedThread>();
    const messages = new Map<string, NormalizedMessage>();
    let newestSeenAt = cursor.lastSeenAt;
    const cutoff = this.cutoffDate(input.syncType, cursor.lastSeenAt, config.maxBackfillDays);

    for (const resource of resources) {
      if (messages.size >= config.maxMessagesPerSync) break;
      let pageToken = cursor.cliq?.[resource.key]?.pageToken ?? null;
      do {
        const page = await this.client.listCliqMessages(
          credential,
          resource.id,
          Math.min(config.batchSize, config.maxMessagesPerSync - messages.size),
          { resourceType: resource.kind, pageToken }
        );
        credential = page.credential as ZohoCredential & { accessToken: string };
        const pageMessages = zohoArrayFromPayload(page.payload, ["data", "messages", "messageData"]);
        for (const item of pageMessages) {
          if (messages.size >= config.maxMessagesPerSync) break;
          const normalized = this.normalizeMessage(resource, item as Record<string, unknown>);
          if (!normalized) continue;
          const sentAt = zohoDate(normalized.message.sentAt);
          if (cutoff && sentAt && sentAt < cutoff) continue;
          threads.set(normalized.thread.providerThreadId, normalized.thread);
          messages.set(normalized.message.providerMessageId, normalized.message);
          if (sentAt && (!newestSeenAt || sentAt > new Date(newestSeenAt))) {
            newestSeenAt = sentAt.toISOString();
          }
        }
        pageToken = this.nextPageToken(page.payload);
      } while (pageToken && messages.size < config.maxMessagesPerSync);
    }

    const batches: NormalizedCommunicationBatch[] =
      messages.size > 0
        ? [
            {
              projectId: input.projectId,
              connectorId: input.connector.id,
              provider: this.provider,
              threads: [...threads.values()],
              messages: [...messages.values()]
            }
          ]
        : [];

    return {
      queued: false,
      batches,
      cursorAfter: {
        ...cursor,
        provider: this.provider,
        lastSeenAt: newestSeenAt ?? cursor.lastSeenAt ?? null,
        lastSyncedAt: new Date().toISOString(),
        cliq: Object.fromEntries(resources.map((resource) => [resource.key, { lastSyncedAt: new Date().toISOString() }]))
      },
      updatedCredential: credential,
      summary: {
        provider: this.provider,
        providerMode: "read_only",
        writesEnabled: false,
        resourceCount: resources.length,
        threadCount: threads.size,
        messageCount: messages.size,
        directChatsIncluded: config.includeDirectChats
      },
      status: "completed" as const
    };
  }

  private parseConfig(configJson: unknown, batchSize: number, maxBackfillDays: number) {
    const raw = (configJson ?? {}) as Record<string, unknown>;
    return {
      selectedChannelIds: zohoStringArray(raw.selectedChannelIds).map((id) => id.replace(/^channel:/, "")),
      selectedChannelNames: zohoStringArray(raw.selectedChannelNames),
      selectedChatIds: zohoStringArray(raw.selectedChatIds).map((id) => id.replace(/^chat:/, "")),
      includeDirectChats: raw.includeDirectChats === true,
      includeThreads: raw.includeThreads !== false,
      batchSize: Math.min(batchSize, this.env.ZOHO_CLIQ_SYNC_BATCH_SIZE),
      maxMessagesPerSync: Math.min(this.env.ZOHO_CLIQ_MAX_MESSAGES_PER_SYNC, Math.max(1, batchSize * 10)),
      maxBackfillDays: Math.min(maxBackfillDays, this.env.CONNECTOR_SYNC_MAX_BACKFILL_DAYS),
      defaultChannelScope: zohoString(raw.defaultChannelScope) ?? this.env.ZOHO_CLIQ_DEFAULT_CHANNEL_SCOPE
    };
  }

  private parseCursor(cursorJson: unknown) {
    const raw = (cursorJson ?? {}) as Record<string, any>;
    return {
      ...raw,
      lastSeenAt: zohoIso(raw.lastSeenAt),
      cliq: raw.cliq && typeof raw.cliq === "object" ? (raw.cliq as Record<string, { pageToken?: string | null }>) : {}
    };
  }

  private selectedResources(config: ReturnType<ZohoCliqProvider["parseConfig"]>) {
    const channelResources = config.selectedChannelIds.map((id) => ({
      kind: "channel" as const,
      id,
      key: `channel:${id}`,
      label: id
    }));
    const chatResources = config.includeDirectChats
      ? config.selectedChatIds.map((id) => ({
          kind: "chat" as const,
          id,
          key: `chat:${id}`,
          label: id
        }))
      : [];
    return [...channelResources, ...chatResources];
  }

  private normalizeMessage(resource: { kind: "channel" | "chat"; id: string; key: string; label: string }, record: Record<string, unknown>) {
    const id = zohoString(record.id ?? record.message_id ?? record.msg_id);
    if (!id) return null;
    const sentAt = zohoDate(record.time ?? record.created_time ?? record.createdAt ?? record.timestamp) ?? new Date();
    const threadId = zohoString(record.thread_id ?? record.parent_id) ?? resource.key;
    const text =
      zohoText(record.text ?? record.message ?? record.content ?? record.body, 20_000) ||
      zohoBound(`${resource.kind === "channel" ? "Channel" : "Chat"} message ${id}`, 500);
    const sender = (record.sender ?? record.user ?? record.created_by) as Record<string, unknown> | undefined;
    const senderLabel =
      zohoString(sender?.name ?? sender?.display_name ?? sender?.email ?? record.sender_name ?? record.user_name) ??
      "Zoho Cliq user";
    const participant = zohoParticipant({
      label: senderLabel,
      email: sender?.email ?? record.sender_email,
      id: sender?.id ?? record.sender_id,
      fallback: "Zoho Cliq user"
    });
    const thread: NormalizedThread = {
      providerThreadId: `cliq:${threadId}`,
      subject: zohoString(record.thread_title ?? record.title) ?? `${resource.kind === "channel" ? "Channel" : "Chat"} ${resource.label}`,
      participants: zohoUniqueParticipants([participant]),
      startedAt: sentAt,
      lastMessageAt: sentAt,
      threadUrl: zohoString(record.permalink ?? record.url),
      rawMetadata: {
        sourceSubType: resource.kind === "channel" ? "zoho_cliq_channel_thread" : "zoho_cliq_chat_thread",
        resourceType: resource.kind,
        resourceId: resource.id,
        providerThreadId: threadId
      }
    };
    const message: NormalizedMessage = {
      providerThreadId: thread.providerThreadId,
      providerMessageId: `cliq:${resource.kind}:${resource.id}:${id}`,
      senderLabel,
      senderExternalRef: zohoString(sender?.id ?? record.sender_id),
      senderEmail: zohoString(sender?.email ?? record.sender_email),
      sentAt,
      bodyText: text,
      messageType: record.system === true ? "system" : "user",
      providerPermalink: zohoString(record.permalink ?? record.url),
      replyToProviderMessageId: zohoString(record.reply_to ?? record.parent_id),
      rawMetadata: {
        sourceSubType: resource.kind === "channel" ? "zoho_cliq_channel_message" : "zoho_cliq_chat_message",
        resourceType: resource.kind,
        resourceId: resource.id,
        providerThreadId: threadId,
        messageId: id,
        safeFields: zohoSafeMetadata({
          edited: record.edited,
          reactions: record.reactions,
          thread_id: record.thread_id
        })
      }
    };
    return { thread, message };
  }

  private cutoffDate(syncType: CommunicationSyncType, lastSeenAt: string | null, maxBackfillDays: number) {
    if ((syncType === "manual" || syncType === "incremental") && lastSeenAt) {
      return new Date(lastSeenAt);
    }
    return new Date(Date.now() - maxBackfillDays * 24 * 60 * 60 * 1000);
  }

  private nextPageToken(payload: Record<string, unknown>) {
    return zohoString(payload.nextPageToken ?? (payload.info as Record<string, unknown> | undefined)?.next_page_token);
  }
}
