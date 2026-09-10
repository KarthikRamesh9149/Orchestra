import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FirefliesProvider, signFirefliesConnectorScope, verifyFirefliesSignature } from "../../src/modules/communications/providers/fireflies.provider.js";

type FirefliesSmokeMode = "dry-run" | "mock" | "http";
type FirefliesProofLevel = "diagnostic" | "mock" | "http";
type FirefliesSmokeStatus = "diagnostic" | "diagnostic_passed" | "mock_passed" | "passed" | "failed" | "readiness_gated";

interface FirefliesSmokeConfig {
  mode: FirefliesSmokeMode;
  dryRun: boolean;
  json: boolean;
  verbose: boolean;
  baseUrl: string;
  managerEmail: string;
  managerPassword: string;
  projectId: string;
  transcriptId: string | null;
  expectLiveApi: boolean;
  expectWebhook: boolean;
  keepData: boolean;
  reportJsonPath: string;
  reportMarkdownPath: string;
}

interface FirefliesSmokeStep {
  name: string;
  status: FirefliesSmokeStatus;
  assertions: string[];
  failures: string[];
}

interface FirefliesSmokeReport {
  runId: string;
  mode: FirefliesSmokeMode;
  proofLevel: FirefliesProofLevel;
  status: FirefliesSmokeStatus;
  startedAt: string;
  finishedAt: string;
  baseUrl: string;
  firefliesLiveProviderProven: boolean;
  canBeUsedForFirefliesLaunchProof: boolean;
  requiredEnv: string[];
  routePlan: string[];
  steps: FirefliesSmokeStep[];
  proof: Record<string, unknown>;
  environmentBlockers: string[];
  failures: string[];
  reportJsonPath: string;
  reportMarkdownPath: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

export const FIREFLIES_SMOKE_ENV_KEYS = [
  "FIREFLIES_READINESS_MODE",
  "FIREFLIES_API_BASE_URL",
  "FIREFLIES_API_KEY",
  "FIREFLIES_WEBHOOK_SECRET",
  "FIREFLIES_SYNC_BATCH_SIZE",
  "FIREFLIES_SYNC_MAX_BACKFILL_DAYS",
  "FIREFLIES_SYNC_TIMEOUT_MS",
  "FIREFLIES_ALLOW_RECORDING_URLS",
  "FIREFLIES_ALLOW_TRANSCRIPT_PROVIDER_URLS",
  "FIREFLIES_SMOKE_BASE_URL",
  "FIREFLIES_SMOKE_MANAGER_EMAIL",
  "FIREFLIES_SMOKE_MANAGER_PASSWORD",
  "FIREFLIES_SMOKE_PROJECT_ID",
  "FIREFLIES_SMOKE_TRANSCRIPT_ID",
  "FIREFLIES_SMOKE_EXPECT_LIVE_API",
  "FIREFLIES_SMOKE_EXPECT_WEBHOOK",
  "FIREFLIES_SMOKE_KEEP_DATA"
] as const;

export const FIREFLIES_ROUTE_PLAN = [
  "GET /v1/projects/:projectId/connectors/readiness",
  "POST /v1/projects/:projectId/connectors/fireflies_ai/connect",
  "GET /v1/projects/:projectId/connectors/:connectorId",
  "POST /v1/projects/:projectId/connectors/:connectorId/sync",
  "POST /v1/projects/:projectId/communications/import (provider=fireflies_ai)",
  "POST /v1/webhooks/fireflies",
  "GET /v1/projects/:projectId/communications/timeline?provider=fireflies_ai",
  "GET /v1/projects/:projectId/threads/:threadId",
  "GET /v1/projects/:projectId/messages/:messageId",
  "POST /v1/projects/:projectId/messages/:messageId/classify",
  "GET /v1/projects/:projectId/communication-review",
  "GET /v1/projects/:projectId/dashboard?forceRefresh=true"
] as const;

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
}

function nonBlank(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseArgs(argv: string[]) {
  const args = {
    mode: undefined as "mock" | "http" | undefined,
    dryRun: false,
    json: false,
    verbose: false
  };
  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--verbose") args.verbose = true;
    else if (arg === "--mode=mock") args.mode = "mock";
    else if (arg === "--mode=http") args.mode = "http";
    else if (arg.startsWith("--mode=")) throw new Error(`Unsupported Fireflies smoke mode: ${arg}`);
  }
  return args;
}

export function buildFirefliesSmokeConfig(
  env: NodeJS.ProcessEnv = process.env,
  args = parseArgs(process.argv.slice(2))
): FirefliesSmokeConfig {
  const mode: FirefliesSmokeMode = args.dryRun ? "dry-run" : args.mode ?? "http";
  const stem = `fireflies-connector-${mode}-report`;
  return {
    mode,
    dryRun: args.dryRun,
    json: args.json,
    verbose: args.verbose,
    baseUrl: (nonBlank(env.FIREFLIES_SMOKE_BASE_URL) ?? nonBlank(env.SMOKE_BASE_URL) ?? "http://127.0.0.1:3000").replace(/\/+$/, ""),
    managerEmail: nonBlank(env.FIREFLIES_SMOKE_MANAGER_EMAIL) ?? nonBlank(env.SMOKE_MANAGER_EMAIL) ?? "",
    managerPassword: nonBlank(env.FIREFLIES_SMOKE_MANAGER_PASSWORD) ?? nonBlank(env.SMOKE_MANAGER_PASSWORD) ?? "",
    projectId: nonBlank(env.FIREFLIES_SMOKE_PROJECT_ID) ?? nonBlank(env.SMOKE_PROJECT_ID) ?? "",
    transcriptId: nonBlank(env.FIREFLIES_SMOKE_TRANSCRIPT_ID) ?? null,
    expectLiveApi: parseBoolean(env.FIREFLIES_SMOKE_EXPECT_LIVE_API, false),
    expectWebhook: parseBoolean(env.FIREFLIES_SMOKE_EXPECT_WEBHOOK, false),
    keepData: parseBoolean(env.FIREFLIES_SMOKE_KEEP_DATA, false),
    reportJsonPath: path.resolve(repoRoot, `artifacts/smoke/${stem}.json`),
    reportMarkdownPath: path.resolve(repoRoot, `artifacts/smoke/${stem}.md`)
  };
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (
      normalized.includes("secret") ||
      normalized.includes("token") ||
      normalized.includes("authorization") ||
      normalized.includes("apikey") ||
      normalized.includes("password") ||
      normalized === "credentialsref"
    ) {
      output[key] = "[REDACTED]";
    } else {
      output[key] = redact(nested);
    }
  }
  return output;
}

function createStep(name: string): FirefliesSmokeStep {
  return { name, status: "passed", assertions: [], failures: [] };
}

function assertStep(step: FirefliesSmokeStep, condition: unknown, message: string) {
  if (!condition) throw new Error(message);
  step.assertions.push(message);
}

function smokeEnv(overrides: Record<string, unknown> = {}) {
  return {
    FIREFLIES_READINESS_MODE: "manual_only",
    FIREFLIES_API_BASE_URL: "https://api.fireflies.ai/graphql",
    FIREFLIES_API_KEY: undefined,
    FIREFLIES_WEBHOOK_SECRET: undefined,
    FIREFLIES_SYNC_BATCH_SIZE: 50,
    FIREFLIES_SYNC_MAX_BACKFILL_DAYS: 30,
    FIREFLIES_SYNC_TIMEOUT_MS: 30_000,
    FIREFLIES_ALLOW_RECORDING_URLS: false,
    FIREFLIES_ALLOW_TRANSCRIPT_PROVIDER_URLS: false,
    CONNECTOR_OAUTH_STATE_SECRET: "mock-fireflies-connector-scope-secret",
    ...overrides
  } as any;
}

async function runStep(report: FirefliesSmokeReport, name: string, fn: (step: FirefliesSmokeStep) => Promise<void>) {
  const step = createStep(name);
  try {
    await fn(step);
  } catch (error) {
    step.status = "failed";
    step.failures.push(error instanceof Error ? error.message : String(error));
    report.failures.push(`${name}: ${step.failures.join("; ")}`);
  }
  report.steps.push(step);
}

async function runDryRun(report: FirefliesSmokeReport) {
  await runStep(report, "Fireflies docs/env contract", async (step) => {
    const envExample = await readFile(path.resolve(repoRoot, ".env.example"), "utf8");
    for (const key of FIREFLIES_SMOKE_ENV_KEYS) {
      assertStep(step, envExample.includes(`${key}=`), `.env.example documents ${key}`);
    }
    await readFile(path.resolve(repoRoot, "docs/FIREFLIES_INTEGRATION.md"), "utf8");
    await readFile(path.resolve(repoRoot, "docs/FIREFLIES_API_DISCOVERY.md"), "utf8");
    assertStep(step, true, "Fireflies integration and API discovery docs exist");
  });

  await runStep(report, "Fireflies route plan", async (step) => {
    assertStep(step, FIREFLIES_ROUTE_PLAN.some((route) => route.includes("fireflies_ai")), "fireflies_ai import route is planned");
    assertStep(step, FIREFLIES_ROUTE_PLAN.some((route) => route.includes("/v1/webhooks/fireflies")), "Fireflies webhook route is planned");
    assertStep(step, FIREFLIES_ROUTE_PLAN.some((route) => route.includes("/sync")), "Fireflies connector sync route is planned");
  });

  report.status = report.failures.length > 0 ? "failed" : "diagnostic";
  report.proofLevel = "diagnostic";
}

async function runMock(report: FirefliesSmokeReport) {
  await runStep(report, "Manual transcript normalization", async (step) => {
    const provider = new FirefliesProvider(smokeEnv());
    const batch = await provider.normalizeImport({
      provider: "fireflies_ai",
      accountLabel: "Fireflies mock",
      meeting: {
        providerTranscriptId: "ff-smoke-1",
        title: "Fireflies Smoke Meeting",
        startedAt: "2026-05-12T10:00:00.000Z",
        participants: [{ name: "Sarah Client", email: "sarah@example.com" }],
        sourceUrl: "https://app.fireflies.ai/view/ff-smoke-1",
        recordingUrl: "https://download.fireflies.ai/audio/ff-smoke-1"
      },
      summary: "Fireflies AI summary is metadata only.",
      actionItems: ["Confirm weekly reporting"],
      segments: [
        {
          speakerName: "Sarah Client",
          speakerEmail: "sarah@example.com",
          startMs: 724000,
          endMs: 741000,
          text: "Final decision: change reporting from monthly to weekly."
        }
      ]
    });
    const serialized = JSON.stringify(batch);
    assertStep(step, batch.provider === "fireflies_ai", "normalizer emits fireflies_ai provider");
    assertStep(step, batch.messages[0]?.providerMessageId === "fireflies:transcript:ff-smoke-1:full", "stable transcript message id is used");
    assertStep(step, serialized.includes("\"notTruth\":true"), "summary/action items are marked notTruth");
    assertStep(step, !serialized.includes("download.fireflies.ai"), "recording URL is suppressed by default");
    assertStep(step, !serialized.includes("app.fireflies.ai/view"), "provider transcript URL is suppressed by default");
  });

  await runStep(report, "GraphQL sync pagination and auth", async (step) => {
    const calls: Array<{ query: string; variables: Record<string, unknown>; authorization: string | null }> = [];
    const transcriptDetail = (id: string) =>
      new Response(
        JSON.stringify({
          data: {
            transcript: {
              id,
              title: `Smoke ${id}`,
              dateString: "2026-05-12T10:00:00.000Z",
              duration: 30,
              sentences: [
                {
                  index: 0,
                  speaker_name: "Sarah Client",
                  text: `Final decision from ${id}`,
                  start_time: "00:12:04",
                  end_time: "00:12:21"
                }
              ],
              summary: { action_items: ["Follow up"] }
            }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const fetchMock = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { query: string; variables: Record<string, unknown> };
      calls.push({
        query: body.query,
        variables: body.variables,
        authorization: init?.headers instanceof Headers ? init.headers.get("authorization") : (init?.headers as Record<string, string>)?.authorization ?? null
      });
      if (body.query.includes("FirefliesTranscripts") && body.variables.skip === 0) {
        return new Response(JSON.stringify({ data: { transcripts: [{ id: "ff-1", title: "One" }, { id: "ff-2", title: "Two" }] } }), { status: 200 });
      }
      if (body.query.includes("FirefliesTranscripts") && body.variables.skip === 2) {
        return new Response(JSON.stringify({ data: { transcripts: [{ id: "ff-3", title: "Three" }] } }), { status: 200 });
      }
      return transcriptDetail(String(body.variables.transcriptId));
    };
    const provider = new FirefliesProvider(
      smokeEnv({ FIREFLIES_READINESS_MODE: "api", FIREFLIES_API_KEY: "mock-fireflies-api-key", FIREFLIES_SYNC_BATCH_SIZE: 2 }),
      fetchMock as typeof fetch
    );
    const result = await provider.sync({
      projectId: "project-1",
      connector: { id: "connector-1", providerCursorJson: { lastSeenDateString: "2026-05-01T00:00:00.000Z" } } as any,
      credential: { apiKey: "mock-fireflies-api-key" },
      syncType: "backfill",
      batchSize: 2,
      maxBackfillDays: 30
    });
    assertStep(step, calls.every((call) => call.authorization === "Bearer mock-fireflies-api-key"), "GraphQL requests use Bearer API-key auth");
    assertStep(step, calls.filter((call) => call.query.includes("FirefliesTranscripts")).map((call) => call.variables.skip).join(",") === "0", "transcript list respects per-run detail cap");
    assertStep(step, result.batches?.length === 2, "mock sync normalizes only the bounded per-run transcript details");
    assertStep(step, Boolean((result.cursorAfter as any)?.firefliesContinuation), "capped provider pages persist a continuation cursor");
    assertStep(step, (result.cursorAfter as any)?.firefliesContinuation?.nextSkip === 2, "continuation cursor records the next provider skip offset");
    assertStep(step, result.summary?.hasMore === true, "sync summary reports incomplete provider page coverage");
  });

  await runStep(report, "Webhook signature and unsupported event handling", async (step) => {
    const env = smokeEnv({
      FIREFLIES_READINESS_MODE: "api_and_webhook",
      FIREFLIES_API_KEY: "mock-fireflies-api-key",
      FIREFLIES_WEBHOOK_SECRET: "mock-fireflies-webhook-secret"
    });
    const provider = new FirefliesProvider(env);
    const body = { event: "meeting.transcribed", meeting_id: "ff-1", timestamp: 1710876543210 };
    const rawBody = JSON.stringify(body);
    const signature = `sha256=${createHmac("sha256", env.FIREFLIES_WEBHOOK_SECRET).update(rawBody).digest("hex")}`;
    const scopeToken = signFirefliesConnectorScope("connector-1", env.CONNECTOR_OAUTH_STATE_SECRET);
    assertStep(step, verifyFirefliesSignature(rawBody, signature, env.FIREFLIES_WEBHOOK_SECRET), "HMAC helper verifies official X-Hub-Signature format");
    const verified = await provider.verifyWebhook({
      headers: { "X-Hub-Signature": signature },
      rawBody,
      body,
      query: { connectorId: "connector-1", scopeToken },
      connectors: [{ id: "connector-1" } as any],
      credentialsByConnectorId: { "connector-1": { apiKey: "mock-fireflies-api-key" } }
    });
    assertStep(step, verified.providerEventId === "fireflies:meeting.transcribed:ff-1:1710876543210", "webhook event id is deterministic");
    assertStep(step, verified.jobPayload?.meetingId === "ff-1", "webhook enqueues targeted meeting sync payload");
    await expectRejectedRawBody(provider, signature, body);
    step.assertions.push("missing raw body is rejected before signature fallback");
    const ignored = await provider.verifyWebhook({
      headers: { "X-Hub-Signature": signature },
      rawBody,
      body: { event: "meeting.started", meeting_id: "ff-1", timestamp: 1710876543210 },
      query: { connectorId: "connector-1", scopeToken },
      connectors: [{ id: "connector-1" } as any]
    });
    const ignoredBody = ignored.handledImmediately?.body as { ignored?: boolean } | undefined;
    assertStep(step, ignoredBody?.ignored === true, "unsupported Fireflies events are ignored safely");
  });

  report.status = report.failures.length > 0 ? "failed" : "mock_passed";
  report.proofLevel = "mock";
}

async function expectRejectedRawBody(provider: FirefliesProvider, signature: string, body: Record<string, unknown>) {
  try {
    await provider.verifyWebhook({
      headers: { "X-Hub-Signature": signature },
      rawBody: "",
      body,
      connectors: []
    });
  } catch (error) {
    if ((error as { code?: string }).code === "fireflies_webhook_raw_body_missing") return;
    throw error;
  }
  throw new Error("Fireflies webhook accepted a missing raw body");
}

async function requestJson(config: FirefliesSmokeConfig, method: string, urlPath: string, body?: unknown, token?: string) {
  const response = await fetch(`${config.baseUrl}${urlPath}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { response, body: parsed, text };
}

function getData(payload: unknown) {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: unknown }).data;
  }
  return payload;
}

function assertNoSecrets(value: unknown) {
  const serialized = JSON.stringify(value);
  const forbidden = ["FIREFLIES_API_KEY", "FIREFLIES_WEBHOOK_SECRET", "credentialsRef", "mock-fireflies-api-key", "Bearer "];
  for (const item of forbidden) {
    if (serialized.includes(item)) {
      throw new Error(`Response leaked forbidden secret marker: ${item}`);
    }
  }
}

async function runHttp(report: FirefliesSmokeReport, config: FirefliesSmokeConfig) {
  const diagnostics = {
    managerLogin: false,
    readiness: false,
    connect: false,
    connectorDetail: false,
    syncEnqueued: false,
    timelineEvidence: false,
    dashboard: false,
    webhook: false
  };
  report.proof.httpDiagnostics = diagnostics;
  report.proof.fullLaunchProofChecklist = {
    exercised: false,
    reason: "HTTP smoke currently proves live-provider diagnostics only; full launch proof requires transcript chunks, idempotency, classification, proposal review, manager acceptance, Product Brain versioning, Socrates citation/open target, client-safe leak checks, and revoke verification."
  };

  const blockers = [];
  if (!config.managerEmail) blockers.push("FIREFLIES_SMOKE_MANAGER_EMAIL");
  if (!config.managerPassword) blockers.push("FIREFLIES_SMOKE_MANAGER_PASSWORD");
  if (!config.projectId) blockers.push("FIREFLIES_SMOKE_PROJECT_ID");
  if (blockers.length > 0) {
    report.environmentBlockers.push(...blockers);
    report.status = config.expectLiveApi ? "failed" : "readiness_gated";
    report.proofLevel = "http";
    report.failures.push(...(config.expectLiveApi ? blockers.map((key) => `missing ${key}`) : []));
    return;
  }

  let token = "";
  let connectorId = "";
  let transcriptEvidenceFound = false;

  await runStep(report, "Manager login", async (step) => {
    const login = await requestJson(config, "POST", "/v1/auth/login", {
      email: config.managerEmail,
      password: config.managerPassword
    });
    assertStep(step, login.response.ok, `manager login returned ${login.response.status}`);
    token = String((getData(login.body) as { accessToken?: string })?.accessToken ?? "");
    assertStep(step, token.length > 0, "manager access token returned");
    diagnostics.managerLogin = true;
  });

  await runStep(report, "Fireflies readiness and connect", async (step) => {
    const readiness = await requestJson(config, "GET", `/v1/projects/${config.projectId}/connectors/readiness`, undefined, token);
    assertStep(step, readiness.response.ok, `readiness returned ${readiness.response.status}`);
    const items = Array.isArray(getData(readiness.body)) ? (getData(readiness.body) as Array<Record<string, unknown>>) : [];
    const fireflies = items.find((item) => item.provider === "fireflies_ai");
    assertStep(step, Boolean(fireflies), "readiness includes fireflies_ai");
    assertNoSecrets(readiness.body);
    diagnostics.readiness = true;

    const connected = await requestJson(config, "POST", `/v1/projects/${config.projectId}/connectors/fireflies_ai/connect`, undefined, token);
    assertStep(step, connected.response.ok, `connect returned ${connected.response.status}`);
    connectorId = String((getData(connected.body) as { connectorId?: string })?.connectorId ?? "");
    assertStep(step, connectorId.length > 0, "Fireflies connector id returned");
    assertNoSecrets(connected.body);
    diagnostics.connect = true;

    const detail = await requestJson(config, "GET", `/v1/projects/${config.projectId}/connectors/${connectorId}`, undefined, token);
    assertStep(step, detail.response.ok, `connector detail returned ${detail.response.status}`);
    assertNoSecrets(detail.body);
    diagnostics.connectorDetail = true;
  });

  await runStep(report, "Fireflies connector sync and internal evidence", async (step) => {
    const sync = await requestJson(config, "POST", `/v1/projects/${config.projectId}/connectors/${connectorId}/sync`, { syncType: "manual" }, token);
    assertStep(step, sync.response.ok, `sync enqueue returned ${sync.response.status}`);
    assertNoSecrets(sync.body);
    diagnostics.syncEnqueued = true;

    const timeline = await requestJson(
      config,
      "GET",
      `/v1/projects/${config.projectId}/communications/timeline?provider=fireflies_ai&limit=10`,
      undefined,
      token
    );
    assertStep(step, timeline.response.ok, `timeline returned ${timeline.response.status}`);
    const rows = Array.isArray(getData(timeline.body)) ? (getData(timeline.body) as Array<Record<string, unknown>>) : [];
    transcriptEvidenceFound = rows.some((row) => row.provider === "fireflies_ai" || JSON.stringify(row).includes("fireflies_ai"));
    if (config.expectLiveApi) {
      assertStep(step, transcriptEvidenceFound, "timeline includes Fireflies transcript evidence after live sync");
    } else if (!transcriptEvidenceFound) {
      step.assertions.push("Fireflies timeline evidence not required because FIREFLIES_SMOKE_EXPECT_LIVE_API=false");
    }
    diagnostics.timelineEvidence = transcriptEvidenceFound;
    assertNoSecrets(timeline.body);
  });

  await runStep(report, "Dashboard and client-safe leak sentinel", async (step) => {
    const dashboard = await requestJson(config, "GET", `/v1/projects/${config.projectId}/dashboard?forceRefresh=true`, undefined, token);
    assertStep(step, dashboard.response.ok, `dashboard returned ${dashboard.response.status}`);
    assertNoSecrets(dashboard.body);
    const serialized = JSON.stringify(dashboard.body).toLowerCase();
    assertStep(step, !serialized.includes("fireflies_api_key"), "dashboard does not expose Fireflies secret names");
    assertStep(step, !serialized.includes("credentialsref"), "dashboard does not expose credential refs");
    diagnostics.dashboard = true;
  });

  if (config.expectWebhook) {
    report.failures.push(
      "Fireflies webhook live proof requested, but this HTTP smoke does not send a signed provider webhook yet"
    );
  }

  report.proofLevel = "http";
  report.firefliesLiveProviderProven = false;
  report.canBeUsedForFirefliesLaunchProof = false;
  report.status =
    report.failures.length > 0
      ? "failed"
      : config.expectLiveApi
        ? "readiness_gated"
        : "diagnostic_passed";
}

function buildMarkdownReport(report: FirefliesSmokeReport) {
  const stepRows = report.steps
    .map((step) => `| ${step.name} | ${step.status} | ${step.assertions.length} | ${step.failures.join("; ") || "-"} |`)
    .join("\n");
  return `# Fireflies.ai Connector Smoke Report

## Executive Result
- Mode: ${report.mode}
- Status: ${report.status}
- Proof level: ${report.proofLevel}
- Fireflies live provider proven: ${report.firefliesLiveProviderProven ? "YES" : "NO"}
- Can be used for Fireflies launch proof: ${report.canBeUsedForFirefliesLaunchProof ? "YES" : "NO"}
- Base URL: ${report.baseUrl}
- Started: ${report.startedAt}
- Finished: ${report.finishedAt}

Dry-run and mock reports are diagnostics only. HTTP mode is Fireflies launch proof only when it uses real backend infrastructure and real Fireflies provider credentials, exercises the full launch-proof checklist, and the report sets \`canBeUsedForFirefliesLaunchProof=true\`.

## Environment Blockers
${report.environmentBlockers.length ? report.environmentBlockers.map((item) => `- ${item}`).join("\n") : "- none"}

## Failures
${report.failures.length ? report.failures.map((item) => `- ${item}`).join("\n") : "- none"}

## Step Table
| Step | Status | Assertions | Failures |
| --- | --- | ---: | --- |
${stepRows || "| - | - | - | - |"}

## Route Plan
${report.routePlan.map((route) => `- ${route}`).join("\n")}

## Proof
\`\`\`json
${JSON.stringify(redact(report.proof), null, 2)}
\`\`\`
`;
}

async function writeReport(report: FirefliesSmokeReport) {
  await mkdir(path.dirname(report.reportJsonPath), { recursive: true });
  await writeFile(report.reportJsonPath, `${JSON.stringify(redact(report), null, 2)}\n`);
  await writeFile(report.reportMarkdownPath, buildMarkdownReport(report));
}

export async function runFirefliesConnectorSmoke(config = buildFirefliesSmokeConfig()): Promise<FirefliesSmokeReport> {
  const startedAt = new Date().toISOString();
  const report: FirefliesSmokeReport = {
    runId: `fireflies-${Date.now()}`,
    mode: config.mode,
    proofLevel: config.mode === "dry-run" ? "diagnostic" : config.mode === "mock" ? "mock" : "http",
    status: "failed",
    startedAt,
    finishedAt: "",
    baseUrl: config.baseUrl,
    firefliesLiveProviderProven: false,
    canBeUsedForFirefliesLaunchProof: false,
    requiredEnv: [...FIREFLIES_SMOKE_ENV_KEYS],
    routePlan: [...FIREFLIES_ROUTE_PLAN],
    steps: [],
    proof: {
      manualImportNormalizerReady: false,
      liveApiExpected: config.expectLiveApi,
      webhookExpected: config.expectWebhook,
      keepData: config.keepData
    },
    environmentBlockers: [],
    failures: [],
    reportJsonPath: config.reportJsonPath,
    reportMarkdownPath: config.reportMarkdownPath
  };

  if (config.mode === "dry-run") {
    await runDryRun(report);
  } else if (config.mode === "mock") {
    await runMock(report);
    report.proof.manualImportNormalizerReady = report.status === "mock_passed";
  } else {
    await runHttp(report, config);
  }

  report.finishedAt = new Date().toISOString();
  await writeReport(report);
  return report;
}

async function main() {
  const config = buildFirefliesSmokeConfig();
  const report = await runFirefliesConnectorSmoke(config);
  if (config.json) {
    console.log(JSON.stringify(redact(report), null, 2));
  } else {
    console.log(`Fireflies connector smoke ${report.status}. Report: ${report.reportMarkdownPath}`);
  }

  if (report.status === "failed" || (config.mode === "http" && config.expectLiveApi && !report.canBeUsedForFirefliesLaunchProof)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
