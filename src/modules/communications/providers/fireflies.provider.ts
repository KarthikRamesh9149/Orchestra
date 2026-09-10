import { createHmac, timingSafeEqual } from "node:crypto";
import type { CommunicationConnector } from "@prisma/client";
import type { AppEnv } from "../../../config/env.js";
import { AppError } from "../../../app/errors.js";
import { providerApiError, providerRateLimitError } from "../../../lib/communications/provider-http.js";
import type { NormalizedCommunicationBatch, NormalizedMessage } from "../../../lib/communications/provider-normalized-types.js";
import { firefliesTranscriptImportBodySchema } from "../schemas.js";
import type {
  CommunicationProviderAdapter,
  ProviderWebhookVerificationResult
} from "./provider.interface.js";

type FirefliesCredential = {
  mode: "api_key";
  apiKey: string;
  createdAt: string;
};

type FirefliesTranscriptSegment = {
  speakerName: string | null;
  speakerEmail: string | null;
  speakerId: string | null;
  startMs: number;
  endMs: number | null;
  text: string;
  segmentIndex: number;
};

type FirefliesTranscript = {
  id: string;
  title: string;
  dateString?: string | null;
  date?: number | null;
  duration?: number | null;
  organizer_email?: string | null;
  host_email?: string | null;
  participants?: string[] | null;
  meeting_attendees?: Array<{
    displayName?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    name?: string | null;
    location?: string | null;
  }> | null;
  transcript_url?: string | null;
  audio_url?: string | null;
  video_url?: string | null;
  meeting_link?: string | null;
  calendar_id?: string | null;
  cal_id?: string | null;
  calendar_type?: string | null;
  speakers?: Array<{ id?: string | null; name?: string | null }> | null;
  sentences?: Array<{
    index?: number | null;
    speaker_name?: string | null;
    speaker_id?: string | null;
    text?: string | null;
    raw_text?: string | null;
    start_time?: string | number | null;
    end_time?: string | number | null;
  }> | null;
  summary?: Record<string, unknown> | null;
};

const FIREFLIES_TRANSCRIPT_FIELDS = `
  id
  title
  dateString
  date
  duration
  organizer_email
  host_email
  participants
  meeting_attendees { displayName email phoneNumber name location }
  transcript_url
  audio_url
  video_url
  meeting_link
  calendar_id
  cal_id
  calendar_type
  speakers { id name }
  sentences {
    index
    speaker_name
    speaker_id
    text
    raw_text
    start_time
    end_time
  }
  summary {
    keywords
    action_items
    outline
    overview
    shorthand_bullet
    gist
    bullet_gist
    short_summary
    short_overview
    meeting_type
    topics_discussed
    transcript_chapters
  }
`;

export class FirefliesProvider implements CommunicationProviderAdapter {
  readonly provider = "fireflies_ai" as const;

  constructor(
    private readonly env: AppEnv,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async connect(_input?: { projectId: string; actorUserId: string; oauthState?: string }) {
    if (this.env.FIREFLIES_READINESS_MODE === "api" || this.env.FIREFLIES_READINESS_MODE === "api_and_webhook") {
      if (!this.env.FIREFLIES_API_KEY) {
        throw new AppError(503, "Fireflies API key is not configured", "fireflies_api_key_missing");
      }
      return {
        mode: "connected" as const,
        status: "connected" as const,
        accountLabel: "Fireflies.ai",
        config: {
          readinessMode: this.env.FIREFLIES_READINESS_MODE,
          apiBaseUrl: this.env.FIREFLIES_API_BASE_URL
        },
        credential: {
          mode: "api_key",
          apiKey: this.env.FIREFLIES_API_KEY,
          createdAt: new Date().toISOString()
        }
      };
    }

    return {
      mode: "connected" as const,
      status: "connected" as const,
      accountLabel: "Fireflies.ai manual import",
      config: {
        readinessMode: this.env.FIREFLIES_READINESS_MODE,
        liveApi: "readiness_gated"
      }
    };
  }

  async normalizeImport(input: unknown): Promise<NormalizedCommunicationBatch> {
    const parsed = firefliesTranscriptImportBodySchema.parse(input);
    const startedAt = parsed.meeting.startedAt;
    const segments = parsed.segments.map((segment, index) => ({
      speakerName: segment.speakerName ?? null,
      speakerEmail: segment.speakerEmail ?? null,
      speakerId: segment.speakerId ?? null,
      startMs: segment.startMs,
      endMs: segment.endMs ?? null,
      text: segment.text,
      segmentIndex: index
    }));

    return this.normalizeTranscript({
      transcriptId: parsed.meeting.providerTranscriptId,
      title: parsed.meeting.title,
      startedAt,
      endedAt: parsed.meeting.endedAt ?? null,
      durationSeconds: parsed.meeting.durationSeconds ?? null,
      participants: parsed.meeting.participants.map((participant) => ({
        label: participant.name ?? participant.email ?? "Fireflies participant",
        email: participant.email ?? null,
        externalRef: participant.email ?? null
      })),
      organizerEmail: parsed.meeting.organizerEmail ?? null,
      hostEmail: parsed.meeting.hostEmail ?? null,
      sourceUrl: parsed.meeting.sourceUrl ?? null,
      recordingUrl: parsed.meeting.recordingUrl ?? null,
      meetingUrl: parsed.meeting.meetingUrl ?? null,
      calendarEventId: parsed.meeting.calendarEventId ?? null,
      summary: parsed.summary ?? null,
      actionItems: parsed.actionItems,
      segments,
      rawMetadata: parsed.rawMetadata ?? {}
    });
  }

  async sync(input: {
    projectId: string;
    connector: CommunicationConnector;
    credential: Record<string, unknown> | null;
    syncType: "manual" | "webhook" | "backfill" | "incremental";
    webhookPayload?: Record<string, unknown>;
    batchSize: number;
    maxBackfillDays: number;
  }) {
    if (this.env.FIREFLIES_READINESS_MODE !== "api" && this.env.FIREFLIES_READINESS_MODE !== "api_and_webhook") {
      return {
        queued: false,
        status: "partial" as const,
        summary: {
          provider: "fireflies_ai",
          reason: "fireflies_live_api_not_enabled",
          manualImportAvailable: true
        }
      };
    }

    const apiKey = this.requireApiKey(input.credential);
    const transcriptIds =
      typeof input.webhookPayload?.meetingId === "string" ? [input.webhookPayload.meetingId] : [];
    const isTargetedWebhookSync = transcriptIds.length > 0;

    const backfillResult = isTargetedWebhookSync
      ? {
          transcripts: await mapWithConcurrency(transcriptIds, 2, (id) => this.fetchTranscript(apiKey, id)),
          cursorCanAdvance: false,
          hasMore: false,
          continuationCursor: null
        }
      : await this.fetchTranscriptBackfill(
          apiKey,
          input.connector.providerCursorJson,
          input.batchSize,
          input.maxBackfillDays
        );
    const transcripts = backfillResult.transcripts;

    const batches = transcripts
      .filter((transcript): transcript is FirefliesTranscript => Boolean(transcript))
      .map((transcript) => this.normalizeApiTranscript(transcript));

    const latestDate = batches
      .map((batch) => batch.threads[0]?.lastMessageAt ?? batch.threads[0]?.startedAt)
      .filter((value): value is string | Date => Boolean(value))
      .map((value) => new Date(value).toISOString())
      .sort()
      .at(-1);

    return {
      queued: false,
      batches,
      cursorAfter:
        isTargetedWebhookSync
          ? null
          : backfillResult.continuationCursor
            ? backfillResult.continuationCursor
            : !backfillResult.cursorCanAdvance || !latestDate
              ? null
              : {
                lastSeenDateString: latestDate,
                lastSeenTranscriptIds: transcripts.map((transcript) => transcript?.id).filter(Boolean),
                providerLimitations: {
                  updatedAtUnavailable: true,
                  deleteFeedUnavailable: true
                }
              },
      summary: {
        provider: "fireflies_ai",
        transcriptCount: batches.length,
        mode: isTargetedWebhookSync ? "targeted_webhook_sync" : "pull_sync",
        cursorAdvanced: !isTargetedWebhookSync && Boolean(backfillResult.continuationCursor ?? (backfillResult.cursorCanAdvance && latestDate)),
        continuationCursor: !isTargetedWebhookSync && Boolean(backfillResult.continuationCursor),
        hasMore: backfillResult.hasMore
      }
    };
  }

  private buildContinuationCursor(input: {
    fromDate: string;
    toDate: string;
    nextSkip: number;
  }) {
    return {
      firefliesContinuation: {
        fromDate: input.fromDate,
        toDate: input.toDate,
        nextSkip: input.nextSkip
      },
      providerLimitations: {
        updatedAtUnavailable: true,
        deleteFeedUnavailable: true
      }
    };
  }

  private readContinuation(cursorObj: Record<string, unknown>) {
    const raw = cursorObj.firefliesContinuation;
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const continuation = raw as Record<string, unknown>;
    const fromDate = typeof continuation.fromDate === "string" ? continuation.fromDate : null;
    const toDate = typeof continuation.toDate === "string" ? continuation.toDate : null;
    const nextSkip = typeof continuation.nextSkip === "number" && continuation.nextSkip >= 0 ? continuation.nextSkip : null;
    if (!fromDate || !toDate || nextSkip == null) {
      return null;
    }
    return { fromDate, toDate, nextSkip };
  }

  async verifyWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
    body: unknown;
    query?: Record<string, string | string[] | undefined>;
    connectors: CommunicationConnector[];
    credentialsByConnectorId?: Record<string, Record<string, unknown> | null>;
  }): Promise<ProviderWebhookVerificationResult> {
    if (!this.env.FIREFLIES_WEBHOOK_SECRET) {
      throw new AppError(503, "Fireflies webhook secret is not configured", "fireflies_webhook_secret_missing");
    }
    if (!input.rawBody) {
      throw new AppError(401, "Fireflies webhook raw body is required for signature verification", "fireflies_webhook_raw_body_missing");
    }
    const signature = this.header(input.headers, "x-hub-signature");
    if (!signature || !verifyFirefliesSignature(input.rawBody, signature, this.env.FIREFLIES_WEBHOOK_SECRET)) {
      throw new AppError(401, "Invalid Fireflies webhook signature", "fireflies_webhook_signature_invalid");
    }

    const body = input.body as Record<string, unknown>;
    const eventType = String(body.event ?? body.eventType ?? "unknown");
    const meetingId = typeof body.meeting_id === "string" ? body.meeting_id : typeof body.meetingId === "string" ? body.meetingId : null;
    const timestamp = typeof body.timestamp === "number" || typeof body.timestamp === "string" ? String(body.timestamp) : "no-ts";
    const providerEventId = meetingId ? `fireflies:${eventType}:${meetingId}:${timestamp}` : null;
    const allowedEvents = new Set(["meeting.transcribed", "meeting.summarized", "Transcription completed"]);

    if (!meetingId || !allowedEvents.has(eventType)) {
      return {
        handledImmediately: {
          statusCode: 200,
          body: { ok: true, ignored: true, reason: "unsupported_fireflies_event" }
        }
      };
    }

    if (this.env.FIREFLIES_READINESS_MODE === "webhook") {
      return {
        providerEventId: providerEventId!,
        eventType,
        connectorIds: []
      };
    }

    const scopedConnectorId = this.queryValue(input.query, "connectorId") ?? this.queryValue(input.query, "connector_id");
    if (!scopedConnectorId) {
      return {
        handledImmediately: {
          statusCode: 202,
          body: {
            ok: true,
            ignored: true,
            reason: "fireflies_connector_scope_required"
          }
        }
      };
    }
    const scopedConnectorToken =
      this.queryValue(input.query, "scopeToken") ??
      this.queryValue(input.query, "scope_token") ??
      this.queryValue(input.query, "connectorToken") ??
      this.queryValue(input.query, "connector_token");
    if (!scopedConnectorToken || !verifyFirefliesConnectorScope(scopedConnectorId, scopedConnectorToken, this.env.CONNECTOR_OAUTH_STATE_SECRET)) {
      return {
        handledImmediately: {
          statusCode: 202,
          body: {
            ok: true,
            ignored: true,
            reason: "fireflies_connector_scope_invalid"
          }
        }
      };
    }
    const connector = input.connectors.find((item) => item.id === scopedConnectorId);
    if (!connector) {
      return {
        handledImmediately: {
          statusCode: 202,
          body: {
            ok: true,
            ignored: true,
            reason: "fireflies_connector_scope_not_found"
          }
        }
      };
    }
    if (!input.credentialsByConnectorId?.[connector.id]) {
      return {
        handledImmediately: {
          statusCode: 202,
          body: {
            ok: true,
            ignored: true,
            reason: "fireflies_connector_credential_not_available"
          }
        }
      };
    }

    return {
      providerEventId: providerEventId!,
      eventType,
      connectorIds: [connector.id],
      jobPayload: {
        meetingId
      }
    };
  }

  private normalizeApiTranscript(transcript: FirefliesTranscript): NormalizedCommunicationBatch {
    const startedAt = transcript.dateString ?? (transcript.date ? new Date(transcript.date).toISOString() : new Date().toISOString());
    const participants = [
      ...(transcript.participants ?? []).map((email) => ({
        label: email,
        email,
        externalRef: email
      })),
      ...(transcript.meeting_attendees ?? []).map((attendee) => ({
        label: attendee.displayName ?? attendee.name ?? attendee.email ?? attendee.phoneNumber ?? "Fireflies attendee",
        email: attendee.email ?? null,
        externalRef: attendee.email ?? attendee.phoneNumber ?? attendee.name ?? null
      })),
      ...(transcript.speakers ?? [])
        .filter((speaker) => speaker.name)
        .map((speaker) => ({
          label: speaker.name!,
          email: null,
          externalRef: speaker.id ?? null
        }))
    ];
    const segments = (transcript.sentences ?? [])
      .map((sentence, index): FirefliesTranscriptSegment | null => {
        const text = sentence.text ?? sentence.raw_text ?? "";
        if (text.trim().length === 0) return null;
        return {
          speakerName: sentence.speaker_name ?? null,
          speakerEmail: null,
          speakerId: sentence.speaker_id ?? null,
          startMs: parseFirefliesTimeToMs(sentence.start_time),
          endMs: sentence.end_time == null ? null : parseFirefliesTimeToMs(sentence.end_time),
          text,
          segmentIndex: sentence.index ?? index
        };
      })
      .filter((segment): segment is FirefliesTranscriptSegment => Boolean(segment));

    return this.normalizeTranscript({
      transcriptId: transcript.id,
      title: transcript.title,
      startedAt,
      endedAt: null,
      durationSeconds: transcript.duration != null ? Math.round(transcript.duration * 60) : null,
      participants,
      organizerEmail: transcript.organizer_email ?? null,
      hostEmail: transcript.host_email ?? null,
      sourceUrl: transcript.transcript_url ?? null,
      recordingUrl: transcript.audio_url ?? transcript.video_url ?? null,
      meetingUrl: transcript.meeting_link ?? null,
      calendarEventId: transcript.cal_id ?? transcript.calendar_id ?? null,
      summary: transcript.summary ?? null,
      actionItems: normalizeUnknownArray(transcript.summary?.action_items),
      segments,
      rawMetadata: {
        calendarType: transcript.calendar_type ?? null
      }
    });
  }

  private normalizeTranscript(input: {
    transcriptId: string;
    title: string;
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number | null;
    participants: Array<{ label: string; email?: string | null; externalRef?: string | null }>;
    organizerEmail: string | null;
    hostEmail: string | null;
    sourceUrl: string | null;
    recordingUrl: string | null;
    meetingUrl: string | null;
    calendarEventId: string | null;
    summary: unknown;
    actionItems: unknown[];
    segments: FirefliesTranscriptSegment[];
    rawMetadata: Record<string, unknown>;
  }): NormalizedCommunicationBatch {
    const transcriptId = sanitizeProviderId(input.transcriptId);
    const threadUrl = this.env.FIREFLIES_ALLOW_TRANSCRIPT_PROVIDER_URLS ? input.sourceUrl : null;
    const providerPermalink = this.env.FIREFLIES_ALLOW_TRANSCRIPT_PROVIDER_URLS ? input.sourceUrl : null;
    const attachments = this.env.FIREFLIES_ALLOW_RECORDING_URLS && input.recordingUrl
      ? [
          {
            providerAttachmentId: `fireflies:recording:${transcriptId}`,
            filename: `${input.title} recording`,
            mimeType: null,
            fileSize: null,
            providerUrl: input.recordingUrl,
            rawMetadata: { kind: "fireflies_recording", storagePolicy: "metadata_only" }
          }
        ]
      : [];

    const bodyText = input.segments
      .map((segment) => {
        const speaker = segment.speakerName ?? "Unknown speaker";
        return `[${formatMs(segment.startMs)}] ${speaker}: ${segment.text}`;
      })
      .join("\n");

    const message: NormalizedMessage = {
      providerMessageId: `fireflies:transcript:${transcriptId}:full`,
      senderLabel: input.organizerEmail ?? input.hostEmail ?? "Fireflies.ai transcript",
      senderExternalRef: input.organizerEmail ?? input.hostEmail ?? null,
      senderEmail: input.organizerEmail ?? input.hostEmail ?? null,
      sentAt: input.startedAt,
      bodyText,
      messageType: "note",
      providerPermalink,
      rawMetadata: {
        providerKind: "fireflies_transcript",
        fireflies: {
          transcriptId,
          meetingTitle: input.title,
          startedAt: input.startedAt,
          endedAt: input.endedAt,
          durationSeconds: input.durationSeconds,
          calendarEventId: input.calendarEventId,
          hasSuppressedProviderUrl: Boolean(input.sourceUrl) && !this.env.FIREFLIES_ALLOW_TRANSCRIPT_PROVIDER_URLS,
          hasSuppressedRecordingUrl: Boolean(input.recordingUrl) && !this.env.FIREFLIES_ALLOW_RECORDING_URLS,
          aiGenerated: {
            notTruth: true,
            summary: input.summary,
            actionItems: input.actionItems
          },
          segments: input.segments.map((segment) => ({
            ...segment,
            transcriptId,
            meetingTitle: input.title
          })),
          metadata: input.rawMetadata
        }
      },
      attachments
    };

    return {
      projectId: "",
      connectorId: "",
      provider: "fireflies_ai",
      threads: [
        {
          providerThreadId: `fireflies:transcript:${transcriptId}`,
          subject: input.title,
          participants: input.participants,
          startedAt: input.startedAt,
          lastMessageAt: input.endedAt ?? input.startedAt,
          threadUrl,
          rawMetadata: {
            providerKind: "fireflies_meeting",
            transcriptId,
            meetingTitle: input.title,
            durationSeconds: input.durationSeconds,
            calendarEventId: input.calendarEventId,
            hasSuppressedProviderUrl: Boolean(input.sourceUrl) && !this.env.FIREFLIES_ALLOW_TRANSCRIPT_PROVIDER_URLS,
            hasSuppressedRecordingUrl: Boolean(input.recordingUrl) && !this.env.FIREFLIES_ALLOW_RECORDING_URLS
          }
        }
      ],
      messages: [message]
    };
  }

  private requireApiKey(credential: Record<string, unknown> | null) {
    const apiKey = typeof credential?.apiKey === "string" ? credential.apiKey : null;
    if (!apiKey) {
      throw new AppError(409, "Fireflies API credential is missing", "fireflies_credential_missing");
    }
    return apiKey;
  }

  private async fetchTranscriptBackfill(apiKey: string, cursor: unknown, batchSize: number, maxBackfillDays: number) {
    const cursorObj = (cursor ?? {}) as Record<string, unknown>;
    const continuation = this.readContinuation(cursorObj);
    const fromDate =
      continuation?.fromDate ??
      (typeof cursorObj.lastSeenDateString === "string"
        ? cursorObj.lastSeenDateString
        : new Date(Date.now() - maxBackfillDays * 24 * 60 * 60 * 1000).toISOString());
    const toDate = continuation?.toDate ?? new Date().toISOString();
    const startSkip = continuation?.nextSkip ?? 0;
    const limit = Math.max(1, Math.min(batchSize, this.env.FIREFLIES_SYNC_BATCH_SIZE, 50));
    const maxTranscriptDetailsPerRun = limit;
    const previouslySeenAtCursor = new Set(
      Array.isArray(cursorObj.lastSeenTranscriptIds)
        ? cursorObj.lastSeenTranscriptIds.filter((value): value is string => typeof value === "string")
        : []
    );
    const fromDateMs = Date.parse(fromDate);
    const transcriptSummaries: FirefliesTranscript[] = [];
    const fetchedTranscriptIds = new Set<string>();
    let hasMore = false;
    let nextSkip = startSkip;

    for (let skip = startSkip; skip <= 5000; skip += limit) {
      const list = await this.graphql<{ transcripts?: FirefliesTranscript[] }>(
        apiKey,
        `query FirefliesTranscripts($fromDate: DateTime, $toDate: DateTime, $limit: Int, $skip: Int) {
          transcripts(fromDate: $fromDate, toDate: $toDate, limit: $limit, skip: $skip) {
            id
            title
            dateString
            date
          }
        }`,
        { fromDate, toDate, limit, skip },
        "transcripts"
      );
      const page = list.transcripts ?? [];
      for (const transcript of page) {
        if (transcriptSummaries.length >= maxTranscriptDetailsPerRun) {
          hasMore = true;
          nextSkip = skip + limit;
          break;
        }
        if (!transcript?.id || fetchedTranscriptIds.has(transcript.id)) {
          continue;
        }
        const transcriptDate = transcript.dateString ?? (transcript.date ? new Date(transcript.date).toISOString() : null);
        const transcriptDateMs = transcriptDate ? Date.parse(transcriptDate) : Number.NaN;
        if (
          Number.isFinite(fromDateMs) &&
          Number.isFinite(transcriptDateMs) &&
          transcriptDateMs === fromDateMs &&
          previouslySeenAtCursor.has(transcript.id)
        ) {
          continue;
        }
        fetchedTranscriptIds.add(transcript.id);
        transcriptSummaries.push(transcript);
      }
      if (transcriptSummaries.length >= maxTranscriptDetailsPerRun) {
        hasMore = true;
        nextSkip = skip + limit;
        break;
      }
      if (page.length < limit) {
        break;
      }
      hasMore = true;
      nextSkip = skip + limit;
    }

    return {
      transcripts: await mapWithConcurrency(transcriptSummaries, 4, (transcript) => this.fetchTranscript(apiKey, transcript.id)),
      cursorCanAdvance: !hasMore,
      hasMore,
      continuationCursor: hasMore
        ? this.buildContinuationCursor({ fromDate, toDate, nextSkip })
        : null
    };
  }

  private async fetchTranscript(apiKey: string, transcriptId: string) {
    const result = await this.graphql<{ transcript?: FirefliesTranscript | null }>(
      apiKey,
      `query FirefliesTranscript($transcriptId: String!) {
        transcript(id: $transcriptId) {
          ${FIREFLIES_TRANSCRIPT_FIELDS}
        }
      }`,
      { transcriptId },
      "transcript"
    );
    return result.transcript ?? null;
  }

  private async graphql<T>(apiKey: string, query: string, variables: Record<string, unknown>, operation: string) {
    const response = await this.fetchImpl(this.env.FIREFLIES_API_BASE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(this.env.FIREFLIES_SYNC_TIMEOUT_MS)
    });

    if (response.status === 429) {
      throw providerRateLimitError("fireflies_ai", operation, response.headers.get("retry-after"));
    }
    if (!response.ok) {
      throw providerApiError("fireflies_ai", operation, `Fireflies API returned ${response.status}`, 502, {
        statusCode: response.status
      });
    }

    const payload = (await response.json()) as { data?: T; errors?: Array<{ message?: string }> };
    if (payload.errors?.length) {
      throw providerApiError("fireflies_ai", operation, "Fireflies GraphQL error", 502, {
        errorCount: payload.errors.length,
        messages: payload.errors.map((error) => error.message ?? "unknown").slice(0, 3)
      });
    }
    if (!payload.data) {
      throw providerApiError("fireflies_ai", operation, "Fireflies GraphQL response missing data");
    }
    return payload.data;
  }

  private header(headers: Record<string, string | string[] | undefined>, key: string) {
    const lookupKey = key.toLowerCase();
    const [, value] =
      Object.entries(headers).find(([headerKey]) => headerKey.toLowerCase() === lookupKey) ?? [];
    return Array.isArray(value) ? value[0] : value;
  }

  private queryValue(query: Record<string, string | string[] | undefined> | undefined, key: string) {
    if (!query) return undefined;
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  }
}

export function verifyFirefliesSignature(rawBody: string, signature: string, secret: string) {
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function signFirefliesConnectorScope(connectorId: string, secret: string) {
  return createHmac("sha256", secret).update(`fireflies:${connectorId}`).digest("hex");
}

export function verifyFirefliesConnectorScope(connectorId: string, token: string, secret: string) {
  const expected = signFirefliesConnectorScope(connectorId, secret);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(token, "utf8");
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function parseFirefliesTimeToMs(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 1000);
  }
  if (!value) return 0;
  const raw = String(value).trim();
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return Math.round(numeric * 1000);
  }
  const parts = raw.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  const seconds =
    parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
  return Math.round(seconds * 1000);
}

function sanitizeProviderId(value: string) {
  return value.trim().replace(/\s+/g, "_");
}

function normalizeUnknownArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++;
        results[currentIndex] = await mapper(items[currentIndex]);
      }
    })
  );

  return results;
}

export function formatMs(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}
