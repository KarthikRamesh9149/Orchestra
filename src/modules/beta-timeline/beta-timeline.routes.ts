import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard as authGuard, requireProjectRole } from "../../app/auth.js";
import {
  createTimelineEventSchema,
  timelineEventParamsSchema,
  timelineProjectParamsSchema,
  timelineQuerySchema
} from "./schemas.js";

export const registerBetaTimelineRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/projects/:projectId/timeline",
    authGuard(async (request) => {
      requireProjectRole(request, ["manager", "dev", "client"]);
      const params = timelineProjectParamsSchema.parse(request.params);
      const query = timelineQuerySchema.parse(request.query);
      const result = await request.appContext.services.betaTimelineService.listTimeline(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/timeline/events",
    authGuard(async (request) => {
      requireProjectRole(request, ["manager", "dev"]);
      const params = timelineProjectParamsSchema.parse(request.params);
      const body = createTimelineEventSchema.parse(request.body);
      const result = await request.appContext.services.betaTimelineService.createManualEvent(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/timeline/events/:eventId",
    authGuard(async (request) => {
      requireProjectRole(request, ["manager", "dev", "client"]);
      const params = timelineEventParamsSchema.parse(request.params);
      const result = await request.appContext.services.betaTimelineService.getTimelineEvent(
        params.projectId,
        params.eventId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );
};
