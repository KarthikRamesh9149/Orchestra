import { z } from "zod";

export const profilePatchSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120).optional(),
    timezone: z.string().trim().min(1).max(80).nullable().optional(),
    locale: z.string().trim().min(2).max(35).nullable().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one profile field must be provided"
  });

export const notificationPreferencesPatchSchema = z
  .object({
    productUpdates: z.boolean().optional(),
    projectActivity: z.boolean().optional(),
    approvalRequests: z.boolean().optional(),
    slackSyncAlerts: z.boolean().optional(),
    calendarReminders: z.boolean().optional(),
    socratesDigests: z.boolean().optional(),
    securityAlerts: z.literal(true).optional(),
    emailEnabled: z.boolean().optional(),
    inAppEnabled: z.boolean().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one notification preference must be provided"
  });

export const appearancePreferencePatchSchema = z
  .object({
    theme: z.enum(["light", "dark", "auto"])
  })
  .strict();

export const sessionParamsSchema = z.object({
  sessionId: z.string().uuid()
});

export const revokeAllSessionsSchema = z
  .object({
    includeCurrent: z.boolean().optional().default(false)
  })
  .strict()
  .optional();

export const switchWorkspaceSchema = z
  .object({
    projectId: z.string().uuid()
  })
  .strict();
