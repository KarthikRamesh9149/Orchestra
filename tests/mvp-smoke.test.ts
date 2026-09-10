import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MVP_SMOKE_STEP_PLAN,
  buildMarkdownReport,
  buildMvpSmokeConfig,
  finalizeMvpSmokeReport,
  MvpHttpRunner,
  parseArgs,
  reportPathsForMode,
  runMvpSmoke,
  type StepResult
} from "../scripts/smoke/mvp-smoke.js";

describe("MVP smoke harness", () => {
  it("parses modes and builds mode-specific report paths", () => {
    expect(parseArgs(["--mode=mock", "--json", "--verbose", "--keep-data"])).toMatchObject({
      mode: "mock",
      json: true,
      verbose: true,
      keepData: true
    });
    expect(path.basename(reportPathsForMode("dry-run").json)).toBe("mvp-dry-run-report.json");
    expect(path.basename(reportPathsForMode("mock").markdown)).toBe("mvp-mock-report.md");
    expect(path.basename(reportPathsForMode("http").json)).toBe("mvp-http-report.json");
  });

  it("dry-run report is diagnostic only and not launch proof", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mvp-smoke-dry-run-"));
    try {
      const report = await runMvpSmoke({
        ...buildMvpSmokeConfig({}, { dryRun: true, json: false, verbose: false }),
        reportJsonPath: path.join(tempDir, "dry-run.json"),
        reportMarkdownPath: path.join(tempDir, "dry-run.md")
      });
      const markdown = await readFile(path.join(tempDir, "dry-run.md"), "utf8");

      expect(report.mode).toBe("dry-run");
      expect(report.proofLevel).toBe("diagnostic");
      expect(report.status).toBe("diagnostic");
      expect(report.launchLoopProven).toBe(false);
      expect(report.canBeUsedForLaunchProof).toBe(false);
      expect(report.executedHttpRequests).toBe(0);
      expect(report.executedStepsCount).toBe(0);
      expect(markdown).toContain("Dry-run and mock reports are diagnostics only");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("mock report validates MVP shape without claiming launch proof", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mvp-smoke-mock-"));
    try {
      const report = await runMvpSmoke({
        ...buildMvpSmokeConfig({}, { mode: "mock", dryRun: false, json: false, verbose: false }),
        reportJsonPath: path.join(tempDir, "mock.json"),
        reportMarkdownPath: path.join(tempDir, "mock.md")
      });

      expect(report.mode).toBe("mock");
      expect(report.proofLevel).toBe("mock");
      expect(report.status).toBe("mock_passed");
      expect(report.launchLoopProven).toBe(false);
      expect(report.canBeUsedForLaunchProof).toBe(false);
      expect(report.executedHttpRequests).toBe(0);
      expect(report.executedStepsCount).toBe(MVP_SMOKE_STEP_PLAN.length);
      expect(report.assertions).toContain("MVP provider gating verified");
      expect(report.assertions).toContain("client/internal leak checks passed");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  function httpReport(overrides: Partial<ReturnType<typeof finalizeMvpSmokeReport>> = {}) {
    return finalizeMvpSmokeReport({
      runId: "mvp-http",
      mode: "http",
      proofLevel: "http",
      status: "passed",
      launchLoopProven: false,
      canBeUsedForLaunchProof: false,
      executedHttpRequests: 2,
      plannedStepsCount: MVP_SMOKE_STEP_PLAN.length,
      executedStepsCount: MVP_SMOKE_STEP_PLAN.length,
      baseUrl: "http://127.0.0.1:3000",
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
        agentContextPackId: "pack-1",
        agentRunId: "run-1",
        agentPackQualityReviewId: "pack-review-1",
        agentRunQualityReviewId: "run-review-1",
        mcpTokenId: "mcp-token-1",
        diagramId: "diagram-1",
        liveDocSectionKey: "overview",
        codingRequirementsId: "coding-1",
        responsibilityId: "responsibility-1",
        socratesSessionId: "session-1",
        agentFileSetId: "agent-file-set-1",
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
    });
  }

  it("HTTP report cannot pass with zero requests", () => {
    const report = httpReport({ routeCoverage: [], executedHttpRequests: 0 });
    expect(report.status).toBe("failed");
    expect(report.launchLoopProven).toBe(false);
    expect(report.failures.join(" ")).toContain("executed HTTP requests");
  });

  it("HTTP report cannot pass without required IDs", () => {
    const report = httpReport({ created: { projectId: "project-1" } });
    expect(report.status).toBe("failed");
    expect(report.failures.join(" ")).toContain("created.documentId");
    expect(report.failures.join(" ")).toContain("created.socratesActionId");
  });

  it("HTTP report cannot pass without Socrates citations/openTargets", () => {
    const report = httpReport({ assertions: ["MVP provider gating verified", "client/internal leak checks passed", "response secret scan passed"] });
    expect(report.status).toBe("failed");
    expect(report.failures.join(" ")).toContain("Socrates citations/openTargets");
  });

  it("HTTP report can pass only with complete semantic proof", () => {
    const report = httpReport();
    expect(report.status).toBe("passed");
    expect(report.launchLoopProven).toBe(true);
    expect(report.canBeUsedForLaunchProof).toBe(true);
  });

  it("HTTP response secret scan ignores expected auth token responses but still catches application leaks", async () => {
    const originalFetch = globalThis.fetch;
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "mvp-smoke-secret-scan-"));
    try {
      const step: StepResult = { id: "secret_scan", title: "secret scan", status: "passed", assertions: [], failures: [], routes: [] };
      const runner = new MvpHttpRunner({
        ...buildMvpSmokeConfig({}, { mode: "http", dryRun: false, json: false, verbose: false }),
        reportJsonPath: path.join(tempDir, "http.json"),
        reportMarkdownPath: path.join(tempDir, "http.md")
      });

      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ data: { accessToken: "access-token-value", refreshToken: "refresh-token-value" }, error: null }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })) as typeof fetch;

      await runner.request(step, "POST", "/v1/auth/login", { email: "manager@orchestra.local", password: "Password123!" }, { scanResponse: false });
      runner.assertNoSecrets(step);

      await runner.request(step, "GET", "/v1/projects/project-1/dashboard");
      expect(() => runner.assertNoSecrets(step)).toThrow(/sensitive-looking response data/);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("markdown warns dry-run and mock are not launch proof", () => {
    const markdown = buildMarkdownReport(httpReport({ mode: "mock", proofLevel: "mock", status: "mock_passed" }));
    expect(markdown).toContain("Dry-run and mock reports are diagnostics only");
  });
});
