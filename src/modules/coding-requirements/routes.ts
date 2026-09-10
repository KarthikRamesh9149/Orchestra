import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard as authGuard } from "../../app/auth.js";
import { rateLimitRouteOptions } from "../../app/security.js";
import {
  codingRequirementsArtifactParamsSchema,
  codingRequirementsHistoryQuerySchema,
  codingRequirementsParamsSchema,
  generateCodingRequirementsSchema
} from "./schemas.js";

export const registerCodingRequirementsRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/projects/:projectId/coding-requirements/generate",
    rateLimitRouteOptions(app.appContext.env, "socratesStream"),
    authGuard(async (request) => {
      const params = codingRequirementsParamsSchema.parse(request.params);
      const body = generateCodingRequirementsSchema.parse(request.body ?? {});
      const result = await request.appContext.services.codingRequirementsService.generate(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/coding-requirements/:codingRequirementsId/accept",
    authGuard(async (request) => {
      const params = codingRequirementsArtifactParamsSchema.parse(request.params);
      const result = await request.appContext.services.codingRequirementsService.acceptDraft(
        params.projectId,
        params.codingRequirementsId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/coding-requirements/current",
    authGuard(async (request) => {
      const params = codingRequirementsParamsSchema.parse(request.params);
      const result = await request.appContext.services.codingRequirementsService.getCurrent(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/coding-requirements/history",
    authGuard(async (request) => {
      const params = codingRequirementsParamsSchema.parse(request.params);
      const query = codingRequirementsHistoryQuerySchema.parse(request.query ?? {});
      const result = await request.appContext.services.codingRequirementsService.getHistory(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.get(
    "/projects/:projectId/coding-requirements/flowchart",
    authGuard(async (request) => {
      const params = codingRequirementsParamsSchema.parse(request.params);
      const result = await request.appContext.services.codingRequirementsService.getFlowchart(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );
};
