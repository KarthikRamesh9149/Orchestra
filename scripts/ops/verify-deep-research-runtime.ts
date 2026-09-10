type Envelope = { data?: unknown; error?: { code?: string; message?: string } | null };

function object(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("API returned an invalid object");
  return value as Record<string, unknown>;
}

async function request(baseUrl: string, path: string, init: RequestInit = {}, token?: string, responseType: "json" | "bytes" = "json") {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(120_000) });
  if (responseType === "bytes") {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    return bytes;
  }
  const body = (await response.json()) as Envelope;
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} returned ${response.status} (${body.error?.code ?? "unknown_error"})`);
  return body.data;
}

async function main() {
  const baseUrl = (process.env.BETA_SMOKE_BASE_URL ?? process.env.SMOKE_BASE_URL ?? "").replace(/\/+$/, "");
  if (!baseUrl.startsWith("https://") || !/staging/i.test(baseUrl)) throw new Error("Deep Research proof requires an isolated HTTPS staging URL");
  const nonce = Date.now();
  const email = `fix32-research-${nonce}@example.com`;
  const password = `Fix32Research-${nonce}-Strong!`;
  const signup = object(await request(baseUrl, "/v1/auth/signup", { method: "POST", body: JSON.stringify({ orgName: `Fix 32 Research ${nonce}`, email, password, displayName: "Fix 32 Researcher" }) }));
  const firstToken = String(signup.accessToken ?? "");
  if (!firstToken) throw new Error("Deep Research signup did not return an access token");
  const project = object(await request(baseUrl, "/v1/projects", { method: "POST", body: JSON.stringify({ name: `Fix 32 Research ${nonce}`, description: "Synthetic staging research journey" }) }, firstToken));
  const projectId = String(project.id ?? "");
  if (!projectId) throw new Error("Deep Research project creation did not return an id");
  const started = object(await request(baseUrl, `/v1/projects/${projectId}/deep-research`, {
    method: "POST",
    body: JSON.stringify({ researchFocus: "release readiness evidence and onboarding reliability", sources: ["docs", "web"], outputFormat: "full_report", privacyMode: "internal_plus_web", webSearchEnabled: true })
  }, firstToken));
  const runId = String(started.id ?? "");
  if (!runId) throw new Error("Deep Research start did not return a run id");

  let run: Record<string, unknown> | null = null;
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    run = object(await request(baseUrl, `/v1/projects/${projectId}/deep-research/${runId}`, {}, firstToken));
    const status = String(run.status ?? "");
    if (status === "completed") break;
    if (status === "failed") throw new Error(`Deep Research worker failed: ${String(run.error ?? "unknown")}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (run?.status !== "completed") throw new Error("Deep Research did not complete before the bounded deadline");
  const results = object(run.results);
  if (typeof results.executiveSummary !== "string" || !Array.isArray(results.findings) || !Array.isArray(results.sources)) throw new Error("Deep Research result is missing structured report fields");
  if (JSON.stringify(results.sources).match(/chunk[_ -]?id/i)) throw new Error("Deep Research exposed raw chunk identifiers");

  const saved = object(await request(baseUrl, `/v1/projects/${projectId}/deep-research/${runId}/add-to-memory`, { method: "POST", body: JSON.stringify({}) }, firstToken));
  const memoryEntryId = String(saved.memoryEntryId ?? saved.artifactId ?? "");
  if (saved.success !== true || !memoryEntryId) throw new Error("Add to Memory did not return the authoritative saved artifact id");
  const markdown = (await request(baseUrl, `/v1/projects/${projectId}/deep-research/${runId}/export?format=markdown`, {}, firstToken, "bytes")) as Uint8Array;
  if (markdown.byteLength < 100) throw new Error("Deep Research export was empty");

  const login = object(await request(baseUrl, "/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }));
  const secondToken = String(login.accessToken ?? "");
  if (!secondToken || secondToken === firstToken) throw new Error("fresh login did not rotate the access token");
  const reloaded = object(await request(baseUrl, `/v1/projects/${projectId}/deep-research/${runId}`, {}, secondToken));
  if (reloaded.status !== "completed" || String(reloaded.id ?? "") !== runId) throw new Error("Deep Research result did not survive a fresh login");

  console.log(JSON.stringify({ ok: true, liveProof: true, environment: "isolated_staging", projectId, runId, status: "completed", memoryEntryId, exportBytes: markdown.byteLength, freshLoginReload: true }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? `Fix 32 Deep Research runtime failed: ${error.message}` : String(error));
  process.exitCode = 1;
});
