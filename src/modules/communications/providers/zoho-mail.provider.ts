import type { ProviderChannel } from "./provider.interface.js";
import type { CommunicationConnector, CommunicationSyncType } from "@prisma/client";
import type { AppEnv } from "../../../config/env.js";
import type {
  NormalizedAttachment,
  NormalizedCommunicationBatch,
  NormalizedMessage,
  NormalizedThread
} from "../../../lib/communications/provider-normalized-types.js";
import { ZohoProviderBase } from "./zoho/zoho-provider-base.js";
import type { ZohoCredential } from "./zoho/zoho-types.js";
import {
  zohoArrayFromPayload,
  zohoBool,
  zohoBound,
  zohoDate,
  zohoExtractEmail,
  zohoIso,
  zohoNumber,
  zohoParticipant,
  zohoSafeMetadata,
  zohoString,
  zohoStringArray,
  zohoText,
  zohoUniqueParticipants
} from "./zoho/zoho-normalization.js";

export class ZohoMailProvider extends ZohoProviderBase {
  readonly provider = "zoho_mail" as const;
  protected readonly service = "mail" as const;
  protected readonly defaultAccountLabel = "Zoho Mail";

  constructor(env: AppEnv, fetchImpl: typeof fetch = fetch) {
    super(env, fetchImpl);
  }

  protected providerConfigDefaults() {
    return {
      accountId: null,
      accountEmail: null,
      accountDisplayName: null,
      selectedFolderIds: [],
      selectedFolderNames: [],
      includeSpam: this.env.ZOHO_MAIL_INCLUDE_SPAM,
      includeTrash: this.env.ZOHO_MAIL_INCLUDE_TRASH,
      includeAttachments: this.env.ZOHO_MAIL_ATTACHMENT_INGESTION_ENABLED,
      includeBodyHtml: false,
      includeBodyText: true,
      maxBackfillDays: this.env.ZOHO_MAIL_SYNC_MAX_BACKFILL_DAYS,
      syncBatchSize: this.env.ZOHO_MAIL_SYNC_BATCH_SIZE,
      defaultFolderScope: this.env.ZOHO_MAIL_DEFAULT_FOLDER_SCOPE,
      writeActionsEnabled: false
    };
  }

  protected async resolveAccountLabel(credential: ZohoCredential) {
    const { payload } = await this.client.getMailAccounts(credential);
    const accounts = this.arrayFromPayload(payload, ["data", "accounts"]);
    const first = accounts[0] as Record<string, unknown> | undefined;
    const email = this.stringValue(first?.mailboxAddress ?? first?.emailAddress ?? first?.primaryEmailAddress);
    const accountId = this.stringValue(first?.accountId ?? first?.id);
    const displayName = this.stringValue(first?.displayName ?? first?.accountDisplayName ?? first?.name);
    return {
      label: email ? `Zoho Mail: ${email}` : "Zoho Mail",
      configPatch: {
        accountId,
        accountEmail: email,
        accountDisplayName: displayName
      }
    };
  }

  async testConnection(input: { credential: Record<string, unknown> | null }) {
    const credential = this.requireCredential(input.credential);
    const { payload } = await this.client.getMailAccounts(credential);
    return {
      ok: true,
      accountLabel: "Zoho Mail",
      details: { accountCount: this.arrayFromPayload(payload, ["data", "accounts"]).length }
    };
  }

  async listChannels(input: { credential: Record<string, unknown> | null }): Promise<ProviderChannel[]> {
    const credential = this.requireCredential(input.credential);
    const { payload } = await this.client.getMailAccounts(credential);
    const accounts = this.arrayFromPayload(payload, ["data", "accounts"]);
    const channels: ProviderChannel[] = [];
    for (const account of accounts) {
      const record = account as Record<string, unknown>;
      const accountId = this.stringValue(record.accountId ?? record.id);
      if (!accountId) continue;
      const accountLabel = this.stringValue(record.mailboxAddress ?? record.emailAddress ?? record.displayName) ?? accountId;
      channels.push({ id: `account:${accountId}`, name: accountLabel, isPrivate: true, isArchived: false });
      const folders = await this.client.getMailFolders(credential, accountId);
      for (const folder of this.arrayFromPayload(folders.payload, ["data", "folders"])) {
        const folderRecord = folder as Record<string, unknown>;
        const folderId = this.stringValue(folderRecord.folderId ?? folderRecord.id);
        if (!folderId) continue;
        const name = this.stringValue(folderRecord.folderName ?? folderRecord.name) ?? folderId;
        channels.push({ id: `account:${accountId}:folder:${folderId}`, name: `${accountLabel} / ${name}`, isPrivate: true, isArchived: false });
      }
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

    const accountResult = await this.resolveAccount(credential, config.accountId);
    credential = accountResult.credential;
    if (!accountResult.accountId) {
      return this.emptyResult(input, credential, cursor, "account_selection_required");
    }

    const folderResult = await this.resolveFolders(credential, accountResult.accountId, config);
    credential = folderResult.credential;
    if (folderResult.folders.length === 0) {
      return this.emptyResult(input, credential, cursor, "folder_selection_required");
    }

    const threads = new Map<string, NormalizedThread>();
    const messages = new Map<string, NormalizedMessage>();
    let newestSeenAt = cursor.lastSeenAt;
    let fetchedMessageCount = 0;
    const cutoff = this.cutoffDate(input.syncType, cursor.lastSeenAt, config.maxBackfillDays);

    for (const folder of folderResult.folders) {
      let start = 0;
      let pageToken = cursor.mail?.[folder.folderId]?.pageToken ?? null;
      while (fetchedMessageCount < config.maxMessagesPerSync) {
        const remaining = config.maxMessagesPerSync - fetchedMessageCount;
        const pageSize = Math.min(config.batchSize, remaining);
        const page = await this.client.listMailMessages(credential, accountResult.accountId, folder.folderId, pageSize, {
          start,
          pageToken
        });
        credential = page.credential as ZohoCredential & { accessToken: string };
        const pageMessages = zohoArrayFromPayload(page.payload, ["data", "messages", "messageData", "mailMessages"]);
        if (pageMessages.length === 0) break;

        for (const item of pageMessages) {
          if (fetchedMessageCount >= config.maxMessagesPerSync) break;
          const record = item as Record<string, unknown>;
          const sentAt = this.messageDate(record);
          if (cutoff && sentAt && sentAt < cutoff) continue;
          const detail = await this.fetchMessageDetail(credential, accountResult.accountId, folder.folderId, record);
          credential = detail.credential as ZohoCredential & { accessToken: string };
          const normalized = this.normalizeMessage(accountResult.accountId, folder, record, detail.payload, config);
          if (!normalized) continue;

          threads.set(normalized.thread.providerThreadId, normalized.thread);
          messages.set(normalized.message.providerMessageId, normalized.message);
          fetchedMessageCount += 1;
          const normalizedSentAt = zohoDate(normalized.message.sentAt);
          if (normalizedSentAt && (!newestSeenAt || normalizedSentAt > new Date(newestSeenAt))) {
            newestSeenAt = normalizedSentAt.toISOString();
          }
        }

        pageToken = this.nextPageToken(page.payload);
        if (!pageToken && pageMessages.length < pageSize) break;
        if (!pageToken) start += pageMessages.length;
      }
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
        accountId: accountResult.accountId,
        lastSeenAt: newestSeenAt ?? cursor.lastSeenAt ?? null,
        lastSyncedAt: new Date().toISOString(),
        mail: Object.fromEntries(folderResult.folders.map((folder) => [folder.folderId, { lastSyncedAt: new Date().toISOString() }]))
      },
      updatedCredential: credential,
      summary: {
        provider: this.provider,
        providerMode: "read_only",
        writesEnabled: false,
        accountId: accountResult.accountId,
        folderCount: folderResult.folders.length,
        threadCount: threads.size,
        messageCount: messages.size,
        attachmentMetadataOnly: config.includeAttachments
      },
      status: "completed" as const
    };
  }

  private parseConfig(configJson: unknown, batchSize: number, maxBackfillDays: number) {
    const raw = (configJson ?? {}) as Record<string, unknown>;
    return {
      accountId: zohoString(raw.accountId),
      selectedFolderIds: zohoStringArray(raw.selectedFolderIds),
      selectedFolderNames: zohoStringArray(raw.selectedFolderNames).map((item) => item.toLowerCase()),
      includeSpam: raw.includeSpam === true,
      includeTrash: raw.includeTrash === true,
      includeAttachments: raw.includeAttachments === true && this.env.ZOHO_MAIL_ATTACHMENT_INGESTION_ENABLED,
      includeBodyHtml: raw.includeBodyHtml === true,
      batchSize: Math.min(batchSize, this.env.ZOHO_MAIL_SYNC_BATCH_SIZE),
      maxBackfillDays: Math.min(
        typeof raw.maxBackfillDays === "number" ? raw.maxBackfillDays : this.env.ZOHO_MAIL_SYNC_MAX_BACKFILL_DAYS,
        maxBackfillDays,
        this.env.ZOHO_MAIL_SYNC_MAX_BACKFILL_DAYS
      ),
      maxMessagesPerSync: Math.min(this.env.ZOHO_MAIL_MAX_MESSAGES_PER_SYNC, Math.max(1, batchSize * 10)),
      defaultFolderScope: zohoString(raw.defaultFolderScope) ?? this.env.ZOHO_MAIL_DEFAULT_FOLDER_SCOPE
    };
  }

  private parseCursor(cursorJson: unknown) {
    const raw = (cursorJson ?? {}) as Record<string, any>;
    return {
      ...raw,
      lastSeenAt: zohoIso(raw.lastSeenAt),
      mail: raw.mail && typeof raw.mail === "object" ? (raw.mail as Record<string, { pageToken?: string | null }>) : {}
    };
  }

  private async resolveAccount(credential: ZohoCredential & { accessToken: string }, configuredAccountId: string | null) {
    const response = await this.client.getMailAccounts(credential);
    const accounts = zohoArrayFromPayload(response.payload, ["data", "accounts"]);
    const selected =
      accounts
        .map((account) => account as Record<string, unknown>)
        .find((account) => this.stringValue(account.accountId ?? account.id) === configuredAccountId) ??
      (accounts[0] as Record<string, unknown> | undefined);
    return {
      credential: response.credential as ZohoCredential & { accessToken: string },
      accountId: this.stringValue(selected?.accountId ?? selected?.id)
    };
  }

  private async resolveFolders(
    credential: ZohoCredential & { accessToken: string },
    accountId: string,
    config: ReturnType<ZohoMailProvider["parseConfig"]>
  ) {
    const response = await this.client.getMailFolders(credential, accountId);
    const selectedIds = new Set(config.selectedFolderIds);
    const folders = zohoArrayFromPayload(response.payload, ["data", "folders"])
      .map((folder) => folder as Record<string, unknown>)
      .map((folder) => ({
        folderId: this.stringValue(folder.folderId ?? folder.id) ?? "",
        name: this.stringValue(folder.folderName ?? folder.name) ?? "Mail folder",
        raw: folder
      }))
      .filter((folder) => {
        if (!folder.folderId) return false;
        const name = folder.name.toLowerCase();
        if (!config.includeSpam && /spam|junk/.test(name)) return false;
        if (!config.includeTrash && /trash|deleted/.test(name)) return false;
        if (selectedIds.size > 0) return selectedIds.has(folder.folderId);
        if (config.selectedFolderNames.length > 0) return config.selectedFolderNames.includes(name);
        return config.defaultFolderScope === "all" || /inbox/.test(name);
      });
    return { credential: response.credential as ZohoCredential & { accessToken: string }, folders };
  }

  private async fetchMessageDetail(
    credential: ZohoCredential & { accessToken: string },
    accountId: string,
    folderId: string,
    record: Record<string, unknown>
  ) {
    const messageId = this.messageId(record);
    if (!messageId) {
      return { credential, payload: record };
    }
    return this.client
      .getMailMessageContent(credential, accountId, folderId, messageId)
      .catch(() => ({ credential, payload: record as Record<string, any> }));
  }

  private normalizeMessage(
    accountId: string,
    folder: { folderId: string; name: string },
    record: Record<string, unknown>,
    detailPayload: Record<string, unknown>,
    config: ReturnType<ZohoMailProvider["parseConfig"]>
  ) {
    const messageId = this.messageId(record) ?? this.messageId(detailPayload);
    if (!messageId) return null;
    const providerThreadId = this.threadId(record, detailPayload, messageId);
    const sentAt = this.messageDate(record) ?? this.messageDate(detailPayload) ?? new Date();
    const subject = zohoString(record.subject ?? detailPayload.subject) ?? "Zoho Mail message";
    const bodyText =
      zohoText(detailPayload.content ?? detailPayload.body ?? detailPayload.textContent ?? record.summary ?? record.snippet, 25_000) ||
      zohoBound(subject, 500);
    const bodyHtml = config.includeBodyHtml ? zohoString(detailPayload.htmlContent ?? detailPayload.content) : null;
    const fromLabel = zohoString(record.fromAddress ?? record.sender ?? detailPayload.fromAddress ?? detailPayload.sender) ?? "Zoho Mail sender";
    const participants = zohoUniqueParticipants([
      zohoParticipant({ label: fromLabel, email: record.fromAddress ?? detailPayload.fromAddress, fallback: "Zoho Mail sender" }),
      ...zohoStringArray(record.toAddress ?? detailPayload.toAddress).map((value) => zohoParticipant({ label: value, email: value })),
      ...zohoStringArray(record.ccAddress ?? detailPayload.ccAddress).map((value) => zohoParticipant({ label: value, email: value }))
    ]);
    const thread: NormalizedThread = {
      providerThreadId,
      subject,
      participants,
      startedAt: sentAt,
      lastMessageAt: sentAt,
      threadUrl: zohoString(record.webLink ?? detailPayload.webLink ?? record.permalink),
      rawMetadata: {
        sourceSubType: "zoho_mail_thread",
        accountId,
        folderId: folder.folderId,
        folderName: folder.name,
        threadId: providerThreadId
      }
    };
    const attachments = config.includeAttachments ? this.attachments(record, detailPayload) : [];
    const message: NormalizedMessage = {
      providerThreadId,
      providerMessageId: `mail:${accountId}:${messageId}`,
      senderLabel: fromLabel,
      senderExternalRef: zohoString(record.fromAddress ?? detailPayload.fromAddress),
      senderEmail: zohoExtractEmail(record.fromAddress ?? detailPayload.fromAddress),
      sentAt,
      bodyText,
      bodyHtml,
      messageType: "user",
      providerPermalink: zohoString(record.webLink ?? detailPayload.webLink ?? record.permalink),
      replyToProviderMessageId: zohoString(record.inReplyTo ?? detailPayload.inReplyTo),
      rawMetadata: {
        sourceSubType: "zoho_mail_message",
        accountId,
        folderId: folder.folderId,
        folderName: folder.name,
        subject,
        zohoMessageId: messageId,
        flags: zohoSafeMetadata(record.flags ?? detailPayload.flags)
      },
      attachments
    };
    return { thread, message };
  }

  private attachments(record: Record<string, unknown>, detailPayload: Record<string, unknown>): NormalizedAttachment[] {
    const rawAttachments = [
      ...zohoArrayFromPayload(record, ["attachments", "attachmentInfo"]),
      ...zohoArrayFromPayload(detailPayload, ["attachments", "attachmentInfo"])
    ];
    return rawAttachments.slice(0, 20).map((attachment) => {
      const item = attachment as Record<string, unknown>;
      return {
        providerAttachmentId: zohoString(item.attachmentId ?? item.id ?? item.name),
        filename: zohoString(item.fileName ?? item.filename ?? item.name),
        mimeType: zohoString(item.mimeType ?? item.contentType),
        fileSize: zohoNumber(item.size ?? item.fileSize),
        providerUrl: null,
        rawMetadata: zohoSafeMetadata({
          attachmentId: item.attachmentId ?? item.id,
          inline: zohoBool(item.inline)
        })
      };
    });
  }

  private messageId(record: Record<string, unknown>) {
    return zohoString(record.messageId ?? record.id ?? record.mailId);
  }

  private threadId(record: Record<string, unknown>, detailPayload: Record<string, unknown>, fallbackMessageId: string) {
    return `mail:${zohoString(record.threadId ?? record.conversationId ?? detailPayload.threadId ?? detailPayload.conversationId) ?? fallbackMessageId}`;
  }

  private messageDate(record: Record<string, unknown>) {
    return zohoDate(record.sentDateInGMT ?? record.receivedTime ?? record.sentTime ?? record.date ?? record.createdTime);
  }

  private nextPageToken(payload: Record<string, unknown>) {
    return zohoString(payload.nextPageToken ?? (payload.info as Record<string, unknown> | undefined)?.next_page_token);
  }

  private cutoffDate(syncType: CommunicationSyncType, lastSeenAt: string | null, maxBackfillDays: number) {
    if ((syncType === "manual" || syncType === "incremental") && lastSeenAt) {
      return new Date(lastSeenAt);
    }
    return new Date(Date.now() - maxBackfillDays * 24 * 60 * 60 * 1000);
  }

  private emptyResult(
    input: { connector: CommunicationConnector; projectId: string },
    credential: ZohoCredential,
    cursor: Record<string, unknown>,
    reason: string
  ) {
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
        reason,
        connectorId: input.connector.id,
        projectId: input.projectId
      },
      status: "partial" as const
    };
  }
}
