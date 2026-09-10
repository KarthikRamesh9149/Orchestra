import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard as authGuard } from "../../app/auth.js";
import {
  createResponsibilitySchema,
  listResponsibilitiesQuerySchema,
  projectResponsibilitiesParamsSchema,
  responsibilityParamsSchema,
  updateResponsibilitySchema
} from "./responsibilities.schemas.js";

export const registerProjectResponsibilityRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/projects/:projectId/responsibilities",
    authGuard(async (request) => {
      const params = projectResponsibilitiesParamsSchema.parse(request.params);
      const query = listResponsibilitiesQuerySchema.parse(request.query);
      const result = await request.appContext.services.projectResponsibilitiesService.listResponsibilities(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.post(
    "/projects/:projectId/responsibilities",
    authGuard(async (request) => {
      const params = projectResponsibilitiesParamsSchema.parse(request.params);
      const body = createResponsibilitySchema.parse(request.body);
      const result = await request.appContext.services.projectResponsibilitiesService.createResponsibility(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/responsibilities/:responsibilityId",
    authGuard(async (request) => {
      const params = responsibilityParamsSchema.parse(request.params);
      const result = await request.appContext.services.projectResponsibilitiesService.getResponsibility(
        params.projectId,
        params.responsibilityId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.patch(
    "/projects/:projectId/responsibilities/:responsibilityId",
    authGuard(async (request) => {
      const params = responsibilityParamsSchema.parse(request.params);
      const body = updateResponsibilitySchema.parse(request.body);
      const result = await request.appContext.services.projectResponsibilitiesService.updateResponsibility(
        params.projectId,
        params.responsibilityId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.delete(
    "/projects/:projectId/responsibilities/:responsibilityId",
    authGuard(async (request) => {
      const params = responsibilityParamsSchema.parse(request.params);
      const result = await request.appContext.services.projectResponsibilitiesService.deleteResponsibility(
        params.projectId,
        params.responsibilityId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );
};
