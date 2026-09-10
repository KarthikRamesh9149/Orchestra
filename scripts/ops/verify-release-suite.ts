import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export type ReleaseSuitePhase = {
  id: string;
  requirement: string;
  command: string;
  proof: "local" | "isolated_database" | "isolated_redis" | "isolated_staging";
};

export const FIX33_RELEASE_PHASES: ReleaseSuitePhase[] = [
  { id: "clean-install", requirement: "clean dependency installation", command: "npm ci", proof: "local" },
  { id: "generate-validate", requirement: "Prisma generation and schema validation", command: "npm run prisma:generate && npx prisma validate", proof: "local" },
  { id: "fresh-migrations", requirement: "canonical migrations on a fresh PostgreSQL database", command: "npx prisma db execute --file scripts/ops/ci-postgres-bootstrap.sql --schema prisma/schema.prisma && npm run prisma:deploy", proof: "isolated_database" },
  { id: "typecheck-build", requirement: "typecheck and all application builds", command: "npm run typecheck && npm run build && npm run beta:vscode:build", proof: "local" },
  { id: "tests", requirement: "backend and frontend tests", command: "npm test && npm run beta:web:test", proof: "local" },
  { id: "evaluations", requirement: "all deterministic evaluation suites", command: "npm run eval:all", proof: "local" },
  { id: "dependency-security", requirement: "dependency audit and local security scan", command: "npm run audit:all && npm run security:scan:local", proof: "local" },
  { id: "backend-smoke", requirement: "backend launch-loop smoke", command: "npm run smoke:backend:mock", proof: "local" },
  { id: "mvp-smoke", requirement: "MVP API smoke", command: "npm run smoke:mvp:mock", proof: "local" },
  { id: "beta-smoke", requirement: "live beta API smoke", command: "npm run smoke:beta:http", proof: "isolated_staging" },
  { id: "connector-smoke", requirement: "connector lifecycle smoke", command: "npm run smoke:connectors:fireflies:mock", proof: "local" },
  { id: "browser-smoke", requirement: "authenticated browser smoke", command: "npm run smoke:beta:browser", proof: "isolated_staging" },
  { id: "load-concurrency", requirement: "bounded concurrent API load", command: "npm run remediation:load:runtime", proof: "isolated_staging" },
  { id: "backup-restore", requirement: "point-in-time logical backup and restore rehearsal", command: "npm run remediation:backup-restore:runtime", proof: "isolated_database" },
  { id: "worker-recovery", requirement: "Redis worker retry across worker restart", command: "npm run remediation:worker-recovery:runtime", proof: "isolated_redis" }
];

export function assertReleaseRuntimeSafety(env: NodeJS.ProcessEnv = process.env) {
  const stagingUrl = (env.BETA_SMOKE_BASE_URL ?? "").toLowerCase();
  if (!stagingUrl.startsWith("https://") || !stagingUrl.includes("staging")) {
    throw new Error("Fix 33 requires an isolated HTTPS staging API URL");
  }
  if (/production|orchestrav2-production/.test(stagingUrl)) {
    throw new Error("Fix 33 refuses production API targets");
  }
  const databaseUrl = new URL(env.DATABASE_URL ?? "postgresql://invalid/invalid");
  if (!["localhost", "127.0.0.1"].includes(databaseUrl.hostname) || !databaseUrl.pathname.includes("release")) {
    throw new Error("Fix 33 database proof requires a local disposable release database");
  }
  const redisUrl = new URL(env.RELEASE_TEST_REDIS_URL ?? "redis://invalid");
  if (!["localhost", "127.0.0.1"].includes(redisUrl.hostname)) {
    throw new Error("Fix 33 worker proof requires local disposable Redis");
  }
}

async function run(command: string, env: NodeJS.ProcessEnv) {
  const [executable, ...args] = command.split(" ");
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(executable, args, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
  });
  if (code !== 0) throw new Error(`${command} failed with exit code ${code}`);
}

async function main() {
  if (process.argv.includes("--plan")) {
    console.log(JSON.stringify({ ok: true, liveProof: false, phases: FIX33_RELEASE_PHASES }, null, 2));
    return;
  }
  assertReleaseRuntimeSafety();
  const results: Array<{ id: string; durationMs: number; status: "passed" }> = [];
  for (const phase of FIX33_RELEASE_PHASES) {
    const started = Date.now();
    process.stdout.write(`\n[Fix 33] ${phase.id}: ${phase.requirement}\n`);
    // Commands are deliberately split in the matrix so each step is independently auditable.
    for (const command of phase.command.split(" && ")) await run(command, process.env);
    results.push({ id: phase.id, durationMs: Date.now() - started, status: "passed" });
  }
  console.log(JSON.stringify({ ok: true, liveProof: true, phases: results }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? `Fix 33 release suite failed: ${error.message}` : String(error));
    process.exitCode = 1;
  });
}
