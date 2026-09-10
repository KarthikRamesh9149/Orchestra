import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { authGuard, requireAuth } from "../../app/auth.js";
import { rateLimitRouteOptions } from "../../app/security.js";
import {
  BROWSER_SESSION_MODE,
  browserRefreshToken,
  clearBrowserSessionCookies,
  requestedSessionMode,
  setBrowserSessionCookies,
  type SessionMode
} from "./browser-session.js";
import type { SessionRequestMetadata } from "./service.js";
import type { TypedJwtUser } from "../../lib/auth/jwt.js";

const sessionModeSchema = z.enum([BROWSER_SESSION_MODE, "bearer"]).optional();

const signupSchema = z.object({
  orgName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(2),
  sessionMode: sessionModeSchema
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  sessionMode: sessionModeSchema
});

const invitationCodeSchema = z.string().trim().regex(
  /^(?:[A-HJ-NP-Z2-9]{6}|ORCH-[A-Z0-9]{6}-[A-Z0-9]{6})$/i,
  "Enter a valid OrchestraOS workspace code"
);

const newInvitationAccountSchema = z.object({
  accountType: z.literal("new"),
  email: z.string().email(),
  code: invitationCodeSchema.optional(),
  inviteToken: z.string().trim().min(32).max(200).optional(),
  password: z.string().min(12).max(128),
  displayName: z.string().trim().min(2).max(120),
  sessionMode: sessionModeSchema
});

const existingInvitationAccountSchema = z.object({
  accountType: z.literal("existing"),
  email: z.string().email(),
  code: invitationCodeSchema.optional(),
  inviteToken: z.string().trim().min(32).max(200).optional(),
  password: z.string().min(8).max(128),
  sessionMode: sessionModeSchema
});

const redeemInvitationSchema = z.discriminatedUnion("accountType", [
  newInvitationAccountSchema,
  existingInvitationAccountSchema
]).refine((value) => Boolean(value.code || value.inviteToken), { message: "Activation code or secure invitation link is required", path: ["code"] });

const legacyJoinWorkspaceSchema = newInvitationAccountSchema.omit({ accountType: true }).required({ code: true });

const requestEmailVerificationSchema = z.object({ projectId: z.string().uuid() }).strict();
const confirmEmailVerificationSchema = z.object({ token: z.string().trim().min(32).max(200) }).strict();
const changePasswordSchema = z.object({ currentPassword: z.string().min(8).max(128), newPassword: z.string().min(12).max(128) }).strict();

const refreshSchema = z.object({ refreshToken: z.string().min(1).optional() });

function sessionRequestMetadata(request: { headers: { [key: string]: unknown }; ip: string }): SessionRequestMetadata {
  const userAgent = request.headers["user-agent"];
  return {
    userAgent: typeof userAgent === "string" ? userAgent : null,
    ipAddress: request.ip
  };
}

export const registerAuthRoutes: FastifyPluginAsync = async (app) => {
  const authRateLimit = rateLimitRouteOptions(app.appContext.env, "auth");

  app.get("/csrf", async (_request, reply) => ({
    data: { csrfToken: reply.generateCsrf() },
    meta: null,
    error: null
  }));

  app.post("/bootstrap", authRateLimit, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    z.object({ sessionMode: z.literal("browser") }).strict().parse(request.body);
    if (request.headers.authorization) throw app.httpErrors.badRequest("Browser cookies are required");
    try {
      await requireAuth(request);
    } catch (error) {
      // Only a missing/expired access JWT may recover here. Revoked sessions,
      // inactive memberships, invalid signatures and database failures fail closed.
      const code = (error as { code?: string }).code;
      if (!["FST_JWT_AUTHORIZATION_TOKEN_EXPIRED", "FST_JWT_NO_AUTHORIZATION_IN_COOKIE", "FST_JWT_NO_AUTHORIZATION_IN_HEADER"].includes(code ?? "")) throw error;
      const refreshToken = browserRefreshToken(request);
      if (!refreshToken) throw app.httpErrors.unauthorized("Session required");
      const tokens = await request.appContext.services.authService.refresh(refreshToken, "browser", sessionRequestMetadata(request));
      // Send rotated cookies even if a subsequent read fails, so retry never
      // reuses the consumed refresh token. Tokens never enter the JSON response.
      setBrowserSessionCookies(reply, request.appContext.env, tokens);
      const signed = app.jwt.verify<TypedJwtUser<"access">>(tokens.accessToken);
      if (signed.typ !== "access" || !signed.sessionId) throw app.httpErrors.unauthorized("Invalid session");
      const active = await request.appContext.services.authService.authorizeSessionContext(signed.sessionId, signed.userId, signed.orgId);
      request.authUser = { ...active, sessionId: signed.sessionId };
      request.authProfile = active.profile;
    }
    const actor = request.authUser!;
    const [user, workspaces] = await Promise.all([
      request.authProfile ?? request.appContext.services.authService.getMe(actor.userId, actor.orgId),
      request.appContext.services.meService.listWorkspaces(actor, actor.sessionId)
    ]);
    return { data: { user, workspaces }, meta: null, error: null };
  });

  app.post("/signup", authRateLimit, async (request, reply) => {
    const body = signupSchema.parse(request.body);
    const result = await request.appContext.services.authService.signup(body, sessionRequestMetadata(request));
    const sessionMode = requestedSessionMode(body);
    if (sessionMode === "browser") {
      setBrowserSessionCookies(reply, request.appContext.env, result);
    }
    return {
      data: {
        ...(sessionMode === "bearer" ? { accessToken: result.accessToken, refreshToken: result.refreshToken } : {}),
        user: {
          id: result.user.id,
          orgId: result.user.orgId,
          email: result.user.email,
          displayName: result.user.displayName,
          globalRole: result.user.globalRole,
          workspaceRoleDefault: result.user.workspaceRoleDefault,
          emailVerified: Boolean(result.user.emailVerifiedAt)
        }
      },
      meta: null,
      error: null
    };
  });

  app.post("/login", authRateLimit, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await request.appContext.services.authService.login(body, sessionRequestMetadata(request));
    const sessionMode = requestedSessionMode(body);
    if (sessionMode === "browser") {
      setBrowserSessionCookies(reply, request.appContext.env, result);
    }
    return {
      data: {
        ...(sessionMode === "bearer" ? { accessToken: result.accessToken, refreshToken: result.refreshToken } : {}),
        user: {
          id: result.user.id,
          orgId: result.user.orgId,
          email: result.user.email,
          displayName: result.user.displayName,
          globalRole: result.user.globalRole,
          workspaceRoleDefault: result.user.workspaceRoleDefault,
          emailVerified: Boolean(result.user.emailVerifiedAt)
        }
      },
      meta: null,
      error: null
    };
  });

  const serializeInvitationResult = (
    result: Awaited<ReturnType<typeof app.appContext.services.authService.completeInvitationAccount>>,
    sessionMode: SessionMode,
    reply: FastifyReply
  ) => {
    if (sessionMode === "browser") {
      setBrowserSessionCookies(reply, app.appContext.env, result);
    }
    return {
      data: {
      ...(sessionMode === "bearer" ? { accessToken: result.accessToken, refreshToken: result.refreshToken } : {}),
      user: {
        id: result.user.id,
        orgId: result.user.orgId,
        email: result.user.email,
        displayName: result.user.displayName,
        globalRole: result.user.globalRole,
        workspaceRoleDefault: result.user.workspaceRoleDefault,
        emailVerified: Boolean(result.user.emailVerifiedAt)
      },
      invitation: result.invitation
    },
    meta: null,
    error: null
    };
  };

  app.post("/invitations/redeem", authRateLimit, async (request, reply) => {
    const body = redeemInvitationSchema.parse(request.body);
    const result = body.accountType === "existing"
      ? await request.appContext.services.authService.redeemInvitationForExistingAccount(body, sessionRequestMetadata(request))
      : await request.appContext.services.authService.completeInvitationAccount(body, sessionRequestMetadata(request));
    return serializeInvitationResult(result, requestedSessionMode(body), reply);
  });

  app.post("/join-workspace", authRateLimit, async (request, reply) => {
    const body = legacyJoinWorkspaceSchema.parse(request.body);
    const result = await request.appContext.services.authService.joinWorkspace(body, sessionRequestMetadata(request));
    return serializeInvitationResult(result, requestedSessionMode(body), reply);
  });

  app.post("/email-verification/request", authRateLimit, authGuard(async (request) => {
    const body = requestEmailVerificationSchema.parse(request.body);
    const result = await request.appContext.services.authService.requestEmailVerification({ userId: request.authUser!.userId, orgId: request.authUser!.orgId, projectId: body.projectId });
    return { data: result, meta: null, error: null };
  }));

  app.post("/email-verification/confirm", authRateLimit, async (request) => {
    const body = confirmEmailVerificationSchema.parse(request.body);
    const result = await request.appContext.services.authService.confirmEmailVerification(body.token);
    return { data: result, meta: null, error: null };
  });

  app.post("/password/change", authRateLimit, authGuard(async (request, reply) => {
    const body = changePasswordSchema.parse(request.body);
    const result = await request.appContext.services.authService.changePassword({ userId: request.authUser!.userId, orgId: request.authUser!.orgId, ...body });
    clearBrowserSessionCookies(reply, request.appContext.env);
    return { data: result, meta: null, error: null };
  }));

  app.post("/refresh", authRateLimit, async (request, reply) => {
    const body = refreshSchema.parse(request.body ?? {});
    const cookieToken = browserRefreshToken(request);
    const sessionMode: SessionMode = cookieToken ? "browser" : "bearer";
    const refreshToken = cookieToken ?? body.refreshToken;
    if (!refreshToken) {
      throw app.httpErrors.unauthorized("Refresh token is required");
    }
    const observe = request.appContext.env.DEPLOYMENT_ENV === "staging"
      ? (phase: string, elapsedMs: number) => request.log.info({ phase, elapsedMs }, "staging_refresh_phase")
      : undefined;
    const result = observe
      ? await request.appContext.services.authService.refresh(refreshToken, sessionMode, sessionRequestMetadata(request), observe)
      : await request.appContext.services.authService.refresh(refreshToken, sessionMode, sessionRequestMetadata(request));
    if (sessionMode === "browser") {
      setBrowserSessionCookies(reply, request.appContext.env, result);
      return { data: { refreshed: true }, meta: null, error: null };
    }
    return { data: result, meta: null, error: null };
  });

  app.post("/logout", async (request, reply) => {
    const body = refreshSchema.parse(request.body ?? {});
    const cookieToken = browserRefreshToken(request);
    if (!cookieToken) {
      // Bearer clients must still prove possession of their access token.
      await requireAuth(request);
    }
    const refreshToken = cookieToken ?? body.refreshToken;
    if (!refreshToken) {
      throw app.httpErrors.unauthorized("Refresh token is required");
    }
    await request.appContext.services.authService.logout(refreshToken);
    if (cookieToken) {
      clearBrowserSessionCookies(reply, request.appContext.env);
    }
    return { data: { ok: true }, meta: null, error: null };
  });

  app.get(
    "/me",
    authGuard(async (request) => {
      const user = request.authProfile ?? await request.appContext.services.authService.getMe(
          request.authUser!.userId,
          request.authUser!.orgId
        );
      return { data: user, meta: null, error: null };
    })
  );
};
