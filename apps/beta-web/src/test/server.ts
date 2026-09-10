import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const api = "http://localhost:3000";

export const defaultHandlers = [
  http.get(`${api}/v1/auth/csrf`, () =>
    HttpResponse.json({ data: { csrfToken: "test-csrf-token" }, meta: null, error: null })
  ),
  http.get(`${api}/v1/projects/local-project/integrations/status`, () =>
    HttpResponse.json({ data: { providers: [] }, meta: null, error: null })
  ),
  http.get(`${api}/v1/projects/local-project/connectors/readiness`, () =>
    HttpResponse.json({ data: [], meta: null, error: null })
  ),
  http.get(`${api}/v1/projects/local-project/settings`, () =>
    HttpResponse.json({
      data: {
        projectId: "local-project",
        name: "Original Workspace",
        slug: "original-workspace",
        createdAt: "2026-08-19T00:00:00.000Z",
      },
      meta: null,
      error: null,
    })
  ),
  http.get(`${api}/v1/projects/local-project/members`, () =>
    HttpResponse.json({ data: { members: [] }, meta: null, error: null })
  ),
  http.get(`${api}/v1/projects/local-project/join-codes`, () =>
    HttpResponse.json({ data: [], meta: null, error: null })
  ),
  http.get(`${api}/v1/me/profile`, () =>
    HttpResponse.json({
      data: {
        userId: "local-user",
        displayName: "Local User",
        email: "local@example.test",
        globalRole: "owner",
        createdAt: "2026-08-19T00:00:00.000Z",
      },
      meta: null,
      error: null,
    })
  ),
  http.get(`${api}/v1/me/sessions`, () =>
    HttpResponse.json({ data: [], meta: null, error: null })
  ),
  http.get(`${api}/v1/me/appearance-preference`, () =>
    HttpResponse.json({ data: { theme: "auto", updatedAt: "2026-08-20T00:00:00.000Z" }, meta: null, error: null })
  ),
  http.get(`${api}/v1/me/linked-accounts`, () =>
    HttpResponse.json({ data: [], meta: null, error: null })
  ),
];

export const server = setupServer(...defaultHandlers);
