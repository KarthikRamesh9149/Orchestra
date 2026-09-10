import { z } from "zod";

const unsafeTextPattern = /<\s*script\b|javascript\s*:|data\s*:|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|DATABASE_URL|JWT_ACCESS_SECRET|JWT_REFRESH_SECRET)\s*=/i;
const safeText = (label: string, min: number, max: number) => z.string().trim().min(min).max(max).refine((value) => !unsafeTextPattern.test(value), { message: `${label} contains unsafe content` });

export const deliveryProjectParamsSchema = z.object({ projectId: z.string().uuid() });
export const deliveryItemParamsSchema = deliveryProjectParamsSchema.extend({ itemId: z.string().trim().min(5).max(320) });
export const deliveryRunParamsSchema = deliveryProjectParamsSchema.extend({ runId: z.string().uuid() });
export const deliveryOverviewQuerySchema = z.object({ refresh: z.coerce.boolean().default(false) });

export const agentPreflightBodySchema = z.object({
  taskPrompt: safeText("task prompt", 4, 6000),
  proposalId: z.string().uuid().optional(),
  targetAgent: z.enum(["codex", "claude", "cursor", "github_agent", "other"]).default("codex"),
  budgetPreset: z.enum(["compact", "normal", "detailed"]).default("normal")
});

export type AgentPreflightInput = z.infer<typeof agentPreflightBodySchema>;
