import { config as loadEnv } from "dotenv";
import path from "node:path";
import { z } from "zod";

loadEnv();

const productionSecretPlaceholders = [
  "change_me",
  "changeme",
  "replace_me",
  "replace-me",
  "dev_access_secret",
  "dev_refresh_secret",
  "development_secret",
  "default_secret",
  "password"
];

function isWeakProductionSecret(value: string | undefined) {
  if (!value || value.length < 32) {
    return true;
  }

  const normalized = value.toLowerCase();
  return productionSecretPlaceholders.some((placeholder) => normalized.includes(placeholder));
}

function isUnsafeProductionModel(value: string | undefined) {
  if (!value) return true;
  const normalized = value.toLowerCase();
  return normalized === "mock" || normalized.includes("placeholder") || normalized.includes("test-model");
}

function isOpenAiGenerationModel(value: string | undefined) {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized.startsWith("gpt-") || normalized.startsWith("o3") || normalized.startsWith("o4") || normalized.startsWith("o1");
}

function blankToUndefined(value: unknown) {
  return value === "" ? undefined : value;
}

function optionalBlankString(schema: z.ZodString) {
  return z.preprocess(blankToUndefined, schema.optional());
}

function booleanString(defaultValue: "true" | "false") {
  return z.enum(["true", "false"]).default(defaultValue).transform((value) => value === "true");
}

function isPathInside(parentPath: string | undefined, candidatePath: string) {
  if (!parentPath || !path.isAbsolute(parentPath)) return false;
  const parent = path.resolve(parentPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const communicationProviderValues = [
  "manual_import",
  "slack",
  "clickup",
  "gmail",
  "outlook",
  "microsoft_teams",
  "whatsapp_business",
  "fireflies_ai",
  "granola",
  "zoho_mail",
  "zoho_cliq",
  "zoho_crm",
  "notion"
] as const;

const releaseValidatedProviderValues = [
  "slack",
  "microsoft_teams",
  "notion",
  "google_drive",
  "google_calendar",
  "github",
  "fireflies_ai",
  "clickup",
  "granola",
  "zoho_mail",
  "zoho_cliq",
  "zoho_crm",
  "vscode"
] as const;

function communicationProviderList(defaultValue: string) {
  return z
    .string()
    .default(defaultValue)
    .transform((value, context) => {
      const providers = value
        .split(",")
        .map((provider) => provider.trim())
        .filter(Boolean);
      const allowed = new Set<string>(communicationProviderValues);
      const invalid = providers.filter((provider) => !allowed.has(provider));
      if (invalid.length > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown communication provider(s): ${invalid.join(", ")}`
        });
        return z.NEVER;
      }
      return Array.from(new Set(providers)) as Array<(typeof communicationProviderValues)[number]>;
    });
}

function releaseValidatedProviderList(defaultValue: string) {
  return z
    .string()
    .default(defaultValue)
    .transform((value, context) => {
      const providers = value
        .split(",")
        .map((provider) => provider.trim())
        .filter(Boolean);
      const allowed = new Set<string>(releaseValidatedProviderValues);
      const invalid = providers.filter((provider) => !allowed.has(provider));
      if (invalid.length > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown release-validated provider(s): ${invalid.join(", ")}`
        });
        return z.NEVER;
      }
      return Array.from(new Set(providers)) as Array<(typeof releaseValidatedProviderValues)[number]>;
    });
}

function csvList(defaultValue: string) {
  return z
    .string()
    .default(defaultValue)
    .transform((value) =>
      Array.from(
        new Set(
          value
            .split(",")
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean)
        )
      )
    );
}

function csvListPreserveCase(defaultValue: string) {
  return z
    .string()
    .default(defaultValue)
    .transform((value) =>
      Array.from(
        new Set(
          value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        )
      )
    );
}

const envSchema = z.object({
  RUNTIME_PROFILE: z.enum(["desktop-local", "self-hosted", "managed"]).default("managed"),
  DESKTOP_SHARED_SERVER_ID: optionalBlankString(z.string().uuid()),
  DESKTOP_SHARED_CACHE_ENABLED: booleanString("false"),
  DESKTOP_SHARED_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(300),
  DESKTOP_SHARED_CACHE_MAX_BYTES: z.coerce.number().int().min(1024).max(50*1024*1024).default(5*1024*1024),
  SELF_HOST_DATA_ROOT: optionalBlankString(z.string()),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DEPLOYMENT_ENV: z.enum(["development", "test", "staging", "production"]).optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  ORCHESTRA_PROFILE: z.enum(["full", "mvp", "mvp_beta"]).default("full"),
  APP_BASE_URL: z.string().url(),
  FRONTEND_BASE_URL: optionalBlankString(z.string().url()),
  CLIENT_PORTAL_BASE_URL: optionalBlankString(z.string().url()),
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:3001"),
  SECURITY_HEADERS_ENABLED: booleanString("true"),
  RATE_LIMIT_ENABLED: booleanString("true"),
  API_PROXY_SHARED_SECRET: optionalBlankString(z.string().min(32)),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100000).default(1000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86400000).default(60000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(20),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86400000).default(60000),
  CLIENT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100000).default(120),
  CLIENT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86400000).default(60000),
  WEBHOOK_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100000).default(300),
  WEBHOOK_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86400000).default(60000),
  UPLOAD_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(20),
  UPLOAD_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86400000).default(60000),
  SOCRATES_STREAM_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(60),
  SOCRATES_STREAM_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86400000).default(60000),
  TRACE_EXPORTER_OTLP_ENDPOINT: optionalBlankString(z.string().url()),
  ERROR_AGGREGATION_DSN: optionalBlankString(z.string().url()),
  UPTIME_CHECK_URLS: z.string().default(""),
  MVP_BETA_MODE: booleanString("false"),
  MVP_BETA_FREE_TIER_MODE: booleanString("false"),
  PROVIDER_RELEASE_VALIDATED_PROVIDERS: releaseValidatedProviderList("vscode"),
  BETA_COMMUNICATION_MEMORY_ENABLED: booleanString("true"),
  BETA_SLACK_CONNECTOR_ENABLED: booleanString("true"),
  BETA_SLACK_OAUTH_ENABLED: booleanString("true"),
  BETA_SLACK_WEBHOOKS_ENABLED: booleanString("false"),
  BETA_GMAIL_INVITE_SENDER_ENABLED: booleanString("false"),
  BETA_CLICKUP_CONNECTOR_ENABLED: booleanString("true"),
  BETA_GRANOLA_CONNECTOR_ENABLED: booleanString("true"),
  BETA_FIREFLIES_CONNECTOR_ENABLED: booleanString("true"),
  BETA_ZOHO_MAIL_CONNECTOR_ENABLED: booleanString("true"),
  BETA_ZOHO_CLIQ_CONNECTOR_ENABLED: booleanString("true"),
  BETA_ZOHO_CRM_CONNECTOR_ENABLED: booleanString("true"),
  BETA_NOTION_CONNECTOR_ENABLED: booleanString("true"),
  BETA_MICROSOFT_TEAMS_CONNECTOR_ENABLED: booleanString("true"),
  BETA_COMMUNICATION_CHANGE_DETECTION_ENABLED: booleanString("true"),
  BETA_COMMUNICATION_AUTO_CLASSIFY_ENABLED: booleanString("true"),
  BETA_COMMUNICATION_AUTO_CANDIDATES_ENABLED: booleanString("false"),
  BETA_COMMUNICATION_AUTO_PROPOSALS_ENABLED: booleanString("false"),
  BETA_COMMUNICATION_AUTO_APPLY_ENABLED: booleanString("false"),
  BETA_REQUIRE_TRUTH_APPROVER_FOR_ACCEPT: booleanString("true"),
  BETA_LIVEDOC_MARKERS_ENABLED: booleanString("true"),
  BETA_PRODUCT_BRAIN_MUTATION_FROM_COMMUNICATIONS: booleanString("false"),
  BETA_PROJECT_SUBSCRIPTIONS_ENABLED: booleanString("true"),
  BETA_GOOGLE_CALENDAR_ENABLED: booleanString("true"),
  BETA_GOOGLE_CALENDAR_OAUTH_ENABLED: booleanString("true"),
  BETA_GOOGLE_CALENDAR_WEBHOOKS_ENABLED: booleanString("true"),
  BETA_GOOGLE_CALENDAR_WRITE_ACTIONS_ENABLED: booleanString("false"),
  BETA_GOOGLE_DRIVE_ENABLED: booleanString("true"),
  BETA_GOOGLE_DRIVE_OAUTH_ENABLED: booleanString("true"),
  BETA_GOOGLE_DRIVE_FULL_ACCESS_ENABLED: booleanString("true"),
  BETA_GOOGLE_DRIVE_PICKER_ENABLED: booleanString("true"),
  BETA_GOOGLE_DRIVE_WEBHOOKS_ENABLED: booleanString("true"),
  BETA_GOOGLE_DRIVE_WRITE_ACTIONS_ENABLED: booleanString("false"),
  BETA_GOOGLE_DRIVE_SHARED_DRIVES_ENABLED: booleanString("true"),
  BETA_SUGGESTIONS_ENABLED: booleanString("true"),
  BETA_DEEP_RESEARCH_ENABLED: booleanString("false"),
  DEEP_RESEARCH_WEB_SEARCH_ENABLED: booleanString("false"),
  DEEP_RESEARCH_MONTHLY_LIMIT: z.coerce.number().int().min(1).max(100).default(20),
  DEEP_RESEARCH_MAX_WEB_QUERIES: z.coerce.number().int().min(1).max(8).default(4),
  DEEP_RESEARCH_MAX_COST_USD: z.coerce.number().positive().default(2),
  BETA_GITHUB_PAGE_ENABLED: booleanString("true"),
  BETA_GITHUB_WRITE_ACTIONS_ENABLED: booleanString("false"),
  BETA_PROFILE_ENABLED: booleanString("true"),
  BETA_WORKSPACE_SETTINGS_ENABLED: booleanString("true"),
  BETA_TEAM_MANAGEMENT_ENABLED: booleanString("true"),
  BETA_INTEGRATION_MANAGEMENT_ENABLED: booleanString("true"),
  VSCODE_CONNECTOR_TOKEN_SECRET: z.string().optional(),
  VSCODE_PAIRING_CODE_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  VSCODE_CONNECTOR_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  VSCODE_CONNECTOR_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(120),
  VSCODE_CONNECTOR_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86400000).default(60000),
  MVP_MODE: booleanString("false"),
  MVP_EQUAL_PROJECT_ACCESS: booleanString("false"),
  DEMO_FIXTURES_ENABLED: booleanString("false"),
  DEMO_FIXTURE_MODE: z.enum(["test", "smoke", "dev_seed"]).optional(),
  MVP_ENABLED_COMMUNICATION_PROVIDERS: communicationProviderList(
    "manual_import,fireflies_ai,slack,clickup,granola,microsoft_teams,zoho_mail,zoho_cliq,zoho_crm,notion"
  ),
  MVP_ENABLE_ADVANCED_CONNECTORS: booleanString("false"),
  MVP_ENABLE_CLIENT_PORTAL: booleanString("true"),
  MVP_ENABLE_AUDIO_TRANSCRIPTION: booleanString("false"),
  MVP_ENABLE_PROJECT_FINANCE: booleanString("false"),
  MVP_ENABLE_PROJECT_SUBSCRIPTIONS: booleanString("false"),
  MVP_ENABLE_CALENDAR_SYNC: booleanString("false"),
  MVP_ENABLE_CALENDLY: booleanString("false"),
  MVP_SIMPLE_CHANGE_APPLY: booleanString("false"),
  MVP_REQUIRE_MANAGER_APPROVAL: booleanString("true"),
  MVP_SHOW_VERSION_HISTORY: booleanString("true"),
  MVP_ENABLE_IMAGE_CONTEXT: booleanString("true"),
  MVP_ENABLE_IMAGE_VISION_SUMMARY: booleanString("false"),
  MVP_IMAGE_CONTEXT_MAX_FILE_SIZE_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(50 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  MVP_CONTEXT_ATTACHMENT_MAX_FILE_SIZE_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(100 * 1024 * 1024)
    .default(25 * 1024 * 1024),
  MVP_IMAGE_CONTEXT_ALLOWED_MIME_TYPES: csvList("image/png,image/jpeg,image/webp"),
  MVP_CONTEXT_ALLOWED_FILE_MIME_TYPES: csvList(
    "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
  ),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),
  PRISMA_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(20).default(3),
  PRISMA_POOL_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(120).default(20),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  QUEUE_MODE: z.enum(["bullmq", "inline", "postgres"]).default("bullmq"),
  QUEUE_PREFIX: z.string().default("orchestra"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  ORCHESTRA_EMBED_WORKER: booleanString("false"),
  JOB_DEFAULT_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  JOB_DEFAULT_BACKOFF_MS: z.coerce.number().int().min(50).max(60_000).default(1_000),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_ROOT: z.string().default("./storage"),
  RAILWAY_VOLUME_MOUNT_PATH: optionalBlankString(z.string()),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  MAX_FILE_SIZE_BYTES: z.coerce.number().int().min(1).max(500 * 1024 * 1024).default(100 * 1024 * 1024),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  AUTH_COOKIE_SECURE: booleanString("true"),
  AUTH_COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("none"),
  SIGNUP_MODE: z.enum(["open", "invite_only", "disabled"]).default("open"),
  SIGNUP_ALLOWED_EMAIL_DOMAINS: z.string().default(""),
  PASSWORD_HASH_COST: z.coerce.number().int().min(8).max(15).default(12),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_GENERATION_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default("gpt-4o-mini-transcribe"),
  SOCRATES_MODEL: z.string().default("gpt-5.4-mini"),
  SOCRATES_ESCALATION_MODEL: z.string().default("gpt-5.5"),
  SOCRATES_ROUTER_MODEL: z.string().default("gpt-5.4-nano"),
  SOCRATES_MODEL_FAST: z.string().default("gpt-5.4-mini"),
  SOCRATES_MODEL_HIGH_QUALITY: z.string().default("gpt-5.5"),
  SOCRATES_MODEL_FALLBACK: z.string().default("gpt-5.5"),
  SOCRATES_CLASSIFIER_MODEL: z.string().default("gpt-5.4-nano"),
  SOCRATES_SUMMARY_MODEL: z.string().default("gpt-5.4-nano"),
  VSCODE_SOCRATES_MODEL: z.string().default("gpt-5.4-mini"),
  SOCRATES_MODEL_STRATEGY: z.enum(["auto", "fast", "high_quality"]).default("auto"),
  SOCRATES_ESCALATE_ON_LOW_CONFIDENCE: booleanString("true"),
  SOCRATES_ESCALATE_ON_MULTI_SOURCE_CONFLICT: booleanString("true"),
  SOCRATES_ESCALATE_ON_ARTIFACT_GENERATION: booleanString("true"),
  SOCRATES_ENABLE_RERANKER: z.enum(["auto", "true", "false"]).default("auto"),
  SOCRATES_ENABLE_MODEL_FALLBACK: z
    .string()
    .default("true")
    .transform((value) => value === "true"),
  SOCRATES_ENABLE_EVIDENCE_ONLY_DEGRADED_MODE: z
    .string()
    .default("true")
    .transform((value) => value === "true"),
  SOCRATES_MODEL_FAST_INPUT_COST_PER_1M: z.coerce.number().min(0).default(0),
  SOCRATES_MODEL_FAST_OUTPUT_COST_PER_1M: z.coerce.number().min(0).default(0),
  SOCRATES_MODEL_HIGH_QUALITY_INPUT_COST_PER_1M: z.coerce.number().min(0).default(0),
  SOCRATES_MODEL_HIGH_QUALITY_OUTPUT_COST_PER_1M: z.coerce.number().min(0).default(0),
  SOCRATES_MODEL_FALLBACK_INPUT_COST_PER_1M: z.coerce.number().min(0).default(0),
  SOCRATES_MODEL_FALLBACK_OUTPUT_COST_PER_1M: z.coerce.number().min(0).default(0),
  SOCRATES_EMBEDDING_COST_PER_1M: z.coerce.number().min(0).default(0),
  SOCRATES_RERANK_COST_PER_1K: z.coerce.number().min(0).default(0),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_REDIRECT_URI: z.string().url().optional(),
  SLACK_APP_CONFIG_TOKEN: z.string().optional(),
  SLACK_APP_CREATE_TEAM_ID: z.string().optional(),
  SLACK_CONNECTOR_ENABLED: booleanString("true"),
  SLACK_WEBHOOKS_ENABLED: booleanString("false"),
  SLACK_BACKFILL_ENABLED: booleanString("true"),
  SLACK_SCOPES: csvList("channels:read,channels:history,groups:read,groups:history"),
  SLACK_OPTIONAL_SCOPES: csvList(""),
  SLACK_SYNC_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(100),
  SLACK_MAX_BACKFILL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  SLACK_INCLUDE_PRIVATE_CHANNELS_DEFAULT: booleanString("false"),
  SLACK_INCLUDE_DMS_DEFAULT: booleanString("false"),
  SLACK_INCLUDE_BOT_MESSAGES_DEFAULT: booleanString("false"),
  SLACK_FILE_INGESTION_ENABLED: booleanString("false"),
  SLACK_WRITE_ACTIONS_ENABLED: booleanString("false"),
  CLICKUP_CLIENT_ID: z.string().optional(),
  CLICKUP_CLIENT_SECRET: z.string().optional(),
  CLICKUP_REDIRECT_URI: z.string().url().optional(),
  CLICKUP_WEBHOOK_SECRET: z.string().optional(),
  CLICKUP_API_BASE_URL: z.string().url().default("https://api.clickup.com/api/v2"),
  CLICKUP_CONNECTOR_ENABLED: booleanString("true"),
  CLICKUP_WEBHOOK_BASE_URL: optionalBlankString(z.string().url()),
  CLICKUP_WEBHOOK_SECRET_STORAGE_MODE: z.enum(["connector_vault", "env_fallback"]).default("connector_vault"),
  CLICKUP_WEBHOOKS_ENABLED: booleanString("true"),
  CLICKUP_BACKFILL_ENABLED: booleanString("true"),
  CLICKUP_SYNC_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(100),
  CLICKUP_MAX_BACKFILL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  CLICKUP_MAX_TASKS_PER_SYNC: z.coerce.number().int().min(1).max(500).default(100),
  CLICKUP_INCLUDE_CLOSED_TASKS_DEFAULT: booleanString("false"),
  CLICKUP_SYNC_TASK_DESCRIPTIONS_DEFAULT: booleanString("true"),
  CLICKUP_SYNC_TASK_COMMENTS_DEFAULT: booleanString("true"),
  CLICKUP_SYNC_STATUS_CHANGES_DEFAULT: booleanString("true"),
  CLICKUP_SYNC_ASSIGNEE_CHANGES_DEFAULT: booleanString("true"),
  CLICKUP_SYNC_DUE_DATE_CHANGES_DEFAULT: booleanString("true"),
  CLICKUP_SYNC_PRIORITY_CHANGES_DEFAULT: booleanString("true"),
  CLICKUP_SYNC_MOVED_EVENTS_DEFAULT: booleanString("true"),
  CLICKUP_ATTACHMENT_INGESTION_ENABLED: booleanString("false"),
  CLICKUP_WRITE_ACTIONS_ENABLED: booleanString("false"),
  CLICKUP_PERSONAL_TOKEN_DIAGNOSTIC_ENABLED: booleanString("false"),
  GRANOLA_CONNECTOR_ENABLED: booleanString("true"),
  GRANOLA_API_BASE_URL: z.string().url().default("https://public-api.granola.ai/v1"),
  GRANOLA_BACKFILL_ENABLED: booleanString("true"),
  GRANOLA_INCREMENTAL_SYNC_ENABLED: booleanString("true"),
  GRANOLA_WEBHOOKS_ENABLED: booleanString("false"),
  GRANOLA_SYNC_BATCH_SIZE: z.coerce.number().int().min(1).max(30).default(10),
  GRANOLA_MAX_BACKFILL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  GRANOLA_MAX_NOTES_PER_SYNC: z.coerce.number().int().min(1).max(500).default(100),
  GRANOLA_INCLUDE_TRANSCRIPT_DEFAULT: booleanString("true"),
  GRANOLA_INCLUDE_SUMMARY_DEFAULT: booleanString("true"),
  GRANOLA_INCLUDE_CALENDAR_EVENT_DEFAULT: booleanString("true"),
  GRANOLA_INCLUDE_ATTENDEES_DEFAULT: booleanString("true"),
  GRANOLA_WRITE_ACTIONS_ENABLED: booleanString("false"),
  GRANOLA_ATTACHMENT_INGESTION_ENABLED: booleanString("false"),
  ZOHO_CLIENT_ID: z.string().optional(),
  ZOHO_CLIENT_SECRET: z.string().optional(),
  ZOHO_REDIRECT_URI: z.string().url().optional(),
  ZOHO_ACCOUNTS_SERVER: z.string().url().default("https://accounts.zoho.com"),
  ZOHO_SCOPES: csvList(""),
  ZOHO_WRITE_ACTIONS_ENABLED: booleanString("false"),
  ZOHO_OAUTH_STATE_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  ZOHO_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  ZOHO_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  ZOHO_MAIL_CONNECTOR_ENABLED: booleanString("true"),
  ZOHO_MAIL_BACKFILL_ENABLED: booleanString("true"),
  ZOHO_MAIL_INCREMENTAL_SYNC_ENABLED: booleanString("true"),
  ZOHO_MAIL_WEBHOOKS_ENABLED: booleanString("false"),
  ZOHO_MAIL_WRITE_ACTIONS_ENABLED: booleanString("false"),
  ZOHO_MAIL_ATTACHMENT_INGESTION_ENABLED: booleanString("false"),
  ZOHO_MAIL_API_BASE_URL: optionalBlankString(z.string().url()),
  ZOHO_MAIL_SCOPES: csvList("ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ"),
  ZOHO_MAIL_SYNC_MAX_BACKFILL_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  ZOHO_MAIL_SYNC_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(50),
  ZOHO_MAIL_MAX_MESSAGES_PER_SYNC: z.coerce.number().int().min(1).max(2000).default(500),
  ZOHO_MAIL_DEFAULT_FOLDER_SCOPE: z.enum(["inbox", "selected_only"]).default("inbox"),
  ZOHO_MAIL_INCLUDE_SPAM: booleanString("false"),
  ZOHO_MAIL_INCLUDE_TRASH: booleanString("false"),
  ZOHO_CLIQ_CONNECTOR_ENABLED: booleanString("true"),
  ZOHO_CLIQ_BACKFILL_ENABLED: booleanString("true"),
  ZOHO_CLIQ_INCREMENTAL_SYNC_ENABLED: booleanString("true"),
  ZOHO_CLIQ_WEBHOOKS_ENABLED: booleanString("false"),
  ZOHO_CLIQ_WRITE_ACTIONS_ENABLED: booleanString("false"),
  ZOHO_CLIQ_API_BASE_URL: optionalBlankString(z.string().url()),
  ZOHO_CLIQ_SCOPES: csvList("ZohoCliq.Channels.READ,ZohoCliq.Chats.READ,ZohoCliq.Messages.READ"),
  ZOHO_CLIQ_SYNC_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(50),
  ZOHO_CLIQ_MAX_MESSAGES_PER_SYNC: z.coerce.number().int().min(1).max(2000).default(500),
  ZOHO_CLIQ_DEFAULT_CHANNEL_SCOPE: z.enum(["selected_only"]).default("selected_only"),
  ZOHO_CRM_CONNECTOR_ENABLED: booleanString("true"),
  ZOHO_CRM_BACKFILL_ENABLED: booleanString("true"),
  ZOHO_CRM_INCREMENTAL_SYNC_ENABLED: booleanString("true"),
  ZOHO_CRM_WEBHOOKS_ENABLED: booleanString("false"),
  ZOHO_CRM_WRITE_ACTIONS_ENABLED: booleanString("false"),
  ZOHO_CRM_API_BASE_URL: optionalBlankString(z.string().url()),
  ZOHO_CRM_SCOPES: csvList("ZohoCRM.modules.READ,ZohoCRM.settings.modules.READ,ZohoCRM.settings.fields.READ"),
  ZOHO_CRM_SELECTED_MODULES: z.string().default("Leads,Accounts,Contacts,Deals,Tasks,Events,Calls,Notes,Cases"),
  ZOHO_CRM_SYNC_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  ZOHO_CRM_MAX_RECORDS_PER_SYNC: z.coerce.number().int().min(1).max(5000).default(1000),
  ZOHO_CRM_FIELD_ALLOWLIST: z.string().default(""),
  ZOHO_CRM_INCLUDE_CUSTOM_MODULES: booleanString("false"),
  NOTION_CONNECTOR_ENABLED: booleanString("true"),
  NOTION_WRITE_ACTIONS_ENABLED: booleanString("false"),
  NOTION_INTERNAL_TOKEN_MODE_ENABLED: booleanString("false"),
  NOTION_OAUTH_ENABLED: booleanString("true"),
  NOTION_SELECTED_RESOURCE_MODE: booleanString("true"),
  NOTION_CLIENT_ID: z.string().optional(),
  NOTION_CLIENT_SECRET: z.string().optional(),
  NOTION_REDIRECT_URI: z.string().url().optional(),
  NOTION_AUTH_URL: z.string().url().default("https://api.notion.com/v1/oauth/authorize"),
  NOTION_API_VERSION: z.string().default("2022-06-28"),
  NOTION_INTERNAL_INTEGRATION_TOKEN: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_CALENDAR_CLIENT_ID: z.string().optional(),
  GOOGLE_CALENDAR_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALENDAR_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_CALENDAR_WEBHOOK_URL: optionalBlankString(z.string().url()),
  GOOGLE_CALENDAR_WEBHOOK_TOKEN_SECRET: z.string().optional(),
  GOOGLE_CALENDAR_SCOPES: csvList(
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly,https://www.googleapis.com/auth/calendar.events.readonly,https://www.googleapis.com/auth/userinfo.email"
  ),
  GOOGLE_CALENDAR_SYNC_MAX_BACKFILL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  GOOGLE_CALENDAR_SYNC_PAGE_SIZE: z.coerce.number().int().min(1).max(250).default(250),
  GOOGLE_CALENDAR_WATCH_TTL_SECONDS: z.coerce.number().int().min(3600).max(604800).default(604800),
  GOOGLE_CALENDAR_CONNECTOR_ENABLED: booleanString("true"),
  GOOGLE_CALENDAR_BACKFILL_ENABLED: booleanString("true"),
  GOOGLE_CALENDAR_INCREMENTAL_SYNC_ENABLED: booleanString("true"),
  GOOGLE_DRIVE_CONNECTOR_ENABLED: booleanString("true"),
  GOOGLE_DRIVE_CLIENT_ID: z.string().optional(),
  GOOGLE_DRIVE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_DRIVE_REDIRECT_URI: z.string().url().optional(),
  GOOGLE_DRIVE_WEBHOOK_URL: optionalBlankString(z.string().url()),
  GOOGLE_DRIVE_WEBHOOK_TOKEN_SECRET: z.string().optional(),
  GOOGLE_DRIVE_SCOPES: csvList(
    "https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/drive.metadata.readonly"
  ),
  GOOGLE_DRIVE_ACCESS_MODE: z.enum(["full_drive", "selected_files"]).default("full_drive"),
  GOOGLE_DRIVE_REQUIRE_SYNC_ROOTS: booleanString("true"),
  GOOGLE_DRIVE_SYNC_MAX_BACKFILL_DAYS: z.coerce.number().int().min(1).max(365).default(180),
  GOOGLE_DRIVE_SYNC_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(100),
  GOOGLE_DRIVE_MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(100).default(25),
  GOOGLE_DRIVE_ALLOWED_MIME_TYPES: csvList(
    "application/vnd.google-apps.document,application/vnd.google-apps.presentation,application/vnd.google-apps.spreadsheet,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ),
  GOOGLE_DRIVE_INCLUDE_SHARED_DRIVES: booleanString("true"),
  GOOGLE_DRIVE_INCREMENTAL_SYNC_ENABLED: booleanString("true"),
  GOOGLE_DRIVE_WEBHOOKS_ENABLED: booleanString("true"),
  GOOGLE_DRIVE_BACKFILL_ENABLED: booleanString("true"),
  GOOGLE_DRIVE_FULL_SYNC_MAX_FILES: z.coerce.number().int().min(1).max(2000).default(500),
  GOOGLE_DRIVE_INCREMENTAL_SYNC_MAX_FILES: z.coerce.number().int().min(1).max(1000).default(200),
  GOOGLE_DRIVE_EXPORT_GOOGLE_DOCS_AS: z.string().default("text/plain"),
  GOOGLE_DRIVE_EXPORT_GOOGLE_SLIDES_AS: z.string().default("text/plain"),
  GOOGLE_DRIVE_EXPORT_GOOGLE_SHEETS_AS: z.string().default("text/csv"),
  GOOGLE_PUBSUB_TOPIC: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_REDIRECT_URI: z.string().url().optional(),
  MICROSOFT_TENANT_ID: z.string().default("common"),
  MICROSOFT_GRAPH_SCOPES: csvListPreserveCase(
    "openid,profile,offline_access,User.Read,Team.ReadBasic.All,Channel.ReadBasic.All,ChannelMessage.Read.All,Chat.Read"
  ),
  MICROSOFT_GRAPH_BASE_URL: z.string().url().default("https://graph.microsoft.com/v1.0"),
  MICROSOFT_TEAMS_CONNECTOR_ENABLED: booleanString("true"),
  MICROSOFT_TEAMS_SELECTED_RESOURCE_MODE: booleanString("true"),
  MICROSOFT_TEAMS_WRITE_ACTIONS_ENABLED: booleanString("false"),
  MICROSOFT_TEAMS_BACKFILL_ENABLED: booleanString("true"),
  MICROSOFT_TEAMS_INCREMENTAL_SYNC_ENABLED: booleanString("true"),
  MICROSOFT_TEAMS_WEBHOOKS_ENABLED: booleanString("false"),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_READINESS_MODE: z.enum(["disabled", "webhook_inbound"]).default("disabled"),
  FIREFLIES_READINESS_MODE: z
    .enum(["disabled", "manual_only", "api", "webhook", "api_and_webhook"])
    .default("manual_only"),
  FIREFLIES_API_BASE_URL: z.string().url().default("https://api.fireflies.ai/graphql"),
  FIREFLIES_API_KEY: z.string().optional(),
  FIREFLIES_WEBHOOK_SECRET: z.string().optional(),
  FIREFLIES_BACKFILL_ENABLED: booleanString("true"),
  FIREFLIES_WEBHOOKS_ENABLED: booleanString("false"),
  FIREFLIES_WRITE_ACTIONS_ENABLED: booleanString("false"),
  FIREFLIES_SYNC_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(50),
  FIREFLIES_SYNC_MAX_BACKFILL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  FIREFLIES_SYNC_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  FIREFLIES_ALLOW_RECORDING_URLS: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  FIREFLIES_ALLOW_TRANSCRIPT_PROVIDER_URLS: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  FIREFLIES_SMOKE_BASE_URL: optionalBlankString(z.string().url()),
  FIREFLIES_SMOKE_MANAGER_EMAIL: optionalBlankString(z.string().email()),
  FIREFLIES_SMOKE_MANAGER_PASSWORD: optionalBlankString(z.string()),
  FIREFLIES_SMOKE_PROJECT_ID: optionalBlankString(z.string().uuid()),
  FIREFLIES_SMOKE_TRANSCRIPT_ID: optionalBlankString(z.string()),
  FIREFLIES_SMOKE_EXPECT_LIVE_API: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  FIREFLIES_SMOKE_EXPECT_WEBHOOK: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  FIREFLIES_SMOKE_KEEP_DATA: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  CONNECTOR_CREDENTIAL_VAULT_MODE: z.enum(["memory", "encrypted_file", "managed_reference"]).default("encrypted_file"),
  CONNECTOR_MANAGED_SECRET_PROVIDER: z.enum(["external_reference"]).default("external_reference"),
  CONNECTOR_MANAGED_SECRET_PREFIX: z.string().min(1).default("orchestra/"),
  CONNECTOR_OAUTH_STATE_SECRET: z.string().min(16).default("change_me_connector_state_secret"),
  CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: z.string().min(16).default("change_me_connector_credential_encryption_key"),
  CONNECTOR_SYNC_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  CONNECTOR_SYNC_MAX_BACKFILL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  CONNECTOR_LEASE_TTL_SECONDS: z.coerce.number().int().min(15).max(900).default(90),
  CONNECTOR_LEASE_HEARTBEAT_SECONDS: z.coerce.number().int().min(5).max(300).default(20),
  RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(8),
  RETRIEVAL_MIN_SCORE: z.coerce.number().default(0.2),
  RETRIEVAL_USE_HYBRID: z
    .string()
    .default("true")
    .transform((value) => value === "true"),
  RETRIEVAL_DOC_WEIGHT: z.coerce.number().default(1),
  RETRIEVAL_COMM_WEIGHT: z.coerce.number().default(0.8),
  RETRIEVAL_ACCEPTED_TRUTH_BOOST: z.coerce.number().default(1.2),
  RERANK_PROVIDER: z.enum(["none", "deterministic", "openai", "llm"]).default("deterministic"),
  RERANK_MAX_CANDIDATES: z.coerce.number().int().min(1).max(100).default(32),
  RERANK_TOP_K: z.coerce.number().int().min(1).max(25).default(8),
  RERANK_MIN_SCORE: z.coerce.number().min(0).max(1).default(0),
  LLM_RERANK_MAX_CANDIDATES: z.coerce.number().int().min(1).max(50).default(12),
  LLM_RERANK_ENABLED_FOR_INTENTS: z.string().default("no_evidence_or_ambiguous,comparison_or_diff,explain_for_role"),
  RERANK_FAIL_OPEN_TO_DETERMINISTIC: z
    .string()
    .default("true")
    .transform((value) => value === "true"),
  SOCRATES_RERANK_PROVIDER: z.enum(["none", "deterministic", "openai", "llm"]).default("deterministic"),
  SOCRATES_RERANK_MODEL: z.string().default("gpt-5.4-nano"),
  SOCRATES_RERANK_MIN_CANDIDATES: z.coerce.number().int().min(1).max(100).default(4),
  SOCRATES_RERANK_MAX_CANDIDATES: z.coerce.number().int().min(1).max(100).default(32),
  SOCRATES_RERANK_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
  SOCRATES_RERANK_MAX_COST_PER_QUERY: z.coerce.number().min(0).default(0),
  SOCRATES_MAX_CONTEXT_TOKENS: z.coerce.number().int().min(1000).max(100000).default(12000),
  SOCRATES_MAX_HISTORY_TURNS: z.coerce.number().int().min(0).max(50).default(8),
  SOCRATES_RETRIEVAL_TOP_K: z.coerce.number().int().min(1).max(100).default(32),
  SOCRATES_RERANK_TOP_K: z.coerce.number().int().min(1).max(25).default(8),
  SOCRATES_MAX_RETRIEVAL_CANDIDATES: z.coerce.number().int().min(1).max(250).default(64),
  SOCRATES_MAX_RERANK_CANDIDATES: z.coerce.number().int().min(1).max(100).default(32),
  SOCRATES_MAX_EVIDENCE_ITEMS: z.coerce.number().int().min(1).max(25).default(10),
  SOCRATES_MAX_EVIDENCE_EXCERPT_CHARS: z.coerce.number().int().min(120).max(2000).default(900),
  SOCRATES_MAX_SAME_SOURCE_ITEMS: z.coerce.number().int().min(1).max(10).default(2),
  SOCRATES_DASHBOARD_EVIDENCE_LIMIT: z.coerce.number().int().min(1).max(10).default(5),
  SOCRATES_CURRENT_TRUTH_EVIDENCE_LIMIT: z.coerce.number().int().min(1).max(12).default(8),
  SOCRATES_PROVENANCE_EVIDENCE_LIMIT: z.coerce.number().int().min(1).max(15).default(10),
  SOCRATES_HISTORY_EVIDENCE_LIMIT: z.coerce.number().int().min(1).max(15).default(12),
  SOCRATES_DIFF_EVIDENCE_LIMIT: z.coerce.number().int().min(1).max(15).default(12),
  SOCRATES_MAX_CITATIONS: z.coerce.number().int().min(1).max(20).default(6),
  SOCRATES_MAX_OPEN_TARGETS: z.coerce.number().int().min(0).max(20).default(6),
  SOCRATES_MAX_SAME_SOURCE_CITATIONS: z.coerce.number().int().min(1).max(10).default(2),
  SOCRATES_MAX_REPAIR_ATTEMPTS: z.coerce.number().int().min(0).max(3).default(1),
  SOCRATES_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(8000).default(1800),
  SOCRATES_MAX_ANSWER_CHARS: z.coerce.number().int().min(256).max(50000).default(8000),
  SOCRATES_GENERATION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(120000),
  SOCRATES_RETRIEVAL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  SOCRATES_MAX_REQUESTS_PER_USER_PER_WINDOW: z.coerce.number().int().min(1).max(10000).default(120),
  SOCRATES_MAX_REQUESTS_PER_PROJECT_PER_WINDOW: z.coerce.number().int().min(1).max(100000).default(1000),
  SOCRATES_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86400000).default(60000),
  SOCRATES_MAX_CONCURRENT_STREAMS_PER_USER: z.coerce.number().int().min(1).max(100).default(3),
  SOCRATES_MAX_CONCURRENT_STREAMS_PER_PROJECT: z.coerce.number().int().min(1).max(500).default(20),
  SOCRATES_MAX_CLASSIFICATION_JOBS_PER_PROJECT: z.coerce.number().int().min(1).max(10000).default(500),
  SOCRATES_MAX_DAILY_COST_PER_PROJECT: z.coerce.number().min(0).default(2),
  SOCRATES_MAX_DAILY_COST_PER_USER: z.coerce.number().min(0).default(0.5),
  GITHUB_APP_ID: optionalBlankString(z.string().min(1)),
  GITHUB_APP_PRIVATE_KEY: optionalBlankString(z.string().min(1)),
  GITHUB_APP_CLIENT_ID: optionalBlankString(z.string().min(1)),
  GITHUB_APP_CLIENT_SECRET: optionalBlankString(z.string().min(1)),
  GITHUB_APP_WEBHOOK_SECRET: optionalBlankString(z.string().min(1)),
  GITHUB_APP_CALLBACK_URL: optionalBlankString(z.string().url()),
  GITHUB_APP_SETUP_URL: optionalBlankString(z.string().url()),
  GITHUB_INTEGRATION_ENABLED: booleanString("false"),
  GITHUB_WEBHOOKS_ENABLED: booleanString("false"),
  GITHUB_BACKFILL_ENABLED: booleanString("false"),
  GITHUB_USER_LINKING_ENABLED: booleanString("false"),
  GITHUB_CONTENT_SCAN_ENABLED: booleanString("false"),
  GITHUB_READ_ONLY_MODE: booleanString("true"),
  GITHUB_WRITE_ACTIONS_ENABLED: booleanString("false"),
  GITHUB_SYNC_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(50),
  GITHUB_SYNC_MAX_REPOS_PER_INSTALLATION: z.coerce.number().int().min(1).max(1000).default(100),
  GITHUB_SYNC_MAX_PR_BACKFILL: z.coerce.number().int().min(1).max(1000).default(100),
  GITHUB_SYNC_MAX_COMMIT_BACKFILL: z.coerce.number().int().min(1).max(5000).default(500),
  GITHUB_WEBHOOK_MAX_PAYLOAD_BYTES: z.coerce.number().int().min(1024).max(10 * 1024 * 1024).default(1024 * 1024),
  GITHUB_ALLOWED_REPO_OWNER_ALLOWLIST: z.string().default(""),
  ENGINEERING_EVIDENCE_ENABLED: booleanString("true"),
  ENGINEERING_EVIDENCE_CONTENT_SCAN_ENABLED: booleanString("false"),
  ENGINEERING_EVIDENCE_SCAN_PATH_ALLOWLIST: z.string().default(""),
  ENGINEERING_EVIDENCE_MAX_EXCERPT_CHARS: z.coerce.number().int().min(120).max(4000).default(800),
  FDE_READINESS_INTELLIGENCE_ENABLED: booleanString("true"),
  FDE_READINESS_SEMANTIC_MATCHING_ENABLED: booleanString("false"),
  FDE_READINESS_MAX_EVIDENCE_ITEMS: z.coerce.number().int().min(25).max(2000).default(500),
  MCP_ENABLED: booleanString("false"),
  MCP_MODE: z.enum(["local_dev", "team_internal", "client_safe_future"]).default("local_dev"),
  MCP_ALLOW_CONTROLLED_WRITES: booleanString("false"),
  FEATURE_AGENT_FILES_GITHUB_SYNC_ENABLED: booleanString("false"),
  FEATURE_AGENT_FILES_GITHUB_PR_SYNC_ENABLED: booleanString("false"),
  FEATURE_AGENT_FILES_GITHUB_BRANCH_SYNC_ENABLED: booleanString("false"),
  FEATURE_AGENT_FILES_QUALITY_ENABLED: booleanString("true"),
  FEATURE_AGENT_FILES_DRIFT_ENABLED: booleanString("true"),
  FEATURE_AGENT_FILES_MCP_READ_ENABLED: booleanString("true"),
  FEATURE_AGENT_FILES_MCP_REFRESH_ENABLED: booleanString("false"),
  MVP_ENABLE_AGENT_FILES_GITHUB_PR_SYNC: booleanString("false"),
  MVP_ENABLE_AGENT_FILES_GITHUB_BRANCH_SYNC: booleanString("false"),
  MVP_ENABLE_AGENT_FILES_ADVANCED_SYNC: booleanString("false"),
  MVP_ENABLE_GITHUB_INTEGRATION: booleanString("true"),
  MVP_GITHUB_READ_ONLY: booleanString("true"),
  MVP_GITHUB_WRITE_ACTIONS_ENABLED: booleanString("false"),
  MVP_GITHUB_CONTENT_SCAN_ENABLED: booleanString("false"),
  MVP_GITHUB_PR_AUTOMATION_ENABLED: booleanString("false"),
  MCP_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100000).default(120),
  MCP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86400000).default(60000),
  METRICS_TOKEN: z.string().optional(),
  CLIENT_SHARE_TOKEN_SECRET: z.string().min(16).default("change_me_client_share_secret")
}).superRefine((value, context) => {
  const deploymentEnv = value.DEPLOYMENT_ENV ?? value.NODE_ENV;
  const desktop = value.RUNTIME_PROFILE === "desktop-local";
  const selfHosted = value.RUNTIME_PROFILE === "self-hosted";
  const isProductionLikeDeployment = !desktop && (deploymentEnv === "staging" || deploymentEnv === "production");
  const isProductionDeployment = !desktop && deploymentEnv === "production";
  if (desktop) {
    const fail = (field:string,message:string) => context.addIssue({code:z.ZodIssueCode.custom,path:[field],message});
    try { const url=new URL(value.DATABASE_URL); if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))fail('DATABASE_URL','Desktop database must be local PostgreSQL'); }
    catch { fail('DATABASE_URL','Invalid desktop database URL'); }
    if(!['127.0.0.1','::1'].includes(value.HOST))fail('HOST','Desktop must bind loopback');
    if(value.QUEUE_MODE!=='postgres'||value.REDIS_URL)fail('QUEUE_MODE','Desktop requires PostgreSQL jobs without Redis');
    if(value.STORAGE_DRIVER!=='local'||!path.isAbsolute(value.STORAGE_LOCAL_ROOT))fail('STORAGE_LOCAL_ROOT','Desktop requires private absolute local storage');
    if(value.MVP_BETA_FREE_TIER_MODE||value.DEMO_FIXTURES_ENABLED)fail('RUNTIME_PROFILE','Desktop cannot reuse hosted bypasses or demo fixtures');
    for(const field of ['JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','CLIENT_SHARE_TOKEN_SECRET','CONNECTOR_CREDENTIAL_ENCRYPTION_KEY','CONNECTOR_OAUTH_STATE_SECRET'] as const)
      if(isWeakProductionSecret(value[field]))fail(field,'Desktop requires an installation-specific secret');
    if(new Set([value.JWT_ACCESS_SECRET,value.JWT_REFRESH_SECRET,value.CLIENT_SHARE_TOKEN_SECRET,value.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY,value.CONNECTOR_OAUTH_STATE_SECRET]).size!==5)fail('RUNTIME_PROFILE','Desktop secrets must be distinct');
    for(const origin of [value.APP_BASE_URL,...value.CORS_ALLOWED_ORIGINS.split(',')]) {
      try { if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin.trim()).hostname))fail('CORS_ALLOWED_ORIGINS','Desktop origins must be loopback'); } catch { fail('CORS_ALLOWED_ORIGINS','Invalid desktop origin'); }
    }
  } else if(value.QUEUE_MODE==='postgres') context.addIssue({code:z.ZodIssueCode.custom,path:['QUEUE_MODE'],message:'PostgreSQL queue requires explicit desktop-local profile'});
  if(selfHosted){
    const fail=(field:string,message:string)=>context.addIssue({code:z.ZodIssueCode.custom,path:[field],message});
    if(!value.DESKTOP_SHARED_SERVER_ID)fail('DESKTOP_SHARED_SERVER_ID','Self-hosting requires a persistent, installation-specific server UUID');
    const root=value.SELF_HOST_DATA_ROOT;
    if(!root||!path.isAbsolute(root)||path.resolve(root)===path.parse(root).root)fail('SELF_HOST_DATA_ROOT','Declare a dedicated persistent self-hosting data directory, not the filesystem root');
    if(!isPathInside(root,value.STORAGE_LOCAL_ROOT)||value.STORAGE_DRIVER!=='local')fail('STORAGE_LOCAL_ROOT','This self-hosting version requires private local storage inside the declared persistent data directory');
    if(value.CONNECTOR_CREDENTIAL_VAULT_MODE!=='encrypted_file')fail('CONNECTOR_CREDENTIAL_VAULT_MODE','Self-hosting requires its operator-owned encrypted credential vault');
    if(value.QUEUE_MODE!=='bullmq'||!value.REDIS_URL)fail('QUEUE_MODE','Self-hosting requires the durable server worker and Redis queue');
    if(value.MVP_BETA_FREE_TIER_MODE)fail('MVP_BETA_FREE_TIER_MODE','Self-hosting cannot use a managed free-tier bypass');
    if(isProductionLikeDeployment){
      for(const origin of [value.APP_BASE_URL,value.FRONTEND_BASE_URL,...value.CORS_ALLOWED_ORIGINS.split(',')].filter(Boolean)){
        try{const url=new URL(origin!.trim());if(url.protocol!=='https:'||url.username||url.password)fail('APP_BASE_URL','Shared production origins require HTTPS without URL credentials');}catch{fail('APP_BASE_URL','Invalid shared production origin');}
      }
    }
  }
  const isFreeTierBetaProduction =
    isProductionDeployment &&
    value.MVP_BETA_FREE_TIER_MODE &&
    value.MVP_BETA_MODE &&
    value.ORCHESTRA_PROFILE === "mvp_beta";
  const hasPersistentVolumeStorage = isPathInside(
    value.RAILWAY_VOLUME_MOUNT_PATH,
    value.STORAGE_LOCAL_ROOT
  );

  if (
    value.MVP_BETA_FREE_TIER_MODE &&
    (!isProductionDeployment || !value.MVP_BETA_MODE || value.ORCHESTRA_PROFILE !== "mvp_beta")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["MVP_BETA_FREE_TIER_MODE"],
      message: "MVP_BETA_FREE_TIER_MODE is restricted to the explicit mvp_beta production profile"
    });
  }

  if (value.STORAGE_DRIVER === "s3") {
    for (const field of ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
      if (!value[field]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required when STORAGE_DRIVER=s3`
        });
      }
    }
  }

  if (isProductionLikeDeployment && isWeakProductionSecret(value.API_PROXY_SHARED_SECRET)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["API_PROXY_SHARED_SECRET"],
      message: "Staging and production require a strong API_PROXY_SHARED_SECRET for trusted proxy rate-limit identity"
    });
  }

  if (value.QUEUE_MODE === "bullmq" && !value.REDIS_URL) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["REDIS_URL"],
      message: "REDIS_URL is required when QUEUE_MODE=bullmq"
    });
  }

  if (["api", "api_and_webhook"].includes(value.FIREFLIES_READINESS_MODE) && !value.FIREFLIES_API_KEY) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["FIREFLIES_API_KEY"],
      message: "FIREFLIES_API_KEY is required when Fireflies API sync is enabled"
    });
  }

  if (isProductionLikeDeployment && ["api", "api_and_webhook"].includes(value.FIREFLIES_READINESS_MODE)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["FIREFLIES_READINESS_MODE"],
      message: "Staging and production forbid a tenant-shared Fireflies API key; use webhook or manual_only mode"
    });
  }

  if (isProductionLikeDeployment && (value.NOTION_INTERNAL_TOKEN_MODE_ENABLED || value.NOTION_INTERNAL_INTEGRATION_TOKEN)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["NOTION_INTERNAL_TOKEN_MODE_ENABLED"],
      message: "Staging and production forbid a tenant-shared Notion internal token; use per-workspace OAuth"
    });
  }

  if (["webhook", "api_and_webhook"].includes(value.FIREFLIES_READINESS_MODE) && !value.FIREFLIES_WEBHOOK_SECRET) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["FIREFLIES_WEBHOOK_SECRET"],
      message: "FIREFLIES_WEBHOOK_SECRET is required when Fireflies webhooks are enabled"
    });
  }

  if (value.GITHUB_WRITE_ACTIONS_ENABLED || value.MVP_GITHUB_WRITE_ACTIONS_ENABLED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["GITHUB_WRITE_ACTIONS_ENABLED"],
      message: "Feature 13 Part 1 is read-only; GitHub write actions must remain disabled"
    });
  }

  if (value.BETA_GITHUB_WRITE_ACTIONS_ENABLED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BETA_GITHUB_WRITE_ACTIONS_ENABLED"],
      message: "Private-pilot GitHub surfaces must remain read-only"
    });
  }

  if (value.BETA_GOOGLE_CALENDAR_WRITE_ACTIONS_ENABLED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BETA_GOOGLE_CALENDAR_WRITE_ACTIONS_ENABLED"],
      message: "Private-pilot Google Calendar integration is read-only; write actions must remain disabled"
    });
  }

  if (value.BETA_GOOGLE_DRIVE_WRITE_ACTIONS_ENABLED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["BETA_GOOGLE_DRIVE_WRITE_ACTIONS_ENABLED"],
      message: "Private-pilot Google Drive integration is read-only; write actions must remain disabled"
    });
  }

  if (value.CLICKUP_WRITE_ACTIONS_ENABLED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CLICKUP_WRITE_ACTIONS_ENABLED"],
      message: "ClickUp starts read-only; write actions must remain disabled"
    });
  }

  if (value.GRANOLA_WRITE_ACTIONS_ENABLED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["GRANOLA_WRITE_ACTIONS_ENABLED"],
      message: "Granola is read-first evidence only; write actions must remain disabled"
    });
  }

  if (
    value.ZOHO_WRITE_ACTIONS_ENABLED ||
    value.ZOHO_MAIL_WRITE_ACTIONS_ENABLED ||
    value.ZOHO_CLIQ_WRITE_ACTIONS_ENABLED ||
    value.ZOHO_CRM_WRITE_ACTIONS_ENABLED
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ZOHO_WRITE_ACTIONS_ENABLED"],
      message: "Zoho Step 1 is read-only; all Zoho write actions must remain disabled"
    });
  }

  if (value.NOTION_WRITE_ACTIONS_ENABLED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["NOTION_WRITE_ACTIONS_ENABLED"],
      message: "Notion selected sync is read-only; write actions must remain disabled"
    });
  }

  if (value.MICROSOFT_TEAMS_WRITE_ACTIONS_ENABLED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["MICROSOFT_TEAMS_WRITE_ACTIONS_ENABLED"],
      message: "Microsoft Teams Step 1 is read-only; write actions must remain disabled"
    });
  }

  if (value.FIREFLIES_WRITE_ACTIONS_ENABLED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["FIREFLIES_WRITE_ACTIONS_ENABLED"],
      message: "Fireflies is read-first meeting evidence only; write actions must remain disabled"
    });
  }

  if (!value.GITHUB_READ_ONLY_MODE || !value.MVP_GITHUB_READ_ONLY) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["GITHUB_READ_ONLY_MODE"],
      message: "Feature 13 Part 1 requires GitHub read-only mode"
    });
  }

  if (value.GITHUB_CONTENT_SCAN_ENABLED || value.MVP_GITHUB_CONTENT_SCAN_ENABLED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["GITHUB_CONTENT_SCAN_ENABLED"],
      message: "Repository content scanning is out of scope for Feature 13 Part 1 and must remain disabled"
    });
  }

  if (value.MVP_GITHUB_PR_AUTOMATION_ENABLED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["MVP_GITHUB_PR_AUTOMATION_ENABLED"],
      message: "MVP GitHub PR automation is out of scope for Feature 13 Part 1 and must remain disabled"
    });
  }

  if (value.MVP_MODE && value.FDE_READINESS_SEMANTIC_MATCHING_ENABLED) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["FDE_READINESS_SEMANTIC_MATCHING_ENABLED"],
      message: "MVP FDE readiness intelligence is deterministic/read-first; semantic matching must remain disabled"
    });
  }

  if (value.GITHUB_WEBHOOKS_ENABLED && !value.GITHUB_APP_WEBHOOK_SECRET) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["GITHUB_APP_WEBHOOK_SECRET"],
      message: "GITHUB_APP_WEBHOOK_SECRET is required when GitHub webhooks are enabled"
    });
  }

  if (value.GITHUB_USER_LINKING_ENABLED) {
    for (const field of ["GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_CALLBACK_URL"] as const) {
      if (!value[field]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required when GitHub user linking is enabled`
        });
      }
    }
  }

  if (value.DEMO_FIXTURES_ENABLED) {
    if (!value.DEMO_FIXTURE_MODE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DEMO_FIXTURE_MODE"],
        message: "DEMO_FIXTURE_MODE is required when demo fixtures are enabled"
      });
    }
    if (isProductionLikeDeployment) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DEMO_FIXTURES_ENABLED"],
        message: "Demo fixtures are blocked in staging/production; use real provider data or a separate local/test seed"
      });
    }
  }

  if (isProductionDeployment && value.QUEUE_MODE === "inline") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["QUEUE_MODE"],
      message: "Production must use QUEUE_MODE=bullmq so heavy connector, parsing, and AI jobs do not run inline"
    });
  }

  const providerGroups = [
    {
      name: "Slack",
      fields: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_REDIRECT_URI"] as const
    },
    {
      name: "ClickUp",
      fields: ["CLICKUP_CLIENT_ID", "CLICKUP_CLIENT_SECRET", "CLICKUP_REDIRECT_URI"] as const
    },
    {
      name: "Google",
      fields: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"] as const
    },
    {
      name: "Google Calendar",
      fields: [
        "GOOGLE_CALENDAR_CLIENT_ID",
        "GOOGLE_CALENDAR_CLIENT_SECRET",
        "GOOGLE_CALENDAR_REDIRECT_URI"
      ] as const
    },
    {
      name: "Google Drive",
      fields: ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REDIRECT_URI"] as const
    },
    {
      name: "Zoho",
      fields: ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REDIRECT_URI"] as const
    },
    {
      name: "Notion",
      fields: ["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET", "NOTION_REDIRECT_URI"] as const
    },
    {
      name: "Microsoft",
      fields: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_REDIRECT_URI"] as const
    }
  ];

  for (const group of providerGroups) {
    const provided = group.fields.filter((field) => Boolean(value[field]));
    if (provided.length > 0 && provided.length !== group.fields.length) {
      for (const field of group.fields) {
        if (!value[field]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required when configuring ${group.name} OAuth`
          });
        }
      }
    }
  }

  if (value.AUTH_COOKIE_SAME_SITE === "none" && !value.AUTH_COOKIE_SECURE) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AUTH_COOKIE_SECURE"],
      message: "AUTH_COOKIE_SECURE must be true when AUTH_COOKIE_SAME_SITE=none"
    });
  }

  if (isProductionLikeDeployment) {
    if (!value.AUTH_COOKIE_SECURE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_COOKIE_SECURE"],
        message: "Production and staging require Secure authentication cookies"
      });
    }
    if (value.SIGNUP_MODE === "open") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SIGNUP_MODE"],
        message: "Production requires SIGNUP_MODE=invite_only or SIGNUP_MODE=disabled"
      });
    }

    if (value.SIGNUP_MODE === "invite_only" && value.SIGNUP_ALLOWED_EMAIL_DOMAINS.trim().length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SIGNUP_ALLOWED_EMAIL_DOMAINS"],
        message: "SIGNUP_ALLOWED_EMAIL_DOMAINS is required when SIGNUP_MODE=invite_only"
      });
    }

    if (!value.CLIENT_PORTAL_BASE_URL && !value.FRONTEND_BASE_URL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CLIENT_PORTAL_BASE_URL"],
        message: "Production requires CLIENT_PORTAL_BASE_URL or FRONTEND_BASE_URL so client share links do not point at the API host"
      });
    }

    if (!value.SECURITY_HEADERS_ENABLED) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SECURITY_HEADERS_ENABLED"],
        message: "Production requires SECURITY_HEADERS_ENABLED=true"
      });
    }

    if (!value.RATE_LIMIT_ENABLED) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RATE_LIMIT_ENABLED"],
        message: "Production requires RATE_LIMIT_ENABLED=true"
      });
    }

    const corsOrigins = value.CORS_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim());
    if (corsOrigins.some((origin) => origin === "*" || origin.includes("*"))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CORS_ALLOWED_ORIGINS"],
        message: "Production CORS origins must be explicit and cannot include wildcards"
      });
    }

    if (value.MCP_ENABLED && value.MCP_MODE === "client_safe_future") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MCP_MODE"],
        message: "MVP does not support client-facing MCP; use local_dev or team_internal"
      });
    }

    if (value.GITHUB_INTEGRATION_ENABLED) {
      for (const field of ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_SETUP_URL"] as const) {
        if (!value[field]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required in production when GitHub integration is enabled`
          });
        }
      }
    }

    for (const field of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const) {
      if (isWeakProductionSecret(value[field])) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} must be at least 32 characters and not use placeholder/default text in production`
        });
      }
    }

    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_REFRESH_SECRET"],
        message: "JWT_REFRESH_SECRET must be separate from JWT_ACCESS_SECRET in production"
      });
    }

    if (value.FIREFLIES_API_BASE_URL !== "https://api.fireflies.ai/graphql") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FIREFLIES_API_BASE_URL"],
        message: "Production Fireflies API base URL must be https://api.fireflies.ai/graphql"
      });
    }

    if (value.SLACK_WRITE_ACTIONS_ENABLED) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SLACK_WRITE_ACTIONS_ENABLED"],
        message: "Slack write actions are out of scope for the MVP communication provider and must remain disabled"
      });
    }

    if (isWeakProductionSecret(value.CONNECTOR_OAUTH_STATE_SECRET)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CONNECTOR_OAUTH_STATE_SECRET"],
        message: "CONNECTOR_OAUTH_STATE_SECRET must be at least 32 characters and not use placeholder/default text in production"
      });
    }

    if (isWeakProductionSecret(value.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CONNECTOR_CREDENTIAL_ENCRYPTION_KEY"],
        message: "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY must be at least 32 characters and not use placeholder/default text in production"
      });
    }

    if (value.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY === value.CONNECTOR_OAUTH_STATE_SECRET) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CONNECTOR_CREDENTIAL_ENCRYPTION_KEY"],
        message: "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY must be separate from CONNECTOR_OAUTH_STATE_SECRET"
      });
    }

    if (isWeakProductionSecret(value.CLIENT_SHARE_TOKEN_SECRET)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CLIENT_SHARE_TOKEN_SECRET"],
        message: "CLIENT_SHARE_TOKEN_SECRET must be at least 32 characters and not use placeholder/default text in production"
      });
    }

    if ((value.ORCHESTRA_PROFILE === "mvp_beta" || value.MVP_BETA_MODE) && isWeakProductionSecret(value.VSCODE_CONNECTOR_TOKEN_SECRET)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["VSCODE_CONNECTOR_TOKEN_SECRET"],
        message: "Production beta requires VSCODE_CONNECTOR_TOKEN_SECRET so VS Code connector token hashes use a dedicated strong pepper"
      });
    }

    if (
      isProductionDeployment &&
      !selfHosted &&
      (value.ORCHESTRA_PROFILE === "mvp_beta" || value.MVP_BETA_MODE) &&
      !value.OPENAI_API_KEY
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OPENAI_API_KEY"],
        message: "Production beta requires OPENAI_API_KEY for Socrates generation and embeddings"
      });
    }

    if (!value.SOCRATES_ENABLE_MODEL_FALLBACK) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SOCRATES_ENABLE_MODEL_FALLBACK"],
        message: "Production requires SOCRATES_ENABLE_MODEL_FALLBACK=true"
      });
    }

    if (!value.SOCRATES_ENABLE_EVIDENCE_ONLY_DEGRADED_MODE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SOCRATES_ENABLE_EVIDENCE_ONLY_DEGRADED_MODE"],
        message: "Production requires SOCRATES_ENABLE_EVIDENCE_ONLY_DEGRADED_MODE=true"
      });
    }

    const usesOpenAiGeneration = Boolean(value.OPENAI_API_KEY);
    const generationModelFields = [
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
    ] as const;

    for (const field of generationModelFields) {
      if (isUnsafeProductionModel(value[field])) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} must be explicitly configured to a non-placeholder production model`
        });
      }

      if (usesOpenAiGeneration && !isOpenAiGenerationModel(value[field])) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} must use an OpenAI generation model in staging/production`
        });
      }
    }

    if (usesOpenAiGeneration && !isOpenAiGenerationModel(value.OPENAI_GENERATION_MODEL)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OPENAI_GENERATION_MODEL"],
        message: "OPENAI_GENERATION_MODEL must use an OpenAI generation model in staging/production"
      });
    }

  }

  if (isProductionDeployment) {
    if (value.CONNECTOR_CREDENTIAL_VAULT_MODE === "managed_reference") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["CONNECTOR_CREDENTIAL_VAULT_MODE"],
        message: "Managed credential resolution is not implemented. This deployment profile is unavailable; use the explicitly supported volume-backed free-tier beta profile or implement a managed adapter before deployment." });
    }
    if (value.STORAGE_DRIVER === "local" && !selfHosted && !(isFreeTierBetaProduction && hasPersistentVolumeStorage)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STORAGE_DRIVER"],
        message: isFreeTierBetaProduction
          ? "Free-tier beta local storage must resolve inside an absolute RAILWAY_VOLUME_MOUNT_PATH"
          : "Production requires non-local object storage; set STORAGE_DRIVER=s3"
      });
    }

    if (
      value.CONNECTOR_CREDENTIAL_VAULT_MODE !== "managed_reference" &&
      !selfHosted &&
      !(
        isFreeTierBetaProduction &&
        value.CONNECTOR_CREDENTIAL_VAULT_MODE === "encrypted_file" &&
        hasPersistentVolumeStorage
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CONNECTOR_CREDENTIAL_VAULT_MODE"],
        message: isFreeTierBetaProduction
          ? "Free-tier beta encrypted credentials must live on the declared persistent Railway volume"
          : "Production requires CONNECTOR_CREDENTIAL_VAULT_MODE=managed_reference so provider credentials live in managed secret storage/KMS, not local files"
      });
    }

    if (isWeakProductionSecret(value.METRICS_TOKEN)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["METRICS_TOKEN"],
        message: "METRICS_TOKEN must be set to a non-placeholder value of at least 32 characters in production"
      });
    }

    if (!value.TRACE_EXPORTER_OTLP_ENDPOINT && !isFreeTierBetaProduction && !selfHosted) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TRACE_EXPORTER_OTLP_ENDPOINT"],
        message: "Production requires TRACE_EXPORTER_OTLP_ENDPOINT so request/job traces are exported"
      });
    }

    if (!value.ERROR_AGGREGATION_DSN && !isFreeTierBetaProduction && !selfHosted) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ERROR_AGGREGATION_DSN"],
        message: "Production requires ERROR_AGGREGATION_DSN so request/job failures reach error aggregation"
      });
    }

    if (!value.UPTIME_CHECK_URLS.trim() && !isFreeTierBetaProduction && !selfHosted) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["UPTIME_CHECK_URLS"],
        message: "Production requires UPTIME_CHECK_URLS for external uptime checks"
      });
    }

    for (const field of [
      "SOCRATES_MODEL_FAST_INPUT_COST_PER_1M",
      "SOCRATES_MODEL_FAST_OUTPUT_COST_PER_1M",
      "SOCRATES_MODEL_HIGH_QUALITY_INPUT_COST_PER_1M",
      "SOCRATES_MODEL_HIGH_QUALITY_OUTPUT_COST_PER_1M",
      "SOCRATES_MODEL_FALLBACK_INPUT_COST_PER_1M",
      "SOCRATES_MODEL_FALLBACK_OUTPUT_COST_PER_1M",
      "SOCRATES_EMBEDDING_COST_PER_1M"
    ] as const) {
      if (value[field] <= 0 && !(selfHosted && !value.OPENAI_API_KEY)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} must be greater than zero in production so AI cost telemetry is not silently free`
        });
      }
    }

    if (
      ["openai", "llm"].includes(value.SOCRATES_RERANK_PROVIDER) &&
      value.SOCRATES_RERANK_COST_PER_1K <= 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SOCRATES_RERANK_COST_PER_1K"],
        message: "SOCRATES_RERANK_COST_PER_1K must be greater than zero when a paid Socrates reranker is enabled in production"
      });
    }
  }
}).transform((value) => ({
  ...value,
  DEPLOYMENT_ENV: value.DEPLOYMENT_ENV ?? value.NODE_ENV
}));

export type AppEnv = z.infer<typeof envSchema>;

export function getEnv(): AppEnv {
  return envSchema.parse(process.env);
}

export function parseEnv(input:Record<string,unknown>):AppEnv { return envSchema.parse(input); }
