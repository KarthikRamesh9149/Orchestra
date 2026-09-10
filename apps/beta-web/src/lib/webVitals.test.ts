import { http, HttpResponse } from "msw";
import { beforeEach, expect, it } from "vitest";
import { server } from "../test/server";
import { apiJson, resetApiSession } from "./api/client";
import { reportWebVital } from "./webVitals";

beforeEach(() => resetApiSession());

it("reports only numeric Web Vitals with CSRF and preserves the page cache", async () => {
  let reads = 0;
  let received: unknown;
  let csrf: string | null = null;
  server.use(
    http.get("http://localhost:3000/v1/auth/csrf", () => HttpResponse.json({ data: { csrfToken: "synthetic-csrf" }, meta: null, error: null })),
    http.get("http://localhost:3000/v1/rum-cache-proof", () => { reads++; return HttpResponse.json({ data: { ready: true }, meta: null, error: null }); }),
    http.post("http://localhost:3000/v1/me/web-vitals", async ({ request }) => {
      received = await request.json(); csrf = request.headers.get("x-csrf-token");
      return HttpResponse.json({ data: { accepted: true }, meta: null, error: null });
    })
  );
  await apiJson("/v1/rum-cache-proof", { cache: "force-cache" });
  await reportWebVital({ name: "LCP", id: "v5-123-456", value: 2100 }, 390);
  await apiJson("/v1/rum-cache-proof", { cache: "force-cache" });
  expect(received).toEqual({ metric: "LCP", sampleId: "v5-123-456", value: 2100, device: "mobile" });
  expect(csrf).toBe("synthetic-csrf");
  expect(reads).toBe(1);
});

it("does not interrupt the UI or retry when telemetry is unavailable", async () => {
  let posts = 0;
  server.use(
    http.get("http://localhost:3000/v1/auth/csrf", () => HttpResponse.json({ data: { csrfToken: "synthetic-csrf" }, meta: null, error: null })),
    http.post("http://localhost:3000/v1/me/web-vitals", () => { posts++; return new HttpResponse(null, { status: 503 }); })
  );
  await expect(reportWebVital({ name: "INP", id: "v5-123-457", value: 120 }, 1440)).resolves.toBeUndefined();
  expect(posts).toBe(1);
  await reportWebVital({ name: "LCP", id: "v5-123-458", value: NaN }, 1440);
  expect(posts).toBe(1);
});
