import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFirefliesSmokeConfig,
  runFirefliesConnectorSmoke
} from "../scripts/smoke/fireflies-connector-smoke.js";

describe("Fireflies connector smoke harness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs dry-run diagnostics without claiming live provider proof", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fireflies-smoke-dry-run-"));
    try {
      const config = buildFirefliesSmokeConfig({}, { dryRun: true, mode: undefined, json: false, verbose: false });
      config.reportJsonPath = path.join(tempRoot, "dry-run.json");
      config.reportMarkdownPath = path.join(tempRoot, "dry-run.md");

      const report = await runFirefliesConnectorSmoke(config);

      expect(report.status).toBe("diagnostic");
      expect(report.proofLevel).toBe("diagnostic");
      expect(report.canBeUsedForFirefliesLaunchProof).toBe(false);
      expect(report.routePlan).toEqual(expect.arrayContaining([expect.stringContaining("/v1/webhooks/fireflies")]));
      expect(await readFile(config.reportJsonPath, "utf8")).toContain("\"mode\": \"dry-run\"");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("treats blank optional smoke env placeholders as absent when building config", () => {
    const config = buildFirefliesSmokeConfig(
      {
        FIREFLIES_SMOKE_BASE_URL: "",
        SMOKE_BASE_URL: "https://backend.example.test",
        FIREFLIES_SMOKE_MANAGER_EMAIL: "",
        SMOKE_MANAGER_EMAIL: "manager@example.com",
        FIREFLIES_SMOKE_MANAGER_PASSWORD: "",
        SMOKE_MANAGER_PASSWORD: "secret-password",
        FIREFLIES_SMOKE_PROJECT_ID: "",
        SMOKE_PROJECT_ID: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
        FIREFLIES_SMOKE_TRANSCRIPT_ID: ""
      },
      { dryRun: false, mode: "http", json: false, verbose: false }
    );

    expect(config.baseUrl).toBe("https://backend.example.test");
    expect(config.managerEmail).toBe("manager@example.com");
    expect(config.managerPassword).toBe("secret-password");
    expect(config.projectId).toBe("37e6d602-cc1b-4cc9-bc6c-5547241fbf90");
    expect(config.transcriptId).toBeNull();
  });

  it("runs mock proof without leaking Fireflies credentials into reports", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fireflies-smoke-mock-"));
    try {
      const config = buildFirefliesSmokeConfig({}, { dryRun: false, mode: "mock", json: false, verbose: false });
      config.reportJsonPath = path.join(tempRoot, "mock.json");
      config.reportMarkdownPath = path.join(tempRoot, "mock.md");

      const report = await runFirefliesConnectorSmoke(config);
      const serialized = await readFile(config.reportJsonPath, "utf8");

      expect(report.status).toBe("mock_passed");
      expect(report.proofLevel).toBe("mock");
      expect(report.canBeUsedForFirefliesLaunchProof).toBe(false);
      expect(serialized).not.toContain("mock-fireflies-api-key");
      expect(serialized).not.toContain("mock-fireflies-webhook-secret");
      expect(serialized).not.toContain("download.fireflies.ai");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not convert shallow HTTP diagnostics into Fireflies launch proof", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "fireflies-smoke-http-"));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const pathName = new URL(String(url)).pathname;
      const method = String(init?.method ?? "GET").toUpperCase();
      if (pathName === "/v1/auth/login" && method === "POST") {
        return new Response(JSON.stringify({ data: { accessToken: "manager-token" } }), { status: 200 });
      }
      if (pathName.endsWith("/connectors/readiness")) {
        return new Response(JSON.stringify({ data: [{ provider: "fireflies_ai", state: "enabled" }] }), { status: 200 });
      }
      if (pathName.endsWith("/connectors/fireflies_ai/connect") && method === "POST") {
        return new Response(JSON.stringify({ data: { connectorId: "connector-fireflies" } }), { status: 200 });
      }
      if (pathName.endsWith("/connectors/connector-fireflies") && method === "GET") {
        return new Response(JSON.stringify({ data: { id: "connector-fireflies", provider: "fireflies_ai" } }), { status: 200 });
      }
      if (pathName.endsWith("/connectors/connector-fireflies/sync") && method === "POST") {
        return new Response(JSON.stringify({ data: { syncRunId: "sync-fireflies" } }), { status: 200 });
      }
      if (pathName.endsWith("/communications/timeline")) {
        return new Response(JSON.stringify({ data: [{ provider: "fireflies_ai", id: "stale-row" }] }), { status: 200 });
      }
      if (pathName.endsWith("/dashboard")) {
        return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected smoke request" }), { status: 404 });
    });

    try {
      const config = buildFirefliesSmokeConfig(
        {
          FIREFLIES_SMOKE_BASE_URL: "https://api.example.test",
          FIREFLIES_SMOKE_MANAGER_EMAIL: "manager@example.com",
          FIREFLIES_SMOKE_MANAGER_PASSWORD: "password",
          FIREFLIES_SMOKE_PROJECT_ID: "37e6d602-cc1b-4cc9-bc6c-5547241fbf90",
          FIREFLIES_SMOKE_EXPECT_LIVE_API: "true"
        },
        { dryRun: false, mode: "http", json: false, verbose: false }
      );
      config.reportJsonPath = path.join(tempRoot, "http.json");
      config.reportMarkdownPath = path.join(tempRoot, "http.md");

      const report = await runFirefliesConnectorSmoke(config);

      expect(fetchMock).toHaveBeenCalled();
      expect(report.proofLevel).toBe("http");
      expect(report.firefliesLiveProviderProven).toBe(false);
      expect(report.canBeUsedForFirefliesLaunchProof).toBe(false);
      expect(report.proof).toMatchObject({
        fullLaunchProofChecklist: expect.objectContaining({
          exercised: false
        })
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
