import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStagingAtRepositoryHead } from "./validate-staging-isolation.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const RELEASE_GOVERNANCE_PATH = resolve(repoRoot, "docs/remediation/release-governance.json");

export type ReleaseGovernance = {
  schemaVersion: number;
  repository: string;
  productionBranch: string;
  remediationBranch: string;
  requiredChecks: string[];
  productionDeployment: {
    automaticSourceConnected: boolean;
    allowedSourceBranch: string;
    requiresManualApproval: boolean;
    remediationBranchForbidden: boolean;
    frozenDeploymentIds: { api: string; frontend: string };
  };
  stagingDeployment: {
    allowedSourceBranch: string;
    allowedSourceBranches: string[];
    productionDataAllowed: boolean;
    productionSecretsAllowed: boolean;
  };
  mergeGate: {
    singleFinalMerge: boolean;
    historyPreserved: boolean;
    zeroUnresolvedSeverities: string[];
    requiredFinalFix: number;
  };
  evidence: { artifactRetentionDays: number; requiredCategories: string[] };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validateReleaseGovernance(path = RELEASE_GOVERNANCE_PATH): ReleaseGovernance {
  const policy = JSON.parse(readFileSync(path, "utf8")) as ReleaseGovernance;
  assert(policy.schemaVersion === 1, "release governance schemaVersion must be 1");
  assert(policy.productionBranch === "mvp-beta-beta", "production branch is not canonical");
  assert(policy.remediationBranch === "mvp-beta-beta-beta-beta", "remediation branch is not canonical");
  assert(policy.productionDeployment.automaticSourceConnected === false, "production auto-deploy must remain disconnected");
  assert(policy.productionDeployment.allowedSourceBranch === policy.productionBranch, "production source branch is unsafe");
  assert(policy.productionDeployment.requiresManualApproval === true, "production deploys require manual approval");
  assert(policy.productionDeployment.remediationBranchForbidden === true, "remediation branch must be forbidden from production");
  assert(policy.stagingDeployment.allowedSourceBranch === policy.remediationBranch, "staging must use the remediation branch");
  assert(
    policy.stagingDeployment.allowedSourceBranches.includes(policy.stagingDeployment.allowedSourceBranch),
    "canonical remediation branch is missing from staging source allowlist"
  );
  assert(
    policy.stagingDeployment.allowedSourceBranches.includes("codex/mvp-beta-beta-audit-20260824"),
    "current isolated audit branch is missing from staging source allowlist"
  );
  assert(
    !policy.stagingDeployment.allowedSourceBranches.includes(policy.productionBranch),
    "production branch must never appear in the staging source allowlist"
  );
  assert(policy.stagingDeployment.productionDataAllowed === false, "production data must be forbidden in staging");
  assert(policy.stagingDeployment.productionSecretsAllowed === false, "production secrets must be forbidden in staging");
  assert(policy.mergeGate.singleFinalMerge === true, "release must use one final merge");
  assert(policy.mergeGate.historyPreserved === true, "release must preserve remediation history");
  assert(policy.mergeGate.requiredFinalFix === 35, "production merge cannot be authorized before Fix 35");
  assert(
    JSON.stringify(policy.mergeGate.zeroUnresolvedSeverities) === JSON.stringify(["P0", "P1", "P2", "P3"]),
    "merge gate must require zero unresolved P0-P3 issues"
  );
  for (const check of ["quality-and-security", "frontend-browser-tests", "fresh-database-migrations", "release-runtime-proof"]) {
    assert(policy.requiredChecks.includes(check), `missing required check: ${check}`);
  }
  for (const category of ["tests", "evaluations", "migrations", "security", "adversarial", "smoke", "browser", "load", "recovery"]) {
    assert(policy.evidence.requiredCategories.includes(category), `missing evidence category: ${category}`);
  }
  assert(policy.evidence.artifactRetentionDays >= 30, "CI evidence must be retained for at least 30 days");

  const ci = readFileSync(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8");
  for (const required of [
    policy.remediationBranch,
    "quality-and-security",
    "frontend-browser-tests",
    "fresh-database-migrations",
    "release-runtime-proof",
    "pgvector/pgvector:pg17",
    "scripts/ops/ci-postgres-bootstrap.sql",
    "npm run prisma:deploy",
    "npm run typecheck",
    "npm run build",
    "npm run beta:web:test",
    "npm run beta:web:test:e2e",
    "npm test --",
    "npm run eval:all",
    "npm run audit:all",
    "npm run security:scan:local",
    "npm run remediation:adversarial:check",
    "npm run smoke:backend:mock",
    "npm run smoke:mvp:mock",
    "npm run smoke:beta:mock",
    "npm run remediation:backup-restore:runtime",
    "npm run remediation:worker-recovery:runtime",
    "actions/upload-artifact@v4"
  ]) {
    assert(ci.includes(required), `CI is missing required gate: ${required}`);
  }
  assert(!/railway\s+(?:up|deploy|redeploy)/i.test(ci), "CI must never deploy to Railway");
  assert(!/^\s*environment:\s*production\s*$/im.test(ci), "CI must never target the production environment");
  return policy;
}

export function assertDeploymentAllowed(
  target: "staging" | "production",
  sourceBranch: string,
  approved: boolean,
  assertStagingParity: () => unknown = assertStagingAtRepositoryHead
) {
  const policy = validateReleaseGovernance();
  if (target === "staging") {
    assert(
      policy.stagingDeployment.allowedSourceBranches.includes(sourceBranch),
      "only an explicitly isolated remediation, feature, or audit branch may deploy to staging"
    );
    return;
  }
  assert(sourceBranch === policy.productionDeployment.allowedSourceBranch, "only the production branch may deploy to production");
  assert(sourceBranch !== policy.remediationBranch, "the remediation branch may never deploy directly to production");
  assert(approved, "production deployment requires an explicit manual approval");
  assertStagingParity();
}

function option(name: string) {
  const entry = process.argv.slice(2).find((value) => value.startsWith(`${name}=`));
  return entry?.slice(name.length + 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const target = option("--target");
  if (target === "production" || target === "staging") {
    const branch = process.env.DEPLOY_SOURCE_BRANCH ?? process.env.GITHUB_REF_NAME ?? "";
    assertDeploymentAllowed(target, branch, process.env.RELEASE_APPROVED === "true");
  } else {
    validateReleaseGovernance();
  }
  console.log("Release governance validation passed.");
}
