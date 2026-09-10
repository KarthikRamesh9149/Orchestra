import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard } from "../../app/auth.js";
import {
  suggestionActionBodySchema,
  suggestionListQuerySchema,
  suggestionParamsSchema,
  suggestionProjectParamsSchema
} from "./suggestions.schemas.js";

export const registerSuggestionRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/projects/:projectId/suggestions",
    internalAuthGuard(async (request) => {
      const params = suggestionProjectParamsSchema.parse(request.params);
      const query = suggestionListQuerySchema.parse(request.query ?? {});
      const data = await request.appContext.services.suggestionsService.list(
        params.projectId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId },
        query
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/suggestions/:suggestionId",
    internalAuthGuard(async (request) => {
      const params = suggestionParamsSchema.parse(request.params);
      const data = await request.appContext.services.suggestionsService.get(
        params.projectId,
        params.suggestionId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId }
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/suggestions/:suggestionId/dismiss",
    internalAuthGuard(async (request) => {
      const params = suggestionParamsSchema.parse(request.params);
      const body = suggestionActionBodySchema.parse(request.body ?? {});
      const data = await request.appContext.services.suggestionsService.dismiss(
        params.projectId,
        params.suggestionId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId },
        body.note
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/suggestions/:suggestionId/promote-to-timeline",
    internalAuthGuard(async (request) => {
      const params = suggestionParamsSchema.parse(request.params);
      const data = await request.appContext.services.suggestionsService.promoteToTimeline(
        params.projectId,
        params.suggestionId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId }
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/suggestions/:suggestionId/create-review-item",
    internalAuthGuard(async (request) => {
      const params = suggestionParamsSchema.parse(request.params);
      const data = await request.appContext.services.suggestionsService.createReviewItem(
        params.projectId,
        params.suggestionId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId }
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/suggestions/:suggestionId/ask-socrates",
    internalAuthGuard(async (request) => {
      const params = suggestionParamsSchema.parse(request.params);
      const data = await request.appContext.services.suggestionsService.askSocrates(
        params.projectId,
        params.suggestionId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId }
      );
      return { data, meta: null, error: null };
    })
  );
};
