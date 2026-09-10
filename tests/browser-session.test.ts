import { describe, expect, it } from "vitest";
import { browserCookieOptions } from "../src/modules/auth/browser-session.js";

describe("browser session cookie policy", () => {
  it("uses HttpOnly Secure SameSite=None cookies for the hosted cross-site frontend/API topology", () => {
    expect(browserCookieOptions({ AUTH_COOKIE_SECURE: true, AUTH_COOKIE_SAME_SITE: "none" } as any, "/")).toMatchObject({
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "none",
      priority: "high"
    });
  });

  it("supports an explicit non-secure lax policy only for local development", () => {
    expect(browserCookieOptions({ AUTH_COOKIE_SECURE: false, AUTH_COOKIE_SAME_SITE: "lax" } as any, "/v1/auth")).toMatchObject({
      path: "/v1/auth",
      httpOnly: true,
      secure: false,
      sameSite: "lax"
    });
  });
});
