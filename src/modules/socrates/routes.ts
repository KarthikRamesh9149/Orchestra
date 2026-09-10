/**
 * Socrates API routes.
 *
 * GET    /v1/projects/:projectId/socrates/sessions
 * POST   /v1/projects/:projectId/socrates/sessions
 * DELETE /v1/projects/:projectId/socrates/sessions/:sessionId
 * PATCH  /v1/projects/:projectId/socrates/sessions/:sessionId/context
 * GET    /v1/projects/:projectId/socrates/sessions/:sessionId/suggestions
 * POST   /v1/projects/:projectId/socrates/sessions/:sessionId/messages/stream
 * GET    /v1/projects/:projectId/socrates/sessions/:sessionId/messages
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { internalAuthGuard as authGuard } from "../../app/auth.js";
import { rateLimitRouteOptions } from "../../app/security.js";
import {
  createSessionBodySchema,
  patchContextBodySchema,
  projectParamsSchema,
  sessionParamsSchema,
  socratesFeedbackBodySchema,
  socratesFeedbackParamsSchema,
  socratesV1AskBodySchema,
  streamMessageBodySchema,
} from "./schemas.js";
import { z } from "zod";

const betaAskBodySchema = z.object({
  content: z.string().trim().min(1).max(8000)
});

const listSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30)
});

const assistantMessageParamsSchema = sessionParamsSchema.extend({
  assistantMessageId: z.string().uuid()
});

const resumeStreamQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0)
});

function preserveSseCorsHeaders(request: FastifyRequest, reply: FastifyReply) {
  const origin = request.headers.origin;
  if (!origin) return;
  const allowedOrigins = request.appContext.env.CORS_ALLOWED_ORIGINS
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!allowedOrigins.includes(origin)) return;
  // Raw SSE writes bypass Fastify's normal onSend phase. Set the already
  // validated origin explicitly so browsers receive the same CORS contract.
  reply.raw.setHeader("Access-Control-Allow-Origin", origin);
  reply.raw.setHeader("Access-Control-Allow-Credentials", "true");
  reply.raw.setHeader("Vary", "Origin");
}

export const registerSocratesRoutes: FastifyPluginAsync = async (app) => {
  // GET /v1/projects/:projectId/socrates/sessions
  app.get(
    "/projects/:projectId/socrates/sessions",
    authGuard(async (request) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      const { limit } = listSessionsQuerySchema.parse(request.query);
      const sessions = await request.appContext.services.socratesService.listSessions(
        projectId,
        request.authUser!.userId,
        limit,
        true
      );
      return { data: sessions, meta: null, error: null };
    })
  );

  // POST /v1/projects/:projectId/socrates/sessions
  app.post(
    "/projects/:projectId/socrates/sessions/:sessionId/messages/:assistantMessageId/feedback",
    authGuard(async (request) => {
      const params = socratesFeedbackParamsSchema.parse(request.params);
      const body = socratesFeedbackBodySchema.parse(request.body);
      const result = await request.appContext.services.socratesFeedbackService.record({
        ...params,
        actorUserId: request.authUser!.userId,
        actorOrgId: request.authUser!.orgId,
        ...body
      });
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/socrates/sessions",
    authGuard(async (request) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      const body = createSessionBodySchema.parse(request.body);
      const session = await request.appContext.services.socratesService.createSession(
        projectId,
        request.authUser!.userId,
        body,
        request.projectAuthorization!.projectRole
      );
      return { data: session, meta: null, error: null };
    })
  );

  app.delete(
    "/projects/:projectId/socrates/sessions/:sessionId",
    authGuard(async (request) => {
      const { projectId, sessionId } = sessionParamsSchema.parse(request.params);
      const result = await request.appContext.services.socratesService.deleteSession(
        projectId,
        sessionId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/socrates/beta/ask",
    rateLimitRouteOptions(app.appContext.env, "socratesStream"),
    authGuard(async (request) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      const body = betaAskBodySchema.parse(request.body);
      const result = await request.appContext.services.socratesService.askBetaProjectMemory({
        projectId,
        actorUserId: request.authUser!.userId,
        content: body.content,
        source: "web"
      });
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/socrates/v1/ask",
    rateLimitRouteOptions(app.appContext.env, "socratesStream"),
    authGuard(async (request) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      const body = socratesV1AskBodySchema.parse(request.body);
      const result = await request.appContext.services.socratesService.askV1ProjectMemory({
        projectId,
        actorUserId: request.authUser!.userId,
        question: body.question ?? body.content ?? body.prompt!,
        sessionId: body.sessionId ?? null,
        mode: body.mode,
        selectedSources: body.selectedSources,
        maxEvidence: body.maxEvidence,
        includeArtifacts: body.includeArtifacts,
        includeHistory: body.includeHistory,
        clientContext: body.clientContext,
        authorizedProjectRole: request.projectAuthorization!.projectRole
      });
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/socrates/v1/prewarm",
    authGuard(async (request) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.socratesService.prewarmV1ProjectMemory(
        projectId,
        request.authUser!.userId,
        request.projectAuthorization!.projectRole
      );
      return { data: result, meta: null, error: null };
    })
  );

  // Fetch-based SSE is used because browser EventSource cannot POST an
  // authenticated, CSRF-protected question body.
  app.post(
    "/projects/:projectId/socrates/messages/stream/v1",
    rateLimitRouteOptions(app.appContext.env, "socratesStream"),
    authGuard(async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params);
      const body = socratesV1AskBodySchema.parse(request.body);
      preserveSseCorsHeaders(request, reply);
      await request.appContext.services.socratesService.streamV1ProjectMemory(
        {
          projectId,
          actorUserId: request.authUser!.userId,
          question: body.question ?? body.content ?? body.prompt!,
          sessionId: null,
          mode: body.mode,
          selectedSources: body.selectedSources,
          maxEvidence: body.maxEvidence,
          includeArtifacts: body.includeArtifacts,
          includeHistory: body.includeHistory,
          clientContext: body.clientContext,
          authorizedProjectRole: request.projectAuthorization!.projectRole
        },
        reply
      );
      return undefined;
    })
  );

  app.post(
    "/projects/:projectId/socrates/sessions/:sessionId/messages/stream/v1",
    rateLimitRouteOptions(app.appContext.env, "socratesStream"),
    authGuard(async (request, reply) => {
      const { projectId, sessionId } = sessionParamsSchema.parse(request.params);
      const body = socratesV1AskBodySchema.parse(request.body);
      preserveSseCorsHeaders(request, reply);
      await request.appContext.services.socratesService.streamV1ProjectMemory(
        {
          projectId,
          actorUserId: request.authUser!.userId,
          question: body.question ?? body.content ?? body.prompt!,
          sessionId,
          mode: body.mode,
          selectedSources: body.selectedSources,
          maxEvidence: body.maxEvidence,
          includeArtifacts: body.includeArtifacts,
          includeHistory: body.includeHistory,
          clientContext: body.clientContext,
          authorizedProjectRole: request.projectAuthorization!.projectRole
        },
        reply
      );
      return undefined;
    })
  );

  app.get(
    "/projects/:projectId/socrates/sessions/:sessionId/messages/:assistantMessageId/stream",
    rateLimitRouteOptions(app.appContext.env, "socratesStream"),
    authGuard(async (request, reply) => {
      const { projectId, sessionId, assistantMessageId } = assistantMessageParamsSchema.parse(request.params);
      const { offset } = resumeStreamQuerySchema.parse(request.query);
      preserveSseCorsHeaders(request, reply);
      await request.appContext.services.socratesService.resumeV1ProjectMemory(
        projectId,
        sessionId,
        assistantMessageId,
        request.authUser!.userId,
        offset,
        reply
      );
      return undefined;
    })
  );

  app.post(
    "/projects/:projectId/socrates/sessions/:sessionId/messages/:assistantMessageId/cancel",
    authGuard(async (request) => {
      const { projectId, sessionId, assistantMessageId } = assistantMessageParamsSchema.parse(request.params);
      const result = await request.appContext.services.socratesService.cancelV1ProjectMemory(
        projectId,
        sessionId,
        assistantMessageId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  // PATCH /v1/projects/:projectId/socrates/sessions/:sessionId/context
  app.patch(
    "/projects/:projectId/socrates/sessions/:sessionId/context",
    authGuard(async (request) => {
      const { projectId, sessionId } = sessionParamsSchema.parse(request.params);
      const body = patchContextBodySchema.parse(request.body);
      const session = await request.appContext.services.socratesService.patchContext(
        projectId,
        sessionId,
        request.authUser!.userId,
        body
      );
      return { data: session, meta: null, error: null };
    })
  );

  // GET /v1/projects/:projectId/socrates/sessions/:sessionId/suggestions
  app.get(
    "/projects/:projectId/socrates/sessions/:sessionId/suggestions",
    authGuard(async (request) => {
      const { projectId, sessionId } = sessionParamsSchema.parse(request.params);
      const result = await request.appContext.services.socratesService.getSuggestions(
        projectId,
        sessionId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  // POST /v1/projects/:projectId/socrates/sessions/:sessionId/messages/stream
  // SSE endpoint — does NOT follow the standard JSON envelope.
  // Sends SSE events: message_created | delta | done | error
  app.post(
    "/projects/:projectId/socrates/sessions/:sessionId/messages/stream",
    rateLimitRouteOptions(app.appContext.env, "socratesStream"),
    authGuard(async (request, reply) => {
      const { projectId, sessionId } = sessionParamsSchema.parse(request.params);
      const { content } = streamMessageBodySchema.parse(request.body);

      // SocratesService manages the SSE lifecycle and reply.raw directly.
      await request.appContext.services.socratesService.streamAnswer(
        projectId,
        sessionId,
        request.authUser!.userId,
        content,
        reply,
        request.requestId
      );

      // Return undefined — reply is handled inside streamAnswer.
      return undefined;
    })
  );

  // GET /v1/projects/:projectId/socrates/sessions/:sessionId/messages
  app.get(
    "/projects/:projectId/socrates/sessions/:sessionId/messages",
    authGuard(async (request) => {
      const { projectId, sessionId } = sessionParamsSchema.parse(request.params);
      const messages = await request.appContext.services.socratesService.getHistory(
        projectId,
        sessionId,
        request.authUser!.userId,
        true
      );
      return { data: messages, meta: null, error: null };
    })
  );
};
