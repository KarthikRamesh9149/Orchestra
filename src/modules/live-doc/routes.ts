import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard as authGuard, requireProjectRole, requireTruthApprover } from "../../app/auth.js";
import { AppError } from "../../app/errors.js";
import { shouldShowVersionHistory } from "../../lib/mvp/policy.js";
import {
  createCommentBodySchema,
  generateDiagramBodySchema,
  listCommentsQuerySchema,
  liveDocCurrentQuerySchema,
  patchSectionBodySchema,
  projectParamsSchema,
  reviewItemParamsSchema,
  setLiveDocSourceBodySchema,
  sectionParamsSchema
} from "./schemas.js";

export const registerLiveDocRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/projects/:projectId/live-doc/current",
    authGuard(async (request) => {
      requireProjectRole(request, ["manager", "dev"]);
      const params = projectParamsSchema.parse(request.params);
      const query = liveDocCurrentQuerySchema.parse(request.query);
      const result = await request.appContext.services.liveDocService.getCurrent(
        params.projectId,
        request.authUser!.userId,
        { forceRefresh: query.forceRefresh }
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/live-doc/source",
    authGuard(async (request) => {
      requireProjectRole(request, ["manager", "dev"]);
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.liveDocService.getPrimarySource(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/live-doc/source",
    authGuard(async (request) => {
      requireProjectRole(request, ["manager", "dev"]);
      const params = projectParamsSchema.parse(request.params);
      const body = setLiveDocSourceBodySchema.parse(request.body);
      const result = await request.appContext.services.liveDocService.setPrimarySource(
        params.projectId,
        request.authUser!.userId,
        body.documentId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.patch(
    "/projects/:projectId/live-doc/sections/:sectionKey",
    authGuard(async (request) => {
      requireProjectRole(request, ["manager", "dev"]);
      const params = sectionParamsSchema.parse(request.params);
      const body = patchSectionBodySchema.parse(request.body);
      const result = await request.appContext.services.liveDocService.patchSection(
        params.projectId,
        params.sectionKey,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/live-doc/comments",
    authGuard(async (request) => {
      requireProjectRole(request, ["manager", "dev"]);
      const params = projectParamsSchema.parse(request.params);
      const query = listCommentsQuerySchema.parse(request.query);
      const result = await request.appContext.services.liveDocService.listComments(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/live-doc/review-items",
    authGuard(async (request) => {
      requireProjectRole(request, ["manager", "dev"]);
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.liveDocService.listReviewItems(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/live-doc/change-markers",
    authGuard(async (request) => {
      requireProjectRole(request, ["manager", "dev"]);
      const params = projectParamsSchema.parse(request.params);
      const result = await request.appContext.services.liveDocService.listChangeMarkers(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/live-doc/sections/:sectionKey/review-items",
    authGuard(async (request) => {
      requireProjectRole(request, ["manager", "dev"]);
      const params = sectionParamsSchema.parse(request.params);
      const result = await request.appContext.services.liveDocService.listReviewItems(
        params.projectId,
        request.authUser!.userId,
        { sectionKey: params.sectionKey }
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/live-doc/review-items/:proposalId/accept",
    authGuard(async (request) => {
      requireTruthApprover(request);
      const params = reviewItemParamsSchema.parse(request.params);
      const result = await request.appContext.services.liveDocService.acceptReviewItem(
        params.projectId,
        params.proposalId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/live-doc/review-items/:proposalId/reject",
    authGuard(async (request) => {
      requireTruthApprover(request);
      const params = reviewItemParamsSchema.parse(request.params);
      const result = await request.appContext.services.liveDocService.rejectReviewItem(
        params.projectId,
        params.proposalId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/live-doc/comments",
    authGuard(async (request) => {
      requireProjectRole(request, ["manager", "dev"]);
      const params = projectParamsSchema.parse(request.params);
      const body = createCommentBodySchema.parse(request.body);
      const result = await request.appContext.services.liveDocService.createComment(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/live-doc/sections/:sectionKey/history",
    authGuard(async (request) => {
      if (!shouldShowVersionHistory(request.appContext.env)) {
        throw new AppError(403, "Version history is disabled in MVP mode", "feature_disabled");
      }
      requireProjectRole(request, ["manager", "dev"]);
      const params = sectionParamsSchema.parse(request.params);
      const result = await request.appContext.services.liveDocService.getSectionHistory(
        params.projectId,
        params.sectionKey,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/live-doc/sections/:sectionKey/provenance",
    authGuard(async (request) => {
      requireProjectRole(request, ["manager", "dev"]);
      const params = sectionParamsSchema.parse(request.params);
      const result = await request.appContext.services.liveDocService.getSectionProvenance(
        params.projectId,
        params.sectionKey,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/live-doc/diagrams/generate",
    authGuard(async (request) => {
      requireProjectRole(request, ["manager", "dev"]);
      const params = projectParamsSchema.parse(request.params);
      const body = generateDiagramBodySchema.parse(request.body);
      const result = await request.appContext.services.liveDocService.generateDiagram(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );
};
