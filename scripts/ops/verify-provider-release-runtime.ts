type Envelope = { data?: unknown; error?: { code?: string } | null };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("staging API returned an invalid object");
  return value as Record<string, unknown>;
}

async function api(baseUrl: string, path: string, init: RequestInit = {}, token?: string, expectedStatus: number | number[] = 200) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(30_000) });
  const envelope = await response.json() as Envelope;
  const expectedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`${init.method ?? "GET"} ${path} returned ${response.status} (${envelope.error?.code ?? "unknown"})`);
  }
  return envelope;
}

async function main() {
  const baseUrl = (process.env.BETA_SMOKE_BASE_URL ?? process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
  if (!baseUrl.startsWith("https://") || !/staging/i.test(baseUrl)) {
    throw new Error("Fix 31 runtime verification requires an HTTPS staging URL");
  }

  const nonce = Date.now();
  const signup = await api(baseUrl, "/v1/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      orgName: `Fix 31 Provider Gate ${nonce}`,
      email: `fix31-provider-gate-${nonce}@example.com`,
      password: `Fix31Provider!${nonce}Strong`,
      displayName: "Fix 31 Runtime Manager"
    })
  });
  const token = String(object(signup.data).accessToken ?? "");
  if (!token) throw new Error("staging signup did not return an access token");

  const projectResponse = await api(baseUrl, "/v1/projects", {
    method: "POST",
    body: JSON.stringify({ name: `Fix 31 Provider Gate ${nonce}`, description: "Synthetic staging provider capability proof" })
  }, token);
  const projectId = String(object(projectResponse.data).id ?? "");
  if (!projectId) throw new Error("staging project creation did not return an id");

  const status = object((await api(baseUrl, `/v1/projects/${projectId}/integrations/status`, {}, token)).data);
  const providers = Array.isArray(status.providers) ? status.providers.map(object) : [];
  const externalStatusProviders = new Set(["slack", "clickup", "granola", "fireflies_ai", "google_calendar", "google_drive", "github"]);
  for (const provider of providers) {
    const id = String(provider.provider ?? "");
    const actions = Array.isArray(provider.availableActions) ? provider.availableActions.map(String) : [];
    if (externalStatusProviders.has(id) && (actions.includes("connect") || actions.includes("sync"))) {
      throw new Error(`${id} remained actionable without live validation`);
    }
  }
  const vscode = providers.find((provider) => provider.provider === "vscode");
  if (!vscode || !Array.isArray(vscode.availableActions) || !vscode.availableActions.includes("connect")) {
    throw new Error("VS Code first-party pairing was not actionable");
  }

  const readinessEnvelope = await api(baseUrl, `/v1/projects/${projectId}/connectors/readiness`, {}, token);
  const readiness = Array.isArray(readinessEnvelope.data) ? readinessEnvelope.data.map(object) : [];
  const externalCommunicationProviders = new Set([
    "slack", "microsoft_teams", "notion", "fireflies_ai", "clickup", "granola", "zoho_mail", "zoho_cliq", "zoho_crm"
  ]);
  for (const entry of readiness) {
    const id = String(entry.provider ?? "");
    if (!externalCommunicationProviders.has(id)) continue;
    const release = object(entry.readiness);
    const reasons = Array.isArray(release.reasons) ? release.reasons.map(String) : [];
    if (release.canConnect !== false || release.canSync !== false || !reasons.includes("provider_live_validation_required")) {
      throw new Error(`${id} communication readiness did not fail closed`);
    }
  }

  const blockedConnect = await api(
    baseUrl,
    `/v1/projects/${projectId}/connectors/slack/connect`,
    { method: "POST", body: JSON.stringify({ returnTo: "/settings" }) },
    token,
    [404, 503]
  );
  if (!new Set(["feature_disabled_in_beta", "communication_provider_not_ready"]).has(String(blockedConnect.error?.code))) {
    throw new Error("direct Slack connect did not return a fail-closed provider contract");
  }

  console.log(JSON.stringify({
    ok: true,
    liveProof: true,
    environment: "isolated_staging",
    projectId,
    checks: [
      "external provider Connect and Sync actions absent",
      "communication readiness fail-closed reason present",
      "direct external connect rejected server-side",
      "VS Code first-party pairing remains available",
      "no credential or token value emitted"
    ]
  }, null, 2));
}

await main();
