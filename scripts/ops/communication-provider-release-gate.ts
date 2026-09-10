import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Profile = "main" | "mvp";
type GateStatus = "passed" | "diagnostic_passed" | "blocked" | "failed";
type StepStatus = "passed" | "failed";

export interface CommunicationProviderGateOptions {
  profile?: Profile;
  allowMissingLiveDb?: boolean;
  allowMissingHttpSmoke?: boolean;
  json?: boolean;
}

export interface CommunicationProviderGateStep {
  name: string;
  status: StepStatus;
  assertions: string[];
  failures: string[];
}

export interface CommunicationProviderReleaseGateReport {
  feature: "slack_clickup_granola_communication_providers";
  profile: Profile;
  status: GateStatus;
  canBeUsedForLaunchProof: boolean;
  liveDbProofRequired: true;
  liveHttpSmokeRequired: true;
  generatedAt: string;
  steps: CommunicationProviderGateStep[];
  blockers: string[];
  warnings: string[];
  proof: Record<string, unknown>;
  reportJsonPath: string;
  reportMarkdownPath: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const MVP_ALLOWED_PROVIDERS = ["manual_import", "fireflies_ai", "slack", "clickup", "granola", "microsoft_teams"];
const MVP_HIDDEN_PROVIDERS = ["gmail", "outlook", "whatsapp_business"];
const REQUIRED_MODELS = [
  "CommunicationConnector",
  "CommunicationThread",
  "CommunicationMessage",
  "CommunicationMessageChunk",
  "CommunicationSyncRun",
  "ProviderWebhookEvent",
  "OAuthState",
  "MessageInsight",
  "ThreadInsight",
  "SpecChangeProposal",
  "SocratesCitation",
  "SocratesOpenTarget",
  "DashboardSnapshot",
  "AuditEvent"
];

const SECRET_PATTERN =
  /\b(xox[abprs]-[A-Za-z0-9-]{12,}|pk_[A-Za-z0-9_=-]{20,}|grn_[A-Za-z0-9._-]{20,}|sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/i;

const FORBIDDEN_WRITE_PATTERNS = [
  /chat\.postMessage/i,
  /conversations\.create/i,
  /files\.upload/i,
  /reactions\.add/i,
  /POST\s+\/api\/v2\/task/i,
  /PUT\s+\/api\/v2\/task/i,
  /DELETE\s+\/api\/v2\/task/i,
  /\/task\/\$\{[^}]+}\s*,\s*\{\s*method:\s*"PUT"/i,
  /\/task\/\$\{[^}]+}\s*,\s*\{\s*method:\s*"DELETE"/i,
  /applyAcceptedProposal/i,
  /acceptProposal/i,
  /rejectProposal/i,
  /liveDocService\.(update|generate|apply)/i,
  /brainService\.(update|rebuild|apply)/i
];

function parseArgs(argv: string[]): CommunicationProviderGateOptions {
  return {
    profile: (argv.find((arg) => arg.startsWith("--profile="))?.slice("--profile=".length) as Profile | undefined) ?? "main",
    allowMissingLiveDb: argv.includes("--allow-missing-live-db"),
    allowMissingHttpSmoke: argv.includes("--allow-missing-http-smoke"),
    json: argv.includes("--json")
  };
}

function newStep(name: string): CommunicationProviderGateStep {
  return { name, status: "passed", assertions: [], failures: [] };
}

function assertStep(step: CommunicationProviderGateStep, condition: unknown, success: string, failure = success) {
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

async function addStep(report: CommunicationProviderReleaseGateReport, name: string, fn: (step: CommunicationProviderGateStep) => Promise<void>) {
  const step = newStep(name);
  try {
    await fn(step);
  } catch (error) {
    step.status = "failed";
    step.failures.push(error instanceof Error ? error.message : String(error));
  }
  report.steps.push(step);
}

export async function evaluateCommunicationProviderReleaseGate(
  options: CommunicationProviderGateOptions = {}
): Promise<CommunicationProviderReleaseGateReport> {
  const profile = options.profile ?? "main";
  const stem = `communication-provider-release-gate-${profile}`;
  const report: CommunicationProviderReleaseGateReport = {
    feature: "slack_clickup_granola_communication_providers",
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
      "Slack, ClickUp, Granola, and Microsoft Teams provider evidence is source evidence, not accepted Product Brain or Live Doc truth.",
      "Live launch proof requires deployed HTTP smoke with real Slack, ClickUp, Granola, and Microsoft Teams credentials where live provider proof is claimed."
    ],
    proof: {},
    reportJsonPath: path.resolve(repoRoot, "artifacts", "ops", `${stem}.json`),
    reportMarkdownPath: path.resolve(repoRoot, "artifacts", "ops", `${stem}.md`)
  };

  await addStep(report, "database and migration static safety", async (step) => {
    const schema = await read("prisma/schema.prisma");
    for (const model of REQUIRED_MODELS) {
      assertStep(step, schema.includes(`model ${model}`), `Prisma schema includes ${model}`);
    }
    assertStep(step, /enum CommunicationProvider[\s\S]*slack[\s\S]*microsoft_teams[\s\S]*clickup[\s\S]*granola/i.test(schema), "CommunicationProvider enum includes Slack, ClickUp, Granola, and Microsoft Teams");
    assertStep(step, !/model\s+(Slack|ClickUp|Granola|Teams|MicrosoftTeams)(Message|Thread|Task|Comment|Note|Transcript|Segment|Summary)/i.test(schema), "No provider-specific Slack/ClickUp/Granola/Teams message subsystem tables");
    const migrations = await readAllMigrations();
    assertStep(step, !/\bDROP\s+(TABLE|COLUMN|TYPE)\b/i.test(migrations), "Migrations do not drop tables, columns, or types");
    assertStep(step, !/\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(migrations), "Migrations do not truncate or delete data");
    assertStep(
      step,
      !/ADD\s+COLUMN[\s\S]{0,120}(slack|clickup|granola)[\s\S]{0,80}(token|secret|credential)|"(?:slack|clickup|granola)[^"]*(?:token|secret|credential)"/i.test(migrations),
      "Migrations do not add raw provider credential columns"
    );
  });

  await addStep(report, "provider rollout and environment profile", async (step) => {
    const [envSource, envExample, envMvpExample, providerTypes, readiness, mvpPolicy] = await Promise.all([
      read("src/config/env.ts"),
      read(".env.example"),
      safeRead(".env.mvp.example"),
      read("src/lib/communications/provider-types.ts"),
      read("src/modules/communications/provider-readiness.ts"),
      safeRead("src/lib/mvp/policy.ts")
    ]);
    for (const key of [
      "SLACK_CLIENT_ID",
      "SLACK_CLIENT_SECRET",
      "SLACK_REDIRECT_URI",
      "SLACK_SIGNING_SECRET",
      "SLACK_WRITE_ACTIONS_ENABLED",
      "SLACK_FILE_INGESTION_ENABLED",
      "CLICKUP_CLIENT_ID",
      "CLICKUP_CLIENT_SECRET",
      "CLICKUP_REDIRECT_URI",
      "CLICKUP_WEBHOOK_SECRET_STORAGE_MODE",
      "CLICKUP_WRITE_ACTIONS_ENABLED",
      "CLICKUP_ATTACHMENT_INGESTION_ENABLED",
      "GRANOLA_CONNECTOR_ENABLED",
      "GRANOLA_API_BASE_URL",
      "GRANOLA_WRITE_ACTIONS_ENABLED",
      "GRANOLA_ATTACHMENT_INGESTION_ENABLED"
    ]) {
      assertStep(step, envSource.includes(key) && envExample.includes(key), `${key} is validated and documented in env example`);
    }
    assertStep(step, providerTypes.includes("slack") && providerTypes.includes("clickup") && providerTypes.includes("granola") && providerTypes.includes("microsoft_teams"), "Provider metadata registers Slack, ClickUp, Granola, and Microsoft Teams");
    assertStep(step, readiness.includes("SLACK_SIGNING_SECRET") && readiness.includes("CLICKUP_WEBHOOK_SECRET") && readiness.includes("GRANOLA_API_BASE_URL"), "Readiness gates provider configuration without exposing values");
    assertStep(step, envSource.includes("SLACK_WRITE_ACTIONS_ENABLED") && envSource.includes("must remain disabled"), "Env validation blocks Slack write actions");
    assertStep(step, envSource.includes("CLICKUP_WRITE_ACTIONS_ENABLED") && envSource.includes("write actions must remain disabled"), "Env validation blocks ClickUp write actions");
    assertStep(step, envSource.includes("GRANOLA_WRITE_ACTIONS_ENABLED") && readiness.includes("granola_write_actions_must_remain_disabled"), "Readiness flags Granola write actions as disabled");
    assertStep(step, readiness.includes("granola_connector_ready") && !readiness.includes("granola_sync_not_supported_until_step_2"), "Readiness advertises Granola sync only after connector setup and no longer claims Step 2 sync is unsupported");
    if (profile === "mvp") {
      for (const provider of MVP_ALLOWED_PROVIDERS) {
        assertStep(step, envMvpExample.includes("MVP_ENABLED_COMMUNICATION_PROVIDERS=manual_import,fireflies_ai,slack,clickup,granola,microsoft_teams"), `MVP env allows ${provider}`);
      }
      const mvpProviderEnvLine = envMvpExample
        .split(/\r?\n/)
        .find((line) => line.startsWith("MVP_ENABLED_COMMUNICATION_PROVIDERS="));
      for (const provider of MVP_HIDDEN_PROVIDERS) {
        assertStep(step, !mvpProviderEnvLine?.includes(provider), `MVP enabled provider list excludes hidden provider ${provider}`);
      }
      report.proof.mvpProviderProfile = MVP_ALLOWED_PROVIDERS;
    } else {
      report.proof.mvpProviderProfile = "not_applicable_to_main";
    }
  });

  await addStep(report, "webhook OAuth security and idempotency", async (step) => {
    const [slack, clickup, connectors, oauthState, routes, tests] = await Promise.all([
      read("src/modules/communications/providers/slack.provider.ts"),
      read("src/modules/communications/providers/clickup.provider.ts"),
      read("src/modules/communications/connectors.service.ts"),
      read("src/lib/communications/oauth-state.ts"),
      read("src/modules/communications/communications.routes.ts"),
      Promise.all([read("tests/communication-providers.test.ts"), safeRead("tests/clickup-provider-scope.test.ts")]).then((parts) => parts.join("\n"))
    ]);
    assertStep(step, oauthState.includes("timingSafeEqual") && connectors.includes("expiresAt"), "OAuth state is signed and expiry-aware");
    assertStep(step, connectors.includes("nonceHash") && connectors.includes("oauth_state_expired"), "OAuth callback consumes one-time state");
    assertStep(step, slack.includes("slack_webhook_raw_body_missing"), "Slack webhook rejects missing raw body");
    assertStep(step, slack.includes("x-slack-request-timestamp") && slack.includes("x-slack-signature"), "Slack webhook verifies official timestamp/signature headers");
    assertStep(step, clickup.includes("clickup_webhook_raw_body_missing"), "ClickUp webhook rejects missing raw body");
    assertStep(step, clickup.includes("webhookSecrets") && clickup.includes("x-signature"), "ClickUp webhook uses per-webhook secret material and signature header");
    assertStep(step, clickup.includes("CLICKUP_WEBHOOK_SECRET_STORAGE_MODE") && clickup.includes("env_fallback"), "ClickUp env webhook-secret fallback is explicit and mode-gated");
    assertStep(step, connectors.includes("provider_webhook_events") || connectors.includes("providerWebhookEvent"), "Webhook events are persisted for dedupe/idempotency");
    assertStep(step, routes.includes("bodyLimit: 1024 * 1024"), "Provider webhook routes enforce a 1 MiB body limit");
    assertStep(step, tests.includes("slack_webhook_raw_body_missing") && tests.includes("clickup_webhook_raw_body_missing"), "Tests cover missing raw-body rejection");
  });

  await addStep(report, "read-only truth-model guardrails", async (step) => {
    const [sources, jobHandlers] = await Promise.all([
      readCommunicationSources(),
      read("src/lib/jobs/handlers.ts")
    ]);
    assertStep(step, !FORBIDDEN_WRITE_PATTERNS.some((pattern) => pattern.test(sources)), "Slack/ClickUp/Granola/Teams sources expose no provider writes or direct truth mutation");
    assertStep(step, sources.includes("writeActionsEnabled: false") || sources.includes("writesEnabled: false"), "Provider outputs declare writes disabled");
    assertStep(step, sources.includes("needs_review") || sources.includes("pending"), "Proposal candidates remain review-gated");
    assertStep(step, sources.includes("isDeletedByProvider") || sources.includes("deletedProviderMessageIds"), "Deleted provider evidence has unavailable/deleted handling");
    assertStep(step, sources.includes("/notes") && sources.includes("/folders") && sources.includes("include: \"transcript\""), "Granola sync uses official notes, folders, and include=transcript endpoints");
    assertStep(step, sources.includes("granola_summary") && sources.includes("granola_transcript_segment"), "Granola summary and transcript evidence normalize to source subtypes");
    assertStep(step, jobHandlers.includes("provider: z.enum") && jobHandlers.includes("\"granola\""), "Worker communication ingestion payload schema accepts Granola");
    assertStep(step, sources.includes("\"manual_import\", \"fireflies_ai\", \"slack\", \"clickup\", \"granola\", \"microsoft_teams\""), "Agent Context, MCP, and Agent Files MVP fallback projections include Granola and Teams");
  });

  await addStep(report, "timeline retrieval Socrates dashboard docs and smoke", async (step) => {
    const [pkgRaw, timeline, dashboard, socratesDocs, connectorsDocs, evalDocs, smoke, mvpSmoke] = await Promise.all([
      read("package.json"),
      read("src/modules/communications/timeline.service.ts"),
      safeRead("src/modules/dashboard/service.ts"),
      read("docs/SOCRATES_RAG_SPEC.md"),
      read("docs/COMMUNICATION_CONNECTORS_RUNBOOK.md"),
      read("docs/EVALS.md"),
      read("scripts/smoke/backend-launch-loop.ts"),
      safeRead("scripts/smoke/mvp-smoke.ts")
    ]);
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
    for (const script of ["eval:all", "smoke:backend:dry-run", "smoke:backend:mock", "smoke:connectors:fireflies:dry-run", "communications:release-gate:dry-run"]) {
      assertStep(step, Boolean(pkg.scripts?.[script]), `package.json defines ${script}`);
    }
    assertStep(step, timeline.includes("sourceSubType") && timeline.includes("providerOpenTarget"), "Timeline exposes provider/source subtype filters and safe openTargets");
    assertStep(step, dashboard.includes("providerBreakdown") || dashboard.includes("communication"), "Dashboard includes communication provider pressure/read models");
    assertStep(step, socratesDocs.includes("Slack") && socratesDocs.includes("ClickUp") && socratesDocs.includes("Granola") && socratesDocs.includes("Microsoft Teams") && socratesDocs.includes("pending"), "Socrates docs distinguish Slack/ClickUp/Granola/Microsoft Teams evidence from pending truth");
    assertStep(step, /dry-run\/mock/i.test(connectorsDocs) && /HTTP smoke/i.test(connectorsDocs), "Runbook distinguishes diagnostic smoke from HTTP launch proof");
    assertStep(step, evalDocs.includes("ClickUp") && evalDocs.includes("Slack") && evalDocs.includes("Granola") && evalDocs.includes("Microsoft Teams"), "Eval docs cover Slack, ClickUp, Granola, and Microsoft Teams provider cases");
    assertStep(step, smoke.includes("communications") || smoke.includes("Communication"), "Backend smoke covers communication loop");
    if (profile === "mvp") {
      assertStep(step, mvpSmoke.includes("manual_import") && mvpSmoke.includes("fireflies_ai") && mvpSmoke.includes("slack") && mvpSmoke.includes("clickup") && mvpSmoke.includes("granola") && mvpSmoke.includes("microsoft_teams"), "MVP smoke checks the exact MVP provider list");
      assertStep(step, mvpSmoke.includes("gmail") && mvpSmoke.includes("communication_provider_disabled_in_mvp"), "MVP smoke checks hidden provider gating");
    }
  });

  await addStep(report, "secret and overclaim guardrails", async (step) => {
    const docsAndExamples = await readDocsAndExamples();
    assertStep(step, !SECRET_PATTERN.test(docsAndExamples), "Docs/examples contain no high-confidence Slack/ClickUp/Granola/Teams token pattern");
    assertStep(step, docsAndExamples.includes("Dry-run/mock smoke") && docsAndExamples.includes("not") && docsAndExamples.includes("launch proof"), "Docs do not overclaim dry-run/mock as launch proof");
    assertStep(step, docsAndExamples.includes("No raw") || docsAndExamples.includes("Never store raw"), "Docs warn against raw provider tokens/secrets");
  });

  const failedSteps = report.steps.filter((step) => step.status === "failed");
  if (failedSteps.length) {
    report.status = "failed";
    report.blockers.push(...failedSteps.flatMap((step) => step.failures));
  } else if (!options.allowMissingLiveDb && process.env.COMMUNICATION_PROVIDERS_LIVE_DB_VERIFIED !== "true") {
    report.status = "blocked";
    report.blockers.push("Live Supabase schema/drift verification is required before Slack/ClickUp/Granola/Teams rollout.");
  } else if (!options.allowMissingHttpSmoke && process.env.COMMUNICATION_PROVIDERS_HTTP_SMOKE_VERIFIED !== "true") {
    report.status = "blocked";
    report.blockers.push("Deployed HTTP smoke with real Slack, ClickUp, Granola, and Microsoft Teams credentials is required for launch proof when live provider proof is claimed.");
  } else if (options.allowMissingLiveDb || options.allowMissingHttpSmoke) {
    report.status = "diagnostic_passed";
  } else {
    report.status = "passed";
  }

  report.proof.staticChecksPassed = failedSteps.length === 0;
  report.proof.liveDbVerified = process.env.COMMUNICATION_PROVIDERS_LIVE_DB_VERIFIED === "true";
  report.proof.httpSmokeVerified = process.env.COMMUNICATION_PROVIDERS_HTTP_SMOKE_VERIFIED === "true";
  report.canBeUsedForLaunchProof = report.status === "passed" && report.proof.liveDbVerified === true && report.proof.httpSmokeVerified === true;
  return report;
}

async function readAllMigrations() {
  const migrationRoot = path.resolve(repoRoot, "prisma", "migrations");
  const entries = await readdir(migrationRoot, { withFileTypes: true }).catch(() => []);
  const contents = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => safeRead(path.join("prisma", "migrations", entry.name, "migration.sql")))
  );
  return contents.join("\n");
}

async function readCommunicationSources() {
  const files = [
    "src/modules/communications/providers/slack.provider.ts",
    "src/modules/communications/providers/clickup.provider.ts",
    "src/modules/communications/providers/granola.provider.ts",
    "src/modules/communications/connectors.service.ts",
    "src/modules/communications/sync.service.ts",
    "src/modules/communications/message-ingestion.service.ts",
    "src/modules/communications/message-indexing.service.ts",
    "src/modules/communications/message-insights.service.ts",
    "src/modules/communications/communication-proposals.service.ts",
    "src/modules/communications/timeline.service.ts",
    "src/modules/socrates/service.ts",
    "src/modules/dashboard/service.ts",
    "src/modules/agent-context/service.ts",
    "src/modules/agent-context/source-selection.ts",
    "src/modules/agent-context/export-templates.ts",
    "src/modules/agent-context/quality-drift.service.ts",
    "src/modules/agent-files/service.ts",
    "src/modules/mcp/service.ts"
  ];
  return (await Promise.all(files.map((file) => safeRead(file)))).join("\n");
}

async function readDocsAndExamples() {
  const files = [
    ".env.example",
    ".env.mvp.example",
    "docs/COMMUNICATION_CONNECTORS_RUNBOOK.md",
    "docs/CLICKUP_CONNECTOR.md",
    "docs/SLACK_CLICKUP_PRODUCTION_ROLLOUT.md",
    "docs/MVP_RELEASE_CHECKLIST.md",
    "docs/ENV_AND_DEPLOYMENT.md",
    "docs/EVALS.md",
    "docs/BACKEND_LAUNCH_CONTRACT.md"
  ];
  return (await Promise.all(files.map((file) => safeRead(file)))).join("\n");
}

async function persistReport(report: CommunicationProviderReleaseGateReport) {
  await mkdir(path.dirname(report.reportJsonPath), { recursive: true });
  await writeFile(report.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    report.reportMarkdownPath,
    [
      "# Slack + ClickUp + Granola Communication Provider Release Gate",
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
      "## Warnings",
      "",
      ...report.warnings.map((item) => `- ${item}`),
      "",
      "## Steps",
      "",
      ...report.steps.map((step) => `- ${step.status.toUpperCase()} ${step.name}${step.failures.length ? `: ${step.failures.join("; ")}` : ""}`)
    ].join("\n")
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await evaluateCommunicationProviderReleaseGate(options);
  await persistReport(report);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Communication provider release gate (${report.profile}): ${report.status}`);
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
