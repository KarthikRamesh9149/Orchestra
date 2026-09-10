import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const SPOOFABLE_FORWARDING_HEADERS = new Set([
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-orchestra-proxy-client",
  "x-orchestra-proxy-signature",
  "x-orchestra-proxy-timestamp",
]);

const REQUEST_TARGET_CONTROL_OR_BACKSLASH = /[\\\u0000-\u001f\u007f]/;
const ENCODED_PATH_SEPARATOR = /%(?:2f|5c)/i;

export function resolveApiProxyTarget(env = process.env) {
  const configured = (env.API_PROXY_TARGET ?? env.VITE_API_URL ?? "").trim();
  if (!configured) return null;

  const target = new URL(configured);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("API proxy target must use HTTP or HTTPS");
  }
  if (target.username || target.password || target.search || target.hash || !["", "/"].includes(target.pathname)) {
    throw new Error("API proxy target must be an origin without credentials, query, or path");
  }
  return target;
}

export function isApiProxyPath(requestUrl = "/") {
  const parsed = parseOriginFormRequestTarget(requestUrl);
  return Boolean(parsed && (parsed.pathname === "/v1" || parsed.pathname.startsWith("/v1/")));
}

export function parseOriginFormRequestTarget(requestUrl = "/") {
  if (
    typeof requestUrl !== "string" ||
    !requestUrl.startsWith("/") ||
    requestUrl.startsWith("//") ||
    requestUrl.includes("#") ||
    REQUEST_TARGET_CONTROL_OR_BACKSLASH.test(requestUrl)
  ) {
    return null;
  }

  const rawPath = requestUrl.split("?", 1)[0];
  if (ENCODED_PATH_SEPARATOR.test(rawPath)) return null;

  try {
    const parsed = new URL(requestUrl, "http://orchestra.invalid");
    return parsed.origin === "http://orchestra.invalid" ? parsed : null;
  } catch {
    return null;
  }
}

function forwardedHeaders(request, target, upstreamPath, env) {
  const headers = {};
  for (const [name, value] of Object.entries(request.headers)) {
    const normalizedName = name.toLowerCase();
    if (
      !HOP_BY_HOP_HEADERS.has(normalizedName) &&
      !SPOOFABLE_FORWARDING_HEADERS.has(normalizedName) &&
      normalizedName !== "host" &&
      value !== undefined
    ) {
      headers[name] = value;
    }
  }
  headers.host = target.host;
  headers["x-forwarded-host"] = request.headers.host ?? "";
  headers["x-forwarded-proto"] = "https";

  const sharedSecret = env.API_PROXY_SHARED_SECRET?.trim();
  if (sharedSecret) {
    const client = resolveForwardedClientAddress(request);
    const timestamp = Date.now().toString();
    const signature = createHmac("sha256", sharedSecret)
      .update(`${client}\n${timestamp}\n${request.method ?? "GET"}\n${upstreamPath}`)
      .digest("hex");
    headers["x-orchestra-proxy-client"] = client;
    headers["x-orchestra-proxy-timestamp"] = timestamp;
    headers["x-orchestra-proxy-signature"] = signature;
  }
  return headers;
}

function resolveForwardedClientAddress(request) {
  const forwarded = request.headers["x-forwarded-for"];
  const candidates = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded ?? "")
    .split(",")
    .map((value) => value.trim().replace(/^\[|\]$/g, ""))
    .filter(Boolean);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (isIP(candidates[index])) return candidates[index];
  }
  const remoteAddress = request.socket?.remoteAddress?.replace(/^::ffff:/, "") ?? "unknown";
  return isIP(remoteAddress) ? remoteAddress : "unknown";
}

function responseHeaders(headers) {
  const forwarded = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && value !== undefined) forwarded[name] = value;
  }
  return forwarded;
}

export function proxyApiRequest(request, response, target, env = process.env) {
  if (!target) {
    response.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      data: null,
      meta: null,
      error: { code: "api_proxy_unconfigured", message: "The Orchestra API proxy is not configured." }
    }));
    return;
  }

  const requestTarget = parseOriginFormRequestTarget(request.url ?? "/");
  if (!requestTarget || (requestTarget.pathname !== "/v1" && !requestTarget.pathname.startsWith("/v1/"))) {
    response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      data: null,
      meta: null,
      error: { code: "invalid_request_target", message: "The request target is invalid." }
    }));
    return;
  }

  const upstreamUrl = new URL(target.origin);
  upstreamUrl.pathname = requestTarget.pathname;
  upstreamUrl.search = requestTarget.search;
  if (upstreamUrl.origin !== target.origin) {
    response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      data: null,
      meta: null,
      error: { code: "invalid_request_target", message: "The request target is invalid." }
    }));
    return;
  }
  const upstreamPath = `${upstreamUrl.pathname}${upstreamUrl.search}`;
  const send = upstreamUrl.protocol === "https:" ? httpsRequest : httpRequest;
  let upstreamBody;
  const upstreamRequest = send(upstreamUrl, {
    method: request.method,
    headers: forwardedHeaders(request, upstreamUrl, upstreamPath, env),
  }, (upstreamResponse) => {
    upstreamBody = upstreamResponse;
    if (response.destroyed) { upstreamResponse.destroy(); return; }
    response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders(upstreamResponse.headers));
    upstreamResponse.pipe(response);
  });

  upstreamRequest.on("error", () => {
    if (response.destroyed) return;
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      data: null,
      meta: null,
      error: { code: "api_proxy_unavailable", message: "The Orchestra API is temporarily unavailable." }
    }));
  });
  const cancel = () => { upstreamBody?.destroy(); upstreamRequest.destroy(); };
  request.once("aborted", cancel);
  response.once("close", () => { if (!response.writableFinished) cancel(); });
  upstreamRequest.setTimeout(120_000, () => upstreamRequest.destroy(new Error("Upstream inactivity timeout")));
  request.pipe(upstreamRequest);
}
