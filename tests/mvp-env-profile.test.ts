import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

function parseEnvText(text: string) {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    values.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
  return values;
}

describe("MVP environment profile examples", () => {
  it(".env.example points MVP deployments to .env.mvp.example", () => {
    const defaultEnv = readRepoFile(".env.example");
    const values = parseEnvText(defaultEnv);

    expect(defaultEnv).toContain("Default local/full-backend example");
    expect(defaultEnv).toContain("For MVP production deployment, use `.env.mvp.example`");
    expect(defaultEnv).toContain("For MVP staging HTTP proof, use `.env.mvp.staging.example`");
    expect(defaultEnv).toContain("MVP deployment profile: see `.env.mvp.example`");
    expect(values.get("DEPLOYMENT_ENV")).toBe("development");
  });

  it(".env.mvp.example contains the simplified MVP deployment profile", () => {
    const mvpEnv = readRepoFile(".env.mvp.example");
    const values = parseEnvText(mvpEnv);

    expect(mvpEnv).toContain("MVP production deployment environment template");
    expect(mvpEnv).toContain("For staging HTTP proof, use `.env.mvp.staging.example`");
    expect(mvpEnv).toContain("Do not commit `.env`");
    expect(mvpEnv).toContain("Dry-run/mock smoke is diagnostic only");

    expect(values.get("NODE_ENV")).toBe("production");
    expect(values.get("DEPLOYMENT_ENV")).toBe("production");
    expect(values.get("MVP_MODE")).toBe("true");
    expect(values.get("MVP_EQUAL_PROJECT_ACCESS")).toBe("true");
    expect(values.get("MVP_ENABLED_COMMUNICATION_PROVIDERS")).toBe("manual_import,fireflies_ai,slack,clickup,granola,microsoft_teams,notion");
    expect(values.get("MVP_ENABLE_ADVANCED_CONNECTORS")).toBe("false");
    expect(values.get("MVP_ENABLE_CLIENT_PORTAL")).toBe("false");
    expect(values.get("MVP_ENABLE_AUDIO_TRANSCRIPTION")).toBe("false");
    expect(values.get("MVP_ENABLE_PROJECT_FINANCE")).toBe("false");
    expect(values.get("MVP_ENABLE_PROJECT_SUBSCRIPTIONS")).toBe("false");
    expect(values.get("MVP_ENABLE_CALENDAR_SYNC")).toBe("false");
    expect(values.get("MVP_ENABLE_CALENDLY")).toBe("false");
    expect(values.get("MVP_SIMPLE_CHANGE_APPLY")).toBe("true");
    expect(values.get("MVP_REQUIRE_MANAGER_APPROVAL")).toBe("false");
    expect(values.get("MVP_SHOW_VERSION_HISTORY")).toBe("false");
    expect(values.get("MVP_ENABLE_IMAGE_CONTEXT")).toBe("true");
    expect(values.get("MVP_ENABLE_IMAGE_VISION_SUMMARY")).toBe("false");
    expect(values.get("FIREFLIES_READINESS_MODE")).toBe("manual_only");
    expect(values.get("SIGNUP_MODE")).toBe("invite_only");
    expect(values.get("SECURITY_HEADERS_ENABLED")).toBe("true");
    expect(values.get("RATE_LIMIT_ENABLED")).toBe("true");
  });

  it(".env.mvp.example keeps deployment secrets blank or placeholder-only", () => {
    const mvpEnv = readRepoFile(".env.mvp.example");
    const values = parseEnvText(mvpEnv);
    const liveOpenAiStyleKey = new RegExp(`${["s", "k"].join("-")}[A-Za-z0-9]{10,}`);

    expect(mvpEnv).not.toMatch(liveOpenAiStyleKey);
    expect(values.get("DATABASE_URL")).toBe("");
    expect(values.get("DIRECT_URL")).toBe("");

    for (const key of [
      "OPENAI_API_KEY",
      "FIREFLIES_API_KEY",
      "FIREFLIES_WEBHOOK_SECRET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "SLACK_CLIENT_SECRET",
      "CLICKUP_CLIENT_SECRET",
      "CLICKUP_WEBHOOK_SECRET",
      "GOOGLE_CLIENT_SECRET",
      "MICROSOFT_CLIENT_SECRET",
      "NOTION_CLIENT_SECRET",
      "NOTION_INTERNAL_INTEGRATION_TOKEN",
      "WHATSAPP_APP_SECRET"
    ]) {
      expect(values.get(key), `${key} should be blank in .env.mvp.example`).toBe("");
    }

    for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "CLIENT_SHARE_TOKEN_SECRET", "CONNECTOR_OAUTH_STATE_SECRET", "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY"]) {
      expect(values.get(key), `${key} should be blank in .env.mvp.example`).toBe("");
    }
  });

  it(".env.mvp.staging.example uses production runtime with staging validation", () => {
    const stagingEnv = readRepoFile(".env.mvp.staging.example");
    const values = parseEnvText(stagingEnv);

    expect(values.get("NODE_ENV")).toBe("production");
    expect(values.get("DEPLOYMENT_ENV")).toBe("staging");
    expect(values.get("SECURITY_HEADERS_ENABLED")).toBe("true");
    expect(values.get("RATE_LIMIT_ENABLED")).toBe("true");
    expect(values.get("SIGNUP_MODE")).toBe("invite_only");
    expect(values.get("MVP_MODE")).toBe("true");
    expect(values.get("MVP_EQUAL_PROJECT_ACCESS")).toBe("true");
    expect(values.get("MVP_ENABLED_COMMUNICATION_PROVIDERS")).toBe("manual_import,fireflies_ai,slack,clickup,granola,microsoft_teams,notion");
    expect(values.get("MVP_ENABLE_ADVANCED_CONNECTORS")).toBe("false");
    expect(values.get("MVP_ENABLE_CLIENT_PORTAL")).toBe("false");
    expect(values.get("MVP_ENABLE_PROJECT_FINANCE")).toBe("false");
    expect(values.get("MVP_ENABLE_PROJECT_SUBSCRIPTIONS")).toBe("false");
    expect(values.get("MVP_ENABLE_CALENDAR_SYNC")).toBe("false");
    expect(values.get("MVP_SIMPLE_CHANGE_APPLY")).toBe("true");
    expect(values.get("MVP_REQUIRE_MANAGER_APPROVAL")).toBe("false");
    expect(values.get("MVP_SHOW_VERSION_HISTORY")).toBe("false");
    expect(values.get("FIREFLIES_READINESS_MODE")).toBe("manual_only");
  });
});
