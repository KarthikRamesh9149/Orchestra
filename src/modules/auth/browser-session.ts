import jwt from "jsonwebtoken";
import type { CookieSerializeOptions } from "@fastify/cookie";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../../app/errors.js";
import type { AppEnv } from "../../config/env.js";

export const ACCESS_COOKIE_NAME = "orchestra_access";
export const REFRESH_COOKIE_NAME = "orchestra_refresh";
export const CSRF_COOKIE_NAME = "orchestra_csrf";
export const BROWSER_SESSION_MODE = "browser";

export type SessionMode = "browser" | "bearer";

export function requestedSessionMode(body: unknown): SessionMode {
  if (body && typeof body === "object" && "sessionMode" in body && body.sessionMode === BROWSER_SESSION_MODE) {
    return "browser";
  }
  return "bearer";
}

export function hasBearerAuthorization(request: FastifyRequest) {
  return /^Bearer\s+\S+$/i.test(request.headers.authorization ?? "");
}

export function isCookieSessionRequest(request: FastifyRequest) {
  if (hasBearerAuthorization(request)) return false;
  return Boolean(request.cookies?.[ACCESS_COOKIE_NAME] || request.cookies?.[REFRESH_COOKIE_NAME]);
}

export function requiresBrowserRequestProtection(request: FastifyRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  return requestedSessionMode(request.body) === "browser" || isCookieSessionRequest(request);
}

export function assertTrustedBrowserOrigin(request: FastifyRequest) {
  const origin = request.headers.origin;
  const allowedOrigins = request.appContext.env.CORS_ALLOWED_ORIGINS
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return value;
      }
    });

  if (typeof origin !== "string" || !allowedOrigins.includes(origin)) {
    throw new AppError(403, "Browser request origin is not allowed", "browser_origin_forbidden");
  }
}

export function browserCookieOptions(env: AppEnv, path: string): CookieSerializeOptions {
  return {
    path,
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: env.AUTH_COOKIE_SAME_SITE,
    priority: "high"
  };
}

export function setBrowserSessionCookies(
  reply: FastifyReply,
  env: AppEnv,
  tokens: { accessToken: string; refreshToken: string }
) {
  reply.setCookie(ACCESS_COOKIE_NAME, tokens.accessToken, {
    ...browserCookieOptions(env, "/"),
    maxAge: remainingLifetimeSeconds(tokens.accessToken)
  });
  reply.setCookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
    ...browserCookieOptions(env, "/v1/auth"),
    maxAge: remainingLifetimeSeconds(tokens.refreshToken)
  });
}

export function clearBrowserSessionCookies(reply: FastifyReply, env: AppEnv) {
  reply.clearCookie(ACCESS_COOKIE_NAME, browserCookieOptions(env, "/"));
  reply.clearCookie(REFRESH_COOKIE_NAME, browserCookieOptions(env, "/v1/auth"));
  reply.clearCookie(CSRF_COOKIE_NAME, browserCookieOptions(env, "/"));
}

export function browserRefreshToken(request: FastifyRequest) {
  // Explicit bearer clients retain their API contract even if a browser happens
  // to attach a stale Orchestra cookie to the same request.
  if (hasBearerAuthorization(request)) return null;
  return request.cookies?.[REFRESH_COOKIE_NAME] ?? null;
}

function remainingLifetimeSeconds(token: string) {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  return Math.max(1, (decoded?.exp ?? Math.floor(Date.now() / 1000) + 1) - Math.floor(Date.now() / 1000));
}
