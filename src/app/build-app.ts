import Fastify, { LogController } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import csrfProtection from "@fastify/csrf-protection";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import { timingSafeEqual } from "node:crypto";
import type { AppContext } from "../types/index.js";
import { AppError } from "./errors.js";
import { redactSensitiveUrlForLogging, registerStructuredErrorHandler } from "./error-handler.js";
import { requestContextPlugin } from "./context.js";
import { rateLimitErrorResponse, rateLimitKeyGenerator } from "./security.js";
import { registerAuthRoutes } from "../modules/auth/routes.js";
import {
  ACCESS_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  assertTrustedBrowserOrigin,
  browserCookieOptions,
  requiresBrowserRequestProtection
} from "../modules/auth/browser-session.js";
import { registerProjectRoutes } from "../modules/projects/routes.js";
import { registerProjectResponsibilityRoutes } from "../modules/projects/responsibilities.routes.js";
import { registerProjectContextRoutes } from "../modules/projects/context.routes.js";
import { registerProjectDiagramRoutes } from "../modules/diagrams/routes.js";
import { registerCodingRequirementsRoutes } from "../modules/coding-requirements/routes.js";
import { registerDocumentRoutes } from "../modules/documents/routes.js";
import { registerCommunicationRoutes } from "../modules/communications/communications.routes.js";
import { registerBrainRoutes } from "../modules/brain/routes.js";
import { registerChangeProposalRoutes } from "../modules/changes/routes.js";
import { registerSocratesRoutes } from "../modules/socrates/routes.js";
import { registerSocratesActionRoutes } from "../modules/socrates/actions.routes.js";
import { registerDashboardRoutes } from "../modules/dashboard/routes.js";
import { registerBetaTimelineRoutes } from "../modules/beta-timeline/beta-timeline.routes.js";
import { registerLiveDocRoutes } from "../modules/live-doc/routes.js";
import { registerClientViewRoutes } from "../modules/client-view/client-view.routes.js";
import { registerProjectOpsRoutes } from "../modules/project-ops/routes.js";
import { registerGoogleDriveRoutes } from "../modules/google-drive/routes.js";
import { registerAgentContextPackRoutes } from "../modules/agent-context/routes.js";
import { registerAgentFilesRoutes } from "../modules/agent-files/routes.js";
import { registerGithubRoutes } from "../modules/github/routes.js";
import { registerEngineeringEvidenceRoutes } from "../modules/engineering-evidence/routes.js";
import { registerFdeReadinessRoutes } from "../modules/fde-readiness/routes.js";
import { registerDeepResearchRoutes } from "../modules/deep-research/routes.js";
import { registerMcpRoutes } from "../modules/mcp/routes.js";
import { registerEditorConnectorRoutes } from "../modules/editor-connectors/routes.js";
import { registerSuggestionRoutes } from "../modules/suggestions/suggestions.routes.js";
import { registerMeRoutes } from "../modules/me/me.routes.js";
import { registerIntegrationManagementRoutes } from "../modules/integrations/integrations.routes.js";
import { registerTruthInboxRoutes } from "../modules/truth-inbox/truth-inbox.routes.js";
import { registerDeliveryRoutes } from "../modules/delivery/routes.js";
import { isMvpBetaMode } from "../lib/beta/policy.js";

declare module "fastify" {
  interface FastifyInstance {
    appContext: AppContext;
  }
}

export async function buildApp(context: AppContext) {
  const app = Fastify({
    logger: false,
    loggerInstance: context.logger,
    logController: new LogController({ disableRequestLogging: true })
  });

  app.decorate("appContext", context);

  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    request.rawBody = rawBody;
    if (!rawBody) {
      done(null, {});
      return;
    }

    try {
      done(null, JSON.parse(rawBody));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  await app.register(cors, {
    origin: context.env.CORS_ALLOWED_ORIGINS.split(",").map((value) => value.trim()),
    credentials: true
  });
  await app.register(cookie, { secret: context.env.JWT_REFRESH_SECRET });
  await app.register(csrfProtection, {
    cookieKey: CSRF_COOKIE_NAME,
    cookieOpts: {
      ...browserCookieOptions(context.env, "/"),
      signed: true
    },
    getToken: (request) => {
      const token = request.headers["x-csrf-token"];
      return typeof token === "string" ? token : undefined;
    }
  });
  if (context.env.SECURITY_HEADERS_ENABLED) {
    await app.register(helmet);
  }
  await app.register(sensible);
  await app.register(rateLimit, {
    global: context.env.RATE_LIMIT_ENABLED,
    max: context.env.RATE_LIMIT_MAX,
    timeWindow: context.env.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (request) => rateLimitKeyGenerator(request, context.env),
    errorResponseBuilder: rateLimitErrorResponse
  });
  await app.register(multipart, {
    limits: {
      fileSize: context.env.MAX_FILE_SIZE_BYTES
    }
  });
  await app.register(jwt, {
    secret: context.env.JWT_ACCESS_SECRET,
    cookie: {
      cookieName: ACCESS_COOKIE_NAME,
      signed: false
    }
  });
  await app.register(requestContextPlugin);

  app.addHook("onResponse", async (request, reply) => {
    context.logger.info(
      {
        method: request.method,
        url: redactSensitiveUrlForLogging(request.url),
        statusCode: reply.statusCode,
        requestId: request.requestId,
        responseTimeMs: Math.round(reply.elapsedTime * 100) / 100
      },
      "request_completed"
    );
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!requiresBrowserRequestProtection(request)) return;
    assertTrustedBrowserOrigin(request);

    let accepted = false;
    app.csrfProtection(request, reply, () => {
      accepted = true;
    });
    if (!accepted && !reply.sent) {
      throw new AppError(403, "Invalid or missing CSRF token", "csrf_invalid");
    }
  });

  app.get("/health", async () => ({
    ok: true,
    timestamp: new Date().toISOString()
  }));

  app.get("/metrics", async (request, reply) => {
    const configuredToken = context.env.METRICS_TOKEN?.trim();
    if (configuredToken) {
      const providedToken = request.headers["x-metrics-token"]?.toString();
      if (!constantTimeStringEqual(providedToken ?? "", configuredToken)) {
        throw app.httpErrors.forbidden("Metrics access denied");
      }
    }

    reply.header("Content-Type", "text/plain; version=0.0.4");
    return context.telemetry.renderPrometheus();
  });

  registerStructuredErrorHandler(app, context);

  if (isMvpBetaMode(context.env)) {
    app.addHook("preHandler", async (request) => {
      if (isAllowedBetaRoute(request.method, request.url, context.env)) {
        return;
      }
      throw new AppError(404, "Feature disabled in beta", "feature_disabled_in_beta");
    });
  }

  await app.register(registerAuthRoutes, { prefix: "/v1/auth" });
  await app.register(registerProjectRoutes, { prefix: "/v1" });
  await app.register(registerProjectResponsibilityRoutes, { prefix: "/v1" });
  await app.register(registerProjectContextRoutes, { prefix: "/v1" });
  await app.register(registerProjectDiagramRoutes, { prefix: "/v1" });
  await app.register(registerCodingRequirementsRoutes, { prefix: "/v1" });
  await app.register(registerDocumentRoutes, { prefix: "/v1" });
  await app.register(registerCommunicationRoutes, { prefix: "/v1" });
  await app.register(registerBrainRoutes, { prefix: "/v1" });
  await app.register(registerChangeProposalRoutes, { prefix: "/v1" });
  await app.register(registerSocratesRoutes, { prefix: "/v1" });
  await app.register(registerEditorConnectorRoutes, { prefix: "/v1" });
  await app.register(registerMeRoutes, { prefix: "/v1" });
  await app.register(registerSocratesActionRoutes, { prefix: "/v1" });
  await app.register(registerDashboardRoutes, { prefix: "/v1" });
  await app.register(registerBetaTimelineRoutes, { prefix: "/v1" });
  await app.register(registerProjectOpsRoutes, { prefix: "/v1" });
  await app.register(registerGoogleDriveRoutes, { prefix: "/v1" });
  await app.register(registerAgentContextPackRoutes, { prefix: "/v1" });
  await app.register(registerAgentFilesRoutes, { prefix: "/v1" });
  await app.register(registerGithubRoutes, { prefix: "/v1" });
  await app.register(registerSuggestionRoutes, { prefix: "/v1" });
  await app.register(registerTruthInboxRoutes, { prefix: "/v1" });
  await app.register(registerDeliveryRoutes, { prefix: "/v1" });
  await app.register(registerIntegrationManagementRoutes, { prefix: "/v1" });
  await app.register(registerEngineeringEvidenceRoutes, { prefix: "/v1" });
  await app.register(registerFdeReadinessRoutes, { prefix: "/v1" });
  await app.register(registerDeepResearchRoutes, { prefix: "/v1" });
  await app.register(registerMcpRoutes, { prefix: "/v1" });
  await app.register(registerLiveDocRoutes, { prefix: "/v1" });
  await app.register(registerClientViewRoutes, { prefix: "/v1" });

  return app;
}

export { redactSensitiveUrlForLogging } from "./error-handler.js";

function constantTimeStringEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function isAllowedBetaRoute(
  method: string,
  rawUrl: string,
  env: {
    BETA_SLACK_WEBHOOKS_ENABLED?: boolean;
    SLACK_WEBHOOKS_ENABLED?: boolean;
    BETA_GMAIL_INVITE_SENDER_ENABLED?: boolean;
    BETA_GOOGLE_CALENDAR_WEBHOOKS_ENABLED?: boolean;
    BETA_GOOGLE_CALENDAR_ENABLED?: boolean;
    BETA_GOOGLE_DRIVE_ENABLED?: boolean;
    BETA_GOOGLE_DRIVE_WEBHOOKS_ENABLED?: boolean;
    BETA_SUGGESTIONS_ENABLED?: boolean;
    BETA_GITHUB_PAGE_ENABLED?: boolean;
    BETA_PROFILE_ENABLED?: boolean;
    BETA_WORKSPACE_SETTINGS_ENABLED?: boolean;
    BETA_TEAM_MANAGEMENT_ENABLED?: boolean;
    BETA_INTEGRATION_MANAGEMENT_ENABLED?: boolean;
    MICROSOFT_TEAMS_WEBHOOKS_ENABLED?: boolean;
    BETA_DEEP_RESEARCH_ENABLED?: boolean;
    FDE_READINESS_INTELLIGENCE_ENABLED?: boolean;
    MCP_ENABLED?: boolean;
  }
) {
  const path = rawUrl.split("?")[0] ?? rawUrl;
  if (path === "/health" || path === "/metrics") return true;
  if (path.startsWith("/v1/auth")) return true;
  if (method === "GET" && path === "/v1/mcp/readiness") return true;
  if (env.MCP_ENABLED === true && path.match(/^\/v1\/mcp(?:\/.*)?$/)) {
    return ["GET", "POST", "DELETE"].includes(method);
  }
  if (isAllowedBetaProfileRoute(method, path, env)) return true;
  if (path.startsWith("/v1/editor-connectors/vscode")) return true;
  if (path.match(/^\/v1\/projects\/[^/]+\/editor-connectors\/vscode(?:\/.*)?$/)) return true;
  if (
    path.match(/^\/v1\/projects\/[^/]+\/socrates(?:\/.*)?$/) &&
    !path.includes("/socrates/actions") &&
    !path.includes("/actions")
  ) {
    return true;
  }
  if (path.match(/^\/v1\/projects\/[^/]+\/documents(?:\/.*)?$/)) {
    return !path.endsWith("/documents/generate") && !path.endsWith("/documents/generation-templates");
  }
  if (path.match(/^\/v1\/projects\/[^/]+\/join-codes(?:\/[^/]+\/revoke)?$/)) {
    return env.BETA_TEAM_MANAGEMENT_ENABLED !== false && ["GET", "POST"].includes(method);
  }
  if (path.match(/^\/v1\/projects\/[^/]+\/members(?:\/[^/]+)?$/)) {
    return env.BETA_TEAM_MANAGEMENT_ENABLED !== false && ["GET", "POST", "PATCH"].includes(method);
  }
  if (path.match(/^\/v1\/projects\/[^/]+\/truth-approvers(?:\/[^/]+)?$/)) {
    return env.BETA_TEAM_MANAGEMENT_ENABLED !== false && ["GET", "POST", "DELETE"].includes(method);
  }
  if (path.match(/^\/v1\/projects\/[^/]+\/responsibilities(?:\/[^/]+)?$/)) {
    return env.BETA_TEAM_MANAGEMENT_ENABLED !== false && ["GET", "POST", "PATCH", "DELETE"].includes(method);
  }
  if (isAllowedBetaWorkspaceSettingsRoute(method, path, env)) return true;
  if (
    env.BETA_GMAIL_INVITE_SENDER_ENABLED === true &&
    method === "POST" &&
    path.match(/^\/v1\/projects\/[^/]+\/connectors\/gmail\/connect$/)
  ) return true;
  if (
    env.BETA_GMAIL_INVITE_SENDER_ENABLED === true &&
    method === "GET" &&
    (path === "/v1/oauth/google/callback" || path === "/v1/oauth/google/drive/callback")
  ) return true;
  if (path.match(/^\/v1\/projects\/[^/]+\/change-proposals(?:\/[^/]+(?:\/(?:accept|reject))?)?$/)) {
    return ["GET", "POST"].includes(method);
  }
  if (isAllowedBetaTimelineRoute(method, path)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/live-doc\/(?:review-items|change-markers)$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/live-doc\/sections\/[^/]+\/review-items$/)) return true;
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/live-doc\/review-items\/[^/]+\/(?:accept|reject)$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/live-doc\/sections\/[^/]+\/provenance$/)) return true;
  if (isAllowedBetaMissionControlRoute(method, path)) return true;
  if (isAllowedBetaCalendarConnectionRoute(method, path, env)) return true;
  if (isAllowedBetaGoogleDriveRoute(method, path, env)) return true;
  if (isAllowedBetaSuggestionRoute(method, path, env)) return true;
  if (["GET", "POST"].includes(method) && path.match(/^\/v1\/projects\/[^/]+\/truth-inbox(?:\/.*)?$/)) return true;
  if (["GET", "POST"].includes(method) && path.match(/^\/v1\/projects\/[^/]+\/delivery(?:\/.*)?$/)) return true;
  if (isAllowedBetaAgentRunRoute(method, path)) return true;
  if (isAllowedBetaFdeRoute(method, path, env)) return true;
  if (isAllowedBetaIntegrationManagementRoute(method, path, env)) return true;
  if (isAllowedBetaGitHubConnectionRoute(method, path, env)) return true;
  if (
    env.BETA_DEEP_RESEARCH_ENABLED === true &&
    method === "GET" &&
    path.match(/^\/v1\/projects\/[^/]+\/context\/[^/]+$/)
  ) {
    return true;
  }
  if (path.match(/^\/v1\/projects\/[^/]+\/deep-research(?:\/.*)?$/)) {
    return env.BETA_DEEP_RESEARCH_ENABLED === true && ["GET", "POST"].includes(method);
  }
  if (method === "GET" && path === "/v1/oauth/slack/callback") return true;
  if (method === "GET" && path === "/v1/oauth/zoho/callback") return true;
  if (method === "GET" && path === "/v1/oauth/microsoft/callback") return true;
  if (method === "GET" && path === "/v1/oauth/notion/callback") return true;
  if (method === "POST" && path === "/v1/webhooks/slack") {
    return env.BETA_SLACK_WEBHOOKS_ENABLED === true && env.SLACK_WEBHOOKS_ENABLED === true;
  }
  if (method === "POST" && path === "/v1/webhooks/teams") {
    return env.MICROSOFT_TEAMS_WEBHOOKS_ENABLED === true;
  }
  if (isAllowedBetaCommunicationRoute(method, path)) return true;
  if (method === "GET" && path === "/v1/projects") return true;
  if (method === "POST" && path === "/v1/projects") return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+$/)) return true;
  return false;
}

function isAllowedBetaAgentRunRoute(method: string, path: string) {
  if (path.match(/^\/v1\/projects\/[^/]+\/agent-runs$/)) {
    return ["GET", "POST"].includes(method);
  }
  if (path.match(/^\/v1\/projects\/[^/]+\/agent-runs\/[^/]+$/)) {
    return ["GET", "PATCH", "DELETE"].includes(method);
  }
  if (path.match(/^\/v1\/projects\/[^/]+\/agent-runs\/[^/]+\/(?:status|review|archive)$/)) {
    return method === "POST";
  }
  if (path.match(/^\/v1\/projects\/[^/]+\/agent-runs\/[^/]+\/quality-reviews(?:\/(?:refresh|latest))?$/)) {
    return ["GET", "POST"].includes(method);
  }
  return false;
}

function isAllowedBetaFdeRoute(method: string, path: string, env: { FDE_READINESS_INTELLIGENCE_ENABLED?: boolean }) {
  if (env.FDE_READINESS_INTELLIGENCE_ENABLED !== true) return false;
  return ["GET", "POST"].includes(method) && Boolean(path.match(/^\/v1\/projects\/[^/]+\/fde-readiness(?:\/.*)?$/));
}

function isAllowedBetaProfileRoute(method: string, path: string, env: { BETA_PROFILE_ENABLED?: boolean }) {
  if (env.BETA_PROFILE_ENABLED === false && path.match(/^\/v1\/me(?:\/.*)?$/)) return false;
  if (["GET", "PATCH"].includes(method) && path === "/v1/me/profile") return true;
  if (method === "POST" && path === "/v1/me/web-vitals") return true;
  if (method === "POST" && path === "/v1/me/avatar") return true;
  if (["GET", "PATCH"].includes(method) && path === "/v1/me/notification-preferences") return true;
  if (["GET", "PATCH"].includes(method) && path === "/v1/me/appearance-preference") return true;
  if (method === "GET" && path === "/v1/me/linked-accounts") return true;
  if (method === "GET" && path === "/v1/me/sessions") return true;
  if (method === "DELETE" && path.match(/^\/v1\/me\/sessions\/[^/]+$/)) return true;
  if (method === "POST" && path === "/v1/me/sessions/revoke-all") return true;
  if (method === "GET" && path === "/v1/me/workspaces") return true;
  if (method === "POST" && path === "/v1/me/workspaces/switch") return true;
  return false;
}

function isAllowedBetaWorkspaceSettingsRoute(method: string, path: string, env: { BETA_WORKSPACE_SETTINGS_ENABLED?: boolean }) {
  if (env.BETA_WORKSPACE_SETTINGS_ENABLED === false && path.match(/^\/v1\/projects\/[^/]+\/settings(?:\/bundle)?$/)) return false;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/settings\/bundle$/)) return true;
  return ["GET", "PATCH"].includes(method) && Boolean(path.match(/^\/v1\/projects\/[^/]+\/settings$/));
}

function isAllowedBetaIntegrationManagementRoute(method: string, path: string, env: { BETA_INTEGRATION_MANAGEMENT_ENABLED?: boolean }) {
  if (env.BETA_INTEGRATION_MANAGEMENT_ENABLED === false && path.match(/^\/v1\/projects\/[^/]+\/integrations\/status$/)) return false;
  return method === "GET" && Boolean(path.match(/^\/v1\/projects\/[^/]+\/integrations\/status$/));
}

function isAllowedBetaCalendarConnectionRoute(
  method: string,
  path: string,
  env: { BETA_GOOGLE_CALENDAR_ENABLED?: boolean; BETA_GOOGLE_CALENDAR_WEBHOOKS_ENABLED?: boolean }
) {
  const isGoogleCalendarPath =
    path === "/v1/oauth/google-calendar/callback" ||
    path === "/v1/oauth/google/calendar/callback" ||
    path === "/v1/webhooks/google/calendar" ||
    path.match(/^\/v1\/projects\/[^/]+\/calendar-connections(?:\/.*)?$/) ||
    path.match(/^\/v1\/projects\/[^/]+\/connectors\/google-calendar(?:\/.*)?$/);
  if (isGoogleCalendarPath && env.BETA_GOOGLE_CALENDAR_ENABLED === false) return false;
  if (method === "GET" && path === "/v1/oauth/google-calendar/callback") return true;
  if (method === "GET" && path === "/v1/oauth/google/calendar/callback") return true;
  if (method === "POST" && path === "/v1/webhooks/google/calendar") return env.BETA_GOOGLE_CALENDAR_WEBHOOKS_ENABLED === true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/calendar-connections$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/calendar-connections\/[^/]+$/)) return true;
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/calendar-connections\/google_calendar\/connect$/)) return true;
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/calendar-connections\/[^/]+\/(?:sync|revoke)$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/calendar-connections\/[^/]+\/sync-runs$/)) return true;
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/connectors\/google-calendar\/connect$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/connectors\/google-calendar\/status$/)) return true;
  if (["GET", "PATCH"].includes(method) && path.match(/^\/v1\/projects\/[^/]+\/connectors\/google-calendar\/calendars$/)) return true;
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/connectors\/google-calendar\/(?:sync|disconnect)$/)) return true;
  return false;
}

function isAllowedBetaGoogleDriveRoute(
  method: string,
  path: string,
  env: { BETA_GOOGLE_DRIVE_ENABLED?: boolean; BETA_GOOGLE_DRIVE_WEBHOOKS_ENABLED?: boolean }
) {
  const isGoogleDrivePath =
    path === "/v1/oauth/google/drive/callback" ||
    path === "/v1/webhooks/google/drive" ||
    path.match(/^\/v1\/projects\/[^/]+\/connectors\/google-drive(?:\/.*)?$/);
  if (isGoogleDrivePath && env.BETA_GOOGLE_DRIVE_ENABLED === false) return false;
  if (method === "GET" && path === "/v1/oauth/google/drive/callback") return true;
  if (method === "POST" && path === "/v1/webhooks/google/drive") return env.BETA_GOOGLE_DRIVE_WEBHOOKS_ENABLED === true;
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/connectors\/google-drive\/connect$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/connectors\/google-drive\/status$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/connectors\/google-drive\/files$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/connectors\/google-drive\/sync-roots\/candidates$/)) return true;
  if (method === "PATCH" && path.match(/^\/v1\/projects\/[^/]+\/connectors\/google-drive\/sync-roots$/)) return true;
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/connectors\/google-drive\/(?:sync|disconnect)$/)) return true;
  return false;
}

function isAllowedBetaSuggestionRoute(method: string, path: string, env: { BETA_SUGGESTIONS_ENABLED?: boolean }) {
  if (env.BETA_SUGGESTIONS_ENABLED === false && path.match(/^\/v1\/projects\/[^/]+\/suggestions(?:\/.*)?$/)) {
    return false;
  }
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/suggestions$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/suggestions\/[^/]+$/)) return true;
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/suggestions\/[^/]+\/(?:dismiss|promote-to-timeline|create-review-item|ask-socrates)$/)) {
    return true;
  }
  return false;
}

function isAllowedBetaGitHubConnectionRoute(
  method: string,
  path: string,
  env: { BETA_GITHUB_PAGE_ENABLED?: boolean; GITHUB_WEBHOOKS_ENABLED?: boolean }
) {
  if (method === "GET" && path.match(/^\/v1\/github\/(?:readiness|install-url|callback|installations)$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/github\/installations\/[^/]+\/repositories$/)) return true;
  if (method === "POST" && path === "/v1/webhooks/github") return env.GITHUB_WEBHOOKS_ENABLED === true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/github$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/github\/sync-runs$/)) return true;
  if (env.BETA_GITHUB_PAGE_ENABLED !== false) {
    if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/github\/(?:status|code-status|pull-requests|conflicts|activity|branches)$/)) return true;
  }
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/github\/(?:repositories\/link|backfill)$/)) return true;
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/github\/repositories\/[^/]+\/archive$/)) return true;
  return false;
}

function isAllowedBetaMissionControlRoute(method: string, path: string) {
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/(?:mission-control|dashboard\/mission-control)$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/(?:activity|recent-changes)$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/socrates\/recent-queries$/)) return true;
  if (["GET", "POST"].includes(method) && path.match(/^\/v1\/projects\/[^/]+\/calendar-events$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/github\/preview$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/subscriptions\/renewals$/)) return true;
  if (["GET", "POST"].includes(method) && path.match(/^\/v1\/projects\/[^/]+\/subscriptions$/)) return true;
  if (["GET", "PATCH", "DELETE"].includes(method) && path.match(/^\/v1\/projects\/[^/]+\/subscriptions\/[^/]+$/)) return true;
  return false;
}

function isAllowedBetaTimelineRoute(method: string, path: string) {
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/timeline$/)) return true;
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/timeline\/events$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/timeline\/events\/[^/]+$/)) return true;
  return false;
}

function isAllowedBetaCommunicationRoute(method: string, path: string) {
  if (["GET", "PATCH"].includes(method) && path.match(/^\/v1\/projects\/[^/]+\/connectors\/[^/]+$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/connectors$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/connectors\/readiness$/)) return true;
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/connectors\/(?:slack|clickup|granola|fireflies_ai|zoho_mail|zoho_cliq|zoho_crm|microsoft_teams|notion)\/connect$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/connectors\/[^/]+\/channels$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/connectors\/[^/]+\/resources$/)) return true;
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/connectors\/[^/]+\/sync$/)) return true;
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/connectors\/[^/]+\/revoke$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/connectors\/[^/]+\/sync-runs$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/message-insights(?:\/[^/]+)?$/)) return true;
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/message-insights\/[^/]+\/(?:ignore|create-proposal)$/)) return true;
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/communications\/import$/)) return true;
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/messages\/[^/]+\/classify$/)) return true;
  if (method === "POST" && path.match(/^\/v1\/projects\/[^/]+\/threads\/[^/]+\/classify$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/communication-review$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/communications\/timeline$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/threads$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/threads\/[^/]+$/)) return true;
  if (method === "GET" && path.match(/^\/v1\/projects\/[^/]+\/messages\/[^/]+$/)) return true;
  return false;
}
