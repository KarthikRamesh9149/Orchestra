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
  ProviderResourceCandidate,
  ProviderSyncResult,
  ProviderWebhookVerificationResult
} from "./provider.interface.js";

type FetchLike = typeof fetch;
type MicrosoftGraphPage = {
  value?: Record<string, any>[];
  "@odata.nextLink"?: string;
};

type SelectedTeamChannels = {
  teamId: string;
  channelIds: string[];
  label?: string | null;
  channelLabels: Record<string, string | null>;
};

type TeamsProviderConfig = {
  tenantId: string | null;
  teams: SelectedTeamChannels[];
  chatIds: string[];
  chatLabels: Record<string, string | null>;
  backfillDays: number;
  includeBotMessages: boolean;
  includeChats: boolean;
};

const TEAMS_SCOPES = [
  "openid",
  "profile",
  "offline_access",
  "User.Read",
  "Team.ReadBasic.All",
  "Channel.ReadBasic.All",
  "ChannelMessage.Read.All",
  "Chat.Read"
];

export class TeamsProvider implements CommunicationProviderAdapter {
  readonly provider = "microsoft_teams" as const;

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
      redirectUrl: buildMicrosoftOAuthUrl(this.env, input.oauthState, this.scopes()),
      accountLabel: "Microsoft Teams",
      config: {
        selectedMicrosoftTenantId: null,
        selectedMicrosoftTeamIds: [],
        selectedMicrosoftChannelIds: [],
        selectedMicrosoftChatIds: [],
        selectedMicrosoftResourceConsentMode: "delegated",
        selectedMicrosoftResourceLabels: [],
        selectedMicrosoftChannelLabels: [],
        selectedMicrosoftChatLabels: [],
        includeMicrosoftChats: false,
        teams: [],
        backfillDays: Math.min(30, this.env.CONNECTOR_SYNC_MAX_BACKFILL_DAYS),
        includeBotMessages: false
      }
    };
  }

  async handleOAuthCallback(input: { code: string }): Promise<ProviderCallbackResult> {
    const credential = await exchangeMicrosoftCode(this.env, this.fetchImpl, input.code, this.scopes());
    const profile = await callMicrosoftGraph<{ displayName?: string; userPrincipalName?: string; id?: string }>(
      this.fetchImpl,
      credential,
      "/me?$select=id,displayName,userPrincipalName",
      undefined,
      this.env.MICROSOFT_GRAPH_BASE_URL
    );

    return {
      accountLabel: profile.userPrincipalName ?? profile.displayName ?? "Microsoft Teams",
      credential: {
        ...credential,
        accountLabel: profile.userPrincipalName ?? profile.displayName ?? "Microsoft Teams",
        userId: profile.id
      },
      providerCursor: {
        channels: {},
        chats: {}
      },
      configPatch: {
        accountOwner: profile.userPrincipalName ?? null,
        selectedMicrosoftTenantId: null,
        selectedMicrosoftTeamIds: [],
        selectedMicrosoftChannelIds: [],
        selectedMicrosoftChatIds: [],
        selectedMicrosoftResourceConsentMode: "delegated",
        selectedMicrosoftResourceLabels: [],
        selectedMicrosoftChannelLabels: [],
        selectedMicrosoftChatLabels: [],
        includeBotMessages: false,
        includeMicrosoftChats: false
      }
    };
  }

  async listResources(input: {
    connector: CommunicationConnector;
    credential: Record<string, unknown> | null;
    query?: { search?: string; limit?: number; cursor?: string };
  }): Promise<{ resources: ProviderResourceCandidate[]; nextCursor?: string | null }> {
    const credential = this.requireCredential(input.credential);
    const config = this.parseConfig(input.connector.configJson);
    const limit = Math.min(Math.max(Number(input.query?.limit ?? 75), 1), 100);
    const search = input.query?.search?.trim().toLowerCase() ?? "";
    const selectedTeamIds = new Set(config.teams.map((team) => team.teamId));
    const selectedChannelKeys = new Set(
      config.teams.flatMap((team) => team.channelIds.map((channelId) => this.channelConfigKey(team.teamId, channelId)))
    );
    const selectedChatIds = new Set(config.chatIds);
    const resources: ProviderResourceCandidate[] = [];

    const joinedTeams = await this.listPagedGraphItems(
      credential,
      "/me/joinedTeams?$select=id,displayName,description&$top=50",
      3
    );

    for (const team of joinedTeams.slice(0, 50)) {
      const teamId = this.safeString(team.id);
      if (!teamId) continue;
      const teamTitle = this.safeString(team.displayName) ?? teamId;
      resources.push({
        id: teamId,
        type: "team",
        title: teamTitle,
        description: this.safeString(team.description),
        selected: selectedTeamIds.has(teamId),
        tenantId: config.tenantId,
        teamId,
        resourceSubType: "team"
      });

      const channels = await this.listPagedGraphItems(
        credential,
        `/teams/${encodeURIComponent(teamId)}/channels?$select=id,displayName,description,membershipType,webUrl&$top=50`,
        3
      );
      for (const channel of channels.slice(0, 100)) {
        const channelId = this.safeString(channel.id);
        if (!channelId) continue;
        const channelTitle = this.safeString(channel.displayName) ?? channelId;
        resources.push({
          id: this.channelConfigKey(teamId, channelId),
          type: "channel",
          title: channelTitle,
          url: this.safeString(channel.webUrl),
          parentLabel: teamTitle,
          selected: selectedChannelKeys.has(this.channelConfigKey(teamId, channelId)),
          tenantId: config.tenantId,
          teamId,
          channelId,
          resourceSubType: this.safeString(channel.membershipType) ?? "standard",
          description: this.safeString(channel.description)
        });
      }
    }

    const chats = await this.listPagedGraphItems(
      credential,
      "/me/chats?$select=id,topic,chatType,lastUpdatedDateTime,webUrl&$top=50",
      2
    );
    for (const chat of chats.slice(0, 50)) {
      const chatId = this.safeString(chat.id);
      if (!chatId) continue;
      resources.push({
        id: chatId,
        type: "chat",
        title: this.safeString(chat.topic) ?? this.safeString(chat.chatType) ?? "Teams chat",
        url: this.safeString(chat.webUrl),
        selected: selectedChatIds.has(chatId),
        tenantId: config.tenantId,
        chatId,
        resourceSubType: this.safeString(chat.chatType) ?? "chat",
        lastUpdatedAt: this.safeString(chat.lastUpdatedDateTime)
      });
    }

    const filtered = search
      ? resources.filter((resource) =>
          [resource.title, resource.parentLabel, resource.description, resource.resourceSubType]
            .filter((value): value is string => typeof value === "string" && value.length > 0)
            .some((value) => value.toLowerCase().includes(search))
        )
      : resources;

    return { resources: filtered.slice(0, limit), nextCursor: filtered.length > limit ? "truncated" : null };
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
        ...(await refreshMicrosoftAccessToken(this.env, this.fetchImpl, credential, this.scopes()))
      };
    }

    const config = this.parseConfig(input.connector.configJson);
    const hasSelectedResources = config.teams.some((team) => team.channelIds.length > 0) || config.chatIds.length > 0;
    if (!hasSelectedResources) {
      return {
        queued: false,
        status: "completed",
        batches: [],
        summary: {
          provider: "microsoft_teams",
          selectedResourceMode: "selected_teams_channels_chats_only",
          teamCount: 0,
          channelCount: 0,
          chatCount: 0,
          messageCount: 0,
          threadCount: 0
        }
      };
    }

    const cursor = this.parseCursor(input.connector.providerCursorJson);
    const threadMap = new Map<string, NormalizedThread>();
    const messageMap = new Map<string, NormalizedMessage>();
    const deletedProviderMessageIds = new Set<string>();
    const channelCursor = { ...cursor.channels };
    const chatCursor = { ...cursor.chats };
    const maxMessagesPerResource = this.maxMessagesPerResource(input.batchSize, config);

    for (const teamEntry of config.teams) {
      for (const channelId of teamEntry.channelIds) {
        const channelKey = this.channelConfigKey(teamEntry.teamId, channelId);
        const path = `/teams/${encodeURIComponent(teamEntry.teamId)}/channels/${encodeURIComponent(channelId)}/messages?$top=${this.pageSize(input.batchSize)}`;
        const rootMessages = await this.listPagedGraphItems(credential, path, 10, maxMessagesPerResource);

        for (const rootMessage of rootMessages) {
          const rootMessageId = this.safeString(rootMessage.id);
          if (!rootMessageId) continue;
          const rootProviderMessageId = this.channelProviderMessageId(teamEntry.teamId, channelId, rootMessageId);
          if (rootMessage.deletedDateTime) {
            deletedProviderMessageIds.add(rootProviderMessageId);
            continue;
          }
          if (!this.shouldIncludeMessage(rootMessage, config.includeBotMessages)) {
            continue;
          }
          const normalizedRoot = this.normalizeTeamsChannelMessage(teamEntry, channelId, rootMessage, null, config);
          if (this.shouldIncludeChannelByCursor(channelCursor, channelKey, normalizedRoot, input.syncType)) {
            threadMap.set(normalizedRoot.thread.providerThreadId, normalizedRoot.thread);
            messageMap.set(normalizedRoot.message.providerMessageId, normalizedRoot.message);
            this.advanceCursor(channelCursor, channelKey, this.toIsoString(normalizedRoot.message.sentAt));
          }

          const replyPath = `/teams/${encodeURIComponent(teamEntry.teamId)}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(rootMessageId)}/replies?$top=${this.pageSize(input.batchSize)}`;
          for (const reply of await this.listPagedGraphItems(credential, replyPath, 10, maxMessagesPerResource)) {
            const replyId = this.safeString(reply.id);
            if (!replyId) continue;
            const replyProviderMessageId = this.channelProviderMessageId(teamEntry.teamId, channelId, replyId);
            if (reply.deletedDateTime) {
              deletedProviderMessageIds.add(replyProviderMessageId);
              continue;
            }
            if (!this.shouldIncludeMessage(reply, config.includeBotMessages)) {
              continue;
            }
            const normalizedReply = this.normalizeTeamsChannelMessage(teamEntry, channelId, reply, rootMessageId, config);
            if (this.shouldIncludeChannelByCursor(channelCursor, channelKey, normalizedReply, input.syncType)) {
              threadMap.set(normalizedReply.thread.providerThreadId, normalizedReply.thread);
              messageMap.set(normalizedReply.message.providerMessageId, normalizedReply.message);
              this.advanceCursor(channelCursor, channelKey, this.toIsoString(normalizedReply.message.sentAt));
            }
          }
        }
      }
    }

    if (config.includeChats) {
      for (const chatId of config.chatIds) {
        const path = `/chats/${encodeURIComponent(chatId)}/messages?$top=${this.pageSize(input.batchSize)}`;
        const messages = await this.listPagedGraphItems(credential, path, 10, maxMessagesPerResource);
        for (const source of messages) {
          const messageId = this.safeString(source.id);
          if (!messageId) continue;
          const providerMessageId = this.chatProviderMessageId(chatId, messageId);
          if (source.deletedDateTime) {
            deletedProviderMessageIds.add(providerMessageId);
            continue;
          }
          if (!this.shouldIncludeMessage(source, config.includeBotMessages)) {
            continue;
          }
          const normalized = this.normalizeTeamsChatMessage(chatId, source, config);
          if (this.shouldIncludeChatByCursor(chatCursor, chatId, normalized, input.syncType)) {
            threadMap.set(normalized.thread.providerThreadId, normalized.thread);
            messageMap.set(normalized.message.providerMessageId, normalized.message);
            this.advanceCursor(chatCursor, chatId, this.toIsoString(normalized.message.sentAt));
          }
        }
      }
    }

    const batch: NormalizedCommunicationBatch | null =
      messageMap.size === 0
        ? null
        : {
            projectId: input.projectId,
            connectorId: input.connector.id,
            provider: "microsoft_teams",
            threads: [...threadMap.values()],
            messages: [...messageMap.values()]
          };

    return {
      queued: false,
      status: "completed",
      batches: batch ? [batch] : [],
      deletedProviderMessageIds: [...deletedProviderMessageIds],
      cursorAfter: { channels: channelCursor, chats: chatCursor },
      updatedCredential: credential,
      summary: {
        provider: "microsoft_teams",
        selectedResourceMode: "selected_teams_channels_chats_only",
        teamCount: config.teams.length,
        channelCount: config.teams.reduce((count, team) => count + team.channelIds.length, 0),
        chatCount: config.includeChats ? config.chatIds.length : 0,
        threadCount: threadMap.size,
        messageCount: messageMap.size,
        deletedMessageCount: deletedProviderMessageIds.size
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
      throw new AppError(422, "Microsoft Teams webhook notification payload is empty", "microsoft_teams_webhook_empty");
    }
    const connectorIds = notifications.map((item) => {
      if (typeof item.clientState !== "string" || item.clientState.trim().length === 0) {
        throw new AppError(401, "Microsoft Teams webhook clientState is required", "microsoft_webhook_client_state_invalid");
      }
      return verifyMicrosoftWebhookClientState(
        item.clientState,
        this.env.CONNECTOR_OAUTH_STATE_SECRET,
        true
      );
    });

    return {
      providerEventId:
        notifications[0]?.subscriptionId && notifications[0]?.resourceData?.id
          ? `${notifications[0].subscriptionId}:${notifications[0].resourceData.id}`
          : `teams:${Date.now()}`,
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
      throw new AppError(409, "Microsoft Teams connector credential is missing", "teams_credential_missing");
    }
    return credential as MicrosoftCredential;
  }

  private async listPagedGraphItems(
    credential: MicrosoftCredential,
    firstPath: string,
    maxPages = 10,
    maxItems = 500
  ) {
    const items: Record<string, any>[] = [];
    let nextPath: string | undefined = firstPath;
    let pageCount = 0;

    while (nextPath && pageCount < maxPages && items.length < maxItems) {
      const page: MicrosoftGraphPage = await callMicrosoftGraph<MicrosoftGraphPage>(
        this.fetchImpl,
        credential,
        nextPath,
        undefined,
        this.env.MICROSOFT_GRAPH_BASE_URL
      );
      items.push(...(page.value ?? []).slice(0, Math.max(0, maxItems - items.length)));
      nextPath = typeof page["@odata.nextLink"] === "string" ? page["@odata.nextLink"] : undefined;
      pageCount += 1;
    }

    return items;
  }

  private pageSize(batchSize: number) {
    return Math.min(Math.max(1, batchSize), 50);
  }

  private scopes() {
    return Array.isArray(this.env.MICROSOFT_GRAPH_SCOPES) && this.env.MICROSOFT_GRAPH_SCOPES.length > 0
      ? this.env.MICROSOFT_GRAPH_SCOPES
      : TEAMS_SCOPES;
  }

  private parseConfig(configJson: unknown): TeamsProviderConfig {
    const config = (configJson ?? {}) as Record<string, unknown>;
    const tenantId = this.safeString(config.selectedMicrosoftTenantId);
    const labels = this.parseLabels(config.selectedMicrosoftResourceLabels);
    const channelLabels = this.parseLabels(config.selectedMicrosoftChannelLabels);
    const chatLabels = this.parseLabels(config.selectedMicrosoftChatLabels);
    const legacyTeams = this.parseLegacyTeams(config.teams, labels, channelLabels);
    const selectedTeamIds = this.stringArray(config.selectedMicrosoftTeamIds);
    const selectedChannelIds = this.stringArray(config.selectedMicrosoftChannelIds);
    const selectedChatIds = this.stringArray(config.selectedMicrosoftChatIds);
    const includeChats = config.includeMicrosoftChats === true || config.includeChats === true;
    const teams = legacyTeams.length > 0 ? legacyTeams : this.parseSelectedTeams(selectedTeamIds, selectedChannelIds, labels, channelLabels);

    return {
      tenantId,
      teams,
      chatIds: includeChats ? selectedChatIds : [],
      chatLabels,
      backfillDays:
        typeof config.backfillDays === "number" && Number.isFinite(config.backfillDays) ? Math.max(1, config.backfillDays) : 30,
      includeBotMessages: config.includeBotMessages === true,
      includeChats
    };
  }

  private parseLegacyTeams(
    teamsConfig: unknown,
    labels: Record<string, string | null>,
    channelLabels: Record<string, string | null>
  ): SelectedTeamChannels[] {
    if (!Array.isArray(teamsConfig)) {
      return [];
    }
    const parsed: SelectedTeamChannels[] = [];
    for (const entry of teamsConfig) {
      const team = entry as Record<string, unknown>;
      const teamId = this.safeString(team.teamId);
      const channelIds = this.stringArray(team.channelIds);
      if (!teamId || channelIds.length === 0) continue;
      parsed.push({
          teamId,
          channelIds: [...new Set(channelIds)],
          label: labels[teamId] ?? null,
          channelLabels
      });
    }
    return parsed;
  }

  private parseSelectedTeams(
    selectedTeamIds: string[],
    selectedChannelIds: string[],
    labels: Record<string, string | null>,
    channelLabels: Record<string, string | null>
  ) {
    const byTeam = new Map<string, Set<string>>();
    for (const value of selectedChannelIds) {
      const parsed = this.parseChannelConfigKey(value);
      if (parsed) {
        if (!byTeam.has(parsed.teamId)) byTeam.set(parsed.teamId, new Set());
        byTeam.get(parsed.teamId)!.add(parsed.channelId);
      }
    }

    if (byTeam.size === 0 && selectedTeamIds.length === 1 && selectedChannelIds.length > 0) {
      byTeam.set(selectedTeamIds[0], new Set(selectedChannelIds));
    }

    return [...byTeam.entries()]
      .filter(([teamId]) => selectedTeamIds.length === 0 || selectedTeamIds.includes(teamId))
      .map(([teamId, channelIds]) => ({
        teamId,
        channelIds: [...channelIds],
        label: labels[teamId] ?? null,
        channelLabels
      }));
  }

  private parseCursor(cursorJson: unknown) {
    const cursor = (cursorJson ?? {}) as Record<string, any>;
    return {
      channels: (cursor.channels ?? {}) as Record<string, { latestCreatedDateTime?: string }>,
      chats: (cursor.chats ?? {}) as Record<string, { latestCreatedDateTime?: string }>
    };
  }

  private shouldIncludeMessage(message: Record<string, any>, includeBotMessages: boolean) {
    const messageType = typeof message.messageType === "string" ? message.messageType : "message";
    if (!includeBotMessages && message.from?.application) {
      return false;
    }
    if (message.deletedDateTime) {
      return false;
    }
    const bodyHtml = typeof message.body?.content === "string" ? message.body.content : "";
    const bodyText = bodyHtml ? htmlToText(bodyHtml).trim() : "";
    const hasAttachments = Array.isArray(message.attachments) && message.attachments.length > 0;
    return messageType === "message" && (bodyText.length > 0 || hasAttachments);
  }

  private normalizeTeamsChannelMessage(
    team: SelectedTeamChannels,
    channelId: string,
    source: Record<string, any>,
    rootMessageId: string | null,
    config: TeamsProviderConfig
  ) {
    const sourceId = String(source.id);
    const actualRootId = rootMessageId ?? String(source.replyToId ?? source.id);
    const providerThreadId = `microsoft_teams:${config.tenantId ?? "unknown"}:channel:${team.teamId}:${channelId}:${actualRootId}`;
    const channelKey = this.channelConfigKey(team.teamId, channelId);
    const channelLabel = team.channelLabels[channelKey] ?? team.channelLabels[channelId] ?? channelId;
    const teamLabel = team.label ?? team.teamId;
    const base = this.normalizeMessageBase(source);
    const participants = this.normalizeParticipants(source);

    const thread: NormalizedThread = {
      providerThreadId,
      subject: `Microsoft Teams · ${teamLabel} / ${channelLabel}`,
      participants,
      startedAt: base.sentAt,
      lastMessageAt: base.sentAt,
      threadUrl: base.providerPermalink,
      rawMetadata: {
        provider: "microsoft_teams",
        sourceSubType: "teams_channel",
        tenantId: config.tenantId,
        teamId: team.teamId,
        channelId,
        teamLabel,
        channelLabel,
        rootMessageId: actualRootId
      }
    };

    const message: NormalizedMessage = {
      providerThreadId,
      providerMessageId: this.channelProviderMessageId(team.teamId, channelId, sourceId),
      senderLabel: base.senderLabel,
      senderExternalRef: base.senderExternalRef,
      senderEmail: null,
      sentAt: base.sentAt,
      bodyText: base.bodyText,
      bodyHtml: base.bodyHtml,
      messageType: base.messageType,
      providerPermalink: base.providerPermalink,
      replyToProviderMessageId: rootMessageId ? this.channelProviderMessageId(team.teamId, channelId, rootMessageId) : null,
      attachments: this.normalizeAttachments(source),
      rawMetadata: {
        providerThreadId,
        provider: "microsoft_teams",
        sourceSubType: rootMessageId ? "teams_channel_reply" : "teams_channel_message",
        tenantId: config.tenantId,
        teamId: team.teamId,
        channelId,
        teamLabel,
        channelLabel,
        etag: source.etag ?? null,
        lastModifiedDateTime: source.lastModifiedDateTime ?? null,
        mentions: this.normalizeMentions(source)
      }
    };

    return { thread, message };
  }

  private normalizeTeamsChatMessage(chatId: string, source: Record<string, any>, config: TeamsProviderConfig) {
    const sourceId = String(source.id);
    const chatLabel = config.chatLabels[chatId] ?? "Teams chat";
    const providerThreadId = `microsoft_teams:${config.tenantId ?? "unknown"}:chat:${chatId}`;
    const base = this.normalizeMessageBase(source);
    const participants = this.normalizeParticipants(source);

    const thread: NormalizedThread = {
      providerThreadId,
      subject: `Microsoft Teams · ${chatLabel}`,
      participants,
      startedAt: base.sentAt,
      lastMessageAt: base.sentAt,
      threadUrl: base.providerPermalink,
      rawMetadata: {
        provider: "microsoft_teams",
        sourceSubType: "teams_chat",
        tenantId: config.tenantId,
        chatId,
        chatLabel
      }
    };

    const message: NormalizedMessage = {
      providerThreadId,
      providerMessageId: this.chatProviderMessageId(chatId, sourceId),
      senderLabel: base.senderLabel,
      senderExternalRef: base.senderExternalRef,
      senderEmail: null,
      sentAt: base.sentAt,
      bodyText: base.bodyText,
      bodyHtml: base.bodyHtml,
      messageType: base.messageType,
      providerPermalink: base.providerPermalink,
      replyToProviderMessageId: null,
      attachments: this.normalizeAttachments(source),
      rawMetadata: {
        providerThreadId,
        provider: "microsoft_teams",
        sourceSubType: "teams_chat_message",
        tenantId: config.tenantId,
        chatId,
        chatLabel,
        etag: source.etag ?? null,
        lastModifiedDateTime: source.lastModifiedDateTime ?? null,
        mentions: this.normalizeMentions(source)
      }
    };

    return { thread, message };
  }

  private normalizeMessageBase(source: Record<string, any>) {
    const sender = source.from?.user ?? source.from?.application ?? {};
    const senderExternalRef = this.safeString(sender.id);
    const senderLabel = this.safeString(sender.displayName) ?? senderExternalRef ?? "Teams user";
    const sentAt = this.safeString(source.createdDateTime) ?? new Date().toISOString();
    const bodyHtml = this.safeString(source.body?.content);
    const bodyText = bodyHtml ? htmlToText(bodyHtml) : "[Teams attachment]";

    return {
      senderExternalRef,
      senderLabel,
      sentAt,
      bodyHtml,
      bodyText,
      messageType: senderExternalRef && !source.from?.application ? ("user" as const) : ("bot" as const),
      providerPermalink: this.safeString(source.webUrl)
    };
  }

  private normalizeParticipants(source: Record<string, any>): NormalizedParticipant[] {
    const sender = source.from?.user ?? source.from?.application ?? null;
    if (!sender) {
      return [];
    }
    return [
      {
        label: this.safeString(sender.displayName) ?? this.safeString(sender.id) ?? "Teams user",
        externalRef: this.safeString(sender.id),
        email: null
      }
    ];
  }

  private normalizeAttachments(source: Record<string, any>): NormalizedAttachment[] {
    if (!Array.isArray(source.attachments)) {
      return [];
    }
    return source.attachments.slice(0, 20).map((attachment) => ({
      providerAttachmentId: this.safeString(attachment.id),
      filename: this.safeString(attachment.name),
      mimeType: this.safeString(attachment.contentType),
      fileSize: typeof attachment.size === "number" && Number.isFinite(attachment.size) ? attachment.size : null,
      providerUrl: this.safeUrl(attachment.contentUrl ?? attachment.webUrl),
      rawMetadata: {
        contentType: this.safeString(attachment.contentType),
        teamsAttachmentKind: this.safeString(attachment.teamsAppId) ? "teams_app" : "reference"
      }
    }));
  }

  private normalizeMentions(source: Record<string, any>) {
    if (!Array.isArray(source.mentions)) {
      return [];
    }
    return source.mentions.slice(0, 20).map((mention) => ({
      id: this.safeString(mention.id),
      mentionText: this.safeString(mention.mentionText),
      userId: this.safeString(mention.mentioned?.user?.id),
      displayName: this.safeString(mention.mentioned?.user?.displayName)
    }));
  }

  private shouldIncludeChannelByCursor(
    channelCursor: Record<string, { latestCreatedDateTime?: string }>,
    channelKey: string,
    normalized: { thread: NormalizedThread; message: NormalizedMessage },
    syncType: "manual" | "webhook" | "backfill" | "incremental"
  ) {
    return this.shouldIncludeByCursor(channelCursor, channelKey, normalized.message.sentAt, syncType);
  }

  private shouldIncludeChatByCursor(
    chatCursor: Record<string, { latestCreatedDateTime?: string }>,
    chatId: string,
    normalized: { thread: NormalizedThread; message: NormalizedMessage },
    syncType: "manual" | "webhook" | "backfill" | "incremental"
  ) {
    return this.shouldIncludeByCursor(chatCursor, chatId, normalized.message.sentAt, syncType);
  }

  private shouldIncludeByCursor(
    cursor: Record<string, { latestCreatedDateTime?: string }>,
    key: string,
    sentAt: string | Date,
    syncType: "manual" | "webhook" | "backfill" | "incremental"
  ) {
    if (syncType === "backfill") {
      return true;
    }
    const latest = cursor[key]?.latestCreatedDateTime;
    return !latest || Date.parse(this.toIsoString(sentAt)) > Date.parse(latest);
  }

  private advanceCursor(cursor: Record<string, { latestCreatedDateTime?: string }>, key: string, sentAt: string) {
    const current = cursor[key]?.latestCreatedDateTime;
    if (!current || Date.parse(sentAt) > Date.parse(current)) {
      cursor[key] = { latestCreatedDateTime: sentAt };
    }
  }

  private maxMessagesPerResource(batchSize: number, config: TeamsProviderConfig) {
    const configured = (config as any).maxMessagesPerResource;
    if (typeof configured === "number" && Number.isFinite(configured)) {
      return Math.min(Math.max(1, configured), 1000);
    }
    return Math.min(Math.max(this.pageSize(batchSize) * 10, 50), 500);
  }

  private parseLabels(value: unknown) {
    const labels: Record<string, string | null> = {};
    if (!Array.isArray(value)) {
      return labels;
    }
    for (const item of value) {
      const entry = item as Record<string, unknown>;
      const id = this.safeString(entry.id);
      const label = this.safeString(entry.label ?? entry.title ?? entry.name);
      if (id) labels[id] = label;
      const teamId = this.safeString(entry.teamId);
      const channelId = this.safeString(entry.channelId);
      if (teamId && channelId) labels[this.channelConfigKey(teamId, channelId)] = label;
      const chatId = this.safeString(entry.chatId);
      if (chatId) labels[chatId] = label;
    }
    return labels;
  }

  private stringArray(value: unknown) {
    return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))] : [];
  }

  private parseChannelConfigKey(value: string) {
    const match = value.match(/^team:([^:]+):channel:(.+)$/);
    if (match) {
      return { teamId: match[1], channelId: match[2] };
    }
    const legacy = value.match(/^([^:]+):(.+)$/);
    if (legacy) {
      return { teamId: legacy[1], channelId: legacy[2] };
    }
    return null;
  }

  private channelConfigKey(teamId: string, channelId: string) {
    return `team:${teamId}:channel:${channelId}`;
  }

  private channelProviderMessageId(teamId: string, channelId: string, messageId: string) {
    return `microsoft_teams:channel:${teamId}:${channelId}:${messageId}`;
  }

  private chatProviderMessageId(chatId: string, messageId: string) {
    return `microsoft_teams:chat:${chatId}:${messageId}`;
  }

  private safeString(value: unknown) {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private safeUrl(value: unknown) {
    const candidate = this.safeString(value);
    if (!candidate) return null;
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === "https:" ? candidate : null;
    } catch {
      return null;
    }
  }

  private toIsoString(value: string | Date) {
    return value instanceof Date ? value.toISOString() : value;
  }
}
