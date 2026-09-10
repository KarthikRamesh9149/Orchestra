import type { IncomingMessage, ServerResponse } from "node:http";

export function resolveApiProxyTarget(env?: NodeJS.ProcessEnv): URL | null;
export function isApiProxyPath(requestUrl?: string): boolean;
export function parseOriginFormRequestTarget(requestUrl?: string): URL | null;
export function proxyApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  target: URL | null,
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
): void;
