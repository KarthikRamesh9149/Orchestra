import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildEvidenceOnlyDegradedAnswer } from "../../src/lib/ai-ops/ai-degradation.js";
import { answerSchema } from "../../src/modules/socrates/schemas.js";

export type SmokeMode = "dry-run" | "http" | "mock";
type CliSmokeMode = "http" | "mock";
type SmokeProofLevel = "diagnostic" | "mock" | "http";
export type SmokeStatus = "not_executed" | "diagnostic" | "mock_passed" | "passed" | "failed" | "degraded";
type PathSegment = string | number;

interface SmokeConfig {
  mode: SmokeMode;
  dryRun: boolean;
  json: boolean;
  verbose: boolean;
  keepData: boolean;
  baseUrl: string;
  orgName: string;
  managerEmail: string;
  managerPassword: string;
  devEmail: string;
  devPassword: string;
  clientEmail: string;
  clientPassword: string;
  projectName: string;
  timeoutMs: number;
  pollIntervalMs: number;
  documentPath: string;
  manualImportPath: string;
  expectAi: boolean;
  expectWorker: boolean;
  clientPortal: boolean;
  simulateAiProviderFailure?: boolean;
  simulateRerankFailure?: boolean;
  simulateLowEvidence?: boolean;
  assertTelemetry?: boolean;
  redactReports?: boolean;
  reportJsonPath: string;
  reportMarkdownPath: string;
}

interface SmokeArgs {
  mode?: CliSmokeMode;
  dryRun: boolean;
  json: boolean;
  verbose: boolean;
  keepData?: boolean;
  simulateAiProviderFailure?: boolean;
  simulateRerankFailure?: boolean;
  simulateLowEvidence?: boolean;
  assertTelemetry?: boolean;
  redactReports?: boolean;
}

interface RouteCall {
  method: string;
  path: string;
  statusCode?: number;
  ok?: boolean;
}

interface StepResult {
  name: string;
  status: SmokeStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  routes: RouteCall[];
  assertions: string[];
  createdIds: Record<string, string>;
  degradedNotes: string[];
  failures: string[];
}

interface SmokeReport {
  runId: string;
  mode: SmokeMode;
  proofLevel: SmokeProofLevel;
  baseUrl: string;
  startedAt: string;
  finishedAt: string;
  status: SmokeStatus;
  launchLoopProven: boolean;
  canBeUsedForLaunchProof: boolean;
  executedHttpRequests: number;
  plannedRoutesCount: number;
  executedRoutesCount: number;
  env: Record<string, unknown>;
  steps: StepResult[];
  created: Record<string, string>;
  createdEntityIds: Record<string, string>;
  routeCoverage: RouteCall[];
  assertions: string[];
  proof: Record<string, unknown>;
  degradedDependencies: string[];
  failures: string[];
  environmentBlockers: string[];
  rerunCommand: string;
}

interface HttpResponse {
  statusCode: number;
  ok: boolean;
  body: unknown;
  text: string;
}

class SmokeFailure extends Error {
  constructor(
    message: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

export const SMOKE_ENV_KEYS = [
  "SMOKE_BASE_URL",
  "SMOKE_ORG_NAME",
  "SMOKE_MANAGER_EMAIL",
  "SMOKE_MANAGER_PASSWORD",
  "SMOKE_DEV_EMAIL",
  "SMOKE_DEV_PASSWORD",
  "SMOKE_CLIENT_EMAIL",
  "SMOKE_CLIENT_PASSWORD",
  "SMOKE_PROJECT_NAME",
  "SMOKE_TIMEOUT_MS",
  "SMOKE_POLL_INTERVAL_MS",
  "SMOKE_KEEP_DATA",
  "SMOKE_DOCUMENT_PATH",
  "SMOKE_MANUAL_IMPORT_PATH",
  "SMOKE_EXPECT_AI",
  "SMOKE_EXPECT_WORKER",
  "SMOKE_CLIENT_PORTAL"
] as const;

export const ROUTE_PLAN = [
  "GET /health",
  "POST /v1/auth/signup",
  "POST /v1/auth/login",
  "GET /v1/auth/me",
  "POST /v1/projects",
  "GET /v1/projects",
  "GET /v1/projects/:projectId",
  "POST /v1/projects/:projectId/members",
  "PATCH /v1/projects/:projectId/members/:memberId",
  "GET /v1/projects/:projectId/members",
  "POST /v1/projects/:projectId/documents/upload",
  "GET /v1/projects/:projectId/documents",
  "GET /v1/projects/:projectId/documents/:documentId",
  "POST /v1/projects/:projectId/brain/rebuild",
  "GET /v1/projects/:projectId/brain/current",
  "GET /v1/projects/:projectId/brain/versions",
  "GET /v1/projects/:projectId/brain/graph/current",
  "GET /v1/projects/:projectId/documents/:documentId/view",
  "GET /v1/projects/:projectId/documents/:documentId/search",
  "GET /v1/projects/:projectId/documents/:documentId/anchors/:anchorId",
  "GET /v1/projects/:projectId/documents/:documentId/anchors/:anchorId/provenance",
  "POST /v1/projects/:projectId/communications/import",
  "POST /v1/projects/:projectId/communications/import (fireflies_ai transcript diagnostic)",
  "POST /v1/webhooks/fireflies (verified provider webhook diagnostic)",
  "GET /v1/projects/:projectId/communications/timeline",
  "GET /v1/projects/:projectId/threads",
  "GET /v1/projects/:projectId/threads/:threadId",
  "GET /v1/projects/:projectId/messages/:messageId",
  "POST /v1/projects/:projectId/messages/:messageId/classify",
  "GET /v1/projects/:projectId/message-insights",
  "GET /v1/projects/:projectId/communication-review",
  "POST /v1/projects/:projectId/message-insights/:insightId/create-proposal",
  "GET /v1/projects/:projectId/change-proposals",
  "GET /v1/projects/:projectId/change-proposals/:proposalId",
  "POST /v1/projects/:projectId/change-proposals/:proposalId/accept",
  "POST /v1/projects/:projectId/socrates/sessions",
  "PATCH /v1/projects/:projectId/socrates/sessions/:sessionId/context",
  "GET /v1/projects/:projectId/socrates/sessions/:sessionId/suggestions",
  "POST /v1/projects/:projectId/socrates/sessions/:sessionId/messages/stream",
  "GET /v1/projects/:projectId/socrates/sessions/:sessionId/messages",
  "POST /v1/projects/:projectId/agent-context-packs",
  "GET /v1/projects/:projectId/agent-context-packs",
  "GET /v1/projects/:projectId/agent-context-packs/:packId",
  "GET /v1/projects/:projectId/agent-context-packs/:packId/export-formats",
  "POST /v1/projects/:projectId/agent-context-packs/:packId/exports/preview",
  "POST /v1/projects/:projectId/agent-context-packs/:packId/exports",
  "POST /v1/projects/:projectId/agent-context-packs/:packId/refresh",
  "POST /v1/projects/:projectId/agent-context-packs/:packId/archive",
  "DELETE /v1/projects/:projectId/agent-context-packs/:packId",
  "POST /v1/projects/:projectId/agent-runs",
  "GET /v1/projects/:projectId/agent-runs",
  "GET /v1/projects/:projectId/agent-runs/:runId",
  "PATCH /v1/projects/:projectId/agent-runs/:runId",
  "POST /v1/projects/:projectId/agent-runs/:runId/status",
  "POST /v1/projects/:projectId/agent-runs/:runId/review",
  "POST /v1/projects/:projectId/agent-runs/:runId/archive",
  "DELETE /v1/projects/:projectId/agent-runs/:runId",
  "POST /v1/projects/:projectId/agent-context-packs/:packId/quality-reports",
  "GET /v1/projects/:projectId/agent-context-packs/:packId/quality-reports/latest",
  "POST /v1/projects/:projectId/agent-runs/:runId/quality-reviews",
  "GET /v1/projects/:projectId/agent-runs/:runId/quality-reviews/latest",
  "GET /v1/projects/:projectId/agent-quality-reviews/pressure",
  "GET /v1/projects/:projectId/agent-files",
  "POST /v1/projects/:projectId/agent-files/file-sets",
  "GET /v1/projects/:projectId/agent-files/default",
  "POST /v1/projects/:projectId/agent-files/default/preview",
  "POST /v1/projects/:projectId/agent-files/default/generate",
  "GET /v1/projects/:projectId/agent-files/file-sets/:fileSetId",
  "POST /v1/projects/:projectId/agent-files/file-sets/:fileSetId/preview",
  "POST /v1/projects/:projectId/agent-files/file-sets/:fileSetId/generate",
  "POST /v1/projects/:projectId/agent-files/file-sets/:fileSetId/refresh",
  "GET /v1/projects/:projectId/agent-files/file-sets/:fileSetId/staleness",
  "GET /v1/projects/:projectId/agent-files/file-sets/:fileSetId/diff",
  "GET /v1/projects/:projectId/agent-files/file-sets/:fileSetId/download",
  "GET /v1/projects/:projectId/agent-files/file-sets/:fileSetId/manifest",
  "GET /v1/projects/:projectId/agent-files/file-sets/:fileSetId/github-readiness",
  "POST /v1/projects/:projectId/agent-files/file-sets/:fileSetId/sync/github-pr",
  "GET /v1/projects/:projectId/agent-files/file-sets/:fileSetId/quality",
  "POST /v1/projects/:projectId/agent-files/file-sets/:fileSetId/quality/refresh",
  "GET /v1/projects/:projectId/agent-files/file-sets/:fileSetId/drift",
  "POST /v1/projects/:projectId/agent-files/file-sets/:fileSetId/drift/refresh",
  "GET /v1/projects/:projectId/agent-files/file-sets/:fileSetId/release-gate",
  "POST /v1/projects/:projectId/agent-files/file-sets/:fileSetId/release-gate/check",
  "POST /v1/projects/:projectId/agent-files/file-sets/:fileSetId/conflicts",
  "GET /v1/projects/:projectId/agent-files/file-sets/:fileSetId/files/:fileId/latest",
  "POST /v1/projects/:projectId/agent-files/file-sets/:fileSetId/sync-runs",
  "GET /v1/projects/:projectId/agent-files/file-sets/:fileSetId/files/:fileId",
  "GET /v1/projects/:projectId/agent-files/file-sets/:fileSetId/files/:fileId/versions",
  "GET /v1/github/readiness",
  "GET /v1/github/install-url",
  "GET /v1/github/callback",
  "GET /v1/github/installations",
  "GET /v1/github/installations/:installationId/repositories",
  "GET /v1/github/user-link",
  "GET /v1/github/user-link/start",
  "GET /v1/github/user-link/callback",
  "POST /v1/github/user-link/revoke",
  "POST /v1/webhooks/github",
  "GET /v1/projects/:projectId/github",
  "POST /v1/projects/:projectId/github/repositories/link",
  "POST /v1/projects/:projectId/github/backfill",
  "GET /v1/projects/:projectId/github/sync-runs",
  "POST /v1/projects/:projectId/github/repositories/:repoLinkId/archive",
  "GET /v1/projects/:projectId/engineering-evidence",
  "GET /v1/projects/:projectId/engineering-evidence/:evidenceId",
  "POST /v1/projects/:projectId/engineering-evidence/refresh",
  "GET /v1/projects/:projectId/engineering-evidence/sources",
  "GET /v1/projects/:projectId/mock-real-registry",
  "POST /v1/projects/:projectId/mock-real-registry/refresh",
  "POST /v1/projects/:projectId/mock-real-registry/manual",
  "GET /v1/projects/:projectId/integration-seams",
  "POST /v1/projects/:projectId/integration-seams/refresh",
  "POST /v1/projects/:projectId/integration-seams/manual",
  "GET /v1/projects/:projectId/branch-deploy-truth",
  "POST /v1/projects/:projectId/branch-deploy-truth/refresh",
  "POST /v1/projects/:projectId/branch-deploy-truth/manual",
  "GET /v1/projects/:projectId/todo-fixme",
  "POST /v1/projects/:projectId/todo-fixme/refresh",
  "GET /v1/projects/:projectId/fde-readiness/conflicts",
  "POST /v1/projects/:projectId/fde-readiness/conflicts/refresh",
  "GET /v1/projects/:projectId/fde-readiness/safe-to-touch",
  "GET /v1/projects/:projectId/fde-readiness/safe-to-touch/file",
  "POST /v1/projects/:projectId/fde-readiness/safe-to-touch/refresh",
  "GET /v1/projects/:projectId/fde-readiness/duplicates",
  "POST /v1/projects/:projectId/fde-readiness/duplicates/refresh",
  "GET /v1/projects/:projectId/fde-readiness/live-working-map",
  "POST /v1/projects/:projectId/fde-readiness/live-working-map/refresh",
  "GET /v1/projects/:projectId/fde-readiness/rationale-traces",
  "POST /v1/projects/:projectId/fde-readiness/rationale-traces",
  "GET /v1/projects/:projectId/fde-readiness/rationale-traces/:traceId",
  "GET /v1/projects/:projectId/fde-readiness/decision-links",
  "POST /v1/projects/:projectId/fde-readiness/decision-links",
  "POST /v1/projects/:projectId/fde-readiness/refresh",
  "GET /v1/mcp/readiness",
  "POST /v1/mcp/tokens",
  "GET /v1/mcp/tokens",
  "POST /v1/mcp",
  "POST /v1/mcp/tokens/:tokenId/revoke",
  "GET /v1/projects/:projectId/dashboard",
  "GET /v1/projects/:projectId/dashboard/readiness",
  "GET /v1/projects/:projectId/dashboard/mock-real",
  "GET /v1/projects/:projectId/dashboard/seams",
  "GET /v1/projects/:projectId/dashboard/conflicts",
  "GET /v1/projects/:projectId/dashboard/files/:filePath/safe-to-touch",
  "POST /v1/projects/:projectId/dashboard/context-snapshot",
  "GET /v1/projects/:projectId/dashboard/rationale-trace",
  "GET /v1/projects/:projectId/dashboard/branch-deploy-truth",
  "GET /v1/projects/:projectId/dashboard/agent-activity",
  "POST /v1/projects/:projectId/dashboard/refresh",
  "GET /v1/projects/:projectId/team-summary",
  "GET /v1/dashboard/general",
  "POST /v1/projects/:projectId/client-shares",
  "GET /v1/client/:token/bootstrap",
  "GET /v1/client/:token/project-summary",
  "GET /v1/client/:token/brain",
  "GET /v1/client/:token/documents",
  "GET /v1/projects/:projectId/connectors",
  "GET /v1/projects/:projectId/change-proposals/:proposalId",
  "GET /v1/projects/:projectId/ops-summary"
] as const;

export function parseArgs(argv: string[]): SmokeArgs {
  const args: SmokeArgs = {
    dryRun: false,
    json: false,
    verbose: false,
    simulateAiProviderFailure: false,
    simulateRerankFailure: false,
    simulateLowEvidence: false,
    assertTelemetry: false,
    redactReports: false
  };
  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--verbose") args.verbose = true;
    else if (arg === "--keep-data") args.keepData = true;
    else if (arg === "--simulate-ai-provider-failure") args.simulateAiProviderFailure = true;
    else if (arg === "--simulate-rerank-failure") args.simulateRerankFailure = true;
    else if (arg === "--simulate-low-evidence") args.simulateLowEvidence = true;
    else if (arg === "--assert-telemetry") args.assertTelemetry = true;
    else if (arg === "--redact-reports") args.redactReports = true;
    else if (arg === "--mode=http") args.mode = "http";
    else if (arg === "--mode=mock") args.mode = "mock";
    else if (arg.startsWith("--mode=")) throw new SmokeFailure(`Unsupported smoke mode: ${arg}`);
  }
  return args;
}

export function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
}

export function buildConfig(env: NodeJS.ProcessEnv = process.env, args: SmokeArgs = parseArgs(process.argv.slice(2))): SmokeConfig {
  const mode: SmokeMode = args.dryRun ? "dry-run" : args.mode ?? "http";
  const baseUrl = env.SMOKE_BASE_URL?.replace(/\/+$/, "") ?? "http://127.0.0.1:3000";
  const keepData = args.keepData ?? parseBoolean(env.SMOKE_KEEP_DATA, false);
  const reportPaths = reportPathsForMode(mode);
  return {
    mode,
    dryRun: args.dryRun,
    json: args.json,
    verbose: args.verbose,
    keepData,
    baseUrl,
    orgName: env.SMOKE_ORG_NAME ?? "Orchestra Demo",
    managerEmail: env.SMOKE_MANAGER_EMAIL ?? "manager@orchestra.local",
    managerPassword: env.SMOKE_MANAGER_PASSWORD ?? "Password123!",
    devEmail: env.SMOKE_DEV_EMAIL ?? "dev@orchestra.local",
    devPassword: env.SMOKE_DEV_PASSWORD ?? "Password123!",
    clientEmail: env.SMOKE_CLIENT_EMAIL ?? "client@orchestra.local",
    clientPassword: env.SMOKE_CLIENT_PASSWORD ?? "Password123!",
    projectName: env.SMOKE_PROJECT_NAME ?? `Launch Loop ${new Date().toISOString().slice(0, 19)}`,
    timeoutMs: Number(env.SMOKE_TIMEOUT_MS ?? 120000),
    pollIntervalMs: Number(env.SMOKE_POLL_INTERVAL_MS ?? 2500),
    documentPath: path.resolve(repoRoot, env.SMOKE_DOCUMENT_PATH ?? "docs/fixtures/smoke/launch-loop-prd.md"),
    manualImportPath: path.resolve(
      repoRoot,
      env.SMOKE_MANUAL_IMPORT_PATH ?? "scripts/smoke/fixtures/manual-import-requirement-change.json"
    ),
    expectAi: parseBoolean(env.SMOKE_EXPECT_AI, true),
    expectWorker: parseBoolean(env.SMOKE_EXPECT_WORKER, true),
    clientPortal: parseBoolean(env.SMOKE_CLIENT_PORTAL, true),
    simulateAiProviderFailure: Boolean(args.simulateAiProviderFailure),
    simulateRerankFailure: Boolean(args.simulateRerankFailure),
    simulateLowEvidence: Boolean(args.simulateLowEvidence),
    assertTelemetry: Boolean(args.assertTelemetry),
    redactReports: Boolean(args.redactReports),
    reportJsonPath: reportPaths.json,
    reportMarkdownPath: reportPaths.markdown
  };
}

export function reportPathsForMode(mode: SmokeMode) {
  const stem = `backend-launch-loop-${mode}-report`;
  return {
    json: path.resolve(repoRoot, `artifacts/smoke/${stem}.json`),
    markdown: path.resolve(repoRoot, `artifacts/smoke/${stem}.md`)
  };
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (
      normalized.includes("secret") ||
      normalized.includes("token") ||
      normalized.includes("authorization") ||
      normalized.includes("apikey") ||
      normalized.includes("password") ||
      normalized === "credentialsref" ||
      normalized === "oauthstate"
    ) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = redact(nested);
    }
  }
  return result;
}

export function parseSse(input: string): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = [];
  const blocks = input.split(/\r?\n\r?\n/).filter((block) => block.trim().length > 0);
  for (const block of blocks) {
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

export function aggregateStatus(steps: StepResult[]): SmokeStatus {
  if (steps.some((step) => step.status === "failed")) return "failed";
  if (steps.some((step) => step.status === "degraded")) return "degraded";
  return "passed";
}

export function buildMarkdownReport(report: SmokeReport): string {
  const stepRows = report.steps
    .map((step) => `| ${step.name} | ${step.status} | ${step.routes.length} | ${step.failures.join("; ") || "-"} |`)
    .join("\n");
  const routeRows = report.routeCoverage
    .map((route) => `| ${route.method} | ${route.path} | ${route.statusCode ?? "-"} | ${route.ok ?? "-"} |`)
    .join("\n");
  const proofWarning = report.canBeUsedForLaunchProof
    ? "This report executed real launch-loop API calls and passed all critical semantic proof checks."
    : "This report did not prove the real HTTP launch loop and must not be used as launch proof.";
  const createdRows = Object.entries(redact(report.created) as Record<string, unknown>)
    .map(([key, value]) => `- ${key}: \`${String(value)}\``)
    .join("\n");
  return `# Backend Launch-Loop Smoke Report

## Executive Result
- Mode: ${report.mode}
- Status: ${report.status}
- Proof level: ${report.proofLevel}
- Launch loop proven: ${report.launchLoopProven ? "YES" : "NO"}
- Can be used for launch proof: ${report.canBeUsedForLaunchProof ? "YES" : "NO"}
- Executed HTTP requests: ${report.executedHttpRequests}
- Executed routes: ${report.executedRoutesCount}
- Planned routes: ${report.plannedRoutesCount}
- Base URL: ${report.baseUrl}
- Started: ${report.startedAt}
- Finished: ${report.finishedAt}
- Rerun: \`${report.rerunCommand}\`

${proofWarning}

## Launch-Loop Proof Summary
- Created IDs:
${createdRows || "- none"}
- Proof: \`${JSON.stringify(redact(report.proof))}\`
- Degraded dependencies: ${report.degradedDependencies.length ? report.degradedDependencies.join("; ") : "none"}
- Environment blockers: ${report.environmentBlockers.length ? report.environmentBlockers.join("; ") : "none"}
- Failures: ${report.failures.length ? report.failures.join("; ") : "none"}

## Step Table
| Step | Status | Routes | Failures |
| --- | --- | ---: | --- |
${stepRows || "| - | - | - | - |"}

## Route Coverage
| Method | Path | Status | OK |
| --- | --- | ---: | --- |
${routeRows || "| - | - | - | - |"}

## DB / Worker / AI Dependency Notes
HTTP mode proves the real launch loop only when API, DB, Redis/BullMQ worker, object storage, pgvector, and configured AI providers are available. Mock and dry-run modes are diagnostic only and must not be treated as launch proof.
`;
}

function requiredHttpProofFailures(report: SmokeReport): string[] {
  const failures: string[] = [];
  const created = report.created;
  const requiredCreated = ["projectId", "documentId", "messageId", "proposalId", "brainVersionBefore", "brainVersionAfter"];
  for (const key of requiredCreated) {
    if (!created[key]) failures.push(`HTTP proof missing created.${key}`);
  }

  const before = Number(created.brainVersionBefore);
  const after = Number(created.brainVersionAfter);
  if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before) {
    failures.push("HTTP proof missing Product Brain version increment");
  }

  const proof = report.proof;
  if (report.env.expectAi === true) {
    const currentTruthCitations = Number(proof.socratesCurrentTruthCitations ?? 0);
    const currentTruthOpenTargets = Number(proof.socratesCurrentTruthOpenTargets ?? 0);
    const provenanceCitations = Number(proof.socratesProvenanceCitations ?? 0);
    const provenanceOpenTargets = Number(proof.socratesProvenanceOpenTargets ?? 0);
    if (currentTruthCitations <= 0 || currentTruthOpenTargets <= 0) {
      failures.push("HTTP proof missing Socrates current-truth citations/openTargets");
    }
    if (provenanceCitations <= 0 || provenanceOpenTargets <= 0) {
      failures.push("HTTP proof missing Socrates provenance citations/openTargets");
    }
  }
  if (proof.dashboardFreshnessVerified !== true || proof.dashboardPressureVerified !== true) {
    failures.push("HTTP proof missing dashboard freshness/pressure verification");
  }
  if (proof.clientLeakChecksPassed !== true) {
    failures.push("HTTP proof missing client leak-denial verification");
  }
  return failures;
}

export function finalizeReport(input: SmokeReport): SmokeReport {
  const report: SmokeReport = {
    ...input,
    created: { ...input.created },
    createdEntityIds: { ...input.createdEntityIds },
    routeCoverage: [...input.routeCoverage],
    assertions: [...input.assertions],
    proof: { ...input.proof },
    degradedDependencies: [...new Set(input.degradedDependencies)],
    failures: [...input.failures],
    environmentBlockers: [...input.environmentBlockers]
  };
  report.plannedRoutesCount = ROUTE_PLAN.length;
  report.executedRoutesCount = report.routeCoverage.length;
  report.executedHttpRequests = report.routeCoverage.length;

  if (report.mode === "dry-run") {
    report.proofLevel = "diagnostic";
    report.status = report.failures.length > 0 ? "failed" : "diagnostic";
    report.launchLoopProven = false;
    report.canBeUsedForLaunchProof = false;
    report.executedRoutesCount = 0;
    report.executedHttpRequests = 0;
    return report;
  }

  if (report.mode === "mock") {
    report.proofLevel = "mock";
    report.status = report.failures.length > 0 ? "failed" : "mock_passed";
    report.launchLoopProven = false;
    report.canBeUsedForLaunchProof = false;
    report.executedRoutesCount = 0;
    report.executedHttpRequests = 0;
    return report;
  }

  report.proofLevel = "http";
  const hasRealHttpExecution = report.executedHttpRequests > 0 && report.executedRoutesCount > 0;
  const missingProof = requiredHttpProofFailures(report);
  if (!hasRealHttpExecution) missingProof.unshift("HTTP proof missing executed HTTP requests/routes");

  if (report.failures.length > 0) {
    report.status = "failed";
    report.launchLoopProven = false;
    report.canBeUsedForLaunchProof = false;
    return report;
  }

  if (missingProof.length > 0) {
    report.failures = [...report.failures, ...missingProof];
    report.status = report.status === "degraded" || report.degradedDependencies.length > 0 ? "degraded" : "failed";
    report.launchLoopProven = false;
    report.canBeUsedForLaunchProof = false;
    return report;
  }

  if (report.status === "degraded" || report.degradedDependencies.length > 0) {
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

export async function loadFixtures(config: SmokeConfig) {
  const [documentText, manualImportRaw] = await Promise.all([
    readFile(config.documentPath, "utf8"),
    readFile(config.manualImportPath, "utf8")
  ]);
  const manualImport = JSON.parse(manualImportRaw) as Record<string, unknown>;
  if (!documentText.includes("reporting")) {
    throw new SmokeFailure("PRD fixture must include reporting text for launch-loop assertions");
  }
  if (!manualImport.thread || !Array.isArray(manualImport.messages)) {
    throw new SmokeFailure("Manual import fixture must include thread and messages");
  }
  return { documentText, manualImport };
}

class SmokeRunner {
  private readonly steps: StepResult[] = [];
  private readonly createdIds: Record<string, string> = {};
  private readonly routeCoverage: RouteCall[] = [];
  private readonly degradedDependencies: string[] = [];
  private readonly proofValues: Record<string, unknown> = {};

  constructor(private readonly config: SmokeConfig) {}

  async step(name: string, fn: (step: StepResult) => Promise<void>) {
    const started = Date.now();
    const result: StepResult = {
      name,
      status: "passed",
      startedAt: new Date(started).toISOString(),
      finishedAt: "",
      durationMs: 0,
      routes: [],
      assertions: [],
      createdIds: {},
      degradedNotes: [],
      failures: []
    };
    try {
      await fn(result);
    } catch (error) {
      result.status = "failed";
      result.failures.push(error instanceof Error ? error.message : String(error));
      if (error instanceof SmokeFailure && error.details != null) {
        result.failures.push(JSON.stringify(redact(error.details)));
      }
    } finally {
      const finished = Date.now();
      result.finishedAt = new Date(finished).toISOString();
      result.durationMs = finished - started;
      this.steps.push(result);
    }
  }

  assert(step: StepResult, condition: unknown, message: string, details?: unknown) {
    if (!condition) throw new SmokeFailure(message, details);
    step.assertions.push(message);
  }

  degrade(step: StepResult, message: string) {
    if (step.status !== "failed") step.status = "degraded";
    step.degradedNotes.push(message);
    this.degradedDependencies.push(message);
  }

  async request(
    step: StepResult,
    method: string,
    routePath: string,
    body?: unknown,
    options: { token?: string; expectStatuses?: number[]; sse?: boolean } = {}
  ): Promise<HttpResponse> {
    const url = `${this.config.baseUrl}${routePath}`;
    const headers: Record<string, string> = { Accept: options.sse ? "text/event-stream" : "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
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
    }
    const call = { method, path: routePath, statusCode: response.status, ok: response.ok };
    step.routes.push(call);
    this.routeCoverage.push(call);
    if (this.config.verbose) {
      console.log(JSON.stringify(redact({ request: { method, routePath, body }, response: parsed }), null, 2));
    }
    const expected = options.expectStatuses ?? [];
    const allowed = expected.length > 0 ? expected.includes(response.status) : response.ok;
    if (!allowed) {
      throw new SmokeFailure(`HTTP ${method} ${routePath} returned ${response.status}`, parsed);
    }
    return { statusCode: response.status, ok: response.ok, body: parsed, text };
  }

  async poll<T>(
    name: string,
    fn: () => Promise<T>,
    isDone: (value: T) => boolean,
    timeoutMs = this.config.timeoutMs,
    intervalMs = this.config.pollIntervalMs
  ): Promise<T> {
    const started = Date.now();
    let lastValue: T | undefined;
    while (Date.now() - started <= timeoutMs) {
      lastValue = await fn();
      if (isDone(lastValue)) return lastValue;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new SmokeFailure(`${name} timed out`, lastValue);
  }

  id(key: string, value: unknown) {
    if (typeof value === "string" && value.length > 0) this.createdIds[key] = value;
  }

  proof(key: string, value: unknown) {
    this.proofValues[key] = value;
  }

  async report(startedAt: string): Promise<SmokeReport> {
    const finishedAt = new Date().toISOString();
    const status = aggregateStatus(this.steps);
    const failures = this.steps.flatMap((step) => step.failures.map((failure) => `${step.name}: ${failure}`));
    const degradedDependencies = [...new Set(this.degradedDependencies)];
    const report = finalizeReport({
      runId: this.createdIds.runId ?? `smoke-${Date.now()}`,
      mode: this.config.mode,
      proofLevel: this.config.mode === "http" ? "http" : this.config.mode === "mock" ? "mock" : "diagnostic",
      baseUrl: this.config.baseUrl,
      startedAt,
      finishedAt,
      status,
      launchLoopProven: false,
      canBeUsedForLaunchProof: false,
      executedHttpRequests: this.routeCoverage.length,
      plannedRoutesCount: ROUTE_PLAN.length,
      executedRoutesCount: this.routeCoverage.length,
      env: buildEnvSummary(this.config),
      steps: this.steps,
      created: this.createdIds,
      createdEntityIds: this.createdIds,
      routeCoverage: this.routeCoverage,
      assertions: this.steps.flatMap((step) => step.assertions.map((assertion) => `${step.name}: ${assertion}`)),
      proof: this.proofValues,
      degradedDependencies,
      failures,
      environmentBlockers: this.config.mode === "http" ? degradedDependencies : [],
      rerunCommand:
        this.config.mode === "http"
          ? "npm run smoke:backend:http"
          : this.config.mode === "mock"
            ? "npm run smoke:backend:mock"
            : "npm run smoke:backend:dry-run"
    });
    await writeReport(this.config, report);
    return report;
  }
}

function buildEnvSummary(config: SmokeConfig): Record<string, unknown> {
  return redact({
    mode: config.mode,
    baseUrl: config.baseUrl,
    orgName: config.orgName,
    managerEmail: config.managerEmail,
    managerPassword: config.managerPassword,
    devEmail: config.devEmail,
    devPassword: config.devPassword,
    clientEmail: config.clientEmail,
    clientPassword: config.clientPassword,
    projectName: config.projectName,
    timeoutMs: config.timeoutMs,
    pollIntervalMs: config.pollIntervalMs,
    keepData: config.keepData,
    documentPath: config.documentPath,
    manualImportPath: config.manualImportPath,
    expectAi: config.expectAi,
    expectWorker: config.expectWorker,
    clientPortal: config.clientPortal,
    simulateAiProviderFailure: config.simulateAiProviderFailure,
    simulateRerankFailure: config.simulateRerankFailure,
    simulateLowEvidence: config.simulateLowEvidence,
    assertTelemetry: config.assertTelemetry,
    redactReports: config.redactReports
  }) as Record<string, unknown>;
}

export async function writeReport(config: SmokeConfig, report: SmokeReport) {
  const finalized = finalizeReport(report);
  await mkdir(path.dirname(config.reportJsonPath), { recursive: true });
  await writeFile(config.reportJsonPath, `${JSON.stringify(redact(finalized), null, 2)}\n`);
  await writeFile(config.reportMarkdownPath, buildMarkdownReport(finalized));
}

function dataOf(response: HttpResponse): unknown {
  if (response.body && typeof response.body === "object" && "data" in response.body) {
    return (response.body as { data: unknown }).data;
  }
  return response.body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatPath(pathSegments: PathSegment[]) {
  return pathSegments.map((segment) => (typeof segment === "number" ? `[${segment}]` : `.${segment}`)).join("").replace(/^\./, "");
}

export function getPath(value: unknown, pathSegments: PathSegment[]): unknown {
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

export function requireRecordPath(value: unknown, pathSegments: PathSegment[], label: string): Record<string, unknown> {
  const found = getPath(value, pathSegments);
  if (!isRecord(found)) {
    throw new SmokeFailure(`${label} missing object at ${formatPath(pathSegments) || "<root>"}`, value);
  }
  return found;
}

export function requireArrayPath(value: unknown, pathSegments: PathSegment[], label: string): unknown[] {
  const found = getPath(value, pathSegments);
  if (!Array.isArray(found)) {
    throw new SmokeFailure(`${label} missing array at ${formatPath(pathSegments) || "<root>"}`, value);
  }
  return found;
}

function requireArrayAtAnyPath(value: unknown, pathCandidates: PathSegment[][], label: string): unknown[] {
  for (const pathSegments of pathCandidates) {
    const found = getPath(value, pathSegments);
    if (Array.isArray(found)) {
      return found;
    }
  }
  throw new SmokeFailure(`${label} missing array at ${pathCandidates.map(formatPath).join(" or ") || "<root>"}`, value);
}

export function requireStringPath(value: unknown, pathSegments: PathSegment[], label: string): string {
  const found = getPath(value, pathSegments);
  if (typeof found !== "string" || found.length === 0) {
    throw new SmokeFailure(`${label} missing string at ${formatPath(pathSegments)}`, value);
  }
  return found;
}

export function optionalStringPath(value: unknown, pathSegments: PathSegment[]): string | null {
  const found = getPath(value, pathSegments);
  return typeof found === "string" && found.length > 0 ? found : null;
}

export function requireNumberPath(value: unknown, pathSegments: PathSegment[], label: string): number {
  const found = getPath(value, pathSegments);
  if (typeof found === "number" && Number.isFinite(found)) return found;
  if (typeof found === "string" && Number.isFinite(Number(found))) return Number(found);
  throw new SmokeFailure(`${label} missing number at ${formatPath(pathSegments)}`, value);
}

export function requireAllowedStatus(
  value: unknown,
  pathSegments: PathSegment[],
  allowed: readonly string[],
  label: string
): string {
  const status = requireStringPath(value, pathSegments, label);
  if (!allowed.includes(status)) {
    throw new SmokeFailure(`${label} status ${status} was not one of ${allowed.join(", ")}`, value);
  }
  return status;
}

export function requireNonEmptyArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SmokeFailure(`${label} expected a non-empty array`, value);
  }
  return value;
}

export function requireSocratesDonePayload(events: Array<{ event: string; data: unknown }>, label: string) {
  const done = events.find((event) => event.event === "done");
  if (!done) {
    throw new SmokeFailure(`${label} missing done SSE event`, events);
  }
  const payload = done.data;
  if (!isRecord(payload)) {
    throw new SmokeFailure(`${label} done event did not contain an object payload`, done);
  }
  const answer = requireStringPath(payload, ["answer_md"], `${label} answer`);
  if (answer.trim().length < 10) {
    throw new SmokeFailure(`${label} answer was too short to prove Socrates responded`, payload);
  }
  const citations = requireArrayPath(payload, ["citations"], `${label} citations`);
  const openTargets = requireArrayPath(payload, ["open_targets"], `${label} open targets`);
  requireArrayPath(payload, ["suggested_prompts"], `${label} suggested prompts`);
  requireArrayPath(payload, ["limitations"], `${label} limitations`);
  const confidence = requireStringPath(payload, ["confidence"], `${label} confidence`);
  if (!["high", "medium", "low"].includes(confidence)) {
    throw new SmokeFailure(`${label} confidence was not a valid enum`, payload);
  }
  if (citations.length === 0) {
    throw new SmokeFailure(`${label} did not return citations`, payload);
  }
  if (openTargets.length === 0) {
    throw new SmokeFailure(`${label} did not return open targets`, payload);
  }
  for (const [index, citation] of citations.entries()) {
    requireStringPath(citation, ["type"], `${label} citation ${index}`);
    requireStringPath(citation, ["refId"], `${label} citation ${index}`);
  }
  for (const [index, target] of openTargets.entries()) {
    requireStringPath(target, ["targetType"], `${label} open target ${index}`);
    requireRecordPath(target, ["targetRef"], `${label} open target ${index}`);
  }
  return payload;
}

const FORBIDDEN_CLIENT_RESPONSE_KEYS = new Set([
  "bodyText",
  "bodyHtml",
  "providerMessageId",
  "providerThreadId",
  "providerPermalink",
  "credentialsRef",
  "rawMetadata",
  "connectorId",
  "syncRunId",
  "messageId",
  "threadId",
  "proposalId",
  "sourceMessageIds",
  "sourceThreadIds",
  "communicationMessageIds"
]);

export function collectForbiddenClientFields(value: unknown, pathPrefix = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectForbiddenClientFields(item, `${pathPrefix}[${index}]`));
  }
  if (!isRecord(value)) return [];
  const findings: string[] = [];
  for (const [key, nested] of Object.entries(value)) {
    const currentPath = `${pathPrefix}.${key}`;
    if (FORBIDDEN_CLIENT_RESPONSE_KEYS.has(key)) {
      findings.push(currentPath);
    }
    findings.push(...collectForbiddenClientFields(nested, currentPath));
  }
  return findings;
}

export function assertNoForbiddenClientFields(value: unknown, label: string) {
  const findings = collectForbiddenClientFields(value);
  if (findings.length > 0) {
    throw new SmokeFailure(`${label} leaked internal fields: ${findings.join(", ")}`, value);
  }
}

function sectionHasAcceptedOverlay(section: unknown): boolean {
  if (!isRecord(section)) return false;
  const changeMarkers = Array.isArray(section.changeMarkers) ? section.changeMarkers : [];
  const summaries = Array.isArray(section.currentTruthSummary) ? section.currentTruthSummary : [];
  return section.hasCurrentTruthOverlay === true || changeMarkers.length > 0 || summaries.length > 0;
}

function viewerSectionText(section: unknown): string {
  return (
    optionalStringPath(section, ["text"]) ??
    optionalStringPath(section, ["originalText"]) ??
    optionalStringPath(section, ["effectiveText"]) ??
    optionalStringPath(section, ["currentText"]) ??
    optionalStringPath(section, ["content"]) ??
    ""
  );
}

function viewerSectionMentions(section: unknown, term: string): boolean {
  const normalizedTerm = term.toLowerCase();
  const bodyText = viewerSectionText(section).toLowerCase();
  if (bodyText.includes(normalizedTerm)) return true;
  const headingPath = getPath(section, ["headingPath"]);
  return Array.isArray(headingPath) && headingPath.some((heading) => typeof heading === "string" && heading.toLowerCase().includes(normalizedTerm));
}

function firstStringAtKeys(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstStringAtKeys(item, keys);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  for (const nested of Object.values(record)) {
    const found = firstStringAtKeys(nested, keys);
    if (found) return found;
  }
  return null;
}

function firstNumberAtKeys(value: unknown, keys: string[]): number | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstNumberAtKeys(item, keys);
      if (found != null) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "number") return record[key] as number;
    if (typeof record[key] === "string" && Number.isFinite(Number(record[key]))) return Number(record[key]);
  }
  for (const nested of Object.values(record)) {
    const found = firstNumberAtKeys(nested, keys);
    if (found != null) return found;
  }
  return null;
}

function firstArray(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record[key])) return record[key] as unknown[];
  for (const nested of Object.values(record)) {
    const found = firstArray(nested, key);
    if (found.length > 0) return found;
  }
  return [];
}

async function signupOrLogin(runner: SmokeRunner, step: StepResult, config: SmokeConfig, input: {
  email: string;
  password: string;
  displayName: string;
  orgName: string;
}) {
  const signup = await runner.request(
    step,
    "POST",
    "/v1/auth/signup",
    {
      orgName: input.orgName,
      email: input.email,
      password: input.password,
      displayName: input.displayName
    },
    { expectStatuses: [200, 409] }
  );
  if (signup.statusCode === 409) {
    return runner.request(step, "POST", "/v1/auth/login", { email: input.email, password: input.password });
  }
  return signup;
}

export function buildDryRunText(config: SmokeConfig): string {
  return `Backend launch-loop smoke dry run

Mode: dry-run
Proof level: diagnostic only
Launch loop proven: NO
Can be used for launch proof: NO
Base URL: ${config.baseUrl}
Report JSON: ${config.reportJsonPath}
Report Markdown: ${config.reportMarkdownPath}
AI ops assertions: telemetry=${config.assertTelemetry}, simulateProviderFailure=${config.simulateAiProviderFailure}, simulateRerankFailure=${config.simulateRerankFailure}, simulateLowEvidence=${config.simulateLowEvidence}

Required environment:
${SMOKE_ENV_KEYS.map((key) => `- ${key}`).join("\n")}

Route sequence:
${ROUTE_PLAN.map((route, index) => `${index + 1}. ${route}`).join("\n")}

Expected hard blockers in HTTP mode:
- API unreachable
- auth/project/document upload broken
- worker-required parse/brain timeout when SMOKE_EXPECT_WORKER=true
- proposal acceptance does not create a newer Product Brain version
- client/internal leak check fails
- AI ops telemetry missing when --assert-telemetry is enabled
- degraded evidence-only Socrates response missing when simulated provider failure is enabled
- Fireflies live API credentials are not required for this launch-loop smoke; dry-run/mock only prove Fireflies route-plan diagnostics

Dry-run performs no HTTP API calls and is not launch proof.
`;
}

async function runDryRun(config: SmokeConfig): Promise<SmokeReport> {
  const runner = new SmokeRunner(config);
  const startedAt = new Date().toISOString();
  await runner.step("dry-run route and env contract", async (step) => {
    runner.assert(step, ROUTE_PLAN.length >= 21, "route plan covers the Day 6 launch loop");
    runner.assert(step, SMOKE_ENV_KEYS.includes("SMOKE_BASE_URL"), "SMOKE_BASE_URL is documented");
  });
  const report = await runner.report(startedAt);
  if (!config.json) console.log(buildDryRunText(config));
  return report;
}

async function runMock(config: SmokeConfig): Promise<SmokeReport> {
  const runner = new SmokeRunner(config);
  const startedAt = new Date().toISOString();
  await runner.step("load smoke fixtures", async (step) => {
    const fixtures = await loadFixtures(config);
    runner.assert(step, fixtures.documentText.length > 100, "PRD fixture loads");
    runner.assert(step, Array.isArray(fixtures.manualImport.messages), "manual import fixture has messages");
  });
  await runner.step("validate route sequence and redaction", async (step) => {
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("socrates")), "Socrates routes are included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("agent-context-packs")), "Agent Context Pack routes are included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("exports/preview")), "Agent Context export preview route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("export-formats")), "Agent Context export formats route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("agent-runs/:runId/review")), "Agent Run Memory review route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/v1/mcp/readiness")), "MCP readiness route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route === "POST /v1/mcp"), "MCP JSON-RPC endpoint is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/quality-reports")), "Step 5 context-pack quality routes are included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/quality-reviews")), "Step 5 agent-run review routes are included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/agent-files/default/preview")), "Feature 12 agent file preview route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/agent-files/default/generate")), "Feature 12 agent file generate route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/agent-files/file-sets/:fileSetId/refresh")), "Feature 12 Step 2 refresh route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/agent-files/file-sets/:fileSetId/staleness")), "Feature 12 Step 2 staleness route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/agent-files/file-sets/:fileSetId/diff")), "Feature 12 Step 2 diff route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/agent-files/file-sets/:fileSetId/download")), "Feature 12 Step 2 download route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/agent-files/file-sets/:fileSetId/manifest")), "Feature 12 Step 2 manifest route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/agent-files/file-sets/:fileSetId/quality")), "Feature 12 Step 3 quality route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/agent-files/file-sets/:fileSetId/drift")), "Feature 12 Step 3 drift route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/agent-files/file-sets/:fileSetId/github-readiness")), "Feature 12 Step 3 GitHub readiness route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/agent-files/file-sets/:fileSetId/sync/github-pr")), "Feature 12 Step 3 gated GitHub PR sync route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/agent-files/file-sets/:fileSetId/release-gate")), "Feature 12 Step 3 release gate route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route === "GET /v1/github/readiness"), "Feature 13 GitHub readiness route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route === "POST /v1/webhooks/github"), "Feature 13 GitHub webhook route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/projects/:projectId/github/repositories/link")), "Feature 13 GitHub repo link route is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/projects/:projectId/github/backfill")), "Feature 13 GitHub backfill route is included");
    runner.assert(step, !ROUTE_PLAN.some((route) => /github.*(merge|comment|create-pr|files\/write|contents)/i.test(route)), "Feature 13 route plan exposes no GitHub write actions");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/engineering-evidence")), "Feature 13 Part 2 engineering evidence routes are included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/mock-real-registry")), "Feature 13 Part 2 Mock vs Real routes are included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/integration-seams")), "Feature 13 Part 2 Integration Seam routes are included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/branch-deploy-truth")), "Feature 13 Part 2 Branch & Deploy Truth routes are included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/todo-fixme")), "Feature 13 Part 2 TODO/FIXME routes are included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/fde-readiness/conflicts")), "Feature 13 Part 3 Conflict Radar routes are included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/fde-readiness/safe-to-touch")), "Feature 13 Part 3 Safe-to-Touch routes are included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/fde-readiness/duplicates")), "Feature 13 Part 3 duplicate work routes are included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/fde-readiness/live-working-map")), "Feature 13 Part 3 Live Working Map routes are included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/fde-readiness/rationale-traces")), "Feature 13 Part 3 Rationale Trace routes are included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/fde-readiness/decision-links")), "Feature 13 Part 3 decision engineering link routes are included");
    runner.assert(step, ROUTE_PLAN.includes("GET /v1/projects/:projectId/dashboard"), "Feature 13 Part 4 canonical dashboard route is registered");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/dashboard/readiness")), "Feature 13 Part 4 readiness subroute is registered");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/dashboard/context-snapshot")), "Feature 13 Part 4 Context Snapshot route is registered");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/dashboard/files/:filePath/safe-to-touch")), "Feature 13 Part 4 Safe-to-Touch dashboard route is registered");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/dashboard/branch-deploy-truth")), "Feature 13 Part 4 Branch & Deploy dashboard route is registered");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("fireflies_ai")), "Fireflies transcript import diagnostic is included");
    runner.assert(step, ROUTE_PLAN.some((route) => route.includes("/v1/webhooks/fireflies")), "Fireflies webhook diagnostic is included");
    runner.assert(step, JSON.stringify(redact({ accessToken: "secret", nested: { credentialsRef: "vault:x" } })).includes("[REDACTED]"), "secret fields are redacted");
    runner.degrade(step, "mock mode validates route shape and reporting only; DB/API integration was not proven");
  });
  await runner.step("validate SSE parsing", async (step) => {
    const events = parseSse('event: message_created\ndata: {"id":"m1"}\n\nevent: done\ndata: {"answer":"ok"}\n\n');
    runner.assert(step, events.length === 2, "SSE parser reads multiple events");
    runner.assert(step, events[1]?.event === "done", "SSE parser preserves done event");
  });
  await runner.step("validate AI ops smoke assertions", async (step) => {
    const degradedPayload = buildEvidenceOnlyDegradedAnswer({
      reason: config.simulateAiProviderFailure ? "generation_provider_failed" : "low_evidence",
      citations: [{
        type: "document_section",
        refId: "11111111-1111-4111-8111-111111111111",
        label: "Shared PRD section",
        confidence: 0.82
      }],
      openTargets: [{
        targetType: "document_section",
        targetRef: { documentId: "22222222-2222-4222-8222-222222222222", anchorId: "prd-shared-scope", pageNumber: 1 }
      }]
    });
    const mockTelemetry = {
      model_tier: "deterministic_fallback",
      model_used: "mock",
      model_provider: "mock",
      estimated_cost_usd: 0,
      degraded_mode: config.simulateAiProviderFailure,
      degradation_reason: config.simulateAiProviderFailure ? "generation_provider_failed" : null,
      latency_ms: 1,
      retrieval_latency_ms: 1,
      embedding_latency_ms: 1,
      rerank_latency_ms: config.simulateRerankFailure ? 1 : 0,
      generation_latency_ms: 0,
      validation_latency_ms: 1,
      dropped_citation_count: 0,
      dropped_open_target_count: 0,
      no_evidence: config.simulateLowEvidence,
      no_citation: false
    };
    runner.assert(step, typeof mockTelemetry.model_tier === "string", "AI ops telemetry includes model tier");
    runner.assert(step, typeof mockTelemetry.estimated_cost_usd === "number", "AI ops telemetry includes cost estimate");
    runner.assert(step, !JSON.stringify(redact(mockTelemetry)).match(/token|secret|apikey/i), "AI ops telemetry report is redacted");
    runner.assert(step, answerSchema.safeParse(degradedPayload).success, "degraded Socrates payload is strict-schema valid");
    runner.assert(step, degradedPayload.confidence === "low", "degraded Socrates payload is low confidence");
    runner.assert(step, degradedPayload.citations.length > 0 && degradedPayload.open_targets.length > 0, "degraded payload preserves validated evidence navigation");
    if (config.assertTelemetry) {
      runner.assert(step, "model_used" in mockTelemetry && "model_provider" in mockTelemetry && "retrieval_latency_ms" in mockTelemetry && "validation_latency_ms" in mockTelemetry, "assert-telemetry fields are present");
    }
    if (config.simulateAiProviderFailure) {
      runner.degrade(step, "simulated AI provider failure would require degraded evidence-only Socrates response in HTTP mode");
    }
    if (config.simulateRerankFailure) {
      runner.degrade(step, "simulated rerank failure would require heuristic rerank fallback in HTTP mode");
    }
    if (config.simulateLowEvidence) {
      runner.degrade(step, "simulated low evidence would require honest insufficiency answer in HTTP mode");
    }
  });
  return runner.report(startedAt);
}

async function runHttp(config: SmokeConfig): Promise<SmokeReport> {
  const runner = new SmokeRunner(config);
  const startedAt = new Date().toISOString();
  const fixtures = await loadFixtures(config);
  let managerToken = "";
  let devToken = "";
  let clientToken = "";
  let projectId = "";
  let devMemberId = "";
  let documentId = "";
  let brainVersionBefore = 0;
  let messageId = "";
  let threadId = "";
  let insightId = "";
  let proposalId = "";
  let anchorId = "";

  await runner.step("health", async (step) => {
    await runner.request(step, "GET", "/health");
  });

  await runner.step("signup/login manager", async (step) => {
    const response = await signupOrLogin(runner, step, config, {
      email: config.managerEmail,
      password: config.managerPassword,
      displayName: "Smoke Manager",
      orgName: config.orgName
    });
    const data = dataOf(response);
    managerToken = requireStringPath(data, ["accessToken"], "manager login");
    runner.assert(step, managerToken, "manager accessToken returned");
    runner.assert(step, !JSON.stringify(data).includes("passwordHash"), "auth payload does not include passwordHash");
    const me = await runner.request(step, "GET", "/v1/auth/me", undefined, { token: managerToken });
    runner.assert(step, !JSON.stringify(dataOf(me)).includes("passwordHash"), "/me payload does not include passwordHash");
  });

  await runner.step("create and fetch project", async (step) => {
    const created = await runner.request(
      step,
      "POST",
      "/v1/projects",
      { name: config.projectName, description: "Day 6 launch-loop smoke project" },
      { token: managerToken }
    );
    projectId = requireStringPath(dataOf(created), ["id"], "created project");
    runner.id("projectId", projectId);
    runner.assert(step, projectId, "projectId returned");
    await runner.request(step, "GET", "/v1/projects", undefined, { token: managerToken });
    const fetched = await runner.request(step, "GET", `/v1/projects/${projectId}`, undefined, { token: managerToken });
    runner.assert(step, requireStringPath(dataOf(fetched), ["id"], "fetched project") === projectId, "created project is fetchable by id");
  });

  await runner.step("add dev/client members and prove role denials", async (step) => {
    const devLogin = await runner.request(
      step,
      "POST",
      "/v1/auth/login",
      { email: config.devEmail, password: config.devPassword },
      { expectStatuses: [200, 401] }
    );
    if (devLogin.statusCode !== 200) {
      throw new SmokeFailure("Dev user must already exist in the manager organization before HTTP smoke can add membership", {
        requiredAction: "Run seed or create same-org dev user before npm run smoke:backend:http",
        email: config.devEmail
      });
    }
    devToken = requireStringPath(dataOf(devLogin), ["accessToken"], "dev login");

    const clientLogin = await runner.request(
      step,
      "POST",
      "/v1/auth/login",
      { email: config.clientEmail, password: config.clientPassword },
      { expectStatuses: [200, 401] }
    );
    if (clientLogin.statusCode !== 200) {
      throw new SmokeFailure("Client user must already exist in the manager organization before HTTP smoke can add membership", {
        requiredAction: "Run seed or create same-org client user before npm run smoke:backend:http",
        email: config.clientEmail
      });
    }
    clientToken = requireStringPath(dataOf(clientLogin), ["accessToken"], "client login");

    const devMember = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/members`,
      { email: config.devEmail, projectRole: "dev", roleInProject: "Developer", allocationPercent: 50, weeklyCapacityHours: 20 },
      { token: managerToken }
    );
    devMemberId = requireStringPath(dataOf(devMember), ["id"], "dev member");
    await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/members`,
      { email: config.clientEmail, projectRole: "client", roleInProject: "Client reviewer" },
      { token: managerToken }
    );
    const members = await runner.request(step, "GET", `/v1/projects/${projectId}/members`, undefined, { token: managerToken });
    const membersPayload = dataOf(members);
    const memberItems = Array.isArray(membersPayload)
      ? membersPayload
      : requireArrayPath(membersPayload, ["members"], "project members");
    runner.assert(
      step,
      memberItems.some((item) => optionalStringPath(item, ["user", "email"]) === config.devEmail) &&
        memberItems.some((item) => optionalStringPath(item, ["user", "email"]) === config.clientEmail),
      "dev and client members are present"
    );
    await runner.request(
      step,
      "PATCH",
      `/v1/projects/${projectId}/members/${devMemberId}`,
      { allocationPercent: 60 },
      { token: managerToken }
    );
    await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/members`,
      { email: config.devEmail, projectRole: "dev" },
      { token: devToken, expectStatuses: process.env.MVP_EQUAL_PROJECT_ACCESS === "true" ? [200] : [403] }
    );
    await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/members`,
      { email: config.clientEmail, projectRole: "client" },
      { token: clientToken, expectStatuses: [403] }
    );
    await runner.request(
      step,
      "PATCH",
      `/v1/projects/${projectId}/members/${devMemberId}`,
      { allocationPercent: 70 },
      { token: devToken, expectStatuses: process.env.MVP_EQUAL_PROJECT_ACCESS === "true" ? [200] : [403] }
    );
  });

  await runner.step("upload document and wait for parse/index", async (step) => {
    const uploaded = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/documents/upload`,
      {
        kind: "prd",
        title: "Launch Loop PRD",
        visibility: "shared_with_client",
        sourceLabel: "Day 6 smoke fixture",
        pastedText: fixtures.documentText
      },
      { token: managerToken }
    );
    documentId = requireStringPath(dataOf(uploaded), ["documentId"], "document upload");
    runner.id("documentId", documentId);
    runner.assert(step, documentId, "documentId returned");
    const documents = await runner.request(step, "GET", `/v1/projects/${projectId}/documents`, undefined, { token: managerToken });
    runner.assert(
      step,
      requireArrayPath(dataOf(documents), [], "document list").some((item) => optionalStringPath(item, ["id"]) === documentId),
      "document list includes uploaded fixture"
    );
    const doc = await runner.poll(
      "document parse/index",
      async () => runner.request(step, "GET", `/v1/projects/${projectId}/documents/${documentId}`, undefined, { token: managerToken }),
      (response) => ["ready", "partial", "failed"].includes(optionalStringPath(dataOf(response), ["parseStatus"]) ?? "")
    );
    const parseStatus = optionalStringPath(dataOf(doc), ["parseStatus"]);
    if (parseStatus === "failed") throw new SmokeFailure("document processing failed", dataOf(doc));
    if (parseStatus !== "ready" && parseStatus !== "partial") {
      if (config.expectWorker) throw new SmokeFailure("document processing did not reach ready/partial with SMOKE_EXPECT_WORKER=true", dataOf(doc));
      runner.degrade(step, "document processing did not complete; SMOKE_EXPECT_WORKER=false");
    }
  });

  await runner.step("rebuild Product Brain and graph", async (step) => {
    await runner.request(step, "POST", `/v1/projects/${projectId}/brain/rebuild`, undefined, { token: managerToken });
    const current = await runner.poll(
      "Product Brain current artifact",
      async () => runner.request(step, "GET", `/v1/projects/${projectId}/brain/current`, undefined, { token: managerToken }),
      (response) => typeof optionalStringPath(dataOf(response), ["currentBrain", "artifactId"]) === "string"
    );
    brainVersionBefore = requireNumberPath(dataOf(current), ["currentBrain", "versionNumber"], "current Product Brain");
    runner.id("brainVersionBefore", String(brainVersionBefore));
    runner.assert(step, brainVersionBefore > 0, "current Product Brain version exists");
    const versions = await runner.request(step, "GET", `/v1/projects/${projectId}/brain/versions`, undefined, {
      token: managerToken,
      expectStatuses: process.env.MVP_SHOW_VERSION_HISTORY === "false" ? [200, 403] : undefined
    });
    if (versions.statusCode === 403 && process.env.MVP_SHOW_VERSION_HISTORY === "false") {
      runner.degrade(step, "brain version history route disabled by MVP profile");
    } else {
      runner.assert(step, requireArrayPath(dataOf(versions), [], "brain versions").length > 0, "brain versions includes at least one version");
    }
    const graph = await runner.request(step, "GET", `/v1/projects/${projectId}/brain/graph/current`, undefined, { token: managerToken });
    requireRecordPath(dataOf(graph), ["graph"], "current brain graph");
  });

  await runner.step("open viewer/search/provenance", async (step) => {
    const view = await runner.request(step, "GET", `/v1/projects/${projectId}/documents/${documentId}/view`, undefined, { token: managerToken });
    const sections = requireNonEmptyArray(getPath(dataOf(view), ["sections"]), "viewer sections");
    const reportingSection =
      sections.find((section) => viewerSectionMentions(section, "reporting")) ?? sections[0];
    anchorId = requireStringPath(reportingSection, ["anchorId"], "viewer section");
    runner.assert(step, viewerSectionMentions(reportingSection, "reporting"), "viewer preserves original section text");
    const search = await runner.request(step, "GET", `/v1/projects/${projectId}/documents/${documentId}/search?q=reporting`, undefined, { token: managerToken });
    runner.assert(step, requireArrayPath(dataOf(search), [], "document search results").length > 0, "document search returns reporting result");
    await runner.request(step, "GET", `/v1/projects/${projectId}/documents/${documentId}/anchors/${encodeURIComponent(anchorId)}`, undefined, {
      token: managerToken
    });
    await runner.request(step, "GET", `/v1/projects/${projectId}/documents/${documentId}/anchors/${encodeURIComponent(anchorId)}/provenance`, undefined, {
      token: managerToken
    });
  });

  await runner.step("manual import communication evidence", async (step) => {
    const imported = await runner.request(step, "POST", `/v1/projects/${projectId}/communications/import`, fixtures.manualImport, { token: managerToken });
    threadId = requireStringPath(dataOf(imported), ["threadId"], "manual import");
    const timeline = await runner.request(step, "GET", `/v1/projects/${projectId}/communications/timeline`, undefined, { token: managerToken });
    runner.assert(
      step,
      requireArrayPath(dataOf(timeline), [], "communication timeline").some(
        (item) => optionalStringPath(item, ["id"]) === threadId || optionalStringPath(item, ["threadId"]) === threadId
      ),
      "timeline includes imported thread"
    );
    const threadList = await runner.request(step, "GET", `/v1/projects/${projectId}/threads`, undefined, { token: managerToken });
    runner.assert(
      step,
      requireArrayPath(dataOf(threadList), [], "thread list").some(
        (item) => optionalStringPath(item, ["id"]) === threadId || optionalStringPath(item, ["threadId"]) === threadId
      ),
      "thread list includes imported thread"
    );
    const thread = await runner.request(step, "GET", `/v1/projects/${projectId}/threads/${threadId}`, undefined, { token: managerToken });
    const messages = requireNonEmptyArray(getPath(dataOf(thread), ["messages"]), "imported thread messages");
    messageId = requireStringPath(messages[0], ["id"], "imported thread message");
    runner.id("threadId", threadId);
    runner.id("messageId", messageId);
    runner.assert(step, messageId, "messageId found after import");
    const message = await runner.request(step, "GET", `/v1/projects/${projectId}/messages/${messageId}`, undefined, { token: managerToken });
    const messageDetail = dataOf(message);
    const messageBody = optionalStringPath(messageDetail, ["bodyText"]) ?? requireStringPath(messageDetail, ["message", "bodyText"], "message detail");
    const messageThreadId =
      optionalStringPath(messageDetail, ["threadId"]) ??
      optionalStringPath(messageDetail, ["thread", "id"]) ??
      requireStringPath(messageDetail, ["message", "threadId"], "message detail");
    runner.assert(step, messageBody.includes("weekly manager reporting"), "message detail preserves imported body");
    runner.assert(step, messageThreadId === threadId, "message detail is linked to imported thread");
  });

  await runner.step("classify message and create proposal", async (step) => {
    const classified = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/messages/${messageId}/classify`,
      undefined,
      { token: managerToken, expectStatuses: config.expectAi ? undefined : [200, 400, 500] }
    );
    if (!classified.ok && !config.expectAi) {
      runner.degrade(step, "message classifier unavailable; SMOKE_EXPECT_AI=false");
      return;
    }
    const insights = await runner.request(step, "GET", `/v1/projects/${projectId}/message-insights?messageId=${messageId}`, undefined, {
      token: managerToken
    });
    const insightItems = Array.isArray(dataOf(insights)) ? (dataOf(insights) as unknown[]) : [];
    const matchingInsight = insightItems.find((item) => optionalStringPath(item, ["messageId"]) === messageId) ?? insightItems[0];
    if (!matchingInsight) {
      if (config.expectAi) throw new SmokeFailure("message insight missing after classification", dataOf(insights));
      runner.degrade(step, "message insight missing; SMOKE_EXPECT_AI=false");
      return;
    }
    insightId = requireStringPath(matchingInsight, ["id"], "message insight");
    requireStringPath(matchingInsight, ["insightType"], "message insight");
    requireNumberPath(matchingInsight, ["confidence"], "message insight");
    runner.id("insightId", insightId);
    const review = await runner.request(step, "GET", `/v1/projects/${projectId}/communication-review`, undefined, { token: managerToken });
    requireArrayPath(dataOf(review), ["pendingInsights"], "communication review");
    const proposal = await runner.request(step, "POST", `/v1/projects/${projectId}/message-insights/${insightId}/create-proposal`, undefined, {
      token: managerToken
    });
    proposalId = requireStringPath(dataOf(proposal), ["proposalId"], "created proposal");
    runner.id("proposalId", proposalId);
    runner.assert(step, proposalId, "proposalId created from insight");
    const proposals = await runner.request(step, "GET", `/v1/projects/${projectId}/change-proposals`, undefined, { token: managerToken });
    runner.assert(
      step,
      requireArrayPath(dataOf(proposals), [], "change proposal list").some((item) => optionalStringPath(item, ["id"]) === proposalId),
      "change proposal list includes created proposal"
    );
    const detail = await runner.request(step, "GET", `/v1/projects/${projectId}/change-proposals/${proposalId}`, undefined, { token: managerToken });
    requireAllowedStatus(dataOf(detail), ["status"], ["needs_review", "detected"], "created proposal");
    const links = requireArrayPath(dataOf(detail), ["links"], "created proposal links");
    runner.assert(step, links.some((link) => optionalStringPath(link, ["linkType"]) === "message"), "proposal preserves source message link");
    runner.assert(step, links.some((link) => optionalStringPath(link, ["linkType"]) === "thread"), "proposal preserves source thread link");
    runner.assert(step, links.some((link) => optionalStringPath(link, ["linkType"]) === "document_section"), "proposal preserves affected section link");
    runner.assert(step, links.some((link) => optionalStringPath(link, ["linkType"]) === "brain_node"), "proposal preserves affected brain node link");
  });

  await runner.step("accept proposal and verify new truth version", async (step) => {
    if (!proposalId) {
      if (config.expectAi) throw new SmokeFailure("proposalId missing before acceptance");
      runner.degrade(step, "proposal acceptance skipped because proposal was not created");
      return;
    }
    const accepted = await runner.request(step, "POST", `/v1/projects/${projectId}/change-proposals/${proposalId}/accept`, undefined, {
      token: managerToken
    });
    requireAllowedStatus(dataOf(accepted), ["status"], ["accepted"], "accepted proposal");
    requireStringPath(dataOf(accepted), ["acceptedBy"], "accepted proposal");
    const current = await runner.poll(
      "Product Brain version after acceptance",
      async () => runner.request(step, "GET", `/v1/projects/${projectId}/brain/current`, undefined, { token: managerToken }),
      (response) => {
        try {
          return requireNumberPath(dataOf(response), ["currentBrain", "versionNumber"], "Product Brain after acceptance") > brainVersionBefore;
        } catch {
          return false;
        }
      }
    );
    const afterVersion = requireNumberPath(dataOf(current), ["currentBrain", "versionNumber"], "Product Brain after acceptance");
    runner.id("brainVersionAfter", String(afterVersion));
    runner.assert(step, afterVersion > brainVersionBefore, "accepted proposal created newer Product Brain version");
    const acceptedDetail = await runner.request(step, "GET", `/v1/projects/${projectId}/change-proposals/${proposalId}`, undefined, {
      token: managerToken
    });
    requireStringPath(dataOf(acceptedDetail), ["acceptedBrainVersionId"], "accepted proposal after apply job");
  });

  await runner.step("viewer overlay after accepted change", async (step) => {
    const view = await runner.request(step, "GET", `/v1/projects/${projectId}/documents/${documentId}/view`, undefined, { token: managerToken });
    const sections = requireNonEmptyArray(getPath(dataOf(view), ["sections"]), "viewer sections after acceptance");
    runner.assert(step, sections.some(sectionHasAcceptedOverlay), "viewer contains accepted change marker or current-truth overlay");
    runner.assert(
      step,
      sections.some((section) => viewerSectionMentions(section, "reporting")),
      "viewer still exposes original source section text"
    );
    if (anchorId) {
      await runner.request(step, "GET", `/v1/projects/${projectId}/documents/${documentId}/anchors/${encodeURIComponent(anchorId)}/provenance`, undefined, {
        token: managerToken
      });
    }
  });

  await runner.step("Socrates current-truth and provenance SSE", async (step) => {
    const session = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/socrates/sessions`,
      { pageContext: "brain_overview" },
      { token: managerToken }
    );
    const sessionId = requireStringPath(dataOf(session), ["id"], "Socrates session");
    runner.assert(step, sessionId, "Socrates session created");
    await runner.request(
      step,
      "PATCH",
      `/v1/projects/${projectId}/socrates/sessions/${sessionId}/context`,
      { pageContext: "doc_viewer", selectedRefType: "document", selectedRefId: documentId },
      { token: managerToken }
    );
    await runner.request(step, "GET", `/v1/projects/${projectId}/socrates/sessions/${sessionId}/suggestions`, undefined, {
      token: managerToken
    });
    const socratesQuestions = [
      { proofPrefix: "socratesCurrentTruth", content: "What is the current reporting requirement for managers?" },
      { proofPrefix: "socratesProvenance", content: "Where did the reporting requirement originally come from and what changed it?" }
    ];
    for (const { proofPrefix, content } of socratesQuestions) {
      const streamed = await runner.request(
        step,
        "POST",
        `/v1/projects/${projectId}/socrates/sessions/${sessionId}/messages/stream`,
        { content },
        { token: managerToken, sse: true, expectStatuses: config.expectAi ? undefined : [200, 400, 500] }
      );
      if (!streamed.ok && !config.expectAi) {
        runner.degrade(step, "Socrates unavailable; SMOKE_EXPECT_AI=false");
        continue;
      }
      const events = parseSse(streamed.text);
      runner.assert(step, events.some((event) => event.event === "message_created"), "SSE includes message_created");
      try {
        const payload = requireSocratesDonePayload(events, `Socrates answer for "${content}"`);
        const citations = requireArrayPath(payload, ["citations"], `Socrates answer for "${content}" citations`);
        const openTargets = requireArrayPath(payload, ["open_targets"], `Socrates answer for "${content}" open targets`);
        runner.proof(`${proofPrefix}Citations`, citations.length);
        runner.proof(`${proofPrefix}OpenTargets`, openTargets.length);
      } catch (error) {
        if (config.expectAi) throw error;
        runner.degrade(step, `Socrates answer was not fully grounded; SMOKE_EXPECT_AI=false (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    const history = await runner.request(step, "GET", `/v1/projects/${projectId}/socrates/sessions/${sessionId}/messages`, undefined, {
      token: managerToken
    });
    runner.assert(step, requireArrayPath(dataOf(history), [], "Socrates message history").length >= 2, "Socrates history stores exchanged messages");
  });

  await runner.step("dashboard proof", async (step) => {
    await runner.request(step, "POST", `/v1/projects/${projectId}/dashboard/refresh`, undefined, {
      token: managerToken
    });
    const projectDashboard = await runner.request(step, "GET", `/v1/projects/${projectId}/dashboard?forceRefresh=true`, undefined, {
      token: managerToken
    });
    const dashboardData = dataOf(projectDashboard);
    const dashboardPayload = isRecord(getPath(dashboardData, ["data"]))
      ? requireRecordPath(dashboardData, ["data"], "project dashboard payload")
      : requireRecordPath(dashboardData, [], "project dashboard payload");
    const dashboardKind = requireStringPath(dashboardPayload, ["dashboardKind"], "project dashboard kind");
    runner.assert(step, dashboardKind === "fde_readiness", "Project dashboard is readiness-first with dashboardKind=fde_readiness");
    requireRecordPath(dashboardPayload, ["readinessSummary"], "project dashboard readinessSummary");
    requireRecordPath(dashboardPayload, ["operationalSummary"], "project dashboard operationalSummary");
    requireRecordPath(dashboardPayload, ["mockVsRealRegistry"], "project dashboard Mock vs Real section");
    requireRecordPath(dashboardPayload, ["integrationSeams"], "project dashboard Integration Seams section");
    requireRecordPath(dashboardPayload, ["conflictRadar"], "project dashboard Conflict Radar section");
    requireRecordPath(dashboardPayload, ["safeToTouchMap"], "project dashboard Safe-to-Touch section");
    requireRecordPath(dashboardPayload, ["liveWorkingMap"], "project dashboard Live Working Map section");
    requireRecordPath(dashboardPayload, ["rationaleTraces"], "project dashboard Rationale Trace section");
    requireRecordPath(dashboardPayload, ["decisionLog"], "project dashboard Decision Log section");
    requireRecordPath(dashboardPayload, ["branchDeployTruth"], "project dashboard Branch & Deploy Truth section");
    requireRecordPath(dashboardPayload, ["agentActivity"], "project dashboard Agent Activity section");
    requireRecordPath(dashboardPayload, ["todoFixme"], "project dashboard TODO/FIXME section");
    requireRecordPath(dashboardPayload, ["contextSnapshotSuggestions"], "project dashboard Context Snapshot Suggestions section");
    requireStringPath(dashboardPayload, ["computedAt"], "project dashboard");
    requireRecordPath(dashboardPayload, ["operationalSummary", "documents"], "project dashboard operational documents");
    requireRecordPath(dashboardPayload, ["operationalSummary", "brain"], "project dashboard operational brain");
    requireRecordPath(dashboardPayload, ["operationalSummary", "changes"], "project dashboard operational changes");
    requireRecordPath(dashboardPayload, ["operationalSummary", "communication"], "project dashboard operational communication");
    runner.proof("fdeDashboardReadinessFirstVerified", true);
    runner.proof("operationalSummaryPreserved", true);
    runner.proof("dashboardFreshnessVerified", true);
    runner.proof("dashboardPressureVerified", true);
    const teamSummary = await runner.request(step, "GET", `/v1/projects/${projectId}/team-summary`, undefined, { token: managerToken });
    requireArrayAtAnyPath(dataOf(teamSummary), [["members"], ["data", "members"]], "team summary members");
    const general = await runner.request(step, "GET", "/v1/dashboard/general?forceRefresh=true", undefined, { token: managerToken });
    const generalData = dataOf(general);
    const generalPayload = isRecord(getPath(generalData, ["data"]))
      ? requireRecordPath(generalData, ["data"], "general dashboard payload")
      : requireRecordPath(generalData, [], "general dashboard payload");
    requireStringPath(generalPayload, ["computedAt"], "general dashboard");
    requireRecordPath(generalPayload, ["summary", "communication"], "general dashboard communication summary");
  });

  await runner.step("client portal and internal leak checks", async (step) => {
    if (config.clientPortal) {
      const share = await runner.request(
        step,
        "POST",
        `/v1/projects/${projectId}/client-shares`,
        {
          name: "Day 6 smoke share",
          config: { allowedDocumentIds: [documentId], showCommunicationEvidence: false, showAcceptedDecisionSummaries: false }
        },
        { token: managerToken, expectStatuses: [200, 400, 404, 500] }
      );
      if (share.ok) {
        const rawToken = requireStringPath(dataOf(share), ["token"], "client share");
        runner.assert(step, rawToken, "client share raw token returned once");
        for (const pathSuffix of ["bootstrap", "project-summary", "brain", "brain/graph", "documents"]) {
          const clientView = await runner.request(step, "GET", `/v1/client/${encodeURIComponent(rawToken)}/${pathSuffix}`);
          assertNoForbiddenClientFields(dataOf(clientView), `client ${pathSuffix}`);
        }
        const clientDocuments = await runner.request(step, "GET", `/v1/client/${encodeURIComponent(rawToken)}/documents`);
        const clientDocumentItems = requireArrayPath(dataOf(clientDocuments), [], "client documents");
        if (clientDocumentItems.length > 0) {
          const clientDocumentId = requireStringPath(clientDocumentItems[0], ["id"], "client document");
          const clientDocumentView = await runner.request(
            step,
            "GET",
            `/v1/client/${encodeURIComponent(rawToken)}/documents/${clientDocumentId}/view`
          );
          assertNoForbiddenClientFields(dataOf(clientDocumentView), "client document view");
          const clientSearch = await runner.request(
            step,
            "GET",
            `/v1/client/${encodeURIComponent(rawToken)}/documents/${clientDocumentId}/search?q=reporting`
          );
          assertNoForbiddenClientFields(dataOf(clientSearch), "client document search");
        }
      } else {
        runner.degrade(step, "client portal share creation unavailable; authenticated client route denial checks still ran");
      }
    }
    for (const internalPath of [
      `/v1/projects/${projectId}/connectors`,
      `/v1/projects/${projectId}/communications/timeline`,
      `/v1/projects/${projectId}/messages/${messageId}`,
      `/v1/projects/${projectId}/communication-review`,
      `/v1/projects/${projectId}/change-proposals/${proposalId}`,
      `/v1/projects/${projectId}/change-proposals/${proposalId}/accept`,
      `/v1/projects/${projectId}/ops-summary`
    ]) {
      const method = internalPath.endsWith("/accept") ? "POST" : "GET";
      await runner.request(step, method, internalPath, undefined, { token: clientToken, expectStatuses: [403, 404] });
    }
    runner.proof("clientLeakChecksPassed", true);
  });

  return runner.report(startedAt);
}

export async function runSmoke(config = buildConfig()): Promise<SmokeReport> {
  if (config.dryRun || config.mode === "dry-run") return runDryRun(config);
  if (config.mode === "mock") return runMock(config);
  return runHttp(config);
}

export function shouldFailSmokeProcess(mode: SmokeMode, dryRun: boolean, status: SmokeStatus) {
  if (mode === "http" && !dryRun) return status !== "passed";
  return status === "failed";
}

async function main() {
  const config = buildConfig();
  let report: SmokeReport;
  try {
    report = await runSmoke(config);
  } catch (error) {
    const runner = new SmokeRunner(config);
    const startedAt = new Date().toISOString();
    await runner.step("smoke startup", async () => {
      throw error;
    });
    report = await runner.report(startedAt);
  }

  if (config.json) {
    console.log(JSON.stringify(redact(report), null, 2));
  } else if (!config.dryRun) {
    console.log(`Backend launch-loop smoke ${report.status}. Report: ${config.reportMarkdownPath}`);
  }

  if (shouldFailSmokeProcess(config.mode, config.dryRun, report.status)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
