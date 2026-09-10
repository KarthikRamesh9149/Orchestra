import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type EvalCase = {
  id: string;
  category: string;
  title: string;
  passed: boolean;
  reasons: string[];
};

function check(id: string, category: string, title: string, predicate: boolean, reason: string): EvalCase {
  return { id, category, title, passed: predicate, reasons: predicate ? [] : [reason] };
}

async function main() {
  const migrationDir = await findFdeReadinessMigrationDir();
  const [serviceSource, routesSource, schemaSource, migrationSource, docsSource, dashboardSource, dashboardRoutesSource, mcpSource, agentFilesSource] = await Promise.all([
    readFile(path.resolve("src/modules/fde-readiness/service.ts"), "utf8"),
    readFile(path.resolve("src/modules/fde-readiness/routes.ts"), "utf8"),
    readFile(path.resolve("prisma/schema.prisma"), "utf8"),
    readFile(path.join(migrationDir, "migration.sql"), "utf8"),
    readFile(path.resolve("docs/FDE_READINESS_DASHBOARD.md"), "utf8").catch(() => ""),
    readFile(path.resolve("src/modules/dashboard/service.ts"), "utf8"),
    readFile(path.resolve("src/modules/dashboard/routes.ts"), "utf8"),
    readFile(path.resolve("src/modules/mcp/service.ts"), "utf8"),
    readFile(path.resolve("src/modules/agent-files/service.ts"), "utf8")
  ]);
  const readinessSchemaSource = schemaSource.slice(
    schemaSource.indexOf("model FdeReadinessRun"),
    schemaSource.includes("model JobRun") ? schemaSource.indexOf("model JobRun") : schemaSource.length
  );

  const cases: EvalCase[] = [
    check(
      "fde_readiness_additive_migration",
      "database_safety",
      "FDE readiness migration is additive and avoids destructive operations",
      migrationSource.includes("CREATE TABLE") &&
        !/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX)\b/i.test(migrationSource) &&
        !/\bTRUNCATE\b/i.test(migrationSource) &&
        !/\bDELETE\s+FROM\b/i.test(migrationSource),
      "Migration contains destructive SQL or does not create additive readiness tables"
    ),
    check(
      "fde_readiness_project_scoped_schema",
      "readiness_contract",
      "Readiness findings, traces, hops, and decision links are project scoped with citations/openTargets",
      [
        "FdeReadinessFinding",
        "FdeRationaleTrace",
        "FdeRationaleTraceHop",
        "FdeDecisionEngineeringLink",
        "projectId",
        "orgId",
        "citationsJson",
        "openTargetsJson",
        "limitationsJson"
      ].every((fragment) => readinessSchemaSource.includes(fragment)),
      "Readiness schema is missing required project/provenance fields"
    ),
    check(
      "fde_readiness_consumes_engineering_evidence",
      "architecture",
      "Part 3 consumes Part 2 engineering evidence instead of duplicating GitHub sync",
      serviceSource.includes("engineeringEvidenceItem.findMany") &&
        !serviceSource.match(/octokit|createInstallationAccessToken|listPullRequests|repos\.|pulls\.create|git\.create/i),
      "Service does not clearly consume EngineeringEvidenceItem or appears to duplicate GitHub integration"
    ),
    check(
      "fde_conflict_safe_duplicate_live_services",
      "intelligence",
      "Conflict Radar, Safe-to-Touch, Duplicate Work, and Live Working Map builders exist",
      ["buildConflictFindings", "buildSafeToTouchSignals", "buildDuplicateFindings", "buildLiveWorkingSignals"].every((fragment) =>
        serviceSource.includes(fragment)
      ),
      "One or more deterministic readiness builders are missing"
    ),
    check(
      "fde_rationale_trace_confidence",
      "rationale_trace",
      "Rationale Trace stores hops with confidence and marks weak/partial traces honestly",
      serviceSource.includes("overallConfidence") &&
        serviceSource.includes("weak_semantic") &&
        serviceSource.includes("rationale_trace.low_confidence") &&
        readinessSchemaSource.includes("FdeRationaleTraceHop"),
      "Rationale Trace confidence/partial behavior is missing"
    ),
    check(
      "fde_decision_links_existing_only",
      "truth_safety",
      "Decision engineering links require existing accepted decisions and do not create accepted decisions",
      serviceSource.includes('status: "accepted"') &&
        serviceSource.includes("fdeDecisionEngineeringLink.upsert") &&
        !serviceSource.match(/decisionRecord\.create|status:\s*["']accepted["'][\s\S]{0,80}create/i),
      "Decision links may not be gated to existing accepted decisions"
    ),
    check(
      "fde_truth_no_write_safety",
      "truth_safety",
      "Part 3 cannot mutate Product Brain, Live Doc, proposals, GitHub, deploys, or auto-merge",
      serviceSource.includes("truthMutationAllowed: false") &&
        serviceSource.includes("githubWritesAllowed: false") &&
        !serviceSource.match(/acceptProposal|rejectProposal|applyAcceptedProposal|brainService|liveDocService|createPullRequest|createBranch|mergePullRequest|triggerDeployment/i),
      "Truth mutation or GitHub/deploy write behavior appears present"
    ),
    check(
      "fde_routes_contract",
      "api_contract",
      "Project-scoped FDE readiness intelligence APIs are registered",
      [
        "/fde-readiness/conflicts",
        "/fde-readiness/safe-to-touch",
        "/fde-readiness/duplicates",
        "/fde-readiness/live-working-map",
        "/fde-readiness/rationale-traces",
        "/fde-readiness/decision-links",
        "/fde-readiness/refresh"
      ].every((fragment) => routesSource.includes(fragment)),
      "FDE readiness route contract is incomplete"
    ),
    check(
      "fde_secret_redaction",
      "secret_safety",
      "Readiness findings and traces redact secret-like source excerpts",
      serviceSource.includes("SECRET_PATTERN") &&
        serviceSource.includes("redactJson") &&
        !readinessSchemaSource.match(/accessToken|refreshToken|privateKey|webhookSecret|clientSecret|oauthToken/i),
      "Secret redaction is missing or schema appears to store credential fields"
    ),
    check(
      "fde_mvp_hidden_provider_gating",
      "mvp_safety",
      "MVP readiness excludes hidden provider evidence without leaking provider details",
      serviceSource.includes("MVP_HIDDEN_COMMUNICATION_PROVIDERS") &&
        serviceSource.includes("readiness_intelligence.disabled_provider_evidence_excluded") &&
        serviceSource.includes("excludedCount"),
      "MVP hidden provider exclusion is missing or may leak provider details"
    ),
    check(
      "fde_docs_scope",
      "documentation",
      "Docs state Part 3 scope and no final dashboard/no-write/no-truth-mutation limits",
      docsSource.includes("Part 3 creates FDE Readiness Intelligence") &&
        docsSource.includes("does not implement the final full dashboard replacement") &&
        docsSource.includes("does not mutate Product Brain") &&
        docsSource.includes("does not write to GitHub"),
      "FDE readiness docs are missing critical scope/truth/no-write statements"
    ),
    check(
      "fde_part4_canonical_dashboard",
      "dashboard_contract",
      "Part 4 makes the canonical project dashboard readiness-first and preserves operationalSummary",
      dashboardSource.includes('dashboardKind: "fde_readiness"') &&
        dashboardSource.indexOf("readinessSummary") < dashboardSource.indexOf("operationalSummary") &&
        dashboardSource.includes("mockVsRealRegistry") &&
        dashboardSource.includes("contextSnapshotSuggestions"),
      "Dashboard service does not clearly expose readiness-first payload before operationalSummary"
    ),
    check(
      "fde_part4_dashboard_subroutes",
      "dashboard_contract",
      "Part 4 dashboard subroutes and Context Snapshot route are registered",
      [
        "/dashboard/readiness",
        "/dashboard/mock-real",
        "/dashboard/seams",
        "/dashboard/conflicts",
        "/dashboard/files/:filePath/safe-to-touch",
        "/dashboard/context-snapshot",
        "/dashboard/rationale-trace",
        "/dashboard/branch-deploy-truth",
        "/dashboard/agent-activity"
      ].every((fragment) => dashboardRoutesSource.includes(fragment)),
      "Dashboard Part 4 supporting route contract is incomplete"
    ),
    check(
      "fde_part4_context_snapshot_truth_safety",
      "truth_safety",
      "Context Snapshot uses Agent Context Packs and forbids GitHub/truth mutations",
      dashboardSource.includes("agentContextPackService.createPack") &&
        dashboardSource.includes("truthMutationAllowed: false") &&
        dashboardSource.includes("githubWritesAllowed: false") &&
        dashboardSource.includes("externalAgentExecution: false"),
      "Context Snapshot is not clearly powered by Agent Context Packs or lacks truth/no-write flags"
    ),
    check(
      "fde_part4_mcp_readiness_read_only",
      "mcp",
      "MCP readiness tools are read-only and expose no GitHub/deploy/truth writes",
      [
        "orchestra.get_readiness_dashboard",
        "orchestra.get_conflict_radar",
        "orchestra.get_safe_to_touch",
        "orchestra.get_live_working_map",
        "orchestra.get_rationale_trace",
        "githubWritesAllowed: false",
        "truthMutationAllowed: false"
      ].every((fragment) => mcpSource.includes(fragment)),
      "MCP readiness read tools are missing or do not include no-write/no-truth flags"
    ),
    check(
      "fde_part4_agent_files_projection",
      "agent_files",
      "Product Brain Agent Files include engineering readiness as projection-only context",
      agentFilesSource.includes("readinessProjectionLines") &&
        agentFilesSource.includes("Engineering Readiness") &&
        agentFilesSource.includes("do not change Product Brain or Live Doc truth"),
      "Agent Files readiness projection is missing or overclaims truth"
    ),
    check(
      "fde_part4_mvp_provider_gating",
      "mvp_safety",
      "Part 4 MVP dashboard and agent files exclude hidden provider evidence",
      dashboardSource.includes("Some communication providers are disabled in MVP mode") &&
        agentFilesSource.includes("disabled_provider_evidence_excluded") &&
        mcpSource.includes("mvpAllowedProviderFilter"),
      "MVP hidden provider gating is missing from Part 4 dashboard/MCP/agent-file paths"
    )
  ];

  const passed = cases.filter((item) => item.passed).length;
  const failed = cases.filter((item) => !item.passed);
  const outputDir = path.resolve("evals", "outputs");
  await mkdir(outputDir, { recursive: true });
  const report = {
    suite: "fde-readiness",
    generatedAt: new Date().toISOString(),
    summary: { total: cases.length, passed, failed: failed.length },
    cases,
    gate: { passed: failed.length === 0, reasons: failed.flatMap((item) => item.reasons) }
  };
  await writeFile(path.join(outputDir, "fde-readiness-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    path.join(outputDir, "fde-readiness-report.md"),
    [
      "# FDE Readiness Eval Report",
      "",
      `Generated at: ${report.generatedAt}`,
      "",
      `Passed: ${passed}/${cases.length}`,
      "",
      ...cases.map((item) => `- ${item.passed ? "PASS" : "FAIL"} ${item.id}: ${item.title}${item.reasons.length ? ` (${item.reasons.join("; ")})` : ""}`)
    ].join("\n")
  );

  console.log(`FDE Readiness evals: ${passed}/${cases.length} passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main();

async function findFdeReadinessMigrationDir() {
  const root = path.resolve("prisma", "migrations");
  const entries = await readdir(root, { withFileTypes: true });
  const migration = entries
    .filter((entry) => entry.isDirectory() && entry.name.includes("fde_readiness_intelligence"))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!migration) {
    throw new Error("FDE Readiness Intelligence migration not found");
  }
  return path.join(root, migration);
}
