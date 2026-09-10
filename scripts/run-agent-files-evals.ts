import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AGENT_MARKDOWN_TEMPLATE_VERSION, DEFAULT_AGENT_MARKDOWN_FILES } from "../src/modules/agent-files/default-files.js";

type EvalCase = {
  id: string;
  category: string;
  title: string;
  passed: boolean;
  reasons: string[];
};

const REQUIRED_PATHS = [
  "AGENTS.md",
  "ORCHESTRA_CONTEXT.md",
  "docs/orchestra/PRODUCT_BRAIN.md",
  "docs/orchestra/CODING_REQUIREMENTS.md",
  "docs/orchestra/OPEN_QUESTIONS.md",
  "docs/orchestra/AGENT_MEMORY.md",
  "docs/orchestra/DRIFT_AND_REVIEW.md"
];

function check(id: string, category: string, title: string, predicate: boolean, reason: string): EvalCase {
  return { id, category, title, passed: predicate, reasons: predicate ? [] : [reason] };
}

async function main() {
  const serviceSource = await readFile(path.resolve("src/modules/agent-files/service.ts"), "utf8");
  const routesSource = await readFile(path.resolve("src/modules/agent-files/routes.ts"), "utf8");
  const mcpSource = await readFile(path.resolve("src/modules/mcp/service.ts"), "utf8");
  const dashboardSource = await readFile(path.resolve("src/modules/dashboard/service.ts"), "utf8");
  const socratesSource = await readFile(path.resolve("src/modules/socrates/service.ts"), "utf8");
  const paths = DEFAULT_AGENT_MARKDOWN_FILES.map((file) => file.filePath);
  const allSourceDomains = new Set(DEFAULT_AGENT_MARKDOWN_FILES.flatMap((file) => file.sourceDomains));

  const cases: EvalCase[] = [
    check(
      "agent_files_default_paths",
      "agent_files_contract",
      "Default file set contains exactly the seven required Markdown paths",
      JSON.stringify(paths) === JSON.stringify(REQUIRED_PATHS),
      `Expected ${REQUIRED_PATHS.join(", ")} but found ${paths.join(", ")}`
    ),
    check(
      "agent_files_template_version",
      "agent_files_contract",
      "Default file set has a stable Feature 12 Step 3 template version",
      AGENT_MARKDOWN_TEMPLATE_VERSION === "feature12-step3-v1",
      `Unexpected template version ${AGENT_MARKDOWN_TEMPLATE_VERSION}`
    ),
    check(
      "agent_files_product_brain_sources",
      "projection_accuracy",
      "Templates include Product Brain, Live Doc, coding requirements, agent memory, and review sources",
      ["product_brain", "live_doc", "coding_requirements", "agent_runs", "agent_quality_reviews"].every((domain) => allSourceDomains.has(domain)),
      `Missing required source domains from ${Array.from(allSourceDomains).join(", ")}`
    ),
    check(
      "agent_files_truth_guardrails",
      "truth_safety",
      "Generated Markdown labels projections as non-truth and blocks Product Brain/Live Doc mutation",
      serviceSource.includes("generated projection") &&
        serviceSource.includes("Do not mutate Product Brain, Live Doc") &&
        serviceSource.includes("not Product Brain truth"),
      "Generator source is missing derived-projection or truth-mutation guardrail wording"
    ),
    check(
      "agent_files_no_repo_write",
      "repo_safety",
      "Generation and gated sync do not auto-write GitHub, code files, or local repositories",
      serviceSource.includes("Repo Write: not performed by generation") &&
        serviceSource.includes("noRepoWrite") &&
        serviceSource.includes("noAutoMerge") &&
        serviceSource.includes("noCodeFileWrite") &&
        !serviceSource.match(/octokit|createPullRequest|git push|writeFile\(/i),
      "Generator source either lacks no-repo-write guardrails or appears to perform repo writes"
    ),
    check(
      "agent_files_routes",
      "api_contract",
      "Project-scoped preview/generate/file-version routes are registered",
      ["/agent-files/default/preview", "/agent-files/default/generate", "/versions/:versionId"].every((fragment) => routesSource.includes(fragment)),
      "Agent file route source is missing a required route"
    ),
    check(
      "agent_files_step2_routes",
      "api_contract",
      "Step 2 refresh, staleness, diff, download, manifest, latest, conflict, and sync-run routes are registered",
      ["/refresh", "/staleness", "/diff", "/download", "/manifest", "/latest", "/conflicts", "/sync-runs"].every((fragment) =>
        routesSource.includes(fragment)
      ),
      "Agent file Step 2 route source is missing a required route"
    ),
    check(
      "agent_files_markers_and_conflicts",
      "safe_sync",
      "Generated/manual zone markers, conflict reports, and local CLI sync metadata are implemented",
      serviceSource.includes("ORCHESTRA BEGIN generated") ||
        (serviceSource.includes("wrapGeneratedMarkdown") &&
          serviceSource.includes("manual_conflict") &&
          serviceSource.includes("agent_file.conflict_detected")),
      "Safe sync marker or conflict handling path is missing"
    ),
    check(
      "agent_files_mcp_read",
      "mcp_read_only",
      "MCP read access for agent files, quality, drift, sync, and readiness is registered without GitHub writes",
      ["orchestra.list_agent_files", "orchestra.get_agent_file_quality", "orchestra.get_agent_file_drift", "orchestra.get_agent_file_github_readiness"].every((fragment) =>
        mcpSource.includes(fragment)
      ) && !mcpSource.match(/octokit|createPullRequest|git push|writeFile\(/i),
      "MCP agent file read access is missing or appears to include repo-write behavior"
    ),
    check(
      "agent_files_step3_routes",
      "api_contract",
      "Step 3 quality, drift, release gate, GitHub readiness, and gated PR sync routes are registered",
      ["/quality", "/quality/refresh", "/drift", "/drift/refresh", "/release-gate", "/github-readiness", "/sync/github-pr"].every((fragment) =>
        routesSource.includes(fragment)
      ),
      "Agent file Step 3 route source is missing a required route"
    ),
    check(
      "agent_files_quality_and_drift",
      "quality_drift",
      "Deterministic quality scoring and generated-file drift detection block unsafe sync",
      serviceSource.includes("agent_file.quality_checked") &&
        serviceSource.includes("agent_file.drift_detected") &&
        serviceSource.includes("block_github_sync") &&
        serviceSource.includes("unsafe_repo_sync_claim"),
      "Quality/drift gate source is missing required checks"
    ),
    check(
      "agent_files_github_sync_gated",
      "repo_safety",
      "GitHub PR sync is feature-flagged, allowlisted, and does not auto-merge",
      serviceSource.includes("FEATURE_AGENT_FILES_GITHUB_PR_SYNC_ENABLED") &&
        serviceSource.includes("GENERATED_PR_ALLOWED_PATHS") &&
        serviceSource.includes("No code files are included") &&
        serviceSource.includes("githubWriteAttempted: false"),
      "GitHub PR sync gate source is missing required safety controls"
    ),
    check(
      "agent_files_mvp_github_disabled",
      "mvp_provider_gating",
      "MVP GitHub PR/branch sync remains disabled or readiness-gated by default",
      serviceSource.includes("MVP_ENABLE_AGENT_FILES_GITHUB_PR_SYNC") &&
        serviceSource.includes("MVP GitHub PR sync is disabled") &&
        serviceSource.includes("disabled provider support or evidence appears"),
      "MVP Step 3 sync/provider gates are missing"
    ),
    check(
      "agent_files_dashboard_socrates_loop",
      "product_brain_loop",
      "Dashboard and Socrates expose agent-file operational status as non-truth metadata",
      dashboardSource.includes("agentFiles") &&
        dashboardSource.includes("qualityLabel") &&
        socratesSource.includes("buildAgentFileAnswer") &&
        socratesSource.includes("not Product Brain truth"),
      "Dashboard or Socrates integration for agent files is missing"
    ),
    check(
      "agent_files_secret_redaction",
      "security",
      "Generator scans and redacts secret-like content before returning or persisting Markdown",
      serviceSource.includes("SECRET_VALUE_PATTERN") &&
        serviceSource.includes("SECRET_VALUE_REDACTION_PATTERN") &&
        serviceSource.includes("Secret-like content was redacted"),
      "Secret-like content redaction path is missing"
    )
  ];

  const passed = cases.filter((item) => item.passed).length;
  const failed = cases.length - passed;
  const report = {
    suite: "agent_files",
    generatedAt: new Date().toISOString(),
    summary: { total: cases.length, passed, failed },
    gate: { passed: failed === 0, reasons: cases.flatMap((item) => item.reasons) },
    cases
  };
  await mkdir(path.resolve("evals", "outputs"), { recursive: true });
  await writeFile(path.resolve("evals", "outputs", "agent-files-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    path.resolve("evals", "outputs", "agent-files-report.md"),
    [
      "# Agent Files eval report",
      "",
      `Generated at: ${report.generatedAt}`,
      "",
      `Passed: ${passed}/${cases.length}`,
      "",
      ...cases.map((item) => `- ${item.passed ? "PASS" : "FAIL"} ${item.id}: ${item.title}${item.reasons.length ? ` (${item.reasons.join("; ")})` : ""}`)
    ].join("\n")
  );
  console.log(`Agent Files evals: ${passed}/${cases.length} passed`);
  if (!report.gate.passed) process.exitCode = 1;
}

void main();
