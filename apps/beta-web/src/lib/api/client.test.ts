import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server";
import { apiBlob, apiJson, clearApiReadCache, resetApiSession, resolveApiBaseUrl } from "./client";

const api = "http://localhost:3000";

describe("API read-through performance cache", () => {
  beforeEach(() => resetApiSession());

  it.each([{}, { meta: null }, { error: null }])("rejects incomplete success envelopes %j", async (body) => {
    server.use(http.get(`${api}/v1/malformed`, () => HttpResponse.json(body)));
    await expect(apiJson("/v1/malformed")).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("[FIX-36] deduplicates concurrent reads and serves an immediate route revisit", async () => {
    const reads = vi.fn();
    server.use(
      http.get(`${api}/v1/performance-probe`, () => {
        reads();
        return HttpResponse.json({ data: { version: 1 }, meta: null, error: null });
      })
    );

    const [first, second] = await Promise.all([
      apiJson<{ version: number }>("/v1/performance-probe", { cache: "force-cache" }),
      apiJson<{ version: number }>("/v1/performance-probe", { cache: "force-cache" }),
    ]);
    const revisit = await apiJson<{ version: number }>("/v1/performance-probe", { cache: "force-cache" });

    expect(first).toEqual({ version: 1 });
    expect(second).toEqual(first);
    expect(revisit).toEqual(first);
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it("[FIX-36] invalidates cached reads after a successful mutation", async () => {
    let version = 1;
    const reads = vi.fn();
    server.use(
      http.get(`${api}/v1/auth/csrf`, () =>
        HttpResponse.json({ data: { csrfToken: "cache-csrf" }, meta: null, error: null })
      ),
      http.get(`${api}/v1/performance-probe`, () => {
        reads();
        return HttpResponse.json({ data: { version }, meta: null, error: null });
      }),
      http.post(`${api}/v1/performance-probe`, () => {
        version += 1;
        return HttpResponse.json({ data: { version }, meta: null, error: null });
      })
    );

    await expect(apiJson<{ version: number }>("/v1/performance-probe", { cache: "force-cache" })).resolves.toEqual({ version: 1 });
    await expect(apiJson<{ version: number }>("/v1/performance-probe", { method: "POST", body: "{}" })).resolves.toEqual({ version: 2 });
    await expect(apiJson<{ version: number }>("/v1/performance-probe", { cache: "force-cache" })).resolves.toEqual({ version: 2 });
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it("does not restore a stale read that finishes after a mutation", async () => {
    let version = 1;
    let releaseFirstRead: (() => void) | undefined;
    const firstReadBlocked = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    const reads = vi.fn();
    server.use(
      http.get(`${api}/v1/auth/csrf`, () =>
        HttpResponse.json({ data: { csrfToken: "race-csrf" }, meta: null, error: null })
      ),
      http.get(`${api}/v1/performance-probe`, async () => {
        reads();
        const responseVersion = version;
        if (reads.mock.calls.length === 1) await firstReadBlocked;
        return HttpResponse.json({ data: { version: responseVersion }, meta: null, error: null });
      }),
      http.post(`${api}/v1/performance-probe`, () => {
        version += 1;
        return HttpResponse.json({ data: { version }, meta: null, error: null });
      })
    );

    const staleRead = apiJson<{ version: number }>("/v1/performance-probe", { cache: "force-cache" });
    await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(1));
    await expect(apiJson<{ version: number }>("/v1/performance-probe", { method: "POST", body: "{}" })).resolves.toEqual({ version: 2 });
    releaseFirstRead?.();
    await expect(staleRead).resolves.toEqual({ version: 1 });

    await expect(apiJson<{ version: number }>("/v1/performance-probe", { cache: "force-cache" })).resolves.toEqual({ version: 2 });
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it("keeps abortable reads isolated from the shared cache", async () => {
    const reads = vi.fn();
    server.use(
      http.get(`${api}/v1/performance-probe`, () => {
        reads();
        return HttpResponse.json({ data: { ok: true }, meta: null, error: null });
      })
    );
    const first = new AbortController();
    const second = new AbortController();
    await Promise.all([
      apiJson("/v1/performance-probe", { signal: first.signal }),
      apiJson("/v1/performance-probe", { signal: second.signal }),
    ]);
    expect(reads).toHaveBeenCalledTimes(2);
    clearApiReadCache();
  });

  it("[R04] serves a completed prefetch to a mounted reader with its own cancellation signal", async () => {
    const reads = vi.fn();
    server.use(
      http.get(`${api}/v1/performance-probe`, () => {
        reads();
        return HttpResponse.json({ data: { version: 1 }, meta: null, error: null });
      })
    );

    await expect(apiJson<{ version: number }>("/v1/performance-probe", { cache: "force-cache" })).resolves.toEqual({ version: 1 });
    const mounted = new AbortController();
    await expect(apiJson<{ version: number }>("/v1/performance-probe", { cache: "force-cache", signal: mounted.signal })).resolves.toEqual({ version: 1 });

    expect(reads).toHaveBeenCalledTimes(1);
  });

  it("[R04] never serves a cached value to an already cancelled observer", async () => {
    server.use(
      http.get(`${api}/v1/performance-probe`, () =>
        HttpResponse.json({ data: { version: 1 }, meta: null, error: null })
      )
    );

    await apiJson<{ version: number }>("/v1/performance-probe", { cache: "force-cache" });
    const mounted = new AbortController();
    mounted.abort();

    await expect(apiJson<{ version: number }>("/v1/performance-probe", { cache: "force-cache", signal: mounted.signal }))
      .rejects.toMatchObject({ code: "cancelled" });
  });

  it("[R04] does not let a mounted reader consume a prefetch invalidated by a mutation", async () => {
    let version = 1;
    const reads = vi.fn();
    server.use(
      http.get(`${api}/v1/auth/csrf`, () =>
        HttpResponse.json({ data: { csrfToken: "invalidate-csrf" }, meta: null, error: null })
      ),
      http.get(`${api}/v1/performance-probe`, () => {
        reads();
        return HttpResponse.json({ data: { version }, meta: null, error: null });
      }),
      http.post(`${api}/v1/performance-probe`, () => {
        version = 2;
        return HttpResponse.json({ data: { version }, meta: null, error: null });
      })
    );

    await apiJson<{ version: number }>("/v1/performance-probe", { cache: "force-cache" });
    await apiJson<{ version: number }>("/v1/performance-probe", { method: "POST", body: "{}" });
    const mounted = new AbortController();

    await expect(apiJson<{ version: number }>("/v1/performance-probe", { cache: "force-cache", signal: mounted.signal })).resolves.toEqual({ version: 2 });
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it("[R04] cancelling one mounted read does not cancel another", async () => {
    let releaseSecond: (() => void) | undefined;
    const secondReady = new Promise<void>((resolve) => { releaseSecond = resolve; });
    let call = 0;
    server.use(
      http.get(`${api}/v1/performance-probe`, async ({ request }) => {
        call += 1;
        if (call === 1) {
          await new Promise<void>((_resolve, reject) => {
            request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
          });
        }
        await secondReady;
        return HttpResponse.json({ data: { version: call }, meta: null, error: null });
      })
    );

    const first = new AbortController();
    const second = new AbortController();
    const firstRequest = apiJson("/v1/performance-probe", { signal: first.signal });
    const secondRequest = apiJson("/v1/performance-probe", { signal: second.signal });
    await vi.waitFor(() => expect(call).toBe(2));
    first.abort();
    releaseSecond?.();

    await expect(firstRequest).rejects.toMatchObject({ code: "cancelled" });
    await expect(secondRequest).resolves.toEqual({ version: 2 });
  });
});

describe("hosted API routing", () => {
  it("uses the first-party web origin in production so Safari can retain session cookies", () => {
    expect(resolveApiBaseUrl({
      production: true,
      configuredUrl: "https://orchestrav2-production.up.railway.app"
    })).toBe("");
  });

  it("keeps the configured direct API available for local development", () => {
    expect(resolveApiBaseUrl({ production: false, configuredUrl: "http://localhost:4000" })).toBe("http://localhost:4000");
    expect(resolveApiBaseUrl({ production: false })).toBe("http://localhost:3000");
  });
});

describe("browser refresh rotation", () => {
  beforeEach(() => resetApiSession());

  it("coalesces simultaneous 401 responses into one refresh-token rotation", async () => {
    let refreshed = false;
    const refreshes = vi.fn();
    const reads = vi.fn();
    server.use(
      http.get(`${api}/v1/auth/csrf`, () =>
        HttpResponse.json({ data: { csrfToken: "refresh-csrf" }, meta: null, error: null })
      ),
      http.post(`${api}/v1/auth/refresh`, async () => {
        refreshes();
        await new Promise((resolve) => setTimeout(resolve, 15));
        refreshed = true;
        return HttpResponse.json({ data: { refreshed: true }, meta: null, error: null });
      }),
      http.get(`${api}/v1/authenticated/:resource`, ({ params }) => {
        reads(params.resource);
        if (!refreshed) {
          return HttpResponse.json(
            { data: null, meta: null, error: { code: "access_expired", message: "Access token expired" } },
            { status: 401 }
          );
        }
        return HttpResponse.json({ data: { resource: params.resource }, meta: null, error: null });
      })
    );

    await expect(Promise.all([
      apiJson<{ resource: string }>("/v1/authenticated/documents"),
      apiJson<{ resource: string }>("/v1/authenticated/connectors")
    ])).resolves.toEqual([{ resource: "documents" }, { resource: "connectors" }]);

    expect(refreshes).toHaveBeenCalledTimes(1);
    expect(reads).toHaveBeenCalledTimes(4);
  });
});

describe("[R03] bounded blob downloads", () => {
  beforeEach(() => resetApiSession());

  it("allows a response body that takes more than 30 seconds to arrive", async () => {
    const originalFetch = globalThis.fetch;
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(new ReadableStream({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(new TextEncoder().encode("large export"));
          controller.close();
        }, 31_000);
      }
    })))));

    try {
      const download = apiBlob("/v1/download-probe");
      await vi.advanceTimersByTimeAsync(31_000);
      const { blob } = await download;
      await expect(blob.text()).resolves.toBe("large export");
    } finally {
      vi.useRealTimers();
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("reports an absolute download-cap expiry as a typed timeout", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })));

    try {
      await expect(apiBlob("/v1/download-probe", { timeoutMs: 1 })).rejects.toMatchObject({ code: "timeout", status: 0 });
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("keeps the original download deadline after a 401 refresh", async () => {
    const originalFetch = globalThis.fetch;
    const requestTimeout = vi.spyOn(AbortSignal, "timeout");
    let downloadAttempts = 0;
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/download-probe")) {
        downloadAttempts += 1;
        return Promise.resolve(new Response(JSON.stringify({ data: null, error: { code: "access_expired", message: "Expired" } }), { status: downloadAttempts === 1 ? 401 : 200 }));
      }
      if (url.endsWith("/v1/auth/csrf")) {
        return new Promise<Response>((resolve) => setTimeout(() => resolve(Response.json({ data: { csrfToken: "csrf" }, meta: null, error: null })), 75));
      }
      if (url.endsWith("/v1/auth/refresh")) return Promise.resolve(Response.json({ data: { refreshed: true }, meta: null, error: null }));
      throw new Error(`Unexpected request: ${url}`);
    }));

    try {
      const download = apiBlob("/v1/download-probe", { timeoutMs: 100 });
      await vi.advanceTimersByTimeAsync(75);
      await vi.waitFor(() => expect(downloadAttempts).toBe(2));
      const uploadBudgetCalls = requestTimeout.mock.calls.map(([timeout]) => Number(timeout)).filter((timeout) => timeout <= 100);
      expect(uploadBudgetCalls).toEqual([100, expect.any(Number)]);
      expect(uploadBudgetCalls[1]).toBeLessThan(100);
      await download;
    } finally {
      requestTimeout.mockRestore();
      vi.useRealTimers();
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("times out during a stalled 401 refresh without starting another download", async () => {
    const originalFetch = globalThis.fetch;
    let downloadAttempts = 0;
    let failureCode: string | undefined;
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/download-probe")) {
        downloadAttempts += 1;
        return Promise.resolve(new Response(JSON.stringify({ data: null, error: { code: "access_expired", message: "Expired" } }), { status: 401 }));
      }
      if (url.endsWith("/v1/auth/csrf")) {
        return new Promise<Response>((resolve) => setTimeout(() => resolve(Response.json({ data: { csrfToken: "csrf" }, meta: null, error: null })), 125));
      }
      if (url.endsWith("/v1/auth/refresh")) return Promise.resolve(Response.json({ data: { refreshed: true }, meta: null, error: null }));
      throw new Error(`Unexpected request: ${url}`);
    }));

    try {
      const download = apiBlob("/v1/download-probe", { timeoutMs: 100 });
      void download.catch((error) => { failureCode = error.code; });
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      expect(failureCode).toBe("timeout");
      expect(downloadAttempts).toBe(1);
      // The caller stopped waiting, but the shared refresh must finish before
      // this test removes its fake timers and replaces the network fixture.
      await vi.advanceTimersByTimeAsync(25);
    } finally {
      timeout.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("lets one cancelled download stop waiting for a shared refresh", async () => {
    const originalFetch = globalThis.fetch;
    const controller = new AbortController();
    let downloadAttempts = 0;
    let refreshes = 0;
    let completeRefresh!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/download-probe")) {
        downloadAttempts += 1;
        return Promise.resolve(new Response(JSON.stringify({ data: null, error: { code: "access_expired", message: "Expired" } }), { status: 401 }));
      }
      if (url.endsWith("/v1/auth/csrf")) return Promise.resolve(Response.json({ data: { csrfToken: "csrf" }, meta: null, error: null }));
      if (url.endsWith("/v1/auth/refresh")) { refreshes += 1; return new Promise<Response>(resolve => { completeRefresh = resolve; }); }
      throw new Error(`Unexpected request: ${url}`);
    }));

    try {
      const download = apiBlob("/v1/download-probe", { signal: controller.signal, timeoutMs: 1_000 });
      await vi.waitFor(() => expect(refreshes).toBe(1));
      controller.abort();
      await expect(download).rejects.toMatchObject({ code: "cancelled" });
      expect(downloadAttempts).toBe(1);
      completeRefresh(Response.json({ data: { refreshed: true } }));
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });
});
