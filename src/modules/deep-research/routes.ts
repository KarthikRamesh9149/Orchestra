import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard } from "../../app/auth.js";
import {
  deepResearchExportQuerySchema,
  deepResearchParamsSchema,
  deepResearchRunParamsSchema,
  startDeepResearchSchema
} from "./schemas.js";

export const registerDeepResearchRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/projects/:projectId/deep-research",
    internalAuthGuard(async (request, reply) => {
      const params = deepResearchParamsSchema.parse(request.params);
      const body = startDeepResearchSchema.parse(request.body ?? {});
      const data = await request.appContext.services.deepResearchService.startRun(
        params.projectId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId },
        body
      );
      reply.code(202);
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/deep-research/usage",
    internalAuthGuard(async (request) => {
      const params = deepResearchParamsSchema.parse(request.params);
      const data = await request.appContext.services.deepResearchService.getUsage(params.projectId, {
        userId: request.authUser!.userId,
        orgId: request.authUser!.orgId
      });
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/deep-research/:runId",
    internalAuthGuard(async (request) => {
      const params = deepResearchRunParamsSchema.parse(request.params);
      const data = await request.appContext.services.deepResearchService.getRun(
        params.projectId,
        params.runId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId }
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/deep-research/:runId/add-to-memory",
    internalAuthGuard(async (request) => {
      const params = deepResearchRunParamsSchema.parse(request.params);
      const data = await request.appContext.services.deepResearchService.addToMemory(
        params.projectId,
        params.runId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId }
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/deep-research/:runId/export",
    internalAuthGuard(async (request, reply) => {
      const params = deepResearchRunParamsSchema.parse(request.params);
      const query = deepResearchExportQuerySchema.parse(request.query ?? {});
      const result = await request.appContext.services.deepResearchService.exportReport(
        params.projectId,
        params.runId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId },
        query.format
      );
      reply
        .type(result.contentType)
        .header("Content-Disposition", `attachment; filename="${result.filename}"`)
        .send(result.body);
    })
  );
};
