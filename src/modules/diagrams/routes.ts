import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard as authGuard } from "../../app/auth.js";
import {
  createDiagramSchema,
  embedDiagramSchema,
  generateDiagramSchema,
  listDiagramsQuerySchema,
  liveDocDiagramParamsSchema,
  projectDiagramEntryParamsSchema,
  projectDiagramParamsSchema,
  updateDiagramSchema
} from "./schemas.js";

export const registerProjectDiagramRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/projects/:projectId/diagrams/generate",
    authGuard(async (request) => {
      const params = projectDiagramParamsSchema.parse(request.params);
      const body = generateDiagramSchema.parse(request.body);
      const result = await request.appContext.services.projectDiagramService.generateDiagram(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/diagrams",
    authGuard(async (request) => {
      const params = projectDiagramParamsSchema.parse(request.params);
      const body = createDiagramSchema.parse(request.body);
      const result = await request.appContext.services.projectDiagramService.createDiagram(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/diagrams",
    authGuard(async (request) => {
      const params = projectDiagramParamsSchema.parse(request.params);
      const query = listDiagramsQuerySchema.parse(request.query);
      const result = await request.appContext.services.projectDiagramService.listDiagrams(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.get(
    "/projects/:projectId/diagrams/:diagramId",
    authGuard(async (request) => {
      const params = projectDiagramEntryParamsSchema.parse(request.params);
      const result = await request.appContext.services.projectDiagramService.getDiagram(
        params.projectId,
        params.diagramId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.patch(
    "/projects/:projectId/diagrams/:diagramId",
    authGuard(async (request) => {
      const params = projectDiagramEntryParamsSchema.parse(request.params);
      const body = updateDiagramSchema.parse(request.body);
      const result = await request.appContext.services.projectDiagramService.updateDiagram(
        params.projectId,
        params.diagramId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.delete(
    "/projects/:projectId/diagrams/:diagramId",
    authGuard(async (request) => {
      const params = projectDiagramEntryParamsSchema.parse(request.params);
      const result = await request.appContext.services.projectDiagramService.deleteDiagram(
        params.projectId,
        params.diagramId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/live-doc/sections/:sectionKey/diagrams/:diagramId/embed",
    authGuard(async (request) => {
      const params = liveDocDiagramParamsSchema.parse(request.params);
      const body = embedDiagramSchema.parse(request.body ?? {});
      const result = await request.appContext.services.projectDiagramService.embedDiagramInLiveDoc(
        params.projectId,
        params.sectionKey,
        params.diagramId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.delete(
    "/projects/:projectId/live-doc/sections/:sectionKey/diagrams/:diagramId",
    authGuard(async (request) => {
      const params = liveDocDiagramParamsSchema.parse(request.params);
      const result = await request.appContext.services.projectDiagramService.removeDiagramFromLiveDoc(
        params.projectId,
        params.sectionKey,
        params.diagramId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );
};
