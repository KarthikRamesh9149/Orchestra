import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateStatus,
  assertNoForbiddenClientFields,
  buildConfig,
  buildDryRunText,
  buildMarkdownReport,
  collectForbiddenClientFields,
  finalizeReport,
  loadFixtures,
  parseArgs,
  parseBoolean,
  parseSse,
  reportPathsForMode,
  requireAllowedStatus,
  requireSocratesDonePayload,
  requireStringPath,
  redact,
  runSmoke,
  writeReport
} from "../scripts/smoke/backend-launch-loop.js";

describe("backend launch-loop smoke helpers", () => {
  it("parses CLI flags and smoke env defaults", () => {
    expect(parseArgs(["--mode=mock", "--json", "--verbose", "--keep-data", "--simulate-ai-provider-failure", "--assert-telemetry"])).toMatchObject({
      mode: "mock",
      json: true,
      verbose: true,
      keepData: true,
      simulateAiProviderFailure: true,
      assertTelemetry: true
    });

    const config = buildConfig(
      {
        SMOKE_BASE_URL: "http://localhost:4000/",
        SMOKE_KEEP_DATA: "true",
        SMOKE_EXPECT_AI: "false",
        SMOKE_EXPECT_WORKER: "false",
        SMOKE_CLIENT_PORTAL: "false"
      },
      { mode: "http", dryRun: false, json: false, verbose: false }
    );

    expect(config.baseUrl).toBe("http://localhost:4000");
    expect(config.keepData).toBe(true);
    expect(config.expectAi).toBe(false);
    expect(config.expectWorker).toBe(false);
    expect(config.clientPortal).toBe(false);
    expect(parseBoolean("yes", false)).toBe(true);
    expect(parseBoolean(undefined, true)).toBe(true);
  });

  it("redacts tokens, authorization headers, credential refs, API keys, and secrets recursively", () => {
    const output = redact({
      accessToken: "access",
      refreshToken: "refresh",
      Authorization: "Bearer access",
      client: { token: "raw-client-token", credentialsRef: "vault:secret" },
      nested: [{ apiKey: "key" }, { normal: "visible" }],
      managerPassword: "Password123!",
      providerSecret: "provider-secret"
    });

    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain("Bearer access");
    expect(serialized).not.toContain("raw-client-token");
    expect(serialized).not.toContain("vault:secret");
    expect(serialized).not.toContain("provider-secret");
    expect(serialized).not.toContain("Password123!");
    expect(serialized).toContain("visible");
  });

  it("parses Socrates SSE event streams", () => {
    const events = parseSse(
      'event: message_created\ndata: {"id":"message-1"}\n\nevent: delta\ndata: {"text":"hello"}\n\nevent: done\ndata: {"citations":[],"open_targets":[]}\n\n'
    );

    expect(events.map((event) => event.event)).toEqual(["message_created", "delta", "done"]);
    expect(events[0]?.data).toEqual({ id: "message-1" });
  });

  it("requires exact response paths instead of recursively accepting nested IDs", () => {
    const response = { data: { nested: { id: "wrong-id" } } };

    expect(() => requireStringPath(response, ["id"], "top-level id")).toThrow(/top-level id missing string/);
    expect(requireStringPath(response, ["data", "nested", "id"], "nested id")).toBe("wrong-id");
  });

  it("rejects missing or accepted proposal status before acceptance", () => {
    expect(requireAllowedStatus({ status: "needs_review" }, ["status"], ["needs_review", "detected"], "proposal")).toBe(
      "needs_review"
    );
    expect(() => requireAllowedStatus({ status: "accepted" }, ["status"], ["needs_review", "detected"], "proposal")).toThrow(
      /was not one of/
    );
    expect(() => requireAllowedStatus({}, ["status"], ["needs_review", "detected"], "proposal")).toThrow(/missing string/);
  });

  it("requires Socrates done payloads to include citations and open targets", () => {
    const valid = parseSse(
      'event: message_created\ndata: {"id":"message-1"}\n\nevent: done\ndata: {"answer_md":"Grounded answer text","citations":[{"type":"document_section","refId":"section-1"}],"open_targets":[{"targetType":"document_section","targetRef":{"documentId":"doc-1","anchorId":"a1"}}],"suggested_prompts":[],"confidence":"high","limitations":[]}\n\n'
    );
    const malformed = parseSse('event: done\ndata: {"answer_md":"short","citations":[],"open_targets":[]}\n\n');

    expect(requireSocratesDonePayload(valid, "valid answer")).toHaveProperty("answer_md");
    expect(() => requireSocratesDonePayload(malformed, "malformed answer")).toThrow(/too short|did not return citations/);
  });

  it("detects forbidden internal fields in client-safe responses", () => {
    const safe = { documents: [{ id: "doc-1", title: "Shared PRD" }] };
    const unsafe = { project: { source: { providerMessageId: "msg-provider-id" } } };

    expect(collectForbiddenClientFields(safe)).toEqual([]);
    expect(collectForbiddenClientFields(unsafe)).toEqual(["$.project.source.providerMessageId"]);
    expect(() => assertNoForbiddenClientFields(unsafe, "client response")).toThrow(/leaked internal fields/);
  });

  it("loads launch-loop fixtures and validates route plan size through dry-run text", async () => {
    const config = buildConfig({}, { mode: "mock", dryRun: true, json: false, verbose: false });
    const fixtures = await loadFixtures(config);
    const dryRunText = buildDryRunText(config);

    expect(fixtures.documentText).toContain("reporting");
    expect(fixtures.manualImport).toHaveProperty("thread");
    expect(dryRunText).toContain("SMOKE_BASE_URL");
    expect(dryRunText).toContain("POST /v1/projects/:projectId/communications/import");
  });

  it("aggregates step status and writes redacted JSON/Markdown reports", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "orchestra-smoke-test-"));
    try {
      const config = {
        ...buildConfig({}, { mode: "mock", dryRun: false, json: false, verbose: false }),
        reportJsonPath: path.join(tempDir, "report.json"),
        reportMarkdownPath: path.join(tempDir, "report.md")
      };
      const report = {
        runId: "run-1",
        mode: "mock" as const,
        proofLevel: "mock" as const,
        baseUrl: "http://localhost",
        startedAt: "2026-05-11T00:00:00.000Z",
        finishedAt: "2026-05-11T00:00:01.000Z",
        status: "degraded" as const,
        launchLoopProven: false,
        canBeUsedForLaunchProof: false,
        executedHttpRequests: 0,
        plannedRoutesCount: 49,
        executedRoutesCount: 0,
        env: { accessToken: "secret", normal: "visible" },
        steps: [
          {
            name: "mock",
            status: "degraded" as const,
            startedAt: "2026-05-11T00:00:00.000Z",
            finishedAt: "2026-05-11T00:00:01.000Z",
            durationMs: 1000,
            routes: [],
            assertions: ["asserted"],
            createdIds: {},
            degradedNotes: ["mock only"],
            failures: []
          }
        ],
        created: { rawToken: "secret" },
        createdEntityIds: { rawToken: "secret" },
        routeCoverage: [],
        assertions: ["mock: asserted"],
        proof: {},
        degradedDependencies: ["mock only"],
        failures: [],
        environmentBlockers: [],
        rerunCommand: "npm run smoke:backend:mock"
      };

      expect(aggregateStatus(report.steps)).toBe("degraded");
      expect(
        aggregateStatus([
          {
            name: "critical degraded step",
            status: "degraded",
            startedAt: "2026-05-11T00:00:00.000Z",
            finishedAt: "2026-05-11T00:00:01.000Z",
            durationMs: 1000,
            routes: [],
            assertions: [],
            createdIds: {},
            degradedNotes: ["critical dependency missing"],
            failures: []
          }
        ])
      ).not.toBe("passed");
      expect(buildMarkdownReport(report)).toContain("Backend Launch-Loop Smoke Report");
      await writeReport(config, report);
      const json = await readFile(config.reportJsonPath, "utf8");
      const markdown = await readFile(config.reportMarkdownPath, "utf8");
      expect(json).not.toContain("secret");
      expect(markdown).toContain("mock only");
      expect(markdown).toContain("Can be used for launch proof: NO");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("dry-run report is diagnostic only and not launch proof", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "orchestra-smoke-dry-run-"));
    try {
      const report = await runSmoke({
        ...buildConfig({}, { dryRun: true, json: false, verbose: false }),
        reportJsonPath: path.join(tempDir, "dry-run-report.json"),
        reportMarkdownPath: path.join(tempDir, "dry-run-report.md")
      });
      const markdown = buildMarkdownReport(report);

      expect(report.mode).toBe("dry-run");
      expect(report.status).toBe("diagnostic");
      expect(report.proofLevel).toBe("diagnostic");
      expect(report.launchLoopProven).toBe(false);
      expect(report.canBeUsedForLaunchProof).toBe(false);
      expect(report.executedRoutesCount).toBe(0);
      expect(report.executedHttpRequests).toBe(0);
      expect(markdown).toContain("This report did not prove the real HTTP launch loop");
      expect(markdown).toMatch(/- Mode: dry-run\r?\n- Status: diagnostic/);
      expect(markdown).not.toContain("Mode: http");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("mock mode completes as mock-only without proving DB/API integration", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "orchestra-smoke-mock-"));
    try {
      const report = await runSmoke({
        ...buildConfig({}, { mode: "mock", dryRun: false, json: false, verbose: false }),
        reportJsonPath: path.join(tempDir, "report.json"),
        reportMarkdownPath: path.join(tempDir, "report.md")
      });

      expect(report.mode).toBe("mock");
      expect(report.status).toBe("mock_passed");
      expect(report.proofLevel).toBe("mock");
      expect(report.launchLoopProven).toBe(false);
      expect(report.canBeUsedForLaunchProof).toBe(false);
      expect(report.executedHttpRequests).toBe(0);
      expect(report.degradedDependencies.join(" ")).toContain("DB/API integration was not proven");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  function makeHttpReport(overrides: Partial<ReturnType<typeof finalizeReport>> = {}) {
    return finalizeReport({
      runId: "run-http",
      mode: "http",
      proofLevel: "http",
      baseUrl: "http://localhost",
      startedAt: "2026-05-11T00:00:00.000Z",
      finishedAt: "2026-05-11T00:00:01.000Z",
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
    });
  }

  it("HTTP report cannot pass with zero executed routes or requests", () => {
    const report = makeHttpReport({ routeCoverage: [], executedRoutesCount: 0, executedHttpRequests: 0 });

    expect(report.status).toBe("failed");
    expect(report.launchLoopProven).toBe(false);
    expect(report.canBeUsedForLaunchProof).toBe(false);
    expect(report.failures.join(" ")).toContain("executed HTTP requests");
  });

  it("HTTP report cannot pass without created IDs and Product Brain version increment", () => {
    const report = makeHttpReport({
      created: { projectId: "project-1", brainVersionBefore: "2", brainVersionAfter: "2" }
    });

    expect(report.status).toBe("failed");
    expect(report.launchLoopProven).toBe(false);
    expect(report.failures.join(" ")).toContain("created.documentId");
    expect(report.failures.join(" ")).toContain("Product Brain version increment");
  });

  it("HTTP report cannot pass without Socrates citations and open targets", () => {
    const report = makeHttpReport({
      env: { expectAi: true },
      proof: {
        dashboardFreshnessVerified: true,
        dashboardPressureVerified: true,
        clientLeakChecksPassed: true
      }
    });

    expect(report.status).toBe("failed");
    expect(report.launchLoopProven).toBe(false);
    expect(report.failures.join(" ")).toContain("Socrates current-truth citations/openTargets");
    expect(report.failures.join(" ")).toContain("Socrates provenance citations/openTargets");
  });

  it("HTTP demo report can degrade without Socrates citations when AI is not expected", () => {
    const report = makeHttpReport({
      env: { expectAi: false },
      proof: {
        dashboardFreshnessVerified: true,
        dashboardPressureVerified: true,
        clientLeakChecksPassed: true
      },
      degradedDependencies: ["Socrates answer was not fully grounded; SMOKE_EXPECT_AI=false"]
    });

    expect(report.status).toBe("degraded");
    expect(report.launchLoopProven).toBe(false);
    expect(report.canBeUsedForLaunchProof).toBe(false);
    expect(report.failures.join(" ")).not.toContain("Socrates current-truth citations/openTargets");
    expect(report.failures.join(" ")).not.toContain("Socrates provenance citations/openTargets");
  });

  it("HTTP report can pass only with complete semantic proof", () => {
    const report = makeHttpReport({ env: { expectAi: true } });

    expect(report.status).toBe("passed");
    expect(report.proofLevel).toBe("http");
    expect(report.launchLoopProven).toBe(true);
    expect(report.canBeUsedForLaunchProof).toBe(true);
  });

  it("report paths are mode-specific", () => {
    expect(path.basename(reportPathsForMode("dry-run").markdown)).toBe("backend-launch-loop-dry-run-report.md");
    expect(path.basename(reportPathsForMode("mock").markdown)).toBe("backend-launch-loop-mock-report.md");
    expect(path.basename(reportPathsForMode("http").markdown)).toBe("backend-launch-loop-http-report.md");
  });
});
