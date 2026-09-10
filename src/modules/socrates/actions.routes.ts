import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard as authGuard } from "../../app/auth.js";
import {
  actionParamsSchema,
  createActionBodySchema,
  listActionsQuerySchema,
  rejectActionBodySchema,
  sessionActionParamsSchema
} from "./actions.schemas.js";

export const registerSocratesActionRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/projects/:projectId/socrates/sessions/:sessionId/actions",
    authGuard(async (request) => {
      const { projectId, sessionId } = sessionActionParamsSchema.parse(request.params);
      const body = createActionBodySchema.parse(request.body);
      const action = await request.appContext.services.socratesActionService.createAction(
        projectId,
        sessionId,
        request.authUser!.userId,
        body
      );
      return { data: action, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/socrates/actions",
    authGuard(async (request) => {
      const { projectId } = actionParamsSchema.pick({ projectId: true }).parse(request.params);
      const query = listActionsQuerySchema.parse(request.query);
      const result = await request.appContext.services.socratesActionService.listActions(
        projectId,
        request.authUser!.userId,
        query
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.get(
    "/projects/:projectId/socrates/actions/:actionId",
    authGuard(async (request) => {
      const { projectId, actionId } = actionParamsSchema.parse(request.params);
      const action = await request.appContext.services.socratesActionService.getAction(
        projectId,
        actionId,
        request.authUser!.userId
      );
      return { data: action, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/socrates/actions/:actionId/apply",
    authGuard(async (request) => {
      const { projectId, actionId } = actionParamsSchema.parse(request.params);
      const action = await request.appContext.services.socratesActionService.applyAction(
        projectId,
        actionId,
        request.authUser!.userId
      );
      return { data: action, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/socrates/actions/:actionId/reject",
    authGuard(async (request) => {
      const { projectId, actionId } = actionParamsSchema.parse(request.params);
      const body = rejectActionBodySchema.parse(request.body ?? {});
      const action = await request.appContext.services.socratesActionService.rejectAction(
        projectId,
        actionId,
        request.authUser!.userId,
        body
      );
      return { data: action, meta: null, error: null };
    })
  );
};
