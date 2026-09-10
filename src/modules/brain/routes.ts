import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { internalAuthGuard as authGuard, requireManager } from "../../app/auth.js";
import { AppError } from "../../app/errors.js";
import { isMvpEqualProjectAccessEnabled, shouldShowVersionHistory } from "../../lib/mvp/policy.js";

const projectParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const registerBrainRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/projects/:projectId/brain/rebuild",
    authGuard(async (request) => {
      if (!isMvpEqualProjectAccessEnabled(request.appContext.env)) {
        requireManager(request);
      }
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.brainService.rebuild(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/brain/current",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.brainService.getCurrentBrain(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/brain/versions",
    authGuard(async (request) => {
      if (!shouldShowVersionHistory(request.appContext.env)) {
        throw new AppError(403, "Version history is disabled in MVP mode", "feature_disabled");
      }
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.brainService.getBrainVersions(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/brain/graph/current",
    authGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.brainService.getCurrentGraph(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );
};
