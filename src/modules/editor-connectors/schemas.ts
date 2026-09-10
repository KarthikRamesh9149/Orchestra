import { z } from "zod";

export const vscodeProjectParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const vscodeCreatePairingBodySchema = z.object({
  label: z.string().trim().min(1).max(80).optional()
});

export const vscodeExchangeBodySchema = z.object({
  pairingCode: z.string().trim().min(8).max(80),
  extensionVersion: z.string().trim().max(80).optional(),
  deviceLabel: z.string().trim().max(120).optional()
});

export const vscodeAskBodySchema = z.object({
  question: z.string().trim().min(1).max(8000),
  selectedText: z.string().max(12000).optional(),
  ideContext: z.string().max(20000).optional()
});
