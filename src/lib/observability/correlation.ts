import { randomUUID } from "node:crypto";

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:|-]{0,127}$/;

export function normalizeCorrelationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return CORRELATION_ID_PATTERN.test(candidate) ? candidate : null;
}

export function resolveRequestId(value: unknown): string {
  return normalizeCorrelationId(value) ?? randomUUID();
}
