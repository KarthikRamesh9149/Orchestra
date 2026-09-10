import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard as authGuard } from "../../app/auth.js";
import { AppError } from "../../app/errors.js";
import { withRateLimit } from "../../app/security.js";
import { parseAndVerifyOAuthState } from "../../lib/communications/oauth-state.js";
import {
  googleDriveConnectSchema,
  googleDriveFileListQuerySchema,
  googleDriveProjectParamsSchema,
  googleDriveRootCandidateQuerySchema,
  googleDriveSyncRootsSchema,
  googleDriveSyncSchema
} from "./schemas.js";
import { z } from "zod";

const googleDriveOAuthCallbackSchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(1).max(4096).optional(),
  error: z.string().min(1).max(500).optional()
});

export const registerGoogleDriveRoutes: FastifyPluginAsync = async (app) => {
  const webhookRateLimit = (options = {}) => withRateLimit(options, app.appContext.env, "webhook");
  const assertEnabled = () => {
    if (app.appContext.env.BETA_GOOGLE_DRIVE_ENABLED === false || app.appContext.env.GOOGLE_DRIVE_CONNECTOR_ENABLED === false) {
      throw new AppError(403, "Google Drive is disabled in beta", "feature_disabled_in_beta");
    }
  };

  app.post(
    "/projects/:projectId/connectors/google-drive/connect",
    authGuard(async (request) => {
      assertEnabled();
      if (request.appContext.env.BETA_GOOGLE_DRIVE_OAUTH_ENABLED === false) {
        throw new AppError(403, "Google Drive OAuth is disabled", "feature_disabled_in_beta");
      }
      const params = googleDriveProjectParamsSchema.parse(request.params);
      const body = googleDriveConnectSchema.parse(request.body ?? {});
      const data = await request.appContext.services.googleDriveService.initiateConnect({
        projectId: params.projectId,
        actorUserId: request.authUser!.userId,
        accessMode: body.accessMode,
        returnTo: body.returnTo
      });
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/oauth/google/drive/callback",
    async (request, reply) => {
      const { code, state, error } = googleDriveOAuthCallbackSchema.parse(request.query);
      const frontendBaseUrl = request.appContext.env.FRONTEND_BASE_URL ?? request.appContext.env.APP_BASE_URL;
      if (isGmailInvitationOAuthState(request.appContext.env, state)) {
        if (error) {
          return reply.redirect(buildFrontendRedirect(frontendBaseUrl, "/settings#integrations", { gmail: "error" }));
        }
        const result = await request.appContext.services.communicationsService.connectors.handleOAuthCallback("gmail", {
          code,
          state
        });
        return reply.redirect(buildFrontendRedirect(frontendBaseUrl, result.redirectAfter ?? "/settings#integrations", {
          gmail: "connected"
        }));
      }
      assertEnabled();
      if (error) {
        return reply.redirect(`${frontendBaseUrl}/connectors?googleDrive=error`);
      }
      const result = await request.appContext.services.googleDriveService.handleOAuthCallback({ code, state });
      return reply.redirect(buildFrontendRedirect(frontendBaseUrl, result.returnTo ?? "/connectors", {
        googleDrive: "connected",
        projectId: result.projectId
      }));
    }
  );

  app.get(
    "/projects/:projectId/connectors/google-drive/status",
    authGuard(async (request) => {
      assertEnabled();
      const params = googleDriveProjectParamsSchema.parse(request.params);
      const data = await request.appContext.services.googleDriveService.getStatus(
        params.projectId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/connectors/google-drive/disconnect",
    authGuard(async (request) => {
      assertEnabled();
      const params = googleDriveProjectParamsSchema.parse(request.params);
      const data = await request.appContext.services.googleDriveService.disconnect(
        params.projectId,
        request.authUser!.userId
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/connectors/google-drive/files",
    authGuard(async (request) => {
      assertEnabled();
      const params = googleDriveProjectParamsSchema.parse(request.params);
      const query = googleDriveFileListQuerySchema.parse(request.query);
      const data = await request.appContext.services.googleDriveService.listFiles(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data: data.items, meta: data.meta, error: null };
    })
  );

  app.patch(
    "/projects/:projectId/connectors/google-drive/sync-roots",
    authGuard(async (request) => {
      assertEnabled();
      const params = googleDriveProjectParamsSchema.parse(request.params);
      const body = googleDriveSyncRootsSchema.parse(request.body ?? {});
      const data = await request.appContext.services.googleDriveService.updateSyncRoots(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/connectors/google-drive/sync-roots/candidates",
    authGuard(async (request) => {
      assertEnabled();
      const params = googleDriveProjectParamsSchema.parse(request.params);
      const query = googleDriveRootCandidateQuerySchema.parse(request.query);
      const data = await request.appContext.services.googleDriveService.listSyncRootCandidates(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data: data.items, meta: data.meta, error: null };
    })
  );

  app.post(
    "/projects/:projectId/connectors/google-drive/sync",
    authGuard(async (request) => {
      assertEnabled();
      const params = googleDriveProjectParamsSchema.parse(request.params);
      const body = googleDriveSyncSchema.parse(request.body ?? {});
      const data = await request.appContext.services.googleDriveService.triggerSync(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/webhooks/google/drive",
    webhookRateLimit(),
    async (request) => {
      assertEnabled();
      const data = await request.appContext.services.googleDriveService.handleWebhook(request.headers);
      return { data, meta: null, error: null };
    }
  );
};

export function isGmailInvitationOAuthState(env: Parameters<typeof parseAndVerifyOAuthState>[0], state?: string) {
  if (!state) return false;
  try {
    return parseAndVerifyOAuthState(env, state).provider === "gmail";
  } catch {
    return false;
  }
}

function buildFrontendRedirect(baseUrl: string, path: string, params: Record<string, string>) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
