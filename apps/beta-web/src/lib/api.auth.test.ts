import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuth, createProject, getMe, getProfile, loadActiveProject, login, logout, switchWorkspace } from "./api";
import { server } from "../test/server";
import { useWorkspaceStore } from "../store/workspaceStore";

const api = "http://localhost:3000";

describe("browser cookie authentication", () => {
  beforeEach(() => {
    clearAuth();
  });

  it("establishes a browser session without reading or writing bearer tokens in sessionStorage", async () => {
    const calls: string[] = [];
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    server.use(
      http.get(`${api}/v1/auth/csrf`, ({ request }) => {
        calls.push("csrf");
        expect(request.credentials).toBe("include");
        return HttpResponse.json({ data: { csrfToken: "csrf-token-1" }, meta: null, error: null });
      }),
      http.post(`${api}/v1/auth/login`, async ({ request }) => {
        calls.push("login");
        expect(request.credentials).toBe("include");
        expect(request.headers.get("x-csrf-token")).toBe("csrf-token-1");
        expect(await request.json()).toEqual({
          email: "manager@example.com",
          password: "Password123!",
          sessionMode: "browser"
        });
        return HttpResponse.json({
          data: {
            user: {
              id: "user-1",
              orgId: "org-1",
              email: "manager@example.com",
              displayName: "Manager",
              globalRole: "owner",
              workspaceRoleDefault: "manager"
            }
          },
          meta: null,
          error: null
        });
      })
    );

    await login({ email: "manager@example.com", password: "Password123!" });

    expect(calls).toEqual(["csrf", "login"]);
    const forbiddenKeys = ["orchestra_beta_access_token", "orchestra_beta_refresh_token"];
    expect(getItem.mock.calls.map(([key]) => key)).not.toEqual(expect.arrayContaining(forbiddenKeys));
    expect(setItem.mock.calls.map(([key]) => key)).not.toEqual(expect.arrayContaining(forbiddenKeys));
  });

  it("sends credentials and CSRF protection for mutations without an Authorization header", async () => {
    server.use(
      http.get(`${api}/v1/auth/csrf`, () =>
        HttpResponse.json({ data: { csrfToken: "csrf-token-2" }, meta: null, error: null })
      ),
      http.post(`${api}/v1/projects`, async ({ request }) => {
        expect(request.credentials).toBe("include");
        expect(request.headers.get("authorization")).toBeNull();
        expect(request.headers.get("x-csrf-token")).toBe("csrf-token-2");
        return HttpResponse.json({ data: { id: "project-1", name: "Project" }, meta: null, error: null });
      })
    );

    await createProject({ name: "Project" });
  });

  it("logs out through the cookie session contract without sending a refresh token body", async () => {
    let called = false;
    server.use(
      http.get(`${api}/v1/auth/csrf`, () =>
        HttpResponse.json({ data: { csrfToken: "csrf-token-3" }, meta: null, error: null })
      ),
      http.post(`${api}/v1/auth/logout`, async ({ request }) => {
        called = true;
        expect(request.credentials).toBe("include");
        expect(request.headers.get("x-csrf-token")).toBe("csrf-token-3");
        expect(await request.text()).toBe("");
        return HttpResponse.json({ data: { ok: true }, meta: null, error: null });
      })
    );

    await logout();
    expect(called).toBe(true);
  });

  it("recovers a reloaded session by rotating the HttpOnly refresh cookie and retrying authoritative user state", async () => {
    let meCalls = 0;
    server.use(
      http.get(`${api}/v1/auth/me`, ({ request }) => {
        meCalls += 1;
        expect(request.credentials).toBe("include");
        if (meCalls === 1) {
          return HttpResponse.json(
            { data: null, meta: null, error: { code: "auth_required", message: "Authentication required" } },
            { status: 401 }
          );
        }
        return HttpResponse.json({
          data: {
            id: "user-1",
            orgId: "org-1",
            email: "manager@example.com",
            displayName: "Manager",
            globalRole: "owner",
            workspaceRoleDefault: "manager"
          },
          meta: null,
          error: null
        });
      }),
      http.get(`${api}/v1/auth/csrf`, () =>
        HttpResponse.json({ data: { csrfToken: "reload-csrf" }, meta: null, error: null })
      ),
      http.post(`${api}/v1/auth/refresh`, async ({ request }) => {
        expect(request.credentials).toBe("include");
        expect(request.headers.get("x-csrf-token")).toBe("reload-csrf");
        expect(await request.text()).toBe("");
        return HttpResponse.json({ data: { refreshed: true }, meta: null, error: null });
      })
    );

    await expect(getMe()).resolves.toMatchObject({ id: "user-1", email: "manager@example.com" });
    expect(meCalls).toBe(2);
  });

  it("persists a client workspace through the backend and restores the server-authoritative selection", async () => {
    server.use(
      http.get(`${api}/v1/auth/csrf`, () =>
        HttpResponse.json({ data: { csrfToken: "switch-csrf" }, meta: null, error: null })
      ),
      http.post(`${api}/v1/me/workspaces/switch`, async ({ request }) => {
        expect(request.headers.get("x-csrf-token")).toBe("switch-csrf");
        expect(await request.json()).toEqual({ projectId: "client-project" });
        return HttpResponse.json({
          data: {
            workspace: {
              projectId: "client-project",
              name: "Client Workspace",
              slug: "client-workspace",
              organizationId: "org-2",
              organizationName: "Client Org",
              organizationSlug: "client-org",
              role: "client",
              current: true
            },
            user: {
              id: "user-1",
              orgId: "org-2",
              email: "client@example.com",
              displayName: "Client",
              globalRole: "member",
              workspaceRoleDefault: "client",
              emailVerified: false
            }
          },
          meta: null,
          error: null
        });
      }),
      http.get(`${api}/v1/me/workspaces`, () =>
        HttpResponse.json({
          data: [{
            projectId: "client-project",
            name: "Client Workspace",
            slug: "client-workspace",
            organizationId: "org-2",
            organizationName: "Client Org",
            organizationSlug: "client-org",
            role: "client",
            current: true
          }],
          meta: null,
          error: null
        })
      )
    );

    const switched = await switchWorkspace("client-project");
    expect(switched.project).toMatchObject({ projectRole: "client", organizationId: "org-2" });
    expect(useWorkspaceStore.getState().userRole).toBe("client");

    useWorkspaceStore.getState().clearActiveProject();
    const reloaded = await loadActiveProject();
    expect(reloaded.activeProject).toMatchObject({ id: "client-project", projectRole: "client", current: true });
  });

  it("does not claim an unverified email is verified", async () => {
    server.use(
      http.get(`${api}/v1/me/profile`, () => HttpResponse.json({
        data: {
          userId: "user-1",
          displayName: "User",
          email: "user@example.com",
          emailVerified: false,
          globalRole: "member",
          createdAt: "2026-08-19T00:00:00.000Z"
        },
        meta: null,
        error: null
      }))
    );

    await expect(getProfile()).resolves.toMatchObject({ emailVerified: false });
  });
});
