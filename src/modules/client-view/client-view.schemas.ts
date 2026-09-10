import { z } from "zod";

// ─── Share config ────────────────────────────────────────────────────────────

export const clientShareConfigSchema = z.object({
  showPreview: z.boolean().default(true),
  showBrain: z.boolean().default(true),
  showGraph: z.boolean().default(true),
  showDocuments: z.boolean().default(true),
  enableSocrates: z.boolean().default(false),
  allowedDocumentIds: z.array(z.string().uuid()).default([]),
  showAcceptedChangeSummaries: z.boolean().default(false),
  showAcceptedDecisionSummaries: z.boolean().default(false),
  showCommunicationEvidence: z.boolean().default(false)
});

export type ClientShareConfig = z.infer<typeof clientShareConfigSchema>;

export const defaultClientShareConfig: ClientShareConfig = clientShareConfigSchema.parse({});

// ─── Manager: create share ───────────────────────────────────────────────────

export const createClientShareBodySchema = z.object({
  name: z.string().min(1).max(200),
  expiresAt: z.string().datetime().optional(),
  config: clientShareConfigSchema.optional()
});

export const updateClientShareBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  config: clientShareConfigSchema.optional()
});

// ─── Manager route params ────────────────────────────────────────────────────

export const managerShareParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const managerShareIdParamsSchema = z.object({
  projectId: z.string().uuid(),
  shareId: z.string().uuid()
});

// ─── Public client route params ──────────────────────────────────────────────

export const clientShareTokenParamSchema = z
  .string()
  .regex(/^cs_[A-Za-z0-9_-]{43}$/, "Invalid client share token format");

export const clientTokenParamsSchema = z.object({
  token: clientShareTokenParamSchema
});

export const clientDocumentParamsSchema = z.object({
  token: clientShareTokenParamSchema,
  documentId: z.string().uuid()
});

export const clientAnchorParamsSchema = z.object({
  token: clientShareTokenParamSchema,
  documentId: z.string().uuid(),
  anchorId: z.string().min(1)
});

export const clientDocumentSearchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

// ─── Client-safe Socrates ────────────────────────────────────────────────────

export const clientSessionParamsSchema = z.object({
  token: clientShareTokenParamSchema,
  sessionId: z.string().uuid()
});

export const clientCreateSessionBodySchema = z.object({
  pageContext: z.literal("client_view").optional()
});

export const clientStreamBodySchema = z.object({
  content: z.string().min(1).max(4000)
});
