import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../test/server";
import { clearAuth } from "./api";
import { createProjectTimelineEvent, getProjectTimeline } from "./api/timeline";

const api = "http://localhost:3000";
const projectId = "11111111-1111-4111-8111-111111111111";

describe("[FIX-21] Timeline backend contracts", () => {
  beforeEach(() => clearAuth());

  it("preserves provider provenance, safe open targets, and metadata", async () => {
    server.use(http.get(`${api}/v1/projects/${projectId}/timeline`, ({ request }) => {
      expect(new URL(request.url).searchParams.get("view")).toBe("detailed");
      return HttpResponse.json({ data: { items: [{
        id: "clickup:task-1",
        title: "Release task",
        description: "Provider-derived evidence",
        source: "clickup",
        sourceRef: "task-1",
        timestamp: "2026-08-20T00:00:00.000Z",
        tier: "milestone",
        type: "change",
        status: "informational",
        author: { name: "ClickUp" },
        metadataSummary: "ClickUp workspace: Engineering",
        openTarget: { targetType: "provider_evidence", targetRef: { url: "https://app.clickup.com/t/task-1" } },
      }] }, meta: null, error: null });
    }));

    await expect(getProjectTimeline(projectId)).resolves.toEqual([
      expect.objectContaining({
        source: "clickup",
        metadataSummary: "ClickUp workspace: Engineering",
        openTarget: { targetType: "provider_evidence", targetRef: { url: "https://app.clickup.com/t/task-1" } },
      }),
    ]);
  });

  it("creates visible events through the manual-only mutation contract", async () => {
    let body: unknown;
    server.use(http.post(`${api}/v1/projects/${projectId}/timeline/events`, async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ data: {
        id: "manual:event-1",
        title: "Release checkpoint",
        description: "Verified manually",
        source: "manual",
        sourceRef: "release-notes",
        timestamp: "2026-08-20T00:00:00.000Z",
        tier: "milestone",
        type: "note",
        status: "informational",
        author: { name: "Project member" },
      }, meta: null, error: null });
    }));

    const created = await createProjectTimelineEvent(projectId, {
      title: "Release checkpoint",
      description: "Verified manually",
      source: "manual",
      tier: "milestone",
      sourceRef: "release-notes",
    });

    expect(body).toMatchObject({ source: "manual", title: "Release checkpoint" });
    expect(created.source).toBe("manual");
  });
});
