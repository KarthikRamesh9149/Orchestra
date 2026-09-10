import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../types/index.js";
import { toAppError } from "./errors.js";

export function registerStructuredErrorHandler<TApp extends { setErrorHandler: (...args: any[]) => unknown }>(
  app: TApp,
  context: AppContext
) {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const appError = toAppError(error);
    context.logger.error(
      {
        method: request.method,
        url: redactSensitiveUrlForLogging(request.url),
        requestId: request.requestId,
        errorCode: appError.code,
        errorType: error instanceof Error ? error.name : "non_error"
      },
      "request_failed"
    );
    void reply.code(appError.statusCode).send({
      data: null,
      meta: { requestId: request.requestId },
      error: {
        code: appError.code,
        message: appError.message,
        details: appError.details ?? null
      }
    });
  });
}

export function redactSensitiveUrlForLogging(url: string) {
  const pathRedacted = url.replace(/(\/v1\/client\/)[^/?#]+/g, "$1[redacted]");
  const questionIndex = pathRedacted.indexOf("?");
  if (questionIndex === -1) return pathRedacted;
  const path = pathRedacted.slice(0, questionIndex);
  const queryAndHash = pathRedacted.slice(questionIndex + 1);
  const hashIndex = queryAndHash.indexOf("#");
  const query = hashIndex === -1 ? queryAndHash : queryAndHash.slice(0, hashIndex);
  const redactedQuery = query
    .split("&")
    .map((part) => {
      const [rawKey] = part.split("=", 1);
      let key = rawKey ?? "";
      try {
        key = decodeURIComponent(key);
      } catch {
        return "[malformed-query-key]=[redacted]";
      }
      key = key.toLowerCase();
      return `${rawKey}=[redacted]`;
    })
    .join("&");
  return `${path}?${redactedQuery}`;
}
