#!/usr/bin/env node

import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_WEB_URL = "http://localhost:5173";
const DEFAULT_API_URL = "http://localhost:3000";
const DEFAULT_CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const webUrl = stripTrailingSlash(process.env.BETA_WEB_URL ?? DEFAULT_WEB_URL);
const apiUrl = stripTrailingSlash(process.env.BETA_API_URL ?? DEFAULT_API_URL);
const webOrigin = new URL(webUrl).origin;
const email = process.env.BETA_TEST_EMAIL;
const password = process.env.BETA_TEST_PASSWORD;
const projectPattern = new RegExp(process.env.BETA_TEST_PROJECT_PATTERN ?? "orchestra test", "i");
// This is an end-to-end staging budget: it includes cold service wake-up,
// durable conversation creation, navigation, SSE, and the persisted answer.
// Unit and API tests keep the local greeting shortcut independently fast.
const maxSimpleChatMs = Number(process.env.BETA_SIMPLE_CHAT_MAX_MS ?? 30000);
const allowMissingPlaywright = process.argv.includes("--allow-missing-playwright");

if (!email || !password) {
  fail("BETA_TEST_EMAIL and BETA_TEST_PASSWORD are required for authenticated browser smoke.");
}

const playwright = await loadPlaywright();
if (!playwright) {
  if (allowMissingPlaywright) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "playwright_not_available" }, null, 2));
    process.exit(0);
  }
  fail("Playwright is not installed. Set ORCHESTRA_PLAYWRIGHT_PATH to a local playwright module or install playwright.");
}

const { chromium } = playwright;
const configuredExecutable = process.env.PLAYWRIGHT_CHROME_EXECUTABLE || (existsSync(DEFAULT_CHROME) ? DEFAULT_CHROME : undefined);
const browser = await chromium.launch({
  headless: process.env.BETA_BROWSER_HEADLESS !== "false",
  ...(configuredExecutable ? { executablePath: configuredExecutable } : {})
});
const browserContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const csrf = await browserApi(browserContext.request, "/v1/auth/csrf");
await browserApi(browserContext.request, "/v1/auth/login", {
  method: "POST",
  headers: { origin: webOrigin, "x-csrf-token": csrf.csrfToken },
  data: { email, password, sessionMode: "browser" }
});
const projectsData = await browserApi(browserContext.request, "/v1/projects");
const projects = Array.isArray(projectsData) ? projectsData : projectsData?.projects ?? [];
const project = projects.find((item) => projectPattern.test(item.name ?? "")) ?? projects[0];
if (!project) fail("No project is available for the authenticated smoke user.");

const page = await browserContext.newPage();
const consoleErrors = [];
const badResponses = [];
const failedRequests = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("response", async (response) => {
  if (response.status() >= 400) {
    const item = { status: response.status(), url: redactUrl(response.url()), code: null, message: null };
    badResponses.push(item);
    const payload = await response.json().catch(() => null);
    item.code = payload?.error?.code ?? null;
    item.message = payload?.error?.message ?? null;
  }
});
page.on("requestfailed", (request) => {
  const error = request.failure()?.errorText ?? "request_failed";
  // A route change intentionally cancels loaders and prefetches from the page
  // being left. Keep genuine network failures, but do not fail release proof
  // on Chromium's expected navigation cancellation signal.
  if (error !== "net::ERR_ABORTED") failedRequests.push({ url: redactUrl(request.url()), error });
});

await page.goto(`${webUrl}/workspaces`, { waitUntil: "domcontentloaded", timeout: 45000 });
await settle(page);
const workspaceButton = page.getByRole("button").filter({ hasText: project.name }).first();
await workspaceButton.waitFor({ state: "visible", timeout: 20000 });
await workspaceButton.click();
// A cold isolated staging service can spend ~10 seconds waking before the
// authoritative session rotation completes. Keep this bounded, but do not
// misclassify an honest cold start as a broken workspace selection.
try {
  await page.waitForURL(/\/(?:memory|client-workspace)(?:\/|$)/, { timeout: 45000 });
} catch {
  const body = await page.locator("body").innerText().catch(() => "");
  const currentUrl = page.url();
  await browser.close();
  fail(JSON.stringify({
    reason: "workspace_selection_timeout",
    url: currentUrl,
    visibleError: body.match(/Workspace access[^\n]*|Could not open workspace[^\n]*|Request failed[^\n]*/i)?.[0] ?? null,
    badResponses: badResponses.slice(-8),
    failedRequests: failedRequests.slice(-8),
    consoleErrors: consoleErrors.slice(-8)
  }));
}
await settle(page);
const selectedWorkspaceUrl = page.url();

const pages = [];
for (const route of ["/dashboard", "/memory", "/truth-inbox", "/delivery", "/github", "/connectors", "/timeline", "/suggestions", "/settings", "/profile"]) {
  const startedAt = Date.now();
  await page.goto(`${webUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await settle(page);
  const body = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  pages.push({
    route,
    ms: Date.now() - startedAt,
    roughLoadingCopy: /Loading Mission Control|Loading GitHub|Loading timeline|Loading suggestions|Loading profile|Loading workspace settings|Loading project memory|Opening workspace/i.test(body),
    debugCopy: /OAuth not configured|Showing cached Watchtower|Internal server error|Choose File\s+No file chosen/i.test(body)
  });
}

await page.goto(`${webUrl}/chat`, { waitUntil: "domcontentloaded", timeout: 45000 });
await settle(page);
const input = page.getByPlaceholder("Ask Socrates anything about your project…");
await input.waitFor({ state: "visible", timeout: 20000 });
const chatStartedAt = Date.now();
await input.fill("wassup");
await page.getByRole("button", { name: "Send message" }).click();
// The first message creates a durable conversation and navigates from /chat to
// /chat/:sessionId. Wait through that intentional context replacement before
// asserting the persisted assistant response.
await page.waitForURL(/\/chat\/[0-9a-f-]{36}$/i, { timeout: 15000 });
await page.waitForFunction(() => {
  const text = document.body.innerText.toLowerCase();
  return text.includes("hey. i'm here") || text.includes("hey. i’m here");
}, null, { timeout: maxSimpleChatMs }).catch(() => undefined);
const simpleChatMs = Date.now() - chatStartedAt;
const socratesBody = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
const simpleChatAnswered = /hey\. i(?:'|’)m here\./i.test(socratesBody);
const simpleChatUsedEvidence = /Engineering status|Operational status|Watchtower note|Evidence gap|GitHub evidence shows/i.test(socratesBody);
const simpleChatPreview = socratesBody.slice(-800);

await browser.close();

const result = {
  ok:
    /\/(?:memory|client-workspace)(?:\/|$)/.test(new URL(selectedWorkspaceUrl).pathname) &&
    pages.every((item) => !item.roughLoadingCopy && !item.debugCopy) &&
    simpleChatAnswered &&
    simpleChatMs <= maxSimpleChatMs &&
    !simpleChatUsedEvidence &&
    consoleErrors.length === 0 &&
    badResponses.length === 0 &&
    failedRequests.length === 0,
  webUrl,
  apiUrl,
  project: { id: project.id, name: project.name },
  workspaceSelection: { ok: /\/(?:memory|client-workspace)(?:\/|$)/.test(new URL(selectedWorkspaceUrl).pathname), url: selectedWorkspaceUrl },
  pages,
  simpleChat: { answered: simpleChatAnswered, ms: simpleChatMs, maxMs: maxSimpleChatMs, usedEvidence: simpleChatUsedEvidence, preview: simpleChatPreview },
  badResponses: badResponses.slice(0, 12),
  failedRequests: failedRequests.slice(0, 12),
  consoleErrors: consoleErrors.slice(0, 12)
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

async function browserApi(requestContext, path, options = {}) {
  // Browser sessions are host-bound. Exercise the same frontend /v1 proxy
  // that a real browser uses so the secure cookie never crosses domains.
  const response = await requestContext.fetch(`${webUrl}${path}`, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    fail(`${path} returned non-JSON ${response.status()}: ${text.slice(0, 160)}`);
  }
  if (!response.ok() || body.error) {
    fail(`${path} failed ${response.status()}: ${body.error?.code ?? ""} ${body.error?.message ?? ""}`.trim());
  }
  return body.data;
}

async function loadPlaywright() {
  const explicitPath = process.env.ORCHESTRA_PLAYWRIGHT_PATH;
  const candidates = [
    explicitPath,
    process.env.TEMP ? `${process.env.TEMP}/orchestra-playwright/node_modules/playwright/index.mjs` : null,
    "playwright"
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const imported = await import(candidate.startsWith(".") || candidate.includes(":") || candidate.startsWith("/")
        ? pathToFileURL(candidate).href
        : candidate);
      return imported.chromium ? imported : imported.default;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function settle(targetPage) {
  await targetPage.waitForLoadState("domcontentloaded");
  await targetPage.waitForFunction(() => !document.body.innerText.includes("Opening workspace"), null, { timeout: 15000 }).catch(() => undefined);
  await targetPage.waitForTimeout(900);
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|code|state|password/i.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return value;
  }
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}
