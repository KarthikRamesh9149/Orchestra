import { z } from "zod";

const uuidSchema = z.string().uuid();
const isoDateTimeSchema = z.string().datetime({ offset: true });
const monthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .refine((value) => {
    const [, monthString] = value.split("-");
    const month = Number(monthString);
    return month >= 1 && month <= 12;
  }, "month must be between 01 and 12");
const currencySchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code"));
const nonNegativeAmountSchema = z
  .number()
  .finite()
  .min(0)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, {
    message: "Amount must have at most 2 decimal places"
  });

function requireAtLeastOneField<T extends z.ZodTypeAny>(schema: T) {
  return schema.refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided"
  });
}

function validateRange(
  value: { from?: string; to?: string },
  ctx: z.RefinementCtx,
  options: { maxDays: number }
) {
  if (!value.from || !value.to) {
    return;
  }

  const from = new Date(value.from);
  const to = new Date(value.to);
  if (to.getTime() < from.getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "to must be after from",
      path: ["to"]
    });
    return;
  }

  const maxRangeMs = options.maxDays * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > maxRangeMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Range cannot exceed ${options.maxDays} days`,
      path: ["to"]
    });
  }
}

export const projectParamsSchema = z.object({
  projectId: uuidSchema
});

export const calendarOAuthCallbackSchema = z.object({
  code: z.string().trim().min(1).max(4096).optional(),
  state: z.string().trim().min(1).max(8192).optional(),
  error: z.string().trim().min(1).max(512).optional()
});

export const meetingParamsSchema = projectParamsSchema.extend({
  meetingId: uuidSchema
});

export const deadlineParamsSchema = projectParamsSchema.extend({
  deadlineId: uuidSchema
});

export const subscriptionParamsSchema = projectParamsSchema.extend({
  subscriptionId: uuidSchema
});

export const projectOpsListQuerySchema = z
  .object({
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional()
  })
  .superRefine((value, ctx) => {
    if ((value.from && !value.to) || (!value.from && value.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "from and to must be provided together",
        path: ["from"]
      });
      return;
    }

    validateRange(value, ctx, { maxDays: 93 });
  });

export const calendarQuerySchema = z
  .object({
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    month: monthSchema.optional(),
    projectId: uuidSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (value.month && (value.from || value.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "month cannot be combined with from/to",
        path: ["month"]
      });
      return;
    }
    if ((value.from && !value.to) || (!value.from && value.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "from and to must be provided together",
        path: ["from"]
      });
      return;
    }

    validateRange(value, ctx, { maxDays: 93 });
  });

export const googleCalendarSelectionSchema = z.object({
  calendarIds: z
    .array(z.string().trim().min(1).max(500))
    .min(1, "Select at least one Google Calendar")
    .max(25, "Select no more than 25 Google Calendars")
});

export const createMeetingSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().trim().max(5000).nullable().optional(),
    eventType: z.enum(["standup", "review", "client", "meeting", "milestone", "demo", "other"]),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema.nullable().optional(),
    timezone: z.string().trim().min(1).max(100).nullable().optional(),
    linkedRefType: z.string().trim().max(100).nullable().optional(),
    linkedRefId: z.string().trim().max(255).nullable().optional(),
    isAllDay: z.boolean().optional().default(false)
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

export const updateMeetingSchema = requireAtLeastOneField(
  z
    .object({
      title: z.string().trim().min(1).optional(),
      description: z.string().trim().max(5000).nullable().optional(),
      eventType: z.enum(["standup", "review", "client", "meeting", "milestone", "demo", "other"]).optional(),
      startsAt: isoDateTimeSchema.optional(),
      endsAt: isoDateTimeSchema.nullable().optional(),
      timezone: z.string().trim().min(1).max(100).nullable().optional(),
      linkedRefType: z.string().trim().max(100).nullable().optional(),
      linkedRefId: z.string().trim().max(255).nullable().optional(),
      isAllDay: z.boolean().optional()
    })
    .superRefine((value, ctx) => {
      if (value.startsAt && value.endsAt && new Date(value.endsAt).getTime() < new Date(value.startsAt).getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "endsAt must be after startsAt",
          path: ["endsAt"]
        });
      }
    })
);

export const createDeadlineSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().max(5000).nullable().optional(),
  dueAt: isoDateTimeSchema,
  status: z.enum(["on_track", "at_risk", "critical", "completed"]),
  linkedRefType: z.string().trim().max(100).nullable().optional(),
  linkedRefId: z.string().trim().max(255).nullable().optional()
});

export const updateDeadlineSchema = requireAtLeastOneField(
  z.object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    dueAt: isoDateTimeSchema.optional(),
    status: z.enum(["on_track", "at_risk", "critical", "completed"]).optional(),
    linkedRefType: z.string().trim().max(100).nullable().optional(),
    linkedRefId: z.string().trim().max(255).nullable().optional()
  })
);

export const updateFinancialSummarySchema = requireAtLeastOneField(
  z.object({
    currency: currencySchema.optional(),
    budgetAmount: nonNegativeAmountSchema.nullable().optional(),
    spentAmount: nonNegativeAmountSchema.optional(),
    notes: z.string().trim().max(5000).nullable().optional()
  })
);

export const createSubscriptionSchema = z.object({
  name: z.string().trim().min(1),
  category: z.string().trim().min(1),
  cost: nonNegativeAmountSchema,
  billingType: z.enum(["monthly", "annual", "per_transaction", "one_time", "usage_based"]),
  status: z.enum(["active", "paused", "cancelled"]),
  provider: z.string().trim().max(255).nullable().optional(),
  externalRef: z.string().trim().max(255).nullable().optional(),
  renewsAt: isoDateTimeSchema.nullable().optional()
});

export const updateSubscriptionSchema = requireAtLeastOneField(createSubscriptionSchema.partial());

// ── Feature 8: Event Series ──────────────────────────────────────────────────

export const seriesParamsSchema = projectParamsSchema.extend({
  seriesId: uuidSchema
});

export const createSeriesSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().trim().max(5000).nullable().optional(),
    eventType: z.enum(["standup", "review", "client", "meeting", "milestone", "demo", "other"]),
    timezone: z.string().trim().min(1).max(100),
    isAllDay: z.boolean().optional(),
    frequency: z.enum(["daily", "weekly", "monthly"]),
    interval: z.number().int().min(1).max(52).optional().default(1),
    byWeekday: z.array(z.string().trim().min(2).max(2)).optional(),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    startDate: isoDateTimeSchema,
    endDate: isoDateTimeSchema.nullable().optional(),
    maxOccurrences: z.number().int().min(1).max(500).nullable().optional()
  })
  .superRefine((value, ctx) => {
    if (value.endDate && new Date(value.endDate).getTime() < new Date(value.startDate).getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "endDate must be after startDate", path: ["endDate"] });
    }
  });

export const updateSeriesSchema = requireAtLeastOneField(
  z.object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    eventType: z.enum(["standup", "review", "client", "meeting", "milestone", "demo", "other"]).optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
    interval: z.number().int().min(1).max(52).optional(),
    byWeekday: z.array(z.string().trim().min(2).max(2)).nullable().optional(),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    endDate: isoDateTimeSchema.nullable().optional(),
    maxOccurrences: z.number().int().min(1).max(500).nullable().optional(),
    status: z.enum(["active", "paused", "ended"]).optional()
  })
);

// ── Feature 8: Calendar Connections ─────────────────────────────────────────

export const calendarProviderParamsSchema = projectParamsSchema.extend({
  provider: z.enum(["google_calendar", "outlook_calendar"])
});

export const connectionParamsSchema = projectParamsSchema.extend({
  connectionId: uuidSchema
});

export const syncRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20)
});

// ── Feature 8: Cost Entries ──────────────────────────────────────────────────

export const costEntryParamsSchema = projectParamsSchema.extend({
  entryId: uuidSchema
});

const costEntryCategorySchema = z.enum([
  "infrastructure",
  "software",
  "contractor",
  "tools",
  "cloud",
  "communication",
  "design",
  "misc"
]);

export const createCostEntrySchema = z.object({
  category: costEntryCategorySchema,
  title: z.string().trim().min(1),
  description: z.string().trim().max(5000).nullable().optional(),
  amount: nonNegativeAmountSchema,
  currency: currencySchema,
  occurredAt: isoDateTimeSchema
});

export const updateCostEntrySchema = requireAtLeastOneField(
  z.object({
    category: costEntryCategorySchema.optional(),
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    amount: nonNegativeAmountSchema.optional(),
    currency: currencySchema.optional(),
    occurredAt: isoDateTimeSchema.optional()
  })
);

export const costEntryListQuerySchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  category: costEntryCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional()
});

// ── Feature 8: Financial Breakdown ──────────────────────────────────────────

export const financialBreakdownQuerySchema = z.object({
  groupBy: z.enum(["month", "category"]).optional().default("month")
});

// ── Feature 8: Renewals ──────────────────────────────────────────────────────

export const renewalsQuerySchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(365).optional().default(30)
});
