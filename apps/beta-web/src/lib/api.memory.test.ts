import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { archiveDocument, clearAuth, getCommunicationThreads, reconcileDocumentUpload, uploadDoc } from "./api";

const api = "http://localhost:3000";
const projectId = "11111111-1111-4111-8111-111111111111";

describe("[FIX-20] Memory backend contracts", () => {
  beforeEach(() => clearAuth());

  it("queries all communication providers and suppresses duplicate source projections", async () => {
    let query = "";
    server.use(http.get(`${api}/v1/projects/${projectId}/threads`, ({ request }) => {
      query = new URL(request.url).search;
      const shared = {
        connectorId: "connector-1",
        provider: "microsoft_teams",
        providerThreadId: "source-thread-1",
        accountLabel: "Engineering Teams",
        subject: "Release plan",
        lastMessageAt: "2026-08-20T00:00:00.000Z",
        latestMessage: null,
        providerOpenTarget: { targetType: "provider_evidence", provider: "microsoft_teams", url: "https://teams.example/thread/1" },
      };
      return HttpResponse.json({ data: [{ ...shared, threadId: "projection-1" }, { ...shared, threadId: "projection-2" }], meta: null, error: null });
    }));

    const threads = await getCommunicationThreads(projectId);

    expect(query).toContain("limit=25");
    expect(query).not.toContain("provider=");
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ provider: "microsoft_teams", threadId: "projection-1" });
  });

  it("suppresses semantically identical projections even when volatile ids differ", async () => {
    server.use(http.get(`${api}/v1/projects/${projectId}/threads`, () => {
      const shared = {
        connectorId: "connector-1",
        provider: "fireflies_ai",
        accountLabel: "Product calls",
        subject: "Weekly product review",
        lastMessageAt: "2026-08-20T00:00:00.000Z",
        latestMessage: { id: "message-1", senderLabel: "Karthik", sentAt: "2026-08-20T00:00:00.000Z", excerpt: "  Ship the approved launch scope.  " },
      };
      return HttpResponse.json({
        data: [
          { ...shared, threadId: "projection-1", providerThreadId: "import-1" },
          { ...shared, threadId: "projection-2", providerThreadId: "import-2", latestMessage: { ...shared.latestMessage, id: "message-2", excerpt: "ship the approved launch scope." } }
        ],
        meta: null,
        error: null
      });
    }));

    const threads = await getCommunicationThreads(projectId);

    expect(threads.map((thread) => thread.threadId)).toEqual(["projection-1"]);
  });

  it("archives through the authoritative CSRF-protected endpoint", async () => {
    let csrf = "";
    server.use(http.delete(`${api}/v1/projects/${projectId}/documents/document-1`, ({ request }) => {
      csrf = request.headers.get("x-csrf-token") ?? "";
      return HttpResponse.json({ data: { documentId: "document-1", archivedAt: "2026-08-20T01:00:00.000Z" }, meta: null, error: null });
    }));

    await expect(archiveDocument(projectId, "document-1")).resolves.toMatchObject({ documentId: "document-1" });
    expect(csrf).toBe("test-csrf-token");
  });
});

describe("[R03] document upload transport", () => {
  beforeEach(() => clearAuth());

  it("sends one durable operation id and exposes upload progress", async () => {
    const original = globalThis.XMLHttpRequest;
    const instances: FakeUploadRequest[] = [];
    class FakeUploadRequest {
      static DONE = 4;
      upload: { onprogress: ((event: ProgressEvent<EventTarget>) => void) | null } = { onprogress: null };
      headers = new Map<string, string>();
      responseText = "";
      status = 0;
      statusText = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      timeout = 0;
      constructor() { instances.push(this); }
      open() {}
      setRequestHeader(name: string, value: string) { this.headers.set(name.toLowerCase(), value); }
      getAllResponseHeaders() { return "content-type: application/json"; }
      send() {
        queueMicrotask(() => {
          this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent<EventTarget>);
          this.status = 200;
          this.responseText = JSON.stringify({ data: { documentId: "document-1", document: { id: "document-1", title: "Core PRD", kind: "prd" } }, meta: null, error: null });
          this.onload?.();
        });
      }
      abort() { this.onabort?.(); }
    }
    Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: FakeUploadRequest });

    try {
      const progress = vi.fn();
      await uploadDoc(projectId, new File(["synthetic"], "core-prd.pdf", { type: "application/pdf" }), {
        operationId: "11111111-1111-4111-8111-111111111111",
        onProgress: progress
      });

      expect(instances).toHaveLength(1);
      expect(instances[0].headers.get("x-idempotency-key")).toBe("11111111-1111-4111-8111-111111111111");
      expect(instances[0].timeout).toBeGreaterThan(30_000);
      expect(progress).toHaveBeenCalledWith(expect.objectContaining({ loaded: 50, total: 100, percent: 50, phase: "uploading" }));
    } finally {
      Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: original });
    }
  });

  it("cancels the upload transport without converting it into a network failure", async () => {
    const original = globalThis.XMLHttpRequest;
    class FakeUploadRequest {
      upload = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      timeout = 0;
      open() {}
      setRequestHeader() {}
      getAllResponseHeaders() { return ""; }
      send() {}
      abort() { this.onabort?.(); }
    }
    Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: FakeUploadRequest });

    try {
      const controller = new AbortController();
      const request = uploadDoc(projectId, new File(["synthetic"], "core-prd.pdf", { type: "application/pdf" }), { signal: controller.signal });
      controller.abort();
      await expect(request).rejects.toMatchObject({ code: "cancelled" });
    } finally {
      Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: original });
    }
  });

  it("[R03] refreshes once after an upload 401 and replays the same operation id", async () => {
    const original = globalThis.XMLHttpRequest;
    const instances: FakeUploadRequest[] = [];
    class FakeUploadRequest {
      upload = { onprogress: null };
      headers = new Map<string, string>();
      responseText = "";
      status = 0;
      statusText = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      timeout = 0;
      constructor() { instances.push(this); }
      open() {}
      setRequestHeader(name: string, value: string) { this.headers.set(name.toLowerCase(), value); }
      getAllResponseHeaders() { return "content-type: application/json"; }
      send() {
        queueMicrotask(() => {
          this.status = instances.length === 1 ? 401 : 200;
          this.responseText = this.status === 401
            ? JSON.stringify({ data: null, meta: null, error: { code: "access_expired", message: "Access token expired" } })
            : JSON.stringify({ data: { document: { id: "document-1", title: "Core PRD", kind: "prd" } }, meta: null, error: null });
          this.onload?.();
        });
      }
      abort() { this.onabort?.(); }
    }
    const refreshes = vi.fn();
    server.use(http.post(`${api}/v1/auth/refresh`, () => {
      refreshes();
      return HttpResponse.json({ data: { refreshed: true }, meta: null, error: null });
    }));
    Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: FakeUploadRequest });

    try {
      await uploadDoc(projectId, new File(["synthetic"], "core-prd.pdf"), { operationId: "11111111-1111-4111-8111-111111111111" });
      expect(refreshes).toHaveBeenCalledTimes(1);
      expect(instances).toHaveLength(2);
      expect(instances.map((request) => request.headers.get("x-idempotency-key"))).toEqual([
        "11111111-1111-4111-8111-111111111111",
        "11111111-1111-4111-8111-111111111111"
      ]);
    } finally {
      Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: original });
    }
  });

  it("[R03] treats a second upload 401 as terminal", async () => {
    const original = globalThis.XMLHttpRequest;
    const instances: FakeUploadRequest[] = [];
    class FakeUploadRequest {
      upload = { onprogress: null };
      responseText = "";
      status = 0;
      statusText = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      timeout = 0;
      constructor() { instances.push(this); }
      open() {}
      setRequestHeader() {}
      getAllResponseHeaders() { return "content-type: application/json"; }
      send() { queueMicrotask(() => { this.status = 401; this.responseText = JSON.stringify({ data: null, meta: null, error: { code: "access_expired", message: "Access token expired" } }); this.onload?.(); }); }
      abort() { this.onabort?.(); }
    }
    const refreshes = vi.fn();
    server.use(http.post(`${api}/v1/auth/refresh`, () => {
      refreshes();
      return HttpResponse.json({ data: { refreshed: true }, meta: null, error: null });
    }));
    Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: FakeUploadRequest });

    try {
      await expect(uploadDoc(projectId, new File(["synthetic"], "core-prd.pdf"), { operationId: "11111111-1111-4111-8111-111111111111" }))
        .rejects.toMatchObject({ status: 401, code: "access_expired" });
      expect(refreshes).toHaveBeenCalledTimes(1);
      expect(instances).toHaveLength(2);
    } finally {
      Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: original });
    }
  });

  it("[R03] caps a 401 upload refresh without replaying the browser request", async () => {
    const originalXhr = globalThis.XMLHttpRequest;
    const originalFetch = globalThis.fetch;
    const instances: FakeUploadRequest[] = [];
    class FakeUploadRequest {
      upload = { onprogress: null };
      responseText = "";
      status = 0;
      statusText = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      timeout = 0;
      constructor() { instances.push(this); }
      open() {}
      setRequestHeader() {}
      getAllResponseHeaders() { return "content-type: application/json"; }
      send() { queueMicrotask(() => { this.status = 401; this.responseText = JSON.stringify({ data: null, meta: null, error: { code: "access_expired", message: "Expired" } }); this.onload?.(); }); }
      abort() { this.onabort?.(); }
    }
    let failureCode: string | undefined;
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/auth/csrf")) return Promise.resolve(Response.json({ data: { csrfToken: "csrf" }, meta: null, error: null }));
      if (url.endsWith("/v1/auth/refresh")) return new Promise<Response>(() => undefined);
      throw new Error(`Unexpected request: ${url}`);
    }));
    Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: FakeUploadRequest });

    try {
      const upload = uploadDoc(projectId, new File(["synthetic"], "core-prd.pdf"), { operationId: "11111111-1111-4111-8111-111111111111" });
      void upload.catch((error) => { failureCode = error.code; });
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await Promise.resolve();
      expect(failureCode).toBe("timeout");
      expect(instances).toHaveLength(1);
    } finally {
      timeout.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.stubGlobal("fetch", originalFetch);
      Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: originalXhr });
    }
  });

  it("[R03] applies the upload deadline while cold CSRF is still pending", async () => {
    const originalXhr = globalThis.XMLHttpRequest;
    const originalFetch = globalThis.fetch;
    const constructed = vi.fn();
    class FakeUploadRequest {
      upload = { onprogress: null };
      constructor() { constructed(); }
      open() {}
      setRequestHeader() {}
      getAllResponseHeaders() { return ""; }
      send() {}
      abort() {}
    }
    let failureCode: string | undefined;
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
      return controller.signal;
    });
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: FakeUploadRequest });

    try {
      const upload = uploadDoc(projectId, new File(["synthetic"], "core-prd.pdf"), { operationId: "11111111-1111-4111-8111-111111111111" });
      void upload.catch((error) => { failureCode = error.code; });
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await Promise.resolve();
      expect(failureCode).toBe("timeout");
      expect(constructed).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.stubGlobal("fetch", originalFetch);
      Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: originalXhr });
    }
  });

  it("[R03] lets an upload caller cancel while cold CSRF remains shared", async () => {
    const originalXhr = globalThis.XMLHttpRequest;
    const originalFetch = globalThis.fetch;
    const constructed = vi.fn();
    class FakeUploadRequest {
      upload = { onprogress: null };
      constructor() { constructed(); }
      open() {}
      setRequestHeader() {}
      getAllResponseHeaders() { return ""; }
      send() {}
      abort() {}
    }
    const controller = new AbortController();
    const csrfRequested = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => { csrfRequested(); return new Promise<Response>(() => undefined); }));
    Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: FakeUploadRequest });

    try {
      const upload = uploadDoc(projectId, new File(["synthetic"], "core-prd.pdf"), { signal: controller.signal, operationId: "11111111-1111-4111-8111-111111111111" });
      await vi.waitFor(() => expect(csrfRequested).toHaveBeenCalledTimes(1));
      controller.abort();
      await expect(upload).rejects.toMatchObject({ code: "cancelled" });
      expect(constructed).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: originalXhr });
    }
  });

  it("reconciles a timed-out upload by operation id without posting the file again", async () => {
    const operationId = "11111111-1111-4111-8111-111111111111";
    server.use(http.get(`${api}/v1/projects/${projectId}/documents/uploads/${operationId}`, () =>
      HttpResponse.json({ data: { documentId: "document-1", documentVersionId: operationId, status: "pending", parseRevision: 1, operationId }, meta: null, error: null })
    ));

    await expect(reconcileDocumentUpload(projectId, operationId)).resolves.toMatchObject({ documentId: "document-1", operationId });
  });
});
