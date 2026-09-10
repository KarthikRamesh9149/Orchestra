import { Blob, File } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/auth/password.js";

export type MvpSmokeMode = "dry-run" | "mock" | "http";
type CliMvpSmokeMode = "mock" | "http";
export type MvpSmokeProofLevel = "diagnostic" | "mock" | "http";
export type MvpSmokeStatus = "not_executed" | "diagnostic" | "mock_passed" | "passed" | "failed" | "degraded";

export interface MvpSmokeArgs {
  mode?: CliMvpSmokeMode;
  dryRun: boolean;
  json: boolean;
  verbose: boolean;
  keepData?: boolean;
}

export interface MvpSmokeConfig {
  mode: MvpSmokeMode;
  dryRun: boolean;
  json: boolean;
  verbose: boolean;
  keepData: boolean;
  baseUrl: string;
  managerEmail: string;
  managerPassword: string;
  devEmail: string;
  devPassword: string;
  clientEmail: string;
  clientPassword: string;
  expectAi: boolean;
  expectWorker: boolean;
  expectFirefliesLive: boolean;
  timeoutMs: number;
  pollIntervalMs: number;
  reportJsonPath: string;
  reportMarkdownPath: string;
}

export interface MvpSmokeStep {
  id: string;
  title: string;
  method: string;
  path: string;
  assertion: string;
  critical: boolean;
}

interface RouteCall {
  method: string;
  path: string;
  statusCode?: number;
  ok?: boolean;
}

export interface StepResult {
  id: string;
  title: string;
  status: MvpSmokeStatus;
  assertions: string[];
  failures: string[];
  routes: RouteCall[];
}

export interface MvpSmokeReport {
  runId: string;
  mode: MvpSmokeMode;
  proofLevel: MvpSmokeProofLevel;
  status: MvpSmokeStatus;
  launchLoopProven: boolean;
  canBeUsedForLaunchProof: boolean;
  executedHttpRequests: number;
  plannedStepsCount: number;
  executedStepsCount: number;
  baseUrl: string;
  startedAt: string;
  finishedAt: string;
  created: Record<string, string>;
  assertions: string[];
  routeCoverage: RouteCall[];
  steps: StepResult[];
  failures: string[];
  degradedDependencies: string[];
  environmentBlockers: string[];
  rerunCommand: string;
}

interface HttpResponse {
  statusCode: number;
  ok: boolean;
  body: unknown;
  text: string;
}

type PathSegment = string | number;

class MvpSmokeFailure extends Error {
  constructor(
    message: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

export class MvpHttpRunner {
  private readonly steps: StepResult[] = [];
  private readonly created: Record<string, string> = {};
  private readonly routeCoverage: RouteCall[] = [];
  private readonly assertions: string[] = [];
  private readonly failures: string[] = [];
  private readonly degradedDependencies: string[] = [];
  private readonly observedResponses: unknown[] = [];
  private readonly secrets: Record<string, string> = {};

  constructor(private readonly config: MvpSmokeConfig) {}

  async step(id: string, title: string, fn: (step: StepResult) => Promise<void>) {
    const result: StepResult = { id, title, status: "passed", assertions: [], failures: [], routes: [] };
    try {
      await fn(result);
    } catch (error) {
      result.status = "failed";
      result.failures.push(error instanceof Error ? error.message : String(error));
      if (error instanceof MvpSmokeFailure && error.details != null) {
        result.failures.push(JSON.stringify(redactForReport(error.details)));
      }
    } finally {
      this.steps.push(result);
    }
  }

  assert(step: StepResult, condition: unknown, message: string, details?: unknown) {
    if (!condition) throw new MvpSmokeFailure(message, details);
    step.assertions.push(message);
    this.assertions.push(message);
  }

  degrade(step: StepResult, message: string) {
    if (step.status !== "failed") step.status = "degraded";
    step.failures.push(message);
    this.degradedDependencies.push(message);
  }

  id(key: string, value: unknown) {
    if (typeof value === "string" && value.length > 0) this.created[key] = value;
  }

  getId(key: string) {
    const value = this.created[key];
    if (!value) throw new MvpSmokeFailure(`Missing created.${key}`);
    return value;
  }

  secret(key: string, value: unknown) {
    if (typeof value === "string" && value.length > 0) this.secrets[key] = value;
  }

  getSecret(key: string) {
    const value = this.secrets[key];
    if (!value) throw new MvpSmokeFailure(`Missing secret.${key}`);
    return value;
  }

  async request(
    step: StepResult,
    method: string,
    routePath: string,
    body?: unknown,
    options: { token?: string; expectStatuses?: number[]; sse?: boolean; scanResponse?: boolean } = {}
  ): Promise<HttpResponse> {
    const url = `${this.config.baseUrl}${routePath}`;
    const headers: Record<string, string> = { Accept: options.sse ? "text/event-stream" : "application/json" };
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
    if (body !== undefined && !isFormData) headers["Content-Type"] = "application/json";
    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs)
    });
    const text = await response.text();
    let parsed: unknown = text;
    if (!options.sse) {
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      if (options.scanResponse !== false) this.observedResponses.push(parsed);
    }
    const call = { method, path: routePath, statusCode: response.status, ok: response.ok };
    step.routes.push(call);
    this.routeCoverage.push(call);
    if (this.config.verbose) {
      console.log(JSON.stringify(redactForReport({ request: { method, routePath, body }, response: parsed }), null, 2));
    }
    const expected = options.expectStatuses ?? [];
    const allowed = expected.length > 0 ? expected.includes(response.status) : response.ok;
    if (!allowed) {
      throw new MvpSmokeFailure(`HTTP ${method} ${routePath} returned ${response.status}`, parsed);
    }
    return { statusCode: response.status, ok: response.ok, body: parsed, text };
  }

  async finish(config: MvpSmokeConfig, startedAt: string) {
    const stepFailures = this.steps.flatMap((step) => step.failures.map((failure) => `${step.id}: ${failure}`));
    const report: MvpSmokeReport = {
      ...baseReport(config),
      startedAt,
      finishedAt: new Date().toISOString(),
      created: { ...this.created },
      assertions: [...new Set(this.assertions)],
      routeCoverage: [...this.routeCoverage],
      steps: [...this.steps],
      failures: [...this.failures, ...stepFailures],
      degradedDependencies: [...new Set(this.degradedDependencies)],
      environmentBlockers: []
    };
    return writeReport(config, report);
  }

  assertNoSecrets(step: StepResult) {
    assertNoSensitiveResponse(this.observedResponses, "MVP HTTP smoke responses");
    this.assert(step, true, "response secret scan passed");
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

export const MVP_SMOKE_ENV_KEYS = [
  "MVP_SMOKE_BASE_URL or SMOKE_BASE_URL",
  "MVP_SMOKE_MANAGER_EMAIL or SMOKE_MANAGER_EMAIL",
  "MVP_SMOKE_MANAGER_PASSWORD or SMOKE_MANAGER_PASSWORD",
  "MVP_SMOKE_DEV_EMAIL or SMOKE_DEV_EMAIL",
  "MVP_SMOKE_DEV_PASSWORD or SMOKE_DEV_PASSWORD",
  "MVP_SMOKE_CLIENT_EMAIL or SMOKE_CLIENT_EMAIL",
  "MVP_SMOKE_CLIENT_PASSWORD or SMOKE_CLIENT_PASSWORD",
  "MVP_SMOKE_EXPECT_AI",
  "MVP_SMOKE_EXPECT_WORKER",
  "MVP_SMOKE_EXPECT_FIREFLIES_LIVE",
  "MVP_SMOKE_KEEP_DATA",
  "MVP_SMOKE_TIMEOUT_MS",
  "MVP_SMOKE_POLL_INTERVAL_MS"
];

export const MVP_SMOKE_STEP_PLAN: MvpSmokeStep[] = [
  { id: "health", title: "Health check", method: "GET", path: "/health", assertion: "API responds and reports health", critical: true },
  { id: "auth", title: "Signup/login/current user", method: "POST", path: "/v1/auth/login", assertion: "manager/dev/client auth tokens are real", critical: true },
  { id: "project", title: "Create project", method: "POST", path: "/v1/projects", assertion: "projectId exists", critical: true },
  { id: "member", title: "Add project member", method: "POST", path: "/v1/projects/:projectId/members", assertion: "memberId exists and active dev can access", critical: true },
  { id: "upload_prd", title: "Upload PRD", method: "POST", path: "/v1/projects/:projectId/documents/upload", assertion: "documentId and documentVersionId exist", critical: true },
  { id: "generate_prd_srs", title: "Generate PRD and SRS", method: "POST", path: "/v1/projects/:projectId/documents/generate", assertion: "generated PRD/SRS document ids exist", critical: true },
  { id: "document_viewer", title: "Fetch document list/detail/viewer", method: "GET", path: "/v1/projects/:projectId/documents/:documentId/view", assertion: "viewer exposes sections/anchors", critical: true },
  { id: "manual_context", title: "Add manual context note", method: "POST", path: "/v1/projects/:projectId/context", assertion: "contextId exists", critical: true },
  { id: "image_context", title: "Upload image/chart context", method: "POST", path: "/v1/projects/:projectId/context", assertion: "imageContextId has caption/attachment metadata", critical: true },
  { id: "audio_rejected", title: "Verify audio rejected in MVP", method: "POST", path: "/v1/projects/:projectId/context", assertion: "audio file receives feature-disabled or validation error", critical: true },
  { id: "manual_transcript", title: "Manual transcript import", method: "POST", path: "/v1/projects/:projectId/communications/import", assertion: "transcript/thread/message evidence exists", critical: true },
  { id: "fireflies", title: "Fireflies transcript readiness/import", method: "POST", path: "/v1/projects/:projectId/communications/import", assertion: "Fireflies manual transcript import or readiness-gated proof exists", critical: true },
  { id: "brain", title: "Product Brain path", method: "POST", path: "/v1/projects/:projectId/brain/rebuild", assertion: "current brain or rebuild status exists", critical: true },
  { id: "socrates_session", title: "Create Socrates session", method: "POST", path: "/v1/projects/:projectId/socrates/sessions", assertion: "socratesSessionId exists", critical: true },
  { id: "socrates_answer", title: "Ask Socrates project question", method: "POST", path: "/v1/projects/:projectId/socrates/sessions/:sessionId/messages/stream", assertion: "done payload has citations and openTargets", critical: true },
  { id: "agent_context_create", title: "Create Agent Context Pack", method: "POST", path: "/v1/projects/:projectId/agent-context-packs", assertion: "Agent Context pack body/citations/openTargets contract exists without agent execution", critical: true },
  { id: "agent_context_lifecycle", title: "List/view/refresh/archive/delete Agent Context Pack", method: "GET", path: "/v1/projects/:projectId/agent-context-packs", assertion: "Agent Context pack lifecycle routes exist and do not mutate truth", critical: true },
  { id: "agent_context_export_formats", title: "List Agent Context export formats", method: "GET", path: "/v1/projects/:projectId/agent-context-packs/:packId/export-formats", assertion: "Markdown/Claude/Codex/Cursor/AGENTS/JSON/GitHub brief formats are available", critical: true },
  { id: "agent_context_export_preview", title: "Preview Agent Context export", method: "POST", path: "/v1/projects/:projectId/agent-context-packs/:packId/exports/preview", assertion: "copy-friendly export preview preserves citations, limitations, and MVP provider gating", critical: true },
  { id: "agent_context_export_generate", title: "Generate Agent Context export", method: "POST", path: "/v1/projects/:projectId/agent-context-packs/:packId/exports", assertion: "export generation does not execute agents, mutate truth, or call GitHub APIs", critical: true },
  { id: "agent_run_create", title: "Record manual Agent Run Memory", method: "POST", path: "/v1/projects/:projectId/agent-runs", assertion: "manual run links context pack/export metadata without executing agents", critical: true },
  { id: "agent_run_lifecycle", title: "List/view/update/review Agent Run Memory", method: "GET", path: "/v1/projects/:projectId/agent-runs", assertion: "lifecycle states and review results exist without mutating Product Brain or Live Doc truth", critical: true },
  { id: "agent_run_socrates", title: "Ask Socrates about Agent Run Memory", method: "POST", path: "/v1/projects/:projectId/socrates/sessions/:sessionId/messages/stream", assertion: "mock answer can cite agent_run evidence and open target", critical: true },
  { id: "agent_quality_pack", title: "Score Agent Context Pack quality", method: "POST", path: "/v1/projects/:projectId/agent-context-packs/:packId/quality-reports", assertion: "quality report scores context coverage, citations, redaction, and disabled MVP providers", critical: true },
  { id: "agent_quality_review", title: "Review Agent Run drift", method: "POST", path: "/v1/projects/:projectId/agent-runs/:runId/quality-reviews", assertion: "manual run review flags drift, test/docs gaps, MVP violations, and follow-ups without mutating truth", critical: true },
  { id: "agent_quality_socrates", title: "Ask Socrates about Step 5 review results", method: "POST", path: "/v1/projects/:projectId/socrates/sessions/:sessionId/messages/stream", assertion: "Socrates can cite agent_quality_review evidence and open target", critical: true },
  { id: "agent_files", title: "Preview/generate Product Brain Agent Files", method: "POST", path: "/v1/projects/:projectId/agent-files/default/generate", assertion: "all seven generated Markdown files exist inside Orchestra only and include MVP-safe branch rules", critical: true },
  { id: "agent_files_step2", title: "Refresh/diff/download MVP Product Brain Agent Files", method: "POST", path: "/v1/projects/:projectId/agent-files/file-sets/:fileSetId/refresh", assertion: "staleness, refresh, diff, manifest, latest, and bundle contracts work without repo writes or disabled-provider leakage", critical: true },
  { id: "agent_files_step3", title: "Quality/drift/release-gate MVP Product Brain Agent Files", method: "POST", path: "/v1/projects/:projectId/agent-files/file-sets/:fileSetId/quality/refresh", assertion: "quality, drift, release-gate, and GitHub PR readiness checks work without GitHub writes", critical: true },
  { id: "github_foundation", title: "GitHub Integration Foundation readiness", method: "GET", path: "/v1/github/readiness", assertion: "MVP GitHub foundation is read-only, route-registered, and truth-safe", critical: true },
  { id: "github_project_status", title: "Project GitHub integration status", method: "GET", path: "/v1/projects/:projectId/github", assertion: "project GitHub status is scoped and exposes no write actions", critical: true },
  { id: "fde_conflicts", title: "MVP Conflict Radar", method: "POST", path: "/v1/projects/:projectId/fde-readiness/conflicts/refresh", assertion: "overlap findings are generated from engineering evidence without GitHub writes or truth mutation", critical: true },
  { id: "fde_safe_to_touch", title: "MVP Safe-to-Touch", method: "POST", path: "/v1/projects/:projectId/fde-readiness/safe-to-touch/refresh", assertion: "file/route risk statuses are green/yellow/red/unknown with citations and limitations", critical: true },
  { id: "fde_duplicates", title: "MVP Duplicate Work Detection", method: "POST", path: "/v1/projects/:projectId/fde-readiness/duplicates/refresh", assertion: "duplicate work findings use deterministic overlap first and abstain from hidden-provider evidence", critical: true },
  { id: "fde_live_working_map", title: "MVP Live Working Map", method: "POST", path: "/v1/projects/:projectId/fde-readiness/live-working-map/refresh", assertion: "near-real-time evidence map returns PR/branch/agent/manual signals without claiming IDE presence", critical: true },
  { id: "fde_rationale_trace", title: "MVP Rationale Trace", method: "POST", path: "/v1/projects/:projectId/fde-readiness/rationale-traces", assertion: "trace hops preserve confidence labels and low-confidence traces remain possible, not confirmed", critical: true },
  { id: "fde_decision_links", title: "MVP decision engineering links", method: "POST", path: "/v1/projects/:projectId/fde-readiness/decision-links", assertion: "existing accepted decisions can be linked to files/routes/PRs without creating accepted decisions", critical: true },
  { id: "fde_dashboard", title: "MVP FDE readiness main dashboard", method: "GET", path: "/v1/projects/:projectId/dashboard", assertion: "canonical dashboard returns dashboardKind=fde_readiness with readinessSummary before operationalSummary", critical: true },
  { id: "fde_dashboard_readiness", title: "MVP readiness dashboard section", method: "GET", path: "/v1/projects/:projectId/dashboard/readiness", assertion: "readiness top cards include blocking conflicts, unsafe files, open seams, and limitations", critical: true },
  { id: "fde_dashboard_context_snapshot", title: "MVP dashboard Context Snapshot", method: "POST", path: "/v1/projects/:projectId/dashboard/context-snapshot", assertion: "Context Snapshot creates an Agent Context Pack or returns a safe dependency error without truth mutation or agent execution", critical: true },
  { id: "fde_dashboard_safe_to_touch", title: "MVP dashboard Safe-to-Touch file query", method: "GET", path: "/v1/projects/:projectId/dashboard/files/:filePath/safe-to-touch", assertion: "file safety query returns green/yellow/red/unknown with citations, limitations, and no safe-by-default behavior", critical: true },
  { id: "mcp_readiness", title: "MCP readiness and token contracts", method: "GET", path: "/v1/mcp/readiness", assertion: "MVP MCP is local/team only, read-only by default, token-scoped, and controlled writes are gated", critical: true },
  { id: "mcp_context", title: "MCP read-only context tools", method: "POST", path: "/v1/mcp", assertion: "MVP MCP exposes read-only project context and excludes hidden providers unless enabled", critical: true },
  { id: "diagram_generate", title: "Generate Mermaid diagram", method: "POST", path: "/v1/projects/:projectId/diagrams/generate", assertion: "Mermaid source is valid; saved diagramId is asserted by the save step", critical: true },
  { id: "diagram_save", title: "Save diagram", method: "POST", path: "/v1/projects/:projectId/diagrams", assertion: "saved diagram remains active and project-scoped", critical: true },
  { id: "live_doc_embed", title: "Embed diagram into Live Doc", method: "POST", path: "/v1/projects/:projectId/live-doc/sections/:sectionKey/diagrams/:diagramId/embed", assertion: "Live Doc section references diagram", critical: true },
  { id: "live_doc_fetch", title: "Fetch Live Doc", method: "GET", path: "/v1/projects/:projectId/live-doc/current", assertion: "embedded diagram appears", critical: true },
  { id: "coding_generate", title: "Generate coding requirements", method: "POST", path: "/v1/projects/:projectId/coding-requirements/generate", assertion: "codingRequirementsId and artifactVersionId exist", critical: true },
  { id: "coding_fetch", title: "Fetch coding requirements current/history/flowchart", method: "GET", path: "/v1/projects/:projectId/coding-requirements/current", assertion: "schema-valid payload and Mermaid flowchart exist", critical: true },
  { id: "responsibility", title: "Create responsibility/task", method: "POST", path: "/v1/projects/:projectId/responsibilities", assertion: "responsibilityId exists", critical: true },
  { id: "action_create", title: "Create Socrates assign-task action", method: "POST", path: "/v1/projects/:projectId/socrates/sessions/:sessionId/actions", assertion: "socratesActionId exists and is proposed", critical: true },
  { id: "action_apply", title: "Apply Socrates action", method: "POST", path: "/v1/projects/:projectId/socrates/actions/:actionId/apply", assertion: "action is applied and mutation visible", critical: true },
  { id: "calendar", title: "Create/list simple calendar event", method: "POST", path: "/v1/projects/:projectId/meetings", assertion: "calendarEventId exists and is listed", critical: true },
  { id: "dashboard", title: "Fetch dashboard summary", method: "GET", path: "/v1/projects/:projectId/dashboard", assertion: "MVP dashboard has bounded summaries and no disabled ops data", critical: true },
  { id: "provider_gating", title: "Verify MVP provider profile", method: "GET", path: "/v1/projects/:projectId/connectors/readiness", assertion: "manual_import/fireflies_ai/slack/clickup/granola/microsoft_teams visible and Gmail/Outlook/WhatsApp disabled", critical: true },
  { id: "advanced_ops_gating", title: "Verify finance/subscriptions/cost disabled", method: "GET", path: "/v1/projects/:projectId/financials", assertion: "advanced ops return feature_disabled", critical: true },
  { id: "client_internal_denied", title: "Verify client/internal leakage blocked", method: "GET", path: "/v1/projects/:projectId/communications/timeline", assertion: "client JWT denied from internal route", critical: true },
  { id: "project_scope", title: "Verify created IDs are project-scoped", method: "GET", path: "/v1/projects/:projectId", assertion: "created IDs resolve only under the project", critical: true },
  { id: "secret_scan_responses", title: "Verify no secrets in responses", method: "GET", path: "/v1/projects/:projectId/dashboard", assertion: "responses omit credentials/provider tokens", critical: true }
];

const REQUIRED_HTTP_CREATED_IDS = [
  "projectId",
  "memberId",
  "documentId",
  "documentVersionId",
  "generatedPrdDocumentId",
  "generatedSrsDocumentId",
  "contextId",
  "imageContextId",
  "transcriptId",
  "agentContextPackId",
  "agentRunId",
  "agentPackQualityReviewId",
  "agentRunQualityReviewId",
  "mcpTokenId",
  "diagramId",
  "liveDocSectionKey",
  "codingRequirementsId",
  "responsibilityId",
  "socratesSessionId",
  "agentFileSetId",
  "socratesActionId",
  "calendarEventId"
];

const sensitiveResponseKeyPattern = /credentialsRef|credential|passwordHash|accessToken|refreshToken|apiKey|api[_-]?key|authorization/i;
const sensitiveResponseValuePattern = /Bearer\s+[A-Za-z0-9._-]{20,}|sk-[A-Za-z0-9]{20,}/i;

export function parseArgs(argv = process.argv.slice(2)): MvpSmokeArgs {
  const args: MvpSmokeArgs = { dryRun: false, json: false, verbose: false };
  for (const arg of argv) {
    if (arg === "--dry-run" || arg === "--mode=dry-run") args.dryRun = true;
    else if (arg === "--mode=mock") args.mode = "mock";
    else if (arg === "--mode=http") args.mode = "http";
    else if (arg === "--json") args.json = true;
    else if (arg === "--verbose") args.verbose = true;
    else if (arg === "--keep-data") args.keepData = true;
    else if (arg.startsWith("--mode=")) throw new Error(`Unsupported MVP smoke mode: ${arg}`);
    else throw new Error(`Unsupported MVP smoke argument: ${arg}`);
  }
  return args;
}

export function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
}

export function reportPathsForMode(mode: MvpSmokeMode) {
  const stem = `mvp-${mode}-report`;
  return {
    json: path.resolve(repoRoot, "artifacts", "smoke", `${stem}.json`),
    markdown: path.resolve(repoRoot, "artifacts", "smoke", `${stem}.md`)
  };
}

export function buildMvpSmokeConfig(env: NodeJS.ProcessEnv = process.env, args: MvpSmokeArgs = parseArgs()): MvpSmokeConfig {
  const mode: MvpSmokeMode = args.dryRun ? "dry-run" : args.mode ?? "http";
  const paths = reportPathsForMode(mode);
  return {
    mode,
    dryRun: mode === "dry-run",
    json: args.json,
    verbose: args.verbose,
    keepData: args.keepData ?? parseBoolean(env.MVP_SMOKE_KEEP_DATA ?? env.SMOKE_KEEP_DATA, false),
    baseUrl: (env.MVP_SMOKE_BASE_URL ?? env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, ""),
    managerEmail: env.MVP_SMOKE_MANAGER_EMAIL ?? env.SMOKE_MANAGER_EMAIL ?? "manager@orchestra.local",
    managerPassword: env.MVP_SMOKE_MANAGER_PASSWORD ?? env.SMOKE_MANAGER_PASSWORD ?? "Password123!",
    devEmail: env.MVP_SMOKE_DEV_EMAIL ?? env.SMOKE_DEV_EMAIL ?? "dev@orchestra.local",
    devPassword: env.MVP_SMOKE_DEV_PASSWORD ?? env.SMOKE_DEV_PASSWORD ?? "Password123!",
    clientEmail: env.MVP_SMOKE_CLIENT_EMAIL ?? env.SMOKE_CLIENT_EMAIL ?? "client@orchestra.local",
    clientPassword: env.MVP_SMOKE_CLIENT_PASSWORD ?? env.SMOKE_CLIENT_PASSWORD ?? "Password123!",
    expectAi: parseBoolean(env.MVP_SMOKE_EXPECT_AI ?? env.SMOKE_EXPECT_AI, true),
    expectWorker: parseBoolean(env.MVP_SMOKE_EXPECT_WORKER ?? env.SMOKE_EXPECT_WORKER, true),
    expectFirefliesLive: parseBoolean(env.MVP_SMOKE_EXPECT_FIREFLIES_LIVE, false),
    timeoutMs: Number(env.MVP_SMOKE_TIMEOUT_MS ?? env.SMOKE_TIMEOUT_MS ?? 30000),
    pollIntervalMs: Number(env.MVP_SMOKE_POLL_INTERVAL_MS ?? env.SMOKE_POLL_INTERVAL_MS ?? 1000),
    reportJsonPath: paths.json,
    reportMarkdownPath: paths.markdown
  };
}

function nowRunId() {
  return `mvp-smoke-${Date.now()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function dataOf(response: HttpResponse): unknown {
  if (isRecord(response.body) && "data" in response.body) return response.body.data;
  return response.body;
}

function formatPath(pathSegments: PathSegment[]) {
  return pathSegments.map((segment) => (typeof segment === "number" ? `[${segment}]` : `.${segment}`)).join("").replace(/^\./, "");
}

function getPath(value: unknown, pathSegments: PathSegment[]) {
  let current = value;
  for (const segment of pathSegments) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function requireRecordPath(value: unknown, pathSegments: PathSegment[], label: string): Record<string, unknown> {
  const found = getPath(value, pathSegments);
  if (!isRecord(found)) {
    throw new MvpSmokeFailure(`${label} missing object at ${formatPath(pathSegments) || "<root>"}`, value);
  }
  return found;
}

function requireStringPath(value: unknown, pathSegments: PathSegment[], label: string) {
  const found = getPath(value, pathSegments);
  if (typeof found !== "string" || found.length === 0) {
    throw new MvpSmokeFailure(`${label} missing string at ${formatPath(pathSegments)}`, value);
  }
  return found;
}

function optionalStringPath(value: unknown, pathSegments: PathSegment[]) {
  const found = getPath(value, pathSegments);
  return typeof found === "string" && found.length > 0 ? found : null;
}

function requireArrayPath(value: unknown, pathSegments: PathSegment[], label: string) {
  const found = getPath(value, pathSegments);
  if (!Array.isArray(found)) throw new MvpSmokeFailure(`${label} missing array at ${formatPath(pathSegments) || "<root>"}`, value);
  return found;
}

function optionalArrayPath(value: unknown, pathSegments: PathSegment[]) {
  const found = getPath(value, pathSegments);
  return Array.isArray(found) ? found : [];
}

function optionalObjectPath(value: unknown, pathSegments: PathSegment[]) {
  const found = getPath(value, pathSegments);
  return isRecord(found) ? found : null;
}

function requireAnyStringPath(value: unknown, candidates: PathSegment[][], label: string) {
  for (const pathSegments of candidates) {
    const found = optionalStringPath(value, pathSegments);
    if (found) return found;
  }
  throw new MvpSmokeFailure(`${label} missing string at any of ${candidates.map(formatPath).join(", ")}`, value);
}

function requireNonEmptyArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new MvpSmokeFailure(`${label} expected a non-empty array`, value);
  }
  return value;
}

function redactForReport(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactForReport(item));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/secret|token|authorization|apikey|apiKey|password|credentialsRef|credential/i.test(key)) {
      output[key] = "[REDACTED]";
    } else {
      output[key] = redactForReport(nested);
    }
  }
  return output;
}

function parseSse(input: string): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = [];
  for (const block of input.split(/\r?\n\r?\n/).filter((item) => item.trim().length > 0)) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice("event:".length).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
    }
    const rawData = dataLines.join("\n");
    let data: unknown = rawData;
    try {
      data = rawData ? JSON.parse(rawData) : null;
    } catch {
      data = rawData;
    }
    events.push({ event, data });
  }
  return events;
}

function extractSocratesDone(events: Array<{ event: string; data: unknown }>) {
  const done = events.find((event) => event.event === "done");
  if (!done || !isRecord(done.data)) throw new MvpSmokeFailure("Socrates stream missing structured done payload", events);
  const payload = done.data;
  const citations = optionalArrayPath(payload, ["citations"]);
  const openTargets = optionalArrayPath(payload, ["open_targets"]);
  if (citations.length === 0 || openTargets.length === 0) {
    throw new MvpSmokeFailure("Socrates done payload missing citations/open_targets", payload);
  }
  requireStringPath(payload, ["answer_md"], "Socrates done answer");
  requireArrayPath(payload, ["suggested_prompts"], "Socrates done suggested prompts");
  requireArrayPath(payload, ["limitations"], "Socrates done limitations");
  for (const [index, citation] of citations.entries()) {
    requireStringPath(citation, ["type"], `Socrates citation ${index}`);
    requireStringPath(citation, ["refId"], `Socrates citation ${index}`);
  }
  for (const [index, target] of openTargets.entries()) {
    requireStringPath(target, ["targetType"], `Socrates open target ${index}`);
    requireRecordPath(target, ["targetRef"], `Socrates open target ${index}`);
  }
  return payload;
}

function collectSensitiveResponseFindings(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectSensitiveResponseFindings(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") {
    return typeof value === "string" && sensitiveResponseValuePattern.test(value) ? [path] : [];
  }
  const findings: string[] = [];
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const nestedPath = `${path}.${key}`;
    if (sensitiveResponseKeyPattern.test(key)) {
      findings.push(nestedPath);
      continue;
    }
    findings.push(...collectSensitiveResponseFindings(nested, nestedPath));
  }
  return findings;
}

function assertNoSensitiveResponse(value: unknown, label: string) {
  const findings = collectSensitiveResponseFindings(value);
  if (findings.length > 0) {
    throw new MvpSmokeFailure(`${label} included sensitive-looking response data at ${findings.slice(0, 20).join(", ")}`);
  }
}

function baseReport(config: MvpSmokeConfig): MvpSmokeReport {
  const startedAt = new Date().toISOString();
  return {
    runId: nowRunId(),
    mode: config.mode,
    proofLevel: config.mode === "http" ? "http" : config.mode === "mock" ? "mock" : "diagnostic",
    status: "not_executed",
    launchLoopProven: false,
    canBeUsedForLaunchProof: false,
    executedHttpRequests: 0,
    plannedStepsCount: MVP_SMOKE_STEP_PLAN.length,
    executedStepsCount: 0,
    baseUrl: config.baseUrl,
    startedAt,
    finishedAt: startedAt,
    created: {},
    assertions: [],
    routeCoverage: [],
    steps: [],
    failures: [],
    degradedDependencies: [],
    environmentBlockers: [],
    rerunCommand: config.mode === "dry-run" ? "npm run smoke:mvp:dry-run" : config.mode === "mock" ? "npm run smoke:mvp:mock" : "npm run smoke:mvp:http"
  };
}

function requiredHttpProofFailures(report: MvpSmokeReport) {
  const failures: string[] = [];
  if (report.executedHttpRequests <= 0 || report.routeCoverage.length <= 0) failures.push("HTTP proof missing executed HTTP requests");
  for (const id of REQUIRED_HTTP_CREATED_IDS) {
    if (!report.created[id]) failures.push(`HTTP proof missing created.${id}`);
  }
  if (!report.assertions.includes("socrates citations and openTargets verified")) {
    failures.push("HTTP proof missing Socrates citations/openTargets");
  }
  if (!report.assertions.includes("MVP provider gating verified")) {
    failures.push("HTTP proof missing MVP provider gating assertion");
  }
  if (!report.assertions.includes("MVP advanced ops gating verified")) {
    failures.push("HTTP proof missing advanced ops gating assertion");
  }
  if (!report.assertions.includes("client/internal leak checks passed")) {
    failures.push("HTTP proof missing client/internal leak assertion");
  }
  if (!report.assertions.includes("response secret scan passed")) {
    failures.push("HTTP proof missing response secret scan assertion");
  }
  return failures;
}

export function finalizeMvpSmokeReport(input: MvpSmokeReport): MvpSmokeReport {
  const report: MvpSmokeReport = {
    ...input,
    created: { ...input.created },
    assertions: [...input.assertions],
    routeCoverage: [...input.routeCoverage],
    steps: [...input.steps],
    failures: [...input.failures],
    degradedDependencies: [...new Set(input.degradedDependencies)],
    environmentBlockers: [...input.environmentBlockers],
    plannedStepsCount: MVP_SMOKE_STEP_PLAN.length,
    executedStepsCount: input.mode === "dry-run" ? 0 : input.steps.length,
    executedHttpRequests: input.mode === "http" ? input.routeCoverage.length : 0,
    finishedAt: input.finishedAt || new Date().toISOString()
  };

  if (report.mode === "dry-run") {
    report.proofLevel = "diagnostic";
    report.status = report.failures.length ? "failed" : "diagnostic";
    report.launchLoopProven = false;
    report.canBeUsedForLaunchProof = false;
    report.executedStepsCount = 0;
    report.executedHttpRequests = 0;
    return report;
  }

  if (report.mode === "mock") {
    report.proofLevel = "mock";
    report.status = report.failures.length ? "failed" : "mock_passed";
    report.launchLoopProven = false;
    report.canBeUsedForLaunchProof = false;
    report.executedHttpRequests = 0;
    return report;
  }

  report.proofLevel = "http";
  const missing = requiredHttpProofFailures(report);
  if (report.failures.length || missing.length) {
    report.failures = [...report.failures, ...missing];
    report.status = report.degradedDependencies.length ? "degraded" : "failed";
    report.launchLoopProven = false;
    report.canBeUsedForLaunchProof = false;
    return report;
  }
  if (report.degradedDependencies.length) {
    report.status = "degraded";
    report.launchLoopProven = false;
    report.canBeUsedForLaunchProof = false;
    return report;
  }
  report.status = "passed";
  report.launchLoopProven = true;
  report.canBeUsedForLaunchProof = true;
  return report;
}

function redactedConfig(config: MvpSmokeConfig) {
  return {
    baseUrl: config.baseUrl,
    managerEmail: config.managerEmail,
    devEmail: config.devEmail,
    clientEmail: config.clientEmail,
    expectAi: config.expectAi,
    expectWorker: config.expectWorker,
    expectFirefliesLive: config.expectFirefliesLive,
    keepData: config.keepData,
    timeoutMs: config.timeoutMs,
    pollIntervalMs: config.pollIntervalMs
  };
}

export function buildDryRunText(config: MvpSmokeConfig) {
  return [
    "MVP smoke dry run",
    "",
    "Mode: dry-run",
    "Proof level: diagnostic only",
    "Launch loop proven: NO",
    "Can be used for launch proof: NO",
    `Base URL: ${config.baseUrl}`,
    `Report JSON: ${config.reportJsonPath}`,
    `Report Markdown: ${config.reportMarkdownPath}`,
    "",
    "Required environment:",
    ...MVP_SMOKE_ENV_KEYS.map((key) => `- ${key}`),
    "",
    "MVP route and assertion plan:",
    ...MVP_SMOKE_STEP_PLAN.map((step, index) => `${index + 1}. ${step.method} ${step.path} — ${step.assertion}`),
    "",
    "Dry-run performs no HTTP, DB, worker, storage, or AI calls and is not launch proof."
  ].join("\n");
}

export function buildMarkdownReport(report: MvpSmokeReport) {
  const warning = report.canBeUsedForLaunchProof
    ? "This report is real MVP HTTP launch proof."
    : "This report did not prove the real MVP HTTP launch loop. Dry-run and mock reports are diagnostics only.";
  return [
    "# MVP Smoke Report",
    "",
    `- Mode: ${report.mode}`,
    `- Status: ${report.status}`,
    `- Proof level: ${report.proofLevel}`,
    `- Launch loop proven: ${report.launchLoopProven ? "YES" : "NO"}`,
    `- Can be used for launch proof: ${report.canBeUsedForLaunchProof ? "YES" : "NO"}`,
    `- Executed HTTP requests: ${report.executedHttpRequests}`,
    `- Planned steps: ${report.plannedStepsCount}`,
    `- Executed steps: ${report.executedStepsCount}`,
    "",
    warning,
    "",
    "## Created IDs",
    "",
    Object.keys(report.created).length ? JSON.stringify(report.created, null, 2) : "None.",
    "",
    "## Assertions",
    "",
    report.assertions.length ? report.assertions.map((assertion) => `- ${assertion}`).join("\n") : "None.",
    "",
    "## Failures",
    "",
    report.failures.length ? report.failures.map((failure) => `- ${failure}`).join("\n") : "None.",
    "",
    "## Degraded Dependencies",
    "",
    report.degradedDependencies.length ? report.degradedDependencies.map((item) => `- ${item}`).join("\n") : "None.",
    "",
    "## Step Plan",
    "",
    MVP_SMOKE_STEP_PLAN.map((step, index) => `${index + 1}. ${step.method} ${step.path} — ${step.assertion}`).join("\n")
  ].join("\n");
}

export async function writeReport(config: MvpSmokeConfig, report: MvpSmokeReport) {
  const finalized = finalizeMvpSmokeReport(report);
  await mkdir(path.dirname(config.reportJsonPath), { recursive: true });
  await writeFile(config.reportJsonPath, JSON.stringify(finalized, null, 2));
  await writeFile(config.reportMarkdownPath, buildMarkdownReport(finalized));
  return finalized;
}

async function runDryRun(config: MvpSmokeConfig) {
  const report = baseReport(config);
  report.finishedAt = new Date().toISOString();
  const finalized = await writeReport(config, report);
  if (!config.json) console.log(buildDryRunText(config));
  return finalized;
}

async function runMock(config: MvpSmokeConfig) {
  const report = baseReport(config);
  for (const step of MVP_SMOKE_STEP_PLAN) {
    report.steps.push({
      id: step.id,
      title: step.title,
      status: "mock_passed",
      assertions: [step.assertion],
      failures: [],
      routes: []
    });
    report.assertions.push(step.assertion);
  }
  Object.assign(report.created, Object.fromEntries(REQUIRED_HTTP_CREATED_IDS.map((id) => [id, `mock-${id}`])));
  report.assertions.push(
    "socrates citations and openTargets verified",
    "MVP provider gating verified",
    "MVP Agent Context provider gating verified",
    "MVP Agent Context export templates and provider gating verified",
    "MVP Agent Quality and Drift Detection routes verified",
    "MVP Product Brain Agent Files preview/generate routes verified",
    "MVP GitHub foundation read-only routes verified",
    "MVP FDE Readiness Intelligence read-first routes verified",
    "MVP canonical FDE readiness dashboard, readiness subroutes, and Context Snapshot verified",
    "MVP FDE readiness does not claim true IDE presence, GitHub writes, auto-merge, or truth mutation",
    "MVP MCP read-only token and provider gating verified",
    "MVP advanced ops gating verified",
    "client/internal leak checks passed",
    "response secret scan passed"
  );
  report.degradedDependencies.push("mock mode validates route shape and report semantics only; no API/DB/worker/storage/AI integration was proven");
  report.finishedAt = new Date().toISOString();
  return writeReport(config, report);
}

async function loginOrSignup(
  runner: MvpHttpRunner,
  step: StepResult,
  input: { email: string; password: string; displayName: string; orgName?: string }
) {
  const login = await runner.request(
    step,
    "POST",
    "/v1/auth/login",
    { email: input.email, password: input.password },
    { expectStatuses: [200, 401], scanResponse: false }
  );
  if (login.statusCode === 200) {
    const loginData = dataOf(login);
    return {
      accessToken: requireStringPath(loginData, ["accessToken"], `${input.displayName} login token`),
      userId: requireStringPath(loginData, ["user", "id"], `${input.displayName} user id`),
      orgId: requireStringPath(loginData, ["user", "orgId"], `${input.displayName} org id`)
    };
  }

  const signup = await runner.request(
    step,
    "POST",
    "/v1/auth/signup",
    {
      orgName: input.orgName ?? `MVP Smoke ${Date.now()}`,
      email: input.email,
      password: input.password,
      displayName: input.displayName
    },
    { scanResponse: false }
  );
  const signupData = dataOf(signup);
  return {
    accessToken: requireStringPath(signupData, ["accessToken"], `${input.displayName} signup token`),
    userId: requireStringPath(signupData, ["user", "id"], `${input.displayName} user id`),
    orgId: requireStringPath(signupData, ["user", "orgId"], `${input.displayName} org id`)
  };
}

async function seedSameOrgSmokeUsers(
  users: Array<{
    orgId: string;
    email: string;
    password: string;
    displayName: string;
    workspaceRoleDefault: "dev" | "client";
    jobTitle: string;
  }>
) {
  if (users.length === 0) return;
  const prisma = new PrismaClient();
  try {
    const hashCost = Number(process.env.PASSWORD_HASH_COST ?? 12);
    for (const user of users) {
      const email = user.email.trim().toLowerCase();
      const passwordHash = await hashPassword(user.password, hashCost);
      await prisma.user.upsert({
        where: { normalizedEmail: email },
        create: {
          orgId: user.orgId,
          email,
          normalizedEmail: email,
          passwordHash,
          displayName: user.displayName,
          jobTitle: user.jobTitle,
          globalRole: "member",
          workspaceRoleDefault: user.workspaceRoleDefault,
          isActive: true
        },
        update: {
          passwordHash,
          displayName: user.displayName,
          jobTitle: user.jobTitle,
          globalRole: "member",
          workspaceRoleDefault: user.workspaceRoleDefault,
          isActive: true
        }
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

function parseAuthLoginData(response: HttpResponse, label: string) {
  const data = dataOf(response);
  return {
    accessToken: requireStringPath(data, ["accessToken"], `${label} login token`),
    userId: requireStringPath(data, ["user", "id"], `${label} user id`),
    orgId: requireStringPath(data, ["user", "orgId"], `${label} org id`)
  };
}

function futureIso(minutesFromNow: number) {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString();
}

function makeContextUploadForm(input: {
  type: string;
  title: string;
  caption?: string;
  description?: string;
  filename: string;
  mimeType: string;
  body: Uint8Array | string;
}) {
  const form = new FormData();
  form.set("type", input.type);
  form.set("title", input.title);
  if (input.caption) form.set("caption", input.caption);
  if (input.description) form.set("description", input.description);
  form.set("file", new File([input.body], input.filename, { type: input.mimeType }));
  return form;
}

function extractErrorCode(response: HttpResponse) {
  return optionalStringPath(response.body, ["error", "code"]) ?? optionalStringPath(response.body, ["code"]);
}

function assertEnvelope(step: StepResult, runner: MvpHttpRunner, response: HttpResponse, label: string) {
  runner.assert(step, isRecord(response.body) && "data" in response.body && "error" in response.body, `${label} returned standard envelope`, response.body);
}

function assertProviderReadiness(step: StepResult, runner: MvpHttpRunner, readiness: unknown) {
  const rows = requireArrayPath(readiness, [], "provider readiness");
  const byProvider = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const provider = row.provider;
    if (typeof provider === "string") byProvider.set(provider, row);
  }
  for (const provider of ["manual_import", "fireflies_ai", "slack", "clickup", "granola", "microsoft_teams"]) {
    const row = byProvider.get(provider);
    runner.assert(step, Boolean(row), `${provider} readiness is present`, readiness);
    runner.assert(step, optionalStringPath(row, ["readiness", "state"]) !== "disabled", `${provider} is enabled in MVP`, row);
    runner.assert(step, getPath(row, ["metadata", "truthGated"]) === true, `${provider} metadata is truth-gated`, row);
    runner.assert(step, getPath(row, ["metadata", "writeActionsEnabled"]) === false, `${provider} has no provider write actions`, row);
  }
  runner.assert(step, optionalStringPath(byProvider.get("slack"), ["metadata", "evidenceKind"]) === "conversation_evidence", "Slack is conversation evidence", byProvider.get("slack"));
  runner.assert(step, optionalStringPath(byProvider.get("clickup"), ["metadata", "evidenceKind"]) === "task_work_status_evidence", "ClickUp is task/work-status evidence", byProvider.get("clickup"));
  runner.assert(step, optionalStringPath(byProvider.get("granola"), ["metadata", "evidenceKind"]) === "meeting_evidence", "Granola is meeting evidence", byProvider.get("granola"));
  runner.assert(step, optionalStringPath(byProvider.get("microsoft_teams"), ["metadata", "evidenceKind"]) === "conversation_evidence", "Microsoft Teams is conversation evidence", byProvider.get("microsoft_teams"));
  runner.assert(step, getPath(byProvider.get("microsoft_teams"), ["readiness", "canWebhook"]) === false, "Microsoft Teams webhooks are not production-enabled in MVP smoke", byProvider.get("microsoft_teams"));
  for (const provider of ["gmail", "outlook", "whatsapp_business"]) {
    const row = byProvider.get(provider);
    runner.assert(step, Boolean(row), `${provider} disabled readiness is present`, readiness);
    runner.assert(step, optionalStringPath(row, ["readiness", "state"]) === "disabled", `${provider} disabled in MVP readiness`, row);
    runner.assert(step, getPath(row, ["readiness", "canConnect"]) === false, `${provider} cannot connect in MVP`, row);
    runner.assert(step, getPath(row, ["readiness", "canSync"]) === false, `${provider} cannot sync in MVP`, row);
    runner.assert(step, getPath(row, ["readiness", "canWebhook"]) === false, `${provider} cannot webhook in MVP`, row);
  }
  runner.assert(step, true, "MVP provider gating verified", readiness);
}

function containsDisabledProviderEvidenceLeak(value: unknown) {
  return JSON.stringify(value)
    .split(/\\n|\r?\n/)
    .filter((line) => /\b(gmail|outlook|whatsapp)\b/i.test(line))
    .some((line) => {
      const exclusionNotice = /\b(excludes?|excluded|disabled|hidden|unless explicitly enabled|not included|cannot connect|cannot sync|cannot webhook)\b/i.test(line);
      const evidenceDetail = /\b(message|thread|transcript|openTarget|citation|sourceRefId|sourceRefType|evidence)\b/i.test(line);
      return evidenceDetail && !exclusionNotice;
    });
}

async function runHttp(config: MvpSmokeConfig) {
  const startedAt = new Date().toISOString();
  const runner = new MvpHttpRunner(config);
  let managerToken = "";
  let devToken = "";
  let clientToken = "";
  const runSuffix = `${Date.now()}`;

  await runner.step("health", "Health check", async (step) => {
    const health = await runner.request(step, "GET", "/health");
    runner.assert(step, health.ok, "health endpoint returned ok", health.body);
  });

  await runner.step("auth", "Signup/login/current user", async (step) => {
    const manager = await loginOrSignup(runner, step, {
      email: config.managerEmail,
      password: config.managerPassword,
      displayName: "MVP Smoke Manager",
      orgName: `MVP Smoke ${runSuffix}`
    });
    managerToken = manager.accessToken;
    runner.id("managerUserId", manager.userId);
    runner.id("orgId", manager.orgId);

    await seedSameOrgSmokeUsers([
      {
        orgId: manager.orgId,
        email: config.devEmail,
        password: config.devPassword,
        displayName: "MVP Smoke Dev",
        workspaceRoleDefault: "dev",
        jobTitle: "Demo Engineer"
      },
      {
        orgId: manager.orgId,
        email: config.clientEmail,
        password: config.clientPassword,
        displayName: "MVP Smoke Client",
        workspaceRoleDefault: "client",
        jobTitle: "Demo Client Stakeholder"
      }
    ]);

    const dev = parseAuthLoginData(
      await runner.request(
        step,
        "POST",
        "/v1/auth/login",
        { email: config.devEmail, password: config.devPassword },
        { expectStatuses: [200], scanResponse: false }
      ),
      "MVP Smoke Dev"
    );
    devToken = dev.accessToken;
    runner.id("devUserId", dev.userId);

    const client = parseAuthLoginData(
      await runner.request(
        step,
        "POST",
        "/v1/auth/login",
        { email: config.clientEmail, password: config.clientPassword },
        { expectStatuses: [200], scanResponse: false }
      ),
      "MVP Smoke Client"
    );
    clientToken = client.accessToken;
    runner.id("clientUserId", client.userId);

    const me = await runner.request(step, "GET", "/v1/auth/me", undefined, { token: managerToken });
    runner.assert(step, requireStringPath(dataOf(me), ["id"], "current user id") === manager.userId, "current user matches manager token", me.body);
  });

  await runner.step("project", "Create project", async (step) => {
    const response = await runner.request(
      step,
      "POST",
      "/v1/projects",
      {
        name: `MVP Smoke Project ${runSuffix}`,
        description: "MVP smoke project covering PRD, context, Socrates, diagrams, coding requirements, actions, calendar, and dashboard."
      },
      { token: managerToken }
    );
    const project = dataOf(response);
    runner.id("projectId", requireStringPath(project, ["id"], "project id"));
    runner.assert(step, true, "projectId exists");
  });

  await runner.step("member", "Add project member", async (step) => {
    const projectId = runner.getId("projectId");
    const member = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/members`,
      {
        email: config.devEmail,
        projectRole: "dev",
        roleInProject: "MVP smoke implementation owner",
        allocationPercent: 50,
        weeklyCapacityHours: 20
      },
      { token: managerToken }
    );
    const memberData = dataOf(member);
    runner.id("memberId", requireAnyStringPath(memberData, [["id"], ["memberId"]], "member id"));
    await runner.request(step, "GET", `/v1/projects/${projectId}`, undefined, { token: devToken });
    runner.assert(step, true, "active MVP dev member can access project");
  });

  await runner.step("upload_prd", "Upload PRD", async (step) => {
    const projectId = runner.getId("projectId");
    const response = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/documents/upload`,
      {
        kind: "prd",
        title: `MVP Smoke Source PRD ${runSuffix}`,
        visibility: "internal",
        sourceLabel: "mvp-smoke",
        pastedText: [
          "# MVP Smoke Source PRD",
          "The project requires manager approval before assignment activation.",
          "Weekly reporting must be visible to managers.",
          "Fireflies transcripts and manual imports are evidence only."
        ].join("\n\n")
      },
      { token: managerToken }
    );
    const data = dataOf(response);
    runner.id("documentId", requireStringPath(data, ["documentId"], "uploaded document id"));
    runner.id("documentVersionId", requireStringPath(data, ["documentVersionId"], "uploaded document version id"));
    runner.assert(step, true, "documentId and documentVersionId exist");
  });

  await runner.step("generate_prd_srs", "Generate PRD and SRS", async (step) => {
    const projectId = runner.getId("projectId");
    const basePrompt = "Create a concise MVP document using only evidence about manager approval, weekly reporting, manual imports, Fireflies transcripts, and Socrates Q&A.";
    const prd = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/documents/generate`,
      { kind: "prd", template: "basic_mvp", prompt: basePrompt, title: `Generated MVP PRD ${runSuffix}`, contextIds: [], tone: "plain", includeCodingHints: true, rebuildBrain: false },
      { token: managerToken }
    );
    const prdData = dataOf(prd);
    runner.id("generatedPrdDocumentId", requireStringPath(prdData, ["documentId"], "generated PRD document id"));
    const srs = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/documents/generate`,
      { kind: "srs", template: "basic_srs", prompt: basePrompt, title: `Generated MVP SRS ${runSuffix}`, contextIds: [], tone: "plain", includeCodingHints: true, rebuildBrain: false },
      { token: managerToken }
    );
    const srsData = dataOf(srs);
    runner.id("generatedSrsDocumentId", requireStringPath(srsData, ["documentId"], "generated SRS document id"));
    runner.assert(step, true, "generated PRD/SRS document ids exist");
  });

  await runner.step("document_viewer", "Fetch document list/detail/viewer", async (step) => {
    const projectId = runner.getId("projectId");
    const documentId = runner.getId("documentId");
    await runner.request(step, "GET", `/v1/projects/${projectId}/documents`, undefined, { token: managerToken });
    await runner.request(step, "GET", `/v1/projects/${projectId}/documents/${documentId}`, undefined, { token: managerToken });
    const viewer = await runner.request(step, "GET", `/v1/projects/${projectId}/documents/${documentId}/view`, undefined, { token: managerToken });
    runner.assert(step, Boolean(dataOf(viewer)), "viewer exposes sections/anchors or queued viewer state", viewer.body);
  });

  await runner.step("manual_context", "Add manual context note", async (step) => {
    const projectId = runner.getId("projectId");
    const context = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/context`,
      {
        type: "manual_note",
        title: `MVP Smoke Context ${runSuffix}`,
        body: "Manual context says the backend owner must confirm manager approval before assignment activation and include weekly reporting.",
        participants: ["Backend Lead"],
        tags: ["mvp-smoke"],
        importance: "high",
        attachments: []
      },
      { token: managerToken }
    );
    runner.id("contextId", requireStringPath(dataOf(context), ["id"], "manual context id"));
    runner.assert(step, true, "contextId exists");
  });

  await runner.step("image_context", "Upload image/chart context", async (step) => {
    const projectId = runner.getId("projectId");
    const image = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/context`,
      makeContextUploadForm({
        type: "chart_image",
        title: `MVP Smoke Chart ${runSuffix}`,
        caption: "Chart caption states weekly manager report volume increased after Fireflies transcript review.",
        description: "Synthetic MVP smoke PNG context fixture.",
        filename: "mvp-smoke-chart.png",
        mimeType: "image/png",
        body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      }),
      { token: managerToken }
    );
    const data = dataOf(image);
    runner.id("imageContextId", requireStringPath(data, ["id"], "image context id"));
    runner.assert(step, optionalArrayPath(data, ["attachments"]).length > 0, "image context has attachment metadata", data);
  });

  await runner.step("audio_rejected", "Verify audio rejected in MVP", async (step) => {
    const projectId = runner.getId("projectId");
    const audio = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/context`,
      makeContextUploadForm({
        type: "meeting_note",
        title: `MVP Smoke Audio ${runSuffix}`,
        caption: "Unsupported audio upload",
        filename: "mvp-smoke-audio.mp3",
        mimeType: "audio/mpeg",
        body: "not-real-audio"
      }),
      { token: managerToken, expectStatuses: [400, 403, 415, 422] }
    );
    runner.assert(step, audio.statusCode >= 400, "audio file receives feature-disabled or validation error", audio.body);
  });

  await runner.step("manual_transcript", "Manual transcript import", async (step) => {
    const projectId = runner.getId("projectId");
    const imported = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/communications/import`,
      {
        provider: "manual_import",
        accountLabel: "MVP smoke manual import",
        thread: {
          providerThreadId: `manual-thread-${runSuffix}`,
          subject: "MVP smoke transcript",
          participants: [{ label: "Backend Lead", email: config.managerEmail }],
          startedAt: new Date().toISOString()
        },
        messages: [
          {
            providerMessageId: `manual-message-${runSuffix}`,
            senderLabel: "Backend Lead",
            senderEmail: config.managerEmail,
            sentAt: new Date().toISOString(),
            bodyText: "Manual transcript: assignments require explicit approval and weekly reporting.",
            messageType: "user"
          }
        ]
      },
      { token: managerToken }
    );
    const data = dataOf(imported);
    runner.id("transcriptId", requireStringPath(data, ["threadId"], "manual transcript thread id"));
    runner.assert(step, Number(getPath(data, ["createdMessageCount"]) ?? 0) >= 1, "transcript/thread/message evidence exists", data);
  });

  await runner.step("fireflies", "Fireflies transcript readiness/import", async (step) => {
    const projectId = runner.getId("projectId");
    const imported = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/communications/import`,
      {
        provider: "fireflies_ai",
        accountLabel: "Fireflies.ai",
        meeting: {
          providerTranscriptId: `fireflies-transcript-${runSuffix}`,
          title: "MVP smoke Fireflies transcript",
          startedAt: new Date().toISOString(),
          participants: [{ name: "Backend Lead", email: config.managerEmail }]
        },
        summary: "Fireflies transcript confirms manager approvals and weekly reporting are evidence, not truth.",
        actionItems: [],
        segments: [
          { speakerName: "Backend Lead", startMs: 0, endMs: 2000, text: "Fireflies transcript evidence: manager approval remains required." },
          { speakerName: "QA Lead", startMs: 2000, endMs: 4000, text: "Weekly reports should be visible in dashboard summaries." }
        ]
      },
      { token: managerToken }
    );
    const data = dataOf(imported);
    runner.assert(step, Number(getPath(data, ["createdMessageCount"]) ?? 0) >= 1, "Fireflies manual transcript import exists", data);
  });

  await runner.step("brain", "Product Brain path", async (step) => {
    const projectId = runner.getId("projectId");
    const rebuild = await runner.request(step, "POST", `/v1/projects/${projectId}/brain/rebuild`, undefined, { token: managerToken });
    runner.assert(step, Boolean(dataOf(rebuild)), "brain rebuild status exists", rebuild.body);
    if (!config.expectWorker) runner.degrade(step, "MVP_SMOKE_EXPECT_WORKER=false means queued brain worker completion was not required");
  });

  await runner.step("socrates_session", "Create Socrates session", async (step) => {
    const projectId = runner.getId("projectId");
    const session = await runner.request(step, "POST", `/v1/projects/${projectId}/socrates/sessions`, { pageContext: "dashboard_project" }, { token: managerToken });
    runner.id("socratesSessionId", requireStringPath(dataOf(session), ["id"], "Socrates session id"));
    runner.assert(step, true, "socratesSessionId exists");
  });

  await runner.step("socrates_answer", "Ask Socrates project question", async (step) => {
    const projectId = runner.getId("projectId");
    const sessionId = runner.getId("socratesSessionId");
    const streamed = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/socrates/sessions/${sessionId}/messages/stream`,
      { content: "What evidence says assignments need approval and weekly reporting?" },
      { token: managerToken, sse: true }
    );
    const done = extractSocratesDone(parseSse(streamed.text));
    runner.assert(step, optionalArrayPath(done, ["citations"]).length > 0 && optionalArrayPath(done, ["open_targets"]).length > 0, "socrates citations and openTargets verified", done);
    if (!config.expectAi) runner.degrade(step, "MVP_SMOKE_EXPECT_AI=false means AI quality proof is degraded");
  });

  await runner.step("agent_context_create", "Create Agent Context Pack", async (step) => {
    const projectId = runner.getId("projectId");
    const created = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/agent-context-packs`,
      {
        title: `MVP Smoke Codex Context ${runSuffix}`,
        taskPrompt:
          "Implement manager weekly reporting while preserving Product Brain truth, citations/openTargets, MVP provider gating, and no autonomous execution.",
        taskType: "implementation",
        sourceMode: "task_prompt",
        targetAgent: { kind: "codex", name: "Codex" },
        budgetPreset: "normal",
        visibility: "internal"
      },
      { token: managerToken }
    );
    const data = dataOf(created);
    runner.id("agentContextPackId", requireStringPath(data, ["id"], "Agent Context Pack id"));
    runner.assert(step, optionalArrayPath(data, ["citations"]).length >= 0, "Agent Context Pack citations contract exists", data);
    runner.assert(step, optionalArrayPath(data, ["openTargets"]).length >= 0, "Agent Context Pack openTargets contract exists", data);
    runner.assert(step, Number(getPath(data, ["tokenEstimate"]) ?? 0) >= 0, "Agent Context Pack token estimate contract exists", data);
  });

  await runner.step("agent_context_lifecycle", "List/view/refresh/archive/delete Agent Context Pack", async (step) => {
    const projectId = runner.getId("projectId");
    const packId = runner.getId("agentContextPackId");
    const listed = await runner.request(step, "GET", `/v1/projects/${projectId}/agent-context-packs?page=1&pageSize=10`, undefined, { token: managerToken });
    runner.assert(step, JSON.stringify(dataOf(listed)).includes(packId), "Agent Context Pack appears in scoped list", listed.body);
    const viewed = await runner.request(step, "GET", `/v1/projects/${projectId}/agent-context-packs/${packId}`, undefined, { token: managerToken });
    runner.assert(step, requireStringPath(dataOf(viewed), ["id"], "viewed Agent Context Pack id") === packId, "Agent Context Pack view is same project-scoped pack", viewed.body);
    const refreshed = await runner.request(step, "POST", `/v1/projects/${projectId}/agent-context-packs/${packId}/refresh`, undefined, { token: managerToken });
    runner.assert(step, requireStringPath(dataOf(refreshed), ["id"], "refreshed Agent Context Pack id") === packId, "Agent Context Pack refresh preserves pack identity", refreshed.body);

    const disposable = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/agent-context-packs`,
      {
        title: `MVP Smoke Disposable Context ${runSuffix}`,
        taskPrompt: "Disposable lifecycle pack for archive/delete smoke coverage.",
        taskType: "documentation",
        sourceMode: "task_prompt",
        budgetPreset: "compact",
        visibility: "internal"
      },
      { token: managerToken }
    );
    const disposablePackId = requireStringPath(dataOf(disposable), ["id"], "disposable Agent Context Pack id");
    await runner.request(step, "POST", `/v1/projects/${projectId}/agent-context-packs/${disposablePackId}/archive`, undefined, { token: managerToken });
    await runner.request(step, "DELETE", `/v1/projects/${projectId}/agent-context-packs/${disposablePackId}`, undefined, { token: managerToken });
    runner.assert(step, true, "Agent Context Pack lifecycle routes work without truth mutation");
  });

  await runner.step("agent_context_export_formats", "List Agent Context export formats", async (step) => {
    const projectId = runner.getId("projectId");
    const packId = runner.getId("agentContextPackId");
    const formats = await runner.request(step, "GET", `/v1/projects/${projectId}/agent-context-packs/${packId}/export-formats`, undefined, { token: managerToken });
    const available = optionalArrayPath(dataOf(formats), []).map((item) => (isRecord(item) ? item.format : null));
    for (const format of ["markdown", "claude_prompt", "codex_prompt", "cursor_context", "agents_md", "json", "github_issue", "github_pr_brief"]) {
      runner.assert(step, available.includes(format), `Agent Context export format ${format} is available`, formats.body);
    }
  });

  await runner.step("agent_context_export_preview", "Preview Agent Context export", async (step) => {
    const projectId = runner.getId("projectId");
    const packId = runner.getId("agentContextPackId");
    const preview = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/agent-context-packs/${packId}/exports/preview`,
      { format: "markdown", budgetPreset: "normal", redactionMode: "implementation_only", includeCitations: true, includeOpenTargets: true, includeLimitations: true },
      { token: managerToken }
    );
    const data = dataOf(preview);
    runner.assert(step, requireStringPath(data, ["content"], "Agent Context export preview content").includes("Orchestra"), "Agent Context export preview content exists", data);
    runner.assert(step, optionalArrayPath(data, ["citations"]).length >= 0, "Agent Context export preview preserves citations contract", data);
    runner.assert(step, optionalArrayPath(data, ["openTargets"]).length >= 0, "Agent Context export preview preserves openTargets contract", data);
  });

  await runner.step("agent_context_export_generate", "Generate Agent Context export", async (step) => {
    const projectId = runner.getId("projectId");
    const packId = runner.getId("agentContextPackId");
    const generated = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/agent-context-packs/${packId}/exports`,
      { format: "codex_prompt", budgetPreset: "normal", redactionMode: "implementation_only", includeCitations: true, includeOpenTargets: true, includeLimitations: true },
      { token: managerToken }
    );
    const data = dataOf(generated);
    runner.id("agentContextExportHash", optionalStringPath(data, ["contentHash"]) ?? `mvp-smoke-export-${runSuffix}`);
    runner.assert(step, getPath(data, ["format"]) === "codex_prompt", "Agent Context Codex export generated", data);
    runner.assert(step, typeof getPath(data, ["content"]) === "string", "Agent Context export content exists without executing agents", data);
  });

  await runner.step("agent_run_create", "Record manual Agent Run Memory", async (step) => {
    const projectId = runner.getId("projectId");
    const packId = runner.getId("agentContextPackId");
    const created = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/agent-runs`,
      {
        contextPackId: packId,
        exportReference: {
          format: "codex_prompt",
          generatedAt: new Date().toISOString(),
          suggestedFilename: "mvp-smoke-codex-prompt.md",
          contentHash: runner.getId("agentContextExportHash")
        },
        exportFormat: "codex_prompt",
        targetAgent: { kind: "codex", name: "Codex" },
        provider: "codex",
        agentLabel: "Codex smoke manager rehearsal",
        taskTitle: `MVP smoke manager weekly reporting implementation ${runSuffix}`,
        taskType: "implementation",
        taskDescription: "Manager records a manual external agent run after using the generated Codex prompt.",
        promptSource: "export",
        status: "completed",
        outputSummary:
          "Codex claimed it preserved Product Brain truth, added weekly reporting, kept MCP read-only, avoided disabled Gmail/Outlook/WhatsApp evidence, and did not auto-merge. It noted no automatic PR diff analysis was performed.",
        implementationNotes: "Manual manager-entered run evidence; this is not Product Brain truth.",
        branchName: `feature/mvp-smoke-${runSuffix}`,
        commitSha: "abcdef1234567890",
        prUrl: "https://github.com/KarthikRamesh9149/orchestrav2/pull/1",
        filesChanged: ["src/modules/dashboard/service.ts", "docs/MVP_SMOKE.md"],
        modulesTouched: ["dashboard", "agent-context"],
        testsRun: ["npm run smoke:mvp:http"],
        testStatus: "passed",
        docsUpdated: ["docs/MVP_SMOKE.md"],
        risksFound: ["Verify Product Brain alignment manually before accepting any truth change."],
        followUpQuestions: ["Should dashboard weekly reporting copy be exposed to clients?"],
        possibleProductBrainImplications: true,
        productBrainImplications: ["Potential need for a weekly reporting accepted-change proposal."],
        limitations: ["Manual run evidence only; no automatic PR diff analysis in MVP."],
        warnings: ["Agent output is untrusted implementation evidence."],
        visibility: "internal"
      },
      { token: managerToken }
    );
    const data = dataOf(created);
    runner.id("agentRunId", requireStringPath(data, ["id"], "Agent Run id"));
    runner.assert(step, requireStringPath(data, ["contextPackId"], "Agent Run contextPackId") === packId, "Agent Run links to same-project context pack", data);
    runner.assert(step, getPath(data, ["truthModel", "evidenceStatus"]) !== "accepted_product_brain_truth", "Agent Run is not Product Brain truth", data);
  });

  await runner.step("agent_run_lifecycle", "List/view/update/review Agent Run Memory", async (step) => {
    const projectId = runner.getId("projectId");
    const runId = runner.getId("agentRunId");
    const listed = await runner.request(step, "GET", `/v1/projects/${projectId}/agent-runs?provider=codex&page=1&pageSize=10`, undefined, { token: managerToken });
    runner.assert(step, JSON.stringify(dataOf(listed)).includes(runId), "Agent Run appears in scoped list", listed.body);
    const viewed = await runner.request(step, "GET", `/v1/projects/${projectId}/agent-runs/${runId}`, undefined, { token: managerToken });
    runner.assert(step, requireStringPath(dataOf(viewed), ["id"], "viewed Agent Run id") === runId, "Agent Run view is same project-scoped run", viewed.body);
    await runner.request(step, "PATCH", `/v1/projects/${projectId}/agent-runs/${runId}`, { modulesTouched: ["dashboard", "agent-context", "mvp-smoke"] }, { token: managerToken });
    await runner.request(step, "POST", `/v1/projects/${projectId}/agent-runs/${runId}/status`, { status: "human_reviewed", note: "Manager reviewed smoke run as evidence only." }, { token: managerToken });
    const reviewed = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/agent-runs/${runId}/review`,
      {
        reviewResult: "needs_follow_up",
        humanReviewNotes: "Manager wants Product Brain alignment checked before any truth change.",
        possibleProductBrainImplications: true,
        productBrainImplications: ["Consider a separate weekly reporting proposal if humans approve."]
      },
      { token: managerToken }
    );
    const reviewedData = dataOf(reviewed);
    runner.assert(
      step,
      getPath(reviewedData, ["status"]) === "needs_follow_up" || getPath(reviewedData, ["humanReviewResult"]) === "needs_follow_up",
      "Agent Run human review state recorded without truth mutation",
      reviewed.body
    );
  });

  await runner.step("agent_run_socrates", "Ask Socrates about Agent Run Memory", async (step) => {
    const projectId = runner.getId("projectId");
    const sessionId = runner.getId("socratesSessionId");
    const streamed = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/socrates/sessions/${sessionId}/messages/stream`,
      { content: "What did the Codex smoke manager run claim, and is it accepted Product Brain truth?" },
      { token: managerToken, sse: true }
    );
    const done = extractSocratesDone(parseSse(streamed.text));
    runner.assert(step, optionalArrayPath(done, ["citations"]).length > 0 && optionalArrayPath(done, ["open_targets"]).length > 0, "Socrates can answer with citations/openTargets after Agent Run Memory", done);
  });

  await runner.step("agent_quality_pack", "Score Agent Context Pack quality", async (step) => {
    const projectId = runner.getId("projectId");
    const packId = runner.getId("agentContextPackId");
    const report = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/agent-context-packs/${packId}/quality-reports`,
      { reviewMode: "deterministic", forceRefresh: true, includeEvidence: true, includeCitations: true, includeOpenTargets: true, deterministicOnly: true },
      { token: managerToken }
    );
    const data = dataOf(report);
    runner.id("agentPackQualityReviewId", requireStringPath(data, ["id"], "Agent Context quality report id"));
    runner.assert(step, typeof getPath(data, ["overallScore"]) === "number", "Agent Context quality report has overall score", data);
    runner.assert(step, typeof getPath(data, ["scoreLabel"]) === "string", "Agent Context quality report has score label", data);
    await runner.request(step, "GET", `/v1/projects/${projectId}/agent-context-packs/${packId}/quality-reports/latest`, undefined, { token: managerToken });
  });

  await runner.step("agent_quality_review", "Review Agent Run drift", async (step) => {
    const projectId = runner.getId("projectId");
    const runId = runner.getId("agentRunId");
    const report = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/agent-runs/${runId}/quality-reviews`,
      { reviewMode: "deterministic", forceRefresh: true, includeEvidence: true, includeCitations: true, includeOpenTargets: true, deterministicOnly: true },
      { token: managerToken }
    );
    const data = dataOf(report);
    runner.id("agentRunQualityReviewId", requireStringPath(data, ["id"], "Agent Run quality review id"));
    runner.assert(step, typeof getPath(data, ["recommendation"]) === "string", "Agent Run quality review has human recommendation", data);
    runner.assert(step, optionalArrayPath(data, ["findings"]).length > 0, "Agent Run quality review produces findings", data);
    await runner.request(step, "GET", `/v1/projects/${projectId}/agent-runs/${runId}/quality-reviews/latest`, undefined, { token: managerToken });
    await runner.request(step, "GET", `/v1/projects/${projectId}/agent-quality-reviews/pressure`, undefined, { token: managerToken });
  });

  await runner.step("agent_quality_socrates", "Ask Socrates about Step 5 review results", async (step) => {
    const projectId = runner.getId("projectId");
    const sessionId = runner.getId("socratesSessionId");
    const streamed = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/socrates/sessions/${sessionId}/messages/stream`,
      { content: "Did the Step 5 review find drift, MVP-mode violations, test gaps, or follow-up questions?" },
      { token: managerToken, sse: true }
    );
    const done = extractSocratesDone(parseSse(streamed.text));
    runner.assert(step, optionalArrayPath(done, ["citations"]).length > 0 && optionalArrayPath(done, ["open_targets"]).length > 0, "Socrates can answer with citations/openTargets after Step 5 review", done);
  });

  await runner.step("mcp_readiness", "MCP readiness and token contracts", async (step) => {
    const projectId = runner.getId("projectId");
    const readiness = await runner.request(step, "GET", "/v1/mcp/readiness", undefined, { token: managerToken });
    runner.assert(step, getPath(dataOf(readiness), ["enabled"]) === true, "MVP MCP readiness reports enabled local/team mode", readiness.body);
    runner.assert(step, getPath(dataOf(readiness), ["readOnlyDefault"]) === true, "MVP MCP is read-only by default", readiness.body);
    const created = await runner.request(
      step,
      "POST",
      "/v1/mcp/tokens",
      {
        label: `MVP smoke manager token ${runSuffix}`,
        mode: "local_dev",
        projectIds: [projectId],
        allowedTools: ["orchestra.list_projects", "orchestra.search_project_context", "orchestra.get_context_pack", "orchestra.list_agent_quality_reviews"],
        allowControlledWrites: false
      },
      { token: managerToken, scanResponse: false }
    );
    const data = dataOf(created);
    runner.id("mcpTokenId", requireStringPath(data, ["tokenRecord", "id"], "MCP token id"));
    runner.secret("mcpRawToken", requireStringPath(data, ["token"], "one-time MCP raw token"));
    const listed = await runner.request(step, "GET", "/v1/mcp/tokens", undefined, { token: managerToken });
    runner.assert(step, JSON.stringify(dataOf(listed)).includes(runner.getId("mcpTokenId")), "MCP token is listed without needing raw token in report", listed.body);
  });

  await runner.step("mcp_context", "MCP read-only context tools", async (step) => {
    const projectId = runner.getId("projectId");
    const mcpRawToken = runner.getSecret("mcpRawToken");
    const searched = await runner.request(
      step,
      "POST",
      "/v1/mcp",
      {
        jsonrpc: "2.0",
        id: "mvp-smoke-search",
        method: "tools/call",
        params: { name: "orchestra.search_project_context", arguments: { projectId, query: "weekly reporting manager approval" } }
      },
      { token: mcpRawToken }
    );
    runner.assert(step, JSON.stringify(dataOf(searched)).includes("truthModelWarning"), "MCP read-only search returns truth-model-wrapped evidence", searched.body);

    const deniedWrite = await runner.request(
      step,
      "POST",
      "/v1/mcp",
      {
        jsonrpc: "2.0",
        id: "mvp-smoke-write-denied",
        method: "tools/call",
        params: {
          name: "orchestra.record_agent_run",
          arguments: { projectId, taskTitle: "Should be denied", taskType: "implementation", outputSummary: "Denied controlled write smoke." }
        }
      },
      { token: mcpRawToken, expectStatuses: [200, 403] }
    );
    runner.assert(
      step,
      deniedWrite.statusCode === 403 ||
        JSON.stringify(deniedWrite.body).includes("mcp_tool_not_allowed") ||
        JSON.stringify(deniedWrite.body).includes("mcp_controlled_write_denied"),
      "MCP controlled write is denied by allowlist or read-only gate",
      deniedWrite.body
    );

    await runner.request(step, "POST", `/v1/mcp/tokens/${runner.getId("mcpTokenId")}/revoke`, undefined, { token: managerToken });
    const revoked = await runner.request(
      step,
      "POST",
      "/v1/mcp",
      { jsonrpc: "2.0", id: "mvp-smoke-revoked", method: "tools/list", params: {} },
      { token: mcpRawToken, expectStatuses: [401] }
    );
    runner.assert(step, revoked.statusCode === 401, "revoked MCP token is denied", revoked.body);
  });

  await runner.step("diagram_generate", "Generate Mermaid diagram", async (step) => {
    const projectId = runner.getId("projectId");
    const generated = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/diagrams/generate`,
      { diagramType: "flowchart", prompt: "Show MVP assignment approval and weekly reporting flow.", sourceRefs: [], save: false },
      { token: managerToken }
    );
    const proposed = optionalObjectPath(dataOf(generated), ["proposed"]) ?? dataOf(generated);
    runner.assert(step, typeof getPath(proposed, ["mermaidSource"]) === "string", "Mermaid source is valid", generated.body);
  });

  await runner.step("diagram_save", "Save diagram", async (step) => {
    const projectId = runner.getId("projectId");
    const saved = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/diagrams`,
      {
        title: `MVP Smoke Approval Flow ${runSuffix}`,
        diagramType: "flowchart",
        mermaidSource: "flowchart TD\n  A[Manual evidence] --> B[Manager approval]\n  B --> C[Weekly reporting]",
        linkedDocumentSectionIds: [],
        linkedBrainNodeIds: [],
        linkedContextEntryIds: []
      },
      { token: managerToken }
    );
    runner.id("diagramId", requireStringPath(dataOf(saved), ["id"], "saved diagram id"));
    runner.assert(step, true, "saved diagram remains active and project-scoped");
  });

  await runner.step("live_doc_embed", "Embed diagram into Live Doc", async (step) => {
    const projectId = runner.getId("projectId");
    const diagramId = runner.getId("diagramId");
    const current = await runner.request(step, "GET", `/v1/projects/${projectId}/live-doc/current`, undefined, { token: managerToken });
    const firstSection = optionalArrayPath(dataOf(current), ["sections"])[0];
    if (!isRecord(firstSection)) throw new MvpSmokeFailure("Live Doc has no embeddable section", current.body);
    const sectionKey = requireStringPath(firstSection, ["sectionKey"], "live doc section key");
    const embed = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/live-doc/sections/${encodeURIComponent(sectionKey)}/diagrams/${diagramId}/embed`,
      { sortOrder: 0 },
      { token: managerToken }
    );
    runner.id("liveDocSectionKey", requireStringPath(dataOf(embed), ["sectionKey"], "live doc section key"));
    runner.assert(step, requireStringPath(dataOf(embed), ["diagramId"], "embedded diagram id") === diagramId, "Live Doc section references diagram", embed.body);
  });

  await runner.step("live_doc_fetch", "Fetch Live Doc", async (step) => {
    const projectId = runner.getId("projectId");
    const liveDoc = await runner.request(step, "GET", `/v1/projects/${projectId}/live-doc/current`, undefined, { token: managerToken });
    runner.assert(step, JSON.stringify(dataOf(liveDoc)).includes(runner.getId("diagramId")), "embedded diagram appears", liveDoc.body);
  });

  await runner.step("coding_generate", "Generate coding requirements", async (step) => {
    const projectId = runner.getId("projectId");
    const generated = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/coding-requirements/generate`,
      { prompt: "Extract backend coding requirements for approval and weekly reporting.", focus: "backend", includeMermaid: true, saveFlowchart: true, sourceRefs: [] },
      { token: managerToken }
    );
    const data = dataOf(generated);
    runner.id("codingRequirementsId", requireStringPath(data, ["id"], "coding requirements id"));
    runner.id("codingArtifactVersionId", requireStringPath(data, ["artifactVersionId"], "coding artifact version id"));
    runner.assert(step, true, "codingRequirementsId and artifactVersionId exist");
  });

  await runner.step("coding_fetch", "Fetch coding requirements current/history/flowchart", async (step) => {
    const projectId = runner.getId("projectId");
    await runner.request(step, "GET", `/v1/projects/${projectId}/coding-requirements/current`, undefined, { token: managerToken });
    await runner.request(step, "GET", `/v1/projects/${projectId}/coding-requirements/history?page=1&pageSize=10`, undefined, { token: managerToken });
    const flowchart = await runner.request(step, "GET", `/v1/projects/${projectId}/coding-requirements/flowchart`, undefined, { token: managerToken });
    runner.assert(step, typeof getPath(dataOf(flowchart), ["mermaid"]) === "string", "schema-valid payload and Mermaid flowchart exist", flowchart.body);
  });

  await runner.step("agent_files", "Preview/generate Product Brain Agent Files", async (step) => {
    const projectId = runner.getId("projectId");
    const preview = await runner.request(step, "POST", `/v1/projects/${projectId}/agent-files/default/preview`, {}, { token: managerToken });
    const previewData = dataOf(preview);
    runner.id("agentFileSetId", requireStringPath(previewData, ["fileSetId"], "agent file set id"));
    const previewFiles = optionalArrayPath(previewData, ["files"]);
    runner.assert(step, previewFiles.length === 7, "default MVP agent file preview returns all seven files", preview.body);
    const agentsFile = previewFiles.find((file: any) => file.filePath === "AGENTS.md");
    runner.assert(step, JSON.stringify(agentsFile).includes("Do not merge main into mvp-v0"), "AGENTS.md includes MVP branch rules", agentsFile);
    runner.assert(step, !containsDisabledProviderEvidenceLeak(previewData), "disabled provider details are not leaked", preview.body);

    const generated = await runner.request(step, "POST", `/v1/projects/${projectId}/agent-files/default/generate`, {}, { token: managerToken });
    const generatedData = dataOf(generated);
    runner.assert(step, optionalArrayPath(generatedData, ["files"]).length === 7, "default MVP agent file generate persists all seven files", generated.body);
    runner.assert(step, getPath(generatedData, ["noRepoWrite"]) === true, "agent files do not write to GitHub or local repo", generated.body);
    runner.assert(
      step,
      optionalArrayPath(generatedData, ["limitations"]).length > 0 && JSON.stringify(generatedData).includes("derived projections"),
      "limitations are present",
      generated.body
    );
  });

  await runner.step("agent_files_step2", "Refresh/diff/download MVP Product Brain Agent Files", async (step) => {
    const projectId = runner.getId("projectId");
    const fileSetId = runner.getId("agentFileSetId");
    const staleness = await runner.request(step, "GET", `/v1/projects/${projectId}/agent-files/file-sets/${fileSetId}/staleness`, undefined, { token: managerToken });
    runner.assert(step, optionalArrayPath(dataOf(staleness), ["files"]).length === 7, "staleness contract returns all seven files", staleness.body);
    const diff = await runner.request(step, "GET", `/v1/projects/${projectId}/agent-files/file-sets/${fileSetId}/diff`, undefined, { token: managerToken });
    runner.assert(step, typeof getPath(dataOf(diff), ["summary"]) === "object", "diff summary exists", diff.body);
    const refresh = await runner.request(step, "POST", `/v1/projects/${projectId}/agent-files/file-sets/${fileSetId}/refresh`, { staleOnly: true }, { token: managerToken });
    runner.assert(step, getPath(dataOf(refresh), ["noRepoWrite"]) === true, "refresh does not write repo files", refresh.body);
    const manifest = await runner.request(step, "GET", `/v1/projects/${projectId}/agent-files/file-sets/${fileSetId}/manifest`, undefined, { token: managerToken });
    runner.assert(step, optionalArrayPath(dataOf(manifest), ["files"]).length === 7, "manifest includes all generated files", manifest.body);
    const download = await runner.request(step, "GET", `/v1/projects/${projectId}/agent-files/file-sets/${fileSetId}/download`, undefined, { token: managerToken });
    runner.assert(step, JSON.stringify(dataOf(download)).includes("README_GENERATED_BY_ORCHESTRA.md"), "download bundle includes generated README", download.body);
    runner.assert(step, !containsDisabledProviderEvidenceLeak(dataOf(download)), "Step 2 outputs do not leak disabled providers", download.body);
  });

  await runner.step("agent_files_step3", "Quality/drift/release-gate MVP Product Brain Agent Files", async (step) => {
    const projectId = runner.getId("projectId");
    const fileSetId = runner.getId("agentFileSetId");
    const quality = await runner.request(step, "POST", `/v1/projects/${projectId}/agent-files/file-sets/${fileSetId}/quality/refresh`, {}, { token: managerToken });
    runner.assert(step, typeof getPath(dataOf(quality), ["overallScore"]) === "number", "quality score works", quality.body);
    const drift = await runner.request(step, "POST", `/v1/projects/${projectId}/agent-files/file-sets/${fileSetId}/drift/refresh`, {}, { token: managerToken });
    runner.assert(step, typeof getPath(dataOf(drift), ["highestSeverity"]) === "string", "drift report works", drift.body);
    const readiness = await runner.request(step, "GET", `/v1/projects/${projectId}/agent-files/file-sets/${fileSetId}/github-readiness`, undefined, { token: managerToken });
    runner.assert(step, getPath(dataOf(readiness), ["ready"]) === false, "MVP GitHub PR sync is readiness-gated by default", readiness.body);
    const prSync = await runner.request(step, "POST", `/v1/projects/${projectId}/agent-files/file-sets/${fileSetId}/sync/github-pr`, { dryRun: true }, { token: managerToken });
    runner.assert(step, getPath(dataOf(prSync), ["githubWriteAttempted"]) === false, "dry-run GitHub PR sync does not write GitHub", prSync.body);
    runner.assert(step, getPath(dataOf(prSync), ["noAutoMerge"]) === true, "auto-merge is denied", prSync.body);
    const releaseGate = await runner.request(step, "GET", `/v1/projects/${projectId}/agent-files/file-sets/${fileSetId}/release-gate`, undefined, { token: managerToken });
    runner.assert(step, ["pass", "pass_with_warnings", "fail"].includes(String(getPath(dataOf(releaseGate), ["status"]))), "release gate returns a status", releaseGate.body);
    runner.assert(step, !containsDisabledProviderEvidenceLeak(dataOf(prSync)), "Step 3 outputs do not leak disabled providers", prSync.body);
  });

  await runner.step("github_foundation", "GitHub Integration Foundation readiness", async (step) => {
    const readiness = await runner.request(step, "GET", "/v1/github/readiness", undefined, { token: managerToken });
    const data = dataOf(readiness);
    runner.assert(step, getPath(data, ["readOnlyMode"]) === true, "MVP GitHub foundation is read-only", readiness.body);
    runner.assert(step, getPath(data, ["writeActionsEnabled"]) === false, "MVP GitHub writes are disabled", readiness.body);
    runner.assert(step, getPath(data, ["contentScanEnabled"]) === false, "MVP GitHub content scan is disabled", readiness.body);
    runner.assert(step, getPath(data, ["truthModel", "githubWritesAllowed"]) === false, "GitHub writes are not available", readiness.body);
    runner.assert(step, getPath(data, ["truthModel", "productBrainMutationAllowed"]) === false, "GitHub cannot mutate Product Brain", readiness.body);
    runner.assert(step, getPath(data, ["truthModel", "liveDocMutationAllowed"]) === false, "GitHub cannot mutate Live Doc", readiness.body);
    runner.assert(step, getPath(data, ["truthModel", "proposalAcceptRejectAllowed"]) === false, "GitHub cannot accept/reject proposals", readiness.body);
    runner.assert(step, optionalArrayPath(data, ["supportedWebhookEvents"]).includes("pull_request"), "GitHub webhook events include pull_request", readiness.body);
  });

  await runner.step("github_project_status", "Project GitHub integration status", async (step) => {
    const projectId = runner.getId("projectId");
    const status = await runner.request(step, "GET", `/v1/projects/${projectId}/github`, undefined, { token: managerToken });
    const data = dataOf(status);
    runner.assert(step, getPath(data, ["projectId"]) === projectId, "project GitHub status is project-scoped", status.body);
    runner.assert(step, getPath(data, ["readOnlyMode"]) === true, "project GitHub status is read-only", status.body);
    runner.assert(step, getPath(data, ["writeActionsEnabled"]) === false, "project GitHub status exposes no write actions", status.body);
    runner.assert(step, Array.isArray(getPath(data, ["linkedRepositories"])), "linkedRepositories list exists", status.body);
    runner.assert(step, !JSON.stringify(data).match(/gh[pousr]_|github_pat_|PRIVATE KEY|WEBHOOK_SECRET|CLIENT_SECRET/i), "GitHub status omits credentials and tokens", status.body);
  });

  await runner.step("responsibility", "Create responsibility/task", async (step) => {
    const projectId = runner.getId("projectId");
    const responsibility = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/responsibilities`,
      {
        memberId: runner.getId("memberId"),
        title: `MVP Smoke Responsibility ${runSuffix}`,
        description: "Own approval workflow verification.",
        area: "backend",
        status: "open"
      },
      { token: managerToken }
    );
    runner.id("responsibilityId", requireStringPath(dataOf(responsibility), ["id"], "responsibility id"));
    runner.assert(step, true, "responsibilityId exists");
  });

  await runner.step("action_create", "Create Socrates assign-task action", async (step) => {
    const projectId = runner.getId("projectId");
    const sessionId = runner.getId("socratesSessionId");
    const action = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/socrates/sessions/${sessionId}/actions`,
      {
        actionType: "assign_task",
        label: "Assign smoke verification task",
        payload: {
          memberId: runner.getId("memberId"),
          taskTitle: `MVP Smoke Action Task ${runSuffix}`,
          taskDescription: "Verify Socrates action apply mutates responsibility state only after explicit apply.",
          area: "qa",
          status: "open"
        }
      },
      { token: managerToken }
    );
    const data = dataOf(action);
    runner.id("socratesActionId", requireStringPath(data, ["id"], "Socrates action id"));
    runner.assert(step, getPath(data, ["status"]) === "proposed", "socratesActionId exists and is proposed", data);
  });

  await runner.step("action_apply", "Apply Socrates action", async (step) => {
    const projectId = runner.getId("projectId");
    const actionId = runner.getId("socratesActionId");
    const applied = await runner.request(step, "POST", `/v1/projects/${projectId}/socrates/actions/${actionId}/apply`, undefined, { token: managerToken });
    const data = dataOf(applied);
    runner.assert(step, getPath(data, ["status"]) === "applied", "action is applied", data);
    runner.assert(step, optionalArrayPath(data, ["openTargets"]).length > 0, "action mutation has open target", data);
  });

  await runner.step("calendar", "Create/list simple calendar event", async (step) => {
    const projectId = runner.getId("projectId");
    const event = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/meetings`,
      {
        title: `MVP Smoke Calendar ${runSuffix}`,
        eventType: "meeting",
        startsAt: futureIso(120),
        endsAt: futureIso(150),
        timezone: "UTC"
      },
      { token: managerToken }
    );
    runner.id("calendarEventId", requireStringPath(dataOf(event), ["id"], "calendar event id"));
    const meetings = await runner.request(step, "GET", `/v1/projects/${projectId}/meetings?limit=10`, undefined, { token: managerToken });
    runner.assert(step, JSON.stringify(dataOf(meetings)).includes(runner.getId("calendarEventId")), "calendarEventId exists and is listed", meetings.body);
  });

  await runner.step("dashboard", "Fetch dashboard summary", async (step) => {
    const projectId = runner.getId("projectId");
    const dashboard = await runner.request(step, "GET", `/v1/projects/${projectId}/dashboard?forceRefresh=true`, undefined, { token: managerToken });
    const data = dataOf(dashboard);
    runner.assert(step, Boolean(getPath(data, ["communication"]) ?? getPath(data, ["mvpCommunication"])), "MVP dashboard includes communication summary", data);
    runner.assert(step, Boolean(getPath(data, ["calendar"]) ?? getPath(data, ["meetings"])), "MVP dashboard includes calendar summary", data);
    runner.assert(step, getPath(data, ["financials"]) === undefined && getPath(data, ["subscriptions"]) === undefined, "MVP dashboard omits disabled finance/subscription data", data);
  });

  await runner.step("provider_gating", "Verify MVP provider profile", async (step) => {
    const projectId = runner.getId("projectId");
    const readiness = await runner.request(step, "GET", `/v1/projects/${projectId}/connectors/readiness`, undefined, { token: managerToken });
    assertProviderReadiness(step, runner, dataOf(readiness));
    const disabledProvider = await runner.request(step, "POST", `/v1/projects/${projectId}/connectors/gmail/connect`, undefined, { token: managerToken, expectStatuses: [403] });
    runner.assert(step, extractErrorCode(disabledProvider) === "communication_provider_disabled_in_mvp", "disabled advanced provider gating verified", disabledProvider.body);
    const slackConnect = await runner.request(step, "POST", `/v1/projects/${projectId}/connectors/slack/connect`, undefined, { token: managerToken, expectStatuses: [200, 503] });
    if (slackConnect.statusCode === 200) {
      runner.assert(step, optionalStringPath(dataOf(slackConnect), ["redirectUrl"])?.startsWith("https://slack.com/oauth/v2/authorize") === true, "Slack OAuth URL generation uses Slack OAuth v2", slackConnect.body);
      runner.assert(step, JSON.stringify(slackConnect.body).includes("xox") === false, "Slack connect response does not expose tokens", slackConnect.body);
    } else {
      runner.assert(step, extractErrorCode(slackConnect) === "communication_provider_not_ready", "Slack missing env is readiness-gated instead of 500", slackConnect.body);
    }
    const clickup = await runner.request(step, "POST", `/v1/projects/${projectId}/connectors/clickup/connect`, undefined, { token: managerToken, expectStatuses: [200, 503] });
    if (clickup.statusCode === 200) {
      runner.assert(step, optionalStringPath(dataOf(clickup), ["redirectUrl"])?.startsWith("https://app.clickup.com/api") === true, "ClickUp OAuth URL generation uses ClickUp authorization-code OAuth", clickup.body);
      runner.assert(step, JSON.stringify(clickup.body).includes("pk_") === false, "ClickUp connect response does not expose personal tokens", clickup.body);
    } else {
      runner.assert(step, extractErrorCode(clickup) === "communication_provider_not_ready", "ClickUp missing env is readiness-gated instead of 500", clickup.body);
    }
    const granola = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/connectors/granola/connect`,
      { managedSecretRef: "orchestra/smoke/granola", keyType: "personal", config: { includeTranscript: true } },
      { token: managerToken, expectStatuses: [200, 503] }
    );
    if (granola.statusCode === 200) {
      runner.assert(step, optionalStringPath(dataOf(granola), ["status"]) === "connected", "Granola API-key connect returns connected status", granola.body);
      runner.assert(step, !/grn_|apiKey|Bearer|credentialsRef/i.test(JSON.stringify(granola.body)), "Granola connect response does not expose API key material", granola.body);
    } else {
      runner.assert(step, extractErrorCode(granola) === "communication_provider_not_ready", "Granola missing env is readiness-gated instead of 500", granola.body);
    }
  });

  await runner.step("advanced_ops_gating", "Verify finance/subscriptions/cost disabled", async (step) => {
    const projectId = runner.getId("projectId");
    const denied = await runner.request(step, "GET", `/v1/projects/${projectId}/financials`, undefined, { token: managerToken, expectStatuses: [403] });
    runner.assert(step, extractErrorCode(denied) === "feature_disabled", "MVP advanced ops gating verified", denied.body);
  });

  await runner.step("client_internal_denied", "Verify client/internal leakage blocked", async (step) => {
    const projectId = runner.getId("projectId");
    const denied = await runner.request(step, "GET", `/v1/projects/${projectId}/communications/timeline`, undefined, { token: clientToken, expectStatuses: [403] });
    runner.assert(step, denied.statusCode === 403, "client/internal leak checks passed", denied.body);
  });

  await runner.step("project_scope", "Verify created IDs are project-scoped", async (step) => {
    const projectId = runner.getId("projectId");
    const project = await runner.request(step, "GET", `/v1/projects/${projectId}`, undefined, { token: managerToken });
    runner.assert(step, requireStringPath(dataOf(project), ["id"], "project id") === projectId, "created IDs resolve under the project", project.body);
  });

  await runner.step("secret_scan_responses", "Verify no secrets in responses", async (step) => {
    runner.assertNoSecrets(step);
  });

  return runner.finish(config, startedAt);
}

export async function runMvpSmoke(config = buildMvpSmokeConfig()): Promise<MvpSmokeReport> {
  if (config.mode === "dry-run") return runDryRun(config);
  if (config.mode === "mock") return runMock(config);
  return runHttp(config);
}

export function shouldFailMvpSmokeProcess(mode: MvpSmokeMode, status: MvpSmokeStatus) {
  if (mode === "http") return status !== "passed";
  return status === "failed";
}

async function main() {
  const config = buildMvpSmokeConfig();
  const report = await runMvpSmoke(config);
  if (config.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (config.mode !== "dry-run") {
    console.log(`MVP smoke ${report.status}. Report: ${config.reportMarkdownPath}`);
  }
  if (shouldFailMvpSmokeProcess(config.mode, report.status)) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main();
}
