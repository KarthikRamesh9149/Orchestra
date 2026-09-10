import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { AuthProvider, useAuth } from "./AuthContext";
import { clearAuth } from "../lib/api/auth";
import { server } from "../test/server";

const base = "http://localhost:3000";
const user = { id: "new-user", orgId: "new-org", displayName: "New user", email: "new@example.invalid", globalRole: "member", workspaceRoleDefault: "manager" };
let auth: ReturnType<typeof useAuth>;
function Consumer() { auth = useAuth(); return <div>{auth.status}:{auth.user?.id}</div>; }
beforeEach(() => clearAuth());

it.each([200, 503])("ignores old startup %s after logout and a newer sign-in", async (status) => {
  let started!: () => void;
  const received = new Promise<void>(resolve => { started = resolve; });
  let release!: () => void;
  const deferred = new Promise<void>(resolve => { release = resolve; });
  server.use(
    http.get(`${base}/v1/auth/csrf`, () => HttpResponse.json({ data: { csrfToken: "csrf" } })),
    http.post(`${base}/v1/auth/bootstrap`, async () => {
      started(); await deferred;
      return HttpResponse.json(status === 200 ? { data: { user: { ...user, id: "old-user" }, workspaces: [] } } : { error: { code: "unavailable", message: "Old error" } }, { status });
    }),
    http.post(`${base}/v1/auth/logout`, () => HttpResponse.json({ data: { ok: true } })),
    http.post(`${base}/v1/auth/login`, () => HttpResponse.json({ data: { user } })),
    http.get(`${base}/v1/me/workspaces`, () => HttpResponse.json({ data: [] }))
  );
  render(<AuthProvider><Consumer /></AuthProvider>);
  await received;
  await act(async () => { await auth.signOut(); });
  await act(async () => { await auth.signIn({ email: user.email, password: "synthetic-password" }); });
  expect(screen.getByText("authenticated:new-user")).toBeInTheDocument();
  await act(async () => { release(); await deferred; });
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  expect(auth.user?.id).toBe("new-user");
  expect(auth.error).toBeNull();
});
