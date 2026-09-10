import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard } from "../../app/auth.js";
import {
  agentFileParamsSchema,
  agentFileSyncRunParamsSchema,
  agentFileSetParamsSchema,
  agentFileVersionParamsSchema,
  createAgentFileSyncRunSchema,
  createAgentFileSetSchema,
  githubPrSyncSchema,
  listAgentFileSetsQuerySchema,
  previewAgentFileSetSchema,
  projectAgentFilesParamsSchema,
  refreshAgentFileSetSchema,
  refreshDriftReportSchema,
  refreshQualityReportSchema,
  reportAgentFileConflictSchema,
  updateAgentFileSyncRunSchema
} from "./schemas.js";

export const registerAgentFilesRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/projects/:projectId/agent-files",
    internalAuthGuard(async (request) => {
      const params = projectAgentFilesParamsSchema.parse(request.params);
      const query = listAgentFileSetsQuerySchema.parse(request.query);
      const result = await request.appContext.services.agentFilesService.listFileSets(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-files/file-sets",
    internalAuthGuard(async (request, reply) => {
      const params = projectAgentFilesParamsSchema.parse(request.params);
      const body = createAgentFileSetSchema.parse(request.body ?? {});
      const result = await request.appContext.services.agentFilesService.createDefaultFileSet(
        params.projectId,
        request.authUser!.userId,
        body
      );
      reply.code(201);
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-files/default",
    internalAuthGuard(async (request) => {
      const params = projectAgentFilesParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.getOrCreateDefault(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-files/default/preview",
    internalAuthGuard(async (request) => {
      const params = projectAgentFilesParamsSchema.parse(request.params);
      const fileSet = await request.appContext.services.agentFilesService.getOrCreateDefault(
        params.projectId,
        request.authUser!.userId
      );
      const body = previewAgentFileSetSchema.parse(request.body ?? {});
      const result = await request.appContext.services.agentFilesService.previewFileSet(
        params.projectId,
        fileSet.id,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-files/default/generate",
    internalAuthGuard(async (request) => {
      const params = projectAgentFilesParamsSchema.parse(request.params);
      const fileSet = await request.appContext.services.agentFilesService.getOrCreateDefault(
        params.projectId,
        request.authUser!.userId
      );
      const body = previewAgentFileSetSchema.parse(request.body ?? {});
      const result = await request.appContext.services.agentFilesService.generateFileSet(
        params.projectId,
        fileSet.id,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-files/file-sets/:fileSetId",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.getFileSet(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/preview",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const body = previewAgentFileSetSchema.parse(request.body ?? {});
      const result = await request.appContext.services.agentFilesService.previewFileSet(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/generate",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const body = previewAgentFileSetSchema.parse(request.body ?? {});
      const result = await request.appContext.services.agentFilesService.generateFileSet(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/archive",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.archiveFileSet(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/refresh",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const body = refreshAgentFileSetSchema.parse(request.body ?? {});
      const result = await request.appContext.services.agentFilesService.refreshFileSet(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/staleness",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.getStaleness(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/diff",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.getDiff(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/download",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.downloadBundle(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/manifest",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.getManifest(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/github-readiness",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.getGithubReadiness(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/sync/github-pr",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const body = githubPrSyncSchema.parse(request.body ?? {});
      const result = await request.appContext.services.agentFilesService.syncGithubPr(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/quality",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.getQualityReport(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/quality/refresh",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const body = refreshQualityReportSchema.parse(request.body ?? {});
      const result = await request.appContext.services.agentFilesService.refreshQualityReport(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/drift",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.getDriftReport(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/drift/refresh",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const body = refreshDriftReportSchema.parse(request.body ?? {});
      const result = await request.appContext.services.agentFilesService.refreshDriftReport(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/release-gate",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.checkReleaseGate(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/release-gate/check",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.checkReleaseGate(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/conflicts",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const body = reportAgentFileConflictSchema.parse(request.body ?? {});
      const result = await request.appContext.services.agentFilesService.reportConflict(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/files/:fileId/latest",
    internalAuthGuard(async (request) => {
      const params = agentFileParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.getLatestFile(
        params.projectId,
        params.fileSetId,
        params.fileId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/sync-runs",
    internalAuthGuard(async (request, reply) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const body = createAgentFileSyncRunSchema.parse(request.body ?? {});
      const result = await request.appContext.services.agentFilesService.createSyncRun(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId,
        body
      );
      reply.code(201);
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/sync-runs",
    internalAuthGuard(async (request) => {
      const params = agentFileSetParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.listSyncRuns(
        params.projectId,
        params.fileSetId,
        request.authUser!.userId
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/sync-runs/:syncRunId",
    internalAuthGuard(async (request) => {
      const params = agentFileSyncRunParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.getSyncRun(
        params.projectId,
        params.fileSetId,
        params.syncRunId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.patch(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/sync-runs/:syncRunId",
    internalAuthGuard(async (request) => {
      const params = agentFileSyncRunParamsSchema.parse(request.params);
      const body = updateAgentFileSyncRunSchema.parse(request.body ?? {});
      const result = await request.appContext.services.agentFilesService.updateSyncRun(
        params.projectId,
        params.fileSetId,
        params.syncRunId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/files/:fileId",
    internalAuthGuard(async (request) => {
      const params = agentFileParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.getFile(
        params.projectId,
        params.fileSetId,
        params.fileId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/files/:fileId/versions",
    internalAuthGuard(async (request) => {
      const params = agentFileParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.listFileVersions(
        params.projectId,
        params.fileSetId,
        params.fileId,
        request.authUser!.userId
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.get(
    "/projects/:projectId/agent-files/file-sets/:fileSetId/files/:fileId/versions/:versionId",
    internalAuthGuard(async (request) => {
      const params = agentFileVersionParamsSchema.parse(request.params);
      const result = await request.appContext.services.agentFilesService.getFileVersion(
        params.projectId,
        params.fileSetId,
        params.fileId,
        params.versionId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );
};
