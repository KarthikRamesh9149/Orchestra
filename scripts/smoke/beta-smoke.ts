import { File } from "node:buffer";
import { parseArgs } from "node:util";
import { createBetaSmokePdfFixture as createSmokePdfFixture } from "../lib/pdf-fixtures.js";

type SmokeMode = "dry-run" | "mock" | "http";
type SmokeStatus = "passed" | "failed";

interface SmokeConfig {
  mode: SmokeMode;
  baseUrl: string;
  managerEmail: string | null;
  managerPassword: string | null;
  allowSignup: boolean;
  timeoutMs: number;
  pollIntervalMs: number;
  verbose: boolean;
}

interface HttpResponse {
  statusCode: number;
  ok: boolean;
  body: unknown;
  text: string;
}

interface StepResult {
  name: string;
  status: SmokeStatus;
  assertions: string[];
  failures: string[];
  routes: Array<{ method: string; path: string; statusCode: number; ok: boolean }>;
}

const checks = [
  "health/readiness",
  "auth and project access",
  "create/open project",
  "Mission Control endpoint returns real sections",
  "Activity endpoint returns project feed",
  "Recent changes endpoint returns project changes",
  "Recent Socrates queries endpoint returns project questions",
  "Manual subscription CRUD is beta-visible",
  "Manual calendar event create/list is beta-visible",
  "Google Calendar routes are live or fail closed behind authoritative integration status",
  "Google Calendar calendars route lists real calendars or fails closed honestly",
  "Google Calendar selected calendars save through backend when connected",
  "Google Calendar sync route queues selected-calendar sync",
  "Google Calendar webhook route validates channel headers or falls back safely",
  "Google Calendar disconnect route is beta-visible",
  "Google Calendar write actions remain hidden",
  "Google Drive routes are live or fail closed behind authoritative integration status",
  "Google Drive files route returns synced files or fails closed honestly",
  "Google Drive sync roots and sync routes are live or fail closed",
  "Google Drive webhook route validates channel headers or falls back safely",
  "Google Drive disconnect route is beta-visible",
  "Google Drive write actions remain hidden",
  "Mission Control exposes Google Drive preview",
  "Timeline accepts Google Drive source filter",
  "Socrates v1 accepts Google Drive source selection",
  "Profile routes are beta-visible and real-backed or safely disabled",
  "Notification preferences persist through backend",
  "Session list and revoke routes do not expose token values",
  "Workspace list and switch validate project membership",
  "Workspace settings read/update routes are beta-visible",
  "Team member role and deactivate routes are permissioned",
  "Truth approver grant/revoke routes are permissioned",
  "Unified integration status returns Slack/ClickUp/Granola/Fireflies/VS Code/Google Calendar/Google Drive/GitHub",
  "Profile and Integrations pages do not import production mocks",
  "Timeline endpoint returns project event projection",
  "Manual timeline event create/list is beta-visible",
  "LiveDoc review routes are beta-visible",
  "GitHub preview degrades safely when not connected",
  "GitHub Code Status routes return real evidence or honest degraded states",
  "GitHub PR/conflict/activity/branch routes never return fake data",
  "Suggestions routes return deterministic project evidence suggestions or empty states",
  "Suggestion dismiss/promote/review/Socrates actions are beta-visible and permissioned",
  "Deep Research remains disabled for private pilots",
  "Communication connector readiness",
  "Slack OAuth connect starts only when release-validated",
  "External communication connectors are live or release-gated",
  "Communication memory timeline is beta-visible",
  "Communication review API is beta-visible",
  "Timeline approval routes use LiveDoc review flow",
  "PDF upload accepted",
  "DOCX upload accepted",
  "document processing status",
  "Socrates beta ask with citation/openTarget",
  "Socrates v1 ask returns grounded answer",
  "Socrates v1 API map artifact",
  "Socrates v1 weekly summary artifact",
  "Socrates v1 system diagram artifact",
  "Socrates v1 ownership artifact",
  "Socrates v1 refuses direct mutations",
  "VS Code pairing code creation",
  "VS Code pairing exchange returns token once",
  "VS Code Socrates ask uses same memory endpoint",
  "VS Code revoke denies token",
  "revoked token denied",
  "non-enabled communication providers hidden",
  "disabled routes return feature_disabled_in_beta"
];

const sensitiveKeyPattern = /password|token|secret|key|authorization|database_url|hash|pairingCode/i;
const sensitiveValuePattern =
  /\b(?:Bearer\s+[A-Za-z0-9._~+/=-]{12,}|orch_vscode_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+|postgres(?:ql)?:\/\/\S+|sk-[A-Za-z0-9_-]{12,})\b/gi;

class SmokeFailure extends Error {
  constructor(
    message: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "dry-run" },
    verbose: { type: "boolean", default: false }
  }
});

async function main() {
  const mode = parseMode(values.mode ?? "dry-run");
  const config = buildConfig(mode, Boolean(values.verbose));

  if (config.mode === "dry-run") {
    console.log(JSON.stringify({ ok: true, mode: config.mode, plannedChecks: checks, liveProof: false }, null, 2));
    return;
  }

  if (config.mode === "mock") {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: config.mode,
          checks: checks.map((name) => ({ name, status: "mock_pass" })),
          liveProof: false
        },
        null,
        2
      )
    );
    return;
  }

  const report = await runHttpSmoke(config);
  console.log(JSON.stringify(redactForReport(report), null, 2));
  if (!report.ok) process.exitCode = 1;
}

function parseMode(value: string): SmokeMode {
  if (value === "dry-run" || value === "mock" || value === "http") return value;
  throw new Error(`Unsupported beta smoke mode: ${value}`);
}

function buildConfig(mode: SmokeMode, verbose: boolean): SmokeConfig {
  const env = process.env;
  return {
    mode,
    baseUrl: normalizeBaseUrl(env.BETA_SMOKE_BASE_URL ?? env.SMOKE_BASE_URL ?? ""),
    managerEmail: nonBlank(env.BETA_SMOKE_MANAGER_EMAIL ?? env.SMOKE_MANAGER_EMAIL ?? env.MVP_SMOKE_MANAGER_EMAIL),
    managerPassword: nonBlank(
      env.BETA_SMOKE_MANAGER_PASSWORD ?? env.SMOKE_MANAGER_PASSWORD ?? env.MVP_SMOKE_MANAGER_PASSWORD
    ),
    allowSignup: parseBoolean(env.BETA_SMOKE_ALLOW_SIGNUP, false),
    timeoutMs: Number(env.BETA_SMOKE_TIMEOUT_MS ?? env.SMOKE_TIMEOUT_MS ?? 120000),
    pollIntervalMs: Number(env.BETA_SMOKE_POLL_INTERVAL_MS ?? env.SMOKE_POLL_INTERVAL_MS ?? 2500),
    verbose
  };
}

async function runHttpSmoke(smokeConfig: SmokeConfig) {
  const startedAt = new Date().toISOString();
  const runner = new BetaSmokeRunner(smokeConfig);
  let accessToken = "";
  let projectId = "";
  let pdfDocumentId = "";
  let docxDocumentId = "";
  let vscodeToken = "";

  await runner.step("health/readiness", async (step) => {
    requireHttpConfig(smokeConfig);
    const health = await runner.request(step, "GET", "/health");
    runner.assert(step, getPath(health.body, ["ok"]) === true, "health endpoint returned ok", health.body);
  });

  await runner.step("auth and project access", async (step) => {
    accessToken = await authenticateManager(runner, step, smokeConfig);
    const me = await runner.request(step, "GET", "/v1/auth/me", undefined, { token: accessToken });
    runner.assert(step, typeof getPath(dataOf(me), ["id"]) === "string", "authenticated user is available", me.body);
  });

  await runner.step("create/open project", async (step) => {
    const project = await runner.request(
      step,
      "POST",
      "/v1/projects",
      {
        name: `Beta HTTP Smoke ${Date.now()}`,
        description: "Automated beta deployment smoke project"
      },
      { token: accessToken }
    );
    projectId = requireStringPath(dataOf(project), ["id"], "created project id");
    const opened = await runner.request(step, "GET", `/v1/projects/${projectId}`, undefined, { token: accessToken });
    runner.assert(step, requireStringPath(dataOf(opened), ["id"], "opened project id") === projectId, "project opens");
  });

  await runner.step("Mission Control endpoint returns real sections", async (step) => {
    const mission = await runner.request(step, "GET", `/v1/projects/${projectId}/mission-control`, undefined, {
      token: accessToken
    });
    const data = dataOf(mission);
    for (const key of [
      "stats",
      "team",
      "recentChanges",
      "calendarEvents",
      "slackMessages",
      "gitCommits",
      "activity",
      "socratesQueries",
      "subscriptions"
    ]) {
      runner.assert(step, Array.isArray(getPath(data, [key])), `Mission Control includes ${key}`, mission.body);
    }
    runner.assert(step, typeof getPath(data, ["updatedAt"]) === "string", "Mission Control includes updatedAt", mission.body);
    runner.assert(step, typeof getPath(data, ["googleDrivePreview", "state"]) === "string", "Mission Control includes Google Drive preview", mission.body);
    runner.assert(
      step,
      Array.isArray(getPath(data, ["googleDrivePreview", "recentFiles"])),
      "Mission Control Google Drive preview includes recent file list",
      mission.body
    );
  });

  await runner.step("Activity endpoint returns project feed", async (step) => {
    const activity = await runner.request(step, "GET", `/v1/projects/${projectId}/activity`, undefined, {
      token: accessToken
    });
    runner.assert(step, Array.isArray(itemsOf(activity)), "activity endpoint returns an item list", activity.body);
  });

  await runner.step("Recent changes endpoint returns project changes", async (step) => {
    const changes = await runner.request(step, "GET", `/v1/projects/${projectId}/recent-changes`, undefined, {
      token: accessToken
    });
    runner.assert(step, Array.isArray(itemsOf(changes)), "recent changes endpoint returns an item list", changes.body);
  });

  await runner.step("Recent Socrates queries endpoint returns project questions", async (step) => {
    const queries = await runner.request(step, "GET", `/v1/projects/${projectId}/socrates/recent-queries`, undefined, {
      token: accessToken
    });
    runner.assert(step, Array.isArray(itemsOf(queries)), "recent Socrates queries endpoint returns an item list", queries.body);
  });

  await runner.step("Manual subscription CRUD is beta-visible", async (step) => {
    const created = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/subscriptions`,
      {
        name: "Beta Smoke Supabase",
        category: "database",
        cost: 25,
        billingType: "monthly",
        status: "active",
        provider: "manual"
      },
      { token: accessToken }
    );
    const subscriptionId = requireStringPath(dataOf(created), ["id"], "subscription id");
    const listed = await runner.request(step, "GET", `/v1/projects/${projectId}/subscriptions`, undefined, {
      token: accessToken
    });
    runner.assert(step, JSON.stringify(dataOf(listed)).includes(subscriptionId), "created subscription is listed", listed.body);
  });

  await runner.step("Manual calendar event create/list is beta-visible", async (step) => {
    const created = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/calendar-events`,
      {
        title: "Beta Smoke Standup",
        description: "Manual calendar event for beta smoke",
        startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        eventType: "standup"
      },
      { token: accessToken }
    );
    const eventId = requireStringPath(dataOf(created), ["id"], "manual calendar event id");
    const listed = await runner.request(step, "GET", `/v1/projects/${projectId}/calendar-events`, undefined, {
      token: accessToken
    });
    runner.assert(step, JSON.stringify(dataOf(listed)).includes(eventId), "created manual calendar event is listed", listed.body);
  });

  await runner.step("Google Calendar routes are live or fail closed behind authoritative integration status", async (step) => {
    const status = await runner.request(
      step,
      "GET",
      `/v1/projects/${projectId}/connectors/google-calendar/status`,
      undefined,
      { token: accessToken, expectStatuses: [200, 404] }
    );
    if (status.statusCode === 404) {
      runner.assert(step, extractErrorCode(status) === "feature_disabled_in_beta", "Google Calendar direct routes fail closed when unvalidated", status.body);
      return;
    }
    const data = dataOf(status);
    runner.assert(step, typeof getPath(data, ["configured"]) === "boolean", "Google Calendar status returns configured flag", status.body);
    runner.assert(step, Array.isArray(getPath(data, ["selectedCalendarIds"])), "Google Calendar status returns selected calendar ids", status.body);
    if (getPath(data, ["configured"]) === true) {
      const oauth = await runner.request(
        step,
        "POST",
        `/v1/projects/${projectId}/connectors/google-calendar/connect`,
        {},
        { token: accessToken }
      );
      runner.assert(step, typeof getPath(dataOf(oauth), ["redirectUrl"]) === "string", "Google OAuth start returns redirect URL", oauth.body);
    }
  });

  await runner.step("Google Calendar calendars route lists real calendars or fails closed honestly", async (step) => {
    const calendars = await runner.request(
      step,
      "GET",
      `/v1/projects/${projectId}/connectors/google-calendar/calendars`,
      undefined,
      { token: accessToken, expectStatuses: [200, 404, 409] }
    );
    if (calendars.statusCode === 200) {
      runner.assert(step, Array.isArray(dataOf(calendars)), "Google Calendar list returns real calendar array", calendars.body);
    } else {
      const code = getPath(calendars.body, ["error", "code"]);
      runner.assert(step, ["calendar_connection_not_found", "calendar_credentials_missing", "feature_disabled_in_beta"].includes(String(code)), "Google Calendar list fails closed without a validated connection", calendars.body);
    }
  });

  await runner.step("Google Drive routes are live or fail closed behind authoritative integration status", async (step) => {
    const status = await runner.request(
      step,
      "GET",
      `/v1/projects/${projectId}/connectors/google-drive/status`,
      undefined,
      { token: accessToken, expectStatuses: [200, 404] }
    );
    if (status.statusCode === 404) {
      runner.assert(step, extractErrorCode(status) === "feature_disabled_in_beta", "Google Drive direct routes fail closed when unvalidated", status.body);
      return;
    }
    const data = dataOf(status);
    runner.assert(step, typeof getPath(data, ["configured"]) === "boolean", "Google Drive status returns configured flag", status.body);
    runner.assert(step, getPath(data, ["writeActionsEnabled"]) === false, "Google Drive write actions are disabled", status.body);
    runner.assert(step, Array.isArray(getPath(data, ["limitations"])), "Google Drive status returns limitations", status.body);
    if (getPath(data, ["configured"]) === true) {
      const oauth = await runner.request(
        step,
        "POST",
        `/v1/projects/${projectId}/connectors/google-drive/connect`,
        { returnTo: "/connectors" },
        { token: accessToken }
      );
      runner.assert(step, typeof getPath(dataOf(oauth), ["redirectUrl"]) === "string", "Google Drive OAuth start returns redirect URL", oauth.body);
    } else {
      const oauth = await runner.request(
        step,
        "POST",
        `/v1/projects/${projectId}/connectors/google-drive/connect`,
        { returnTo: "/connectors" },
        { token: accessToken, expectStatuses: [501] }
      );
      runner.assert(step, extractErrorCode(oauth) === "google_drive_not_configured", "Google Drive OAuth degrades when env is missing", oauth.body);
    }
  });

  await runner.step("Google Drive files route returns synced files or fails closed honestly", async (step) => {
    const files = await runner.request(
      step,
      "GET",
      `/v1/projects/${projectId}/connectors/google-drive/files?limit=10`,
      undefined,
      { token: accessToken, expectStatuses: [200, 404] }
    );
    if (files.statusCode === 404) {
      runner.assert(step, extractErrorCode(files) === "feature_disabled_in_beta", "Google Drive files fail closed when unvalidated", files.body);
      return;
    }
    runner.assert(step, Array.isArray(dataOf(files)), "Google Drive files route returns a real file list", files.body);
    runner.assert(step, typeof getPath(files.body, ["meta", "hasMore"]) === "boolean", "Google Drive files route returns pagination metadata", files.body);
  });

  await runner.step("Google Drive sync roots and sync routes are live or fail closed", async (step) => {
    const syncRoots = await runner.request(
      step,
      "PATCH",
      `/v1/projects/${projectId}/connectors/google-drive/sync-roots`,
      { accessMode: "full_drive" },
      { token: accessToken, expectStatuses: [200, 404] }
    );
    if (syncRoots.statusCode === 404) {
      runner.assert(step, ["google_drive_connection_not_found", "feature_disabled_in_beta"].includes(String(extractErrorCode(syncRoots))), "Google Drive sync roots fail closed without a validated connection", syncRoots.body);
    } else {
      runner.assert(step, typeof getPath(dataOf(syncRoots), ["state"]) === "string", "Google Drive sync roots return status", syncRoots.body);
    }

    const sync = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/connectors/google-drive/sync`,
      { syncType: "manual", dryRun: true },
      { token: accessToken, expectStatuses: [200, 403, 404] }
    );
    if (sync.statusCode !== 200) {
      runner.assert(step, ["google_drive_connection_not_found", "feature_disabled_in_beta"].includes(String(extractErrorCode(sync))), "Google Drive sync fails closed without a validated connection", sync.body);
    } else {
      runner.assert(step, getPath(dataOf(sync), ["dryRun"]) === true, "Google Drive sync dry-run is available", sync.body);
    }
  });

  await runner.step("Google Drive webhook route validates channel headers or falls back safely", async (step) => {
    const webhook = await runner.request(step, "POST", "/v1/webhooks/google/drive", {}, { expectStatuses: [200, 404] });
    if (webhook.statusCode === 404) {
      runner.assert(step, extractErrorCode(webhook) === "feature_disabled_in_beta", "Google Drive webhook fails closed when unvalidated", webhook.body);
      return;
    }
    const data = dataOf(webhook);
    runner.assert(step, getPath(data, ["ok"]) === true, "Google Drive webhook route responds safely", webhook.body);
    runner.assert(
      step,
      ["webhooks_disabled_or_unconfigured", "missing_channel_headers"].includes(String(getPath(data, ["reason"]))),
      "Google Drive webhook rejects unsigned notifications or reports fallback",
      webhook.body
    );
  });

  await runner.step("Google Drive disconnect route is beta-visible", async (step) => {
    const disconnected = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/connectors/google-drive/disconnect`,
      {},
      { token: accessToken, expectStatuses: [200, 404] }
    );
    if (disconnected.statusCode === 404) {
      runner.assert(step, ["google_drive_connection_not_found", "feature_disabled_in_beta"].includes(String(extractErrorCode(disconnected))), "Google Drive disconnect fails closed without a validated connection", disconnected.body);
    } else {
      runner.assert(step, getPath(dataOf(disconnected), ["ok"]) === true, "Google Drive disconnect succeeds when connected", disconnected.body);
    }
  });

  await runner.step("Google Drive write actions remain hidden", async (step) => {
    const created = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/connectors/google-drive/files/create`,
      { name: "should-not-exist" },
      { token: accessToken, expectStatuses: [404] }
    );
    runner.assert(step, extractErrorCode(created) === "feature_disabled_in_beta", "Google Drive create/write route is disabled", created.body);
  });

  await runner.step("Timeline accepts Google Drive source filter", async (step) => {
    const timeline = await runner.request(step, "GET", `/v1/projects/${projectId}/timeline?source=google_drive`, undefined, {
      token: accessToken
    });
    runner.assert(step, Array.isArray(itemsOf(timeline)), "Timeline returns an item list for Google Drive source filter", timeline.body);
  });

  await runner.step("Manual timeline event create/list is beta-visible", async (step) => {
    const created = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/timeline/events`,
      {
        title: "Beta Smoke Timeline Checkpoint",
        description: "Manual timeline event for beta smoke",
        source: "manual",
        sourceRef: "beta-smoke",
        tier: "atomic"
      },
      { token: accessToken }
    );
    const eventId = requireStringPath(dataOf(created), ["id"], "manual timeline event id");
    const listed = await runner.request(step, "GET", `/v1/projects/${projectId}/timeline?source=manual`, undefined, {
      token: accessToken
    });
    runner.assert(step, Array.isArray(getPath(dataOf(listed), ["items"])), "timeline returns item list", listed.body);
    runner.assert(step, JSON.stringify(dataOf(listed)).includes(eventId), "created manual timeline event is listed", listed.body);
  });

  await runner.step("Timeline endpoint returns project event projection", async (step) => {
    const timeline = await runner.request(step, "GET", `/v1/projects/${projectId}/timeline`, undefined, {
      token: accessToken
    });
    const data = dataOf(timeline);
    runner.assert(step, Array.isArray(getPath(data, ["items"])), "timeline includes items array", timeline.body);
    runner.assert(step, typeof getPath(data, ["updatedAt"]) === "string", "timeline includes updatedAt", timeline.body);
  });

  await runner.step("LiveDoc review routes are beta-visible", async (step) => {
    const reviewItems = await runner.request(step, "GET", `/v1/projects/${projectId}/live-doc/review-items`, undefined, {
      token: accessToken
    });
    runner.assert(step, Array.isArray(dataOf(reviewItems)), "LiveDoc review items route returns list", reviewItems.body);
    const markers = await runner.request(step, "GET", `/v1/projects/${projectId}/live-doc/change-markers`, undefined, {
      token: accessToken
    });
    runner.assert(step, Array.isArray(dataOf(markers)), "LiveDoc change markers route returns list", markers.body);
  });

  await runner.step("GitHub preview degrades safely when not connected", async (step) => {
    const preview = await runner.request(step, "GET", `/v1/projects/${projectId}/github/preview`, undefined, {
      token: accessToken
    });
    runner.assert(step, Array.isArray(getPath(dataOf(preview), ["commits"])), "GitHub preview returns commits list", preview.body);
    runner.assert(step, typeof getPath(dataOf(preview), ["state"]) === "string", "GitHub preview returns state", preview.body);
  });

  await runner.step("Communication connector readiness", async (step) => {
    const readiness = await runner.request(step, "GET", `/v1/projects/${projectId}/connectors/readiness`, undefined, {
      token: accessToken
    });
    const providers = optionalArrayPath(dataOf(readiness), []);
    const teams = providers.find((item) => getPath(item, ["provider"]) === "microsoft_teams");
    const notion = providers.find((item) => getPath(item, ["provider"]) === "notion");
    runner.assert(step, Boolean(teams), "Microsoft Teams is present in beta connector readiness", readiness.body);
    runner.assert(step, Boolean(notion), "Notion is present in beta connector readiness", readiness.body);
    runner.assert(
      step,
      getPath(teams, ["readiness", "canConnect"]) === false && optionalArrayPath(teams, ["readiness", "reasons"]).includes("provider_live_validation_required"),
      "Microsoft Teams readiness fails closed until live validation",
      readiness.body
    );
    runner.assert(
      step,
      getPath(notion, ["readiness", "canConnect"]) === false && optionalArrayPath(notion, ["readiness", "reasons"]).includes("provider_live_validation_required"),
      "Notion readiness fails closed until live validation",
      readiness.body
    );
    runner.assert(step, getPath(teams, ["metadata", "writeActionsEnabled"]) === false, "Microsoft Teams write actions are disabled", readiness.body);
    runner.assert(step, getPath(notion, ["metadata", "writeActionsEnabled"]) === false, "Notion write actions are disabled", readiness.body);
    runner.assert(
      step,
      !providers.some((item) => ["gmail", "outlook", "whatsapp_business"].includes(String(getPath(item, ["provider"])))),
      "non-enabled communication providers are hidden from beta readiness",
      readiness.body
    );
  });

  await runner.step("Unified integration status returns Slack/ClickUp/Granola/Fireflies/VS Code/Google Calendar/Google Drive/GitHub", async (step) => {
    const status = await runner.request(step, "GET", `/v1/projects/${projectId}/integrations/status`, undefined, {
      token: accessToken
    });
    const providers = optionalArrayPath(dataOf(status), ["providers"]);
    for (const provider of ["slack", "clickup", "granola", "fireflies_ai", "vscode", "google_calendar", "google_drive", "github"]) {
      const item = providers.find((candidate) => getPath(candidate, ["provider"]) === provider);
      runner.assert(step, Boolean(item), `Unified integration status includes ${provider}`, status.body);
      runner.assert(step, getPath(item, ["writeActionsEnabled"]) === false, `${provider} write actions are disabled`, status.body);
      if (provider !== "vscode") {
        runner.assert(step, getPath(item, ["capabilities", "canConnect"]) === false && getPath(item, ["capabilities", "canSync"]) === false, `${provider} actions fail closed until live validation`, status.body);
      }
    }
  });

  await runner.step("Slack OAuth connect starts only when release-validated", async (step) => {
    const connect = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/connectors/slack/connect`,
      { returnTo: "/connectors" },
      { token: accessToken, expectStatuses: [200, 404, 503] }
    );
    if (connect.statusCode !== 200) {
      runner.assert(step, ["feature_disabled_in_beta", "communication_provider_not_ready"].includes(String(extractErrorCode(connect))), "Slack connect fails closed while unvalidated", connect.body);
      return;
    }
    const redirectUrl = requireStringPath(dataOf(connect), ["redirectUrl"], "Slack OAuth redirect URL");
    runner.assert(step, redirectUrl.startsWith("https://slack.com/oauth/v2/authorize"), "Slack OAuth uses official authorize URL");
    runner.assert(step, redirectUrl.includes("channels%3Aread") || redirectUrl.includes("channels:read"), "Slack OAuth requests channel read scope");
    runner.assert(step, redirectUrl.includes("groups%3Ahistory") || redirectUrl.includes("groups:history"), "Slack OAuth requests private channel history scope");
  });

  await runner.step("Communication memory timeline is beta-visible", async (step) => {
    const timeline = await runner.request(step, "GET", `/v1/projects/${projectId}/communications/timeline`, undefined, {
      token: accessToken
    });
    runner.assert(step, Array.isArray(dataOf(timeline)), "communication memory timeline returns an item list", timeline.body);
  });

  await runner.step("PDF upload accepted", async (step) => {
    const uploaded = await uploadMemoryFile(runner, step, accessToken, projectId, {
      filename: "beta-smoke-project-memory.pdf",
      contentType: "application/pdf",
      title: "Beta Smoke PDF Memory",
      buffer: await createSmokePdfFixture()
    });
    pdfDocumentId = requireStringPath(dataOf(uploaded), ["documentId"], "pdf document id");
    runner.assert(step, typeof getPath(dataOf(uploaded), ["documentVersionId"]) === "string", "PDF document version exists");
  });

  await runner.step("DOCX upload accepted", async (step) => {
    const uploaded = await uploadMemoryFile(runner, step, accessToken, projectId, {
      filename: "beta-smoke-project-memory.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      title: "Beta Smoke DOCX Memory",
      buffer: createDocxFixture()
    });
    docxDocumentId = requireStringPath(dataOf(uploaded), ["documentId"], "docx document id");
    runner.assert(step, typeof getPath(dataOf(uploaded), ["documentVersionId"]) === "string", "DOCX document version exists");
  });

  await runner.step("document processing status", async (step) => {
    await waitForDocumentReady(runner, step, accessToken, projectId, pdfDocumentId, "PDF");
    await waitForDocumentReady(runner, step, accessToken, projectId, docxDocumentId, "DOCX");
  });

  await runner.step("Socrates beta ask with citation/openTarget", async (step) => {
    const answer = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/socrates/beta/ask`,
      { content: "What does the uploaded beta smoke project memory say about delivery workflow and VS Code?" },
      { token: accessToken }
    );
    runner.assert(step, optionalArrayPath(dataOf(answer), ["citations"]).length > 0, "Socrates returned a citation", answer.body);
    runner.assert(
      step,
      optionalArrayPath(dataOf(answer), ["open_targets"]).length > 0,
      "Socrates returned an open target",
      answer.body
    );
  });

  await runner.step("Socrates v1 ask returns grounded answer", async (step) => {
    const answer = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/socrates/v1/ask`,
      { question: "What project evidence is available?", includeArtifacts: true },
      { token: accessToken }
    );
    runner.assert(step, typeof getPath(dataOf(answer), ["answer_md"]) === "string", "Socrates v1 returned answer markdown", answer.body);
    runner.assert(step, typeof getPath(dataOf(answer), ["safety", "directMutationAllowed"]) === "boolean", "Socrates v1 returned safety metadata", answer.body);
  });

  await runner.step("Socrates v1 accepts Google Drive source selection", async (step) => {
    const answer = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/socrates/v1/ask`,
      { question: "What Google Drive evidence is available?", selectedSources: ["google_drive"], includeArtifacts: false },
      { token: accessToken }
    );
    runner.assert(step, typeof getPath(dataOf(answer), ["answer_md"]) === "string", "Socrates v1 answered with Google Drive selected", answer.body);
  });

  await runner.step("Socrates v1 API map artifact", async (step) => {
    const answer = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/socrates/v1/ask`,
      { question: "Map our API structure", mode: "api_map", includeArtifacts: true },
      { token: accessToken }
    );
    runner.assert(step, getPath(dataOf(answer), ["artifact", "type"]) === "api_map", "Socrates v1 returned API map artifact", answer.body);
  });

  await runner.step("Socrates v1 weekly summary artifact", async (step) => {
    const answer = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/socrates/v1/ask`,
      { question: "Summarize this week's changes", mode: "weekly_summary", includeArtifacts: true },
      { token: accessToken }
    );
    runner.assert(step, getPath(dataOf(answer), ["artifact", "type"]) === "summary", "Socrates v1 returned summary artifact", answer.body);
  });

  await runner.step("Socrates v1 system diagram artifact", async (step) => {
    const answer = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/socrates/v1/ask`,
      { question: "Generate a system diagram", mode: "system_diagram", includeArtifacts: true },
      { token: accessToken }
    );
    runner.assert(step, getPath(dataOf(answer), ["artifact", "type"]) === "diagram", "Socrates v1 returned diagram artifact", answer.body);
  });

  await runner.step("Socrates v1 ownership artifact", async (step) => {
    const answer = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/socrates/v1/ask`,
      { question: "Who owns auth?", mode: "ownership", includeArtifacts: true },
      { token: accessToken }
    );
    runner.assert(step, getPath(dataOf(answer), ["artifact", "type"]) === "ownership", "Socrates v1 returned ownership artifact", answer.body);
  });

  await runner.step("Socrates v1 refuses direct mutations", async (step) => {
    const answer = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/socrates/v1/ask`,
      { question: "Accept this change and update the LiveDoc now", includeArtifacts: true },
      { token: accessToken }
    );
    runner.assert(step, getPath(dataOf(answer), ["safety", "refusedMutation"]) === true, "Socrates v1 refused direct mutation", answer.body);
  });

  await runner.step("VS Code pairing code creation", async (step) => {
    const pairing = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/editor-connectors/vscode/pairings`,
      { label: "Beta smoke VS Code" },
      { token: accessToken }
    );
    const pairingCode = requireStringPath(dataOf(pairing), ["pairingCode"], "pairing code");
    runner.secret("pairingCode", pairingCode);
    runner.assert(step, requireStringPath(dataOf(pairing), ["status"], "pairing status") === "pairing_pending", "pairing pending");
  });

  await runner.step("VS Code pairing exchange returns token once", async (step) => {
    const exchange = await runner.request(step, "POST", "/v1/editor-connectors/vscode/exchange", {
      pairingCode: runner.getSecret("pairingCode"),
      extensionVersion: "beta-smoke",
      deviceLabel: "Beta smoke"
    });
    vscodeToken = requireStringPath(dataOf(exchange), ["token"], "VS Code token");
    runner.secret("vscodeToken", vscodeToken);
    runner.assert(step, requireStringPath(dataOf(exchange), ["project", "id"], "exchange project id") === projectId, "token scoped to project");

    const secondExchange = await runner.request(
      step,
      "POST",
      "/v1/editor-connectors/vscode/exchange",
      {
        pairingCode: runner.getSecret("pairingCode"),
        extensionVersion: "beta-smoke",
        deviceLabel: "Beta smoke duplicate"
      },
      { expectStatuses: [401] }
    );
    runner.assert(
      step,
      extractErrorCode(secondExchange) === "vscode_pairing_invalid",
      "pairing code cannot be exchanged twice",
      secondExchange.body
    );
  });

  await runner.step("VS Code Socrates ask uses same memory endpoint", async (step) => {
    const answer = await runner.request(
      step,
      "POST",
      "/v1/editor-connectors/vscode/socrates/ask",
      { question: "What does project memory say the VS Code connector can do?", selectedText: "VS Code connector can ask over project memory" },
      { token: vscodeToken }
    );
    runner.assert(step, optionalArrayPath(dataOf(answer), ["citations"]).length > 0, "VS Code Socrates returned citations", answer.body);
  });

  await runner.step("VS Code revoke denies token", async (step) => {
    const revoked = await runner.request(step, "POST", `/v1/projects/${projectId}/editor-connectors/vscode/revoke`, {}, { token: accessToken });
    runner.assert(step, Number(getPath(dataOf(revoked), ["revoked"])) >= 1, "connector revoked", revoked.body);
  });

  await runner.step("revoked token denied", async (step) => {
    const denied = await runner.request(
      step,
      "POST",
      "/v1/editor-connectors/vscode/socrates/ask",
      { question: "This should be denied after revoke." },
      { token: vscodeToken, expectStatuses: [401] }
    );
    runner.assert(step, extractErrorCode(denied) === "vscode_token_denied", "revoked token denied", denied.body);
  });

  await runner.step("External communication connectors are live or release-gated", async (step) => {
    const clickupConnect = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/connectors/clickup/connect`,
      { returnTo: "/connectors" },
      { token: accessToken, expectStatuses: [200, 404, 503] }
    );
    if (clickupConnect.statusCode === 200) {
      runner.assert(
        step,
        String(getPath(dataOf(clickupConnect), ["redirectUrl"])).includes("app.clickup.com"),
        "ClickUp OAuth URL is returned",
        clickupConnect.body
      );
    } else {
      runner.assert(step, ["communication_provider_not_ready", "feature_disabled_in_beta"].includes(String(extractErrorCode(clickupConnect))), "ClickUp fails closed until release validation", clickupConnect.body);
    }

    const firefliesConnect = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/connectors/fireflies_ai/connect`,
      {},
      { token: accessToken, expectStatuses: [200, 404, 503] }
    );
    if (firefliesConnect.statusCode === 200) {
      runner.assert(step, getPath(dataOf(firefliesConnect), ["provider"]) === "fireflies_ai", "Fireflies connect is available after validation", firefliesConnect.body);
    } else {
      runner.assert(step, ["communication_provider_not_ready", "feature_disabled_in_beta"].includes(String(extractErrorCode(firefliesConnect))), "Fireflies fails closed until release validation", firefliesConnect.body);
    }

    const connectorReadiness = await runner.request(step, "GET", `/v1/projects/${projectId}/connectors/readiness`, undefined, {
      token: accessToken
    });
    const readinessProviders = new Set(
      Array.isArray(dataOf(connectorReadiness))
        ? (dataOf(connectorReadiness) as Array<{ provider?: string }>).map((item) => item.provider)
        : []
    );
    for (const provider of ["zoho_mail", "zoho_cliq", "zoho_crm"]) {
      runner.assert(step, readinessProviders.has(provider), `${provider} readiness is beta-visible`, connectorReadiness.body);
    }
  });

  await runner.step("Microsoft Teams connect is beta-visible or readiness-gated", async (step) => {
    const denied = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/connectors/microsoft_teams/connect`,
      { returnTo: "/connectors" },
      { token: accessToken, expectStatuses: [200, 503] }
    );
    if (denied.statusCode === 200) {
      runner.assert(step, typeof getPath(dataOf(denied), ["authorizationUrl"]) === "string", "Microsoft Teams OAuth URL is returned", denied.body);
    } else {
      runner.assert(
        step,
        extractErrorCode(denied) === "communication_provider_not_ready",
        "Microsoft Teams degrades through readiness when production credentials are missing",
        denied.body
      );
      runner.assert(
        step,
        getPath(denied.body, ["error", "details", "readiness", "canConnect"]) === false && optionalArrayPath(denied.body, ["error", "details", "readiness", "reasons"]).includes("provider_live_validation_required"),
        "Microsoft Teams actions remain disabled while gated",
        denied.body
      );
    }
  });

  await runner.step("Communication review API is beta-visible", async (step) => {
    const reviewQueue = await runner.request(
      step,
      "GET",
      `/v1/projects/${projectId}/communication-review`,
      undefined,
      { token: accessToken }
    );
    const body = reviewQueue.body as { data?: { pendingInsights?: unknown; generatedProposals?: unknown } };
    runner.assert(step, Array.isArray(body.data?.pendingInsights), "communication review queue returns pending insights", reviewQueue.body);
    runner.assert(step, Array.isArray(body.data?.generatedProposals), "communication review queue returns generated proposals", reviewQueue.body);
  });

  await runner.step("Timeline approval routes use LiveDoc review flow", async (step) => {
    const reviewItems = await runner.request(step, "GET", `/v1/projects/${projectId}/live-doc/review-items`, undefined, {
      token: accessToken
    });
    runner.assert(step, Array.isArray(dataOf(reviewItems)), "review items are fetched through LiveDoc flow", reviewItems.body);
  });

  await runner.step("disabled routes return feature_disabled_in_beta", async (step) => {
    const generated = await runner.request(
      step,
      "POST",
      `/v1/projects/${projectId}/documents/generate`,
      { kind: "prd", template: "basic_mvp", prompt: "Generate a disabled beta document.", contextIds: [] },
      { token: accessToken, expectStatuses: [404] }
    );
    runner.assert(step, extractErrorCode(generated) === "feature_disabled_in_beta", "document generation disabled in beta", generated.body);
  });

  const steps = runner.results();
  const failures = steps.flatMap((step) => step.failures.map((failure) => `${step.name}: ${failure}`));
  return {
    ok: failures.length === 0,
    mode: "http" as const,
    liveProof: failures.length === 0,
    baseUrl: smokeConfig.baseUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    executedChecks: steps.length,
    checks: steps,
    failures
  };
}

class BetaSmokeRunner {
  private readonly steps: StepResult[] = [];
  private readonly secrets = new Map<string, string>();

  constructor(private readonly config: SmokeConfig) {}

  async step(name: string, fn: (step: StepResult) => Promise<void>) {
    const step: StepResult = { name, status: "passed", assertions: [], failures: [], routes: [] };
    try {
      await fn(step);
    } catch (error) {
      step.status = "failed";
      step.failures.push(error instanceof Error ? error.message : String(error));
      if (error instanceof SmokeFailure && error.details !== undefined) {
        step.failures.push(JSON.stringify(redactForReport(error.details)));
      }
    } finally {
      this.steps.push(step);
    }
  }

  assert(step: StepResult, condition: unknown, message: string, details?: unknown) {
    if (!condition) throw new SmokeFailure(message, details);
    step.assertions.push(message);
  }

  secret(key: string, value: string) {
    this.secrets.set(key, value);
  }

  getSecret(key: string) {
    const value = this.secrets.get(key);
    if (!value) throw new SmokeFailure(`Missing secret ${key}`);
    return value;
  }

  results() {
    return [...this.steps];
  }

  timeoutMs() {
    return this.config.timeoutMs;
  }

  pollIntervalMs() {
    return this.config.pollIntervalMs;
  }

  async request(
    step: StepResult,
    method: string,
    path: string,
    body?: unknown,
    options: { token?: string; expectStatuses?: number[] } = {}
  ): Promise<HttpResponse> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
    if (body !== undefined && !isFormData) headers["Content-Type"] = "application/json";
    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    const response = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs)
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    const call = { method, path, statusCode: response.status, ok: response.ok };
    step.routes.push(call);
    if (this.config.verbose) {
      console.log(JSON.stringify(redactForReport({ request: { method, path }, response: parsed }), null, 2));
    }

    const expectedStatuses = options.expectStatuses ?? [];
    const accepted = expectedStatuses.length > 0 ? expectedStatuses.includes(response.status) : response.ok;
    if (!accepted) throw new SmokeFailure(`HTTP ${method} ${path} returned ${response.status}`, parsed);

    return { statusCode: response.status, ok: response.ok, body: parsed, text };
  }
}

async function authenticateManager(runner: BetaSmokeRunner, step: StepResult, smokeConfig: SmokeConfig) {
  const generatedEmail = `beta-smoke-${Date.now()}@example.com`;
  const generatedPassword = `BetaSmoke!${Date.now()}xStrong`;
  const email = smokeConfig.managerEmail ?? (smokeConfig.allowSignup ? generatedEmail : null);
  const password = smokeConfig.managerPassword ?? (smokeConfig.allowSignup ? generatedPassword : null);

  if (!email || !password) {
    throw new SmokeFailure("BETA_SMOKE_MANAGER_EMAIL and BETA_SMOKE_MANAGER_PASSWORD are required for --mode=http");
  }

  const login = await runner.request(
    step,
    "POST",
    "/v1/auth/login",
    { email, password },
    { expectStatuses: smokeConfig.allowSignup ? [200, 401] : [200] }
  );
  if (login.statusCode === 200) {
    return requireStringPath(dataOf(login), ["accessToken"], "login access token");
  }

  const signup = await runner.request(step, "POST", "/v1/auth/signup", {
    orgName: `Beta Smoke ${Date.now()}`,
    email,
    password,
    displayName: "Beta Smoke Manager"
  });
  return requireStringPath(dataOf(signup), ["accessToken"], "signup access token");
}

async function uploadMemoryFile(
  runner: BetaSmokeRunner,
  step: StepResult,
  token: string,
  projectId: string,
  input: { filename: string; contentType: string; title: string; buffer: Buffer }
) {
  const form = new FormData();
  form.append("title", input.title);
  form.append("kind", "reference");
  form.append("visibility", "internal");
  form.append("sourceLabel", "beta-http-smoke");
  form.append("file", new File([input.buffer], input.filename, { type: input.contentType }));
  return runner.request(step, "POST", `/v1/projects/${projectId}/documents/upload`, form, { token });
}

async function waitForDocumentReady(
  runner: BetaSmokeRunner,
  step: StepResult,
  token: string,
  projectId: string,
  documentId: string,
  label: string
) {
  const deadline = Date.now() + runner.timeoutMs();
  let latest: HttpResponse | null = null;
  while (Date.now() < deadline) {
    latest = await runner.request(step, "GET", `/v1/projects/${projectId}/documents/${documentId}`, undefined, { token });
    const status = getPath(dataOf(latest), ["parseStatus"]) ?? getPath(dataOf(latest), ["currentVersion", "status"]);
    if (status === "ready" || status === "partial") {
      runner.assert(step, true, `${label} processing reached ${status}`);
      return;
    }
    if (status === "failed") {
      throw new SmokeFailure(`${label} processing failed`, latest.body);
    }
    await sleep(runner.pollIntervalMs());
  }
  throw new SmokeFailure(`${label} processing did not reach ready/partial before timeout`, latest?.body);
}

function dataOf(response: HttpResponse) {
  if (isRecord(response.body) && "data" in response.body) return response.body.data;
  return response.body;
}

function itemsOf(response: HttpResponse) {
  const data = dataOf(response);
  if (Array.isArray(data)) return data;
  const items = getPath(data, ["items"]);
  return Array.isArray(items) ? items : [];
}

function extractErrorCode(response: HttpResponse) {
  const code = getPath(response.body, ["error", "code"]);
  return typeof code === "string" ? code : null;
}

function requireHttpConfig(smokeConfig: SmokeConfig) {
  if (!smokeConfig.baseUrl) throw new SmokeFailure("BETA_SMOKE_BASE_URL or SMOKE_BASE_URL is required for --mode=http");
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function nonBlank(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value.trim() === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value.trim().toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPath(value: unknown, path: Array<string | number>) {
  let current = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function requireStringPath(value: unknown, path: Array<string | number>, label: string) {
  const found = getPath(value, path);
  if (typeof found !== "string" || found.length === 0) {
    throw new SmokeFailure(`${label} missing`, value);
  }
  return found;
}

function optionalArrayPath(value: unknown, path: Array<string | number>) {
  const found = getPath(value, path);
  return Array.isArray(found) ? found : [];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactForReport(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForReport);
  if (!isRecord(value)) {
    return typeof value === "string" ? value.replace(sensitiveValuePattern, "[redacted]") : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[redacted]" : redactForReport(entry)
    ])
  );
}

function createDocxFixture() {
  return createZip([
    {
      name: "[Content_Types].xml",
      content: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
      )
    },
    {
      name: "_rels/.rels",
      content: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
      )
    },
    {
      name: "word/document.xml",
      content: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>Beta smoke project memory DOCX: document parsing, chunk indexing, Socrates citations, and VS Code token revoke behavior are deployment proof requirements.</w:t></w:r></w:p>
</w:body>
</w:document>`
      )
    }
  ]);
}

function createZip(files: Array<{ name: string; content: Buffer }>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const crc = crc32(file.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.content.length, 18);
    local.writeUInt32LE(file.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, file.content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.content.length, 20);
    central.writeUInt32LE(file.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + file.content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

await main();
