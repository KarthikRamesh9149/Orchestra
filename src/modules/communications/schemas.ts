import { z } from "zod";

function isPrivateOrLocalHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(normalized)) return true;
  if (normalized.startsWith("10.")) return true;
  if (normalized.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return true;
  return normalized.endsWith(".local") || normalized.endsWith(".internal");
}

const safeProviderUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && !isPrivateOrLocalHost(url.hostname);
    } catch {
      return false;
    }
  }, "Provider URLs must be public http(s) URLs");

function sanitizeManualImportHtml(value: string | null | undefined) {
  if (!value) return value;
  return value
    .replace(/<\s*(script|iframe|object|embed|svg|img)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|iframe|object|embed|svg|img)\b[^>]*\/?>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(href|src)\s*=\s*(?:"\s*(?:javascript|data|vbscript):[^"]*"|'\s*(?:javascript|data|vbscript):[^']*'|(?:javascript|data|vbscript):[^\s>]+)/gi, "");
}

export const communicationProviderSchema = z.enum([
  "manual_import",
  "slack",
  "gmail",
  "outlook",
  "microsoft_teams",
  "whatsapp_business",
  "fireflies_ai",
  "clickup",
  "granola",
  "zoho_mail",
  "zoho_cliq",
  "zoho_crm",
  "notion"
]);

export const connectorStatusSchema = z.enum(["pending_auth", "connected", "syncing", "error", "revoked"]);
export const syncTypeSchema = z.enum(["manual", "webhook", "backfill", "incremental"]);
export const syncStatusSchema = z.enum(["queued", "running", "completed", "partial", "failed"]);
export const jobRunStatusSchema = z.enum(["pending", "running", "completed", "failed", "dead"]);
export const communicationMessageTypeSchema = z.enum(["user", "system", "bot", "file_share", "note", "other"]);
export const messageInsightTypeSchema = z.enum([
  "info",
  "clarification",
  "decision",
  "requirement_change",
  "contradiction",
  "blocker",
  "action_needed",
  "risk",
  "approval"
]);
export const messageInsightStatusSchema = z.enum([
  "detected",
  "ignored",
  "converted_to_proposal",
  "converted_to_decision",
  "superseded"
]);
export const proposalStatusSchema = z.enum(["detected", "needs_review", "accepted", "rejected", "superseded"]);

export const projectParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const connectorParamsSchema = z.object({
  projectId: z.string().uuid(),
  connectorId: z.string().uuid()
});

export const providerConnectParamsSchema = z.object({
  projectId: z.string().uuid(),
  provider: communicationProviderSchema
});

export const providerConnectBodySchema = z.record(z.string(), z.unknown()).default({});

export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(1).max(4096).optional(),
  error: z.string().min(1).max(500).optional()
});

export const webhookChallengeQuerySchema = z.object({
  validationToken: z.string().optional(),
  "hub.mode": z.string().optional(),
  "hub.verify_token": z.string().optional(),
  "hub.challenge": z.string().optional()
});

export const threadParamsSchema = z.object({
  projectId: z.string().uuid(),
  threadId: z.string().uuid()
});

export const messageParamsSchema = z.object({
  projectId: z.string().uuid(),
  messageId: z.string().uuid()
});

export const messageInsightParamsSchema = z.object({
  projectId: z.string().uuid(),
  insightId: z.string().uuid()
});

export const connectorPatchBodySchema = z.object({
  accountLabel: z.string().min(1).max(200).optional(),
  config: z.record(z.string(), z.unknown()).optional()
});

export const connectorListQuerySchema = z.object({
  provider: communicationProviderSchema.optional(),
  status: connectorStatusSchema.optional()
});

export const connectorResourceQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  cursor: z.string().trim().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

export const syncQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export const jobRunQuerySchema = z.object({
  status: jobRunStatusSchema.optional(),
  jobType: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export const connectorSyncBodySchema = z.object({
  syncType: syncTypeSchema.default("manual"),
  idempotencyKey: z.string().uuid().optional()
});

export const participantSchema = z.object({
  label: z.string().min(1),
  externalRef: z.string().optional().nullable(),
  email: z.string().email().optional().nullable()
});

export const attachmentSchema = z.object({
  providerAttachmentId: z.string().min(1).optional().nullable(),
  filename: z.string().min(1).optional().nullable(),
  mimeType: z.string().min(1).optional().nullable(),
  fileSize: z.coerce.number().int().nonnegative().optional().nullable(),
  providerUrl: safeProviderUrlSchema.optional().nullable(),
  rawMetadata: z.record(z.string(), z.unknown()).optional().nullable()
});

export const manualImportThreadSchema = z.object({
  providerThreadId: z.string().min(1),
  subject: z.string().optional().nullable(),
  participants: z.array(participantSchema).default([]),
  startedAt: z.string().datetime().optional().nullable(),
  threadUrl: safeProviderUrlSchema.optional().nullable(),
  rawMetadata: z.record(z.string(), z.unknown()).optional().nullable()
});

export const manualImportMessageSchema = z.object({
  providerMessageId: z.string().min(1),
  senderLabel: z.string().min(1),
  senderExternalRef: z.string().optional().nullable(),
  senderEmail: z.string().email().optional().nullable(),
  sentAt: z.string().datetime(),
  bodyText: z.string().min(1),
  bodyHtml: z.string().optional().nullable().transform(sanitizeManualImportHtml),
  messageType: communicationMessageTypeSchema,
  providerPermalink: safeProviderUrlSchema.optional().nullable(),
  replyToProviderMessageId: z.string().optional().nullable(),
  rawMetadata: z.record(z.string(), z.unknown()).optional().nullable(),
  attachments: z.array(attachmentSchema).default([])
});

export const manualImportBodySchema = z.object({
  provider: z.literal("manual_import").default("manual_import"),
  accountLabel: z.string().min(1).max(200).default("Manual import"),
  thread: manualImportThreadSchema,
  messages: z.array(manualImportMessageSchema).min(1)
});

export const firefliesParticipantSchema = z.object({
  name: z.string().trim().min(1).optional().nullable(),
  email: z.string().email().optional().nullable(),
  role: z.string().trim().min(1).optional().nullable()
});

export const firefliesTranscriptSegmentSchema = z
  .object({
    speakerName: z.string().trim().min(1).optional().nullable(),
    speakerEmail: z.string().email().optional().nullable(),
    speakerId: z.string().trim().min(1).optional().nullable(),
    startMs: z.coerce.number().int().nonnegative(),
    endMs: z.coerce.number().int().nonnegative().optional().nullable(),
    text: z.string().trim().min(1)
  })
  .superRefine((value, context) => {
    if (value.endMs != null && value.endMs < value.startMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endMs"],
        message: "Segment endMs must be greater than or equal to startMs"
      });
    }
  });

export const firefliesTranscriptImportBodySchema = z.object({
  provider: z.literal("fireflies_ai"),
  accountLabel: z.string().min(1).max(200).default("Fireflies.ai"),
  meeting: z.object({
    providerTranscriptId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().optional().nullable(),
    durationSeconds: z.coerce.number().int().nonnegative().optional().nullable(),
    participants: z.array(firefliesParticipantSchema).default([]),
    sourceUrl: z.string().url().optional().nullable(),
    recordingUrl: z.string().url().optional().nullable(),
    calendarEventId: z.string().trim().min(1).optional().nullable(),
    organizerEmail: z.string().email().optional().nullable(),
    hostEmail: z.string().email().optional().nullable(),
    meetingUrl: z.string().url().optional().nullable()
  }),
  summary: z.string().optional().nullable(),
  actionItems: z.array(z.unknown()).default([]),
  segments: z.array(firefliesTranscriptSegmentSchema).min(1),
  rawMetadata: z.record(z.string(), z.unknown()).optional().nullable()
});

export const communicationImportBodySchema = z.union([
  manualImportBodySchema,
  firefliesTranscriptImportBodySchema
]);

export const timelineQuerySchema = z.object({
  provider: communicationProviderSchema.optional(),
  connectorId: z.string().uuid().optional(),
  sourceSubType: z.string().trim().min(1).max(80).optional(),
  insightType: messageInsightTypeSchema.optional(),
  insightStatus: messageInsightStatusSchema.optional(),
  proposalStatus: proposalStatusSchema.optional(),
  hasChangeProposal: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value ? value === "true" : undefined)),
  hasOpenDecision: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value ? value === "true" : undefined)),
  hasBlocker: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value ? value === "true" : undefined)),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  search: z.string().trim().min(1).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export const threadListQuerySchema = z.object({
  provider: communicationProviderSchema.optional(),
  updatedSince: z.string().datetime().optional(),
  search: z.string().trim().min(1).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export const messageInsightListQuerySchema = z.object({
  status: messageInsightStatusSchema.optional(),
  insightType: messageInsightTypeSchema.optional(),
  threadId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
  provider: communicationProviderSchema.optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  hasProposal: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value ? value === "true" : undefined)),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});
