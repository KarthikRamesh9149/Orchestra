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
  const migrationDir = await findEngineeringEvidenceMigrationDir();
  const [serviceSource, routesSource, schemaSource, migrationSource, envSource, docsSource] = await Promise.all([
    readFile(path.resolve("src/modules/engineering-evidence/service.ts"), "utf8"),
    readFile(path.resolve("src/modules/engineering-evidence/routes.ts"), "utf8"),
    readFile(path.resolve("prisma/schema.prisma"), "utf8"),
    readFile(path.join(migrationDir, "migration.sql"), "utf8"),
    readFile(path.resolve("src/config/env.ts"), "utf8"),
    readFile(path.resolve("docs/ENGINEERING_EVIDENCE_INDEX.md"), "utf8").catch(() => "")
  ]);
  const evidenceSchemaSource = schemaSource.slice(
    schemaSource.indexOf("model EngineeringEvidenceItem"),
    schemaSource.includes("model JobRun") ? schemaSource.indexOf("model JobRun") : schemaSource.length
  );

  const cases: EvalCase[] = [
    check(
      "engineering_evidence_provider_neutral_schema",
      "evidence_contract",
      "Engineering evidence has provider-neutral queryable fields and provenance",
      [
        "EngineeringEvidenceItem",
        "provider",
        "sourceType",
        "sourceSubType",
        "repositoryLinkId",
        "branch",
        "sha",
        "pullRequestNumber",
        "filePath",
        "routePath",
        "citationJson",
        "openTargetJson"
      ].every((fragment) => evidenceSchemaSource.includes(fragment)),
      "Provider-neutral evidence schema is missing required query/provenance fields"
    ),
    check(
      "engineering_evidence_additive_migration",
      "database_safety",
      "Engineering evidence migration is additive and avoids destructive operations",
      migrationSource.includes("CREATE TABLE") &&
        !/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX)\b/i.test(migrationSource) &&
        !/\bTRUNCATE\b/i.test(migrationSource) &&
        !/\bDELETE\s+FROM\b/i.test(migrationSource),
      "Migration contains destructive SQL or does not create additive tables"
    ),
    check(
      "engineering_evidence_normalizes_sources",
      "normalization",
      "GitHub, route registry, agent run, and manual evidence normalize into one layer",
      ["fromGitHubEvidence", "fromAgentRun", "fromRoute", "createManualEntry"].every((fragment) => serviceSource.includes(fragment)),
      "Normalizer does not cover the required Part 2 source domains"
    ),
    check(
      "engineering_evidence_foundation_views",
      "readiness_views",
      "Mock/Real, seams, branch/deploy, and TODO/FIXME foundation views exist",
      ["listMockRealRegistry", "listIntegrationSeams", "listBranchDeployTruth", "listTodoFixme"].every((fragment) =>
        serviceSource.includes(fragment)
      ),
      "Required foundation views are missing"
    ),
    check(
      "engineering_evidence_truth_safety",
      "truth_safety",
      "Engineering evidence remains evidence and cannot mutate Product Brain, Live Doc, or proposals",
      serviceSource.includes("Engineering evidence is evidence, not Product Brain truth") &&
        serviceSource.includes("truthMutationAllowed: false") &&
        !serviceSource.match(/acceptProposal|rejectProposal|applyAcceptedProposal|rebuildProductBrain|updateLiveDoc|createAcceptedDecision/i),
      "Truth-mutation guardrails are absent or suspicious mutation calls exist"
    ),
    check(
      "engineering_evidence_no_github_writes",
      "read_only",
      "Part 2 does not implement GitHub writes or auto-merge",
      serviceSource.includes("githubWritesAllowed: false") &&
        !serviceSource.match(/createPullRequest|createBranch|createCommit|mergePullRequest|requestReview|createComment|triggerDeployment/i),
      "GitHub write behavior appears to be present"
    ),
    check(
      "engineering_evidence_routes_contract",
      "api_contract",
      "Project-scoped Engineering Evidence APIs are registered",
      [
        "/engineering-evidence",
        "/engineering-evidence/refresh",
        "/engineering-evidence/sources",
        "/mock-real-registry",
        "/integration-seams",
        "/branch-deploy-truth",
        "/todo-fixme"
      ].every((fragment) => routesSource.includes(fragment)),
      "Engineering Evidence route contract is incomplete"
    ),
    check(
      "engineering_evidence_secret_redaction",
      "secret_safety",
      "Manual/text evidence redacts secret-like content and stores no token/private-key fields",
      serviceSource.includes("function redact") &&
        !evidenceSchemaSource.match(/accessToken|refreshToken|privateKey|webhookSecret|clientSecret|oauthToken/i),
      "Secret redaction is missing or schema appears to store credential fields"
    ),
    check(
      "engineering_evidence_safe_config",
      "configuration",
      "Content scanning is disabled by default and allowlist-bounded",
      envSource.includes('ENGINEERING_EVIDENCE_CONTENT_SCAN_ENABLED: booleanString("false")') &&
        envSource.includes("ENGINEERING_EVIDENCE_SCAN_PATH_ALLOWLIST"),
      "Engineering evidence content scanning defaults are unsafe or unconfigured"
    ),
    check(
      "engineering_evidence_docs_scope",
      "documentation",
      "Docs state Part 2 is not the full FDE dashboard or truth mutation system",
      docsSource.includes("Engineering evidence is evidence, not Product Brain truth") &&
        docsSource.includes("does not implement full Conflict Radar") &&
        docsSource.includes("does not write to GitHub"),
      "Engineering Evidence docs are missing critical scope/truth/no-write statements"
    )
  ];

  const passed = cases.filter((item) => item.passed).length;
  const failed = cases.filter((item) => !item.passed);
  const outputDir = path.resolve("evals", "outputs");
  await mkdir(outputDir, { recursive: true });
  const report = {
    suite: "engineering-evidence",
    generatedAt: new Date().toISOString(),
    summary: { total: cases.length, passed, failed: failed.length },
    cases,
    gate: { passed: failed.length === 0, reasons: failed.flatMap((item) => item.reasons) }
  };
  await writeFile(path.join(outputDir, "engineering-evidence-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    path.join(outputDir, "engineering-evidence-report.md"),
    [
      "# Engineering Evidence Eval Report",
      "",
      `Generated at: ${report.generatedAt}`,
      "",
      `Passed: ${passed}/${cases.length}`,
      "",
      ...cases.map((item) => `- ${item.passed ? "PASS" : "FAIL"} ${item.id}: ${item.title}${item.reasons.length ? ` (${item.reasons.join("; ")})` : ""}`)
    ].join("\n")
  );

  console.log(`Engineering Evidence evals: ${passed}/${cases.length} passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main();

async function findEngineeringEvidenceMigrationDir() {
  const root = path.resolve("prisma", "migrations");
  const entries = await readdir(root, { withFileTypes: true });
  const migration = entries
    .filter((entry) => entry.isDirectory() && entry.name.includes("engineering_evidence_index"))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!migration) {
    throw new Error("Engineering Evidence Index migration not found");
  }
  return path.join(root, migration);
}
