#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
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
const maxSimpleChatMs = Number(process.env.BETA_SIMPLE_CHAT_MAX_MS ?? 1500);
const maxEvidenceChatMs = Number(process.env.BETA_EVIDENCE_CHAT_MAX_MS ?? 30000);
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.resolve("output", `live-product-walkthrough-${runId}`);

if (!email || !password) {
  fail("BETA_TEST_EMAIL and BETA_TEST_PASSWORD are required for authenticated product walkthrough.");
}

await mkdir(outDir, { recursive: true });

const playwright = await loadPlaywright();
if (!playwright) {
  fail("Playwright is not installed. Set ORCHESTRA_PLAYWRIGHT_PATH to a local playwright module or install playwright.");
}

const { chromium } = playwright;
const browser = await chromium.launch({
  headless: process.env.BETA_BROWSER_HEADLESS !== "false",
  executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE || DEFAULT_CHROME,
  args: ["--disable-web-security", "--disable-features=IsolateOrigins,site-per-process"]
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
if (!project) fail("No project is available for the authenticated walkthrough user.");

const page = await browserContext.newPage();
const consoleErrors = [];
const badResponses = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("response", (response) => {
  if (response.status() >= 400) badResponses.push({ status: response.status(), url: redactUrl(response.url()) });
});

await page.addInitScript(({ project, email: userEmail }) => {
  window.localStorage.setItem(
    "orchestra_workspace",
    JSON.stringify({
      state: {
        userRole: "manager",
        profileName: "Karthik Ramesh",
        profileEmail: userEmail,
        workspaceName: project.name,
        activeProjectId: project.id,
        onboardingComplete: true
      },
      version: 0
    })
  );
}, { project: { id: project.id, name: project.name }, email });

const routeChecks = [
  { route: "/dashboard", required: [/Mission Control/i], readyAbsent: [/—\s+PROJECT MEMORY|—\s+COMMUNICATIONS|—\s+TIMELINE|—\s+TEAM/], premiumReject: [/Opening workspace|Loading Mission Control|—\s+PROJECT MEMORY|—\s+COMMUNICATIONS|—\s+TIMELINE|—\s+TEAM/i] },
  { route: "/memory", required: [/Add project documents|Source documents|Project memory/i], premiumReject: [/Choose File\s+No file chosen|Loading project memory/i] },
  { route: "/timeline", required: [/Every manual event|Project memory/i], readyAbsent: [/Project memory is updating/i], premiumReject: [/Timeline could not load|Internal server error|Project memory is updating/i] },
  { route: "/suggestions", required: [/What Socrates noticed|PM Watchtower|Suggestions/i], premiumReject: [/Showing cached Watchtower|Internal server error/i] },
  { route: "/github", required: [/Code Status|GitHub/i], readyAbsent: [/REPOSITORY\s+—|OPEN PRS\s+—|CONFLICT RISKS\s+—/], premiumReject: [/Internal server error|Invalid refresh token|REPOSITORY\s+—|OPEN PRS\s+—|CONFLICT RISKS\s+—/i] },
  { route: "/connectors", required: [/Connectors|GitHub|Google Drive/i], readyAbsent: [/Checking Slack/i], premiumReject: [/OAuth not configured|manual_import_available_live_api_gated|Status comes from|Checking Slack/i] },
  { route: "/settings", required: [/Workspace settings|Team access/i], premiumReject: [/Loading workspace settings/i] },
  { route: "/profile", required: [/Account settings|Notifications|Sessions/i], requiredAll: [new RegExp(escapeRegExp(email), "i")], premiumReject: [/Loading profile/i] }
];

const routes = [];
for (const check of routeChecks) {
  const startedAt = Date.now();
  await page.goto(`${webUrl}${check.route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await settle(page);
  await page.waitForFunction(
    (patterns) => {
      const text = document.body.innerText;
      return patterns.some((source) => new RegExp(source, "i").test(text));
    },
    check.required.map((pattern) => pattern.source),
    { timeout: 25000 }
  ).catch(() => undefined);
  if (check.requiredAll?.length) {
    await page.waitForFunction(
      (patterns) => {
        const text = document.body.innerText;
        return patterns.every((source) => new RegExp(source, "i").test(text));
      },
      check.requiredAll.map((pattern) => pattern.source),
      { timeout: 25000 }
    ).catch(() => undefined);
  }
  if (check.readyAbsent?.length) {
    await page.waitForFunction(
      (patterns) => {
        const text = document.body.innerText;
        return patterns.every((source) => !new RegExp(source, "i").test(text));
      },
      check.readyAbsent.map((pattern) => pattern.source),
      { timeout: 25000 }
    ).catch(() => undefined);
  }
  const body = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  const screenshot = path.join(outDir, `${check.route.replace("/", "") || "home"}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  routes.push({
    route: check.route,
    ms: Date.now() - startedAt,
    screenshot,
    hasRequiredCopy:
      check.required.some((pattern) => pattern.test(body)) &&
      (check.requiredAll?.every((pattern) => pattern.test(body)) ?? true),
    premiumRejects: check.premiumReject.filter((pattern) => pattern.test(body)).map(String),
    bodySample: body.replace(/\s+/g, " ").slice(0, 240)
  });
}

await page.goto(`${webUrl}/socrates`, { waitUntil: "domcontentloaded", timeout: 45000 });
await settle(page);
await page.screenshot({ path: path.join(outDir, "socrates-ready.png"), fullPage: true });
await page.getByRole("button", { name: /new chat/i }).first().click({ timeout: 10000 }).catch(() => undefined);
await page.waitForTimeout(300);

const input = page.locator('textarea, input[placeholder*="Ask"], [contenteditable="true"]').last();
await input.waitFor({ state: "visible", timeout: 20000 });

const simpleStartedAt = Date.now();
await input.fill("wassup");
await page.keyboard.press("Enter");
await page.waitForFunction(() => document.body.innerText.toLowerCase().includes("hey. i'm here"), null, { timeout: 15000 });
const simpleChatMs = Date.now() - simpleStartedAt;
const afterSimple = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
const simpleChatUsedEvidence = /Engineering status|Operational status|Watchtower note|Evidence gap|GitHub evidence shows/i.test(afterSimple);

const evidenceQuestion = "Give me a launch-readiness summary using the PRD, communications, timeline, GitHub, and approvals. Include what you cannot confirm.";
const evidenceStartedAt = Date.now();
await input.fill(evidenceQuestion);
await page.keyboard.press("Enter");
await page.waitForFunction(() => {
  const text = document.body.innerText;
  return document.querySelectorAll('[data-testid="socrates-sources"]').length > 0 &&
    /cannot confirm|can't confirm|not confirm|evidence/i.test(text) &&
    !/Writing the answer with citations/i.test(text);
}, null, { timeout: maxEvidenceChatMs + 10000 }).catch(() => undefined);
await settle(page);
const evidenceChatMs = Date.now() - evidenceStartedAt;
const afterEvidence = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
const evidenceSourceBlockCount = await page.locator('[data-testid="socrates-sources"]').count();
await page.screenshot({ path: path.join(outDir, "socrates-evidence-answer.png"), fullPage: true });

await browser.close();

const result = {
  ok:
    routes.every((route) => route.hasRequiredCopy && route.premiumRejects.length === 0) &&
    simpleChatMs <= maxSimpleChatMs &&
    !simpleChatUsedEvidence &&
    evidenceChatMs <= maxEvidenceChatMs + 10000 &&
    evidenceSourceBlockCount > 0 &&
    /cannot confirm|can't confirm|not confirm|evidence/i.test(afterEvidence) &&
    consoleErrors.length === 0 &&
    badResponses.length === 0,
  webUrl,
  apiUrl,
  project: { id: project.id, name: project.name },
  outDir,
  routes,
  socrates: {
    simpleChat: { ms: simpleChatMs, maxMs: maxSimpleChatMs, usedEvidence: simpleChatUsedEvidence },
    evidenceChat: {
      ms: evidenceChatMs,
      maxMs: maxEvidenceChatMs,
      hasCitations: evidenceSourceBlockCount > 0,
      sourceBlocks: evidenceSourceBlockCount,
      hasHonestGap: /cannot confirm|can't confirm|not confirm|evidence/i.test(afterEvidence),
      answerSample: extractAfter(afterEvidence, evidenceQuestion).slice(0, 900)
    }
  },
  badResponses: badResponses.slice(0, 12),
  consoleErrors: consoleErrors.slice(0, 12)
};

await writeFile(path.join(outDir, "report.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

async function browserApi(requestContext, pathname, options = {}) {
  // Browser sessions are host-bound. Exercise the same frontend /v1 proxy
  // that a real browser uses so the secure cookie never crosses domains.
  const response = await requestContext.fetch(`${webUrl}${pathname}`, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    fail(`${pathname} returned non-JSON ${response.status()}: ${text.slice(0, 160)}`);
  }
  if (!response.ok() || body.error) {
    fail(`${pathname} failed ${response.status()}: ${body.error?.code ?? ""} ${body.error?.message ?? ""}`.trim());
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractAfter(text, marker) {
  const index = text.indexOf(marker);
  return (index >= 0 ? text.slice(index + marker.length) : text).replace(/\s+/g, " ").trim();
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}
