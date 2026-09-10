import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard } from "../../app/auth.js";
import { withRateLimit } from "../../app/security.js";
import {
  backfillGithubSchema,
  githubCallbackQuerySchema,
  githubInstallationIdParamsSchema,
  githubUserCallbackQuerySchema,
  linkGithubRepositorySchema,
  projectGithubParamsSchema,
  projectGithubRepositoryParamsSchema,
  syncRunQuerySchema
} from "./schemas.js";

export const registerGithubRoutes: FastifyPluginAsync = async (app) => {
  const webhookRateLimit = (options = {}) => withRateLimit(options, app.appContext.env, "webhook");

  app.get(
    "/github/readiness",
    internalAuthGuard(async (request) => ({
      data: request.appContext.services.githubIntegrationService.getReadiness({
        userId: request.authUser!.userId,
        orgId: request.authUser!.orgId
      }),
      meta: null,
      error: null
    }))
  );

  app.get(
    "/github/install-url",
    internalAuthGuard(async (request) => ({
      data: await request.appContext.services.githubIntegrationService.getInstallUrl({
        userId: request.authUser!.userId,
        orgId: request.authUser!.orgId
      }),
      meta: null,
      error: null
    }))
  );

  app.get(
    "/github/callback",
    async (request, reply) => {
      const query = githubCallbackQuerySchema.parse(request.query);
      await request.appContext.services.githubIntegrationService.handleInstallationCallbackFromState({
        installationId: query.installation_id,
        setupAction: query.setup_action,
        state: query.state
      });
      const frontendBaseUrl = request.appContext.env.FRONTEND_BASE_URL ?? request.appContext.env.APP_BASE_URL;
      return reply.redirect(`${frontendBaseUrl}/connectors?github=installed`);
    }
  );

  app.get(
    "/github/installations",
    internalAuthGuard(async (request) => {
      const data = await request.appContext.services.githubIntegrationService.listInstallations({
        userId: request.authUser!.userId,
        orgId: request.authUser!.orgId
      });
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/github/installations/:installationId/repositories",
    internalAuthGuard(async (request) => {
      const params = githubInstallationIdParamsSchema.parse(request.params);
      const data = await request.appContext.services.githubIntegrationService.listInstallationRepositories(
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId },
        params.installationId
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/github/user-link",
    internalAuthGuard(async (request) => {
      const data = await request.appContext.services.githubIntegrationService.getUserLinkStatus({
        userId: request.authUser!.userId,
        orgId: request.authUser!.orgId
      });
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/github/user-link/start",
    internalAuthGuard(async (request) => ({
      data: await request.appContext.services.githubIntegrationService.getUserLinkStart({
        userId: request.authUser!.userId,
        orgId: request.authUser!.orgId
      }),
      meta: null,
      error: null
    }))
  );

  app.get(
    "/github/user-link/callback",
    internalAuthGuard(async (request) => {
      const query = githubUserCallbackQuerySchema.parse(request.query);
      const data = await request.appContext.services.githubIntegrationService.handleUserLinkCallback(
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId },
        {
          state: query.state,
          code: query.code,
          githubUserId: query.github_user_id,
          githubLogin: query.github_login,
          githubAvatarUrl: query.github_avatar_url,
          githubEmail: query.github_email
        }
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/github/user-link/revoke",
    internalAuthGuard(async (request) => {
      const data = await request.appContext.services.githubIntegrationService.revokeUserLink({
        userId: request.authUser!.userId,
        orgId: request.authUser!.orgId
      });
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/github",
    internalAuthGuard(async (request) => {
      const params = projectGithubParamsSchema.parse(request.params);
      const data = await request.appContext.services.githubIntegrationService.getProjectIntegration(params.projectId, {
        userId: request.authUser!.userId,
        orgId: request.authUser!.orgId
      });
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/github/repositories/link",
    internalAuthGuard(async (request, reply) => {
      const params = projectGithubParamsSchema.parse(request.params);
      const body = linkGithubRepositorySchema.parse(request.body ?? {});
      const data = await request.appContext.services.githubIntegrationService.linkRepository(
        params.projectId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId },
        body
      );
      reply.code(201);
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/github/backfill",
    internalAuthGuard(async (request, reply) => {
      const params = projectGithubParamsSchema.parse(request.params);
      const body = backfillGithubSchema.parse(request.body ?? {});
      const data = await request.appContext.services.githubIntegrationService.triggerBackfill(
        params.projectId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId },
        body
      );
      reply.code(202);
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/github/sync-runs",
    internalAuthGuard(async (request) => {
      const params = projectGithubParamsSchema.parse(request.params);
      const query = syncRunQuerySchema.parse(request.query ?? {});
      const data = await request.appContext.services.githubIntegrationService.listSyncRuns(
        params.projectId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId },
        query.limit
      );
      return { data, meta: { limit: query.limit }, error: null };
    })
  );

  app.get(
    "/projects/:projectId/github/status",
    internalAuthGuard(async (request) => {
      const params = projectGithubParamsSchema.parse(request.params);
      const data = await request.appContext.services.githubIntegrationService.getCodeStatus(
        params.projectId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId }
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/github/code-status",
    internalAuthGuard(async (request) => {
      const params = projectGithubParamsSchema.parse(request.params);
      const data = await request.appContext.services.githubIntegrationService.getCodeStatusBundle(
        params.projectId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId }
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/github/pull-requests",
    internalAuthGuard(async (request) => {
      const params = projectGithubParamsSchema.parse(request.params);
      const data = await request.appContext.services.githubIntegrationService.listCodePullRequests(
        params.projectId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId }
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/github/conflicts",
    internalAuthGuard(async (request) => {
      const params = projectGithubParamsSchema.parse(request.params);
      const data = await request.appContext.services.githubIntegrationService.listCodeConflicts(
        params.projectId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId }
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/github/activity",
    internalAuthGuard(async (request) => {
      const params = projectGithubParamsSchema.parse(request.params);
      const data = await request.appContext.services.githubIntegrationService.listCodeActivity(
        params.projectId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId }
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/github/branches",
    internalAuthGuard(async (request) => {
      const params = projectGithubParamsSchema.parse(request.params);
      const data = await request.appContext.services.githubIntegrationService.listCodeBranches(
        params.projectId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId }
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/github/repositories/:repoLinkId/archive",
    internalAuthGuard(async (request) => {
      const params = projectGithubRepositoryParamsSchema.parse(request.params);
      const data = await request.appContext.services.githubIntegrationService.archiveRepositoryLink(
        params.projectId,
        params.repoLinkId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId }
      );
      return { data, meta: null, error: null };
    })
  );

  app.post("/webhooks/github", webhookRateLimit({ bodyLimit: app.appContext.env.GITHUB_WEBHOOK_MAX_PAYLOAD_BYTES }), async (request, reply) => {
    const data = await request.appContext.services.githubIntegrationService.handleWebhook({
      headers: request.headers,
      rawBody: request.rawBody ?? JSON.stringify(request.body ?? {}),
      body: request.body
    });
    reply.code(data.status === "duplicate" ? 200 : 202);
    return { data, meta: null, error: null };
  });
};
