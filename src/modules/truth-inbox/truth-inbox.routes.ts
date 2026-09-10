import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard } from "../../app/auth.js";
import {
  truthInboxActionBodySchema,
  truthInboxActionParamsSchema,
  truthInboxItemParamsSchema,
  truthInboxListQuerySchema,
  truthInboxProjectParamsSchema
} from "./truth-inbox.schemas.js";

const actorFrom = (request: { authUser?: { userId: string; orgId: string } }) => ({
  userId: request.authUser!.userId,
  orgId: request.authUser!.orgId
});

export const registerTruthInboxRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/projects/:projectId/truth-inbox",
    internalAuthGuard(async (request) => {
      const params = truthInboxProjectParamsSchema.parse(request.params);
      const query = truthInboxListQuerySchema.parse(request.query ?? {});
      const data = await request.appContext.services.truthInboxService.list(params.projectId, actorFrom(request), query);
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/truth-inbox/:itemId",
    internalAuthGuard(async (request) => {
      const params = truthInboxItemParamsSchema.parse(request.params);
      const data = await request.appContext.services.truthInboxService.get(params.projectId, params.itemId, actorFrom(request));
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/truth-inbox/:itemId/packet",
    internalAuthGuard(async (request) => {
      const params = truthInboxItemParamsSchema.parse(request.params);
      const data = await request.appContext.services.truthChangePacketService.get(params.projectId, params.itemId, actorFrom(request));
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/truth-inbox/:itemId/actions/:action",
    internalAuthGuard(async (request) => {
      const params = truthInboxActionParamsSchema.parse(request.params);
      const body = truthInboxActionBodySchema.parse(request.body ?? {});
      const data = await request.appContext.services.truthInboxService.act(params.projectId, params.itemId, params.action, actorFrom(request), body);
      return { data, meta: null, error: null };
    })
  );
};
