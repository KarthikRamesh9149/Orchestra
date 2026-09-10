import { afterEach, describe, expect, it } from "vitest";
import { getEnv } from "../src/config/env.js";

const originalEnv = { ...process.env };
const isolatedBaseEnv: NodeJS.ProcessEnv = {
  PATH: originalEnv.PATH,
  Path: originalEnv.Path,
  SystemRoot: originalEnv.SystemRoot,
  TEMP: originalEnv.TEMP,
  TMP: originalEnv.TMP
};

afterEach(() => {
  process.env = { ...originalEnv };
});

function applyBaseProductionEnv(overrides: NodeJS.ProcessEnv = {}) {
  process.env = {
    ...isolatedBaseEnv,
    NODE_ENV: "production",
    APP_BASE_URL: "https://api.orchestra.example",
    FRONTEND_BASE_URL: "https://app.orchestra.example",
    CLIENT_PORTAL_BASE_URL: "https://portal.orchestra.example",
    CORS_ALLOWED_ORIGINS: "https://app.orchestra.example",
    API_PROXY_SHARED_SECRET: "prod_proxy_shared_secret_32_chars_minimum",
    DATABASE_URL: "postgresql://user:pass@db.example:5432/orchestra",
    REDIS_URL: "redis://redis.example:6379",
    QUEUE_MODE: "bullmq",
    STORAGE_DRIVER: "s3",
    S3_BUCKET: "orchestra-prod",
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY_ID: "placeholder-access-key",
    S3_SECRET_ACCESS_KEY: "placeholder-secret-key",
    JWT_ACCESS_SECRET: "prod_access_secret_32_chars_minimum",
    JWT_REFRESH_SECRET: "prod_refresh_secret_32_chars_minimum",
    SIGNUP_MODE: "invite_only",
    SIGNUP_ALLOWED_EMAIL_DOMAINS: "orchestra.example",
    CONNECTOR_CREDENTIAL_VAULT_MODE: "managed_reference",
    CONNECTOR_MANAGED_SECRET_PROVIDER: "external_reference",
    CONNECTOR_MANAGED_SECRET_PREFIX: "orchestra/",
    CONNECTOR_OAUTH_STATE_SECRET: "prod_connector_state_32_chars_minimum",
    CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: "prod_connector_encryption_32_chars_minimum",
    CLIENT_SHARE_TOKEN_SECRET: "prod_client_share_32_chars_minimum",
    METRICS_TOKEN: "prod_metrics_token_32_chars_minimum",
    TRACE_EXPORTER_OTLP_ENDPOINT: "https://otel.example/v1/traces",
    ERROR_AGGREGATION_DSN: "https://errors.example/project",
    UPTIME_CHECK_URLS: "https://api.orchestra.example/health,https://api.orchestra.example/metrics",
    SOCRATES_MODEL_FAST_INPUT_COST_PER_1M: "0.25",
    SOCRATES_MODEL_FAST_OUTPUT_COST_PER_1M: "1.25",
    SOCRATES_MODEL_HIGH_QUALITY_INPUT_COST_PER_1M: "3",
    SOCRATES_MODEL_HIGH_QUALITY_OUTPUT_COST_PER_1M: "15",
    SOCRATES_MODEL_FALLBACK_INPUT_COST_PER_1M: "0.25",
    SOCRATES_MODEL_FALLBACK_OUTPUT_COST_PER_1M: "1.25",
    SOCRATES_EMBEDDING_COST_PER_1M: "0.02",
    SOCRATES_RERANK_COST_PER_1K: "0.002",
    ...overrides
  };
}

function applyBaseStagingEnv(overrides: NodeJS.ProcessEnv = {}) {
  process.env = {
    ...isolatedBaseEnv,
    NODE_ENV: "production",
    DEPLOYMENT_ENV: "staging",
    APP_BASE_URL: "https://api.staging.orchestra.example",
    FRONTEND_BASE_URL: "https://staging.orchestra.example",
    CLIENT_PORTAL_BASE_URL: "",
    CORS_ALLOWED_ORIGINS: "https://staging.orchestra.example",
    SECURITY_HEADERS_ENABLED: "true",
    RATE_LIMIT_ENABLED: "true",
    API_PROXY_SHARED_SECRET: "staging_proxy_shared_secret_32_chars_minimum",
    DATABASE_URL: "postgresql://user:pass@staging-db.example:5432/orchestra",
    REDIS_URL: "",
    QUEUE_MODE: "inline",
    STORAGE_DRIVER: "local",
    JWT_ACCESS_SECRET: "staging_access_secret_32_chars_minimum",
    JWT_REFRESH_SECRET: "staging_refresh_secret_32_chars_minimum",
    SIGNUP_MODE: "invite_only",
    SIGNUP_ALLOWED_EMAIL_DOMAINS: "orchestra.example",
    CONNECTOR_CREDENTIAL_VAULT_MODE: "encrypted_file",
    CONNECTOR_OAUTH_STATE_SECRET: "staging_connector_state_32_chars_minimum",
    CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: "staging_connector_encrypt_32_chars_minimum",
    CLIENT_SHARE_TOKEN_SECRET: "staging_client_share_32_chars_minimum",
    METRICS_TOKEN: "",
    TRACE_EXPORTER_OTLP_ENDPOINT: "",
    ERROR_AGGREGATION_DSN: "",
    UPTIME_CHECK_URLS: "",
    SOCRATES_MODEL_FAST_INPUT_COST_PER_1M: "0",
    SOCRATES_MODEL_FAST_OUTPUT_COST_PER_1M: "0",
    SOCRATES_MODEL_HIGH_QUALITY_INPUT_COST_PER_1M: "0",
    SOCRATES_MODEL_HIGH_QUALITY_OUTPUT_COST_PER_1M: "0",
    SOCRATES_MODEL_FALLBACK_INPUT_COST_PER_1M: "0",
    SOCRATES_MODEL_FALLBACK_OUTPUT_COST_PER_1M: "0",
    SOCRATES_EMBEDDING_COST_PER_1M: "0",
    ...overrides
  };
}

function applyFreeTierBetaProductionEnv(overrides: NodeJS.ProcessEnv = {}) {
  applyBaseProductionEnv({
    DEPLOYMENT_ENV: "production",
    ORCHESTRA_PROFILE: "mvp_beta",
    MVP_BETA_MODE: "true",
    MVP_BETA_FREE_TIER_MODE: "true",
    OPENAI_API_KEY: "sk-test-openai-key",
    VSCODE_CONNECTOR_TOKEN_SECRET: "prod_vscode_connector_32_chars_minimum",
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_ROOT: "/app/storage",
    RAILWAY_VOLUME_MOUNT_PATH: "/app/storage",
    CONNECTOR_CREDENTIAL_VAULT_MODE: "encrypted_file",
    TRACE_EXPORTER_OTLP_ENDPOINT: "",
    ERROR_AGGREGATION_DSN: "",
    UPTIME_CHECK_URLS: "",
    ...overrides
  });
}

function expectEnvIssue(path: string) {
  try {
    getEnv();
  } catch (error) {
    expect((error as { issues?: Array<{ path: string[] }> }).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: [path] })])
    );
    return;
  }

  throw new Error(`Expected env validation issue for ${path}`);
}

function applyBaseTestEnv(overrides: NodeJS.ProcessEnv = {}) {
  process.env = {
    ...isolatedBaseEnv,
    NODE_ENV: "test",
    APP_BASE_URL: "http://localhost:3000",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/orchestra",
    JWT_ACCESS_SECRET: "test_access_secret_32_chars_minimum",
    JWT_REFRESH_SECRET: "test_refresh_secret_32_chars_minimum",
    ...overrides
  };
}

describe("MVP environment flags", () => {
  it("defaults to full-backend behavior", () => {
    applyBaseTestEnv();

    expect(getEnv()).toMatchObject({
      MVP_MODE: false,
      BETA_GMAIL_INVITE_SENDER_ENABLED: false,
      PROVIDER_RELEASE_VALIDATED_PROVIDERS: ["vscode"],
      MVP_EQUAL_PROJECT_ACCESS: false,
      MVP_ENABLED_COMMUNICATION_PROVIDERS: [
        "manual_import",
        "fireflies_ai",
        "slack",
        "clickup",
        "granola",
        "microsoft_teams",
        "zoho_mail",
        "zoho_cliq",
        "zoho_crm",
        "notion"
      ],
      MVP_ENABLE_ADVANCED_CONNECTORS: false,
      MVP_ENABLE_CLIENT_PORTAL: true,
      MVP_ENABLE_PROJECT_FINANCE: false,
      MVP_ENABLE_PROJECT_SUBSCRIPTIONS: false,
      MVP_ENABLE_CALENDAR_SYNC: false,
      MVP_SIMPLE_CHANGE_APPLY: false,
      MVP_REQUIRE_MANAGER_APPROVAL: true,
      MVP_SHOW_VERSION_HISTORY: true,
      MVP_ENABLE_IMAGE_CONTEXT: true,
      MVP_ENABLE_IMAGE_VISION_SUMMARY: false,
      MVP_IMAGE_CONTEXT_MAX_FILE_SIZE_BYTES: 10485760,
      MVP_CONTEXT_ATTACHMENT_MAX_FILE_SIZE_BYTES: 26214400,
      MVP_IMAGE_CONTEXT_ALLOWED_MIME_TYPES: ["image/png", "image/jpeg", "image/webp"],
      SOCRATES_MODEL: "gpt-5.4-mini",
      SOCRATES_ESCALATION_MODEL: "gpt-5.5",
      SOCRATES_ROUTER_MODEL: "gpt-5.4-nano",
      SOCRATES_MODEL_FAST: "gpt-5.4-mini",
      SOCRATES_MODEL_HIGH_QUALITY: "gpt-5.5",
      SOCRATES_MODEL_FALLBACK: "gpt-5.5",
      SOCRATES_CLASSIFIER_MODEL: "gpt-5.4-nano",
      SOCRATES_SUMMARY_MODEL: "gpt-5.4-nano",
      SOCRATES_RERANK_MODEL: "gpt-5.4-nano",
      SOCRATES_RERANK_PROVIDER: "deterministic",
      MVP_CONTEXT_ALLOWED_FILE_MIME_TYPES: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
        "text/markdown"
      ]
    });
  });

  it("parses and validates the operator-certified provider allowlist", () => {
    applyBaseTestEnv({ PROVIDER_RELEASE_VALIDATED_PROVIDERS: "slack,github,slack,vscode" });
    expect(getEnv()).toMatchObject({
      PROVIDER_RELEASE_VALIDATED_PROVIDERS: ["slack", "github", "vscode"]
    });

    applyBaseTestEnv({ PROVIDER_RELEASE_VALIDATED_PROVIDERS: "slack,unknown_provider" });
    expectEnvIssue("PROVIDER_RELEASE_VALIDATED_PROVIDERS");
  });

  it("parses MVP mode, equal access, and provider list flags", () => {
    applyBaseTestEnv({
      MVP_MODE: "true",
      BETA_GMAIL_INVITE_SENDER_ENABLED: "true",
      MVP_EQUAL_PROJECT_ACCESS: "true",
      MVP_ENABLED_COMMUNICATION_PROVIDERS: "manual_import, fireflies_ai, slack, clickup, granola, microsoft_teams, manual_import"
    });

    expect(getEnv()).toMatchObject({
      MVP_MODE: true,
      BETA_GMAIL_INVITE_SENDER_ENABLED: true,
      MVP_EQUAL_PROJECT_ACCESS: true,
      MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "fireflies_ai", "slack", "clickup", "granola", "microsoft_teams"]
    });
  });

  it("parses an explicit empty MVP provider list as empty", () => {
    applyBaseTestEnv({
      MVP_MODE: "true",
      MVP_ENABLED_COMMUNICATION_PROVIDERS: " "
    });

    expect(getEnv()).toMatchObject({
      MVP_MODE: true,
      MVP_ENABLED_COMMUNICATION_PROVIDERS: []
    });
  });

  it("rejects unknown MVP communication providers", () => {
    applyBaseTestEnv({
      MVP_ENABLED_COMMUNICATION_PROVIDERS: "manual_import,firefly_ai"
    });

    expectEnvIssue("MVP_ENABLED_COMMUNICATION_PROVIDERS");
  });

  it("parses image context flags and MIME type allow lists", () => {
    applyBaseTestEnv({
      MVP_ENABLE_IMAGE_CONTEXT: "false",
      MVP_ENABLE_IMAGE_VISION_SUMMARY: "true",
      MVP_IMAGE_CONTEXT_ALLOWED_MIME_TYPES: "image/png, image/webp, image/png",
      MVP_CONTEXT_ALLOWED_FILE_MIME_TYPES: "text/plain,text/markdown"
    });

    expect(getEnv()).toMatchObject({
      MVP_ENABLE_IMAGE_CONTEXT: false,
      MVP_ENABLE_IMAGE_VISION_SUMMARY: true,
      MVP_IMAGE_CONTEXT_ALLOWED_MIME_TYPES: ["image/png", "image/webp"],
      MVP_CONTEXT_ALLOWED_FILE_MIME_TYPES: ["text/plain", "text/markdown"]
    });
  });
});

describe("production environment safety", () => {
  it("resolves DEPLOYMENT_ENV from NODE_ENV when omitted for backward compatibility", () => {
    applyBaseTestEnv({ NODE_ENV: "test" });
    expect(getEnv()).toMatchObject({ NODE_ENV: "test", DEPLOYMENT_ENV: "test" });

    applyBaseTestEnv({ NODE_ENV: "development" });
    expect(getEnv()).toMatchObject({ NODE_ENV: "development", DEPLOYMENT_ENV: "development" });

    applyFreeTierBetaProductionEnv();
    delete process.env.DEPLOYMENT_ENV;
    expect(getEnv()).toMatchObject({ NODE_ENV: "production", DEPLOYMENT_ENV: "production" });
  });

  it("keeps NODE_ENV=production strict when DEPLOYMENT_ENV is omitted", () => {
    applyBaseProductionEnv({
      TRACE_EXPORTER_OTLP_ENDPOINT: "",
      ERROR_AGGREGATION_DSN: "",
      UPTIME_CHECK_URLS: "",
      METRICS_TOKEN: "",
      SOCRATES_MODEL_FAST_INPUT_COST_PER_1M: "0"
    });

    for (const path of [
      "TRACE_EXPORTER_OTLP_ENDPOINT",
      "ERROR_AGGREGATION_DSN",
      "UPTIME_CHECK_URLS",
      "METRICS_TOKEN",
      "SOCRATES_MODEL_FAST_INPUT_COST_PER_1M"
    ]) {
      expectEnvIssue(path);
    }
  });

  it("allows staging to run NODE_ENV=production without production-only ops, cost, storage, and vault blockers", () => {
    applyBaseStagingEnv();

    expect(getEnv()).toMatchObject({
      NODE_ENV: "production",
      DEPLOYMENT_ENV: "staging",
      QUEUE_MODE: "inline",
      STORAGE_DRIVER: "local",
      CONNECTOR_CREDENTIAL_VAULT_MODE: "encrypted_file",
      METRICS_TOKEN: "",
      TRACE_EXPORTER_OTLP_ENDPOINT: undefined,
      ERROR_AGGREGATION_DSN: undefined,
      UPTIME_CHECK_URLS: "",
      SOCRATES_MODEL_FAST_INPUT_COST_PER_1M: 0
    });
  });

  it("allows beta staging to use evidence-only degraded mode without an OpenAI secret", () => {
    applyBaseStagingEnv({
      ORCHESTRA_PROFILE: "mvp_beta",
      MVP_BETA_MODE: "true",
      VSCODE_CONNECTOR_TOKEN_SECRET: "staging_vscode_connector_32_chars_minimum"
    });

    expect(getEnv()).toMatchObject({
      DEPLOYMENT_ENV: "staging",
      ORCHESTRA_PROFILE: "mvp_beta",
      MVP_BETA_MODE: true,
      SOCRATES_ENABLE_EVIDENCE_ONLY_DEGRADED_MODE: true
    });
  });

  it("still requires an OpenAI secret for production beta", () => {
    applyBaseProductionEnv({
      ORCHESTRA_PROFILE: "mvp_beta",
      MVP_BETA_MODE: "true",
      VSCODE_CONNECTOR_TOKEN_SECRET: "prod_vscode_connector_32_chars_minimum"
    });

    expectEnvIssue("OPENAI_API_KEY");
  });

  it("keeps production-like security validation in staging", () => {
    applyBaseStagingEnv({ JWT_ACCESS_SECRET: "change_me_access" });
    expectEnvIssue("JWT_ACCESS_SECRET");

    applyBaseStagingEnv({ CORS_ALLOWED_ORIGINS: "https://staging.orchestra.example,*" });
    expectEnvIssue("CORS_ALLOWED_ORIGINS");

    applyBaseStagingEnv({ SIGNUP_MODE: "open" });
    expectEnvIssue("SIGNUP_MODE");

    applyBaseStagingEnv({ SOCRATES_MODEL_FAST: "test-model" });
    expectEnvIssue("SOCRATES_MODEL_FAST");

    applyBaseStagingEnv({ SOCRATES_MODEL: "test-model" });
    expectEnvIssue("SOCRATES_MODEL");

    applyBaseStagingEnv({ AUTH_COOKIE_SECURE: "false" });
    expectEnvIssue("AUTH_COOKIE_SECURE");
  });

  it("requires Secure cookies whenever SameSite=None is configured", () => {
    applyBaseTestEnv();
    expect(getEnv()).toMatchObject({ AUTH_COOKIE_SECURE: true, AUTH_COOKIE_SAME_SITE: "none" });

    applyBaseTestEnv({ AUTH_COOKIE_SECURE: "false", AUTH_COOKIE_SAME_SITE: "none" });
    expectEnvIssue("AUTH_COOKIE_SECURE");

    applyBaseTestEnv({ AUTH_COOKIE_SECURE: "true", AUTH_COOKIE_SAME_SITE: "none" });
    expect(getEnv()).toMatchObject({ AUTH_COOKIE_SECURE: true, AUTH_COOKIE_SAME_SITE: "none" });
  });

  it("requires OpenAI runtime models in staging and production", () => {
    for (const field of [
      "SOCRATES_MODEL",
      "SOCRATES_ESCALATION_MODEL",
      "SOCRATES_ROUTER_MODEL",
      "SOCRATES_RERANK_MODEL",
      "SOCRATES_MODEL_FAST",
      "SOCRATES_MODEL_HIGH_QUALITY",
      "SOCRATES_MODEL_FALLBACK",
      "SOCRATES_CLASSIFIER_MODEL",
      "SOCRATES_SUMMARY_MODEL",
      "VSCODE_SOCRATES_MODEL"
    ] as const) {
      applyBaseStagingEnv({ OPENAI_API_KEY: "sk-test-openai-key", [field]: "claude-3-5-haiku-latest" });
      expectEnvIssue(field);

      applyBaseProductionEnv({ OPENAI_API_KEY: "sk-test-openai-key", [field]: "claude-opus-4-20250514" });
      expectEnvIssue(field);
    }

    applyFreeTierBetaProductionEnv({
      OPENAI_API_KEY: "sk-test-openai-key",
      OPENAI_GENERATION_MODEL: "gpt-5.4-mini",
      SOCRATES_MODEL: "gpt-5.4-mini",
      SOCRATES_ESCALATION_MODEL: "gpt-5.5",
      SOCRATES_ROUTER_MODEL: "gpt-5.4-nano",
      SOCRATES_RERANK_MODEL: "gpt-5.4-nano",
      SOCRATES_MODEL_FAST: "gpt-5.4-mini",
      SOCRATES_MODEL_HIGH_QUALITY: "gpt-5.5",
      SOCRATES_MODEL_FALLBACK: "gpt-5.5",
      SOCRATES_CLASSIFIER_MODEL: "gpt-5.4-nano",
      SOCRATES_SUMMARY_MODEL: "gpt-5.4-nano",
      VSCODE_SOCRATES_MODEL: "gpt-5.4-mini"
    });

    expect(getEnv()).toMatchObject({
      OPENAI_GENERATION_MODEL: "gpt-5.4-mini",
      SOCRATES_MODEL: "gpt-5.4-mini",
      SOCRATES_ESCALATION_MODEL: "gpt-5.5",
      SOCRATES_ROUTER_MODEL: "gpt-5.4-nano",
      SOCRATES_RERANK_MODEL: "gpt-5.4-nano",
      SOCRATES_MODEL_FAST: "gpt-5.4-mini",
      SOCRATES_CLASSIFIER_MODEL: "gpt-5.4-nano",
      VSCODE_SOCRATES_MODEL: "gpt-5.4-mini"
    });
  });

  it("rejects inherited non-OpenAI task model defaults in OpenAI beta runtime", () => {
    applyBaseStagingEnv({
      OPENAI_API_KEY: "sk-test-openai-key",
      OPENAI_GENERATION_MODEL: "gpt-5.4-mini",
      SOCRATES_MODEL: "claude-3-7-sonnet-latest",
      SOCRATES_ESCALATION_MODEL: "claude-3-7-sonnet-latest",
      SOCRATES_ROUTER_MODEL: "claude-3-7-sonnet-latest",
      SOCRATES_RERANK_MODEL: "claude-3-7-sonnet-latest",
      SOCRATES_MODEL_FAST: "claude-3-7-sonnet-latest",
      SOCRATES_MODEL_HIGH_QUALITY: "claude-3-7-sonnet-latest",
      SOCRATES_MODEL_FALLBACK: "claude-3-7-sonnet-latest",
      SOCRATES_CLASSIFIER_MODEL: "claude-3-7-sonnet-latest",
      SOCRATES_SUMMARY_MODEL: "claude-3-7-sonnet-latest"
    });

    expectEnvIssue("SOCRATES_MODEL");

    applyBaseStagingEnv({
      OPENAI_API_KEY: "sk-test-openai-key",
      OPENAI_GENERATION_MODEL: "claude-3-7-sonnet-latest",
      SOCRATES_MODEL: "gpt-5.4-mini",
      SOCRATES_ESCALATION_MODEL: "gpt-5.5",
      SOCRATES_ROUTER_MODEL: "gpt-5.4-nano",
      SOCRATES_RERANK_MODEL: "gpt-5.4-nano",
      SOCRATES_MODEL_FAST: "gpt-5.4-mini",
      SOCRATES_MODEL_HIGH_QUALITY: "gpt-5.5",
      SOCRATES_MODEL_FALLBACK: "gpt-5.5",
      SOCRATES_CLASSIFIER_MODEL: "gpt-5.4-nano",
      SOCRATES_SUMMARY_MODEL: "gpt-5.4-nano"
    });
    expectEnvIssue("OPENAI_GENERATION_MODEL");
  });

  it("does not require a third-party key for deterministic beta reranking", () => {
    applyFreeTierBetaProductionEnv({ SOCRATES_RERANK_PROVIDER: "deterministic" });
    expect(getEnv()).toMatchObject({ SOCRATES_RERANK_PROVIDER: "deterministic" });
  });

  it("requires nonzero paid rerank cost only when a paid reranker is enabled", () => {
    applyBaseProductionEnv({ SOCRATES_RERANK_PROVIDER: "openai", SOCRATES_RERANK_COST_PER_1K: "0" });
    expectEnvIssue("SOCRATES_RERANK_COST_PER_1K");
  });

  it("rejects local storage in production", () => {
    applyBaseProductionEnv({ STORAGE_DRIVER: "local" });

    expectEnvIssue("STORAGE_DRIVER");
  });

  it("keeps the free-tier exception off by default", () => {
    applyBaseProductionEnv({
      ORCHESTRA_PROFILE: "mvp_beta",
      MVP_BETA_MODE: "true",
      OPENAI_API_KEY: "sk-test-openai-key",
      VSCODE_CONNECTOR_TOKEN_SECRET: "prod_vscode_connector_32_chars_minimum",
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_ROOT: "/app/storage",
      RAILWAY_VOLUME_MOUNT_PATH: "/app/storage",
      CONNECTOR_CREDENTIAL_VAULT_MODE: "encrypted_file",
      TRACE_EXPORTER_OTLP_ENDPOINT: "",
      ERROR_AGGREGATION_DSN: "",
      UPTIME_CHECK_URLS: ""
    });

    for (const path of [
      "STORAGE_DRIVER",
      "CONNECTOR_CREDENTIAL_VAULT_MODE",
      "TRACE_EXPORTER_OTLP_ENDPOINT",
      "ERROR_AGGREGATION_DSN",
      "UPTIME_CHECK_URLS"
    ]) {
      expectEnvIssue(path);
    }
  });

  it("accepts only the explicit volume-backed free-tier beta production profile", () => {
    applyFreeTierBetaProductionEnv();

    expect(getEnv()).toMatchObject({
      NODE_ENV: "production",
      DEPLOYMENT_ENV: "production",
      ORCHESTRA_PROFILE: "mvp_beta",
      MVP_BETA_MODE: true,
      MVP_BETA_FREE_TIER_MODE: true,
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_ROOT: "/app/storage",
      RAILWAY_VOLUME_MOUNT_PATH: "/app/storage",
      CONNECTOR_CREDENTIAL_VAULT_MODE: "encrypted_file",
      TRACE_EXPORTER_OTLP_ENDPOINT: undefined,
      ERROR_AGGREGATION_DSN: undefined,
      UPTIME_CHECK_URLS: ""
    });
  });

  it("rejects the free-tier flag outside the exact beta production profile", () => {
    applyBaseProductionEnv({ MVP_BETA_FREE_TIER_MODE: "true" });
    expectEnvIssue("MVP_BETA_FREE_TIER_MODE");

    applyBaseStagingEnv({
      ORCHESTRA_PROFILE: "mvp_beta",
      MVP_BETA_MODE: "true",
      MVP_BETA_FREE_TIER_MODE: "true"
    });
    expectEnvIssue("MVP_BETA_FREE_TIER_MODE");
  });

  it("rejects ephemeral or escaped local paths in free-tier beta production", () => {
    applyFreeTierBetaProductionEnv({ RAILWAY_VOLUME_MOUNT_PATH: "" });
    expectEnvIssue("STORAGE_DRIVER");
    expectEnvIssue("CONNECTOR_CREDENTIAL_VAULT_MODE");

    applyFreeTierBetaProductionEnv({
      RAILWAY_VOLUME_MOUNT_PATH: "/app/data",
      STORAGE_LOCAL_ROOT: "/app/storage"
    });
    expectEnvIssue("STORAGE_DRIVER");
    expectEnvIssue("CONNECTOR_CREDENTIAL_VAULT_MODE");
  });

  it("does not relax beta production security, queue, metrics, or credential encryption requirements", () => {
    applyFreeTierBetaProductionEnv({
      SECURITY_HEADERS_ENABLED: "false",
      RATE_LIMIT_ENABLED: "false",
      QUEUE_MODE: "inline",
      METRICS_TOKEN: "",
      CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: "change_me_connector_credential_encryption_key"
    });

    for (const path of [
      "SECURITY_HEADERS_ENABLED",
      "RATE_LIMIT_ENABLED",
      "QUEUE_MODE",
      "METRICS_TOKEN",
      "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY"
    ]) {
      expectEnvIssue(path);
    }
  });

  it("rejects wildcard CORS in production", () => {
    applyBaseProductionEnv({ CORS_ALLOWED_ORIGINS: "https://app.orchestra.example,*" });

    expectEnvIssue("CORS_ALLOWED_ORIGINS");
  });

  it("rejects weak production JWT and token secrets", () => {
    applyBaseProductionEnv({
      JWT_ACCESS_SECRET: "change_me_access",
      JWT_REFRESH_SECRET: "dev_refresh_secret",
      CONNECTOR_OAUTH_STATE_SECRET: "change_me_connector_state_secret",
      CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: "change_me_connector_credential_encryption_key",
      CLIENT_SHARE_TOKEN_SECRET: "change_me_client_share_secret",
      METRICS_TOKEN: ""
    });

    for (const path of [
      "JWT_ACCESS_SECRET",
      "JWT_REFRESH_SECRET",
      "CONNECTOR_OAUTH_STATE_SECRET",
      "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY",
      "CLIENT_SHARE_TOKEN_SECRET",
      "METRICS_TOKEN"
    ]) {
      expectEnvIssue(path);
    }
  });

  it("requires access and refresh JWT secrets to be different in production", () => {
    applyBaseProductionEnv({
      JWT_ACCESS_SECRET: "same_jwt_secret_32_chars_minimum",
      JWT_REFRESH_SECRET: "same_jwt_secret_32_chars_minimum"
    });

    expectEnvIssue("JWT_REFRESH_SECRET");
  });

  it("rejects the unimplemented managed vault even with otherwise valid production configuration", () => {
    applyBaseProductionEnv();
    expectEnvIssue("CONNECTOR_CREDENTIAL_VAULT_MODE");
    expect(() => getEnv()).toThrow("Managed credential resolution is not implemented");
  });

  it("rejects local encrypted credential-vault mode in production", () => {
    applyBaseProductionEnv({ CONNECTOR_CREDENTIAL_VAULT_MODE: "encrypted_file" });

    expectEnvIssue("CONNECTOR_CREDENTIAL_VAULT_MODE");
  });

  it("requires security headers and generic rate limiting in production", () => {
    applyBaseProductionEnv({ SECURITY_HEADERS_ENABLED: "false" });
    expectEnvIssue("SECURITY_HEADERS_ENABLED");

    applyBaseProductionEnv({ RATE_LIMIT_ENABLED: "false" });
    expectEnvIssue("RATE_LIMIT_ENABLED");
  });

  it("requires production observability sinks and uptime checks", () => {
    applyBaseProductionEnv({ TRACE_EXPORTER_OTLP_ENDPOINT: "" });
    expectEnvIssue("TRACE_EXPORTER_OTLP_ENDPOINT");

    applyBaseProductionEnv({ ERROR_AGGREGATION_DSN: "" });
    expectEnvIssue("ERROR_AGGREGATION_DSN");

    applyBaseProductionEnv({ UPTIME_CHECK_URLS: "" });
    expectEnvIssue("UPTIME_CHECK_URLS");
  });

  it("rejects open signup and missing client portal URL policy in production", () => {
    applyBaseProductionEnv({ SIGNUP_MODE: "open" });
    expectEnvIssue("SIGNUP_MODE");

    applyBaseProductionEnv({ SIGNUP_MODE: "invite_only", SIGNUP_ALLOWED_EMAIL_DOMAINS: "" });
    expectEnvIssue("SIGNUP_ALLOWED_EMAIL_DOMAINS");

    applyBaseProductionEnv({ FRONTEND_BASE_URL: "", CLIENT_PORTAL_BASE_URL: "" });
    expectEnvIssue("CLIENT_PORTAL_BASE_URL");
  });

  it("requires credential encryption key to be separate from OAuth state signing in production", () => {
    applyBaseProductionEnv({
      CONNECTOR_OAUTH_STATE_SECRET: "same_connector_secret_32_chars_minimum",
      CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: "same_connector_secret_32_chars_minimum"
    });

    expectEnvIssue("CONNECTOR_CREDENTIAL_ENCRYPTION_KEY");
  });

  it("requires Fireflies secrets only when live API or webhook modes are enabled", () => {
    applyFreeTierBetaProductionEnv({ FIREFLIES_READINESS_MODE: "manual_only" });
    expect(getEnv()).toMatchObject({ FIREFLIES_READINESS_MODE: "manual_only" });

    applyBaseProductionEnv({ FIREFLIES_READINESS_MODE: "api", FIREFLIES_API_KEY: "" });
    expectEnvIssue("FIREFLIES_API_KEY");

    applyBaseProductionEnv({ FIREFLIES_READINESS_MODE: "webhook", FIREFLIES_WEBHOOK_SECRET: "" });
    expectEnvIssue("FIREFLIES_WEBHOOK_SECRET");
  });

  it("forbids tenant-shared provider credentials in production-like deployments", () => {
    applyBaseProductionEnv({ FIREFLIES_READINESS_MODE: "api", FIREFLIES_API_KEY: "fireflies-api-key" });
    expectEnvIssue("FIREFLIES_READINESS_MODE");

    applyBaseProductionEnv({
      FIREFLIES_READINESS_MODE: "manual_only",
      NOTION_INTERNAL_TOKEN_MODE_ENABLED: "true",
      NOTION_INTERNAL_INTEGRATION_TOKEN: "notion-shared-token"
    });
    expectEnvIssue("NOTION_INTERNAL_TOKEN_MODE_ENABLED");
  });

  it("rejects non-official Fireflies API base URLs in production", () => {
    applyBaseProductionEnv({
      FIREFLIES_READINESS_MODE: "api",
      FIREFLIES_API_KEY: "fireflies-api-key",
      FIREFLIES_API_BASE_URL: "https://fireflies-proxy.internal/graphql"
    });

    expectEnvIssue("FIREFLIES_API_BASE_URL");
  });

  it("accepts blank optional Fireflies smoke placeholders from copied env examples", () => {
    applyFreeTierBetaProductionEnv({
      FIREFLIES_SMOKE_BASE_URL: "",
      FIREFLIES_SMOKE_MANAGER_EMAIL: "",
      FIREFLIES_SMOKE_MANAGER_PASSWORD: "",
      FIREFLIES_SMOKE_PROJECT_ID: "",
      FIREFLIES_SMOKE_TRANSCRIPT_ID: ""
    });

    expect(getEnv()).toMatchObject({
      FIREFLIES_SMOKE_BASE_URL: undefined,
      FIREFLIES_SMOKE_MANAGER_EMAIL: undefined,
      FIREFLIES_SMOKE_MANAGER_PASSWORD: undefined,
      FIREFLIES_SMOKE_PROJECT_ID: undefined,
      FIREFLIES_SMOKE_TRANSCRIPT_ID: undefined
    });
  });
});
