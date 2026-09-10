import type { FastifyRequest, RouteShorthandOptions } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppEnv } from "../config/env.js";

export type RateLimitProfile = "auth" | "clientPortal" | "webhook" | "upload" | "socratesStream";

type RateLimitProfileConfig = {
  max: number;
  timeWindow: number;
  groupId: string;
};

export function rateLimitKeyGenerator(request: FastifyRequest, env?: Pick<AppEnv, "API_PROXY_SHARED_SECRET">) {
  if (request.authUser?.userId) return `user:${request.authUser.userId}`;
  const proxyClient = trustedProxyClient(request, env?.API_PROXY_SHARED_SECRET);
  return proxyClient ? `proxy:${proxyClient}` : `ip:${request.ip}`;
}

function trustedProxyClient(request: FastifyRequest, sharedSecret?: string) {
  if (!sharedSecret) return null;
  const client = singleHeader(request.headers["x-orchestra-proxy-client"]);
  const timestamp = singleHeader(request.headers["x-orchestra-proxy-timestamp"]);
  const signature = singleHeader(request.headers["x-orchestra-proxy-signature"]);
  if (!client || !timestamp || !signature || !/^\d{13}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) {
    return null;
  }
  const ageMs = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(ageMs) || ageMs > 30_000) return null;
  const requestTarget = request.raw.url ?? request.url;
  const expected = createHmac("sha256", sharedSecret)
    .update(`${client}\n${timestamp}\n${request.method}\n${requestTarget}`)
    .digest("hex");
  const actualBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  return client;
}

function singleHeader(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}

export function rateLimitErrorResponse(
  _request: FastifyRequest,
  context: { after: string; max: number; statusCode: number }
) {
  const error = new Error("Too many requests. Please retry after the rate-limit window resets.") as Error & {
    statusCode: number;
    code: string;
    details: unknown;
  };
  error.statusCode = context.statusCode;
  error.code = "rate_limited";
  error.details = {
    retryAfter: context.after,
    limit: context.max
  };
  return error;
}

export function rateLimitRouteOptions(env: AppEnv, profile: RateLimitProfile): RouteShorthandOptions {
  if (!env.RATE_LIMIT_ENABLED) {
    return {};
  }

  return {
    config: {
      rateLimit: getRateLimitProfile(env, profile)
    }
  };
}

export function withRateLimit(
  options: RouteShorthandOptions,
  env: AppEnv,
  profile: RateLimitProfile
): RouteShorthandOptions {
  const rateLimitOptions = rateLimitRouteOptions(env, profile);
  return {
    ...options,
    config: {
      ...(options.config ?? {}),
      ...(rateLimitOptions.config ?? {})
    }
  };
}

function getRateLimitProfile(env: AppEnv, profile: RateLimitProfile): RateLimitProfileConfig {
  switch (profile) {
    case "auth":
      return {
        max: env.AUTH_RATE_LIMIT_MAX,
        timeWindow: env.AUTH_RATE_LIMIT_WINDOW_MS,
        groupId: "auth"
      };
    case "clientPortal":
      return {
        max: env.CLIENT_RATE_LIMIT_MAX,
        timeWindow: env.CLIENT_RATE_LIMIT_WINDOW_MS,
        groupId: "client_portal"
      };
    case "webhook":
      return {
        max: env.WEBHOOK_RATE_LIMIT_MAX,
        timeWindow: env.WEBHOOK_RATE_LIMIT_WINDOW_MS,
        groupId: "webhook"
      };
    case "upload":
      return {
        max: env.UPLOAD_RATE_LIMIT_MAX,
        timeWindow: env.UPLOAD_RATE_LIMIT_WINDOW_MS,
        groupId: "upload"
      };
    case "socratesStream":
      return {
        max: env.SOCRATES_STREAM_RATE_LIMIT_MAX,
        timeWindow: env.SOCRATES_STREAM_RATE_LIMIT_WINDOW_MS,
        groupId: "socrates_stream"
      };
  }
}
