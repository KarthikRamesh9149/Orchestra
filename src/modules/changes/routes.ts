import type { FastifyPluginAsync } from "fastify";
import {
  internalAuthGuard as authGuard,
  requireManager,
  requireProjectRole,
  requireTruthApprover
} from "../../app/auth.js";
import { createProposalSchema, proposalParamsSchema } from "./schemas.js";

export const registerChangeProposalRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/projects/:projectId/change-proposals",
    authGuard(async (request) => {
      requireProjectRole(request, ["manager", "dev"]);
      const { projectId } = proposalParamsSchema.omit({ proposalId: true }).parse(request.params);
      const proposals = await request.appContext.services.changeProposalService.list(
        projectId,
        request.authUser!.userId
      );
      return { data: proposals, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/change-proposals",
    authGuard(async (request) => {
      requireManager(request);
      const { projectId } = proposalParamsSchema.omit({ proposalId: true }).parse(request.params);
      const body = createProposalSchema.parse(request.body);
      const proposal = await request.appContext.services.changeProposalService.create(
        projectId,
        request.authUser!.userId,
        body
      );
      return { data: proposal, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/change-proposals/:proposalId",
    authGuard(async (request) => {
      requireProjectRole(request, ["manager", "dev"]);
      const params = proposalParamsSchema.parse(request.params);
      const proposal = await request.appContext.services.changeProposalService.get(
        params.projectId,
        params.proposalId,
        request.authUser!.userId
      );
      return { data: proposal, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/change-proposals/:proposalId/accept",
    authGuard(async (request) => {
      const params = proposalParamsSchema.parse(request.params);
      requireTruthApprover(request);
      await request.appContext.services.projectService.ensureProjectTruthApprover(params.projectId, request.authUser!.userId);
      const proposal = await request.appContext.services.changeProposalService.accept(
        params.projectId,
        params.proposalId,
        request.authUser!.userId
      );
      return { data: proposal, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/change-proposals/:proposalId/reject",
    authGuard(async (request) => {
      const params = proposalParamsSchema.parse(request.params);
      requireTruthApprover(request);
      await request.appContext.services.projectService.ensureProjectTruthApprover(params.projectId, request.authUser!.userId);
      const proposal = await request.appContext.services.changeProposalService.reject(
        params.projectId,
        params.proposalId,
        request.authUser!.userId
      );
      return { data: proposal, meta: null, error: null };
    })
  );
};
