import { z } from "zod";

export const timelineProjectParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const timelineEventParamsSchema = timelineProjectParamsSchema.extend({
  eventId: z.string().trim().min(1).max(200)
});

export const timelineQuerySchema = z.object({
  source: z
    .enum(["manual", "calendar", "slack", "clickup", "granola", "fireflies_ai", "manual_import", "microsoft_teams", "zoho_mail", "zoho_cliq", "zoho_crm", "github", "google_drive", "notion", "socrates", "vscode", "document", "approval", "system", "all"])
    .optional(),
  status: z
    .enum(["informational", "pending", "accepted", "rejected", "superseded", "failed", "needs_review", "info", "all"])
    .optional(),
  view: z.enum(["summary", "detailed"]).optional().default("detailed"),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50)
});

export const createTimelineEventSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().max(5000).nullable().optional(),
    source: z
      .enum(["manual", "calendar", "slack", "clickup", "granola", "fireflies_ai", "manual_import", "microsoft_teams", "github", "google_drive", "notion", "socrates", "vscode", "document", "approval", "system"])
      .optional()
      .default("manual"),
    tier: z.enum(["milestone", "atomic"]).optional().default("atomic"),
    sourceRef: z.string().trim().max(500).nullable().optional(),
    startsAt: z.string().datetime().nullable().optional(),
    timestamp: z.string().datetime().nullable().optional(),
    eventType: z.enum(["note", "milestone", "decision", "change"]).optional(),
    linkedRefType: z.string().trim().max(100).nullable().optional(),
    linkedRefId: z.string().trim().max(255).nullable().optional()
  })
  .superRefine((value, ctx) => {
    if (value.source !== "manual" && !value.sourceRef && !value.linkedRefId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provider source hints require sourceRef or linkedRefId and will be stored as manual references",
        path: ["sourceRef"]
      });
    }
  });

export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
export type CreateTimelineEventInput = z.infer<typeof createTimelineEventSchema>;
