export function sanitizeZohoErrorMessage(value: unknown) {
  const message = typeof value === "string" ? value : value instanceof Error ? value.message : "Zoho API request failed";
  return message
    .replace(/1000\.[A-Za-z0-9._-]+/g, "[redacted-token]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/Zoho-oauthtoken\s+[A-Za-z0-9._-]+/gi, "Zoho-oauthtoken [redacted]")
    .slice(0, 500);
}

export function safeZohoValue(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeZohoValue(item));
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
    if (/token|secret|password|credential|authorization|api[_-]?key/i.test(key)) continue;
    output[key] = safeZohoValue(entry);
  }
  return output;
}
