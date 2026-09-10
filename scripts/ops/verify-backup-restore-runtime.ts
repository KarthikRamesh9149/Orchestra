import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

type RunOptions = { env?: NodeJS.ProcessEnv; capture?: boolean };

async function run(command: string, args: string[], options: RunOptions = {}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...options.env },
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} ${args[0] ?? ""} failed (${code}): ${stderr.trim()}`));
    });
  });
}

function requireDisposableDatabase(value: string | undefined) {
  const url = new URL(value ?? "postgresql://invalid/invalid");
  const database = url.pathname.slice(1);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !database.includes("release")) {
    throw new Error("backup/restore proof requires a disposable local release database");
  }
  return { url, database };
}

async function discoverContainer() {
  if (process.env.RELEASE_POSTGRES_CONTAINER) return process.env.RELEASE_POSTGRES_CONTAINER;
  const byImage = await run("docker", ["ps", "--filter", "ancestor=pgvector/pgvector:pg17", "--format", "{{.ID}}"], { capture: true });
  const byPort = byImage || await run("docker", ["ps", "--filter", "publish=5432", "--format", "{{.ID}}"], { capture: true });
  const id = byPort.split(/\s+/).filter(Boolean)[0];
  if (!id) throw new Error("no disposable pgvector:pg17 container was found");
  return id;
}

async function main() {
  const { url, database } = requireDisposableDatabase(process.env.DATABASE_URL);
  const container = await discoverContainer();
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const restoredDatabase = `${database}_restored_${Date.now()}`.replace(/[^a-zA-Z0-9_]/g, "_");
  const dumpPath = `/tmp/fix33-${Date.now()}.dump`;
  const dockerEnv = ["exec", "-e", `PGPASSWORD=${password}`, container];
  const marker = `fix33-${Date.now()}`;

  await run("docker", [...dockerEnv, "psql", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-c",
    `CREATE TABLE IF NOT EXISTS fix33_recovery_marker (value text PRIMARY KEY); TRUNCATE fix33_recovery_marker; INSERT INTO fix33_recovery_marker(value) VALUES ('${marker}');`]);
  await run("docker", [...dockerEnv, "pg_dump", "-U", user, "-d", database, "--format=custom", `--file=${dumpPath}`]);
  await run("docker", [...dockerEnv, "createdb", "-U", user, restoredDatabase]);
  try {
    await run("docker", [...dockerEnv, "pg_restore", "-U", user, "-d", restoredDatabase, "--no-owner", "--no-privileges", dumpPath]);
    await run("docker", [...dockerEnv, "psql", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-c",
      "INSERT INTO fix33_recovery_marker(value) VALUES ('post-backup-change');"]);
    const restored = await run("docker", [...dockerEnv, "psql", "-U", user, "-d", restoredDatabase, "-Atc",
      "SELECT value FROM fix33_recovery_marker ORDER BY value"], { capture: true });
    const sourceCount = await run("docker", [...dockerEnv, "psql", "-U", user, "-d", database, "-Atc",
      "SELECT count(*) FROM fix33_recovery_marker"], { capture: true });
    if (restored !== marker || sourceCount !== "2") {
      throw new Error(`restored snapshot was not point-in-time exact: ${JSON.stringify({ restored, sourceCount })}`);
    }
    await mkdir("artifacts/ops", { recursive: true });
    const artifactPath = "artifacts/ops/fix33-database-backup.dump";
    await run("docker", ["cp", `${container}:${dumpPath}`, artifactPath]);
    const report = {
      ok: true,
      liveProof: true,
      target: "disposable_local_postgres",
      canonicalMigrationsRestored: true,
      pointInTimeMarkerRestored: true,
      sourceChangedAfterBackup: true,
      backupArtifact: artifactPath
    };
    await writeFile("artifacts/ops/fix33-backup-restore.json", `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await run("docker", [...dockerEnv, "dropdb", "-U", user, "--if-exists", restoredDatabase]).catch(() => undefined);
    await run("docker", ["exec", container, "rm", "-f", dumpPath]).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? `Fix 33 backup/restore failed: ${error.message}` : String(error));
  process.exitCode = 1;
});
