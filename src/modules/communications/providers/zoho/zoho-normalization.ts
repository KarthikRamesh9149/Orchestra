import type { NormalizedParticipant } from "../../../../lib/communications/provider-normalized-types.js";
import { htmlToText } from "../../../../lib/communications/html-to-text.js";
import { safeZohoValue } from "./zoho-redaction.js";

const SECRET_KEY_PATTERN = /token|secret|password|credential|authorization|api[_-]?key/i;

export function zohoString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : value == null ? null : String(value);
}

export function zohoNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function zohoBool(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function zohoStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => zohoString(item)).filter((item): item is string => Boolean(item));
  }
  const asString = zohoString(value);
  if (!asString) return [];
  return asString
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function zohoBound(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n[truncated]` : value;
}

export function zohoText(value: unknown, maxLength = 20_000) {
  const asString = zohoString(value);
  if (!asString) return "";
  return zohoBound(htmlToText(asString), maxLength);
}

export function zohoDate(value: unknown) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const numeric = zohoNumber(value);
  if (numeric != null) {
    const timestamp = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function zohoIso(value: unknown) {
  return zohoDate(value)?.toISOString() ?? null;
}

export function zohoArrayFromPayload(payload: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const parts = key.split(".");
    let current: unknown = payload;
    for (const part of parts) {
      current = current && typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined;
    }
    if (Array.isArray(current)) return current;
  }
  return [];
}

export function zohoExtractEmail(value: unknown) {
  const raw = zohoString(value);
  if (!raw) return null;
  const bracketMatch = raw.match(/<([^>]+)>/);
  const candidate = (bracketMatch?.[1] ?? raw).trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(candidate) ? candidate : null;
}

export function zohoParticipant(input: {
  label?: unknown;
  email?: unknown;
  id?: unknown;
  fallback?: string;
}): NormalizedParticipant | null {
  const email = zohoExtractEmail(input.email ?? input.label);
  const label = zohoString(input.label) ?? email ?? input.fallback ?? zohoString(input.id);
  if (!label) return null;
  const externalRef = zohoString(input.id) ?? email ?? label;
  return {
    label,
    externalRef,
    email
  };
}

export function zohoUniqueParticipants(inputs: Array<NormalizedParticipant | null | undefined>) {
  const byKey = new Map<string, NormalizedParticipant>();
  for (const input of inputs) {
    if (!input) continue;
    byKey.set(input.externalRef ?? input.email ?? input.label, input);
  }
  return [...byKey.values()];
}

export function zohoSafeMetadata(value: unknown): Record<string, unknown> {
  const safe = safeZohoValue(value);
  return safe && typeof safe === "object" && !Array.isArray(safe) ? (safe as Record<string, unknown>) : {};
}

export function zohoAllowlistedRecord(record: Record<string, unknown>, fields: string[]) {
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    if (SECRET_KEY_PATTERN.test(field)) continue;
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      output[field] = safeZohoValue(record[field]);
    }
  }
  return output;
}
