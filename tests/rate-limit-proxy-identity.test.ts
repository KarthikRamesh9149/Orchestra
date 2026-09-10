import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { rateLimitKeyGenerator } from "../src/app/security.js";

function requestWith(headers: Record<string, string>) {
  return {
    authUser: undefined,
    headers,
    ip: "127.0.0.1",
    method: "POST",
    url: "/v1/auth/login",
    raw: { url: "/v1/auth/login" }
  } as never;
}

describe("trusted beta-web rate-limit identity", () => {
  it("uses a valid signed proxy client identity", () => {
    const secret = "test_proxy_shared_secret_32_characters_minimum";
    const client = "203.0.113.9";
    const timestamp = Date.now().toString();
    const signature = createHmac("sha256", secret)
      .update(`${client}\n${timestamp}\nPOST\n/v1/auth/login`)
      .digest("hex");
    expect(rateLimitKeyGenerator(requestWith({
      "x-orchestra-proxy-client": client,
      "x-orchestra-proxy-timestamp": timestamp,
      "x-orchestra-proxy-signature": signature
    }), { API_PROXY_SHARED_SECRET: secret })).toBe(`proxy:${client}`);
  });

  it("ignores forged and stale proxy identities", () => {
    const secret = "test_proxy_shared_secret_32_characters_minimum";
    expect(rateLimitKeyGenerator(requestWith({
      "x-orchestra-proxy-client": "203.0.113.9",
      "x-orchestra-proxy-timestamp": Date.now().toString(),
      "x-orchestra-proxy-signature": "0".repeat(64)
    }), { API_PROXY_SHARED_SECRET: secret })).toBe("ip:127.0.0.1");
  });
});
