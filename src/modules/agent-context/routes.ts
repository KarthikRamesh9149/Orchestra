import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard as authGuard } from "../../app/auth.js";
import {
  agentRunParamsSchema,
  agentContextPackParamsSchema,
  agentQualityReviewParamsSchema,
  agentContextExportRequestSchema,
  createQualityReviewSchema,
  createAgentRunSchema,
  createAgentContextPackSchema,
  listAgentRunsQuerySchema,
  listAgentContextPacksQuerySchema,
  listQualityReviewsQuerySchema,
  listReviewFindingsQuerySchema,
  projectAgentContextParamsSchema,
  reviewAgentRunSchema,
  updateAgentRunSchema,
  updateAgentRunStatusSchema
} from "./schemas.js";

export const registerAgentContextPackRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/projects/:projectId/agent-context-packs",
    authGuard(async (request, reply) => {
      const params = projectAgentContextParamsSchema.parse(request.params);
      const body = createAgentContextPackSchema.parse(request.body);
      const result = await request.appContext.services.agentContextPackService.createPack(
        params.projectId,
        request.authUser!.userId,
        body
      );
      reply.code(201);
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-context-packs",
    authGuard(async (request) => {
      const params = projectAgentContextParamsSchema.parse(request.params);
      const query = listAgentContextPacksQuerySchema.parse(request.query);
      const result = await request.appContext.services.agentContextPackService.listPacks(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-context-packs/:packId/quality-reports",
    authGuard(async (request, reply) => {
      const params = agentContextPackParamsSchema.parse(request.params);
      const body = createQualityReviewSchema.parse(request.body ?? {});
      const result = await request.appContext.services.agentQualityDriftService.createContextPackQualityReport(
        params.projectId,
        params.packId,
        request.authUser!.userId,
        body
      );
      reply.code(201);
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-context-packs/:packId/quality-reports/refresh",
    authGuard(async (request) => {
      const params = agentContextPackParamsSchema.parse(request.params);
      const body = createQualityReviewSchema.parse(request.body ?? {});
      const result = await request.appContext.services.agentQualityDriftService.refreshContextPackQualityReport(
        params.projectId,
        params.packId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-context-packs/:packId/quality-reports/latest",
    authGuard(async (request) => {
      const params = agentContextPackParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentQualityDriftService.getLatestContextPackQualityReport(
        params.projectId,
        params.packId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-context-packs/:packId/quality-reports",
    authGuard(async (request) => {
      const params = agentContextPackParamsSchema.parse(request.params);
      const query = listQualityReviewsQuerySchema.parse(request.query);
      const result = await request.appContext.services.agentQualityDriftService.listContextPackQualityReports(
        params.projectId,
        params.packId,
        request.authUser!.userId,
        query
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-context-packs/:packId",
    authGuard(async (request) => {
      const params = agentContextPackParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentContextPackService.getPack(
        params.projectId,
        params.packId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-context-packs/:packId/export-formats",
    authGuard(async (request) => {
      const params = agentContextPackParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentContextPackService.listExportFormats(
        params.projectId,
        params.packId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-context-packs/:packId/exports/preview",
    authGuard(async (request) => {
      const params = agentContextPackParamsSchema.parse(request.params);
      const body = agentContextExportRequestSchema.parse(request.body);
      const result = await request.appContext.services.agentContextPackService.previewExport(
        params.projectId,
        params.packId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-context-packs/:packId/exports",
    authGuard(async (request) => {
      const params = agentContextPackParamsSchema.parse(request.params);
      const body = agentContextExportRequestSchema.parse(request.body);
      const result = await request.appContext.services.agentContextPackService.generateExport(
        params.projectId,
        params.packId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-context-packs/:packId/refresh",
    authGuard(async (request) => {
      const params = agentContextPackParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentContextPackService.refreshPack(
        params.projectId,
        params.packId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-context-packs/:packId/archive",
    authGuard(async (request) => {
      const params = agentContextPackParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentContextPackService.archivePack(
        params.projectId,
        params.packId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.delete(
    "/projects/:projectId/agent-context-packs/:packId",
    authGuard(async (request) => {
      const params = agentContextPackParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentContextPackService.deletePack(
        params.projectId,
        params.packId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-runs",
    authGuard(async (request, reply) => {
      const params = projectAgentContextParamsSchema.parse(request.params);
      const body = createAgentRunSchema.parse(request.body);
      const result = await request.appContext.services.agentRunMemoryService.createRun(
        params.projectId,
        request.authUser!.userId,
        body
      );
      reply.code(201);
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-runs",
    authGuard(async (request) => {
      const params = projectAgentContextParamsSchema.parse(request.params);
      const query = listAgentRunsQuerySchema.parse(request.query);
      const result = await request.appContext.services.agentRunMemoryService.listRuns(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-runs/:runId",
    authGuard(async (request) => {
      const params = agentRunParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentRunMemoryService.getRun(
        params.projectId,
        params.runId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.patch(
    "/projects/:projectId/agent-runs/:runId",
    authGuard(async (request) => {
      const params = agentRunParamsSchema.parse(request.params);
      const body = updateAgentRunSchema.parse(request.body);
      const result = await request.appContext.services.agentRunMemoryService.updateRun(
        params.projectId,
        params.runId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-runs/:runId/status",
    authGuard(async (request) => {
      const params = agentRunParamsSchema.parse(request.params);
      const body = updateAgentRunStatusSchema.parse(request.body);
      const result = await request.appContext.services.agentRunMemoryService.updateStatus(
        params.projectId,
        params.runId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-runs/:runId/review",
    authGuard(async (request) => {
      const params = agentRunParamsSchema.parse(request.params);
      const body = reviewAgentRunSchema.parse(request.body);
      const result = await request.appContext.services.agentRunMemoryService.reviewRun(
        params.projectId,
        params.runId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-runs/:runId/archive",
    authGuard(async (request) => {
      const params = agentRunParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentRunMemoryService.archiveRun(
        params.projectId,
        params.runId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.delete(
    "/projects/:projectId/agent-runs/:runId",
    authGuard(async (request) => {
      const params = agentRunParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentRunMemoryService.deleteRun(
        params.projectId,
        params.runId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-runs/:runId/quality-reviews",
    authGuard(async (request, reply) => {
      const params = agentRunParamsSchema.parse(request.params);
      const body = createQualityReviewSchema.parse(request.body ?? {});
      const result = await request.appContext.services.agentQualityDriftService.createAgentRunReview(
        params.projectId,
        params.runId,
        request.authUser!.userId,
        body
      );
      reply.code(201);
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-runs/:runId/quality-reviews/refresh",
    authGuard(async (request) => {
      const params = agentRunParamsSchema.parse(request.params);
      const body = createQualityReviewSchema.parse(request.body ?? {});
      const result = await request.appContext.services.agentQualityDriftService.refreshAgentRunReview(
        params.projectId,
        params.runId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-runs/:runId/quality-reviews/latest",
    authGuard(async (request) => {
      const params = agentRunParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentQualityDriftService.getLatestAgentRunReview(
        params.projectId,
        params.runId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-runs/:runId/quality-reviews",
    authGuard(async (request) => {
      const params = agentRunParamsSchema.parse(request.params);
      const query = listQualityReviewsQuerySchema.parse(request.query);
      const result = await request.appContext.services.agentQualityDriftService.listAgentRunReviews(
        params.projectId,
        params.runId,
        request.authUser!.userId,
        query
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-quality-reviews/pressure",
    authGuard(async (request) => {
      const params = projectAgentContextParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentQualityDriftService.getProjectReviewPressure(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-quality-reviews/:reviewId",
    authGuard(async (request) => {
      const params = agentQualityReviewParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentQualityDriftService.getReview(
        params.projectId,
        params.reviewId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-quality-reviews/:reviewId/findings",
    authGuard(async (request) => {
      const params = agentQualityReviewParamsSchema.parse(request.params);
      const query = listReviewFindingsQuerySchema.parse(request.query);
      const result = await request.appContext.services.agentQualityDriftService.listReviewFindings(
        params.projectId,
        params.reviewId,
        request.authUser!.userId,
        query
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-quality-reviews/:reviewId/archive",
    authGuard(async (request) => {
      const params = agentQualityReviewParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentQualityDriftService.archiveReview(
        params.projectId,
        params.reviewId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );
};
