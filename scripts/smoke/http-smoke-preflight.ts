import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type PreflightMode = "preflight";
type PreflightProofLevel = "readiness_check";

export interface HttpSmokePreflightArgs {
  json: boolean;
  verbose: boolean;
  allowLocalhost: boolean;
}

export interface CheckedUrl {
  name: string;
  url: string;
  ok: boolean;
  statusCode?: number;
  error?: string;
}

export interface RequiredEnvEntry {
  scope: "backend" | "mvp" | "shared";
  present: boolean;
  source?: string;
  note?: string;
}

export interface HttpSmokePreflightReport {
  mode: PreflightMode;
  proofLevel: PreflightProofLevel;
  canRunBackendHttpSmoke: boolean;
  canRunMvpHttpSmoke: boolean;
  blockingReasons: string[];
  warnings: string[];
  requiredEnv: Record<string, RequiredEnvEntry>;
  checkedUrls: CheckedUrl[];
  timestamp: string;
}

export interface HttpSmokePreflightConfig {
  allowLocalhost: boolean;
  json: boolean;
  verbose: boolean;
  timeoutMs: number;
  reportJsonPath: string;
  reportMarkdownPath: string;
  backend: {
    baseUrl?: string;
    managerEmail?: string;
    managerPassword?: string;
    devEmail?: string;
    devPassword?: string;
    clientEmail?: string;
    clientPassword?: string;
    clientPortal: boolean;
    documentPath: string;
    manualImportPath: string;
    expectAi: boolean;
    expectWorker: boolean;
  };
  mvp: {
    baseUrl?: string;
    managerEmail?: string;
    managerPassword?: string;
    devEmail?: string;
    devPassword?: string;
    clientEmail?: string;
    clientPassword?: string;
    expectAi: boolean;
    expectWorker: boolean;
    expectFirefliesLive: boolean;
  };
  metricsToken?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function nonBlank(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
}

function resolveRepoPath(value: string | undefined, fallback: string) {
  return path.resolve(repoRoot, value ?? fallback);
}

function normalizeBaseUrl(value: string | undefined) {
  return nonBlank(value)?.replace(/\/+$/, "");
}

function isLocalhostUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function parseArgs(argv = process.argv.slice(2)): HttpSmokePreflightArgs {
  const args: HttpSmokePreflightArgs = { json: false, verbose: false, allowLocalhost: false };
  for (const arg of argv) {
    if (arg === "--json") args.json = true;
    else if (arg === "--verbose") args.verbose = true;
    else if (arg === "--allow-localhost") args.allowLocalhost = true;
    else throw new Error(`Unsupported HTTP smoke preflight argument: ${arg}`);
  }
  return args;
}

export function reportPaths() {
  return {
    json: path.resolve(repoRoot, "artifacts", "smoke", "http-smoke-preflight-report.json"),
    markdown: path.resolve(repoRoot, "artifacts", "smoke", "http-smoke-preflight-report.md")
  };
}

export function buildHttpSmokePreflightConfig(
  env: NodeJS.ProcessEnv = process.env,
  args: HttpSmokePreflightArgs = parseArgs()
): HttpSmokePreflightConfig {
  const paths = reportPaths();
  const allowLocalhost = args.allowLocalhost || parseBoolean(env.SMOKE_ALLOW_LOCALHOST_HTTP, false);
  return {
    allowLocalhost,
    json: args.json,
    verbose: args.verbose,
    timeoutMs: Number(env.SMOKE_PREFLIGHT_TIMEOUT_MS ?? env.MVP_SMOKE_TIMEOUT_MS ?? env.SMOKE_TIMEOUT_MS ?? 10000),
    reportJsonPath: paths.json,
    reportMarkdownPath: paths.markdown,
    backend: {
      baseUrl: normalizeBaseUrl(env.SMOKE_BASE_URL),
      managerEmail: nonBlank(env.SMOKE_MANAGER_EMAIL),
      managerPassword: nonBlank(env.SMOKE_MANAGER_PASSWORD),
      devEmail: nonBlank(env.SMOKE_DEV_EMAIL),
      devPassword: nonBlank(env.SMOKE_DEV_PASSWORD),
      clientEmail: nonBlank(env.SMOKE_CLIENT_EMAIL),
      clientPassword: nonBlank(env.SMOKE_CLIENT_PASSWORD),
      clientPortal: parseBoolean(env.SMOKE_CLIENT_PORTAL, true),
      documentPath: resolveRepoPath(env.SMOKE_DOCUMENT_PATH, "docs/fixtures/smoke/launch-loop-prd.md"),
      manualImportPath: resolveRepoPath(env.SMOKE_MANUAL_IMPORT_PATH, "scripts/smoke/fixtures/manual-import-requirement-change.json"),
      expectAi: parseBoolean(env.SMOKE_EXPECT_AI, true),
      expectWorker: parseBoolean(env.SMOKE_EXPECT_WORKER, true)
    },
    mvp: {
      baseUrl: normalizeBaseUrl(env.MVP_SMOKE_BASE_URL ?? env.SMOKE_BASE_URL),
      managerEmail: nonBlank(env.MVP_SMOKE_MANAGER_EMAIL ?? env.SMOKE_MANAGER_EMAIL),
      managerPassword: nonBlank(env.MVP_SMOKE_MANAGER_PASSWORD ?? env.SMOKE_MANAGER_PASSWORD),
      devEmail: nonBlank(env.MVP_SMOKE_DEV_EMAIL ?? env.SMOKE_DEV_EMAIL),
      devPassword: nonBlank(env.MVP_SMOKE_DEV_PASSWORD ?? env.SMOKE_DEV_PASSWORD),
      clientEmail: nonBlank(env.MVP_SMOKE_CLIENT_EMAIL ?? env.SMOKE_CLIENT_EMAIL),
      clientPassword: nonBlank(env.MVP_SMOKE_CLIENT_PASSWORD ?? env.SMOKE_CLIENT_PASSWORD),
      expectAi: parseBoolean(env.MVP_SMOKE_EXPECT_AI ?? env.SMOKE_EXPECT_AI, true),
      expectWorker: parseBoolean(env.MVP_SMOKE_EXPECT_WORKER ?? env.SMOKE_EXPECT_WORKER, true),
      expectFirefliesLive: parseBoolean(env.MVP_SMOKE_EXPECT_FIREFLIES_LIVE, false)
    },
    metricsToken: nonBlank(env.METRICS_TOKEN)
  };
}

function requiredEnvEntry(scope: RequiredEnvEntry["scope"], present: boolean, source?: string, note?: string): RequiredEnvEntry {
  return { scope, present, ...(source ? { source } : {}), ...(note ? { note } : {}) };
}

async function probeUrl(config: HttpSmokePreflightConfig, name: string, url: string, init?: RequestInit): Promise<CheckedUrl> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(config.timeoutMs)
    });
    return { name, url, ok: response.status < 500, statusCode: response.status };
  } catch (error) {
    return { name, url, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function addMissing(blockingReasons: string[], scopedBlockers: string[], label: string) {
  const reason = `${label} is required before real HTTP smoke can run`;
  blockingReasons.push(reason);
  scopedBlockers.push(reason);
}

async function collectStaticReadiness(config: HttpSmokePreflightConfig) {
  const blockingReasons: string[] = [];
  const backendBlockers: string[] = [];
  const mvpBlockers: string[] = [];
  const warnings: string[] = [];
  const requiredEnv: Record<string, RequiredEnvEntry> = {};

  requiredEnv.SMOKE_BASE_URL = requiredEnvEntry("backend", Boolean(config.backend.baseUrl));
  if (!config.backend.baseUrl) addMissing(blockingReasons, backendBlockers, "SMOKE_BASE_URL");
  if (config.backend.baseUrl && isLocalhostUrl(config.backend.baseUrl) && !config.allowLocalhost) {
    const reason = "SMOKE_BASE_URL points to localhost; set SMOKE_ALLOW_LOCALHOST_HTTP=true only for an explicit local HTTP proof rehearsal";
    blockingReasons.push(reason);
    backendBlockers.push(reason);
  }

  for (const [key, value] of [
    ["SMOKE_MANAGER_EMAIL", config.backend.managerEmail],
    ["SMOKE_MANAGER_PASSWORD", config.backend.managerPassword],
    ["SMOKE_DEV_EMAIL", config.backend.devEmail],
    ["SMOKE_DEV_PASSWORD", config.backend.devPassword]
  ] as const) {
    requiredEnv[key] = requiredEnvEntry("backend", Boolean(value));
    if (!value) addMissing(blockingReasons, backendBlockers, key);
  }
  for (const [key, value] of [
    ["SMOKE_CLIENT_EMAIL", config.backend.clientEmail],
    ["SMOKE_CLIENT_PASSWORD", config.backend.clientPassword]
  ] as const) {
    requiredEnv[key] = requiredEnvEntry("backend", Boolean(value), undefined, config.backend.clientPortal ? undefined : "required only when SMOKE_CLIENT_PORTAL=true");
    if (config.backend.clientPortal && !value) addMissing(blockingReasons, backendBlockers, key);
  }

  requiredEnv.SMOKE_DOCUMENT_PATH = requiredEnvEntry("backend", await fileExists(config.backend.documentPath), "filesystem");
  if (!requiredEnv.SMOKE_DOCUMENT_PATH.present) {
    const reason = `SMOKE_DOCUMENT_PATH does not exist: ${config.backend.documentPath}`;
    blockingReasons.push(reason);
    backendBlockers.push(reason);
  }
  requiredEnv.SMOKE_MANUAL_IMPORT_PATH = requiredEnvEntry("backend", await fileExists(config.backend.manualImportPath), "filesystem");
  if (!requiredEnv.SMOKE_MANUAL_IMPORT_PATH.present) {
    const reason = `SMOKE_MANUAL_IMPORT_PATH does not exist: ${config.backend.manualImportPath}`;
    blockingReasons.push(reason);
    backendBlockers.push(reason);
  }
  requiredEnv.SMOKE_EXPECT_AI = requiredEnvEntry("backend", true, "optional flag", `current=${String(config.backend.expectAi)}`);
  requiredEnv.SMOKE_EXPECT_WORKER = requiredEnvEntry("backend", true, "optional flag", `current=${String(config.backend.expectWorker)}`);

  requiredEnv["MVP_SMOKE_BASE_URL or SMOKE_BASE_URL"] = requiredEnvEntry("mvp", Boolean(config.mvp.baseUrl));
  if (!config.mvp.baseUrl) addMissing(blockingReasons, mvpBlockers, "MVP_SMOKE_BASE_URL or SMOKE_BASE_URL");
  if (config.mvp.baseUrl && isLocalhostUrl(config.mvp.baseUrl) && !config.allowLocalhost) {
    const reason = "MVP_SMOKE_BASE_URL/SMOKE_BASE_URL points to localhost; set SMOKE_ALLOW_LOCALHOST_HTTP=true only for an explicit local HTTP proof rehearsal";
    blockingReasons.push(reason);
    mvpBlockers.push(reason);
  }

  for (const [key, value] of [
    ["MVP_SMOKE_MANAGER_EMAIL or SMOKE_MANAGER_EMAIL", config.mvp.managerEmail],
    ["MVP_SMOKE_MANAGER_PASSWORD or SMOKE_MANAGER_PASSWORD", config.mvp.managerPassword],
    ["MVP_SMOKE_DEV_EMAIL or SMOKE_DEV_EMAIL", config.mvp.devEmail],
    ["MVP_SMOKE_DEV_PASSWORD or SMOKE_DEV_PASSWORD", config.mvp.devPassword],
    ["MVP_SMOKE_CLIENT_EMAIL or SMOKE_CLIENT_EMAIL", config.mvp.clientEmail],
    ["MVP_SMOKE_CLIENT_PASSWORD or SMOKE_CLIENT_PASSWORD", config.mvp.clientPassword]
  ] as const) {
    requiredEnv[key] = requiredEnvEntry("mvp", Boolean(value));
    if (!value) addMissing(blockingReasons, mvpBlockers, key);
  }
  requiredEnv.MVP_SMOKE_EXPECT_AI = requiredEnvEntry("mvp", true, "optional flag", `current=${String(config.mvp.expectAi)}`);
  requiredEnv.MVP_SMOKE_EXPECT_WORKER = requiredEnvEntry("mvp", true, "optional flag", `current=${String(config.mvp.expectWorker)}`);
  requiredEnv.MVP_SMOKE_EXPECT_FIREFLIES_LIVE = requiredEnvEntry("mvp", true, "optional flag", `current=${String(config.mvp.expectFirefliesLive)}`);

  if (!config.metricsToken) {
    warnings.push("METRICS_TOKEN is not set for preflight; /metrics reachability was not checked");
  }

  warnings.push("Preflight is a readiness check only; it is not launch proof and does not replace HTTP smoke reports");
  return { blockingReasons, backendBlockers, mvpBlockers, warnings, requiredEnv };
}

export async function runHttpSmokePreflight(config = buildHttpSmokePreflightConfig()): Promise<HttpSmokePreflightReport> {
  const { blockingReasons, backendBlockers, mvpBlockers, warnings, requiredEnv } = await collectStaticReadiness(config);
  const checkedUrls: CheckedUrl[] = [];
  const probeBase = async (scope: "backend" | "mvp", baseUrl: string, scopedBlockers: string[]) => {
    const checks = [
      await probeUrl(config, `${scope}_health`, `${baseUrl}/health`),
      await probeUrl(config, `${scope}_login_route`, `${baseUrl}/v1/auth/login`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ email: "preflight.invalid@example.invalid", password: "invalid-preflight-password" })
      })
    ];
    if (config.metricsToken) {
      checks.push(
        await probeUrl(config, `${scope}_metrics`, `${baseUrl}/metrics`, {
          headers: { "x-metrics-token": config.metricsToken }
        })
      );
    }
    checkedUrls.push(...checks);
    for (const check of checks) {
      if (!check.ok) {
        const reason = `${check.name} check failed for ${check.url}${check.error ? `: ${check.error}` : ""}`;
        blockingReasons.push(reason);
        scopedBlockers.push(reason);
      }
    }
  };

  if (backendBlockers.length === 0 && config.backend.baseUrl) {
    await probeBase("backend", config.backend.baseUrl, backendBlockers);
  } else {
    warnings.push("Backend HTTP probes were skipped because backend preflight blockers were found");
  }

  if (mvpBlockers.length === 0 && config.mvp.baseUrl) {
    await probeBase("mvp", config.mvp.baseUrl, mvpBlockers);
  } else {
    warnings.push("MVP HTTP probes were skipped because MVP preflight blockers were found");
  }

  const report: HttpSmokePreflightReport = {
    mode: "preflight",
    proofLevel: "readiness_check",
    canRunBackendHttpSmoke: backendBlockers.length === 0,
    canRunMvpHttpSmoke: mvpBlockers.length === 0,
    blockingReasons: Array.from(new Set(blockingReasons)),
    warnings: Array.from(new Set(warnings)),
    requiredEnv,
    checkedUrls,
    timestamp: new Date().toISOString()
  };
  if (config.verbose) console.log(JSON.stringify(report, null, 2));
  return report;
}

export function buildPreflightMarkdown(report: HttpSmokePreflightReport) {
  return [
    "# HTTP Smoke Preflight Report",
    "",
    `- Mode: ${report.mode}`,
    `- Proof level: ${report.proofLevel}`,
    `- Backend HTTP smoke ready: ${report.canRunBackendHttpSmoke ? "YES" : "NO"}`,
    `- MVP HTTP smoke ready: ${report.canRunMvpHttpSmoke ? "YES" : "NO"}`,
    `- Timestamp: ${report.timestamp}`,
    "",
    "This is a readiness check only. It is not launch proof. Dry-run/mock smoke reports are diagnostics only.",
    "",
    "## Blocking Reasons",
    "",
    report.blockingReasons.length ? report.blockingReasons.map((reason) => `- ${reason}`).join("\n") : "None.",
    "",
    "## Warnings",
    "",
    report.warnings.length ? report.warnings.map((warning) => `- ${warning}`).join("\n") : "None.",
    "",
    "## Checked URLs",
    "",
    report.checkedUrls.length
      ? report.checkedUrls.map((check) => `- ${check.name}: ${check.url} -> ${check.ok ? "ok" : "blocked"}${check.statusCode ? ` (${check.statusCode})` : ""}${check.error ? ` (${check.error})` : ""}`).join("\n")
      : "None.",
    "",
    "## Required Environment",
    "",
    ...Object.entries(report.requiredEnv).map(([key, value]) => `- ${key}: ${value.present ? "present" : "missing"} (${value.scope}${value.note ? `; ${value.note}` : ""})`)
  ].join("\n");
}

export async function writePreflightReport(config: HttpSmokePreflightConfig, report: HttpSmokePreflightReport) {
  await mkdir(path.dirname(config.reportJsonPath), { recursive: true });
  await writeFile(config.reportJsonPath, JSON.stringify(report, null, 2));
  await writeFile(config.reportMarkdownPath, buildPreflightMarkdown(report));
  return report;
}

async function main() {
  const config = buildHttpSmokePreflightConfig();
  const report = await writePreflightReport(config, await runHttpSmokePreflight(config));
  if (config.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`HTTP smoke preflight ${report.blockingReasons.length ? "environment-blocked" : "ready"}. Report: ${config.reportMarkdownPath}`);
  }
  if (report.blockingReasons.length > 0) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
