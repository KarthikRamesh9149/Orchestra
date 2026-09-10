import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard } from "../../app/auth.js";
import {
  agentPreflightBodySchema,
  deliveryItemParamsSchema,
  deliveryOverviewQuerySchema,
  deliveryProjectParamsSchema,
  deliveryRunParamsSchema
} from "./schemas.js";

const actorFrom = (request: { authUser?: { userId: string; orgId: string } }) => ({
  userId: request.authUser!.userId,
  orgId: request.authUser!.orgId
});

export const registerDeliveryRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/projects/:projectId/delivery",
    internalAuthGuard(async (request) => {
      const params = deliveryProjectParamsSchema.parse(request.params);
      const query = deliveryOverviewQuerySchema.parse(request.query ?? {});
      const data = await request.appContext.services.deliveryIntelligenceService.getOverview(params.projectId, actorFrom(request), query.refresh);
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/delivery/traces/:itemId",
    internalAuthGuard(async (request) => {
      const params = deliveryItemParamsSchema.parse(request.params);
      const data = await request.appContext.services.deliveryIntelligenceService.getTrace(params.projectId, params.itemId, actorFrom(request));
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/delivery/receipts/:itemId",
    internalAuthGuard(async (request, reply) => {
      const params = deliveryItemParamsSchema.parse(request.params);
      const data = await request.appContext.services.deliveryIntelligenceService.issueReceipt(params.projectId, params.itemId, actorFrom(request));
      reply.code(201);
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/delivery/weekly-brief",
    internalAuthGuard(async (request) => {
      const params = deliveryProjectParamsSchema.parse(request.params);
      const data = await request.appContext.services.deliveryIntelligenceService.generateWeeklyBrief(params.projectId, actorFrom(request));
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/delivery/agent-preflight",
    internalAuthGuard(async (request, reply) => {
      const params = deliveryProjectParamsSchema.parse(request.params);
      const body = agentPreflightBodySchema.parse(request.body);
      const data = await request.appContext.services.deliveryIntelligenceService.generatePreflight(params.projectId, actorFrom(request), body);
      reply.code(201);
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/delivery/agent-postflight/:runId",
    internalAuthGuard(async (request, reply) => {
      const params = deliveryRunParamsSchema.parse(request.params);
      const data = await request.appContext.services.deliveryIntelligenceService.generatePostflight(params.projectId, params.runId, actorFrom(request));
      reply.code(201);
      return { data, meta: null, error: null };
    })
  );
};
