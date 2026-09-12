import {isDesktop,isSharedDesktop,desktopBootstrap} from '../desktop';
export function resolveApiBaseUrl(input: { production: boolean; configuredUrl?: string }) {
  const configuredUrl = input.configuredUrl?.trim();
  // Hosted browsers use the beta-web reverse proxy so session and CSRF cookies
  // are first-party. This is required for Safari's third-party-cookie policy.
  if (input.production) return "";
  return configuredUrl || "http://localhost:3000";
}

export const API_BASE_URL = resolveApiBaseUrl({
  production: import.meta.env.PROD,
  configuredUrl: import.meta.env.VITE_API_URL
});

export type ApiErrorPayload = {
  code: string;
  message: string;
  details?: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly retryAfter: string | null;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    retryAfter?: string | null;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
    this.retryAfter = input.retryAfter ?? null;
  }
}

export type UploadProgress = {
  loaded: number;
  total: number | null;
  percent: number | null;
  phase: "uploading" | "processing";
};

export type ApiUploadOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
  operationId: string;
};

let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;
let refreshRequest: Promise<boolean> | null = null;
let bootstrapRequest: Promise<unknown> | null = null;
let sessionEpoch = 0;
let sessionLockTail: Promise<unknown> = Promise.resolve();

async function withSessionRefreshLock<T>(run: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) return await navigator.locks.request("orchestra-session-refresh", run);
  const pending = sessionLockTail.then(run, run);
  sessionLockTail = pending.catch(() => {});
  return pending;
}
const GET_CACHE_TTL_MS = 20_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_ABSOLUTE_TIMEOUT_MS = 5 * 60_000;
const UPLOAD_INACTIVITY_TIMEOUT_MS = 30_000;
const DOWNLOAD_ABSOLUTE_TIMEOUT_MS = 5 * 60_000;
const readCache = new Map<string, { expiresAt: number; value: unknown }>();
const readRequests = new Map<string, Promise<unknown>>();
let readCacheGeneration = 0;

export function clearApiReadCache() {
  readCacheGeneration += 1;
  readCache.clear();
  readRequests.clear();
}

export function resetApiSession() {
  sessionEpoch++;
  bootstrapRequest = null;
  csrfToken = null;
  csrfRequest = null;
  refreshRequest = null;
  clearApiReadCache();
}

function isRouteReadCacheable(path: string) {
  // Shared authorization must be current. No cross-request offline read cache.
  if (isSharedDesktop()) return false;
  if (new URLSearchParams(path.split("?")[1]).get("refresh") === "true") return false;
  return [
    /^\/v1\/projects\/[^/]+\/mission-control(?:\?|$)/,
    /^\/v1\/projects\/[^/]+\/documents$/,
    /^\/v1\/projects\/[^/]+\/connectors(?:\/readiness)?$/,
    /^\/v1\/projects\/[^/]+\/threads(?:\?|$)/,
    /^\/v1\/projects\/[^/]+\/integrations\/status$/,
    /^\/v1\/projects\/[^/]+\/(?:settings|members|join-codes)$/,
    /^\/v1\/projects\/[^/]+\/truth-inbox(?:\?|$)/,
    /^\/v1\/projects\/[^/]+\/truth-inbox\/[^/]+\/packet$/,
    /^\/v1\/projects\/[^/]+\/delivery(?:\?|$)/,
    /^\/v1\/projects\/[^/]+\/delivery\/traces\/[^/]+$/,
    /^\/v1\/me\/(?:profile|sessions|linked-accounts|appearance-preference)$/,
  ].some((pattern) => pattern.test(path));
}

function requestHeaders(init?: RequestInit) {
  const headers: Record<string, string> = {};
  if (!(init?.body instanceof FormData)) headers["Content-Type"] = "application/json";
  for (const [key, value] of Object.entries(init?.headers ?? {})) {
    if (typeof value === "string") headers[key] = value;
  }
  return headers;
}

async function parsePayload(response: Response) {
  const payload = await response.json().catch((cause) => {
    if (cause?.name === "TimeoutError" || cause?.name === "AbortError") throw cause;
    return null;
  });
  if (response.ok && (!payload || typeof payload !== "object" ||
      !("data" in payload) && !payload.error)) {
    throw new ApiError({ status: response.status, code: "invalid_response", message: "The server returned an incomplete response. Please retry." });
  }
  return payload as {
    data?: unknown;
    error?: ApiErrorPayload | null;
  } | null;
}

// Applies to response bodies too; SSE uses its separate inactivity contract.
function boundedSignal(signal?: AbortSignal | null, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const deadline = AbortSignal.timeout(timeoutMs);
  return { signal: signal ? AbortSignal.any([signal, deadline]) : deadline, deadline };
}

function requestFailure(cause: unknown, input: { signal?: AbortSignal | null; deadline?: AbortSignal | null }) {
  if (cause instanceof ApiError) return cause;
  if (input.signal?.aborted) {
    return new ApiError({ status: 0, code: "cancelled", message: "Request cancelled by the user." });
  }
  if (input.deadline?.aborted || (cause instanceof Error && cause.name === "TimeoutError")) {
    return new ApiError({ status: 0, code: "timeout", message: "The request took too long. Please try again.", details: { cause: cause instanceof Error ? cause.message : undefined } });
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return new ApiError({ status: 0, code: "offline", message: "You appear to be offline. Reconnect and try again." });
  }
  return new ApiError({
    status: 0,
    code: "network_error",
    message: "The Orchestra API could not be reached. Check your connection and try again.",
    details: cause instanceof Error ? { cause: cause.message } : undefined
  });
}

function absoluteTimeoutFailure(signal?: AbortSignal | null) {
  const deadline = AbortSignal.abort(new DOMException("Request deadline elapsed", "TimeoutError"));
  return requestFailure(deadline.reason, { signal, deadline });
}

// Observing an abort must not cancel the shared refresh promise: other requests
// may still be waiting for that token rotation. It only ends this caller's wait.
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal, input: { signal?: AbortSignal | null; deadline?: AbortSignal | null }): Promise<T> {
  if (signal.aborted) return Promise.reject(requestFailure(signal.reason, input));
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(requestFailure(signal.reason, input));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([promise, aborted]).finally(() => {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  });
}

function errorFrom(response: Response, payload: Awaited<ReturnType<typeof parsePayload>>) {
  const backend = payload?.error;
  return new ApiError({
    status: response.status,
    code: backend?.code ?? (response.status === 0 ? "network_error" : "http_error"),
    message: backend?.message ?? `Request failed: ${response.status}`,
    details: backend?.details,
    retryAfter: response.headers.get("retry-after")
  });
}

function responseFromUpload(xhr: XMLHttpRequest) {
  const headers = new Headers();
  for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
    const separator = line.indexOf(":");
    if (separator > 0) headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return new Response(xhr.responseText, { status: xhr.status, statusText: xhr.statusText, headers });
}

/**
 * Multipart uses XMLHttpRequest solely because browser Fetch does not expose
 * upload progress. Only an HTTP 401 gets one automatic retry: that response
 * proves the server rejected the request before accepting its operation id.
 * Ambiguous failures remain caller-reconciled with the same operation id.
 */
export async function apiUploadJson<T>(path: string, body: FormData, options: ApiUploadOptions): Promise<T> {
  return executeApiUpload<T>(path, body, options, true, Date.now() + UPLOAD_ABSOLUTE_TIMEOUT_MS);
}

async function executeApiUpload<T>(path: string, body: FormData, options: ApiUploadOptions, retryAfterRefresh: boolean, deadlineAtMs: number): Promise<T> {
  if (options.signal?.aborted) throw requestFailure(options.signal.reason, { signal: options.signal });
  const initialRemainingMs = deadlineAtMs - Date.now();
  if (initialRemainingMs <= 0) throw absoluteTimeoutFailure(options.signal);

  // Cold CSRF bootstrap is shared, but this upload cannot outlive its own
  // caller/deadline while another request continues to populate that cache.
  const csrfBudget = boundedSignal(options.signal, initialRemainingMs);
  const csrfToken = await raceAbort(ensureCsrfToken(), csrfBudget.signal, { signal: options.signal, deadline: csrfBudget.deadline });
  if (options.signal?.aborted) throw requestFailure(options.signal.reason, { signal: options.signal });
  const attemptRemainingMs = deadlineAtMs - Date.now();
  if (attemptRemainingMs <= 0) throw absoluteTimeoutFailure(options.signal);
  try {
    return await uploadWithCsrfToken<T>(path, body, options, csrfToken, attemptRemainingMs);
  } catch (error) {
    // Do not retry timeouts, disconnects, aborts, or server errors: their
    // acceptance state is ambiguous and must be reconciled by operation id.
    if (!(error instanceof ApiError) || error.status !== 401 || !retryAfterRefresh) throw error;
    if (options.signal?.aborted) throw requestFailure(options.signal.reason, { signal: options.signal });
    const refreshBudget = boundedSignal(options.signal, Math.max(0, deadlineAtMs - Date.now()));
    const refreshed = await raceAbort(refreshAccessToken(), refreshBudget.signal, { signal: options.signal, deadline: refreshBudget.deadline });
    if (!refreshed) throw error;
    if (options.signal?.aborted) throw requestFailure(options.signal.reason, { signal: options.signal });
    return executeApiUpload<T>(path, body, options, false, deadlineAtMs);
  }
}

function uploadWithCsrfToken<T>(path: string, body: FormData, options: ApiUploadOptions, csrfToken: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
    let abortError: ApiError | null = null;

    const cleanup = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      options.signal?.removeEventListener("abort", onCallerAbort);
    };
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };
    const resetInactivity = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        abortError = new ApiError({
          status: 0,
          code: "timeout",
          message: "The upload stopped making progress. Check your connection and try again with the same upload operation.",
          details: { operationId: options.operationId, kind: "upload_inactivity" }
        });
        xhr.abort();
      }, UPLOAD_INACTIVITY_TIMEOUT_MS);
    };
    const onCallerAbort = () => {
      abortError = requestFailure(options.signal?.reason, { signal: options.signal });
      xhr.abort();
    };

    xhr.open("POST", `${API_BASE_URL}${path}`, true);
    xhr.withCredentials = true;
    xhr.timeout = timeoutMs;
    xhr.setRequestHeader("X-CSRF-Token", csrfToken);
    xhr.setRequestHeader("X-Idempotency-Key", options.operationId);
    xhr.upload.onprogress = (event) => {
      const total = event.lengthComputable ? event.total : null;
      options.onProgress?.({
        loaded: event.loaded,
        total,
        percent: total && total > 0 ? Math.round((event.loaded / total) * 100) : null,
        phase: "uploading"
      });
      resetInactivity();
    };
    xhr.upload.onload = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      options.onProgress?.({ loaded: 0, total: null, percent: null, phase: "processing" });
    };
    xhr.onload = async () => {
      try {
        const response = responseFromUpload(xhr);
        const payload = await parsePayload(response);
        if (!response.ok || payload?.error) throw errorFrom(response, payload);
        settle(() => resolve(payload?.data as T));
      } catch (cause) {
        const error = cause instanceof ApiError ? cause : requestFailure(cause, { signal: options.signal });
        settle(() => reject(error));
      }
    };
    xhr.onerror = () => settle(() => reject(requestFailure(new Error("Upload transport failed"), { signal: options.signal })));
    xhr.ontimeout = () => settle(() => reject(new ApiError({
      status: 0,
      code: "timeout",
      message: "The upload took too long. Check your connection and try again with the same upload operation.",
      details: { operationId: options.operationId, kind: "upload_absolute" }
    })));
    xhr.onabort = () => settle(() => reject(abortError ?? requestFailure(new DOMException("Upload aborted", "AbortError"), { signal: options.signal })));
    options.signal?.addEventListener("abort", onCallerAbort, { once: true });
    resetInactivity();
    xhr.send(body);
  });
}

export async function rawJson<T>(path: string, init?: RequestInit): Promise<T> {
  const request = boundedSignal(init?.signal);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: request.signal,
      credentials: "include",
      headers: requestHeaders(init)
    });
  } catch (cause) {
    throw requestFailure(cause, { signal: init?.signal, deadline: request.deadline });
  }
  let payload: Awaited<ReturnType<typeof parsePayload>>;
  try { payload = await parsePayload(response); }
  catch (cause) { throw requestFailure(cause, { signal: init?.signal, deadline: request.deadline }); }
  if (!response.ok || payload?.error) throw errorFrom(response, payload);
  return payload?.data as T;
}

export async function ensureCsrfToken() {
  if (csrfToken) return csrfToken;
  if (!csrfRequest) {
    csrfRequest = rawJson<{ csrfToken: string }>("/v1/auth/csrf")
      .then((payload) => {
        csrfToken = payload.csrfToken;
        return payload.csrfToken;
      })
      .finally(() => {
        csrfRequest = null;
      });
  }
  return csrfRequest;
}

export function bootstrapBrowserSession<T>(): Promise<T> {
  if(isDesktop())return desktopBootstrap<T>();
  if (!bootstrapRequest) {
    const epoch = sessionEpoch;
    const assertCurrent = () => {
      if (epoch !== sessionEpoch) throw new ApiError({ status: 401, code: "session_changed", message: "Session changed. Please sign in again." });
    };
    const pending = withSessionRefreshLock(async () => {
      assertCurrent();
      const request = async () => {
        const token = await ensureCsrfToken();
        assertCurrent();
        return rawJson<T>("/v1/auth/bootstrap", { method: "POST", headers: { "X-CSRF-Token": token }, body: JSON.stringify({ sessionMode: "browser" }) });
      };
      let result: T;
      try { result = await request(); }
      catch (error) {
        assertCurrent();
        if (!(error instanceof ApiError) || error.code !== "csrf_invalid" || error.status !== 403) throw error;
        csrfToken = null;
        result = await request();
      }
      assertCurrent();
      return result;
    }).catch(error => {
      assertCurrent();
      throw error;
    }).finally(() => { if (bootstrapRequest === pending) bootstrapRequest = null; });
    bootstrapRequest = pending;
  }
  return bootstrapRequest as Promise<T>;
}

export async function refreshAccessToken() {
  // A page routinely starts several reads together. When the access cookie has
  // expired they all receive 401 at once, but refresh tokens are single-use.
  // Coalesce that burst into one rotation so sibling requests retry with the
  // same fresh cookie instead of triggering replay protection and revoking the
  // browser session.
  if (!refreshRequest) {
    refreshRequest = (async () => {
      const rotate = async () => {
        // Another tab may have refreshed while this tab waited for the lock.
        if (typeof navigator !== "undefined" && navigator.locks) {
          try { await rawJson("/v1/auth/me"); return true; }
          catch (error) { if (!(error instanceof ApiError) || error.status !== 401) throw error; }
        }
        try {
        const token = await ensureCsrfToken();
        await rawJson<{ refreshed: true }>("/v1/auth/refresh", {
          method: "POST",
          headers: { "X-CSRF-Token": token }
        });
        return true;
        } catch (error) {
          if (error instanceof ApiError && [401, 403].includes(error.status)) return false;
          throw error;
        }
      };
      return withSessionRefreshLock(rotate);
    })().finally(() => {
      refreshRequest = null;
    });
  }
  return refreshRequest;
}

async function executeApiJson<T>(path: string, init?: RequestInit, retry = true, deadlineAtMs = Date.now() + DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
  const headers = requestHeaders(init);
  const method = (init?.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers["X-CSRF-Token"] = await ensureCsrfToken();
  }
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs <= 0) throw absoluteTimeoutFailure(init?.signal);
  const request = boundedSignal(init?.signal, remainingMs);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: request.signal,
      credentials: "include",
      headers
    });
  } catch (cause) {
    throw requestFailure(cause, { signal: init?.signal, deadline: request.deadline });
  }
  if (response.status === 401 && retry) {
    const refreshed = await raceAbort(refreshAccessToken(), request.signal, { signal: init?.signal, deadline: request.deadline });
    if (refreshed) return executeApiJson<T>(path, init, false, deadlineAtMs);
  }
  let payload: Awaited<ReturnType<typeof parsePayload>>;
  try { payload = await parsePayload(response); }
  catch (cause) { throw requestFailure(cause, { signal: init?.signal, deadline: request.deadline }); }
  if (!response.ok || payload?.error) throw errorFrom(response, payload);
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) clearApiReadCache();
  return payload?.data as T;
}

export async function apiJson<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  // A completed, scoped cache entry is safe for a mounted reader to consume.
  // In-flight requests are never shared with a signal-bearing reader: its
  // lifecycle must not be able to cancel another consumer's network request.
  const cacheable = method === "GET" && init?.cache !== "no-store" &&
    (init?.cache === "force-cache" || isRouteReadCacheable(path));
  if (!cacheable) return executeApiJson<T>(path, init, retry);

  const cacheHeaders = Object.entries(requestHeaders(init)).sort(([left], [right]) => left.localeCompare(right));
  const cacheKey = `${API_BASE_URL}${path}:${JSON.stringify(cacheHeaders)}`;
  const cached = readCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (init?.signal?.aborted) throw requestFailure(init.signal.reason, { signal: init.signal });
    return cached.value as T;
  }
  if (cached) readCache.delete(cacheKey);

  const pending = init?.signal ? undefined : readRequests.get(cacheKey);
  if (pending) return pending as Promise<T>;

  const generation = readCacheGeneration;
  const request = executeApiJson<T>(path, init, retry)
    .then((value) => {
      // A mutation may finish while this GET is still in flight. Never let the
      // older response repopulate a cache that the mutation already cleared.
      if (generation === readCacheGeneration) {
        readCache.set(cacheKey, { value, expiresAt: Date.now() + GET_CACHE_TTL_MS });
      }
      return value;
    })
    .finally(() => {
      // Clearing the cache allows a newer request for the same key to start.
      // The older request must not remove that newer in-flight entry.
      if (readRequests.get(cacheKey) === request) readRequests.delete(cacheKey);
    });
  readRequests.set(cacheKey, request);
  return request;
}

export async function apiBlob(path: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}, retry = true): Promise<{ blob: Blob; filename: string | null }> {
  return executeApiBlob(path, options, retry, Date.now() + (options.timeoutMs ?? DOWNLOAD_ABSOLUTE_TIMEOUT_MS));
}

async function executeApiBlob(path: string, options: { signal?: AbortSignal; timeoutMs?: number }, retry: boolean, deadlineAtMs: number): Promise<{ blob: Blob; filename: string | null }> {
  // Original evidence and generated reports can legitimately take longer than
  // an API JSON read. The bounded signal still covers both response headers
  // and body consumption, and callers can independently cancel it.
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs <= 0) {
    throw absoluteTimeoutFailure(options.signal);
  }
  const request = boundedSignal(options.signal, remainingMs);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include", signal: request.signal });
  } catch (cause) {
    throw requestFailure(cause, { signal: options.signal, deadline: request.deadline });
  }
  if (response.status === 401 && retry && (await raceAbort(refreshAccessToken(), request.signal, { signal: options.signal, deadline: request.deadline }))) {
    // A refresh may consume much of the transfer budget. Preserve the original
    // deadline rather than granting a new five-minute download window.
    return executeApiBlob(path, options, false, deadlineAtMs);
  }
  if (!response.ok) {
    let payload: Awaited<ReturnType<typeof parsePayload>>;
    try { payload = await parsePayload(response); }
    catch (cause) { throw requestFailure(cause, { signal: options.signal, deadline: request.deadline }); }
    throw errorFrom(response, payload);
  }
  const disposition = response.headers.get("content-disposition");
  const filename = disposition?.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
  try { return { blob: await response.blob(), filename }; }
  catch (cause) { throw requestFailure(cause, { signal: options.signal, deadline: request.deadline }); }
}
