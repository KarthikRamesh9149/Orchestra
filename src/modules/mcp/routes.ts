import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard } from "../../app/auth.js";
import { toAppError } from "../../app/errors.js";
import {
  createMcpTokenSchema,
  mcpJsonRpcRequestSchema,
  revokeMcpTokenParamsSchema
} from "./schemas.js";

export const registerMcpRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/mcp/readiness",
    internalAuthGuard(async (request) => ({
      data: request.appContext.services.mcpService.getReadiness(),
      meta: null,
      error: null
    }))
  );

  app.get(
    "/mcp/tokens",
    internalAuthGuard(async (request) => {
      const result = await request.appContext.services.mcpService.listTokens({
        userId: request.authUser!.userId,
        orgId: request.authUser!.orgId
      });
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/mcp/tokens",
    internalAuthGuard(async (request, reply) => {
      const body = createMcpTokenSchema.parse(request.body);
      const result = await request.appContext.services.mcpService.createToken(
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId },
        body
      );
      reply.code(201);
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/mcp/tokens/:tokenId/revoke",
    internalAuthGuard(async (request) => {
      const params = revokeMcpTokenParamsSchema.parse(request.params);
      const result = await request.appContext.services.mcpService.revokeToken(
        { userId: request.authUser!.userId, orgId: request.authUser!.orgId },
        params.tokenId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get("/mcp", async (_request, reply) => {
    reply.header("Allow", "POST, DELETE");
    return reply.code(405).send(jsonRpcError(null, -32000, "This stateless Orchestra MCP endpoint accepts JSON-RPC over HTTP POST."));
  });

  app.delete("/mcp", async (_request, reply) => reply.code(204).send());

  app.post("/mcp", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const parsed = mcpJsonRpcRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(jsonRpcError(requestId(request.body), -32600, "Invalid JSON-RPC request"));
    }
    try {
      const response = await request.appContext.services.mcpService.handleJsonRpc(request.headers.authorization, parsed.data);
      if (parsed.data.id === undefined && parsed.data.method.startsWith("notifications/")) return reply.code(202).send();
      const protocolVersion = typeof response.result === "object" && response.result && "protocolVersion" in response.result
        ? String(response.result.protocolVersion)
        : request.headers["mcp-protocol-version"];
      if (protocolVersion) reply.header("MCP-Protocol-Version", protocolVersion);
      return reply.type("application/json; charset=utf-8").send(response);
    } catch (error) {
      const appError = toAppError(error);
      const rpcCode = appError.code === "mcp_method_not_supported" ? -32601 : appError.code === "validation_error" ? -32602 : -32000;
      return reply.code(appError.statusCode).type("application/json; charset=utf-8").send(jsonRpcError(parsed.data.id ?? null, rpcCode, appError.message, appError.code));
    }
  });
};

function requestId(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" || id === null ? id : null;
}

function jsonRpcError(id: string | number | null, code: number, message: string, appCode?: string) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(appCode ? { data: { code: appCode } } : {}) } };
}
