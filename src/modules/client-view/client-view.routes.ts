/**
 * Feature 6 — Client Portal routes.
 *
 * Manager share-management (requires internalAuthGuard + requireManager):
 *   GET    /v1/projects/:projectId/client-shares
 *   POST   /v1/projects/:projectId/client-shares
 *   GET    /v1/projects/:projectId/client-shares/:shareId
 *   PATCH  /v1/projects/:projectId/client-shares/:shareId
 *   POST   /v1/projects/:projectId/client-shares/:shareId/rotate-token
 *   POST   /v1/projects/:projectId/client-shares/:shareId/revoke
 *
 * Public tokenized client portal (no auth):
 *   GET    /v1/client/:token/bootstrap
 *   GET    /v1/client/:token/project-summary
 *   GET    /v1/client/:token/brain
 *   GET    /v1/client/:token/brain/graph
 *   GET    /v1/client/:token/documents
 *   GET    /v1/client/:token/documents/:documentId/view
 *   GET    /v1/client/:token/documents/:documentId/anchors/:anchorId
 *   GET    /v1/client/:token/documents/:documentId/search
 *   GET    /v1/client/:token/documents/:documentId/anchors/:anchorId/provenance
 */

import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard as authGuard, requireManager } from "../../app/auth.js";
import { toAppError } from "../../app/errors.js";
import { rateLimitRouteOptions } from "../../app/security.js";
import {
  clientAnchorParamsSchema,
  clientDocumentParamsSchema,
  clientDocumentSearchQuerySchema,
  clientTokenParamsSchema,
  createClientShareBodySchema,
  managerShareIdParamsSchema,
  managerShareParamsSchema,
  updateClientShareBodySchema
} from "./client-view.schemas.js";

export const registerClientViewRoutes: FastifyPluginAsync = async (app) => {
  const { clientSharesService, clientViewService } = app.appContext.services;
  const clientPortalRateLimit = rateLimitRouteOptions(app.appContext.env, "clientPortal");

  // ─── Manager: list shares ──────────────────────────────────────────────────
  app.get(
    "/projects/:projectId/client-shares",
    authGuard(async (request) => {
      const { projectId } = managerShareParamsSchema.parse(request.params);
      requireManager(request);
      const shares = await clientSharesService.listShares(projectId, request.authUser!.userId);
      return { data: shares, meta: null, error: null };
    })
  );

  // ─── Manager: create share ─────────────────────────────────────────────────
  app.post(
    "/projects/:projectId/client-shares",
    authGuard(async (request) => {
      const { projectId } = managerShareParamsSchema.parse(request.params);
      requireManager(request);
      const body = createClientShareBodySchema.parse(request.body);
      const result = await clientSharesService.createShare(
        projectId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  // ─── Manager: get single share ─────────────────────────────────────────────
  app.get(
    "/projects/:projectId/client-shares/:shareId",
    authGuard(async (request) => {
      const { projectId, shareId } = managerShareIdParamsSchema.parse(request.params);
      requireManager(request);
      const share = await clientSharesService.getShare(projectId, shareId, request.authUser!.userId);
      return { data: share, meta: null, error: null };
    })
  );

  // ─── Manager: update share ─────────────────────────────────────────────────
  app.patch(
    "/projects/:projectId/client-shares/:shareId",
    authGuard(async (request) => {
      const { projectId, shareId } = managerShareIdParamsSchema.parse(request.params);
      requireManager(request);
      const body = updateClientShareBodySchema.parse(request.body);
      const share = await clientSharesService.updateShare(
        projectId,
        shareId,
        request.authUser!.userId,
        body
      );
      return { data: share, meta: null, error: null };
    })
  );

  // ─── Manager: rotate token ─────────────────────────────────────────────────
  app.post(
    "/projects/:projectId/client-shares/:shareId/rotate-token",
    authGuard(async (request) => {
      const { projectId, shareId } = managerShareIdParamsSchema.parse(request.params);
      requireManager(request);
      const result = await clientSharesService.rotateToken(
        projectId,
        shareId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  // ─── Manager: revoke share ─────────────────────────────────────────────────
  app.post(
    "/projects/:projectId/client-shares/:shareId/revoke",
    authGuard(async (request) => {
      const { projectId, shareId } = managerShareIdParamsSchema.parse(request.params);
      requireManager(request);
      const share = await clientSharesService.revokeShare(
        projectId,
        shareId,
        request.authUser!.userId
      );
      return { data: share, meta: null, error: null };
    })
  );

  // ─── Public: bootstrap ─────────────────────────────────────────────────────
  app.get("/client/:token/bootstrap", clientPortalRateLimit, async (request, reply) => {
    const { token } = clientTokenParamsSchema.parse(request.params);
    try {
      const data = await clientViewService.getBootstrap(token);
      return reply.send({ data, meta: null, error: null });
    } catch (error) {
      const appError = toAppError(error);
      return reply.code(appError.statusCode).send({
        data: null, meta: null,
        error: { code: appError.code, message: appError.message, details: appError.details ?? null }
      });
    }
  });

  // ─── Public: project summary ───────────────────────────────────────────────
  app.get("/client/:token/project-summary", clientPortalRateLimit, async (request, reply) => {
    const { token } = clientTokenParamsSchema.parse(request.params);
    try {
      const data = await clientViewService.getProjectSummary(token);
      return reply.send({ data, meta: null, error: null });
    } catch (error) {
      const appError = toAppError(error);
      return reply.code(appError.statusCode).send({
        data: null, meta: null,
        error: { code: appError.code, message: appError.message, details: appError.details ?? null }
      });
    }
  });

  // ─── Public: brain ─────────────────────────────────────────────────────────
  app.get("/client/:token/brain", clientPortalRateLimit, async (request, reply) => {
    const { token } = clientTokenParamsSchema.parse(request.params);
    try {
      const data = await clientViewService.getBrain(token);
      return reply.send({ data, meta: null, error: null });
    } catch (error) {
      const appError = toAppError(error);
      return reply.code(appError.statusCode).send({
        data: null, meta: null,
        error: { code: appError.code, message: appError.message, details: appError.details ?? null }
      });
    }
  });

  // ─── Public: brain graph ───────────────────────────────────────────────────
  app.get("/client/:token/brain/graph", clientPortalRateLimit, async (request, reply) => {
    const { token } = clientTokenParamsSchema.parse(request.params);
    try {
      const data = await clientViewService.getGraph(token);
      return reply.send({ data, meta: null, error: null });
    } catch (error) {
      const appError = toAppError(error);
      return reply.code(appError.statusCode).send({
        data: null, meta: null,
        error: { code: appError.code, message: appError.message, details: appError.details ?? null }
      });
    }
  });

  // ─── Public: list shared documents ────────────────────────────────────────
  app.get("/client/:token/documents", clientPortalRateLimit, async (request, reply) => {
    const { token } = clientTokenParamsSchema.parse(request.params);
    try {
      const data = await clientViewService.listDocuments(token);
      return reply.send({ data, meta: null, error: null });
    } catch (error) {
      const appError = toAppError(error);
      return reply.code(appError.statusCode).send({
        data: null, meta: null,
        error: { code: appError.code, message: appError.message, details: appError.details ?? null }
      });
    }
  });

  // ─── Public: document viewer ───────────────────────────────────────────────
  app.get("/client/:token/documents/:documentId/view", clientPortalRateLimit, async (request, reply) => {
    const { token, documentId } = clientDocumentParamsSchema.parse(request.params);
    try {
      const data = await clientViewService.getDocumentView(token, documentId);
      return reply.send({ data, meta: null, error: null });
    } catch (error) {
      const appError = toAppError(error);
      return reply.code(appError.statusCode).send({
        data: null, meta: null,
        error: { code: appError.code, message: appError.message, details: appError.details ?? null }
      });
    }
  });

  // ─── Public: document anchor ───────────────────────────────────────────────
  app.get("/client/:token/documents/:documentId/anchors/:anchorId", clientPortalRateLimit, async (request, reply) => {
    const { token, documentId, anchorId } = clientAnchorParamsSchema.parse(request.params);
    try {
      const data = await clientViewService.getAnchor(token, documentId, anchorId);
      return reply.send({ data, meta: null, error: null });
    } catch (error) {
      const appError = toAppError(error);
      return reply.code(appError.statusCode).send({
        data: null, meta: null,
        error: { code: appError.code, message: appError.message, details: appError.details ?? null }
      });
    }
  });

  // ─── Public: document search ───────────────────────────────────────────────
  app.get("/client/:token/documents/:documentId/search", clientPortalRateLimit, async (request, reply) => {
    const { token, documentId } = clientDocumentParamsSchema.parse(request.params);
    const { q, limit } = clientDocumentSearchQuerySchema.parse(request.query);
    try {
      const data = await clientViewService.searchDocument(token, documentId, q, limit);
      return reply.send({ data, meta: null, error: null });
    } catch (error) {
      const appError = toAppError(error);
      return reply.code(appError.statusCode).send({
        data: null, meta: null,
        error: { code: appError.code, message: appError.message, details: appError.details ?? null }
      });
    }
  });

  // ─── Public: anchor provenance ─────────────────────────────────────────────
  app.get(
    "/client/:token/documents/:documentId/anchors/:anchorId/provenance",
    clientPortalRateLimit,
    async (request, reply) => {
      const { token, documentId, anchorId } = clientAnchorParamsSchema.parse(request.params);
      try {
        const data = await clientViewService.getProvenance(token, documentId, anchorId);
        return reply.send({ data, meta: null, error: null });
      } catch (error) {
        const appError = toAppError(error);
        return reply.code(appError.statusCode).send({
          data: null, meta: null,
          error: { code: appError.code, message: appError.message, details: appError.details ?? null }
        });
      }
    }
  );
};
