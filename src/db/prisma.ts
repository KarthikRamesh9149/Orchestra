import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __orchestraPrisma__: PrismaClient | undefined;
}

export function buildRuntimeDatabaseUrl(rawUrl = process.env.DATABASE_URL) {
  if (!rawUrl) return rawUrl;

  try {
    const parsed = new URL(rawUrl);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) return rawUrl;

    if (!parsed.searchParams.has("connection_limit")) {
      parsed.searchParams.set("connection_limit", process.env.PRISMA_CONNECTION_LIMIT ?? "3");
    }
    if (!parsed.searchParams.has("pool_timeout")) {
      parsed.searchParams.set("pool_timeout", process.env.PRISMA_POOL_TIMEOUT_SECONDS ?? "20");
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function createPrismaClient() {
  if (!global.__orchestraPrisma__) {
    const runtimeDatabaseUrl = buildRuntimeDatabaseUrl();
    global.__orchestraPrisma__ = runtimeDatabaseUrl
      ? new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl } } })
      : new PrismaClient();
  }

  return global.__orchestraPrisma__;
}

// Initialize the small startup working set before accepting traffic. Prisma
// still enforces the configured connection limit (including limits below 3).
// No user data or authorization result is cached. Failed probes fail startup.
export async function startAfterDatabaseReady<T>(probe: () => PromiseLike<unknown>, start: () => Promise<T>): Promise<T> {
  await Promise.all(Array.from({ length: 3 }, () => probe()));
  return start();
}

// Startup-only staging diagnostic. Never returns query results or connection details.
export async function measureStagingDatabaseLatency(
  deploymentEnv: string,
  probe: () => Promise<unknown>,
  now: () => number = Date.now
) {
  if (deploymentEnv !== "staging") return null;
  const samplesMs: number[] = [];
  try {
    for (let sample = 0; sample < 3; sample++) {
      const started = now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          probe(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 5_000); })
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      samplesMs.push(Math.max(0, now() - started));
    }
    return { ok: true, samplesMs };
  } catch {
    return { ok: false, samplesMs };
  }
}
