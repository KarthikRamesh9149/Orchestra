import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard as authGuard } from "../../app/auth.js";
import { rateLimitRouteOptions } from "../../app/security.js";
import {
  vscodeAskBodySchema,
  vscodeCreatePairingBodySchema,
  vscodeExchangeBodySchema,
  vscodeProjectParamsSchema
} from "./schemas.js";

export const registerEditorConnectorRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/projects/:projectId/editor-connectors/vscode/pairings",
    rateLimitRouteOptions(app.appContext.env, "auth"),
    authGuard(async (request) => {
      const params = vscodeProjectParamsSchema.parse(request.params);
      const body = vscodeCreatePairingBodySchema.parse(request.body ?? {});
      const result = await request.appContext.services.editorConnectorService.createVsCodePairing(
        params.projectId,
        request.authUser!.userId,
        body.label
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/editor-connectors/vscode/status",
    authGuard(async (request) => {
      const params = vscodeProjectParamsSchema.parse(request.params);
      const result = await request.appContext.services.editorConnectorService.getVsCodeStatus(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/editor-connectors/vscode/revoke",
    rateLimitRouteOptions(app.appContext.env, "auth"),
    authGuard(async (request) => {
      const params = vscodeProjectParamsSchema.parse(request.params);
      const result = await request.appContext.services.editorConnectorService.revokeVsCodeConnector(
        params.projectId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/editor-connectors/vscode/exchange",
    rateLimitRouteOptions(app.appContext.env, "auth"),
    async (request) => {
      const body = vscodeExchangeBodySchema.parse(request.body);
      const result = await request.appContext.services.editorConnectorService.exchangeVsCodePairing(body);
      return { data: result, meta: null, error: null };
    }
  );

  app.post(
    "/editor-connectors/vscode/socrates/ask",
    rateLimitRouteOptions(app.appContext.env, "socratesStream"),
    async (request) => {
      const body = vscodeAskBodySchema.parse(request.body);
      const result = await request.appContext.services.editorConnectorService.askSocratesWithVsCodeToken(
        request.headers.authorization,
        body.question,
        body.selectedText,
        body.ideContext
      );
      return { data: result, meta: null, error: null };
    }
  );

  app.post(
    "/editor-connectors/vscode/revoke",
    rateLimitRouteOptions(app.appContext.env, "auth"),
    async (request) => {
      const result = await request.appContext.services.editorConnectorService.revokeVsCodeConnectorToken(
        request.headers.authorization
      );
      return { data: result, meta: null, error: null };
    }
  );
};
