import { ApiError } from "./client";

export type OperationalFailureState =
  | "disconnected"
  | "forbidden"
  | "degraded"
  | "stale"
  | "failed";

export type OperationalError = {
  code: string;
  message: string;
  status: number | null;
  details?: unknown;
  retryAfter?: string | null;
};

export type OperationalState<T> =
  | { state: "loading" }
  | { state: "empty"; data: T; receivedAt: string }
  | { state: "ready"; data: T; receivedAt: string }
  | { state: OperationalFailureState; error: OperationalError };

export function operationalError(error: unknown): OperationalState<never> {
  if (error instanceof ApiError) {
    const code = error.code.toLowerCase();
    const state: OperationalFailureState = error.status === 0 || code === "network_error"
      ? "disconnected"
      : error.status === 401 || error.status === 403 || code.includes("forbidden") || code.includes("access_denied")
        ? "forbidden"
        : error.status === 502 || error.status === 503 || code.includes("degraded") || code.includes("unavailable")
          ? "degraded"
          : error.status === 409 && code.includes("stale")
            ? "stale"
            : "failed";
    return {
      state,
      error: {
        code: error.code,
        message: error.message,
        status: error.status,
        details: error.details,
        retryAfter: error.retryAfter
      }
    };
  }
  return {
    state: "failed",
    error: {
      code: "unexpected_error",
      message: error instanceof Error ? error.message : "Something went wrong. Try again.",
      status: null
    }
  };
}

export async function loadOperationalState<T>(
  request: () => Promise<T>,
  isEmpty: (data: T) => boolean
): Promise<OperationalState<T>> {
  try {
    const data = await request();
    const receivedAt = new Date().toISOString();
    return isEmpty(data) ? { state: "empty", data, receivedAt } : { state: "ready", data, receivedAt };
  } catch (error) {
    return operationalError(error);
  }
}
