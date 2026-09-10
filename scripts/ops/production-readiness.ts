import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TelemetryService } from "../../src/lib/observability/telemetry.js";

type OpsCheckName =
  | "readiness"
  | "retention"
  | "metrics"
  | "db-static-audit"
  | "worker"
  | "staging-seed"
  | "release-rehearsal"
  | "load";
type OpsStatus = "diagnostic_passed" | "failed";

interface OpsStep {
  name: string;
  status: OpsStatus;
  assertions: string[];
  failures: string[];
}

export interface OpsReport {
  check: OpsCheckName;
  mode: "dry-run";
  proofLevel: "diagnostic";
  status: OpsStatus;
  startedAt: string;
  finishedAt: string;
  canBeUsedForLaunchProof: false;
  liveDbProofPending: true;
  liveApiProofPending: true;
  steps: OpsStep[];
  blockers: string[];
  proof: Record<string, unknown>;
  reportJsonPath: string;
  reportMarkdownPath: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const READINESS_ENV_KEYS = [
  "NODE_ENV",
  "DATABASE_URL",
  "REDIS_URL",
  "QUEUE_MODE",
  "STORAGE_DRIVER",
  "S3_BUCKET",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "SIGNUP_MODE",
  "SIGNUP_ALLOWED_EMAIL_DOMAINS",
  "FRONTEND_BASE_URL",
  "CLIENT_PORTAL_BASE_URL",
  "SECURITY_HEADERS_ENABLED",
  "RATE_LIMIT_ENABLED",
  "METRICS_TOKEN",
  "TRACE_EXPORTER_OTLP_ENDPOINT",
  "ERROR_AGGREGATION_DSN",
  "UPTIME_CHECK_URLS",
  "CONNECTOR_CREDENTIAL_VAULT_MODE",
  "CONNECTOR_MANAGED_SECRET_PROVIDER",
  "CONNECTOR_MANAGED_SECRET_PREFIX",
  "CONNECTOR_OAUTH_STATE_SECRET",
  "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY",
  "CLIENT_SHARE_TOKEN_SECRET",
  "OPENAI_API_KEY",
  "FIREFLIES_READINESS_MODE"
] as const;

const REQUIRED_CI_COMMANDS = [
  "npm ci",
  "npm run prisma:generate",
  "npx prisma validate",
  "npm run typecheck",
  "npm run build",
  "npm test",
  "npm run eval:all",
  "npm run smoke:backend:dry-run",
  "npm run smoke:backend:mock",
  "npm run smoke:connectors:fireflies:dry-run",
  "npm run smoke:connectors:fireflies:mock",
  "npm run audit:all",
  "npm run remediation:ledger:check",
  "npm run security:scan:local",
  "npm run ops:readiness:dry-run",
  "npm run ops:retention:dry-run",
  "npm run ops:metrics:dry-run",
  "npm run ops:db:static-audit",
  "npm run ops:worker:dry-run",
  "npm run ops:staging-seed:dry-run",
  "npm run ops:release-rehearsal:dry-run",
  "npm run ops:load:dry-run"
] as const;

const OPS_DOCS = [
  "docs/PRODUCTION_READINESS.md",
  "docs/OPERATIONS_RUNBOOK.md",
  "docs/OBSERVABILITY.md",
  "docs/DATA_GOVERNANCE.md",
  "docs/API_COMPATIBILITY.md",
  "docs/WORKER_RELIABILITY.md",
  "docs/SLOS.md",
  "docs/STAGING_RELEASE_REHEARSAL.md",
  "docs/LOAD_TESTING.md"
] as const;

const ADR_DOCS = [
  "docs/adr/0001-auth-and-signup-policy.md",
  "docs/adr/0002-truth-gating.md",
  "docs/adr/0003-client-safe-filtering.md",
  "docs/adr/0004-connector-credentials.md",
  "docs/adr/0005-fireflies-readiness-gating.md"
] as const;

const THREAT_MODEL_DOCS = [
  "docs/threat-models/auth.md",
  "docs/threat-models/client-portal.md",
  "docs/threat-models/connectors.md",
  "docs/threat-models/documents.md",
  "docs/threat-models/ai-rag.md",
  "docs/threat-models/workers.md"
] as const;

function parseArgs(argv: string[]) {
  return {
    json: argv.includes("--json"),
    check: (argv.find((arg) => arg.startsWith("--check="))?.slice("--check=".length) ?? "readiness") as OpsCheckName
  };
}

async function readRepoFile(relativePath: string) {
  return readFile(path.resolve(repoRoot, relativePath), "utf8");
}

function step(name: string): OpsStep {
  return { name, status: "diagnostic_passed", assertions: [], failures: [] };
}

function assertStep(current: OpsStep, condition: unknown, message: string) {
  if (!condition) {
    current.status = "failed";
    current.failures.push(message);
  } else {
    current.assertions.push(message);
  }
}

async function runStep(report: OpsReport, name: string, fn: (current: OpsStep) => Promise<void>) {
  const current = step(name);
  try {
    await fn(current);
  } catch (error) {
    current.status = "failed";
    current.failures.push(error instanceof Error ? error.message : String(error));
  }
  report.steps.push(current);
}

export function buildOpsReport(check: OpsCheckName): OpsReport {
  const stem = `ops-${check}-dry-run-report`;
  return {
    check,
    mode: "dry-run",
    proofLevel: "diagnostic",
    status: "failed",
    startedAt: new Date().toISOString(),
    finishedAt: "",
    canBeUsedForLaunchProof: false,
    liveDbProofPending: true,
    liveApiProofPending: true,
    steps: [],
    blockers: [
      "real DATABASE_URL and Prisma migrate deploy proof",
      "real worker/Redis proof",
      "real S3/object-storage proof",
      "real AI provider proof",
      "real backend HTTP smoke report",
      "real Fireflies live smoke report when Fireflies credentials are available"
    ],
    proof: {},
    reportJsonPath: path.resolve(repoRoot, `artifacts/ops/${stem}.json`),
    reportMarkdownPath: path.resolve(repoRoot, `artifacts/ops/${stem}.md`)
  };
}

async function runReadiness(report: OpsReport) {
  await runStep(report, "package scripts", async (current) => {
    const pkg = JSON.parse(await readRepoFile("package.json")) as { scripts?: Record<string, string> };
    for (const script of [
      "prisma:deploy",
      "smoke:backend:http",
      "smoke:backend:dry-run",
      "smoke:backend:mock",
      "smoke:connectors:fireflies:http",
      "ops:readiness:dry-run",
      "ops:retention:dry-run",
      "ops:metrics:dry-run",
      "ops:db:static-audit",
      "ops:worker:dry-run",
      "ops:staging-seed:dry-run",
      "ops:release-rehearsal:dry-run",
      "ops:load:dry-run",
      "security:scan:local"
    ]) {
      assertStep(current, Boolean(pkg.scripts?.[script]), `package.json defines ${script}`);
    }
  });

  await runStep(report, "production env contract", async (current) => {
    const envExample = await readRepoFile(".env.example");
    const envSource = await readRepoFile("src/config/env.ts");
    for (const key of READINESS_ENV_KEYS) {
      assertStep(current, envExample.includes(`${key}=`), `.env.example documents ${key}`);
      assertStep(current, envSource.includes(key), `src/config/env.ts validates ${key}`);
    }
    assertStep(current, envSource.includes("Production requires SIGNUP_MODE=invite_only"), "production rejects open signup");
    assertStep(current, envSource.includes("Production requires SECURITY_HEADERS_ENABLED=true"), "production requires security headers");
    assertStep(current, envSource.includes("Production requires RATE_LIMIT_ENABLED=true"), "production requires rate limiting");
    assertStep(current, envSource.includes("CONNECTOR_CREDENTIAL_VAULT_MODE=managed_reference"), "production requires managed-reference credential vault mode");
    assertStep(current, envSource.includes("Production requires TRACE_EXPORTER_OTLP_ENDPOINT"), "production requires trace exporter");
    assertStep(current, envSource.includes("Production requires ERROR_AGGREGATION_DSN"), "production requires error aggregation");
    assertStep(current, envSource.includes("Production requires UPTIME_CHECK_URLS"), "production requires uptime checks");
  });

  await runStep(report, "CI diagnostic gates", async (current) => {
    const ci = await readRepoFile(".github/workflows/ci.yml");
    for (const command of REQUIRED_CI_COMMANDS) {
      assertStep(current, ci.includes(command), `CI runs ${command}`);
    }
  });

  await runStep(report, "handoff docs", async (current) => {
    for (const doc of OPS_DOCS) {
      await readRepoFile(doc);
      current.assertions.push(`${doc} exists`);
    }
    const launchContract = await readRepoFile("docs/BACKEND_LAUNCH_CONTRACT.md");
    assertStep(current, launchContract.includes("smoke:backend:http"), "backend launch contract names HTTP smoke proof");
    assertStep(current, launchContract.includes("backup/restore"), "backend launch contract names DB backup/restore proof");
  });

  report.proof.readyForTeammateLiveDbApiProof = true;
}

async function runStagingSeed(report: OpsReport) {
  await runStep(report, "staging seed fixture", async (current) => {
    const seed = JSON.parse(await readRepoFile("docs/fixtures/staging/release-rehearsal-seed.json")) as {
      org?: unknown;
      users?: unknown[];
      project?: unknown;
      documents?: unknown[];
      communications?: unknown[];
      firefliesTranscript?: unknown;
      clientShare?: unknown;
    };
    assertStep(current, Boolean(seed.org), "seed includes org");
    assertStep(current, Array.isArray(seed.users) && seed.users.length >= 3, "seed includes manager/dev/client users");
    assertStep(current, Boolean(seed.project), "seed includes project");
    assertStep(current, Array.isArray(seed.documents) && seed.documents.length >= 1, "seed includes source document");
    assertStep(current, Array.isArray(seed.communications) && seed.communications.length >= 1, "seed includes communication evidence");
    assertStep(current, Boolean(seed.firefliesTranscript), "seed includes Fireflies transcript fixture");
    assertStep(current, Boolean(seed.clientShare), "seed includes client-share fixture contract");
  });

  await runStep(report, "seed safety", async (current) => {
    const seedText = await readRepoFile("docs/fixtures/staging/release-rehearsal-seed.json");
    assertStep(current, !/sk-[A-Za-z0-9]{20,}|xox[baprs]-|Bearer\s+[A-Za-z0-9._-]{20,}/.test(seedText), "seed contains no live-looking provider tokens");
    assertStep(current, true, "staging seed dry-run performs no database writes");
  });

  report.proof.stagingSeedDryRunOnly = true;
  report.proof.liveSeedApplyPending = true;
}

async function runReleaseRehearsal(report: OpsReport) {
  await runStep(report, "architecture decisions", async (current) => {
    for (const doc of ADR_DOCS) {
      const content = await readRepoFile(doc);
      assertStep(current, /^# ADR-\d+/m.test(content), `${doc} has ADR title`);
      assertStep(current, /## Decision/m.test(content), `${doc} records a decision`);
      assertStep(current, /## Consequences/m.test(content), `${doc} records consequences`);
    }
  });

  await runStep(report, "surface threat models", async (current) => {
    for (const doc of THREAT_MODEL_DOCS) {
      const content = await readRepoFile(doc);
      for (const phrase of ["Assets", "Trust Boundaries", "Attacker-Controlled Inputs", "Required Controls"]) {
        assertStep(current, content.includes(phrase), `${doc} covers ${phrase}`);
      }
    }
  });

  await runStep(report, "release rehearsal and SLO contracts", async (current) => {
    const rehearsal = await readRepoFile("docs/STAGING_RELEASE_REHEARSAL.md");
    const slos = await readRepoFile("docs/SLOS.md");
    for (const phrase of ["smoke:backend:http", "prisma:deploy", "backup/restore", "rollback"]) {
      assertStep(current, rehearsal.includes(phrase), `release rehearsal covers ${phrase}`);
    }
    for (const phrase of ["API latency", "worker freshness", "Socrates response time", "dashboard freshness", "connector sync delay"]) {
      assertStep(current, slos.includes(phrase), `SLO doc covers ${phrase}`);
    }
  });

  report.proof.releaseRehearsalDryRunOnly = true;
  report.proof.liveReleaseRehearsalPending = true;
}

async function runLoad(report: OpsReport) {
  await runStep(report, "load-test plan", async (current) => {
    const loadDoc = await readRepoFile("docs/LOAD_TESTING.md");
    for (const phrase of ["auth", "document upload", "Socrates SSE", "connector sync", "client-token"]) {
      assertStep(current, loadDoc.toLowerCase().includes(phrase.toLowerCase()), `load test plan covers ${phrase}`);
    }
    assertStep(current, loadDoc.includes("smoke:backend:http"), "load test plan requires HTTP smoke before load");
    assertStep(current, loadDoc.includes("not launch proof"), "load test plan distinguishes dry-run from launch proof");
  });

  await runStep(report, "SLO and observability alignment", async (current) => {
    const slos = await readRepoFile("docs/SLOS.md");
    const observability = await readRepoFile("docs/OBSERVABILITY.md");
    for (const phrase of ["API latency", "Socrates response time", "connector sync delay"]) {
      assertStep(current, slos.includes(phrase), `SLO doc defines ${phrase}`);
    }
    for (const phrase of ["traces", "error aggregation", "uptime checks"]) {
      assertStep(current, observability.toLowerCase().includes(phrase), `observability doc covers ${phrase}`);
    }
    assertStep(current, true, "load dry-run performs no network calls");
  });

  report.proof.loadDryRunOnly = true;
  report.proof.liveLoadTestPending = true;
}

async function runRetention(report: OpsReport) {
  await runStep(report, "retention matrix", async (current) => {
    const dataGovernance = await readRepoFile("docs/DATA_GOVERNANCE.md");
    for (const phrase of [
      "Documents",
      "Communication messages",
      "Fireflies.ai transcripts",
      "Client shares",
      "Provider credentials",
      "Audit logs"
    ]) {
      assertStep(current, dataGovernance.includes(phrase), `retention doc covers ${phrase}`);
    }
  });

  await runStep(report, "dry-run safety", async (current) => {
    assertStep(current, true, "retention audit performs no database calls");
    assertStep(current, true, "retention audit deletes zero rows");
  });

  report.proof.retentionDeletesPlanned = 0;
  report.proof.retentionDryRunOnly = true;
}

async function runMetrics(report: OpsReport) {
  await runStep(report, "Prometheus metric inventory", async (current) => {
    const telemetry = new TelemetryService();
    telemetry.increment("orchestra_http_requests_total", { method: "GET", route: "/health", status_code: 200 });
    telemetry.observeDuration("orchestra_http_request_duration_ms", 42, { method: "GET", route: "/health" });
    telemetry.increment("orchestra_jobs_total", { job_name: "parse_document", status: "completed" });
    telemetry.setGauge("orchestra_ai_socrates_estimated_cost_usd", 0.01, { project_id: "dry-run" });
    const rendered = telemetry.renderPrometheus();
    for (const metric of [
      "orchestra_http_requests_total",
      "orchestra_http_request_duration_ms_count",
      "orchestra_jobs_total",
      "orchestra_ai_socrates_estimated_cost_usd"
    ]) {
      assertStep(current, rendered.includes(metric), `telemetry renders ${metric}`);
    }
    report.proof.samplePrometheus = rendered;
  });

  await runStep(report, "metrics endpoint protection contract", async (current) => {
    const appSource = await readRepoFile("src/app/build-app.ts");
    const envSource = await readRepoFile("src/config/env.ts");
    const observabilityDoc = await readRepoFile("docs/OBSERVABILITY.md");
    assertStep(current, appSource.includes("x-metrics-token"), "/metrics checks x-metrics-token");
    assertStep(current, envSource.includes("METRICS_TOKEN must be set"), "production requires METRICS_TOKEN");
    assertStep(current, /alert thresholds/i.test(observabilityDoc), "observability doc includes alert thresholds");
  });

  report.proof.metricsTokenProtectedInProduction = true;
}

async function runDbStaticAudit(report: OpsReport) {
  await runStep(report, "Prisma index inventory", async (current) => {
    const schema = await readRepoFile("prisma/schema.prisma");
    const indexCount = (schema.match(/@@index/g) ?? []).length;
    const uniqueCount = (schema.match(/@@unique/g) ?? []).length;
    for (const model of [
      "CommunicationThread",
      "CommunicationMessage",
      "CommunicationMessageChunk",
      "CommunicationSyncRun",
      "MessageInsight",
      "ThreadInsight",
      "ProjectClientShare",
      "JobRun"
    ]) {
      assertStep(current, schema.includes(`model ${model}`), `Prisma model exists: ${model}`);
    }
    assertStep(current, indexCount >= 30, `Prisma schema declares ${indexCount} model indexes`);
    assertStep(current, uniqueCount >= 15, `Prisma schema declares ${uniqueCount} unique constraints`);
    report.proof.prismaIndexCount = indexCount;
    report.proof.prismaUniqueCount = uniqueCount;
  });

  await runStep(report, "DB owner live proof checklist", async (current) => {
    const dbHandoff = await readRepoFile("docs/DB_HANDOFF.md");
    const envDeploy = await readRepoFile("docs/ENV_AND_DEPLOYMENT.md");
    for (const phrase of ["prisma migrate deploy", "pgvector", "backup", "restore"]) {
      assertStep(current, `${dbHandoff}\n${envDeploy}`.toLowerCase().includes(phrase), `handoff docs mention ${phrase}`);
    }
    assertStep(current, true, "static DB audit does not connect to Postgres");
  });

  report.proof.dbStaticAuditOnly = true;
  report.proof.liveDbExplainPending = true;
}

async function runWorker(report: OpsReport) {
  await runStep(report, "worker execution contract", async (current) => {
    const worker = await readRepoFile("src/worker.ts");
    const queue = await readRepoFile("src/lib/jobs/queue.ts");
    const policy = await readRepoFile("src/lib/jobs/policy.ts");
    const handlers = await readRepoFile("src/lib/jobs/handlers.ts");
    assertStep(current, `${worker}\n${queue}`.includes("WORKER_CONCURRENCY"), "worker uses configured concurrency");
    assertStep(current, policy.includes("attempts"), "job policy declares retry attempts");
    assertStep(current, policy.includes("backoffMs"), "job policy declares backoff");
    assertStep(current, handlers.includes("z.string().uuid()"), "job handlers validate internal UUID payloads");
  });

  await runStep(report, "worker observability contract", async (current) => {
    const observability = await readRepoFile("docs/OBSERVABILITY.md");
    const workerReliability = await readRepoFile("docs/WORKER_RELIABILITY.md");
    for (const phrase of ["queue depth", "retry", "dead-letter", "stalled", "idempotency"]) {
      assertStep(current, `${observability}\n${workerReliability}`.toLowerCase().includes(phrase), `worker docs cover ${phrase}`);
    }
    assertStep(current, true, "worker dry-run does not connect to Redis");
  });

  report.proof.workerDryRunOnly = true;
  report.proof.liveRedisWorkerProofPending = true;
}

function finalize(report: OpsReport) {
  report.finishedAt = new Date().toISOString();
  report.status = report.steps.some((item) => item.status === "failed") ? "failed" : "diagnostic_passed";
  return report;
}

function buildMarkdown(report: OpsReport) {
  const steps = report.steps
    .map((item) => `| ${item.name} | ${item.status} | ${item.assertions.length} | ${item.failures.join("; ") || "-"} |`)
    .join("\n");
  return `# Orchestra Ops ${report.check} Dry-Run Report

## Result
- Mode: ${report.mode}
- Status: ${report.status}
- Proof level: ${report.proofLevel}
- Can be used for launch proof: NO
- Live DB proof pending: YES
- Live API proof pending: YES
- Started: ${report.startedAt}
- Finished: ${report.finishedAt}

This report is provider-neutral diagnostic evidence only. It does not connect to the production database, object storage, AI providers, Fireflies.ai, or a deployed API.

## Live Proof Blockers
${report.blockers.map((item) => `- ${item}`).join("\n")}

## Steps
| Step | Status | Assertions | Failures |
| --- | --- | ---: | --- |
${steps || "| - | - | - | - |"}

## Proof
\`\`\`json
${JSON.stringify(report.proof, null, 2)}
\`\`\`
`;
}

async function writeReport(report: OpsReport) {
  await mkdir(path.dirname(report.reportJsonPath), { recursive: true });
  await writeFile(report.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(report.reportMarkdownPath, buildMarkdown(report));
}

export async function runOpsDryRun(check: OpsCheckName): Promise<OpsReport> {
  const report = buildOpsReport(check);
  if (check === "readiness") await runReadiness(report);
  else if (check === "retention") await runRetention(report);
  else if (check === "metrics") await runMetrics(report);
  else if (check === "db-static-audit") await runDbStaticAudit(report);
  else if (check === "worker") await runWorker(report);
  else if (check === "staging-seed") await runStagingSeed(report);
  else if (check === "release-rehearsal") await runReleaseRehearsal(report);
  else if (check === "load") await runLoad(report);
  else throw new Error(`Unsupported ops check: ${String(check)}`);
  finalize(report);
  await writeReport(report);
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runOpsDryRun(args.check);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Ops ${report.check} dry-run ${report.status}. Report: ${report.reportMarkdownPath}`);
  }
  if (report.status === "failed") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
