import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../test/server";
import {
  createSubscription,
  deleteSubscription,
  getDashboard,
  updateSubscription,
} from "./api/dashboard";
import { clearAuth } from "./api";

const api = "http://localhost:3000";
const projectId = "11111111-1111-4111-8111-111111111111";
const subscription = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Supabase Pro",
  category: "database",
  cost: 25,
  billingType: "monthly",
  status: "active",
  provider: "Supabase",
  externalRef: "https://supabase.com/dashboard/project/example",
  renewsAt: "2026-09-01T00:00:00.000Z",
};

describe("backend-complete Dashboard API", () => {
  beforeEach(() => clearAuth());

  it("maps authoritative destinations and fields while excluding system telemetry", async () => {
    server.use(
      http.get(`${api}/v1/projects/${projectId}/mission-control`, ({ request }) => {
        expect(new URL(request.url).searchParams.get("forceRefresh")).toBe("true");
        return HttpResponse.json({ data: {
          stats: [{ id: "open-prs", label: "Open PRs", value: 2, source: "github", tone: "orange" }],
          team: [], recentChanges: [], calendarEvents: [], slackMessages: [], gitCommits: [], socratesQueries: [],
          activity: [
            { id: "customer-1", source: "github", text: "PR opened", timeAgo: "now" },
            { id: "internal-1", source: "system", text: "Dashboard Mission Control Opened", timeAgo: "now" },
          ],
          updatedAt: "2026-08-20T02:00:00.000Z",
        }, meta: null, error: null });
      }),
      http.get(`${api}/v1/projects/${projectId}/subscriptions`, () =>
        HttpResponse.json({ data: [subscription], meta: null, error: null }))
    );

    const result = await getDashboard(projectId, { forceRefresh: true });
    expect(result.stats[0].route).toBe("/timeline?source=github");
    expect(result.activity).toEqual([expect.objectContaining({ id: "customer-1" })]);
    expect(result.subscriptions[0]).toMatchObject({ cost: 25, billingType: "monthly", externalRef: subscription.externalRef });
    expect(result.updatedAt).toBe("2026-08-20T02:00:00.000Z");
  });

  it("sends complete create, update, and delete contracts", async () => {
    const methods: string[] = [];
    server.use(
      http.get(`${api}/v1/auth/csrf`, () =>
        HttpResponse.json({ data: { csrfToken: "csrf-test-token" }, meta: null, error: null })),
      http.post(`${api}/v1/projects/${projectId}/subscriptions`, async ({ request }) => {
        methods.push(request.method);
        expect(await request.json()).toMatchObject({ name: "Supabase Pro", cost: 25, billingType: "monthly", externalRef: subscription.externalRef });
        return HttpResponse.json({ data: subscription, meta: null, error: null });
      }),
      http.patch(`${api}/v1/projects/${projectId}/subscriptions/${subscription.id}`, async ({ request }) => {
        methods.push(request.method);
        expect(await request.json()).toMatchObject({ status: "paused", cost: 30, renewsAt: subscription.renewsAt });
        return HttpResponse.json({ data: { ...subscription, status: "paused", cost: 30 }, meta: null, error: null });
      }),
      http.delete(`${api}/v1/projects/${projectId}/subscriptions/${subscription.id}`, ({ request }) => {
        methods.push(request.method);
        return HttpResponse.json({ data: { ok: true }, meta: null, error: null });
      })
    );

    const input = { ...subscription };
    delete (input as Partial<typeof input>).id;
    await createSubscription(projectId, input as any);
    await updateSubscription(projectId, subscription.id, { ...input, cost: 30, status: "paused" } as any);
    await deleteSubscription(projectId, subscription.id);
    expect(methods).toEqual(["POST", "PATCH", "DELETE"]);
  });
});
