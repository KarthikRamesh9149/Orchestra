import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../../app/errors.js";
import { internalAuthGuard as authGuard, requireManager, requireTruthApprover } from "../../app/auth.js";
import { withRateLimit } from "../../app/security.js";
import { isMvpEqualProjectAccessEnabled } from "../../lib/mvp/policy.js";
import {
  connectorListQuerySchema,
  connectorParamsSchema,
  connectorPatchBodySchema,
  connectorResourceQuerySchema,
  connectorSyncBodySchema,
  communicationImportBodySchema,
  jobRunQuerySchema,
  messageInsightListQuerySchema,
  messageInsightParamsSchema,
  messageParamsSchema,
  oauthCallbackQuerySchema,
  providerConnectBodySchema,
  projectParamsSchema,
  providerConnectParamsSchema,
  syncQuerySchema,
  webhookChallengeQuerySchema,
  threadListQuerySchema,
  threadParamsSchema,
  timelineQuerySchema
} from "./schemas.js";

export const registerCommunicationRoutes: FastifyPluginAsync = async (app) => {
  const webhookRateLimit = (options = {}) => withRateLimit(options, app.appContext.env, "webhook");
  const requireCommunicationMutationAccess = (request: Parameters<typeof requireManager>[0]) => {
    if (!isMvpEqualProjectAccessEnabled(request.appContext.env)) {
      requireManager(request);
    }
  };

  app.get("/oauth/slack/callback", async (request, reply) => {
    const query = oauthCallbackQuerySchema.parse(request.query);
    const data = await request.appContext.services.communicationsService.connectors.handleOAuthCallback("slack", query);
    const frontendBaseUrl = request.appContext.env.FRONTEND_BASE_URL ?? request.appContext.env.CLIENT_PORTAL_BASE_URL;
    if (frontendBaseUrl) {
      return reply.redirect(`${frontendBaseUrl.replace(/\/$/, "")}/connectors?slack=connected`);
    }
    return { data, meta: null, error: null };
  });

  app.get("/oauth/google/callback", async (request, reply) => {
    const query = oauthCallbackQuerySchema.parse(request.query);
    const data = await request.appContext.services.communicationsService.connectors.handleOAuthCallback("gmail", query);
    const frontendBaseUrl = request.appContext.env.FRONTEND_BASE_URL ?? request.appContext.env.CLIENT_PORTAL_BASE_URL;
    if (frontendBaseUrl) {
      const returnTo = data.redirectAfter?.startsWith("/") && !data.redirectAfter.startsWith("//")
        ? data.redirectAfter
        : "/settings#integrations";
      return reply.redirect(`${frontendBaseUrl.replace(/\/$/, "")}${returnTo}`);
    }
    return { data, meta: null, error: null };
  });

  app.get("/oauth/microsoft/callback", async (request) => {
    const query = oauthCallbackQuerySchema.parse(request.query);
    const data =
      await request.appContext.services.communicationsService.connectors.handleOAuthCallbackFromState(query, [
        "outlook",
        "microsoft_teams"
      ]);
    return { data, meta: null, error: null };
  });

  app.get("/oauth/clickup/callback", async (request) => {
    const query = oauthCallbackQuerySchema.parse(request.query);
    const data = await request.appContext.services.communicationsService.connectors.handleOAuthCallback("clickup", query);
    return { data, meta: null, error: null };
  });

  app.get("/oauth/zoho/callback", async (request) => {
    const query = oauthCallbackQuerySchema.parse(request.query);
    const data = await request.appContext.services.communicationsService.connectors.handleOAuthCallbackFromState(query, [
      "zoho_mail",
      "zoho_cliq",
      "zoho_crm"
    ]);
    return { data, meta: null, error: null };
  });

  app.get("/oauth/notion/callback", async (request) => {
    const query = oauthCallbackQuerySchema.parse(request.query);
    const data = await request.appContext.services.communicationsService.connectors.handleOAuthCallback("notion", query);
    return { data, meta: null, error: null };
  });

  app.post("/webhooks/slack", webhookRateLimit({ bodyLimit: 1024 * 1024 }), async (request, reply) => {
    const result = await request.appContext.services.communicationsService.connectors.handleWebhook("slack", {
      headers: request.headers,
      rawBody: request.rawBody ?? JSON.stringify(request.body ?? {}),
      body: request.body,
      query: request.query as Record<string, string | string[] | undefined>
    });
    if (result.statusCode) {
      reply.code(result.statusCode);
    }
    return result.body;
  });

  app.post("/webhooks/outlook", webhookRateLimit({ bodyLimit: 1024 * 1024 }), async (request, reply) => {
    webhookChallengeQuerySchema.parse(request.query);
    const result = await request.appContext.services.communicationsService.connectors.handleWebhook("outlook", {
      headers: request.headers,
      rawBody: request.rawBody ?? JSON.stringify(request.body ?? {}),
      body: request.body,
      query: request.query as Record<string, string | string[] | undefined>
    });
    if (result.statusCode) {
      reply.code(result.statusCode);
    }
    return result.body;
  });

  app.post("/webhooks/teams", webhookRateLimit({ bodyLimit: 1024 * 1024 }), async (request, reply) => {
    webhookChallengeQuerySchema.parse(request.query);
    const result = await request.appContext.services.communicationsService.connectors.handleWebhook("microsoft_teams", {
      headers: request.headers,
      rawBody: request.rawBody ?? JSON.stringify(request.body ?? {}),
      body: request.body,
      query: request.query as Record<string, string | string[] | undefined>
    });
    if (result.statusCode) {
      reply.code(result.statusCode);
    }
    return result.body;
  });

  app.get("/webhooks/whatsapp-business", webhookRateLimit(), async (request, reply) => {
    webhookChallengeQuerySchema.parse(request.query);
    const result = await request.appContext.services.communicationsService.connectors.handleWebhook("whatsapp_business", {
      headers: request.headers,
      rawBody: request.rawBody ?? "",
      body: request.body,
      query: request.query as Record<string, string | string[] | undefined>
    });
    if (result.statusCode) {
      reply.code(result.statusCode);
    }
    return result.body;
  });

  app.post("/webhooks/whatsapp-business", webhookRateLimit({ bodyLimit: 1024 * 1024 }), async (request, reply) => {
    const result = await request.appContext.services.communicationsService.connectors.handleWebhook("whatsapp_business", {
      headers: request.headers,
      rawBody: request.rawBody ?? JSON.stringify(request.body ?? {}),
      body: request.body,
      query: request.query as Record<string, string | string[] | undefined>
    });
    if (result.statusCode) {
      reply.code(result.statusCode);
    }
    return result.body;
  });

  app.post("/webhooks/fireflies", webhookRateLimit({ bodyLimit: 1024 * 1024 }), async (request, reply) => {
    const result = await request.appContext.services.communicationsService.connectors.handleWebhook("fireflies_ai", {
      headers: request.headers,
      rawBody: request.rawBody ?? "",
      body: request.body,
      query: request.query as Record<string, string | string[] | undefined>
    });
    if (result.statusCode) {
      reply.code(result.statusCode);
    }
    return result.body;
  });

  app.post("/webhooks/clickup", webhookRateLimit({ bodyLimit: 1024 * 1024 }), async (request, reply) => {
    const result = await request.appContext.services.communicationsService.connectors.handleWebhook("clickup", {
      headers: request.headers,
      rawBody: request.rawBody ?? JSON.stringify(request.body ?? {}),
      body: request.body,
      query: request.query as Record<string, string | string[] | undefined>
    });
    if (result.statusCode) {
      reply.code(result.statusCode);
    }
    return result.body;
  });

  app.get(
    "/projects/:projectId/connectors",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const query = connectorListQuerySchema.parse(request.query);
      const data = await request.appContext.services.communicationsService.connectors.list(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/connectors/readiness",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const data = await request.appContext.services.communicationsService.connectors.listReadiness(
        params.projectId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/connectors/:connectorId",
    authGuard(async (request) => {
      const params = connectorParamsSchema.parse(request.params);
      const data = await request.appContext.services.communicationsService.connectors.get(
        params.projectId,
        params.connectorId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.patch(
    "/projects/:projectId/connectors/:connectorId",
    authGuard(async (request) => {
      requireCommunicationMutationAccess(request);
      const params = connectorParamsSchema.parse(request.params);
      const body = connectorPatchBodySchema.parse(request.body);
      const data = await request.appContext.services.communicationsService.connectors.update(
        params.projectId,
        params.connectorId,
        request.authUser!.userId,
        body
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/connectors/:connectorId/channels",
    authGuard(async (request) => {
      const params = connectorParamsSchema.parse(request.params);
      const data = await request.appContext.services.communicationsService.connectors.listProviderChannels(
        params.projectId,
        params.connectorId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/connectors/:connectorId/resources",
    authGuard(async (request) => {
      const params = connectorParamsSchema.parse(request.params);
      const query = connectorResourceQuerySchema.parse(request.query);
      const data = await request.appContext.services.communicationsService.connectors.listProviderResources(
        params.projectId,
        params.connectorId,
        request.authUser!.userId,
        query
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/connectors/:provider/connect",
    authGuard(async (request) => {
      requireCommunicationMutationAccess(request);
      const params = providerConnectParamsSchema.parse(request.params);
      const body = providerConnectBodySchema.parse(request.body ?? {});
      const data = await request.appContext.services.communicationsService.connectors.connect(
        params.projectId,
        params.provider,
        request.authUser!.userId,
        body
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/connectors/:connectorId/sync",
    authGuard(async (request) => {
      requireCommunicationMutationAccess(request);
      const params = connectorParamsSchema.parse(request.params);
      const body = connectorSyncBodySchema.parse(request.body ?? {});
      const data = await request.appContext.services.communicationsService.sync.queueSync(
        params.projectId,
        params.connectorId,
        request.authUser!.userId,
        body.syncType,
        body.idempotencyKey
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/connectors/:connectorId/revoke",
    authGuard(async (request) => {
      requireCommunicationMutationAccess(request);
      const params = connectorParamsSchema.parse(request.params);
      const data = await request.appContext.services.communicationsService.connectors.revoke(
        params.projectId,
        params.connectorId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/connectors/:connectorId/webhooks/register",
    authGuard(async (request) => {
      requireCommunicationMutationAccess(request);
      const params = connectorParamsSchema.parse(request.params);
      const data = await request.appContext.services.communicationsService.connectors.registerWebhook(
        params.projectId,
        params.connectorId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/connectors/:connectorId/sync-runs",
    authGuard(async (request) => {
      const params = connectorParamsSchema.parse(request.params);
      const query = syncQuerySchema.parse(request.query);
      const data = await request.appContext.services.communicationsService.connectors.listSyncRuns(
        params.projectId,
        params.connectorId,
        request.authUser!.userId,
        query
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/job-runs",
    authGuard(async (request) => {
      requireCommunicationMutationAccess(request);
      const params = projectParamsSchema.parse(request.params);
      const query = jobRunQuerySchema.parse(request.query);
      const data = await request.appContext.services.communicationsService.connectors.listProjectJobRuns(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/communications/import",
    authGuard(async (request) => {
      requireCommunicationMutationAccess(request);
      const params = projectParamsSchema.parse(request.params);
      const body = communicationImportBodySchema.parse(request.body);
      const adapter = request.appContext.services.communicationsService.getAdapter(body.provider);
      if (!adapter?.normalizeImport) {
        throw new AppError(501, `Provider ${body.provider} does not support normalized import`, "communication_import_not_supported");
      }
      const normalized = await adapter.normalizeImport(body);
      const data = await request.appContext.services.communicationsService.importProviderBatch({
        projectId: params.projectId,
        actorUserId: request.authUser!.userId,
        accountLabel: body.accountLabel,
        batch: normalized
      });
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/message-insights",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const query = messageInsightListQuerySchema.parse(request.query);
      const result = await request.appContext.services.communicationsService.messageInsights.list(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.get(
    "/projects/:projectId/message-insights/:insightId",
    authGuard(async (request) => {
      const params = messageInsightParamsSchema.parse(request.params);
      const data = await request.appContext.services.communicationsService.messageInsights.get(
        params.projectId,
        params.insightId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/message-insights/:insightId/ignore",
    authGuard(async (request) => {
      requireCommunicationMutationAccess(request);
      const params = messageInsightParamsSchema.parse(request.params);
      const data = await request.appContext.services.communicationsService.messageInsights.ignore(
        params.projectId,
        params.insightId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/message-insights/:insightId/create-proposal",
    authGuard(async (request) => {
      const params = messageInsightParamsSchema.parse(request.params);
      requireTruthApprover(request);
      await request.appContext.services.projectService.ensureProjectTruthApprover(params.projectId, request.authUser!.userId);
      const data = await request.appContext.services.communicationsService.messageInsights.createProposal(
        params.projectId,
        params.insightId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/messages/:messageId/classify",
    authGuard(async (request) => {
      const params = messageParamsSchema.parse(request.params);
      requireTruthApprover(request);
      await request.appContext.services.projectService.ensureProjectTruthApprover(params.projectId, request.authUser!.userId);
      const data = await request.appContext.services.communicationsService.messageInsights.classifyMessage(
        params.projectId,
        params.messageId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/threads/:threadId/classify",
    authGuard(async (request) => {
      const params = threadParamsSchema.parse(request.params);
      requireTruthApprover(request);
      await request.appContext.services.projectService.ensureProjectTruthApprover(params.projectId, request.authUser!.userId);
      const data = await request.appContext.services.communicationsService.threadInsights.classifyThread(
        params.projectId,
        params.threadId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/communication-review",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const data = await request.appContext.services.communicationsService.messageInsights.getReviewQueue(
        params.projectId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/communications/timeline",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const query = timelineQuerySchema.parse(request.query);
      const result = await request.appContext.services.communicationsService.timeline.getTimeline(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.get(
    "/projects/:projectId/threads",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const query = threadListQuerySchema.parse(request.query);
      const result = await request.appContext.services.communicationsService.timeline.listThreads(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.get(
    "/projects/:projectId/threads/:threadId",
    authGuard(async (request) => {
      const params = threadParamsSchema.parse(request.params);
      const data = await request.appContext.services.communicationsService.timeline.getThread(
        params.projectId,
        params.threadId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/messages/:messageId",
    authGuard(async (request) => {
      const params = messageParamsSchema.parse(request.params);
      const data = await request.appContext.services.communicationsService.timeline.getMessage(
        params.projectId,
        params.messageId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );
};
