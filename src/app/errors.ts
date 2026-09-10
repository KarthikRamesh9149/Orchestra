import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function toAppError(error: unknown) {
  if (error instanceof AppError) {
    return error;
  }

  // Use duck-typing in addition to instanceof to handle module duplication.
  if (error instanceof ZodError || (error instanceof Error && (error as { issues?: unknown }).issues !== undefined)) {
    const zodErr = error as ZodError;
    return new AppError(400, "Validation error", "validation_error", typeof zodErr.flatten === "function" ? zodErr.flatten() : undefined);
  }

  if (error && typeof error === "object") {
    const prismaError = error as { code?: unknown; meta?: { target?: unknown } };
    if (prismaError.code === "P2002") {
      const target = Array.isArray(prismaError.meta?.target)
        ? prismaError.meta.target
            .filter((field): field is string => typeof field === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(field))
            .slice(0, 12)
        : [];
      return new AppError(409, "A record with those unique fields already exists", "unique_constraint_conflict", {
        fields: target
      });
    }
    if (prismaError.code === "P2003") {
      return new AppError(409, "This operation conflicts with a related record", "foreign_key_conflict");
    }
    if (prismaError.code === "P2025") {
      return new AppError(404, "The requested record was not found", "resource_not_found");
    }
  }

  if (error instanceof Error) {
    const maybeHttpError = error as Error & { statusCode?: number; code?: string; details?: unknown };
    if (maybeHttpError.code === "FST_CSRF_MISSING_SECRET" || maybeHttpError.code === "FST_CSRF_INVALID_TOKEN") {
      return new AppError(403, "Invalid or missing CSRF token", "csrf_invalid");
    }
    if (typeof maybeHttpError.statusCode === "number" && maybeHttpError.statusCode >= 400 && maybeHttpError.statusCode < 600) {
      return new AppError(maybeHttpError.statusCode, maybeHttpError.message, maybeHttpError.code ?? "http_error", maybeHttpError.details);
    }
  }

  return new AppError(500, "Internal server error", "internal_error");
}
