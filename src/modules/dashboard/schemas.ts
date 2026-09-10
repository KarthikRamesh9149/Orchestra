import { z } from "zod";

export const projectParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const generalDashboardQuerySchema = z.object({
  forceRefresh: z.coerce.boolean().optional().default(false)
});

export const projectDashboardQuerySchema = z.object({
  forceRefresh: z.coerce.boolean().optional().default(false)
});

export const missionControlQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(8),
  activityLimit: z.coerce.number().int().min(1).max(50).optional().default(8),
  timezone: z.string().trim().min(1).max(100).optional(),
  forceRefresh: z.coerce.boolean().optional().default(false)
});

export const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(25)
});

export const recentListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(10)
});

export const calendarEventsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10)
});

export const createCalendarEventSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().max(5000).nullable().optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().nullable().optional(),
    timezone: z.string().trim().min(1).max(100).nullable().optional(),
    isAllDay: z.boolean().optional().default(false),
    eventType: z.enum(["standup", "review", "client", "meeting", "milestone", "demo", "other"]).optional().default("meeting"),
    linkedRefType: z.string().trim().max(100).nullable().optional(),
    linkedRefId: z.string().trim().max(255).nullable().optional()
  })
  .superRefine((value, ctx) => {
    if (value.endsAt && new Date(value.endsAt).getTime() < new Date(value.startsAt).getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endsAt must be after startsAt",
        path: ["endsAt"]
      });
    }
  });

export const dashboardFileParamsSchema = projectParamsSchema.extend({
  filePath: z.string().min(1).max(1000)
});

export const dashboardContextSnapshotSchema = z.object({
  targetType: z.enum([
    "file",
    "module",
    "endpoint",
    "component",
    "branch",
    "conflict",
    "seam",
    "agent_run",
    "pull_request",
    "decision",
    "route",
    "todo",
    "mock_real_item",
    "safe_to_touch_item",
    "rationale_trace"
  ]),
  targetRef: z.string().min(1).max(1000),
  taskPrompt: z.string().max(4000).optional(),
  audience: z.enum(["human", "Claude", "Codex", "Cursor", "generic_agent"]).optional().default("generic_agent"),
  detailLevel: z.enum(["compact", "normal", "detailed"]).optional().default("normal"),
  branchProfile: z.string().max(200).optional(),
  includeRelatedEvidence: z.boolean().optional().default(true),
  clientSafe: z.boolean().optional().default(false)
});
