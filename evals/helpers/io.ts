import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import type { EvalSuiteReport } from "./types.js";

export async function loadJsonlFile<T>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

export async function loadValidatedJsonlFile<TSchema extends z.ZodTypeAny>(
  filePath: string,
  schema: TSchema
): Promise<Array<z.infer<TSchema>>> {
  const raw = await readFile(filePath, "utf8");
  const cases: Array<z.infer<TSchema>> = [];
  const lines = raw.split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`${filePath}:${index + 1} invalid JSON: ${(error as Error).message}`);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const details = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`).join("; ");
      throw new Error(`${filePath}:${index + 1} schema validation failed: ${details}`);
    }
    cases.push(result.data);
  });
  return cases;
}

export async function writeEvalReports(baseName: string, report: EvalSuiteReport) {
  const outputsDir = path.resolve("evals", "outputs");
  await mkdir(outputsDir, { recursive: true });
  const jsonPath = path.join(outputsDir, `${baseName}.json`);
  const mdPath = path.join(outputsDir, `${baseName}.md`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(mdPath, renderMarkdownReport(report));
  return { jsonPath, mdPath };
}

export function renderMarkdownReport(report: EvalSuiteReport) {
  const summaryLines = Object.entries(report.summary.byCategory)
    .map(([category, counts]) => `| ${category} | ${counts.total} | ${counts.passed} | ${counts.failed} |`)
    .join("\n");
  const fixtureLines = Object.entries(report.summary.byFixture ?? {})
    .map(([fixture, counts]) => `| ${fixture} | ${counts.total} | ${counts.passed} | ${counts.failed} |`)
    .join("\n");

  const budgetedResults = report.results.filter((result) => "budget_truncated" in result.observed);
  const budgetSummary =
    budgetedResults.length > 0
      ? [
          "## Socrates Budget Telemetry",
          "",
          `- Cases with budget telemetry: ${budgetedResults.length}`,
          `- Budget-truncated cases: ${budgetedResults.filter((result) => result.observed.budget_truncated === true).length}`,
          `- Dropped citations: ${budgetedResults.reduce((sum, result) => sum + Number(result.observed.dropped_citation_count ?? 0), 0)}`,
          `- Dropped open targets: ${budgetedResults.reduce((sum, result) => sum + Number(result.observed.dropped_open_target_count ?? 0), 0)}`,
          ""
        ]
      : [];

  const failedLines = report.results
    .filter((result) => !result.passed)
    .map((result) => {
      const reasons = result.reasons.length > 0 ? result.reasons.join("; ") : "No failure reason recorded";
      return `- \`${result.id}\` (${result.category}) — ${reasons}`;
    })
    .join("\n");
  const failureReasonLines = (report.summary.topFailureReasons ?? [])
    .map((item) => `| ${item.reason} | ${item.count} |`)
    .join("\n");
  const gateLines = report.gate
    ? [
        "## Gate",
        "",
        `- Passed: ${report.gate.passed ? "yes" : "no"}`,
        `- Reasons: ${report.gate.reasons.length > 0 ? report.gate.reasons.join("; ") : "None"}`,
        ""
      ]
    : [];

  return [
    `# ${report.suite} eval report`,
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    `- Total: ${report.summary.total}`,
    `- Passed: ${report.summary.passed}`,
    `- Failed: ${report.summary.failed}`,
    `- Pass rate: ${(report.summary.passRate * 100).toFixed(2)}%`,
    `- Average latency ms: ${Math.round(report.summary.averageLatencyMs ?? 0)}`,
    `- P95 latency ms: ${Math.round(report.summary.p95LatencyMs ?? 0)}`,
    `- Average estimated input tokens: ${Math.round(report.summary.averageEstimatedInputTokens ?? 0)}`,
    `- Budget-truncated cases: ${report.summary.budgetTruncatedCount ?? 0}`,
    `- Dropped citations: ${report.summary.droppedCitationCount ?? 0}`,
    `- Dropped open targets: ${report.summary.droppedOpenTargetCount ?? 0}`,
    `- Client-safety failures: ${report.summary.clientSafetyFailures ?? 0}`,
    `- False-positive failures: ${report.summary.falsePositiveFailures ?? 0}`,
    `- Invalid-ref failures: ${report.summary.invalidRefFailures ?? 0}`,
    "",
    ...gateLines,
    "## By category",
    "",
    "| Category | Total | Passed | Failed |",
    "| --- | ---: | ---: | ---: |",
    summaryLines,
    "",
    "## By fixture",
    "",
    "| Fixture | Total | Passed | Failed |",
    "| --- | ---: | ---: | ---: |",
    fixtureLines || "| none | 0 | 0 | 0 |",
    "",
    ...budgetSummary,
    "## Top failure reasons",
    "",
    "| Reason | Count |",
    "| --- | ---: |",
    failureReasonLines || "| None | 0 |",
    "",
    "## Failures",
    "",
    failedLines || "- None"
  ].join("\n");
}
