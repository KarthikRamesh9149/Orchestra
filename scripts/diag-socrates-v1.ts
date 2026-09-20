/**
 * Focused end-to-end proof for the beta-web chat's real Socrates path.
 * Signs up → creates a project → uploads a PDF → waits for processing →
 * calls POST /v1/projects/:id/socrates/v1/ask (plain + source-scoped),
 * exactly the endpoint ChatPage now uses via api.askSocratesV1.
 *
 * Requires the dev server running on $BASE (default http://localhost:3030)
 * with a real OPENAI_API_KEY and BETA flags enabled.
 */
import { File } from "node:buffer";
import { createSocratesPdfFixture as makePdf } from "./lib/pdf-fixtures.js";

const BASE = process.env.BASE ?? "http://localhost:3030";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("  ✗ FAIL:", msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log("  ✓", msg);
}

async function req(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { Accept: "application/json" };
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body)
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!res.ok || parsed?.error) {
    throw new Error(`HTTP ${method} ${path} → ${res.status}: ${JSON.stringify(parsed?.error ?? parsed)?.slice(0, 300)}`);
  }
  return parsed?.data ?? parsed;
}

async function main() {
  console.log(`Socrates v1 chat proof against ${BASE}\n`);

  const stamp = Date.now();
  console.log("1) signup…");
  const signup = await req("POST", "/v1/auth/signup", {
    orgName: `Socrates Proof ${stamp}`,
    email: `socrates-proof-${stamp}@example.com`,
    password: `SocratesProof!${stamp}xStrong`,
    displayName: "Socrates Proof"
  });
  const token = signup.accessToken as string;
  assert(typeof token === "string" && token.length > 0, "signup returns access token");

  console.log("\n2) create project…");
  const project = await req("POST", "/v1/projects", { name: `Socrates Proof ${stamp}`, description: "chat proof" }, token);
  const projectId = project.id as string;
  assert(typeof projectId === "string", "project created");

  console.log("\n3) upload PDF into project memory…");
  const form = new FormData();
  form.append("title", "Socrates Proof Memory");
  form.append("kind", "reference");
  form.append("visibility", "internal");
  form.append("file", new File([await makePdf()], "socrates-proof.pdf", { type: "application/pdf" }));
  const uploaded = await req("POST", `/v1/projects/${projectId}/documents/upload`, form, token);
  const docId = uploaded.documentId as string;
  assert(typeof docId === "string", "document uploaded");

  console.log("\n4) wait for processing (parse → chunk → embed)…");
  const deadline = Date.now() + 90000;
  let status = "";
  while (Date.now() < deadline) {
    const doc = await req("GET", `/v1/projects/${projectId}/documents/${docId}`, undefined, token);
    status = doc.parseStatus ?? doc.currentVersion?.status ?? "";
    if (status === "ready" || status === "partial") break;
    if (status === "failed") throw new Error("document processing failed");
    await new Promise((r) => setTimeout(r, 2000));
  }
  assert(status === "ready" || status === "partial", `document processed (status=${status})`);

  console.log("\n5) ask Socrates v1 (plain, All scope)…");
  const a1 = await req("POST", `/v1/projects/${projectId}/socrates/v1/ask`, {
    question: "What did the team decide about authentication for the beta?",
    includeArtifacts: false,
    mode: "ask"
  }, token);
  console.log("   answer:", String(a1.answer_md).slice(0, 220).replace(/\n/g, " "));
  console.log("   citations:", (a1.citations ?? []).length, "| suggested:", (a1.suggested_prompts ?? []).length, "| confidence:", a1.confidence);
  assert(typeof a1.answer_md === "string" && a1.answer_md.length > 0, "v1 ask returns a grounded answer");
  assert(Array.isArray(a1.citations) && a1.citations.length > 0, "v1 ask returns citations from uploaded memory");
  assert(/magic|oauth|auth/i.test(a1.answer_md), "answer reflects the uploaded auth decision (real evidence)");

  console.log("\n6) ask Socrates v1 with Docs scope (selectedSources)…");
  const a2 = await req("POST", `/v1/projects/${projectId}/socrates/v1/ask`, {
    question: "What is still out of scope for the beta?",
    selectedSources: ["documents", "live_doc"],
    includeArtifacts: false,
    mode: "ask"
  }, token);
  console.log("   answer:", String(a2.answer_md).slice(0, 220).replace(/\n/g, " "));
  assert(typeof a2.answer_md === "string" && a2.answer_md.length > 0, "source-scoped ask returns an answer");

  console.log("\n7) citation shape matches the frontend mapping…");
  const c = (a1.citations ?? [])[0];
  assert(c && typeof c.label === "string", "citation has a label (rendered as chip)");
  assert("excerpt" in c, "citation has an excerpt (rendered on expand)");

  console.log(`\n✅ SOCRATES V1 CHAT PROOF PASSED — project ${projectId}`);
}

main().catch((e) => { console.error("\n❌ PROOF ERROR:", e instanceof Error ? e.message : e); process.exitCode = 1; });
