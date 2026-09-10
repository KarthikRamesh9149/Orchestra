import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export type Fix32Journey = {
  id: string;
  requirement: string;
  command: string;
  evidence: string[];
};

export const FIX32_JOURNEYS: Fix32Journey[] = [
  { id: "identity", requirement: "signup, invitation, logout/login, and workspace switching", command: "remediation:identity:runtime", evidence: ["global user", "organization membership"] },
  { id: "authorization", requirement: "cross-tenant and role enforcement", command: "remediation:authorization:runtime", evidence: ["tenant isolation", "client truth boundary"] },
  { id: "invitation", requirement: "new and existing account invitation completion", command: "remediation:invitation:runtime", evidence: ["exactly-once redemption", "durable membership"] },
  { id: "browser-session", requirement: "browser login, rotation, logout, and revocation", command: "remediation:session:runtime", evidence: ["HttpOnly session", "replay rejection"] },
  { id: "workspace", requirement: "workspace switching and client-role preservation", command: "remediation:workspace-session:runtime", evidence: ["active workspace reload", "session metadata"] },
  { id: "persistence", requirement: "project, subscription, document ingestion/viewer, private upload, and worker persistence", command: "remediation:staging:runtime", evidence: ["fresh login reload", "worker/vector completion"] },
  { id: "launch-loop", requirement: "project/team, proposal acceptance, Product Brain and Live Doc update", command: "remediation:truth-loop:runtime", evidence: ["accepted proposal", "new truth version"] },
  { id: "beta-api", requirement: "Dashboard, Memory, Timeline, Watchtower, Socrates persistence, streaming, citations, and connectors", command: "smoke:beta:http", evidence: ["citations/open targets", "release-gated providers"] },
  { id: "deep-research", requirement: "Deep Research progress, result, Add to Memory, and export", command: "remediation:deep-research:runtime", evidence: ["completed run", "saved artifact id"] },
  { id: "beta-browser", requirement: "authenticated production-build frontend journeys and reload", command: "smoke:beta:browser", evidence: ["route rendering", "no console/API failures"] }
];

const commandOverrides: Record<string, string[]> = {
  "smoke:beta:http": ["run", "smoke:beta:http"],
  "smoke:beta:browser": ["run", "smoke:beta:browser"]
};

function requireStagingUrl(name: string, value: string | undefined) {
  const url = value?.replace(/\/+$/, "") ?? "";
  if (!url.startsWith("https://") || !/staging/i.test(url)) throw new Error(`${name} must be an isolated HTTPS staging URL`);
  return url;
}

export function buildFix32Environment(env: NodeJS.ProcessEnv = process.env) {
  const apiUrl = requireStagingUrl("BETA_SMOKE_BASE_URL", env.BETA_SMOKE_BASE_URL ?? env.SMOKE_BASE_URL);
  const webUrl = requireStagingUrl("BETA_WEB_URL", env.BETA_WEB_URL);
  const nonce = Date.now();
  return {
    ...env,
    BETA_SMOKE_BASE_URL: apiUrl,
    BETA_SMOKE_ALLOW_SIGNUP: "true",
    BETA_SMOKE_MANAGER_EMAIL: env.BETA_SMOKE_MANAGER_EMAIL ?? `fix32-beta-${nonce}@example.com`,
    BETA_SMOKE_MANAGER_PASSWORD: env.BETA_SMOKE_MANAGER_PASSWORD ?? `Fix32Beta-${nonce}-Strong!`,
    BETA_SMOKE_TIMEOUT_MS: env.BETA_SMOKE_TIMEOUT_MS ?? "240000",
    BETA_WEB_URL: webUrl,
    BETA_API_URL: apiUrl,
    BETA_TEST_EMAIL: env.BETA_TEST_EMAIL ?? env.BETA_SMOKE_MANAGER_EMAIL ?? `fix32-beta-${nonce}@example.com`,
    BETA_TEST_PASSWORD: env.BETA_TEST_PASSWORD ?? env.BETA_SMOKE_MANAGER_PASSWORD ?? `Fix32Beta-${nonce}-Strong!`,
    SMOKE_BASE_URL: apiUrl,
    SMOKE_ORG_NAME: env.SMOKE_ORG_NAME ?? `Fix 32 Staging ${nonce}`,
    SMOKE_MANAGER_EMAIL: env.SMOKE_MANAGER_EMAIL ?? `fix32-manager-${nonce}@example.com`,
    SMOKE_MANAGER_PASSWORD: env.SMOKE_MANAGER_PASSWORD ?? `Fix32Manager-${nonce}-Strong!`,
    SMOKE_DEV_EMAIL: env.SMOKE_DEV_EMAIL ?? `fix32-dev-${nonce}@example.com`,
    SMOKE_DEV_PASSWORD: env.SMOKE_DEV_PASSWORD ?? `Fix32Dev-${nonce}-Strong!`,
    SMOKE_CLIENT_EMAIL: env.SMOKE_CLIENT_EMAIL ?? `fix32-client-${nonce}@example.com`,
    SMOKE_CLIENT_PASSWORD: env.SMOKE_CLIENT_PASSWORD ?? `Fix32Client-${nonce}-Strong!`,
    SMOKE_PROJECT_NAME: env.SMOKE_PROJECT_NAME ?? `Fix 32 Launch Loop ${nonce}`,
    SMOKE_TIMEOUT_MS: env.SMOKE_TIMEOUT_MS ?? "240000",
    SMOKE_EXPECT_AI: "true",
    SMOKE_EXPECT_WORKER: "true",
    SMOKE_KEEP_DATA: "false"
  };
}

async function executeJourney(journey: Fix32Journey, env: NodeJS.ProcessEnv) {
  const args = commandOverrides[journey.command] ?? ["run", journey.command];
  const startedAt = Date.now();
  process.stdout.write(`\n[Fix 32] ${journey.id}: ${journey.requirement}\n`);
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn("npm", args, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  if (exitCode !== 0) throw new Error(`${journey.id} failed with exit code ${exitCode}`);
  return { id: journey.id, status: "passed", durationMs: Date.now() - startedAt, evidence: journey.evidence };
}

async function main() {
  if (process.argv.includes("--plan")) {
    console.log(JSON.stringify({ ok: true, liveProof: false, journeys: FIX32_JOURNEYS }, null, 2));
    return;
  }
  const env = buildFix32Environment();
  const results = [];
  for (const journey of FIX32_JOURNEYS) results.push(await executeJourney(journey, env));
  console.log(JSON.stringify({ ok: true, liveProof: true, environment: "isolated_staging", journeys: results }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? `Fix 32 staging E2E failed: ${error.message}` : String(error));
    process.exitCode = 1;
  });
}
