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
  const migrationDir = await findGitHubMigrationDir();
  const [serviceSource, routesSource, schemaSource, migrationSource, envSource] = await Promise.all([
    readFile(path.resolve("src/modules/github/service.ts"), "utf8"),
    readFile(path.resolve("src/modules/github/routes.ts"), "utf8"),
    readFile(path.resolve("prisma/schema.prisma"), "utf8"),
    readFile(path.join(migrationDir, "migration.sql"), "utf8"),
    readFile(path.resolve("src/config/env.ts"), "utf8")
  ]);
  const githubSchemaSource = schemaSource.slice(
    schemaSource.indexOf("model GitHubInstallation"),
    schemaSource.indexOf("model JobRun")
  );

  const cases: EvalCase[] = [
    check(
      "github_read_only_mode",
      "truth_safety",
      "GitHub integration is read-first and denies write actions",
      serviceSource.includes("assertWriteActionDenied") &&
        serviceSource.includes("github_write_action_disabled") &&
        envSource.includes("Feature 13 Part 1 is read-only"),
      "Read-only/write-action denial guard is missing"
    ),
    check(
      "github_no_truth_mutation",
      "truth_safety",
      "GitHub evidence cannot mutate Product Brain, Live Doc, or proposals",
      serviceSource.includes("githubDataIsEngineeringEvidence") &&
        serviceSource.includes("productBrainMutationAllowed: false") &&
        serviceSource.includes("liveDocMutationAllowed: false") &&
        serviceSource.includes("proposalAcceptRejectAllowed: false") &&
        !serviceSource.match(/acceptProposal|rejectProposal|rebuildProductBrain|updateLiveDoc|createDecision/i),
      "Truth-mutation guardrails are absent or suspicious mutation calls exist"
    ),
    check(
      "github_webhook_signature",
      "webhook_security",
      "Webhook receiver verifies signatures and dedupes deliveries",
      routesSource.includes("/webhooks/github") &&
        serviceSource.includes("verifyGitHubWebhookSignature") &&
        serviceSource.includes("githubDeliveryId") &&
        serviceSource.includes("duplicate"),
      "Webhook signature or dedupe path is missing"
    ),
    check(
      "github_no_secret_storage",
      "secret_safety",
      "Schema does not store raw GitHub tokens, private keys, or webhook secrets",
      !githubSchemaSource.match(/accessToken|refreshToken|privateKey|webhookSecret|clientSecret|oauthToken/i) &&
        serviceSource.includes("tokenStored: false") &&
        migrationSource.includes("github_user_links"),
      "Schema appears to store a secret/token field or identity-only user linking is missing"
    ),
    check(
      "github_evidence_models",
      "evidence_contract",
      "Normalized engineering evidence preserves provenance fields",
      ["GitHubEngineeringEvidence", "evidenceType", "providerId", "sourceUrl", "citationJson", "openTargetJson"].every((fragment) =>
        schemaSource.includes(fragment)
      ),
      "Engineering evidence model is missing required provenance fields"
    ),
    check(
      "github_routes_contract",
      "api_contract",
      "Installation, repo mapping, user linking, webhook, backfill, and sync-run routes are registered",
      [
        "/github/readiness",
        "/github/install-url",
        "/github/installations",
        "/github/user-link",
        "/projects/:projectId/github/repositories/link",
        "/projects/:projectId/github/backfill",
        "/projects/:projectId/github/sync-runs",
        "/webhooks/github"
      ].every((fragment) => routesSource.includes(fragment)),
      "GitHub foundation route contract is incomplete"
    )
  ];

  const passed = cases.filter((item) => item.passed).length;
  const failed = cases.filter((item) => !item.passed);
  const outputDir = path.resolve("evals", "outputs");
  await mkdir(outputDir, { recursive: true });
  const report = {
    suite: "github-integration",
    generatedAt: new Date().toISOString(),
    summary: { total: cases.length, passed, failed: failed.length },
    cases,
    gate: { passed: failed.length === 0, reasons: failed.flatMap((item) => item.reasons) }
  };
  await writeFile(path.join(outputDir, "github-integration-report.json"), JSON.stringify(report, null, 2));
  await writeFile(
    path.join(outputDir, "github-integration-report.md"),
    [
      "# GitHub Integration Eval Report",
      "",
      `Generated at: ${report.generatedAt}`,
      "",
      `Passed: ${passed}/${cases.length}`,
      "",
      ...cases.map((item) => `- ${item.passed ? "PASS" : "FAIL"} ${item.id}: ${item.title}${item.reasons.length ? ` (${item.reasons.join("; ")})` : ""}`)
    ].join("\n")
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main();

async function findGitHubMigrationDir() {
  const root = path.resolve("prisma", "migrations");
  const entries = await readdir(root, { withFileTypes: true });
  const migration = entries
    .filter((entry) => entry.isDirectory() && entry.name.includes("github_integration_foundation"))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!migration) {
    throw new Error("GitHub integration foundation migration not found");
  }
  return path.join(root, migration);
}
