import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Feature13Profile = "main" | "mvp";
type GateStatus = "passed" | "diagnostic_passed" | "blocked" | "failed";
type StepStatus = "passed" | "failed";

export interface Feature13GateOptions {
  profile?: Feature13Profile;
  allowMissingLiveDb?: boolean;
  json?: boolean;
}

export interface Feature13GateStep {
  name: string;
  status: StepStatus;
  assertions: string[];
  failures: string[];
}

export interface Feature13ReleaseGateReport {
  feature: "feature13_github_fde_readiness_dashboard";
  profile: Feature13Profile;
  status: GateStatus;
  canBeUsedForLaunchProof: boolean;
  liveDbProofRequired: true;
  liveHttpSmokeRequired: true;
  generatedAt: string;
  steps: Feature13GateStep[];
  blockers: string[];
  warnings: string[];
  proof: Record<string, unknown>;
  reportJsonPath: string;
  reportMarkdownPath: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const REQUIRED_MODELS = [
  "GitHubInstallation",
  "GitHubRepository",
  "GitHubRepositoryProjectLink",
  "GitHubWebhookEvent",
  "GitHubSyncRun",
  "EngineeringEvidenceItem",
  "EngineeringEvidenceManualEntry",
  "FdeReadinessFinding",
  "FdeRationaleTrace",
  "FdeRationaleTraceHop",
  "FdeDecisionEngineeringLink",
  "AgentContextPack",
  "AgentRun",
  "AgentMarkdownFileSet",
  "McpToken",
  "DashboardSnapshot"
];

const REQUIRED_DOCS = [
  "docs/API_SPEC.md",
  "docs/FRONTEND_CONTRACT.md",
  "docs/FDE_READINESS_DASHBOARD.md",
  "docs/EVALS.md",
  "docs/SOCRATES_RAG_SPEC.md",
  "docs/ORCHESTRA_MCP_SERVER.md",
  "docs/PRODUCT_BRAIN_AGENT_FILES.md",
  "docs/schema.md"
];

const REQUIRED_TEST_HINTS = [
  "dashboardKind",
  "fde_readiness",
  "operationalSummary",
  "context snapshot",
  "no GitHub writes",
  "product_brain",
  "live_doc"
];

const FORBIDDEN_FEATURE13_WRITE_PATTERNS = [
  /pulls\.create/i,
  /repos\.createOrUpdateFileContents/i,
  /git\.createRef/i,
  /issues\.createComment/i,
  /pulls\.requestReviewers/i,
  /pulls\.merge/i,
  /enableAutoMerge/i,
  /createDeployment/i,
  /triggerDeployment/i,
  /applyAcceptedProposal/i,
  /acceptProposal/i,
  /rejectProposal/i,
  /decisionRecord\.create/i,
  /liveDocService\.(update|generate|apply)/i,
  /brainService\.(update|rebuild|apply)/i
];

const SECRET_PATTERN =
  /\b(gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{12,}|mcp_[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/i;

function parseArgs(argv: string[]): Feature13GateOptions {
  return {
    profile: (argv.find((arg) => arg.startsWith("--profile="))?.slice("--profile=".length) as Feature13Profile | undefined) ?? "main",
    allowMissingLiveDb: argv.includes("--allow-missing-live-db"),
    json: argv.includes("--json")
  };
}

function newStep(name: string): Feature13GateStep {
  return { name, status: "passed", assertions: [], failures: [] };
}

function assertStep(step: Feature13GateStep, condition: unknown, success: string, failure = success) {
  if (condition) {
    step.assertions.push(success);
  } else {
    step.status = "failed";
    step.failures.push(failure);
  }
}

async function read(relativePath: string) {
  return readFile(path.resolve(repoRoot, relativePath), "utf8");
}

async function safeRead(relativePath: string) {
  return read(relativePath).catch(() => "");
}

async function addStep(report: Feature13ReleaseGateReport, name: string, fn: (step: Feature13GateStep) => Promise<void>) {
  const step = newStep(name);
  try {
    await fn(step);
  } catch (error) {
    step.status = "failed";
    step.failures.push(error instanceof Error ? error.message : String(error));
  }
  report.steps.push(step);
}

export async function evaluateFeature13ReleaseGate(options: Feature13GateOptions = {}): Promise<Feature13ReleaseGateReport> {
  const profile = options.profile ?? "main";
  const stem = `feature13-release-gate-${profile}`;
  const report: Feature13ReleaseGateReport = {
    feature: "feature13_github_fde_readiness_dashboard",
    profile,
    status: "failed",
    canBeUsedForLaunchProof: false,
    liveDbProofRequired: true,
    liveHttpSmokeRequired: true,
    generatedAt: new Date().toISOString(),
    steps: [],
    blockers: [],
    warnings: [
      "Dry-run/mock smoke is diagnostic only and is not HTTP launch proof.",
      "Feature 13 outputs are evidence, warnings, provenance, and generated context; they are not accepted Product Brain truth."
    ],
    proof: {},
    reportJsonPath: path.resolve(repoRoot, "artifacts", "ops", `${stem}.json`),
    reportMarkdownPath: path.resolve(repoRoot, "artifacts", "ops", `${stem}.md`)
  };

  await addStep(report, "database and migration static safety", async (step) => {
    const schema = await read("prisma/schema.prisma");
    const migrationNames = await listMigrationNames();
    for (const model of REQUIRED_MODELS) {
      assertStep(step, schema.includes(`model ${model}`), `Prisma schema includes ${model}`);
    }
    assertStep(step, migrationNames.some((name) => name.includes("github_integration_foundation")), "GitHub foundation migration exists");
    assertStep(step, migrationNames.some((name) => name.includes("engineering_evidence_index")), "Engineering Evidence migration exists");
    assertStep(step, migrationNames.some((name) => name.includes("fde_readiness_intelligence")), "FDE Readiness migration exists");
    const feature13Migrations = await readFeature13Migrations(migrationNames);
    assertStep(step, !/\bDROP\s+(TABLE|COLUMN|TYPE)\b/i.test(feature13Migrations), "Feature 13 migrations do not drop tables, columns, or types");
    assertStep(step, !/\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(feature13Migrations), "Feature 13 migrations do not truncate or delete data");
    assertStep(step, !/access_token|refresh_token|private_key|webhook_secret|client_secret|oauth_secret/i.test(feature13Migrations), "Feature 13 migrations do not add raw credential columns");
  });

  await addStep(report, "dashboard and readiness contract", async (step) => {
    const dashboard = await read("src/modules/dashboard/service.ts");
    const routes = await read("src/modules/dashboard/routes.ts");
    assertStep(step, dashboard.includes('dashboardKind: "fde_readiness"'), "Project dashboard declares dashboardKind=fde_readiness");
    assertStep(step, dashboard.indexOf("readinessSummary") >= 0 && dashboard.indexOf("readinessSummary") < dashboard.indexOf("operationalSummary"), "readinessSummary is primary before operationalSummary");
    for (const section of ["mockVsRealRegistry", "integrationSeams", "conflictRadar", "safeToTouchMap", "liveWorkingMap", "rationaleTraces", "decisionLog", "duplicateWork", "branchDeployTruth", "agentActivity", "todoFixme", "contextSnapshotSuggestions"]) {
      assertStep(step, dashboard.includes(section), `Dashboard payload includes ${section}`);
    }
    assertStep(step, routes.includes("/dashboard/context-snapshot"), "Context Snapshot route is registered");
    assertStep(step, dashboard.includes("agentContextPackService.createPack"), "Context Snapshot uses Agent Context Pack service");
  });

  await addStep(report, "read-only and truth-model guardrails", async (step) => {
    const sources = await readFeature13Sources();
    assertStep(step, !FORBIDDEN_FEATURE13_WRITE_PATTERNS.some((pattern) => pattern.test(sources)), "Feature 13 sources do not expose GitHub writes, auto-merge, deploy triggers, or truth mutation");
    assertStep(step, sources.includes("githubWritesAllowed: false"), "Feature 13 responses declare GitHub writes disabled");
    assertStep(step, sources.includes("truthMutationAllowed: false"), "Feature 13 responses declare truth mutation disabled");
    assertStep(step, sources.includes("Readiness findings") || sources.includes("readiness findings"), "Feature 13 labels readiness as evidence/warnings");
    report.proof.noGithubWritesFromFeature13 = !FORBIDDEN_FEATURE13_WRITE_PATTERNS.slice(0, 8).some((pattern) => pattern.test(sources));
    report.proof.noTruthMutationFromFeature13 = !FORBIDDEN_FEATURE13_WRITE_PATTERNS.slice(8).some((pattern) => pattern.test(sources));
  });

  await addStep(report, "Socrates, MCP, and Agent Files integration", async (step) => {
    const [socratesDocs, mcpSource, agentFilesSource] = await Promise.all([
      read("docs/SOCRATES_RAG_SPEC.md"),
      read("src/modules/mcp/service.ts"),
      read("src/modules/agent-files/service.ts")
    ]);
    assertStep(step, socratesDocs.includes("readiness") && socratesDocs.includes("evidence"), "Socrates docs distinguish readiness evidence from truth");
    assertStep(step, mcpSource.includes("orchestra.get_readiness_dashboard"), "MCP readiness dashboard read tool exists");
    assertStep(step, mcpSource.includes("dashboard.mcp_readiness_read"), "MCP readiness reads are audited");
    assertStep(step, agentFilesSource.includes("Engineering Readiness"), "Product Brain Agent Files include Engineering Readiness projection");
    assertStep(step, agentFilesSource.includes("do not change Product Brain or Live Doc truth"), "Agent Files readiness projection is truth-safe");
  });

  await addStep(report, "tests evals smoke and docs", async (step) => {
    const [pkgRaw, dashboardTests, fdeEval, smoke, fdeDocs] = await Promise.all([
      read("package.json"),
      read("tests/dashboard-service.test.ts"),
      read("scripts/run-fde-readiness-evals.ts"),
      read("scripts/smoke/backend-launch-loop.ts"),
      read("docs/FDE_READINESS_DASHBOARD.md")
    ]);
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
    for (const script of ["eval:github-integration", "eval:engineering-evidence", "eval:fde-readiness", "smoke:backend:dry-run", "smoke:backend:mock", "feature13:release-gate:dry-run"]) {
      assertStep(step, Boolean(pkg.scripts?.[script]), `package.json defines ${script}`);
    }
    for (const hint of REQUIRED_TEST_HINTS) {
      assertStep(step, dashboardTests.toLowerCase().includes(hint.toLowerCase()), `Dashboard tests cover ${hint}`);
    }
    assertStep(step, dashboardTests.includes("product_brain"), "Dashboard tests cover Product Brain context snapshots");
    assertStep(step, dashboardTests.includes("live_doc"), "Dashboard tests cover Live Doc context snapshots");
    assertStep(step, fdeEval.includes("weak_semantic") && fdeEval.includes("rationale"), "FDE evals cover weak rationale confidence");
    assertStep(step, smoke.includes("dashboardKind") && smoke.includes("fde_readiness") && smoke.includes("operationalSummary"), "Backend smoke checks FDE dashboard payload");
    assertStep(step, fdeDocs.includes("not Dashboard v2") || fdeDocs.includes("not `/dashboard-v2`"), "Docs state this is not Dashboard v2");
    assertStep(step, fdeDocs.includes("No auto-merge") || fdeDocs.includes("auto-merge"), "Docs state auto-merge is unavailable");
  });

  await addStep(report, "secret and provider leakage guardrails", async (step) => {
    const sources = await readFeature13Sources();
    assertStep(step, sources.includes("SECRET_PATTERN") || sources.includes("SECRET_VALUE_PATTERN"), "Feature 13 has secret-like content redaction patterns");
    assertStep(step, !SECRET_PATTERN.test(await safeRead("docs/FDE_READINESS_DASHBOARD.md")), "FDE docs contain no raw high-confidence token/private-key pattern");
    if (profile === "mvp") {
      assertStep(step, sources.includes("MVP_HIDDEN_PROVIDER_LIMITATION"), "MVP dashboard has hidden-provider sanitizer limitation");
      assertStep(step, sources.includes("mvp-hidden-provider-evidence"), "MVP dashboard redacts hidden provider details generically");
      report.proof.mvpHiddenProviderGating = sources.includes("MVP_HIDDEN_PROVIDER_LIMITATION") && sources.includes("mvp-hidden-provider-evidence");
    } else {
      report.proof.mvpHiddenProviderGating = "not_applicable_to_main";
    }
  });

  const failedSteps = report.steps.filter((step) => step.status === "failed");
  if (failedSteps.length) {
    report.status = "failed";
    report.blockers.push(...failedSteps.flatMap((step) => step.failures));
  } else if (options.allowMissingLiveDb || process.env.FEATURE13_LIVE_DB_VERIFIED === "true") {
    report.status = options.allowMissingLiveDb ? "diagnostic_passed" : "passed";
  } else {
    report.status = "blocked";
    report.blockers.push("Live Supabase schema/drift verification is required before release.");
  }

  report.proof.dashboardReadinessFirst = report.steps.some((step) => step.assertions.includes("Project dashboard declares dashboardKind=fde_readiness"));
  report.proof.staticChecksPassed = failedSteps.length === 0;
  report.proof.liveDbVerified = process.env.FEATURE13_LIVE_DB_VERIFIED === "true";
  report.proof.httpSmokeVerified = process.env.FEATURE13_HTTP_SMOKE_VERIFIED === "true";
  report.canBeUsedForLaunchProof = report.status === "passed" && report.proof.liveDbVerified === true && report.proof.httpSmokeVerified === true;

  return report;
}

async function listMigrationNames() {
  const entries = await readdir(path.resolve(repoRoot, "prisma", "migrations"), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function readFeature13Migrations(migrationNames: string[]) {
  const names = migrationNames.filter((name) =>
    name.includes("github_integration_foundation") ||
    name.includes("engineering_evidence_index") ||
    name.includes("fde_readiness_intelligence")
  );
  const contents = await Promise.all(names.map((name) => read(`prisma/migrations/${name}/migration.sql`)));
  return contents.join("\n");
}

async function readFeature13Sources() {
  const files = [
    "src/modules/github/service.ts",
    "src/modules/github/routes.ts",
    "src/modules/engineering-evidence/service.ts",
    "src/modules/engineering-evidence/routes.ts",
    "src/modules/fde-readiness/service.ts",
    "src/modules/fde-readiness/routes.ts",
    "src/modules/dashboard/service.ts",
    "src/modules/dashboard/routes.ts",
    "src/modules/mcp/service.ts",
    "src/modules/agent-files/service.ts"
  ];
  const contents = await Promise.all(files.map((file) => safeRead(file)));
  return contents.join("\n");
}

async function persistReport(report: Feature13ReleaseGateReport) {
  await mkdir(path.dirname(report.reportJsonPath), { recursive: true });
  await writeFile(report.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    report.reportMarkdownPath,
    [
      "# Feature 13 Release Gate",
      "",
      `Generated at: ${report.generatedAt}`,
      `Profile: ${report.profile}`,
      `Status: ${report.status}`,
      `Launch proof: ${report.canBeUsedForLaunchProof ? "yes" : "no"}`,
      "",
      "## Blockers",
      "",
      ...(report.blockers.length ? report.blockers.map((item) => `- ${item}`) : ["- None"]),
      "",
      "## Steps",
      "",
      ...report.steps.map((step) => `- ${step.status.toUpperCase()} ${step.name}${step.failures.length ? `: ${step.failures.join("; ")}` : ""}`)
    ].join("\n")
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await evaluateFeature13ReleaseGate(options);
  await persistReport(report);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Feature 13 release gate (${report.profile}): ${report.status}`);
    if (report.blockers.length) {
      console.log(`Blockers: ${report.blockers.join("; ")}`);
    }
    console.log(`Report: ${path.relative(repoRoot, report.reportMarkdownPath)}`);
  }
  if (report.status === "failed" || report.status === "blocked") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  void main();
}
