import type { CommunicationConnector, CommunicationSyncType } from "@prisma/client";
import type { AppEnv } from "../../../config/env.js";
import { AppError } from "../../../app/errors.js";
import type {
  NormalizedCommunicationBatch,
  NormalizedMessage,
  NormalizedParticipant,
  NormalizedThread
} from "../../../lib/communications/provider-normalized-types.js";
import { parseRetryAfterMs } from "../../../lib/communications/provider-http.js";
import type {
  CommunicationProviderAdapter,
  ProviderChannel,
  ProviderConnectResult,
  ProviderSyncResult,
  ProviderWebhookRegistrationResult,
  ProviderWebhookVerificationResult
} from "./provider.interface.js";

type GranolaConnectBody = {
  apiKey?: unknown;
  managedSecretRef?: unknown;
  keyType?: unknown;
  config?: unknown;
};

type GranolaCredential = {
  mode?: string;
  apiKey?: string;
  managedSecretRef?: string;
  keyType?: string;
};

type GranolaListNotesQuery = {
  created_before?: string;
  created_after?: string;
  updated_after?: string;
  cursor?: string;
  page_size?: number;
};

type GranolaFolder = {
  id?: unknown;
  name?: unknown;
  parent_folder_id?: unknown;
};

type GranolaNoteSummary = {
  id?: unknown;
  title?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

type GranolaNoteDetail = GranolaNoteSummary & {
  web_url?: unknown;
  owner?: unknown;
  calendar_event?: unknown;
  attendees?: unknown;
  folder_membership?: unknown;
  summary?: unknown;
  summary_text?: unknown;
  summary_markdown?: unknown;
  transcript?: unknown;
};

type GranolaTranscriptSegment = {
  speaker?: unknown;
  text?: unknown;
  start_time?: unknown;
  end_time?: unknown;
};

const GRANOLA_SAFE_CONFIG_KEYS = new Set([
  "keyType",
  "workspaceScope",
  "selectedFolderIds",
  "selectedFolderNames",
  "includeChildFolders",
  "syncSince",
  "lastGranolaCursor",
  "lastGranolaUpdatedAfter",
  "includeTranscript",
  "includeSummary",
  "includeCalendarEvent",
  "includeAttendees",
  "maxBackfillDays",
  "syncBatchSize"
]);

const GRANOLA_SECRET_KEY_PATTERN = /api[_-]?key|token|authorization|bearer|secret|credential|password|private[_-]?key/i;
const GRANOLA_MAX_PAGE_SIZE = 30;
const GRANOLA_DEFAULT_TIMEOUT_MS = 15_000;
const GRANOLA_MAX_RETRIES = 2;

export class GranolaProvider implements CommunicationProviderAdapter {
  readonly provider = "granola" as const;

  constructor(
    private readonly env: AppEnv,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  ) {}

  async connect(input: { projectId: string; actorUserId: string; body?: unknown }): Promise<ProviderConnectResult> {
    const parsed = this.parseConnectBody(input.body);
    const config = this.buildSafeConfig(parsed);

    if (parsed.apiKey) {
      if (this.env.CONNECTOR_CREDENTIAL_VAULT_MODE === "managed_reference") {
        throw new AppError(
          422,
          "Granola raw API keys cannot be accepted when the credential vault is in managed-reference mode",
          "granola_managed_secret_ref_required"
        );
      }

      return {
        mode: "connected",
        status: "connected",
        accountLabel: `Granola ${config.keyType === "enterprise" ? "Enterprise" : "Personal"}`,
        config,
        credential: {
          mode: "api_key",
          apiKey: parsed.apiKey,
          keyType: config.keyType,
          createdAt: new Date().toISOString()
        }
      };
    }

    return {
      mode: "connected",
      status: "connected",
      accountLabel: `Granola ${config.keyType === "enterprise" ? "Enterprise" : "Managed"}`,
      config,
      credential: {
        mode: "managed_reference",
        managedSecretRef: parsed.managedSecretRef,
        keyType: config.keyType,
        createdAt: new Date().toISOString()
      }
    };
  }

  async testConnection(input: { credential: Record<string, unknown> | null }) {
    await this.listFolders(this.resolveBearerToken(input.credential), { page_size: 1 });
    return { ok: true };
  }

  async sync(input: {
    projectId: string;
    connector: CommunicationConnector;
    credential: Record<string, unknown> | null;
    syncType: CommunicationSyncType;
    batchSize: number;
    maxBackfillDays: number;
  }): Promise<ProviderSyncResult> {
    if (input.syncType === "webhook") {
      throw new AppError(501, "Granola webhooks are not documented by the official Granola API", "granola_webhooks_not_supported");
    }
    if (input.syncType === "backfill" && !this.env.GRANOLA_BACKFILL_ENABLED) {
      throw new AppError(503, "Granola backfill sync is disabled", "granola_backfill_disabled");
    }
    if (input.syncType === "incremental" && !this.env.GRANOLA_INCREMENTAL_SYNC_ENABLED) {
      throw new AppError(503, "Granola incremental sync is disabled", "granola_incremental_sync_disabled");
    }

    const token = this.resolveBearerToken(input.credential);
    const config = this.connectorConfig(input.connector.configJson);
    if (config.selectedFolderIds.length === 0) {
      throw new AppError(409, "Select Granola folders before syncing meeting notes", "granola_folder_selection_required");
    }
    const pageSize = Math.min(config.syncBatchSize ?? input.batchSize, GRANOLA_MAX_PAGE_SIZE);
    const maxNotes = Math.min(this.env.GRANOLA_MAX_NOTES_PER_SYNC, Math.max(pageSize, 1));
    const query = this.buildListNotesQuery(input, config, pageSize);
    const selectedFolderIds = new Set(config.selectedFolderIds ?? []);

    const threads: NormalizedThread[] = [];
    const messages: NormalizedMessage[] = [];
    const warnings: string[] = [];
    const partialFailures: Array<{ noteId?: string; code: string }> = [];
    let notesListed = 0;
    let notesFetched = 0;
    let notesSkippedUnavailable = 0;
    let notesSkippedByFolder = 0;
    let summariesNormalized = 0;
    let transcriptSegmentsNormalized = 0;
    let rateLimitCount = 0;
    let nextCursor: string | null = null;
    let cursorCanAdvance = true;
    let latestUpdatedAt = this.asString(input.connector.providerCursorJson && typeof input.connector.providerCursorJson === "object"
      ? (input.connector.providerCursorJson as Record<string, unknown>).lastGranolaUpdatedAfter
      : null);

    try {
      let cursor = query.cursor;
      while (notesListed < maxNotes) {
        const page = await this.listNotes(token, { ...query, cursor, page_size: Math.min(pageSize, maxNotes - notesListed) });
        const notes = page.notes;
        notesListed += notes.length;
        nextCursor = page.cursor;

        for (const note of notes) {
          const noteId = this.asString(note.id);
          if (!noteId) continue;
          try {
            const detail = await this.getNote(token, noteId, config.includeTranscript !== false);
            notesFetched += 1;
            if (!this.matchesSelectedFolders(detail, selectedFolderIds)) {
              notesSkippedByFolder += 1;
              continue;
            }
            const normalized = this.normalizeNote(detail, config);
            if (normalized.messages.length === 0) {
              notesSkippedUnavailable += 1;
              warnings.push(`Granola note ${noteId} did not include a summary or transcript to ingest`);
              continue;
            }
            threads.push(normalized.thread);
            messages.push(...normalized.messages);
            summariesNormalized += normalized.summaryCount;
            transcriptSegmentsNormalized += normalized.transcriptSegmentCount;
            const updatedAt = this.asString(detail.updated_at ?? note.updated_at);
            if (updatedAt && (!latestUpdatedAt || updatedAt > latestUpdatedAt)) {
              latestUpdatedAt = updatedAt;
            }
          } catch (error) {
            if (isAppErrorCode(error, "granola_note_processing_or_unavailable")) {
              notesSkippedUnavailable += 1;
              warnings.push(`Granola note ${noteId} is processing or unavailable`);
              continue;
            }
            if (isAppErrorCode(error, "granola_rate_limited")) {
              rateLimitCount += 1;
              cursorCanAdvance = false;
              partialFailures.push({ noteId, code: "granola_rate_limited" });
              break;
            }
            cursorCanAdvance = false;
            partialFailures.push({ noteId, code: error instanceof AppError ? error.code : "granola_note_fetch_failed" });
          }
        }

        if (partialFailures.some((failure) => failure.code === "granola_rate_limited")) break;
        if (!page.hasMore || !page.cursor || notesListed >= maxNotes) break;
        cursor = page.cursor;
      }
    } catch (error) {
      cursorCanAdvance = false;
      if (isAppErrorCode(error, "granola_rate_limited")) {
        rateLimitCount += 1;
        partialFailures.push({ code: "granola_rate_limited" });
      } else {
        throw error;
      }
    }

    const batches = threads.length > 0
      ? [{
          projectId: input.projectId,
          connectorId: input.connector.id,
          provider: this.provider,
          threads,
          messages
        } satisfies NormalizedCommunicationBatch]
      : [];

    const cursorBefore = this.objectRecord(input.connector.providerCursorJson);
    const previousGranolaCursor = this.asString(cursorBefore.lastGranolaCursor) ?? this.asString(config.lastGranolaCursor) ?? null;
    const cursorAfter = {
      ...cursorBefore,
      lastGranolaCursor: cursorCanAdvance ? nextCursor : previousGranolaCursor,
      lastGranolaSyncType: input.syncType,
      lastGranolaSyncCompletedAt: new Date().toISOString(),
      ...(cursorCanAdvance && latestUpdatedAt ? { lastGranolaUpdatedAfter: latestUpdatedAt } : {}),
      lastGranolaCursorAdvanceBlocked: !cursorCanAdvance
    };

    return {
      queued: false,
      batches,
      cursorAfter,
      summary: {
        provider: "granola",
        syncType: input.syncType,
        notesListed,
        notesFetched,
        notesSkippedUnavailable,
        notesSkippedByFolder,
        summariesNormalized,
        transcriptSegmentsNormalized,
        threadsCreated: threads.length,
        messagesCreated: messages.length,
        chunksQueued: messages.length,
        insightsQueued: messages.length,
        nextCursor,
        updatedAfterUsed: query.updated_after ?? null,
        createdAfterUsed: query.created_after ?? null,
        rateLimitCount,
        partialFailures,
        warnings
      },
      status: partialFailures.length > 0 ? "partial" : "completed"
    };
  }

  async listChannels(input: { credential: Record<string, unknown> | null }): Promise<ProviderChannel[]> {
    const token = this.resolveBearerToken(input.credential);
    const folders = await this.listAllFolders(token, GRANOLA_MAX_PAGE_SIZE);
    return folders
      .map((folder) => {
        const id = this.asString(folder.id);
        if (!id) return null;
        const parentFolderId = this.asString(folder.parent_folder_id);
        return {
          id,
          name: this.bound(this.asString(folder.name) ?? `Granola folder ${id}`, 180),
          isPrivate: false,
          isArchived: false,
          rawMetadata: parentFolderId ? { parentFolderId } : undefined
        } as ProviderChannel & { rawMetadata?: Record<string, unknown> };
      })
      .filter((folder): folder is ProviderChannel => Boolean(folder));
  }

  async registerWebhook(_input: {
    connector: CommunicationConnector;
    credential: Record<string, unknown> | null;
    endpointUrl: string;
  }): Promise<ProviderWebhookRegistrationResult> {
    throw new AppError(501, "Granola webhooks are not documented by the official Granola API", "granola_webhooks_not_supported");
  }

  async verifyWebhook(_input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
    body: unknown;
    query?: Record<string, string | string[] | undefined>;
    connectors: CommunicationConnector[];
    credentialsByConnectorId?: Record<string, Record<string, unknown> | null>;
  }): Promise<ProviderWebhookVerificationResult> {
    throw new AppError(501, "Granola webhooks are not documented by the official Granola API", "granola_webhooks_not_supported");
  }

  async revoke() {
    return { providerRevoked: false, reason: "Granola credentials are managed outside Orchestra; the local credential was removed." };
  }

  private async listNotes(token: string, query: GranolaListNotesQuery) {
    const payload = await this.requestJson(token, "/notes", "list_notes", query);
    const notes = Array.isArray(payload.notes) ? payload.notes.filter(isRecord) as GranolaNoteSummary[] : [];
    return {
      notes,
      hasMore: payload.hasMore === true,
      cursor: this.asString(payload.cursor) ?? null
    };
  }

  private async getNote(token: string, noteId: string, includeTranscript: boolean) {
    const path = `/notes/${encodeURIComponent(noteId)}`;
    try {
      return await this.requestJson(token, path, "get_note", includeTranscript ? { include: "transcript" } : {}) as GranolaNoteDetail;
    } catch (error) {
      if (isAppErrorCode(error, "granola_note_processing_or_unavailable")) {
        throw error;
      }
      throw error;
    }
  }

  private async listFolders(token: string, query: { cursor?: string; page_size?: number }) {
    const payload = await this.requestJson(token, "/folders", "list_folders", query);
    const folders = Array.isArray(payload.folders) ? payload.folders.filter(isRecord) as GranolaFolder[] : [];
    return {
      folders,
      hasMore: payload.hasMore === true,
      cursor: this.asString(payload.cursor) ?? null
    };
  }

  private async listAllFolders(token: string, pageSize: number) {
    const folders: GranolaFolder[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const result = await this.listFolders(token, { cursor, page_size: Math.min(pageSize, GRANOLA_MAX_PAGE_SIZE) });
      folders.push(...result.folders);
      if (!result.hasMore || !result.cursor) break;
      cursor = result.cursor;
    }
    return folders;
  }

  private async requestJson(
    token: string,
    path: string,
    operation: "list_notes" | "get_note" | "list_folders",
    query: Record<string, unknown> = {}
  ) {
    const base = this.env.GRANOLA_API_BASE_URL.replace(/\/$/, "");
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === "") continue;
      url.searchParams.set(key, key === "page_size" ? String(Math.min(Number(value), GRANOLA_MAX_PAGE_SIZE)) : String(value));
    }

    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GRANOLA_DEFAULT_TIMEOUT_MS);
      try {
        const response = await this.fetchImpl(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (response.status === 429) {
          if (attempt < GRANOLA_MAX_RETRIES) {
            attempt += 1;
            const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
            await this.sleep(Math.min(retryAfterMs ?? 250 * attempt, 1_000));
            continue;
          }
          throw new AppError(429, "Granola API rate limit exceeded", "granola_rate_limited", { operation });
        }
        if (response.status === 404 && operation === "get_note") {
          throw new AppError(404, "Granola note is processing or unavailable", "granola_note_processing_or_unavailable", { operation });
        }
        if (!response.ok) {
          throw new AppError(response.status, "Granola API request failed", "granola_api_error", { operation, statusCode: response.status });
        }
        return isRecord(payload) ? payload : {};
      } catch (error) {
        if (error instanceof AppError) throw error;
        if ((error as { name?: string }).name === "AbortError") {
          throw new AppError(504, "Granola API request timed out", "granola_request_timeout", { operation });
        }
        throw new AppError(502, "Granola API request failed", "granola_api_error", { operation });
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private normalizeNote(note: GranolaNoteDetail, config: ReturnType<GranolaProvider["connectorConfig"]>) {
    const noteId = this.requireString(note.id, "granola_note_id_missing");
    const calendarEvent = this.objectRecord(note.calendar_event);
    const title = this.bound(
      this.asString(note.title) ?? this.asString(calendarEvent.event_title) ?? "Granola meeting note",
      240
    );
    const createdAt = this.parseDate(this.asString(note.created_at)) ?? new Date();
    const updatedAt = this.parseDate(this.asString(note.updated_at)) ?? createdAt;
    const startedAt = this.parseDate(this.asString(calendarEvent.scheduled_start_time)) ?? createdAt;
    const endedAt = this.parseDate(this.asString(calendarEvent.scheduled_end_time));
    const webUrl = this.asString(note.web_url);
    const folderMembership = this.folderMembership(note.folder_membership);
    const attendees = config.includeAttendees === false ? [] : this.attendees(note.attendees);
    const owner = this.person(note.owner);
    const participants = this.dedupeParticipants([...(owner ? [owner] : []), ...attendees]);
    const summaryText = this.bound(
      this.asString(note.summary_markdown) ?? this.asString(note.summary_text) ?? this.asString(note.summary) ?? "",
      40_000
    );
    const transcript = Array.isArray(note.transcript) ? note.transcript.filter(isRecord) as GranolaTranscriptSegment[] : [];

    const thread: NormalizedThread = {
      providerThreadId: `granola_note:${noteId}`,
      subject: title,
      participants,
      startedAt,
      lastMessageAt: updatedAt,
      threadUrl: webUrl,
      rawMetadata: {
        sourceKind: "granola_note",
        granola: {
          noteId,
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
          endedAt: endedAt?.toISOString() ?? null,
          webUrl,
          owner,
          attendeeCount: attendees.length,
          folderMembership,
          calendarEvent: this.safeCalendarEvent(calendarEvent, config),
          hasSummary: summaryText.trim().length > 0,
          transcriptSegmentCount: transcript.length
        }
      }
    };

    const messages: NormalizedMessage[] = [];
    if (config.includeSummary !== false && summaryText.trim()) {
      messages.push({
        providerThreadId: thread.providerThreadId,
        providerMessageId: `granola_note:${noteId}:summary`,
        senderLabel: owner?.label ?? "Granola",
        senderExternalRef: owner?.externalRef ?? null,
        senderEmail: owner?.email ?? null,
        sentAt: updatedAt,
        bodyText: summaryText,
        messageType: "note",
        providerPermalink: webUrl,
        rawMetadata: {
          sourceSubType: "granola_summary",
          noteId,
          sourceKind: "granola_note_summary",
          hasSummaryMarkdown: Boolean(this.asString(note.summary_markdown)),
          hasSummaryText: Boolean(this.asString(note.summary_text) ?? this.asString(note.summary)),
          folderMembership,
          calendarEvent: this.safeCalendarEvent(calendarEvent, config),
          notTruth: true
        }
      });
    }

    if (config.includeTranscript !== false) {
      transcript.forEach((segment, index) => {
        const body = this.bound(this.asString(segment.text) ?? "", 20_000);
        if (!body.trim()) return;
        const speaker = this.speaker(segment.speaker);
        const start = this.parseDate(this.asString(segment.start_time)) ?? startedAt;
        const end = this.parseDate(this.asString(segment.end_time));
        messages.push({
          providerThreadId: thread.providerThreadId,
          providerMessageId: `granola_note:${noteId}:transcript:${index}:${this.asString(segment.start_time) ?? "unknown"}`,
          senderLabel: speaker.displayName,
          senderExternalRef: speaker.externalRef,
          sentAt: start,
          bodyText: body,
          messageType: speaker.isSystemAudio ? "system" : "user",
          providerPermalink: webUrl,
          rawMetadata: {
            sourceSubType: "granola_transcript_segment",
            noteId,
            segmentIndex: index,
            startTime: start.toISOString(),
            endTime: end?.toISOString() ?? null,
            speaker: {
              source: speaker.source,
              diarizationLabel: speaker.diarizationLabel
            },
            platformShape: speaker.platformShape,
            transcriptSource: "granola",
            notTruth: true
          }
        });
      });
    }

    return {
      thread,
      messages,
      summaryCount: messages.some((message) => message.rawMetadata?.sourceSubType === "granola_summary") ? 1 : 0,
      transcriptSegmentCount: messages.filter((message) => message.rawMetadata?.sourceSubType === "granola_transcript_segment").length
    };
  }

  private buildListNotesQuery(
    input: { connector: CommunicationConnector; syncType: CommunicationSyncType; maxBackfillDays: number },
    config: ReturnType<GranolaProvider["connectorConfig"]>,
    pageSize: number
  ): GranolaListNotesQuery {
    const cursorState = this.objectRecord(input.connector.providerCursorJson);
    const cursor = this.asString(cursorState.lastGranolaCursor) ?? this.asString(config.lastGranolaCursor);
    if (input.syncType === "incremental") {
      const updatedAfter =
        this.asString(cursorState.lastGranolaUpdatedAfter) ??
        this.asString(config.lastGranolaUpdatedAfter) ??
        input.connector.lastSyncedAt?.toISOString() ??
        this.daysAgoIso(Math.min(config.maxBackfillDays ?? input.maxBackfillDays, input.maxBackfillDays));
      return { updated_after: updatedAfter, cursor, page_size: pageSize };
    }
    const createdAfter = this.asString(config.syncSince) ?? this.daysAgoIso(Math.min(config.maxBackfillDays ?? input.maxBackfillDays, input.maxBackfillDays));
    return { created_after: createdAfter, cursor, page_size: pageSize };
  }

  private connectorConfig(raw: unknown) {
    const config = this.objectRecord(raw);
    return {
      keyType: this.parseKeyType(config.keyType),
      workspaceScope: this.asString(config.workspaceScope),
      selectedFolderIds: this.parseStringArray(config.selectedFolderIds, "selectedFolderIds") ?? [],
      selectedFolderNames: this.parseStringArray(config.selectedFolderNames, "selectedFolderNames") ?? [],
      includeChildFolders: this.parseOptionalBoolean(config.includeChildFolders, "includeChildFolders") ?? false,
      syncSince: this.asString(config.syncSince),
      lastGranolaCursor: this.asString(config.lastGranolaCursor),
      lastGranolaUpdatedAfter: this.asString(config.lastGranolaUpdatedAfter),
      includeTranscript: this.parseOptionalBoolean(config.includeTranscript, "includeTranscript") ?? this.env.GRANOLA_INCLUDE_TRANSCRIPT_DEFAULT,
      includeSummary: this.parseOptionalBoolean(config.includeSummary, "includeSummary") ?? this.env.GRANOLA_INCLUDE_SUMMARY_DEFAULT,
      includeCalendarEvent: this.parseOptionalBoolean(config.includeCalendarEvent, "includeCalendarEvent") ?? this.env.GRANOLA_INCLUDE_CALENDAR_EVENT_DEFAULT,
      includeAttendees: this.parseOptionalBoolean(config.includeAttendees, "includeAttendees") ?? this.env.GRANOLA_INCLUDE_ATTENDEES_DEFAULT,
      maxBackfillDays: this.parseOptionalInteger(config.maxBackfillDays, "maxBackfillDays", 1, 365) ?? this.env.GRANOLA_MAX_BACKFILL_DAYS,
      syncBatchSize: Math.min(this.parseOptionalInteger(config.syncBatchSize, "syncBatchSize", 1, 30) ?? this.env.GRANOLA_SYNC_BATCH_SIZE, 30)
    };
  }

  private parseConnectBody(body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AppError(400, "Granola API-key connection details are required", "granola_api_key_required");
    }

    const input = body as GranolaConnectBody;
    const apiKey = this.cleanOptionalString(input.apiKey);
    const managedSecretRef = this.cleanOptionalString(input.managedSecretRef);
    if (apiKey && managedSecretRef) {
      throw new AppError(422, "Provide either a Granola API key or a managed secret reference, not both", "granola_credential_ambiguous");
    }
    if (!apiKey && !managedSecretRef) {
      throw new AppError(400, "Granola API key or managed secret reference is required", "granola_api_key_required");
    }
    if (apiKey && (!/^\S{16,}$/.test(apiKey) || /^bearer\s+/i.test(apiKey))) {
      throw new AppError(422, "Granola API key format is invalid", "granola_api_key_invalid");
    }
    if (managedSecretRef && !managedSecretRef.startsWith(this.env.CONNECTOR_MANAGED_SECRET_PREFIX)) {
      throw new AppError(422, "Granola managed secret reference is invalid", "granola_managed_secret_ref_invalid");
    }

    return {
      apiKey,
      managedSecretRef,
      keyType: this.parseKeyType(input.keyType),
      config: this.parseSafeConfig(input.config)
    };
  }

  private buildSafeConfig(input: ReturnType<GranolaProvider["parseConnectBody"]>) {
    return {
      keyType: input.keyType,
      apiBaseUrl: this.env.GRANOLA_API_BASE_URL,
      workspaceScope: input.config.workspaceScope ?? (input.keyType === "enterprise" ? "team_space" : "user_accessible_notes"),
      selectedFolderIds: input.config.selectedFolderIds ?? [],
      selectedFolderNames: input.config.selectedFolderNames ?? [],
      includeChildFolders: input.config.includeChildFolders ?? false,
      syncSince: input.config.syncSince ?? null,
      lastGranolaCursor: input.config.lastGranolaCursor ?? null,
      lastGranolaUpdatedAfter: input.config.lastGranolaUpdatedAfter ?? null,
      includeTranscript: input.config.includeTranscript ?? this.env.GRANOLA_INCLUDE_TRANSCRIPT_DEFAULT,
      includeSummary: input.config.includeSummary ?? this.env.GRANOLA_INCLUDE_SUMMARY_DEFAULT,
      includeCalendarEvent: input.config.includeCalendarEvent ?? this.env.GRANOLA_INCLUDE_CALENDAR_EVENT_DEFAULT,
      includeAttendees: input.config.includeAttendees ?? this.env.GRANOLA_INCLUDE_ATTENDEES_DEFAULT,
      maxBackfillDays: input.config.maxBackfillDays ?? this.env.GRANOLA_MAX_BACKFILL_DAYS,
      syncBatchSize: Math.min(input.config.syncBatchSize ?? this.env.GRANOLA_SYNC_BATCH_SIZE, 30),
      syncEnabled: true,
      readFirst: true,
      truthGated: true,
      webhooks: "not_supported",
      writeActionsEnabled: false
    };
  }

  private parseSafeConfig(value: unknown) {
    if (value == null) return {};
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new AppError(422, "Granola connector config must be an object", "granola_config_invalid");
    }

    const config = value as Record<string, unknown>;
    for (const key of Object.keys(config)) {
      if (!GRANOLA_SAFE_CONFIG_KEYS.has(key) || GRANOLA_SECRET_KEY_PATTERN.test(key)) {
        throw new AppError(422, "Granola connector config contains an unsupported or unsafe field", "granola_config_unsafe_field", {
          field: key
        });
      }
    }

    return {
      workspaceScope: this.cleanOptionalString(config.workspaceScope),
      selectedFolderIds: this.parseStringArray(config.selectedFolderIds, "selectedFolderIds"),
      selectedFolderNames: this.parseStringArray(config.selectedFolderNames, "selectedFolderNames"),
      includeChildFolders: this.parseOptionalBoolean(config.includeChildFolders, "includeChildFolders"),
      syncSince: this.cleanOptionalString(config.syncSince),
      lastGranolaCursor: this.cleanOptionalString(config.lastGranolaCursor),
      lastGranolaUpdatedAfter: this.cleanOptionalString(config.lastGranolaUpdatedAfter),
      includeTranscript: this.parseOptionalBoolean(config.includeTranscript, "includeTranscript"),
      includeSummary: this.parseOptionalBoolean(config.includeSummary, "includeSummary"),
      includeCalendarEvent: this.parseOptionalBoolean(config.includeCalendarEvent, "includeCalendarEvent"),
      includeAttendees: this.parseOptionalBoolean(config.includeAttendees, "includeAttendees"),
      maxBackfillDays: this.parseOptionalInteger(config.maxBackfillDays, "maxBackfillDays", 1, 365),
      syncBatchSize: this.parseOptionalInteger(config.syncBatchSize, "syncBatchSize", 1, 30)
    };
  }

  private parseKeyType(value: unknown) {
    const keyType = this.cleanOptionalString(value) ?? "unknown";
    if (keyType !== "personal" && keyType !== "enterprise" && keyType !== "unknown") {
      throw new AppError(422, "Granola keyType must be personal, enterprise, or unknown", "granola_key_type_invalid");
    }
    return keyType;
  }

  private parseStringArray(value: unknown, field: string) {
    if (value == null) return undefined;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
      throw new AppError(422, `Granola ${field} must be a string array`, "granola_config_invalid", { field });
    }
    return value.map((item) => item.trim());
  }

  private parseOptionalBoolean(value: unknown, field: string) {
    if (value == null) return undefined;
    if (typeof value !== "boolean") {
      throw new AppError(422, `Granola ${field} must be a boolean`, "granola_config_invalid", { field });
    }
    return value;
  }

  private parseOptionalInteger(value: unknown, field: string, min: number, max: number) {
    if (value == null) return undefined;
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
      throw new AppError(422, `Granola ${field} is out of range`, "granola_config_invalid", { field, min, max });
    }
    return value as number;
  }

  private resolveBearerToken(credential: Record<string, unknown> | null) {
    const parsed = credential as GranolaCredential | null;
    const apiKey = parsed?.apiKey;
    if (typeof apiKey === "string" && apiKey.trim().length > 0) {
      return apiKey.trim();
    }
    throw new AppError(409, "Granola API credential is unavailable for live API calls", "granola_credential_unavailable");
  }

  private matchesSelectedFolders(note: GranolaNoteDetail, selectedFolderIds: Set<string>) {
    if (selectedFolderIds.size === 0) return false;
    const folders = this.folderMembership(note.folder_membership);
    return folders.some((folder) => selectedFolderIds.has(folder.id));
  }

  private folderMembership(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .filter(isRecord)
      .map((folder) => ({
        id: this.asString(folder.id) ?? "",
        name: this.asString(folder.name) ?? null,
        parentFolderId: this.asString(folder.parent_folder_id) ?? null
      }))
      .filter((folder) => folder.id.length > 0);
  }

  private attendees(value: unknown): NormalizedParticipant[] {
    if (!Array.isArray(value)) return [];
    return value.filter(isRecord).map((item) => this.person(item)).filter((item): item is NormalizedParticipant => Boolean(item));
  }

  private person(value: unknown): NormalizedParticipant | null {
    if (!isRecord(value)) return null;
    const name = this.asString(value.name);
    const email = this.asString(value.email);
    const label = name ?? email;
    if (!label) return null;
    return {
      label,
      externalRef: email ?? name ?? null,
      email: email?.toLowerCase() ?? null
    };
  }

  private dedupeParticipants(participants: NormalizedParticipant[]) {
    const seen = new Set<string>();
    return participants.filter((participant) => {
      const key = (participant.email ?? participant.externalRef ?? participant.label).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private speaker(value: unknown) {
    const speaker = this.objectRecord(value);
    const source = this.asString(speaker.source);
    const diarizationLabel = this.asString(speaker.diarization_label);
    const displayName =
      diarizationLabel ??
      (source === "microphone"
        ? "Microphone"
        : source === "speaker"
          ? "Meeting audio"
          : "Unknown speaker");
    return {
      source: source ?? "unknown",
      diarizationLabel: diarizationLabel ?? null,
      displayName,
      externalRef: diarizationLabel ?? source ?? "unknown",
      isSystemAudio: source === "speaker",
      platformShape: diarizationLabel ? "ios" : source === "microphone" || source === "speaker" ? "macos" : "unknown"
    };
  }

  private safeCalendarEvent(value: Record<string, unknown>, config: ReturnType<GranolaProvider["connectorConfig"]>) {
    if (config.includeCalendarEvent === false) return null;
    return {
      eventTitle: this.asString(value.event_title),
      organiser: this.asString(value.organiser),
      calendarEventId: this.asString(value.calendar_event_id),
      scheduledStartTime: this.asString(value.scheduled_start_time),
      scheduledEndTime: this.asString(value.scheduled_end_time),
      inviteeCount: Array.isArray(value.invitees) ? value.invitees.length : 0
    };
  }

  private objectRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
  }

  private asString(value: unknown) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  }

  private requireString(value: unknown, code: string) {
    const text = this.asString(value);
    if (!text) throw new AppError(422, "Granola API response is missing required data", code);
    return text;
  }

  private cleanOptionalString(value: unknown) {
    return this.asString(value);
  }

  private parseDate(value: string | undefined) {
    if (!value) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp) : null;
  }

  private daysAgoIso(days: number) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  private bound(value: string, max: number) {
    return value.length > max ? value.slice(0, max) : value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isAppErrorCode(error: unknown, code: string) {
  return error instanceof AppError && error.code === code;
}
