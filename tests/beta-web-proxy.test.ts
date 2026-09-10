import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  isApiProxyPath,
  parseOriginFormRequestTarget,
  proxyApiRequest,
  resolveApiProxyTarget
} from "../apps/beta-web/proxy.mjs";
import { createBetaWebServer } from "../apps/beta-web/server.mjs";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  })));
});

async function listen(server: ReturnType<typeof createServer>) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP test server");
  return `http://127.0.0.1:${address.port}`;
}

describe("beta-web first-party API proxy", () => {
  it("accepts only a fixed HTTP(S) origin as its upstream", () => {
    expect(resolveApiProxyTarget({ VITE_API_URL: "https://api.example.com" } as NodeJS.ProcessEnv)?.origin)
      .toBe("https://api.example.com");
    expect(resolveApiProxyTarget({} as NodeJS.ProcessEnv)).toBeNull();
    expect(() => resolveApiProxyTarget({ API_PROXY_TARGET: "file:///tmp/api" } as NodeJS.ProcessEnv)).toThrow(/HTTP or HTTPS/);
    expect(() => resolveApiProxyTarget({ API_PROXY_TARGET: "https://api.example.com/unsafe" } as NodeJS.ProcessEnv)).toThrow(/must be an origin/);
  });

  it("proxies only versioned API paths", () => {
    expect(isApiProxyPath("/v1/auth/csrf")).toBe(true);
    expect(isApiProxyPath("/v1/projects?id=1")).toBe(true);
    expect(isApiProxyPath("/login")).toBe(false);
    expect(isApiProxyPath("/assets/v1/icon.svg")).toBe(false);
    expect(isApiProxyPath("//attacker.example/v1/auth/csrf")).toBe(false);
    expect(isApiProxyPath("https://attacker.example/v1/auth/csrf")).toBe(false);
    expect(isApiProxyPath("/\\attacker.example/v1/auth/csrf")).toBe(false);
    expect(isApiProxyPath("/%2fattacker.example/v1/auth/csrf")).toBe(false);
    expect(parseOriginFormRequestTarget("/v1/projects?query=a%2Fb")?.pathname).toBe("/v1/projects");
  });

  it("streams the CSRF response and cookie through the first-party web origin", async () => {
    const upstreamOrigin = await listen(createServer((request, response) => {
      expect(request.url).toBe("/v1/auth/csrf");
      expect(request.headers.origin).toBe("https://beta.orchestraos.dev");
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Cookie": "orchestra_csrf=signed; Path=/; HttpOnly; Secure; SameSite=None"
      });
      response.end(JSON.stringify({ data: { csrfToken: "token" }, meta: null, error: null }));
    }));
    const target = resolveApiProxyTarget({ API_PROXY_TARGET: upstreamOrigin } as NodeJS.ProcessEnv);
    const webOrigin = await listen(createServer((request, response) => proxyApiRequest(request, response, target)));

    const result = await fetch(`${webOrigin}/v1/auth/csrf`, {
      headers: { Origin: "https://beta.orchestraos.dev" }
    });

    expect(result.status).toBe(200);
    expect(result.headers.get("set-cookie")).toContain("orchestra_csrf=signed");
    await expect(result.json()).resolves.toMatchObject({ data: { csrfToken: "token" } });
  });

  it("closes the upstream SSE socket when the browser cancels", async () => {
    let disconnected = false;
    const origin = await listen(createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write("data: connected\n\n");
      response.on("close", () => { disconnected = true; });
    }));
    const target = resolveApiProxyTarget({ API_PROXY_TARGET: origin } as NodeJS.ProcessEnv);
    const web = await listen(createServer((request, response) => proxyApiRequest(request, response, target)));
    const controller = new AbortController();
    const response = await fetch(`${web}/v1/stream`, { signal: controller.signal });
    await response.body!.getReader().read();
    controller.abort();
    for (let attempt = 0; attempt < 30 && !disconnected; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(disconnected).toBe(true);
  });

  it("keeps the configured upstream origin fixed and rejects authority-bearing targets", async () => {
    let upstreamCalls = 0;
    const upstreamOrigin = await listen(createServer((_request, response) => {
      upstreamCalls += 1;
      response.end("unexpected");
    }));
    const target = resolveApiProxyTarget({ API_PROXY_TARGET: upstreamOrigin } as NodeJS.ProcessEnv);
    const webOrigin = await listen(createServer((request, response) => proxyApiRequest(request, response, target)));

    const result = await fetch(`${webOrigin}//attacker.example/v1/auth/csrf`, { redirect: "manual" });

    expect(result.status).toBe(400);
    expect(upstreamCalls).toBe(0);
  });

  it("overwrites spoofable forwarding headers and signs a bounded client identity", async () => {
    const secret = "test_proxy_shared_secret_32_characters_minimum";
    const upstreamOrigin = await listen(createServer((request, response) => {
      const client = request.headers["x-orchestra-proxy-client"] as string;
      const timestamp = request.headers["x-orchestra-proxy-timestamp"] as string;
      const signature = request.headers["x-orchestra-proxy-signature"] as string;
      expect(client).toBe("203.0.113.9");
      expect(signature).toBe(
        createHmac("sha256", secret)
          .update(`${client}\n${timestamp}\nGET\n/v1/auth/csrf`)
          .digest("hex")
      );
      response.end("ok");
    }));
    const target = resolveApiProxyTarget({ API_PROXY_TARGET: upstreamOrigin } as NodeJS.ProcessEnv);
    const webOrigin = await listen(createServer((request, response) => proxyApiRequest(request, response, target, {
      API_PROXY_SHARED_SECRET: secret
    })));

    const result = await fetch(`${webOrigin}/v1/auth/csrf`, {
      headers: {
        "x-forwarded-for": "198.51.100.5, 203.0.113.9",
        "x-orchestra-proxy-client": "spoofed",
        "x-orchestra-proxy-signature": "spoofed"
      }
    });

    expect(result.status).toBe(200);
  });

  it("returns 400 instead of terminating on malformed percent encoding", async () => {
    const webOrigin = await listen(createBetaWebServer({ apiTarget: null }));
    const result = await fetch(`${webOrigin}/%`);
    expect(result.status).toBe(400);
  });
});
