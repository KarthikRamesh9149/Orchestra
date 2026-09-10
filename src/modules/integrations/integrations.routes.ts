import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { internalAuthGuard } from "../../app/auth.js";

const projectParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const registerIntegrationManagementRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/projects/:projectId/integrations/status",
    internalAuthGuard(async (request) => {
      const params = projectParamsSchema.parse(request.params);
      const data = await request.appContext.services.integrationManagementService.getProjectIntegrationStatus(
        params.projectId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId }
      );
      return { data, meta: null, error: null };
    })
  );
};
