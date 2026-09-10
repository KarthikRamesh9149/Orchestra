import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STAGING_MANIFEST_PATH = resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
  "docs/remediation/staging-manifest.json"
);
const CANONICAL_MIGRATIONS_PATH = resolve(fileURLToPath(new URL("../../", import.meta.url)), "prisma/migrations");

type Manifest = {
  schemaVersion: number;
  status: string;
  sourceBranch: string;
  branchPointSha: string;
  dataPolicy: Record<string, unknown>;
  supabase: Record<string, unknown>;
  railway: {
    projectId: string;
    productionEnvironmentId: string;
    stagingEnvironmentId: string;
    services: Record<string, { serviceId: string; publicUrl: string; verified: boolean }>;
  };
  oauth: Record<string, unknown>;
  verification: Record<string, unknown>;
  contractProof: Record<string, unknown>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function repositoryMigrationCount() {
  return readdirSync(CANONICAL_MIGRATIONS_PATH, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).length;
}

export function validateStagingIsolation(path = STAGING_MANIFEST_PATH): Manifest {
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;
  assert(manifest.schemaVersion === 1, "staging manifest schemaVersion must be 1");
  assert(manifest.status === "verified", "staging manifest is not verified");
  assert(manifest.sourceBranch !== "mvp-beta-beta", "production branch must never deploy to isolated staging");
  assert(
    /^(mvp-new-features|mvp-beta-beta-beta-beta|codex\/(?:mvp-beta-beta-audit-\d{8}|preflight-invites-mcp-\d{8}))$/.test(manifest.sourceBranch),
    "staging source branch is not an approved isolated remediation or feature branch"
  );
  assert(/^[0-9a-f]{40}$/.test(manifest.branchPointSha), "staging branch-point SHA is invalid");

  const data = manifest.dataPolicy;
  assert(data.classification === "synthetic_only", "staging data must be synthetic only");
  assert(data.productionDataCopied === false, "production data must never be copied to staging");
  assert(data.productionSecretsReused === false, "production secrets must never be reused in staging");
  assert(data.sensitiveValuesMatchingProduction === 0, "staging has sensitive values matching production");
  for (const key of ["organizations", "users", "projects", "memberships"]) {
    assert(Number.isInteger(data[key]) && Number(data[key]) > 0, `staging synthetic ${key} count is missing`);
  }

  const db = manifest.supabase;
  assert(typeof db.productionProjectRef === "string" && typeof db.stagingProjectRef === "string", "Supabase refs are missing");
  assert(db.productionProjectRef !== db.stagingProjectRef, "staging and production Supabase refs must differ");
  assert(db.status === "ACTIVE_HEALTHY", "staging Supabase project is not healthy");
  const canonicalMigrationCount = repositoryMigrationCount();
  const verifiedMigrationCount = manifest.contractProof.canonicalMigrations;
  assert(
    Number.isInteger(verifiedMigrationCount) && Number(verifiedMigrationCount) > 0,
    "staging migration proof is missing"
  );
  assert(
    db.canonicalMigrations === verifiedMigrationCount,
    "staging manifest and verified migration proof disagree"
  );
  assert(
    Number(verifiedMigrationCount) <= canonicalMigrationCount,
    "staging snapshot cannot contain migrations absent from the repository"
  );
  assert(db.privateStorageVerified === true, "private staging storage is not verified");

  const railway = manifest.railway;
  assert(railway.productionEnvironmentId !== railway.stagingEnvironmentId, "Railway staging and production environments must differ");
  const requiredServices = ["api", "worker", "redis", "frontend", "storage"];
  for (const name of requiredServices) {
    const service = railway.services[name];
    assert(service, `missing staging ${name} service`);
    assert(service.verified === true, `staging ${name} service is not verified`);
    assert(!service.serviceId.includes("pending"), `staging ${name} service id is pending`);
  }
  for (const name of ["api", "frontend"]) {
    const url = railway.services[name].publicUrl;
    assert(/^https:\/\//.test(url), `staging ${name} must have an HTTPS URL`);
  }

  assert(manifest.oauth.unconfiguredProvidersDisabled === true, "unconfigured staging OAuth providers must be disabled");
  assert(manifest.oauth.callbacksVerified === true, "staging OAuth callbacks are not verified");
  assert(/^https:\/\//.test(String(manifest.oauth.callbackBaseUrl)), "staging OAuth callback base URL is invalid");
  for (const [name, passed] of Object.entries(manifest.verification)) {
    assert(passed === true, `staging verification failed or is pending: ${name}`);
  }

  return manifest;
}

export function assertStagingAtRepositoryHead(path = STAGING_MANIFEST_PATH): Manifest {
  const manifest = validateStagingIsolation(path);
  const repositoryMigrations = repositoryMigrationCount();
  assert(
    manifest.supabase.canonicalMigrations === repositoryMigrations,
    `staging is not at repository head: verified ${String(manifest.supabase.canonicalMigrations)} of ${repositoryMigrations} migrations`
  );
  assert(
    manifest.contractProof.supabaseSuccessfulCanonicalMigrations === repositoryMigrations,
    "staging successful-migration proof is not at repository head"
  );
  assert(
    manifest.contractProof.supabasePendingCanonicalMigrations === 0,
    "staging has pending canonical migrations"
  );
  return manifest;
}
