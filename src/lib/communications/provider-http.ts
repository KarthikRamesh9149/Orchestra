import { AppError } from "../../app/errors.js";

export function parseRetryAfterMs(retryAfter: string | null | undefined) {
  if (!retryAfter) {
    return null;
  }

  const numericSeconds = Number(retryAfter);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return numericSeconds * 1000;
  }

  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) {
    return Math.max(dateMs - Date.now(), 0);
  }

  return null;
}

export function providerRateLimitError(provider: string, operation: string, retryAfterHeader?: string | null) {
  return new AppError(
    429,
    `${provider} rate limited ${operation}`,
    "communication_provider_rate_limited",
    {
      provider,
      operation,
      retryAfterMs: parseRetryAfterMs(retryAfterHeader)
    }
  );
}

export function providerApiError(
  provider: string,
  operation: string,
  _message: string,
  statusCode = 502,
  details?: Record<string, unknown>
) {
  return new AppError(statusCode, safeProviderMessage(provider, statusCode), `${provider}_api_error`, {
    provider,
    operation: safeOperationLabel(operation),
    statusCode,
    ...(details ?? {})
  });
}

function safeProviderMessage(provider: string, statusCode: number) {
  const label = provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ") || "Provider";

  if (statusCode === 401 || statusCode === 403) {
    return `${label} authorization failed`;
  }
  if (statusCode === 404 || statusCode === 409) {
    return `${label} resource is unavailable`;
  }
  if (statusCode === 429) {
    return `${label} rate limit reached`;
  }
  return `${label} API request failed`;
}

function safeOperationLabel(operation: string) {
  try {
    const url = new URL(operation);
    return `${url.hostname}${url.pathname}`.slice(0, 160);
  } catch {
    return operation.replace(/[?#].*$/, "").slice(0, 160);
  }
}
