import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../test/server";
import { clearAuth, getAnchorProvenance, getIntegrationsList, getMembersList } from "./api";
import { ApiError } from "./api/client";
import { getDashboard, loadOperationalState } from "./api/dashboard";
import { getProjectTimeline } from "./api/timeline";

const api = "http://localhost:3000";
const projectId = "11111111-1111-4111-8111-111111111111";

function failure(status: number, code: string, message: string, details?: unknown) {
  return HttpResponse.json(
    { data: null, meta: null, error: { code, message, details: details ?? null } },
    { status }
  );
}

describe("truthful API operational states", () => {
  beforeEach(() => clearAuth());

  it("preserves the backend status, code, message, details, and Retry-After value", async () => {
    server.use(
      http.get(`${api}/v1/projects/${projectId}/mission-control`, () =>
        HttpResponse.json(
          {
            data: null,
            meta: null,
            error: {
              code: "dashboard_temporarily_unavailable",
              message: "Dashboard refresh is still running.",
              details: { refreshId: "refresh-1" }
            }
          },
          { status: 503, headers: { "Retry-After": "15" } }
        )
      )
    );

    await expect(getDashboard(projectId)).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      code: "dashboard_temporarily_unavailable",
      message: "Dashboard refresh is still running.",
      details: { refreshId: "refresh-1" },
      retryAfter: "15"
    });
  });

  it("never converts forbidden timeline access into an empty timeline", async () => {
    server.use(
      http.get(`${api}/v1/projects/${projectId}/timeline`, () =>
        failure(403, "client_timeline_access_forbidden", "Timeline access requires a project member role.")
      )
    );

    await expect(getProjectTimeline(projectId)).rejects.toMatchObject({
      status: 403,
      code: "client_timeline_access_forbidden"
    });
  });

  it("never converts missing provenance into a null success", async () => {
    server.use(
      http.get(`${api}/v1/projects/${projectId}/documents/doc-1/anchors/anchor-1/provenance`, () =>
        failure(404, "anchor_provenance_not_found", "This evidence anchor no longer exists.")
      )
    );

    await expect(getAnchorProvenance(projectId, "doc-1", "anchor-1")).rejects.toMatchObject({
      status: 404,
      code: "anchor_provenance_not_found"
    });
  });

  it("never presents a failed integration or member read as an empty list", async () => {
    server.use(
      http.get(`${api}/v1/projects/${projectId}/integrations/status`, () =>
        failure(502, "integration_status_degraded", "Provider status could not be loaded safely.")
      ),
      http.get(`${api}/v1/projects/${projectId}/communication-connectors/readiness`, () =>
        HttpResponse.json({ data: [], meta: null, error: null })
      ),
      http.get(`${api}/v1/projects/${projectId}/members`, () =>
        failure(403, "manager_access_required", "Manager access is required.")
      )
    );

    await expect(getIntegrationsList(projectId)).rejects.toMatchObject({ code: "integration_status_degraded" });
    await expect(getMembersList(projectId)).rejects.toMatchObject({ code: "manager_access_required" });
  });

  it.each([
    [new ApiError({ status: 0, code: "network_error", message: "Offline" }), "disconnected"],
    [new ApiError({ status: 403, code: "manager_access_required", message: "Forbidden" }), "forbidden"],
    [new ApiError({ status: 503, code: "provider_unavailable", message: "Unavailable" }), "degraded"],
    [new ApiError({ status: 409, code: "dashboard_snapshot_stale", message: "Stale" }), "stale"],
    [new ApiError({ status: 500, code: "internal_error", message: "Failed" }), "failed"]
  ])("maps %s to the explicit %s state", async (error, expectedState) => {
    const state = await loadOperationalState(
      async () => { throw error; },
      () => false
    );
    expect(state.state).toBe(expectedState);
    if ("error" in state) expect(state.error.code).toBe(error.code);
  });

  it("distinguishes an authoritative empty result from a ready result", async () => {
    const empty = await loadOperationalState(async () => [] as string[], (items) => items.length === 0);
    const ready = await loadOperationalState(async () => ["item"], (items) => items.length === 0);

    expect(empty).toMatchObject({ state: "empty", data: [] });
    expect(ready).toMatchObject({ state: "ready", data: ["item"] });
  });
});
