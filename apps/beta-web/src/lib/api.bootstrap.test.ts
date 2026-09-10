import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import * as api from "./api";
import { server } from "../test/server";
import { useWorkspaceStore } from "../store/workspaceStore";

const base = "http://localhost:3000";
const payload = { user: { id: "user-1", orgId: "org-1", email: "test@example.invalid", displayName: "Test", globalRole: "member", workspaceRoleDefault: "client" },
  workspaces: [{ projectId: "project-1", organizationId: "org-1", name: "Project", role: "client", current: true }] };
beforeEach(() => api.clearAuth());
afterEach(() => vi.unstubAllGlobals());

it("restores concurrent startup consumers with one protected request and no failed-read cascade", async () => {
  const load = api.loadBootstrap;
  expect(load).toBeTypeOf("function");
  const calls: string[] = [];
  server.use(
    http.get(`${base}/v1/auth/csrf`, () => { calls.push("csrf"); return HttpResponse.json({ data: { csrfToken: "bootstrap-csrf" } }); }),
    http.post(`${base}/v1/auth/bootstrap`, async ({ request }) => {
      calls.push("bootstrap");
      expect(request.credentials).toBe("include");
      expect(request.headers.get("x-csrf-token")).toBe("bootstrap-csrf");
      expect(await request.json()).toEqual({ sessionMode: "browser" });
      return HttpResponse.json({ data: payload });
    })
  );
  const [a,b] = await Promise.all([load(),load()]);
  expect(a.user.id).toBe("user-1");
  expect(a.activeProject).toMatchObject({ id: "project-1", projectRole: "client" });
  expect(b).toEqual(a);
  expect(calls).toEqual(["csrf", "bootstrap"]);
});

it("reports failed startup honestly instead of retrying through the old session cascade", async () => {
  const load = api.loadBootstrap;
  expect(load).toBeTypeOf("function");
  server.use(
    http.get(`${base}/v1/auth/csrf`, () => HttpResponse.json({ data: { csrfToken: "csrf" } })),
    http.post(`${base}/v1/auth/bootstrap`, () => HttpResponse.json({ error: { code: "database_unavailable", message: "Try again" } }, {status:503}))
  );
  await expect(load()).rejects.toMatchObject({ status:503, code:"database_unavailable" });
});

it.each([200, 503])("does not restore a stale startup response (%s) after logout", async (status) => {
  let started!: () => void;
  const received = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const deferred = new Promise<void>(resolve => { release = resolve; });
  server.use(
    http.get(`${base}/v1/auth/csrf`, () => HttpResponse.json({ data: { csrfToken: "csrf" } })),
    http.post(`${base}/v1/auth/bootstrap`, async () => { started(); await deferred; return HttpResponse.json(status === 200 ? { data: payload } : { error: { code: "unavailable", message: "Unavailable" } }, { status }); })
  );
  const pending = api.loadBootstrap();
  const rejected = expect(pending).rejects.toMatchObject({ code: "session_changed" });
  await received;
  api.clearAuth();
  release();
  await rejected;
  expect(useWorkspaceStore.getState().activeProjectId).toBeNull();
});

it("replaces stale CSRF once under the browser session lock, without retrying indefinitely", async () => {
  const lock = vi.fn(async (_name: string, run: () => Promise<unknown>) => run());
  vi.stubGlobal("navigator", { locks: { request: lock }, onLine: true });
  let csrfCalls = 0;
  let posts = 0;
  server.use(
    http.get(`${base}/v1/auth/csrf`, () => { csrfCalls++; return HttpResponse.json({ data: { csrfToken: `csrf-${csrfCalls}` } }); }),
    http.post(`${base}/v1/auth/bootstrap`, () => { posts++; return HttpResponse.json({ error: { code: "csrf_invalid", message: "Expired" } }, { status: 403 }); })
  );
  await expect(api.loadBootstrap()).rejects.toMatchObject({ code: "csrf_invalid" });
  expect(csrfCalls).toBe(2);
  expect(posts).toBe(2);
  expect(lock).toHaveBeenCalledTimes(1);
  expect(lock.mock.calls[0][0]).toBe("orchestra-session-refresh");
});
