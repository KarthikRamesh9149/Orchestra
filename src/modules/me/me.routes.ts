import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authGuard } from "../../app/auth.js";
import { setBrowserSessionCookies } from "../auth/browser-session.js";
import type { SessionRequestMetadata } from "../auth/service.js";
import {
  appearancePreferencePatchSchema,
  notificationPreferencesPatchSchema,
  profilePatchSchema,
  revokeAllSessionsSchema,
  sessionParamsSchema,
  switchWorkspaceSchema
} from "./me.schemas.js";

export const registerMeRoutes: FastifyPluginAsync = async (app) => {
  app.post("/me/web-vitals", { bodyLimit: 1024, config: { rateLimit: { max: 60, timeWindow: 60000, groupId: "web-vitals" } } },
    authGuard(async (request) => {
      const sample = z.object({
        metric: z.enum(["LCP", "INP", "CLS"]),
        value: z.number().finite().min(0).max(3600000),
        sampleId: z.string().regex(/^v[0-9]+-[0-9]+-[0-9]+$/).max(64),
        device: z.enum(["mobile", "tablet", "desktop"])
      }).strict().parse(request.body);
      // Only numeric measurements and an ephemeral metric identifier. No URL,
      // source text, DOM attribution, account ID, or persistent tracking cookie.
      // Repeated metric IDs are updates: analysis must keep the latest sample.
      request.appContext.logger.info(sample, "browser_web_vital");
      return { data: { accepted: true }, meta: null, error: null };
    })
  );

  const actor = (request: { authUser?: { userId: string; orgId: string } }) => ({
    userId: request.authUser!.userId,
    orgId: request.authUser!.orgId
  });
  const sessionMetadata = (request: { headers: { [key: string]: unknown }; ip: string }): SessionRequestMetadata => ({
    userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
    ipAddress: request.ip
  });

  app.get(
    "/me/profile",
    authGuard(async (request) => {
      const data = await request.appContext.services.meService.getProfile(actor(request), request.authUser!.sessionId);
      return { data, meta: null, error: null };
    })
  );

  app.patch(
    "/me/profile",
    authGuard(async (request) => {
      const body = profilePatchSchema.parse(request.body ?? {});
      const data = await request.appContext.services.meService.updateProfile(actor(request), body);
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/me/avatar",
    authGuard(async (request) => {
      const data = await request.appContext.services.meService.uploadAvatarDisabled(actor(request));
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/me/notification-preferences",
    authGuard(async (request) => {
      const data = await request.appContext.services.meService.getNotificationPreferences(actor(request));
      return { data, meta: null, error: null };
    })
  );

  app.patch(
    "/me/notification-preferences",
    authGuard(async (request) => {
      const body = notificationPreferencesPatchSchema.parse(request.body ?? {});
      const data = await request.appContext.services.meService.updateNotificationPreferences(actor(request), body);
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/me/appearance-preference",
    authGuard(async (request) => {
      const data = await request.appContext.services.meService.getAppearancePreference(actor(request));
      return { data, meta: null, error: null };
    })
  );

  app.patch(
    "/me/appearance-preference",
    authGuard(async (request) => {
      const body = appearancePreferencePatchSchema.parse(request.body ?? {});
      const data = await request.appContext.services.meService.updateAppearancePreference(actor(request), body.theme);
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/me/linked-accounts",
    authGuard(async (request) => {
      const data = await request.appContext.services.meService.listLinkedAccounts(actor(request));
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/me/sessions",
    authGuard(async (request) => {
      const data = await request.appContext.services.meService.listSessions(
        actor(request),
        request.authUser!.sessionId
      );
      return { data, meta: null, error: null };
    })
  );

  app.delete(
    "/me/sessions/:sessionId",
    authGuard(async (request) => {
      const params = sessionParamsSchema.parse(request.params);
      const data = await request.appContext.services.meService.revokeSession(actor(request), params.sessionId);
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/me/sessions/revoke-all",
    authGuard(async (request) => {
      const body = revokeAllSessionsSchema.parse(request.body ?? undefined);
      const data = await request.appContext.services.meService.revokeAllSessions(actor(request), {
        ...body,
        currentSessionId: request.authUser!.sessionId
      });
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/me/workspaces",
    authGuard(async (request) => {
      const data = await request.appContext.services.meService.listWorkspaces(actor(request), request.authUser!.sessionId);
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/me/workspaces/switch",
    authGuard(async (request, reply) => {
      const body = switchWorkspaceSchema.parse(request.body ?? {});
      const workspace = await request.appContext.services.meService.switchWorkspace(actor(request), body.projectId);
      const switched = await request.appContext.services.authService.switchSessionContext({
        userId: request.authUser!.userId,
        currentOrgId: request.authUser!.orgId,
        targetOrgId: workspace.organizationId,
        projectId: workspace.projectId,
        sessionId: request.authUser!.sessionId,
        requestMetadata: sessionMetadata(request)
      });
      if (switched.clientType === "browser") {
        setBrowserSessionCookies(reply, request.appContext.env, switched);
      }
      return {
        data: {
          workspace,
          user: switched.user,
          ...(switched.clientType === "bearer"
            ? { accessToken: switched.accessToken, refreshToken: switched.refreshToken }
            : {})
        },
        meta: null,
        error: null
      };
    })
  );
};
