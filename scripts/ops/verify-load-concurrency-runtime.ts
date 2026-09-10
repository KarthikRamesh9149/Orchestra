import { mkdir, writeFile } from "node:fs/promises";

type Sample = { status: number; durationMs: number };

function requireStagingUrl(value: string | undefined) {
  const normalized = value?.replace(/\/+$/, "") ?? "";
  if (!normalized.startsWith("https://") || !/staging/i.test(normalized) || /production/i.test(normalized)) {
    throw new Error("load proof requires an isolated HTTPS staging URL and refuses production");
  }
  return normalized;
}

async function request(url: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function concurrentSamples(total: number, concurrency: number, task: () => Promise<number>) {
  const samples: Sample[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < total) {
      cursor += 1;
      const started = performance.now();
      const status = await task();
      samples.push({ status, durationMs: performance.now() - started });
    }
  }));
  return samples;
}

function percentile(values: number[], percentileValue: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)] ?? 0;
}

async function main() {
  const baseUrl = requireStagingUrl(process.env.BETA_SMOKE_BASE_URL);
  const nonce = Date.now();
  const signup = await request(`${baseUrl}/v1/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      orgName: `Fix 33 Load ${nonce}`,
      email: `fix33-load-${nonce}@example.com`,
      password: `Fix33Load-${nonce}-Strong!`,
      displayName: "Fix 33 Load Probe"
    })
  });
  const token = signup.body?.data?.accessToken;
  if (signup.status >= 300 || typeof token !== "string") throw new Error(`staging signup failed with HTTP ${signup.status}`);

  const health = await concurrentSamples(120, 16, async () => (await request(`${baseUrl}/health`)).status);
  const authenticated = await concurrentSamples(80, 12, async () => (
    await request(`${baseUrl}/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } })
  ).status);
  const all = [...health, ...authenticated];
  const failures = all.filter((sample) => sample.status !== 200);
  const p95Ms = percentile(all.map((sample) => sample.durationMs), 0.95);
  const thresholdMs = Number(process.env.RELEASE_LOAD_P95_MS ?? 2_000);

  const report = {
    ok: failures.length === 0 && p95Ms <= thresholdMs,
    liveProof: true,
    target: "isolated_staging",
    totalRequests: all.length,
    concurrency: { health: 16, authenticated: 12 },
    failures: failures.length,
    p95Ms: Number(p95Ms.toFixed(1)),
    healthP95Ms: Number(percentile(health.map((sample) => sample.durationMs), 0.95).toFixed(1)),
    authenticatedP95Ms: Number(percentile(authenticated.map((sample) => sample.durationMs), 0.95).toFixed(1)),
    thresholdMs
  };
  await mkdir("artifacts/ops", { recursive: true });
  await writeFile("artifacts/ops/fix33-load-concurrency.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (failures.length > 0) throw new Error(`${failures.length}/${all.length} load requests failed`);
  if (p95Ms > thresholdMs) throw new Error(`p95 ${p95Ms.toFixed(1)}ms exceeded ${thresholdMs}ms`);
}

main().catch((error) => {
  console.error(error instanceof Error ? `Fix 33 load proof failed: ${error.message}` : String(error));
  process.exitCode = 1;
});
