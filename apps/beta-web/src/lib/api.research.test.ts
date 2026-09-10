import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import {
  addDeepResearchToMemory,
  clearAuth,
  downloadDeepResearchReport,
  getDeepResearchRun,
  getProjectContextEntry,
  startDeepResearch,
} from "./api";

const api = "http://localhost:3000";
const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const contextId = "33333333-3333-4333-8333-333333333333";

const run = {
  id: runId,
  projectId,
  status: "running",
  researchFocus: "release readiness",
  sources: ["docs", "web"],
  outputFormat: "full_report",
  privacyMode: "internal_plus_web",
  webSearchRequested: true,
  webSearchUsed: false,
  progress: { percent: 40, stage: "evidence_ready" },
  results: null,
  error: null,
  createdAt: "2026-08-20T00:00:00.000Z",
  completedAt: null,
};

describe("[FIX-22] Deep Research frontend API contracts", () => {
  beforeEach(() => clearAuth());

  it("sends explicit source, privacy, and web choices and preserves real progress", async () => {
    let body: unknown;
    server.use(
      http.post(`${api}/v1/projects/${projectId}/deep-research`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: run, meta: null, error: null }, { status: 202 });
      }),
      http.get(`${api}/v1/projects/${projectId}/deep-research/${runId}`, () =>
        HttpResponse.json({ data: run, meta: null, error: null }))
    );

    await startDeepResearch(projectId, {
      researchFocus: "release readiness",
      sources: ["docs", "web"],
      outputFormat: "Full Report",
      privacyMode: "internal_plus_web",
      webSearchEnabled: true,
    });
    expect(body).toMatchObject({ privacyMode: "internal_plus_web", webSearchEnabled: true, sources: ["docs", "web"] });
    await expect(getDeepResearchRun(projectId, runId)).resolves.toMatchObject({ progress: { percent: 40, stage: "evidence_ready" } });
  });

  it("returns the saved artifact id and stable frontend/API destination", async () => {
    server.use(http.post(`${api}/v1/projects/${projectId}/deep-research/${runId}/add-to-memory`, () =>
      HttpResponse.json({ data: {
        success: true,
        memoryEntryId: contextId,
        createdAt: "2026-08-20T00:00:00.000Z",
        destination: { type: "project_context", route: `/memory/context/${contextId}`, apiPath: `/v1/projects/${projectId}/context/${contextId}` },
      }, meta: null, error: null })));

    await expect(addDeepResearchToMemory(projectId, runId)).resolves.toMatchObject({
      memoryEntryId: contextId,
      destination: { route: `/memory/context/${contextId}` },
    });
  });

  it("downloads the authorized backend filename and reads the saved artifact", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:research");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    server.use(
      http.get(`${api}/v1/projects/${projectId}/deep-research/${runId}/export`, () =>
        new HttpResponse(new Blob(["report"]), { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="deep-research-release.pdf"' } })),
      http.get(`${api}/v1/projects/${projectId}/context/${contextId}`, () =>
        HttpResponse.json({ data: { id: contextId, projectId, title: "Deep Research — release readiness", body: "# Report", type: "manual_note", source: "generated", status: "active", tags: ["deep-research"], createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" }, meta: null, error: null }))
    );

    await downloadDeepResearchReport(projectId, runId);
    expect(createUrl).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    await expect(getProjectContextEntry(projectId, contextId)).resolves.toMatchObject({ title: "Deep Research — release readiness" });
  });
});
