import { execFile } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

type ScanStatus = "passed" | "failed";

interface SecretMatch {
  file: string;
  line: number;
  pattern: string;
  allowed: boolean;
  text: string;
}

interface SecurityScanReport {
  mode: "local";
  status: ScanStatus;
  proofLevel: "static";
  startedAt: string;
  finishedAt: string;
  scannedFiles: number;
  findings: string[];
  allowedMatches: SecretMatch[];
  reportJsonPath: string;
  reportMarkdownPath: string;
}

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "OpenAI-style API key", pattern: /sk-[A-Za-z0-9]{20,}/ },
  { name: "Slack token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/ },
  { name: "Google API key", pattern: /AIza[0-9A-Za-z_-]{20,}/ },
  { name: "Private key block", pattern: /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/ },
  { name: "Long bearer token", pattern: /Bearer [A-Za-z0-9._-]{20,}/ },
  {
    name: "Committed env assignment",
    pattern:
      /(^|\s)(\$env:)?(FIREFLIES_API_KEY|FIREFLIES_WEBHOOK_SECRET|CONNECTOR_CREDENTIAL_ENCRYPTION_KEY|CLIENT_SHARE_TOKEN_SECRET|JWT_ACCESS_SECRET|JWT_REFRESH_SECRET)\s*=(?!=)\s*[^\s#]+/
  }
];
const SCAN_CONCURRENCY = 32;

function isExcluded(file: string) {
  return (
    file.startsWith("node_modules/") ||
    file.startsWith("dist/") ||
    file.startsWith("artifacts/") ||
    file.startsWith("evals/outputs/")
  );
}

function isAllowedMatch(file: string, text: string) {
  if (/^\.env(?:\.[A-Za-z0-9_-]+)*\.example$/.test(file)) return true;
  const clearlySynthetic = /\b(mock|test|example|placeholder|redacted|fixture|fake|dummy)\b|your[_ -]|<[^>]*(?:key|secret|token)[^>]*>|(?:dev|local|replace_with)_[a-z0-9_]+|abcdefghijklmnopqrstuvwxyz|1234567890|secret-value|access-token-value|provider-secret|xoxb-(?:secret-token|should-not-leak|sync-secret)|Bearer (?:provider-token|dashboard\.secret\.token|connector\.secret\.token|orch_vscode_secret_value|calendar\.secret\.token)/i.test(text);
  if ((file.startsWith("docs/") || file.startsWith("tests/")) && clearlySynthetic) return true;
  if (file.startsWith("scripts/smoke/") && /mock|placeholder|secret marker|Bearer mock/i.test(text)) return true;
  return false;
}

async function gitLsFiles(args: string[]) {
  const { stdout } = await execFileAsync("git", ["ls-files", ...args], { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
  return stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildMarkdown(report: SecurityScanReport) {
  return `# Local Security Scan Report

## Result
- Status: ${report.status}
- Proof level: ${report.proofLevel}
- Scanned tracked files: ${report.scannedFiles}
- Started: ${report.startedAt}
- Finished: ${report.finishedAt}

## Findings
${report.findings.length ? report.findings.map((item) => `- ${item}`).join("\n") : "- none"}

## Allowed Matches
${report.allowedMatches.length ? report.allowedMatches.map((item) => `- ${item.file}:${item.line} (${item.pattern})`).join("\n") : "- none"}

This scan is a CI-safe static check. It is not a substitute for external SAST/DAST, managed secret scanning, or live penetration testing.
`;
}

async function writeReport(report: SecurityScanReport) {
  await mkdir(path.dirname(report.reportJsonPath), { recursive: true });
  await writeFile(report.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(report.reportMarkdownPath, buildMarkdown(report));
}

export async function runLocalSecurityScan(): Promise<SecurityScanReport> {
  const startedAt = new Date().toISOString();
  const files = (await gitLsFiles(["--cached", "--others", "--exclude-standard"])).filter((file) => !isExcluded(file));
  const trackedEnv = await gitLsFiles([".env", ".env.local", ".vault"]);
  const report: SecurityScanReport = {
    mode: "local",
    status: "failed",
    proofLevel: "static",
    startedAt,
    finishedAt: "",
    scannedFiles: files.length,
    findings: [],
    allowedMatches: [],
    reportJsonPath: path.resolve(repoRoot, "artifacts/ops/security-scan-local-report.json"),
    reportMarkdownPath: path.resolve(repoRoot, "artifacts/ops/security-scan-local-report.md")
  };

  for (const forbidden of trackedEnv) {
    report.findings.push(`Forbidden tracked secret/runtime file: ${forbidden}`);
  }

  for (let index = 0; index < files.length; index += SCAN_CONCURRENCY) {
    const batch = files.slice(index, index + SCAN_CONCURRENCY);
    const batchMatches = await Promise.all(batch.map((file) => scanFile(file)));
    for (const matches of batchMatches) {
      for (const match of matches) {
        if (match.allowed) report.allowedMatches.push(match);
        else report.findings.push(`${match.file}:${match.line} matched ${match.pattern}`);
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  report.status = report.findings.length > 0 ? "failed" : "passed";
  await writeReport(report);
  return report;
}

async function scanFile(file: string): Promise<SecretMatch[]> {
  let content: string;
  try {
    content = await readFile(path.resolve(repoRoot, file), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const matches: SecretMatch[] = [];
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (!pattern.test(line)) continue;
      matches.push({
        file,
        line: index + 1,
        pattern: name,
        allowed: isAllowedMatch(file, line),
        text: line.trim().slice(0, 240)
      });
    }
  }
  return matches;
}

async function main() {
  const report = await runLocalSecurityScan();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Local security scan ${report.status}. Report: ${report.reportMarkdownPath}`);
  }
  if (report.status === "failed") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
