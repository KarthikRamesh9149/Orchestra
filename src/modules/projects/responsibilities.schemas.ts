import { z } from "zod";

export const responsibilityAreaSchema = z.enum([
  "frontend",
  "backend",
  "api",
  "ai",
  "design",
  "qa",
  "docs",
  "devops",
  "product",
  "other"
]);

export const responsibilityStatusSchema = z.enum(["open", "in_progress", "done", "blocked"]);
export const responsibilitySourceSchema = z.enum(["manual", "socrates"]);

export const responsibilityParamsSchema = z.object({
  projectId: z.string().uuid(),
  responsibilityId: z.string().uuid()
});

export const projectResponsibilitiesParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const listResponsibilitiesQuerySchema = z.object({
  status: responsibilityStatusSchema.optional(),
  area: responsibilityAreaSchema.optional(),
  memberId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

export const createResponsibilitySchema = z
  .object({
    memberId: z.string().uuid().optional().nullable(),
    assigneeName: z.string().trim().min(1).max(120).optional().nullable(),
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().min(1).max(2000).optional().nullable(),
    area: responsibilityAreaSchema,
    status: responsibilityStatusSchema.default("open"),
    source: responsibilitySourceSchema.default("manual")
  })
  .superRefine((value, context) => {
    if (!value.memberId && !value.assigneeName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["memberId"],
        message: "Provide either memberId or assigneeName"
      });
    }
  });

export const updateResponsibilitySchema = z
  .object({
    memberId: z.string().uuid().optional().nullable(),
    assigneeName: z.string().trim().min(1).max(120).optional().nullable(),
    title: z.string().trim().min(2).max(200).optional(),
    description: z.string().trim().min(1).max(2000).optional().nullable(),
    area: responsibilityAreaSchema.optional(),
    status: responsibilityStatusSchema.optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one responsibility field must be provided"
  });

export type ListResponsibilitiesQuery = z.infer<typeof listResponsibilitiesQuerySchema>;
export type CreateResponsibilityInput = z.infer<typeof createResponsibilitySchema>;
export type UpdateResponsibilityInput = z.infer<typeof updateResponsibilitySchema>;
