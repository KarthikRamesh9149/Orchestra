import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHttpSmokePreflightConfig,
  buildPreflightMarkdown,
  runHttpSmokePreflight
} from "../scripts/smoke/http-smoke-preflight.js";
import {
  buildMarkdownReport as buildBackendMarkdownReport,
  finalizeReport,
  shouldFailSmokeProcess
} from "../scripts/smoke/backend-launch-loop.js";
import {
  MVP_SMOKE_STEP_PLAN,
  buildMarkdownReport as buildMvpMarkdownReport,
  finalizeMvpSmokeReport,
  shouldFailMvpSmokeProcess
} from "../scripts/smoke/mvp-smoke.js";

function backendHttpReport(overrides: Record<string, unknown> = {}) {
  return finalizeReport({
    runId: "backend-http-proof-test",
    mode: "http",
    proofLevel: "http",
    baseUrl: "https://staging.example.test",
    startedAt: "2026-05-20T00:00:00.000Z",
    finishedAt: "2026-05-20T00:00:01.000Z",
    status: "passed",
    launchLoopProven: false,
    canBeUsedForLaunchProof: false,
    executedHttpRequests: 2,
    plannedRoutesCount: 49,
    executedRoutesCount: 2,
    env: {},
    steps: [],
    created: {
      projectId: "project-1",
      documentId: "document-1",
      messageId: "message-1",
      proposalId: "proposal-1",
      brainVersionBefore: "1",
      brainVersionAfter: "2"
    },
    createdEntityIds: {},
    routeCoverage: [
      { method: "GET", path: "/health", statusCode: 200, ok: true },
      { method: "POST", path: "/v1/projects", statusCode: 200, ok: true }
    ],
    assertions: [],
    proof: {
      socratesCurrentTruthCitations: 1,
      socratesCurrentTruthOpenTargets: 1,
      socratesProvenanceCitations: 1,
      socratesProvenanceOpenTargets: 1,
      dashboardFreshnessVerified: true,
      dashboardPressureVerified: true,
      clientLeakChecksPassed: true
    },
    degradedDependencies: [],
    failures: [],
    environmentBlockers: [],
    rerunCommand: "npm run smoke:backend:http",
    ...overrides
  } as Parameters<typeof finalizeReport>[0]);
}

function mvpHttpReport(overrides: Record<string, unknown> = {}) {
  return finalizeMvpSmokeReport({
    runId: "mvp-http-proof-test",
    mode: "http",
    proofLevel: "http",
    status: "passed",
    launchLoopProven: false,
    canBeUsedForLaunchProof: false,
    executedHttpRequests: 2,
    plannedStepsCount: MVP_SMOKE_STEP_PLAN.length,
    executedStepsCount: MVP_SMOKE_STEP_PLAN.length,
    baseUrl: "https://staging.example.test",
    startedAt: "2026-05-20T00:00:00.000Z",
    finishedAt: "2026-05-20T00:00:01.000Z",
    created: {
      projectId: "project-1",
      memberId: "member-1",
      documentId: "doc-1",
      documentVersionId: "docv-1",
      generatedPrdDocumentId: "prd-1",
      generatedSrsDocumentId: "srs-1",
      contextId: "context-1",
      imageContextId: "image-context-1",
      transcriptId: "thread-1",
      diagramId: "diagram-1",
      liveDocSectionKey: "overview",
      codingRequirementsId: "coding-1",
      responsibilityId: "responsibility-1",
      socratesSessionId: "session-1",
      socratesActionId: "action-1",
      calendarEventId: "event-1"
    },
    assertions: [
      "socrates citations and openTargets verified",
      "MVP provider gating verified",
      "MVP advanced ops gating verified",
      "client/internal leak checks passed",
      "response secret scan passed"
    ],
    routeCoverage: [
      { method: "GET", path: "/health", statusCode: 200, ok: true },
      { method: "POST", path: "/v1/projects", statusCode: 200, ok: true }
    ],
    steps: [],
    failures: [],
    degradedDependencies: [],
    environmentBlockers: [],
    rerunCommand: "npm run smoke:mvp:http",
    ...overrides
  } as Parameters<typeof finalizeMvpSmokeReport>[0]);
}

describe("HTTP smoke proof readiness", () => {
  it("preflight reports missing staging env as blocking and not launch proof", async () => {
    const report = await runHttpSmokePreflight(buildHttpSmokePreflightConfig({}, { json: false, verbose: false, allowLocalhost: false }));
    const markdown = buildPreflightMarkdown(report);

    expect(report.mode).toBe("preflight");
    expect(report.proofLevel).toBe("readiness_check");
    expect(report.canRunBackendHttpSmoke).toBe(false);
    expect(report.canRunMvpHttpSmoke).toBe(false);
    expect(report.blockingReasons.join(" ")).toContain("SMOKE_BASE_URL");
    expect(report.blockingReasons.join(" ")).toContain("MVP_SMOKE_BASE_URL or SMOKE_BASE_URL");
    expect(markdown).toContain("not launch proof");
  });

  it("preflight blocks backend HTTP smoke when SMOKE_BASE_URL is absent", async () => {
    const report = await runHttpSmokePreflight(
      buildHttpSmokePreflightConfig(
        {
          SMOKE_MANAGER_EMAIL: "manager@example.test",
          SMOKE_MANAGER_PASSWORD: "Password123!",
          SMOKE_DEV_EMAIL: "dev@example.test",
          SMOKE_DEV_PASSWORD: "Password123!",
          SMOKE_CLIENT_EMAIL: "client@example.test",
          SMOKE_CLIENT_PASSWORD: "Password123!"
        },
        { json: false, verbose: false, allowLocalhost: false }
      )
    );

    expect(report.canRunBackendHttpSmoke).toBe(false);
    expect(report.blockingReasons).toContain("SMOKE_BASE_URL is required before real HTTP smoke can run");
  });

  it("preflight blocks MVP HTTP smoke when MVP smoke credentials are absent", async () => {
    const report = await runHttpSmokePreflight(
      buildHttpSmokePreflightConfig(
        {
          MVP_SMOKE_BASE_URL: "https://staging.example.test"
        },
        { json: false, verbose: false, allowLocalhost: false }
      )
    );

    expect(report.canRunMvpHttpSmoke).toBe(false);
    expect(report.blockingReasons.join(" ")).toContain("MVP_SMOKE_MANAGER_EMAIL or SMOKE_MANAGER_EMAIL");
  });

  it("preflight blocks missing fixture paths before probing HTTP", async () => {
    const missingPath = path.join(os.tmpdir(), "missing-smoke-fixture.md");
    const report = await runHttpSmokePreflight(
      buildHttpSmokePreflightConfig(
        {
          SMOKE_BASE_URL: "https://staging.example.test",
          SMOKE_MANAGER_EMAIL: "manager@example.test",
          SMOKE_MANAGER_PASSWORD: "Password123!",
          SMOKE_DEV_EMAIL: "dev@example.test",
          SMOKE_DEV_PASSWORD: "Password123!",
          SMOKE_CLIENT_EMAIL: "client@example.test",
          SMOKE_CLIENT_PASSWORD: "Password123!",
          MVP_SMOKE_MANAGER_EMAIL: "manager@example.test",
          MVP_SMOKE_MANAGER_PASSWORD: "Password123!",
          MVP_SMOKE_DEV_EMAIL: "dev@example.test",
          MVP_SMOKE_DEV_PASSWORD: "Password123!",
          MVP_SMOKE_CLIENT_EMAIL: "client@example.test",
          MVP_SMOKE_CLIENT_PASSWORD: "Password123!",
          MVP_SMOKE_BASE_URL: "http://127.0.0.1:3000",
          SMOKE_DOCUMENT_PATH: missingPath
        },
        { json: false, verbose: false, allowLocalhost: false }
      )
    );

    expect(report.canRunBackendHttpSmoke).toBe(false);
    expect(report.checkedUrls).toEqual([]);
    expect(report.blockingReasons.join(" ")).toContain("SMOKE_DOCUMENT_PATH does not exist");
  });

  it("preflight blocks localhost base URLs unless explicitly allowed", async () => {
    const report = await runHttpSmokePreflight(
      buildHttpSmokePreflightConfig(
        {
          SMOKE_BASE_URL: "http://127.0.0.1:3000",
          SMOKE_MANAGER_EMAIL: "manager@example.test",
          SMOKE_MANAGER_PASSWORD: "Password123!",
          SMOKE_DEV_EMAIL: "dev@example.test",
          SMOKE_DEV_PASSWORD: "Password123!",
          SMOKE_CLIENT_EMAIL: "client@example.test",
          SMOKE_CLIENT_PASSWORD: "Password123!"
        },
        { json: false, verbose: false, allowLocalhost: false }
      )
    );

    expect(report.canRunBackendHttpSmoke).toBe(false);
    expect(report.blockingReasons.join(" ")).toContain("points to localhost");
  });

  it("backend and MVP dry-run/mock reports cannot be process success if status failed, and HTTP degraded exits non-zero", () => {
    expect(shouldFailSmokeProcess("dry-run", true, "diagnostic")).toBe(false);
    expect(shouldFailSmokeProcess("mock", false, "mock_passed")).toBe(false);
    expect(shouldFailSmokeProcess("http", false, "degraded")).toBe(true);
    expect(shouldFailSmokeProcess("http", false, "failed")).toBe(true);
    expect(shouldFailSmokeProcess("http", false, "passed")).toBe(false);

    expect(shouldFailMvpSmokeProcess("dry-run", "diagnostic")).toBe(false);
    expect(shouldFailMvpSmokeProcess("mock", "mock_passed")).toBe(false);
    expect(shouldFailMvpSmokeProcess("http", "degraded")).toBe(true);
    expect(shouldFailMvpSmokeProcess("http", "failed")).toBe(true);
    expect(shouldFailMvpSmokeProcess("http", "passed")).toBe(false);
  });

  it("degraded HTTP reports cannot claim launch proof", () => {
    const backend = backendHttpReport({ status: "degraded", degradedDependencies: ["worker unavailable"] });
    const mvp = mvpHttpReport({ status: "degraded", degradedDependencies: ["AI unavailable"] });

    expect(backend.launchLoopProven).toBe(false);
    expect(backend.canBeUsedForLaunchProof).toBe(false);
    expect(backend.status).toBe("degraded");
    expect(mvp.launchLoopProven).toBe(false);
    expect(mvp.canBeUsedForLaunchProof).toBe(false);
    expect(mvp.status).toBe("degraded");
  });

  it("dry-run and mock markdown remain explicit diagnostics, not launch proof", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "http-smoke-proof-docs-"));
    try {
      const backendMarkdown = buildBackendMarkdownReport(backendHttpReport({ mode: "mock", proofLevel: "mock", status: "mock_passed" }));
      const mvpMarkdown = buildMvpMarkdownReport(mvpHttpReport({ mode: "mock", proofLevel: "mock", status: "mock_passed" }));

      expect(backendMarkdown).toContain("This report did not prove the real HTTP launch loop");
      expect(mvpMarkdown).toContain("Dry-run and mock reports are diagnostics only");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
