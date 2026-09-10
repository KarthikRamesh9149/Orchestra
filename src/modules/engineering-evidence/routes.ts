import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard } from "../../app/auth.js";
import {
  engineeringEvidenceItemParamsSchema,
  engineeringEvidenceParamsSchema,
  listEngineeringEvidenceQuerySchema,
  manualEngineeringEvidenceSchema,
  refreshEngineeringEvidenceSchema
} from "./schemas.js";

export const registerEngineeringEvidenceRoutes: FastifyPluginAsync = async (app) => {
  const bodyWithEntryType = (body: unknown, entryType: "mock_real" | "integration_seam" | "branch_deploy_truth") =>
    manualEngineeringEvidenceSchema.parse({ ...((body ?? {}) as Record<string, unknown>), entryType });

  app.get(
    "/projects/:projectId/engineering-evidence",
    internalAuthGuard(async (request) => {
      const params = engineeringEvidenceParamsSchema.parse(request.params);
      const query = listEngineeringEvidenceQuerySchema.parse(request.query ?? {});
      const data = await request.appContext.services.engineeringEvidenceService.listEvidence(
        params.projectId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId },
        query
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/engineering-evidence/sources",
    internalAuthGuard(async (request) => {
      const params = engineeringEvidenceParamsSchema.parse(request.params);
      const data = await request.appContext.services.engineeringEvidenceService.listSources(
        params.projectId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId }
      );
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/engineering-evidence/refresh",
    internalAuthGuard(async (request, reply) => {
      const params = engineeringEvidenceParamsSchema.parse(request.params);
      const body = refreshEngineeringEvidenceSchema.parse(request.body ?? {});
      const data = await request.appContext.services.engineeringEvidenceService.refresh(
        params.projectId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId },
        body
      );
      reply.code(202);
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/engineering-evidence/manual",
    internalAuthGuard(async (request, reply) => {
      const params = engineeringEvidenceParamsSchema.parse(request.params);
      const body = manualEngineeringEvidenceSchema.parse(request.body ?? {});
      const data = await request.appContext.services.engineeringEvidenceService.createManualEntry(
        params.projectId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId },
        body
      );
      reply.code(201);
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/engineering-evidence/:evidenceId",
    internalAuthGuard(async (request) => {
      const params = engineeringEvidenceItemParamsSchema.parse(request.params);
      const data = await request.appContext.services.engineeringEvidenceService.getEvidence(
        params.projectId,
        params.evidenceId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId }
      );
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/mock-real-registry",
    internalAuthGuard(async (request) => {
      const params = engineeringEvidenceParamsSchema.parse(request.params);
      const data = await request.appContext.services.engineeringEvidenceService.listMockRealRegistry(params.projectId, {
        userId: request.authUser!.userId,
        orgId: request.authUser!.orgId
      });
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/mock-real-registry/refresh",
    internalAuthGuard(async (request, reply) => {
      const params = engineeringEvidenceParamsSchema.parse(request.params);
      const data = await request.appContext.services.engineeringEvidenceService.refresh(
        params.projectId,
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId },
        { sourceTypes: ["github", "agent_run", "route_registry"] }
      );
      reply.code(202);
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/mock-real-registry/manual",
    internalAuthGuard(async (request, reply) => {
      const params = engineeringEvidenceParamsSchema.parse(request.params);
      const body = bodyWithEntryType(request.body, "mock_real");
      const data = await request.appContext.services.engineeringEvidenceService.createManualEntry(params.projectId, { userId: request.authUser!.userId, orgId: request.authUser!.orgId }, body);
      reply.code(201);
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/integration-seams",
    internalAuthGuard(async (request) => {
      const params = engineeringEvidenceParamsSchema.parse(request.params);
      const data = await request.appContext.services.engineeringEvidenceService.listIntegrationSeams(params.projectId, { userId: request.authUser!.userId, orgId: request.authUser!.orgId });
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/integration-seams/refresh",
    internalAuthGuard(async (request, reply) => {
      const params = engineeringEvidenceParamsSchema.parse(request.params);
      const data = await request.appContext.services.engineeringEvidenceService.refresh(params.projectId, { userId: request.authUser!.userId, orgId: request.authUser!.orgId }, { sourceTypes: ["route_registry", "github", "manual"] });
      reply.code(202);
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/integration-seams/manual",
    internalAuthGuard(async (request, reply) => {
      const params = engineeringEvidenceParamsSchema.parse(request.params);
      const body = bodyWithEntryType(request.body, "integration_seam");
      const data = await request.appContext.services.engineeringEvidenceService.createManualEntry(params.projectId, { userId: request.authUser!.userId, orgId: request.authUser!.orgId }, body);
      reply.code(201);
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/branch-deploy-truth",
    internalAuthGuard(async (request) => {
      const params = engineeringEvidenceParamsSchema.parse(request.params);
      const data = await request.appContext.services.engineeringEvidenceService.listBranchDeployTruth(params.projectId, { userId: request.authUser!.userId, orgId: request.authUser!.orgId });
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/branch-deploy-truth/refresh",
    internalAuthGuard(async (request, reply) => {
      const params = engineeringEvidenceParamsSchema.parse(request.params);
      const data = await request.appContext.services.engineeringEvidenceService.refresh(params.projectId, { userId: request.authUser!.userId, orgId: request.authUser!.orgId }, { sourceTypes: ["github", "manual"] });
      reply.code(202);
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/branch-deploy-truth/manual",
    internalAuthGuard(async (request, reply) => {
      const params = engineeringEvidenceParamsSchema.parse(request.params);
      const body = bodyWithEntryType(request.body, "branch_deploy_truth");
      const data = await request.appContext.services.engineeringEvidenceService.createManualEntry(params.projectId, { userId: request.authUser!.userId, orgId: request.authUser!.orgId }, body);
      reply.code(201);
      return { data, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/todo-fixme",
    internalAuthGuard(async (request) => {
      const params = engineeringEvidenceParamsSchema.parse(request.params);
      const data = await request.appContext.services.engineeringEvidenceService.listTodoFixme(params.projectId, { userId: request.authUser!.userId, orgId: request.authUser!.orgId });
      return { data, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/todo-fixme/refresh",
    internalAuthGuard(async (request, reply) => {
      const params = engineeringEvidenceParamsSchema.parse(request.params);
      const data = await request.appContext.services.engineeringEvidenceService.refresh(params.projectId, { userId: request.authUser!.userId, orgId: request.authUser!.orgId }, { sourceTypes: ["github", "agent_run", "manual"] });
      reply.code(202);
      return { data, meta: null, error: null };
    })
  );
};
