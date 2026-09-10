/**
 * Integration-surface sanity check: signs up, creates a project, and exercises
 * every /v1 endpoint the beta-web pages depend on, asserting each responds with
 * the expected shape (not 404/500). Proves the frontend's API surface is live.
 * Requires the dev server on $BASE (default http://localhost:3030).
 */
const BASE = process.env.BASE ?? "http://localhost:3030";

let pass = 0;
let fail = 0;

async function req(method: string, path: string, body: unknown, token: string | undefined, expect: number[] = [200]) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, ok: expect.includes(res.status), data: parsed?.data ?? parsed, raw: parsed };
}

function check(label: string, cond: unknown, detail?: string) {
  if (cond) { pass++; console.log("  ✓", label); }
  else { fail++; console.error("  ✗", label, detail ? `— ${detail}` : ""); }
}

async function main() {
  console.log(`Integration surface check against ${BASE}\n`);
  const stamp = Date.now();
  const signup = await req("POST", "/v1/auth/signup", {
    orgName: `Integ ${stamp}`, email: `integ-${stamp}@example.com`, password: `Integ!${stamp}xStrong`, displayName: "Integ"
  }, undefined);
  const token = signup.data?.accessToken as string;
  check("auth: signup issues token", typeof token === "string" && token.length > 0);
  const project = await req("POST", "/v1/projects", { name: `Integ ${stamp}` }, token);
  const pid = project.data?.id as string;
  check("projects: create", typeof pid === "string");

  const P = `/v1/projects/${pid}`;
  const reads: Array<[string, string, (d: any) => boolean]> = [
    ["auth: me", "/v1/auth/me", (d) => typeof d?.id === "string"],
    ["profile: me/profile", "/v1/me/profile", (d) => d != null],
    ["profile: sessions", "/v1/me/sessions", (d) => Array.isArray(d) || Array.isArray(d?.items) || d != null],
    ["dashboard: mission-control", `${P}/mission-control`, (d) => Array.isArray(d?.stats)],
    ["timeline", `${P}/timeline`, (d) => Array.isArray(d?.items)],
    ["memory: documents", `${P}/documents`, (d) => Array.isArray(d)],
    ["settings: integrations/status", `${P}/integrations/status`, (d) => Array.isArray(d?.providers ?? d)],
    ["comms: connectors/readiness", `${P}/connectors/readiness`, (d) => Array.isArray(d)],
    ["comms: connectors list", `${P}/connectors`, (d) => Array.isArray(d)],
    ["team: members", `${P}/members`, (d) => Array.isArray(d?.members ?? d)],
    ["deep-research: usage", `${P}/deep-research/usage`, (d) => typeof d?.limit === "number"],
    ["socrates: recent-queries", `${P}/socrates/recent-queries`, (d) => Array.isArray(d?.items ?? d)],
    ["vscode: connector status", `${P}/editor-connectors/vscode/status`, (d) => Array.isArray(d?.connectors)],
    ["settings: project settings", `${P}/settings`, (d) => d != null]
  ];

  console.log("\nRead surface:");
  for (const [label, path, shape] of reads) {
    try {
      const r = await req("GET", path, undefined, token);
      check(`${label} → 200`, r.ok, `status ${r.status}`);
      if (r.ok) check(`${label} shape`, shape(r.data), JSON.stringify(r.data)?.slice(0, 120));
    } catch (e) {
      check(`${label} → 200`, false, (e as Error).message);
    }
  }

  console.log("\nWrite / action surface:");
  const pairing = await req("POST", `${P}/editor-connectors/vscode/pairings`, { label: "Integ" }, token);
  check("vscode: create pairing", pairing.ok && typeof pairing.data?.pairingCode === "string", `status ${pairing.status}`);

  const slack = await req("POST", `${P}/connectors/slack/connect`, { returnTo: "/connectors" }, token, [200, 503]);
  const slackOk = slack.status === 200 ? typeof slack.data?.redirectUrl === "string" : slack.raw?.error?.code === "communication_provider_not_ready";
  check("slack: connect (redirect or honest degrade)", slack.ok && slackOk, `status ${slack.status}`);

  const dr = await req("POST", `${P}/deep-research`, { researchFocus: "beta readiness signals", sources: ["docs"], outputFormat: "exec_summary" }, token, [200, 202, 429]);
  check("deep-research: start (accepted or capped)", dr.ok, `status ${dr.status}`);

  console.log(`\n${fail === 0 ? "✅" : "❌"} Integration surface: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error("\n❌ ERROR:", e instanceof Error ? e.message : e); process.exitCode = 1; });
