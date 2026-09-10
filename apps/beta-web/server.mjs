import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isApiProxyPath, parseOriginFormRequestTarget, proxyApiRequest, resolveApiProxyTarget } from "./proxy.mjs";

const rootDir = fileURLToPath(new URL("./dist", import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "0.0.0.0";
const apiTarget = resolveApiProxyTarget();

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
]);

export function resolveAsset(url) {
  const parsed = parseOriginFormRequestTarget(url);
  if (!parsed) throw new URIError("Invalid request target");
  const pathname = decodeURIComponent(parsed.pathname);
  const normalized = normalize(pathname).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
  const candidate = join(rootDir, normalized);

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }

  return join(rootDir, "index.html");
}

export function createBetaWebServer(options = {}) {
  const target = Object.prototype.hasOwnProperty.call(options, "apiTarget") ? options.apiTarget : apiTarget;
  const env = options.env ?? process.env;
  const server = createServer((request, response) => {
    try {
      if (isApiProxyPath(request.url)) {
        proxyApiRequest(request, response, target, env);
        return;
      }

      const assetPath = resolveAsset(request.url ?? "/");
      const contentType = contentTypes.get(extname(assetPath)) ?? "application/octet-stream";

      response.writeHead(200, {
        "Cache-Control": assetPath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
        "Content-Type": contentType,
      });

      const stream = createReadStream(assetPath);
      stream.on("error", () => {
        if (response.headersSent) response.destroy();
        else {
          response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Unable to serve the requested asset.");
        }
      });
      stream.pipe(response);
    } catch (error) {
      const status = error instanceof URIError ? 400 : 500;
      if (!response.headersSent) {
        response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        response.end(status === 400 ? "Invalid request target." : "Unable to serve the request.");
      } else {
        response.destroy();
      }
    }
  });
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  return server;
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  createBetaWebServer().listen(port, host, () => {
    console.log(`Beta web serving ${rootDir} on ${host}:${port}`);
  });
}
