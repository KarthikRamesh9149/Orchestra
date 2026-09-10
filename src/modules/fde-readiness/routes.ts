import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard } from "../../app/auth.js";
import {
  decisionEngineeringLinkInputSchema,
  fdeFindingQuerySchema,
  fdeReadinessParamsSchema,
  fdeTraceParamsSchema,
  rationaleTraceInputSchema,
  safeToTouchFileQuerySchema
} from "./schemas.js";

const actorFrom = (request: { authUser?: { userId: string; orgId: string } }) => ({
  userId: request.authUser!.userId,
  orgId: request.authUser!.orgId
});

export const registerFdeReadinessRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/projects/:projectId/fde-readiness/conflicts",
    internalAuthGuard(async (request) => {
      const params = fdeReadinessParamsSchema.parse(request.params);
      const query = fdeFindingQuerySchema.parse(request.query ?? {});
      const data = await request.appContext.services.fdeReadinessService.listConflicts(params.projectId, actorFrom(request), query);
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/fde-readiness/conflicts/refresh",
    internalAuthGuard(async (request, reply) => {
      const params = fdeReadinessParamsSchema.parse(request.params);
      const data = await request.appContext.services.fdeReadinessService.refreshConflicts(params.projectId, actorFrom(request));
      reply.code(202);
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/fde-readiness/safe-to-touch",
    internalAuthGuard(async (request) => {
      const params = fdeReadinessParamsSchema.parse(request.params);
      const query = fdeFindingQuerySchema.parse(request.query ?? {});
      const data = await request.appContext.services.fdeReadinessService.listSafeToTouch(params.projectId, actorFrom(request), query);
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/fde-readiness/safe-to-touch/file",
    internalAuthGuard(async (request) => {
      const params = fdeReadinessParamsSchema.parse(request.params);
      const query = safeToTouchFileQuerySchema.parse(request.query ?? {});
      const data = await request.appContext.services.fdeReadinessService.getSafeToTouchForFile(params.projectId, actorFrom(request), query.filePath);
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/fde-readiness/safe-to-touch/refresh",
    internalAuthGuard(async (request, reply) => {
      const params = fdeReadinessParamsSchema.parse(request.params);
      const data = await request.appContext.services.fdeReadinessService.refreshSafeToTouch(params.projectId, actorFrom(request));
      reply.code(202);
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/fde-readiness/duplicates",
    internalAuthGuard(async (request) => {
      const params = fdeReadinessParamsSchema.parse(request.params);
      const query = fdeFindingQuerySchema.parse(request.query ?? {});
      const data = await request.appContext.services.fdeReadinessService.listDuplicates(params.projectId, actorFrom(request), query);
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/fde-readiness/duplicates/refresh",
    internalAuthGuard(async (request, reply) => {
      const params = fdeReadinessParamsSchema.parse(request.params);
      const data = await request.appContext.services.fdeReadinessService.refreshDuplicates(params.projectId, actorFrom(request));
      reply.code(202);
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/fde-readiness/live-working-map",
    internalAuthGuard(async (request) => {
      const params = fdeReadinessParamsSchema.parse(request.params);
      const query = fdeFindingQuerySchema.parse(request.query ?? {});
      const data = await request.appContext.services.fdeReadinessService.listLiveWorkingMap(params.projectId, actorFrom(request), query);
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/fde-readiness/live-working-map/refresh",
    internalAuthGuard(async (request, reply) => {
      const params = fdeReadinessParamsSchema.parse(request.params);
      const data = await request.appContext.services.fdeReadinessService.refreshLiveWorkingMap(params.projectId, actorFrom(request));
      reply.code(202);
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/fde-readiness/rationale-traces",
    internalAuthGuard(async (request) => {
      const params = fdeReadinessParamsSchema.parse(request.params);
      const data = await request.appContext.services.fdeReadinessService.listRationaleTraces(params.projectId, actorFrom(request));
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/fde-readiness/rationale-traces",
    internalAuthGuard(async (request, reply) => {
      const params = fdeReadinessParamsSchema.parse(request.params);
      const body = rationaleTraceInputSchema.parse(request.body ?? {});
      const data = await request.appContext.services.fdeReadinessService.createRationaleTrace(params.projectId, actorFrom(request), body);
      reply.code(201);
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/fde-readiness/rationale-traces/:traceId",
    internalAuthGuard(async (request) => {
      const params = fdeTraceParamsSchema.parse(request.params);
      const data = await request.appContext.services.fdeReadinessService.getRationaleTrace(params.projectId, params.traceId, actorFrom(request));
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/fde-readiness/decision-links",
    internalAuthGuard(async (request) => {
      const params = fdeReadinessParamsSchema.parse(request.params);
      const data = await request.appContext.services.fdeReadinessService.listDecisionEngineeringLinks(params.projectId, actorFrom(request));
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/fde-readiness/decision-links",
    internalAuthGuard(async (request, reply) => {
      const params = fdeReadinessParamsSchema.parse(request.params);
      const body = decisionEngineeringLinkInputSchema.parse(request.body ?? {});
      const data = await request.appContext.services.fdeReadinessService.createDecisionEngineeringLink(params.projectId, actorFrom(request), body);
      reply.code(201);
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/fde-readiness/refresh",
    internalAuthGuard(async (request, reply) => {
      const params = fdeReadinessParamsSchema.parse(request.params);
      const data = await request.appContext.services.fdeReadinessService.refreshAll(params.projectId, actorFrom(request));
      reply.code(202);
      return { data, meta: null, error: null };
    })
  );
};
