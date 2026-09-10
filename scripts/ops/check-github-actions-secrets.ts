import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

export interface SecretGroup {
  label: string;
  names: string[];
  note?: string;
}

export interface ReadinessInput {
  presentSecrets: Set<string>;
  presentVariables: Set<string>;
  environmentName: string;
  repository: string;
  requireFirefliesLive: boolean;
}

export interface ReadinessReport {
  ok: boolean;
  environmentName: string;
  repository: string;
  requireFirefliesLive: boolean;
  presentSecrets: string[];
  presentVariables: string[];
  missingSecretGroups: SecretGroup[];
  missingVariables: string[];
  checkedSecretGroups: SecretGroup[];
  checkedVariables: string[];
}

export const REQUIRED_SECRET_GROUPS: SecretGroup[] = [
  { label: "STAGING_DATABASE_URL", names: ["STAGING_DATABASE_URL"] },
  {
    label: "STAGING_SMOKE_BASE_URL or SMOKE_BASE_URL",
    names: ["STAGING_SMOKE_BASE_URL", "SMOKE_BASE_URL"]
  },
  {
    label: "STAGING_MVP_SMOKE_BASE_URL or MVP_SMOKE_BASE_URL or backend smoke base URL",
    names: ["STAGING_MVP_SMOKE_BASE_URL", "MVP_SMOKE_BASE_URL", "STAGING_SMOKE_BASE_URL", "SMOKE_BASE_URL"]
  },
  { label: "SMOKE_MANAGER_EMAIL", names: ["SMOKE_MANAGER_EMAIL"] },
  { label: "SMOKE_MANAGER_PASSWORD", names: ["SMOKE_MANAGER_PASSWORD"] },
  { label: "SMOKE_DEV_EMAIL", names: ["SMOKE_DEV_EMAIL"] },
  { label: "SMOKE_DEV_PASSWORD", names: ["SMOKE_DEV_PASSWORD"] },
  { label: "SMOKE_CLIENT_EMAIL", names: ["SMOKE_CLIENT_EMAIL"] },
  { label: "SMOKE_CLIENT_PASSWORD", names: ["SMOKE_CLIENT_PASSWORD"] },
  { label: "METRICS_TOKEN", names: ["METRICS_TOKEN"] }
];

export const OPTIONAL_MVP_OVERRIDE_SECRET_GROUPS: SecretGroup[] = [
  { label: "MVP_SMOKE_MANAGER_EMAIL", names: ["MVP_SMOKE_MANAGER_EMAIL"] },
  { label: "MVP_SMOKE_MANAGER_PASSWORD", names: ["MVP_SMOKE_MANAGER_PASSWORD"] },
  { label: "MVP_SMOKE_DEV_EMAIL", names: ["MVP_SMOKE_DEV_EMAIL"] },
  { label: "MVP_SMOKE_DEV_PASSWORD", names: ["MVP_SMOKE_DEV_PASSWORD"] },
  { label: "MVP_SMOKE_CLIENT_EMAIL", names: ["MVP_SMOKE_CLIENT_EMAIL"] },
  { label: "MVP_SMOKE_CLIENT_PASSWORD", names: ["MVP_SMOKE_CLIENT_PASSWORD"] }
];

export const FIREFLIES_LIVE_SECRET_GROUPS: SecretGroup[] = [
  { label: "FIREFLIES_API_KEY", names: ["FIREFLIES_API_KEY"] },
  { label: "FIREFLIES_WEBHOOK_SECRET", names: ["FIREFLIES_WEBHOOK_SECRET"] },
  { label: "FIREFLIES_SMOKE_MANAGER_EMAIL", names: ["FIREFLIES_SMOKE_MANAGER_EMAIL"] },
  { label: "FIREFLIES_SMOKE_MANAGER_PASSWORD", names: ["FIREFLIES_SMOKE_MANAGER_PASSWORD"] },
  { label: "FIREFLIES_SMOKE_PROJECT_ID", names: ["FIREFLIES_SMOKE_PROJECT_ID"] },
  { label: "FIREFLIES_SMOKE_TRANSCRIPT_ID", names: ["FIREFLIES_SMOKE_TRANSCRIPT_ID"] }
];

export const REQUIRED_VARIABLE_NAMES = [
  "SMOKE_EXPECT_AI",
  "SMOKE_EXPECT_WORKER",
  "SMOKE_CLIENT_PORTAL",
  "MVP_SMOKE_EXPECT_AI",
  "MVP_SMOKE_EXPECT_WORKER",
  "MVP_SMOKE_EXPECT_FIREFLIES_LIVE",
  "SMOKE_ALLOW_LOCALHOST_HTTP"
] as const;

interface StaticFinding {
  file: string;
  line: number;
  message: string;
}

const STATIC_SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "GitHub token", pattern: /(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/g },
  { name: "GitHub private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g },
  {
    name: "GitHub webhook/OAuth/private-key assignment",
    pattern: /(WEBHOOK_SECRET|OAUTH_CLIENT_SECRET|GITHUB_PRIVATE_KEY|GITHUB_APP_PRIVATE_KEY)\s*[:=]\s*["']?[^"'\s$][^"'\s]*/gi
  }
];

const FORBIDDEN_WORKFLOW_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "workflow write-all permission", pattern: /^\s*permissions:\s*write-all\s*$/im },
  { name: "workflow contents write permission", pattern: /^\s*contents:\s*write\s*$/im },
  { name: "workflow pull-request write permission", pattern: /^\s*pull-requests:\s*write\s*$/im },
  { name: "git push from CI", pattern: /\bgit\s+push\b/i },
  { name: "GitHub PR creation action", pattern: /peter-evans\/create-pull-request/i },
  { name: "GitHub script write escape hatch", pattern: /actions\/github-script/i },
  { name: "GitHub CLI PR creation", pattern: /\bgh\s+pr\s+create\b/i },
  { name: "GitHub CLI merge", pattern: /\bgh\s+pr\s+merge\b/i }
];

function parseBoolean(value: string | undefined) {
  return ["1", "true", "yes", "y", "on"].includes((value ?? "").toLowerCase());
}

function envFlagName(prefix: "SECRET" | "VAR", name: string) {
  return `${prefix}_${name}_PRESENT`;
}

function lineFor(content: string, offset: number) {
  return content.slice(0, offset).split(/\r?\n/).length;
}

async function gitLsFiles(args: string[]) {
  const { stdout } = await execFileAsync("git", ["ls-files", ...args], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
  return stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function groupIsPresent(group: SecretGroup, presentSecrets: Set<string>) {
  return group.names.some((name) => presentSecrets.has(name));
}

export function buildReadinessReport(input: ReadinessInput): ReadinessReport {
  const checkedSecretGroups = [
    ...REQUIRED_SECRET_GROUPS,
    ...(input.requireFirefliesLive ? FIREFLIES_LIVE_SECRET_GROUPS : [])
  ];
  const missingSecretGroups = checkedSecretGroups.filter((group) => !groupIsPresent(group, input.presentSecrets));
  const missingVariables = REQUIRED_VARIABLE_NAMES.filter((name) => !input.presentVariables.has(name));

  return {
    ok: missingSecretGroups.length === 0 && missingVariables.length === 0,
    environmentName: input.environmentName,
    repository: input.repository,
    requireFirefliesLive: input.requireFirefliesLive,
    presentSecrets: Array.from(input.presentSecrets).sort(),
    presentVariables: Array.from(input.presentVariables).sort(),
    missingSecretGroups,
    missingVariables,
    checkedSecretGroups,
    checkedVariables: [...REQUIRED_VARIABLE_NAMES]
  };
}

export function renderReadinessMarkdown(report: ReadinessReport) {
  const setSecretCommands = report.missingSecretGroups.flatMap((group) =>
    group.names.map((name) => `gh secret set --env ${report.environmentName} ${name} --repo ${report.repository}`)
  );
  const setVariableCommands = report.missingVariables.map(
    (name) => `gh variable set --env ${report.environmentName} ${name} --body <true-or-false> --repo ${report.repository}`
  );

  return [
    "# HTTP Smoke Secrets Readiness",
    "",
    `- Repository: ${report.repository}`,
    `- GitHub Environment: ${report.environmentName}`,
    `- Fireflies live proof required: ${report.requireFirefliesLive ? "YES" : "NO"}`,
    `- Ready: ${report.ok ? "YES" : "NO"}`,
    "",
    "This check lists secret and variable names only. It never prints secret values.",
    "",
    "## Missing Required Staging Secrets",
    "",
    report.missingSecretGroups.length
      ? report.missingSecretGroups.map((group) => `- ${group.label}`).join("\n")
      : "None.",
    "",
    "## Missing Required Staging Variables",
    "",
    report.missingVariables.length ? report.missingVariables.map((name) => `- ${name}`).join("\n") : "None.",
    "",
    "## Present Secret Names Checked",
    "",
    report.presentSecrets.length ? report.presentSecrets.map((name) => `- ${name}`).join("\n") : "None detected.",
    "",
    "## Present Variable Names Checked",
    "",
    report.presentVariables.length ? report.presentVariables.map((name) => `- ${name}`).join("\n") : "None detected.",
    "",
    "## Setup Commands For Missing Items",
    "",
    [...setSecretCommands, ...setVariableCommands].length
      ? [...setSecretCommands, ...setVariableCommands].map((command) => `\`${command}\``).join("\n")
      : "No missing setup commands.",
    "",
    "Add missing values under Settings -> Environments -> staging. Do not add real secret values to repository files, logs, issues, or pull requests."
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    environmentName: "staging",
    repository: "KarthikRamesh9149/orchestrav2",
    requireFirefliesLive: false,
    json: false,
    workflowEnv: false,
    staticOnly: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env") args.environmentName = argv[++index] ?? args.environmentName;
    else if (arg === "--repo") args.repository = argv[++index] ?? args.repository;
    else if (arg === "--require-fireflies-live") args.requireFirefliesLive = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--workflow-env") args.workflowEnv = true;
    else if (arg === "--static") args.staticOnly = true;
    else throw new Error(`Unsupported argument: ${arg}`);
  }

  return args;
}

function reportFromWorkflowEnv(env: NodeJS.ProcessEnv, environmentName: string, repository: string, requireFirefliesLive: boolean) {
  const allSecretNames = new Set(
    [...REQUIRED_SECRET_GROUPS, ...OPTIONAL_MVP_OVERRIDE_SECRET_GROUPS, ...FIREFLIES_LIVE_SECRET_GROUPS].flatMap(
      (group) => group.names
    )
  );
  const presentSecrets = new Set<string>();
  const presentVariables = new Set<string>();

  for (const name of allSecretNames) {
    if (parseBoolean(env[envFlagName("SECRET", name)])) presentSecrets.add(name);
  }
  for (const name of REQUIRED_VARIABLE_NAMES) {
    if (parseBoolean(env[envFlagName("VAR", name)])) presentVariables.add(name);
  }

  return buildReadinessReport({ presentSecrets, presentVariables, environmentName, repository, requireFirefliesLive });
}

async function listGitHubNames(kind: "secret" | "variable", environmentName: string, repository: string) {
  const { stdout } = await execFileAsync("gh", [kind, "list", "--env", environmentName, "--repo", repository, "--json", "name"], {
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  const parsed = JSON.parse(stdout) as Array<{ name?: string }>;
  return new Set(parsed.map((item) => item.name).filter((name): name is string => Boolean(name)));
}

async function reportFromGitHub(environmentName: string, repository: string, requireFirefliesLive: boolean) {
  const [presentSecrets, presentVariables] = await Promise.all([
    listGitHubNames("secret", environmentName, repository),
    listGitHubNames("variable", environmentName, repository)
  ]);
  return buildReadinessReport({ presentSecrets, presentVariables, environmentName, repository, requireFirefliesLive });
}

async function writeStepSummary(markdown: string) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  await appendFile(summaryPath, `${markdown}\n`);
}

async function runStaticWorkflowSafetyCheck() {
  const startedAt = new Date().toISOString();
  const files = await gitLsFiles([".github", "package.json", "package-lock.json"]);
  const findings: StaticFinding[] = [];

  for (const file of files) {
    const content = await readFile(path.resolve(repoRoot, file), "utf8");
    for (const { name, pattern } of STATIC_SECRET_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        findings.push({ file, line: lineFor(content, match.index ?? 0), message: `matched ${name}` });
      }
    }
    if (!file.startsWith(".github/")) continue;
    for (const { name, pattern } of FORBIDDEN_WORKFLOW_PATTERNS) {
      const match = pattern.exec(content);
      if (match) findings.push({ file, line: lineFor(content, match.index), message: `matched ${name}` });
    }
    if (!/^\s*permissions:\s*$/im.test(content) || !/^\s*contents:\s*read\s*$/im.test(content)) {
      findings.push({ file, line: 1, message: "workflow must explicitly set read-only contents permission" });
    }
  }

  const report = {
    status: findings.length ? "failed" : "passed",
    proofLevel: "static",
    startedAt,
    finishedAt: new Date().toISOString(),
    scannedFiles: files.length,
    findings
  };
  const reportJsonPath = path.resolve(repoRoot, "artifacts/ops/github-actions-secret-check-report.json");
  const reportMarkdownPath = path.resolve(repoRoot, "artifacts/ops/github-actions-secret-check-report.md");
  const markdown = [
    "# GitHub Actions Secret and Write-Safety Check",
    "",
    `- Status: ${report.status}`,
    `- Proof level: ${report.proofLevel}`,
    `- Scanned files: ${report.scannedFiles}`,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    "",
    "## Findings",
    findings.length ? findings.map((finding) => `- ${finding.file}:${finding.line} ${finding.message}`).join("\n") : "- none",
    "",
    "This static check verifies committed workflow/config files only. It does not inspect GitHub repository settings or organization-level secrets."
  ].join("\n");
  await mkdir(path.dirname(reportJsonPath), { recursive: true });
  await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(reportMarkdownPath, `${markdown}\n`);
  console.log(`GitHub Actions secret check ${report.status}. Report: ${reportMarkdownPath}`);
  if (findings.length) process.exitCode = 1;
}

async function main() {
  const args = parseArgs();
  const requireFirefliesLive =
    args.requireFirefliesLive ||
    parseBoolean(process.env.REQUIRE_FIREFLIES_LIVE) ||
    parseBoolean(process.env.VAR_MVP_SMOKE_EXPECT_FIREFLIES_LIVE_VALUE) ||
    parseBoolean(process.env.VAR_FIREFLIES_SMOKE_EXPECT_LIVE_API_VALUE) ||
    parseBoolean(process.env.VAR_FIREFLIES_SMOKE_EXPECT_WEBHOOK_VALUE);

  if (args.staticOnly || (!args.workflowEnv && process.env.GITHUB_ACTIONS !== "true")) {
    await runStaticWorkflowSafetyCheck();
    return;
  }

  let report: ReadinessReport;
  try {
    report = args.workflowEnv
      ? reportFromWorkflowEnv(process.env, args.environmentName, args.repository, requireFirefliesLive)
      : await reportFromGitHub(args.environmentName, args.repository, requireFirefliesLive);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const markdown = [
      "# HTTP Smoke Secrets Readiness",
      "",
      "Unable to inspect GitHub Environment secrets/variables.",
      "",
      `- Repository: ${args.repository}`,
      `- GitHub Environment: ${args.environmentName}`,
      `- Error: ${message}`,
      "",
      "Install/authenticate the GitHub CLI and confirm the GitHub Environment exists, then retry:",
      "",
      "`gh auth status`",
      "",
      `Create or inspect the environment at Settings -> Environments -> ${args.environmentName}.`,
      "",
      `\`npm run ops:github-secrets:check -- --env ${args.environmentName} --repo ${args.repository}\``
    ].join("\n");
    await writeStepSummary(markdown);
    console.error(markdown);
    process.exitCode = 1;
    return;
  }

  const markdown = renderReadinessMarkdown(report);
  await writeStepSummary(markdown);
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ...report,
          presentSecrets: report.presentSecrets,
          presentVariables: report.presentVariables,
          missingSecretGroups: report.missingSecretGroups.map((group) => group.label)
        },
        null,
        2
      )
    );
  } else {
    console.log(markdown);
  }
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
