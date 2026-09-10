import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CredentialVault } from "../src/lib/communications/credential-vault.js";
import { SlackProvider } from "../src/modules/communications/providers/slack.provider.js";
import { GmailProvider } from "../src/modules/communications/providers/gmail.provider.js";
import { OutlookProvider } from "../src/modules/communications/providers/outlook.provider.js";
import { TeamsProvider } from "../src/modules/communications/providers/teams.provider.js";
import { NotionProvider } from "../src/modules/communications/providers/notion.provider.js";
import { WhatsAppBusinessProvider } from "../src/modules/communications/providers/whatsapp-business.provider.js";
import { ClickUpProvider } from "../src/modules/communications/providers/clickup.provider.js";
import { GranolaProvider } from "../src/modules/communications/providers/granola.provider.js";
import { ZohoMailProvider } from "../src/modules/communications/providers/zoho-mail.provider.js";
import { ZohoCliqProvider } from "../src/modules/communications/providers/zoho-cliq.provider.js";
import { ZohoCrmProvider } from "../src/modules/communications/providers/zoho-crm.provider.js";
import { ZohoApiClient } from "../src/modules/communications/providers/zoho/zoho-client.js";
import { FirefliesProvider, signFirefliesConnectorScope, verifyFirefliesSignature } from "../src/modules/communications/providers/fireflies.provider.js";
import { ConnectorsService } from "../src/modules/communications/connectors.service.js";
import { SyncService } from "../src/modules/communications/sync.service.js";
import { MessageIngestionService } from "../src/modules/communications/message-ingestion.service.js";
import { AppError } from "../src/app/errors.js";
import { getProviderReadiness } from "../src/modules/communications/provider-readiness.js";
import { communicationProviders, getCommunicationProviderMetadata } from "../src/lib/communications/provider-types.js";
import { getMvpEnabledCommunicationProviders, shouldExposeAdvancedConnector } from "../src/lib/mvp/policy.js";
import { getJobExecutionPolicy, assertProductionQueueMode } from "../src/lib/jobs/policy.js";
import { JobNames } from "../src/lib/jobs/types.js";
import { callMicrosoftGraph, signMicrosoftWebhookClientState } from "../src/lib/communications/microsoft-graph.js";

function createEnv(overrides: Record<string, unknown> = {}) {
  const nodeEnv = (overrides.NODE_ENV as string | undefined) ?? "test";
  return {
    NODE_ENV: nodeEnv,
    DEPLOYMENT_ENV: (overrides.DEPLOYMENT_ENV as string | undefined) ?? nodeEnv,
    PORT: 3000,
    HOST: "127.0.0.1",
    LOG_LEVEL: "silent",
    APP_BASE_URL: "http://localhost:3000",
    CORS_ALLOWED_ORIGINS: "http://localhost:3001",
    DATABASE_URL: "postgresql://test",
    DIRECT_URL: "postgresql://test",
    REDIS_URL: "redis://localhost:6379",
    QUEUE_MODE: "inline",
    QUEUE_PREFIX: "orchestra",
    WORKER_CONCURRENCY: 5,
    JOB_DEFAULT_ATTEMPTS: 3,
    JOB_DEFAULT_BACKOFF_MS: 1000,
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_ROOT: "./storage",
    SIGNED_URL_TTL_SECONDS: 3600,
    MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024,
    JWT_ACCESS_SECRET: "test-access-secret",
    JWT_REFRESH_SECRET: "test-refresh-secret",
    JWT_ACCESS_TTL: "15m",
    JWT_REFRESH_TTL: "30d",
    PASSWORD_HASH_COST: 12,
    OPENAI_API_KEY: undefined,
    OPENAI_EMBEDDING_MODEL: "mock",
    OPENAI_TRANSCRIPTION_MODEL: "mock-transcribe",
    SLACK_CLIENT_ID: "slack-client-id",
    SLACK_CLIENT_SECRET: "slack-client-secret",
    SLACK_SIGNING_SECRET: "slack-signing-secret",
    SLACK_REDIRECT_URI: "http://localhost:3000/v1/oauth/slack/callback",
    CLICKUP_CLIENT_ID: undefined,
    CLICKUP_CLIENT_SECRET: undefined,
    CLICKUP_REDIRECT_URI: undefined,
    CLICKUP_WEBHOOK_SECRET: undefined,
    CLICKUP_API_BASE_URL: "https://api.clickup.com/api/v2",
    CLICKUP_CONNECTOR_ENABLED: true,
    CLICKUP_WEBHOOKS_ENABLED: true,
    CLICKUP_BACKFILL_ENABLED: true,
    CLICKUP_SYNC_BATCH_SIZE: 100,
    CLICKUP_MAX_BACKFILL_DAYS: 30,
    CLICKUP_MAX_TASKS_PER_SYNC: 50,
    CLICKUP_INCLUDE_CLOSED_TASKS_DEFAULT: false,
    CLICKUP_SYNC_TASK_DESCRIPTIONS_DEFAULT: true,
    CLICKUP_SYNC_TASK_COMMENTS_DEFAULT: true,
    CLICKUP_SYNC_STATUS_CHANGES_DEFAULT: true,
    CLICKUP_SYNC_ASSIGNEE_CHANGES_DEFAULT: true,
    CLICKUP_SYNC_DUE_DATE_CHANGES_DEFAULT: true,
    CLICKUP_SYNC_PRIORITY_CHANGES_DEFAULT: true,
    CLICKUP_SYNC_MOVED_EVENTS_DEFAULT: true,
    CLICKUP_ATTACHMENT_INGESTION_ENABLED: false,
    CLICKUP_WRITE_ACTIONS_ENABLED: false,
    CLICKUP_PERSONAL_TOKEN_DIAGNOSTIC_ENABLED: false,
    GRANOLA_CONNECTOR_ENABLED: true,
    BETA_GRANOLA_CONNECTOR_ENABLED: true,
    BETA_FIREFLIES_CONNECTOR_ENABLED: true,
    BETA_ZOHO_MAIL_CONNECTOR_ENABLED: true,
    BETA_ZOHO_CLIQ_CONNECTOR_ENABLED: true,
    BETA_ZOHO_CRM_CONNECTOR_ENABLED: true,
    BETA_NOTION_CONNECTOR_ENABLED: true,
    BETA_MICROSOFT_TEAMS_CONNECTOR_ENABLED: true,
    GRANOLA_API_BASE_URL: "https://public-api.granola.ai/v1",
    GRANOLA_BACKFILL_ENABLED: true,
    GRANOLA_INCREMENTAL_SYNC_ENABLED: true,
    GRANOLA_WEBHOOKS_ENABLED: false,
    GRANOLA_SYNC_BATCH_SIZE: 10,
    GRANOLA_MAX_BACKFILL_DAYS: 30,
    GRANOLA_MAX_NOTES_PER_SYNC: 100,
    GRANOLA_INCLUDE_TRANSCRIPT_DEFAULT: true,
    GRANOLA_INCLUDE_SUMMARY_DEFAULT: true,
    GRANOLA_INCLUDE_CALENDAR_EVENT_DEFAULT: true,
    GRANOLA_INCLUDE_ATTENDEES_DEFAULT: true,
    GRANOLA_WRITE_ACTIONS_ENABLED: false,
    GRANOLA_ATTACHMENT_INGESTION_ENABLED: false,
    ZOHO_CLIENT_ID: "zoho-client-id",
    ZOHO_CLIENT_SECRET: "zoho-client-secret",
    ZOHO_REDIRECT_URI: "http://localhost:3000/v1/oauth/zoho/callback",
    ZOHO_ACCOUNTS_SERVER: "https://accounts.zoho.com",
    ZOHO_SCOPES: [],
    ZOHO_WRITE_ACTIONS_ENABLED: false,
    ZOHO_OAUTH_STATE_TTL_MINUTES: 10,
    ZOHO_REQUEST_TIMEOUT_MS: 15_000,
    ZOHO_MAX_RETRIES: 2,
    ZOHO_MAIL_CONNECTOR_ENABLED: true,
    ZOHO_MAIL_BACKFILL_ENABLED: true,
    ZOHO_MAIL_INCREMENTAL_SYNC_ENABLED: true,
    ZOHO_MAIL_WEBHOOKS_ENABLED: false,
    ZOHO_MAIL_WRITE_ACTIONS_ENABLED: false,
    ZOHO_MAIL_ATTACHMENT_INGESTION_ENABLED: false,
    ZOHO_MAIL_API_BASE_URL: undefined,
    ZOHO_MAIL_SCOPES: ["ZohoMail.accounts.READ", "ZohoMail.folders.READ", "ZohoMail.messages.READ"],
    ZOHO_MAIL_SYNC_MAX_BACKFILL_DAYS: 90,
    ZOHO_MAIL_SYNC_BATCH_SIZE: 50,
    ZOHO_MAIL_MAX_MESSAGES_PER_SYNC: 500,
    ZOHO_MAIL_DEFAULT_FOLDER_SCOPE: "inbox",
    ZOHO_MAIL_INCLUDE_SPAM: false,
    ZOHO_MAIL_INCLUDE_TRASH: false,
    ZOHO_CLIQ_CONNECTOR_ENABLED: true,
    ZOHO_CLIQ_BACKFILL_ENABLED: true,
    ZOHO_CLIQ_INCREMENTAL_SYNC_ENABLED: true,
    ZOHO_CLIQ_WEBHOOKS_ENABLED: false,
    ZOHO_CLIQ_WRITE_ACTIONS_ENABLED: false,
    ZOHO_CLIQ_API_BASE_URL: undefined,
    ZOHO_CLIQ_SCOPES: ["ZohoCliq.Channels.READ", "ZohoCliq.Chats.READ", "ZohoCliq.Messages.READ"],
    ZOHO_CLIQ_SYNC_BATCH_SIZE: 50,
    ZOHO_CLIQ_MAX_MESSAGES_PER_SYNC: 500,
    ZOHO_CLIQ_DEFAULT_CHANNEL_SCOPE: "selected_only",
    ZOHO_CRM_CONNECTOR_ENABLED: true,
    ZOHO_CRM_BACKFILL_ENABLED: true,
    ZOHO_CRM_INCREMENTAL_SYNC_ENABLED: true,
    ZOHO_CRM_WEBHOOKS_ENABLED: false,
    ZOHO_CRM_WRITE_ACTIONS_ENABLED: false,
    ZOHO_CRM_API_BASE_URL: undefined,
    ZOHO_CRM_SCOPES: ["ZohoCRM.modules.READ", "ZohoCRM.settings.modules.READ", "ZohoCRM.settings.fields.READ"],
    ZOHO_CRM_SELECTED_MODULES: "Leads,Accounts,Contacts,Deals,Tasks,Events,Calls,Notes",
    ZOHO_CRM_SYNC_BATCH_SIZE: 100,
    ZOHO_CRM_MAX_RECORDS_PER_SYNC: 1000,
    ZOHO_CRM_FIELD_ALLOWLIST: "",
    ZOHO_CRM_INCLUDE_CUSTOM_MODULES: false,
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_REDIRECT_URI: "http://localhost:3000/v1/oauth/google/callback",
    GOOGLE_PUBSUB_TOPIC: undefined,
    MICROSOFT_CLIENT_ID: "microsoft-client-id",
    MICROSOFT_CLIENT_SECRET: "microsoft-client-secret",
    MICROSOFT_REDIRECT_URI: "http://localhost:3000/v1/oauth/microsoft/callback",
    MICROSOFT_TENANT_ID: "common",
    MICROSOFT_GRAPH_SCOPES: [
      "openid",
      "profile",
      "offline_access",
      "User.Read",
      "Team.ReadBasic.All",
      "Channel.ReadBasic.All",
      "ChannelMessage.Read.All",
      "Chat.Read"
    ],
    MICROSOFT_GRAPH_BASE_URL: "https://graph.microsoft.com/v1.0",
    MICROSOFT_TEAMS_CONNECTOR_ENABLED: true,
    MICROSOFT_TEAMS_SELECTED_RESOURCE_MODE: true,
    MICROSOFT_TEAMS_WRITE_ACTIONS_ENABLED: false,
    MICROSOFT_TEAMS_BACKFILL_ENABLED: true,
    MICROSOFT_TEAMS_INCREMENTAL_SYNC_ENABLED: true,
    MICROSOFT_TEAMS_WEBHOOKS_ENABLED: false,
    NOTION_CONNECTOR_ENABLED: true,
    NOTION_WRITE_ACTIONS_ENABLED: false,
    NOTION_INTERNAL_TOKEN_MODE_ENABLED: true,
    NOTION_OAUTH_ENABLED: true,
    NOTION_SELECTED_RESOURCE_MODE: true,
    NOTION_CLIENT_ID: "notion-client-id",
    NOTION_CLIENT_SECRET: "notion-client-secret",
    NOTION_REDIRECT_URI: "http://localhost:3000/v1/oauth/notion/callback",
    NOTION_AUTH_URL: "https://api.notion.com/v1/oauth/authorize",
    NOTION_API_VERSION: "2022-06-28",
    NOTION_INTERNAL_INTEGRATION_TOKEN: "secret_notion_internal_demo",
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: "whatsapp-verify-token",
    WHATSAPP_APP_SECRET: "whatsapp-app-secret",
    WHATSAPP_READINESS_MODE: "webhook_inbound",
    FIREFLIES_READINESS_MODE: "manual_only",
    FIREFLIES_API_BASE_URL: "https://api.fireflies.ai/graphql",
    FIREFLIES_API_KEY: undefined,
    FIREFLIES_WEBHOOK_SECRET: undefined,
    FIREFLIES_SYNC_BATCH_SIZE: 50,
    FIREFLIES_SYNC_MAX_BACKFILL_DAYS: 30,
    FIREFLIES_SYNC_TIMEOUT_MS: 30_000,
    FIREFLIES_ALLOW_RECORDING_URLS: false,
    FIREFLIES_ALLOW_TRANSCRIPT_PROVIDER_URLS: false,
    CONNECTOR_CREDENTIAL_VAULT_MODE: "memory",
    CONNECTOR_MANAGED_SECRET_PROVIDER: "external_reference",
    CONNECTOR_MANAGED_SECRET_PREFIX: "orchestra/",
    CONNECTOR_OAUTH_STATE_SECRET: "test-connector-oauth-state-secret",
    CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: "test-connector-credential-encryption-key",
    CONNECTOR_SYNC_BATCH_SIZE: 100,
    CONNECTOR_SYNC_MAX_BACKFILL_DAYS: 30,
    RETRIEVAL_TOP_K: 8,
    RETRIEVAL_MIN_SCORE: 0.2,
    RETRIEVAL_USE_HYBRID: true,
    RETRIEVAL_DOC_WEIGHT: 1,
    RETRIEVAL_COMM_WEIGHT: 0.8,
    RETRIEVAL_ACCEPTED_TRUTH_BOOST: 1.2,
    SOCRATES_MAX_CONTEXT_TOKENS: 12000,
    SOCRATES_MAX_HISTORY_TURNS: 8,
    SOCRATES_RETRIEVAL_TOP_K: 32,
    SOCRATES_RERANK_TOP_K: 8,
    SOCRATES_MAX_CITATIONS: 6,
    SOCRATES_MAX_OUTPUT_TOKENS: 1800,
    METRICS_TOKEN: undefined,
    ...overrides
  } as any;
}

describe("communication layer C3 providers", () => {
  it("declares Slack, ClickUp, Granola, and Microsoft Teams as evidence-only communication providers", () => {
    expect(communicationProviders).toEqual(
      expect.arrayContaining([
        "manual_import",
        "fireflies_ai",
        "slack",
        "clickup",
        "granola",
        "microsoft_teams",
        "notion",
        "zoho_mail",
        "zoho_cliq",
        "zoho_crm"
      ])
    );
    expect(getCommunicationProviderMetadata("slack")).toMatchObject({
      category: "conversation",
      evidenceKind: "conversation_evidence",
      normalizesTo: "communication_threads_messages",
      readFirst: true,
      truthGated: true,
      mutatesProductBrain: false,
      mutatesLiveDoc: false,
      writeActionsEnabled: false
    });
    expect(getCommunicationProviderMetadata("clickup")).toMatchObject({
      category: "task_work_status",
      evidenceKind: "task_work_status_evidence",
      step1Scope: "implemented",
      normalizesTo: "communication_threads_messages",
      readFirst: true,
      truthGated: true,
      mutatesProductBrain: false,
      mutatesLiveDoc: false,
      writeActionsEnabled: false
    });
    expect(getCommunicationProviderMetadata("granola")).toMatchObject({
      displayName: "Granola",
      category: "meeting",
      evidenceKind: "meeting_evidence",
      step1Scope: "implemented",
      normalizesTo: "communication_threads_messages",
      readFirst: true,
      truthGated: true,
      mutatesProductBrain: false,
      mutatesLiveDoc: false,
      writeActionsEnabled: false,
      deferredFeatures: expect.arrayContaining([
        "granola_webhooks",
        "granola_write_actions",
        "granola_note_creation",
        "granola_note_update",
        "granola_audio_sync"
      ])
    });
    expect(getCommunicationProviderMetadata("microsoft_teams")).toMatchObject({
      displayName: "Microsoft Teams",
      category: "conversation",
      evidenceKind: "conversation_evidence",
      description: "selected Teams/channel/chat evidence",
      normalizesTo: "communication_threads_messages",
      readFirst: true,
      truthGated: true,
      mutatesProductBrain: false,
      mutatesLiveDoc: false,
      writeActionsEnabled: false,
      step1Scope: expect.stringMatching(/foundation_only|implemented/),
      deferredFeatures: expect.arrayContaining(["teams_webhooks", "teams_write_actions"])
    });
    expect(getCommunicationProviderMetadata("notion")).toMatchObject({
      displayName: "Notion",
      category: "document_workspace",
      evidenceKind: "document_workspace_evidence",
      description: "selected/shared Notion pages and databases as project knowledge evidence",
      normalizesTo: "project_memory_documents_or_evidence",
      readFirst: true,
      truthGated: true,
      mutatesProductBrain: false,
      mutatesLiveDoc: false,
      writeActionsEnabled: false,
      step1Scope: "implemented",
      deferredFeatures: expect.arrayContaining([
        "notion_comment_ingestion",
        "notion_write_actions"
      ])
    });
    expect(getCommunicationProviderMetadata("zoho_mail")).toMatchObject({
      displayName: "Zoho Mail",
      category: "conversation",
      evidenceKind: "conversation_evidence",
      step1Scope: "implemented",
      writeActionsEnabled: false,
      deferredFeatures: expect.arrayContaining(["zoho_mail_send", "zoho_mail_attachment_ingestion"])
    });
    expect(getCommunicationProviderMetadata("zoho_cliq")).toMatchObject({
      displayName: "Zoho Cliq",
      category: "conversation",
      evidenceKind: "conversation_evidence",
      step1Scope: "implemented",
      writeActionsEnabled: false,
      deferredFeatures: expect.arrayContaining(["zoho_cliq_post_message", "zoho_cliq_bot_actions"])
    });
    expect(getCommunicationProviderMetadata("zoho_crm")).toMatchObject({
      displayName: "Zoho CRM",
      category: "task_work_status",
      evidenceKind: "task_work_status_evidence",
      step1Scope: "implemented",
      writeActionsEnabled: false,
      deferredFeatures: expect.arrayContaining(["zoho_crm_create_records", "zoho_crm_writeback"])
    });
  });

  beforeEach(() => {
    vi.useRealTimers();
  });

  it("derives provider readiness without exposing secret values", () => {
    const missingEnv = createEnv({
      SLACK_CLIENT_ID: undefined,
      SLACK_CLIENT_SECRET: undefined,
      SLACK_SIGNING_SECRET: undefined,
      SLACK_REDIRECT_URI: undefined,
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      GOOGLE_REDIRECT_URI: undefined,
      MICROSOFT_CLIENT_ID: undefined,
      MICROSOFT_CLIENT_SECRET: undefined,
      MICROSOFT_REDIRECT_URI: undefined,
      MICROSOFT_GRAPH_BASE_URL: undefined,
      NOTION_CLIENT_ID: undefined,
      NOTION_CLIENT_SECRET: undefined,
      NOTION_REDIRECT_URI: undefined,
      NOTION_AUTH_URL: undefined,
      NOTION_API_VERSION: undefined,
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: undefined,
      WHATSAPP_READINESS_MODE: "disabled",
      FIREFLIES_READINESS_MODE: "api",
      FIREFLIES_API_KEY: undefined,
      GRANOLA_API_BASE_URL: undefined,
      ZOHO_CLIENT_ID: undefined,
      ZOHO_CLIENT_SECRET: undefined,
      ZOHO_REDIRECT_URI: undefined
    });

    expect(getProviderReadiness(missingEnv, "manual_import")).toMatchObject({
      state: "enabled",
      canConnect: true
    });
    expect(getProviderReadiness(missingEnv, "slack")).toMatchObject({
      state: "readiness_gated",
      missingConfig: expect.arrayContaining(["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET"])
    });
    expect(getProviderReadiness(missingEnv, "gmail")).toMatchObject({
      state: "readiness_gated",
      missingConfig: expect.arrayContaining(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"])
    });
    expect(getProviderReadiness(missingEnv, "outlook")).toMatchObject({
      state: "readiness_gated",
      missingConfig: expect.arrayContaining(["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"])
    });
    expect(getProviderReadiness(missingEnv, "microsoft_teams")).toMatchObject({
      state: "readiness_gated",
      missingConfig: expect.arrayContaining(["MICROSOFT_GRAPH_BASE_URL"]),
      selectedResourceMode: "selected_teams_channels_chats_only",
      writeActionsEnabled: false
    });
    expect(getProviderReadiness(missingEnv, "notion")).toMatchObject({
      state: "readiness_gated",
      canConnect: false,
      canSync: false,
      selectedResourceMode: "selected_shared_only",
      writeActionsEnabled: false,
      syncImplemented: true,
      missingConfig: expect.arrayContaining([
        "NOTION_CLIENT_ID",
        "NOTION_CLIENT_SECRET",
        "NOTION_REDIRECT_URI",
        "NOTION_AUTH_URL",
        "NOTION_API_VERSION"
      ])
    });
    expect(getProviderReadiness(missingEnv, "whatsapp_business")).toMatchObject({
      state: "disabled",
      canConnect: false
    });
    expect(getProviderReadiness(missingEnv, "fireflies_ai")).toMatchObject({
      state: "readiness_gated",
      canManualImport: true,
      canSync: false,
      missingConfig: expect.arrayContaining(["FIREFLIES_API_KEY"])
    });
    expect(getProviderReadiness(missingEnv, "clickup")).toMatchObject({
      state: "readiness_gated",
      canConnect: false,
      canSync: false,
      canWebhook: false,
      missingConfig: expect.arrayContaining(["CLICKUP_CLIENT_ID", "CLICKUP_CLIENT_SECRET", "CLICKUP_REDIRECT_URI", "CLICKUP_WEBHOOK_SECRET"]),
      deferredFeatures: expect.not.arrayContaining(["clickup_oauth_deferred_to_step_2"])
    });

    const whatsappReady = getProviderReadiness(createEnv(), "whatsapp_business");
    expect(JSON.stringify(whatsappReady)).not.toContain("whatsapp-app-secret");
    expect(whatsappReady).toMatchObject({
      state: "enabled",
      canSync: false,
      deferredFeatures: expect.arrayContaining(["whatsapp_manual_sync_noop"])
    });

    const firefliesManual = getProviderReadiness(createEnv(), "fireflies_ai");
    expect(JSON.stringify(firefliesManual)).not.toContain("fireflies-api-key");
    expect(firefliesManual).toMatchObject({
      state: "readiness_gated",
      canConnect: true,
      canManualImport: true,
      canSync: false
    });
    expect(getProviderReadiness(missingEnv, "granola")).toMatchObject({
      state: "readiness_gated",
      missingConfig: expect.arrayContaining(["GRANOLA_API_BASE_URL"]),
      canConnect: false
    });
    expect(getProviderReadiness(createEnv(), "granola")).toMatchObject({
      state: "enabled",
      canConnect: true,
      canSync: false,
      canWebhook: false,
      reasons: expect.arrayContaining(["granola_connector_not_connected"])
    });
    expect(getProviderReadiness(createEnv(), "granola", { status: "connected", credentialsRef: "vault:granola:connector-1" })).toMatchObject({
      state: "enabled",
      canConnect: true,
      canSync: true,
      canWebhook: false,
      deferredFeatures: expect.not.arrayContaining(["granola_sync_not_supported_until_step_2"])
    });
    expect(getProviderReadiness(missingEnv, "zoho_mail")).toMatchObject({
      state: "readiness_gated",
      canConnect: false,
      canSync: false,
      missingConfig: expect.arrayContaining(["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REDIRECT_URI"])
    });
    expect(getProviderReadiness(createEnv(), "zoho_mail", { status: "connected", credentialsRef: "vault:zoho_mail:connector-1" })).toMatchObject({
      state: "enabled",
      canConnect: true,
      canSync: true,
      canWebhook: false,
      deferredFeatures: expect.arrayContaining(["zoho_mail_write_actions_disabled"])
    });
    expect(getProviderReadiness(createEnv(), "zoho_cliq", { status: "connected", credentialsRef: "vault:zoho_cliq:connector-1" })).toMatchObject({
      state: "enabled",
      canSync: true,
      deferredFeatures: expect.arrayContaining(["zoho_cliq_write_actions_disabled"])
    });
    expect(getProviderReadiness(createEnv(), "zoho_crm", { status: "connected", credentialsRef: "vault:zoho_crm:connector-1" })).toMatchObject({
      state: "enabled",
      canSync: true,
      deferredFeatures: expect.arrayContaining(["zoho_crm_write_actions_disabled"])
    });
    expect(getProviderReadiness(createEnv(), "slack", { status: "connected", credentialsRef: null })).toMatchObject({
      state: "error",
      canSync: false,
      canWebhook: false,
      reasons: expect.arrayContaining(["connector_credential_missing"]),
      deferredFeatures: expect.arrayContaining(["reconnect_required"])
    });
    const notionReady = getProviderReadiness(createEnv(), "notion");
    expect(notionReady).toMatchObject({
      state: "enabled",
      canConnect: true,
      canSync: true,
      canWebhook: false,
      authModes: expect.arrayContaining(["oauth_public_connection", "internal_token_demo"]),
      warnings: expect.arrayContaining(["notion_pages_and_databases_must_be_selected_or_shared"]),
      deferredFeatures: expect.arrayContaining(["notion_comment_ingestion_deferred", "notion_write_actions_disabled"])
    });
    expect(JSON.stringify(notionReady)).not.toContain("notion-client-secret");
    expect(JSON.stringify(notionReady)).not.toContain("secret_notion_internal_demo");
  });

  it("keeps the MVP provider profile to selected read-first providers including Notion and Microsoft Teams", () => {
    const env = createEnv({
      MVP_MODE: true,
      MVP_EQUAL_PROJECT_ACCESS: true,
      MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "fireflies_ai", "slack", "clickup", "granola", "microsoft_teams", "notion"],
      MVP_ENABLE_ADVANCED_CONNECTORS: false
    });

    expect(getMvpEnabledCommunicationProviders(env)).toEqual([
      "manual_import",
      "fireflies_ai",
      "slack",
      "clickup",
      "granola",
      "microsoft_teams",
      "notion"
    ]);
    expect(shouldExposeAdvancedConnector(env, "slack")).toBe(true);
    expect(shouldExposeAdvancedConnector(env, "clickup")).toBe(true);
    expect(shouldExposeAdvancedConnector(env, "granola")).toBe(true);
    expect(shouldExposeAdvancedConnector(env, "microsoft_teams")).toBe(true);
    expect(shouldExposeAdvancedConnector(env, "notion")).toBe(true);
    expect(shouldExposeAdvancedConnector(env, "gmail")).toBe(false);
    expect(shouldExposeAdvancedConnector(env, "outlook")).toBe(false);
    expect(shouldExposeAdvancedConnector(env, "whatsapp_business")).toBe(false);
    expect(getProviderReadiness(env, "manual_import")).toMatchObject({
      state: "enabled",
      canManualImport: true
    });
    expect(getProviderReadiness(env, "fireflies_ai")).toMatchObject({
      state: "readiness_gated",
      canManualImport: true
    });
    expect(getProviderReadiness(env, "slack")).toMatchObject({
      state: "enabled",
      canConnect: true
    });
    expect(getProviderReadiness(env, "clickup")).toMatchObject({
      state: "readiness_gated",
      canConnect: false,
      reasons: expect.arrayContaining(["clickup_configuration_incomplete"])
    });
    expect(getProviderReadiness(env, "microsoft_teams")).toMatchObject({
      state: "enabled",
      canConnect: true,
      canSync: false,
      canWebhook: false,
      reasons: expect.arrayContaining(["teams_selected_resource_config_required_for_sync"])
    });
    expect(getProviderReadiness(env, "notion")).toMatchObject({
      state: "enabled",
      canConnect: true,
      canSync: true,
      selectedResourceMode: "selected_shared_only"
    });
    expect(getProviderReadiness(env, "gmail")).toMatchObject({
      state: "disabled",
      canConnect: false,
      reasons: ["disabled_in_mvp_mode"]
    });
  });

  it("exposes only intended beta providers, including Notion and Microsoft Teams, in connector readiness", async () => {
    const env = createEnv({
      ORCHESTRA_PROFILE: "mvp_beta",
      MVP_BETA_MODE: true,
      MVP_MODE: true,
      MVP_ENABLED_COMMUNICATION_PROVIDERS: [
        "slack",
        "clickup",
        "granola",
        "fireflies_ai",
        "zoho_mail",
        "zoho_cliq",
        "zoho_crm",
        "microsoft_teams",
        "notion"
      ],
      BETA_CLICKUP_CONNECTOR_ENABLED: true,
      BETA_GRANOLA_CONNECTOR_ENABLED: true,
      BETA_FIREFLIES_CONNECTOR_ENABLED: true,
      BETA_ZOHO_MAIL_CONNECTOR_ENABLED: true,
      BETA_ZOHO_CLIQ_CONNECTOR_ENABLED: true,
      BETA_ZOHO_CRM_CONNECTOR_ENABLED: true,
      BETA_MICROSOFT_TEAMS_CONNECTOR_ENABLED: true,
      BETA_NOTION_CONNECTOR_ENABLED: true
    });
    const service = new ConnectorsService(
      {
        communicationConnector: {
          findMany: vi.fn(async () => [])
        }
      } as any,
      env,
      { ensureProjectManager: vi.fn(async () => ({ projectRole: "manager", isActive: true })) } as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      { putCredential: vi.fn(async () => ({ ref: "vault:test" })) } as any,
      new Map(),
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    const readiness = await service.listReadiness("project-1", "manager-1");
    expect(readiness.map((item) => item.provider)).toEqual([
      "manual_import",
      "slack",
      "fireflies_ai",
      "clickup",
      "granola",
      "microsoft_teams",
      "zoho_mail",
      "zoho_cliq",
      "zoho_crm",
      "notion"
    ]);
    expect(readiness.find((item) => item.provider === "clickup")?.metadata.evidenceKind).toBe("task_work_status_evidence");
    expect(readiness.find((item) => item.provider === "granola")?.metadata.evidenceKind).toBe("meeting_evidence");
    expect(readiness.find((item) => item.provider === "manual_import")?.readiness.canConnect).toBe(true);
    expect(readiness.find((item) => item.provider === "manual_import")?.readiness.canDisconnect).toBe(false);
    expect(readiness.find((item) => item.provider === "manual_import")?.readiness.canManualImport).toBe(true);
    expect(readiness.find((item) => item.provider === "fireflies_ai")?.readiness.canManualImport).toBe(true);
    expect(readiness.find((item) => item.provider === "zoho_crm")?.metadata.evidenceKind).toBe("task_work_status_evidence");
    expect(readiness.find((item) => item.provider === "microsoft_teams")?.readiness.selectedResourceMode).toBe(
      "selected_teams_channels_chats_only"
    );
    expect(readiness.find((item) => item.provider === "notion")?.metadata.evidenceKind).toBe("document_workspace_evidence");
    expect(readiness.find((item) => item.provider === "notion")?.readiness.canSync).toBe(true);
  });

  it("implements Zoho OAuth, read-only resource listing, sync contracts, and revoke without exposing tokens", async () => {
    const calls: Array<{ url: string; authorization?: string; method?: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, authorization: String((init?.headers as any)?.authorization ?? ""), method: init?.method });
      if (url.includes("/oauth/v2/token/revoke")) {
        return new Response(JSON.stringify({ status: "success" }), { status: 200 });
      }
      if (url.includes("/oauth/v2/token")) {
        return new Response(
          JSON.stringify({
            access_token: "1000.access-token-value",
            refresh_token: "1000.refresh-token-value",
            expires_in: 3600,
            api_domain: "https://www.zoho.com",
            scope: "ZohoCRM.modules.READ ZohoCRM.settings.modules.READ"
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/api/accounts")) {
        return new Response(JSON.stringify({ data: [{ accountId: "acc-1", mailboxAddress: "pilot@example.com" }] }), { status: 200 });
      }
      if (url.includes("/folders")) {
        return new Response(JSON.stringify({ data: [{ folderId: "fold-1", folderName: "Inbox" }] }), { status: 200 });
      }
      if (url.endsWith("/api/v2/channels")) {
        return new Response(JSON.stringify({ channels: [{ id: "chan-1", name: "product" }] }), { status: 200 });
      }
      if (url.endsWith("/api/v2/chats")) {
        return new Response(JSON.stringify({ chats: [{ id: "chat-1", title: "PM chat" }] }), { status: 200 });
      }
      if (url.endsWith("/crm/v8/settings/modules")) {
        return new Response(
          JSON.stringify({
            modules: [
              { api_name: "Leads", plural_label: "Leads" },
              { api_name: "Deals", plural_label: "Deals" },
              { api_name: "Cases", plural_label: "Cases" }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const env = createEnv();
    for (const Provider of [ZohoMailProvider, ZohoCliqProvider, ZohoCrmProvider]) {
      const provider = new Provider(env, fetchMock as typeof fetch);
      const connect = await provider.connect({ projectId: "project-1", actorUserId: "user-1", oauthState: "state-token" });
      expect(connect.mode).toBe("oauth_pending");
      expect(connect.redirectUrl).toContain("access_type=offline");
      expect(connect.redirectUrl).toContain("state=state-token");
      expect(connect.redirectUrl).not.toContain("secret");

      const callback = await provider.handleOAuthCallback?.({
        code: "oauth-code",
        redirectUri: env.ZOHO_REDIRECT_URI
      });
      expect(callback?.credential).toMatchObject({ accessToken: "1000.access-token-value", refreshToken: "1000.refresh-token-value" });
      expect(JSON.stringify(callback?.configPatch)).not.toContain("access-token-value");
      expect(JSON.stringify(callback?.configPatch)).not.toContain("refresh-token-value");

      const channels = await provider.listChannels?.({ credential: callback?.credential ?? null });
      expect(channels?.length).toBeGreaterThan(0);
      const sync = await provider.sync({
        projectId: "project-1",
        connector: { id: "connector-1", provider: provider.provider, providerCursorJson: {} } as any,
        credential: callback?.credential ?? null,
        syncType: "manual",
        batchSize: 10,
        maxBackfillDays: 30
      });
      expect(["completed", "partial"]).toContain(sync.status);
      expect(sync.batches).toEqual([]);
      expect(sync.summary).toMatchObject({ writesEnabled: false });
      await expect(provider.revoke?.({ credential: callback?.credential ?? null })).resolves.toEqual({ providerRevoked: true });
    }

    const zohoProductApiCalls = calls.filter((call) => !call.url.includes("/oauth/v2/"));
    expect(zohoProductApiCalls.length).toBeGreaterThan(0);
    expect(zohoProductApiCalls.every((call) => call.authorization === "Zoho-oauthtoken 1000.access-token-value")).toBe(true);
    expect(zohoProductApiCalls.some((call) => call.authorization?.includes("Bearer 1000.access-token-value"))).toBe(false);
  });

  it("normalizes Zoho Mail messages into communication batches with metadata-only attachments", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/accounts") {
        return new Response(JSON.stringify({ data: [{ accountId: "acct-1", mailboxAddress: "pm@example.com" }] }), { status: 200 });
      }
      if (url.pathname.endsWith("/folders")) {
        return new Response(JSON.stringify({ data: [{ folderId: "inbox", folderName: "Inbox" }] }), { status: 200 });
      }
      if (url.pathname.endsWith("/messages/view")) {
        expect(url.searchParams.get("folderId")).toBe("inbox");
        return new Response(
          JSON.stringify({
            data: [
              {
                messageId: "mail-1",
                threadId: "thread-1",
                subject: "Launch scope decision",
                fromAddress: "Maya <maya@example.com>",
                toAddress: "pm@example.com, qa@example.com",
                sentTime: new Date(Date.now() - 86_400_000).toISOString(),
                attachments: [{ attachmentId: "att-1", fileName: "scope.pdf", mimeType: "application/pdf", size: 1234 }]
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.pathname.endsWith("/messages/mail-1/content")) {
        return new Response(JSON.stringify({ content: "<p>We should defer billing automation until after pilot approval.</p>" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const provider = new ZohoMailProvider(
      createEnv({ ZOHO_MAIL_ATTACHMENT_INGESTION_ENABLED: true }),
      fetchMock as typeof fetch
    );

    const result = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-mail",
        provider: "zoho_mail",
        providerCursorJson: null,
        configJson: { accountId: "acct-1", selectedFolderIds: ["inbox"], includeAttachments: true }
      } as any,
      credential: { accessToken: "1000.access-token", apiDomain: "https://www.zoho.com" },
      syncType: "backfill",
      batchSize: 10,
      maxBackfillDays: 90
    });

    expect(result.status).toBe("completed");
    expect(result.batches?.[0]).toMatchObject({
      projectId: "project-1",
      connectorId: "connector-mail",
      provider: "zoho_mail"
    });
    expect(result.batches?.[0]?.threads[0]).toMatchObject({
      providerThreadId: "mail:thread-1",
      subject: "Launch scope decision"
    });
    expect(result.batches?.[0]?.threads[0]?.participants.map((participant) => participant.email)).toEqual(
      expect.arrayContaining(["maya@example.com", "pm@example.com", "qa@example.com"])
    );
    expect(result.batches?.[0]?.messages[0]).toMatchObject({
      providerMessageId: "mail:acct-1:mail-1",
      bodyText: "We should defer billing automation until after pilot approval.",
      senderEmail: "maya@example.com"
    });
    expect(result.batches?.[0]?.messages[0]?.attachments?.[0]).toMatchObject({
      providerAttachmentId: "att-1",
      filename: "scope.pdf"
    });
    expect(JSON.stringify({ batches: result.batches, cursorAfter: result.cursorAfter, summary: result.summary })).not.toContain(
      "1000.access-token"
    );
  });

  it("normalizes only selected Zoho Cliq resources and does not ingest unselected chats", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v2/channels/channel-1/messages") {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "msg-1",
                text: "QA wants approval before shipping the billing connector.",
                created_time: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
                sender: { id: "u1", name: "Priya QA", email: "priya@example.com" }
              }
            ]
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected Zoho Cliq URL ${url.pathname}`);
    });
    const provider = new ZohoCliqProvider(createEnv(), fetchMock as typeof fetch);

    const noSelection = await provider.sync({
      projectId: "project-1",
      connector: { id: "connector-cliq", provider: "zoho_cliq", providerCursorJson: null, configJson: {} } as any,
      credential: { accessToken: "1000.access-token", apiDomain: "https://www.zoho.com" },
      syncType: "backfill",
      batchSize: 10,
      maxBackfillDays: 30
    });
    expect(noSelection.status).toBe("partial");
    expect(noSelection.summary).toMatchObject({ reason: "selected_cliq_channels_or_chats_required" });

    const selected = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-cliq",
        provider: "zoho_cliq",
        providerCursorJson: null,
        configJson: { selectedChannelIds: ["channel-1"], includeDirectChats: false, selectedChatIds: ["private-chat"] }
      } as any,
      credential: { accessToken: "1000.access-token", apiDomain: "https://www.zoho.com" },
      syncType: "backfill",
      batchSize: 10,
      maxBackfillDays: 30
    });
    expect(selected.batches?.[0]?.messages[0]).toMatchObject({
      providerMessageId: "cliq:channel:channel-1:msg-1",
      bodyText: "QA wants approval before shipping the billing connector.",
      senderLabel: "Priya QA"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes selected Zoho CRM modules with an allowlist and redacts unsafe fields", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/crm/v8/settings/modules") {
        return new Response(JSON.stringify({ modules: [{ api_name: "Deals", generated_type: "default" }] }), { status: 200 });
      }
      if (url.pathname === "/crm/v8/Deals") {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "deal-1",
                Deal_Name: "Enterprise pilot",
                Stage: "Proposal",
                Description: "Needs security review before close.",
                Modified_Time: "2026-05-31T12:00:00.000Z",
                Owner: { id: "owner-1", name: "Sarah Owner", email: "sarah@example.com" },
                OAuth_Token: "should-not-leak"
              }
            ],
            info: { more_records: false }
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected Zoho CRM URL ${url.pathname}`);
    });
    const provider = new ZohoCrmProvider(createEnv(), fetchMock as typeof fetch);

    const result = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-crm",
        provider: "zoho_crm",
        providerCursorJson: null,
        configJson: {
          selectedModules: ["Deals"],
          moduleFieldAllowlist: "Deal_Name,Stage,Description,Modified_Time,OAuth_Token"
        }
      } as any,
      credential: { accessToken: "1000.access-token", apiDomain: "https://www.zoho.com" },
      syncType: "backfill",
      batchSize: 10,
      maxBackfillDays: 30
    });

    expect(result.batches?.[0]?.threads[0]).toMatchObject({
      providerThreadId: "crm:Deals:deal-1",
      subject: "Enterprise pilot"
    });
    expect(result.batches?.[0]?.messages[0]?.bodyText).toContain("Needs security review before close.");
    expect(JSON.stringify(result)).not.toContain("should-not-leak");
    expect(result.summary).toMatchObject({
      provider: "zoho_crm",
      writesEnabled: false,
      messageCount: 1
    });
  });

  it("refreshes Zoho credentials once on a 401 and rejects unsafe Zoho API domains", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "1000.refreshed-token", expires_in: 3600, api_domain: "https://www.zoho.com" }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ modules: [{ api_name: "Leads" }] }), { status: 200 }));
    const client = new ZohoApiClient(createEnv(), fetchMock as typeof fetch);
    const result = await client.getCrmModules({
      accessToken: "1000.old-token",
      refreshToken: "1000.refresh-token",
      apiDomain: "https://www.zoho.com",
      accountsServer: "https://accounts.zoho.com"
    });
    expect(result.credential.accessToken).toBe("1000.refreshed-token");

    await expect(
      client.getCrmModules({
        accessToken: "1000.old-token",
        refreshToken: "1000.refresh-token",
        apiDomain: "https://evilzoho.com",
        accountsServer: "https://accounts.zoho.com"
      })
    ).rejects.toMatchObject({ code: "zoho_api_domain_invalid" });
  });

  it("implements ClickUp OAuth, task/comment normalization, and webhook verification as read-only evidence", async () => {
    const env = createEnv({
      CLICKUP_CLIENT_ID: "clickup-client",
      CLICKUP_CLIENT_SECRET: "clickup-secret",
      CLICKUP_REDIRECT_URI: "http://localhost:3000/v1/oauth/clickup/callback",
      CLICKUP_WEBHOOK_SECRET: "clickup-env-webhook-secret"
    });
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "clickup-access-token" }), { status: 200 });
      }
      if (url.endsWith("/team")) {
        return new Response(JSON.stringify({ teams: [{ id: "team-1", name: "Delivery Team" }] }), { status: 200 });
      }
      if (url.includes("/team/team-1/space")) {
        return new Response(JSON.stringify({ spaces: [{ id: "space-1", name: "Client App" }] }), { status: 200 });
      }
      if (url.includes("/space/space-1/list")) {
        return new Response(JSON.stringify({ lists: [{ id: "list-1", name: "Sprint" }] }), { status: 200 });
      }
      if (url.includes("/space/space-1/folder")) {
        return new Response(JSON.stringify({ folders: [{ id: "folder-1", name: "Delivery" }] }), { status: 200 });
      }
      if (url.includes("/folder/folder-1/list")) {
        return new Response(JSON.stringify({ lists: [{ id: "list-2", name: "QA" }] }), { status: 200 });
      }
      if (url.includes("/task/task-1/comment")) {
        return new Response(
          JSON.stringify({
            comments: [
              {
                id: "comment-1",
                comment_text: "Client confirmed the acceptance criteria.",
                date: "1713600100000",
                user: { id: 44, username: "Priya PM", email: "priya@example.test" }
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.includes("/task/task-1")) {
        return new Response(
          JSON.stringify({
            id: "task-1",
            custom_id: "ORCH-1",
            name: "Billing settings MVP",
            text_content: "Implement account-level billing settings with audit trail.",
            markdown_description: "Implement account-level billing settings with audit trail.",
            url: "https://app.clickup.com/t/task-1",
            date_created: "1713600000000",
            date_updated: "1713600200000",
            status: { status: "in progress" },
            priority: { priority: "high" },
            due_date: "1714200000000",
            creator: { id: 33, username: "Manager" },
            assignees: [{ id: 55, username: "Dev" }],
            list: { id: "list-1", name: "Sprint" },
            folder: { id: "folder-1", name: "Delivery" },
            space: { id: "space-1", name: "Client App" },
            team_id: "team-1",
            history_items: [
              {
                id: "hist-1",
                date: "1713600150000",
                type: 1,
                field: "status",
                before: "open",
                after: "in progress",
                user: { id: 44, username: "Priya PM" }
              }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const provider = new ClickUpProvider(env, fetchMock as typeof fetch);
    const connect = await provider.connect({ projectId: "project-1", actorUserId: "dev-1", oauthState: "state-1" });
    expect(connect.redirectUrl).toContain("https://app.clickup.com/api");
    expect(connect.redirectUrl).toContain("client_id=clickup-client");
    expect(connect.redirectUrl).toContain("state=state-1");
    expect(connect.config).toMatchObject({ writeActionsEnabled: false, syncAllWorkspace: false });

    const callback = await provider.handleOAuthCallback?.({
      code: "code-1",
      redirectUri: "http://localhost:3000/v1/oauth/clickup/callback"
    });
    expect(callback).toMatchObject({
      accountLabel: "ClickUp: Delivery Team",
      credential: { accessToken: "clickup-access-token" },
      configPatch: { teamId: "team-1", workspaceId: "team-1" }
    });
    expect(JSON.stringify(callback)).not.toContain("clickup-secret");

    const channels = await provider.listChannels?.({ credential: { accessToken: "clickup-access-token" } });
    expect(channels?.map((channel) => channel.id)).toEqual(expect.arrayContaining(["team:team-1", "space:space-1", "list:list-1", "folder:folder-1", "list:list-2"]));

    const sync = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        projectId: "project-1",
        provider: "clickup",
        configJson: { taskIds: ["task-1"], syncTaskDescriptions: true, syncTaskComments: true }
      } as any,
      credential: { accessToken: "clickup-access-token", teams: [{ id: "team-1", name: "Delivery Team" }] },
      syncType: "backfill",
      batchSize: 10,
      maxBackfillDays: 30
    });
    expect(sync.batches?.[0]?.threads[0]).toMatchObject({
      providerThreadId: "task:task-1",
      subject: "Billing settings MVP",
      threadUrl: "https://app.clickup.com/t/task-1"
    });
    expect(sync.batches?.[0]?.messages.map((message) => message.providerMessageId)).toEqual(
      expect.arrayContaining(["task:task-1:description", "task:task-1:comment:comment-1", "task:task-1:history:hist-1"])
    );
    expect(sync.batches?.[0]?.messages.find((message) => message.providerMessageId.endsWith("history:hist-1"))?.bodyText).toContain(
      "Status changed from open to in progress"
    );

    const rawBody = JSON.stringify({
      webhook_id: "webhook-1",
      event: "taskStatusUpdated",
      task_id: "task-1",
      history_items: [{ id: "hist-2", date: "1713600300000", field: "status", before: "in progress", after: "blocked" }]
    });
    const signature = createHmac("sha256", "stored-webhook-secret").update(rawBody).digest("hex");
    await expect(
      provider.verifyWebhook?.({
        headers: { "x-signature": signature },
        rawBody,
        body: JSON.parse(rawBody),
        connectors: [{ id: "connector-1", configJson: { webhookIds: ["webhook-1"], taskIds: ["task-1"] } } as any],
        credentialsByConnectorId: { "connector-1": { webhookSecrets: { "webhook-1": "stored-webhook-secret" } } }
      })
    ).resolves.toMatchObject({
      providerEventId: "webhook-1:hist-2",
      eventType: "taskStatusUpdated",
      connectorIds: ["connector-1"]
    });

    const unselectedTaskBody = JSON.stringify({
      webhook_id: "webhook-1",
      event: "taskStatusUpdated",
      task_id: "task-999",
      history_items: [{ id: "hist-unselected", date: "1713600300000", field: "status", before: "open", after: "blocked" }]
    });
    const unselectedTaskSignature = createHmac("sha256", "stored-webhook-secret").update(unselectedTaskBody).digest("hex");
    await expect(
      provider.verifyWebhook?.({
        headers: { "x-signature": unselectedTaskSignature },
        rawBody: unselectedTaskBody,
        body: JSON.parse(unselectedTaskBody),
        connectors: [{ id: "connector-1", configJson: { webhookIds: ["webhook-1"], taskIds: ["task-1"] } } as any],
        credentialsByConnectorId: { "connector-1": { webhookSecrets: { "webhook-1": "stored-webhook-secret" } } }
      })
    ).resolves.toMatchObject({
      connectorIds: [],
      jobPayload: { ignored: true, reason: "clickup_resource_not_selected" }
    });

    await expect(
      provider.verifyWebhook?.({
        headers: { "x-signature": signature },
        rawBody,
        body: JSON.parse(rawBody),
        connectors: [{ id: "connector-1", configJson: { webhookIds: ["webhook-1"], taskIds: [], listIds: [], folderIds: [], spaceIds: [] } } as any],
        credentialsByConnectorId: { "connector-1": { webhookSecrets: { "webhook-1": "stored-webhook-secret" } } }
      })
    ).resolves.toMatchObject({
      connectorIds: [],
      jobPayload: { ignored: true, reason: "clickup_resource_not_selected" }
    });

    const listScopedBody = JSON.stringify({
      webhook_id: "webhook-list-1",
      event: "taskStatusUpdated",
      history_items: [{ id: "hist-list-scoped", date: "1713600300000", field: "status", before: "open", after: "blocked" }]
    });
    const listScopedSignature = createHmac("sha256", "stored-webhook-secret").update(listScopedBody).digest("hex");
    await expect(
      provider.verifyWebhook?.({
        headers: { "x-signature": listScopedSignature },
        rawBody: listScopedBody,
        body: JSON.parse(listScopedBody),
        connectors: [{
          id: "connector-1",
          configJson: { webhookIds: ["webhook-list-1"], listIds: ["list-1"], webhookScopes: { "webhook-list-1": { type: "list", id: "list-1" } } }
        } as any],
        credentialsByConnectorId: { "connector-1": { webhookSecrets: { "webhook-list-1": "stored-webhook-secret" } } }
      })
    ).resolves.toMatchObject({
      providerEventId: "webhook-list-1:hist-list-scoped",
      connectorIds: ["connector-1"]
    });

    await expect(
      provider.verifyWebhook?.({
        headers: { "x-signature": listScopedSignature },
        rawBody: listScopedBody,
        body: JSON.parse(listScopedBody),
        connectors: [{ id: "connector-1", configJson: { webhookIds: ["webhook-list-1"], listIds: ["list-1"] } } as any],
        credentialsByConnectorId: { "connector-1": { webhookSecrets: { "webhook-list-1": "stored-webhook-secret" } } }
      })
    ).resolves.toMatchObject({
      connectorIds: [],
      jobPayload: { ignored: true, reason: "clickup_resource_not_selected" }
    });

    const deleteSync = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        projectId: "project-1",
        provider: "clickup",
        configJson: { taskIds: ["task-1"] }
      } as any,
      credential: { accessToken: "clickup-access-token" },
      syncType: "webhook",
      batchSize: 10,
      maxBackfillDays: 30,
      webhookPayload: {
        providerEventId: "webhook-1:hist-delete",
        clickupWebhookPayload: {
          webhook_id: "webhook-1",
          event: "taskDeleted",
          task_id: "task-1",
          history_items: [{ id: "hist-delete", date: "1713600400000" }]
        }
      }
    });
    expect(deleteSync.batches?.[0]?.messages.map((message) => message.providerMessageId)).toContain("task:task-1:history:hist-delete");

    fetchMock.mockClear();
    await expect(
      provider.registerWebhook?.({
        connector: {
          id: "connector-1",
          configJson: { teamId: "team-1", webhookIds: ["webhook-1"], listIds: ["list-1"], webhookScopes: { "webhook-1": { type: "list", id: "list-1" } } }
        } as any,
        credential: { accessToken: "clickup-access-token", webhookSecrets: { "webhook-1": "stored-webhook-secret" } },
        endpointUrl: "https://api.example.test/v1/webhooks/clickup"
      })
    ).resolves.toMatchObject({ webhookId: "webhook-1" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/webhook"))).toBe(false);

    await expect(
      provider.registerWebhook?.({
        connector: { id: "connector-1", configJson: { teamId: "team-1", webhookIds: ["webhook-1"] } } as any,
        credential: { accessToken: "clickup-access-token", webhookSecrets: { "webhook-1": "stored-webhook-secret" } },
        endpointUrl: "https://api.example.test/v1/webhooks/clickup"
      })
    ).rejects.toMatchObject({ code: "clickup_webhook_selected_scope_required" });

    await expect(
      provider.verifyWebhook?.({
        headers: { "x-signature": "bad" },
        rawBody,
        body: JSON.parse(rawBody),
        connectors: [{ id: "connector-1", configJson: { webhookIds: ["webhook-1"], taskIds: ["task-1"] } } as any],
        credentialsByConnectorId: { "connector-1": { webhookSecrets: { "webhook-1": "stored-webhook-secret" } } }
      })
    ).rejects.toMatchObject({ code: "clickup_webhook_signature_invalid" });

    await expect(
      provider.verifyWebhook?.({
        headers: { "x-signature": signature },
        rawBody: "",
        body: JSON.parse(rawBody),
        connectors: [{ id: "connector-1", configJson: { webhookIds: ["webhook-1"] } } as any],
        credentialsByConnectorId: { "connector-1": { webhookSecrets: { "webhook-1": "stored-webhook-secret" } } }
      })
    ).rejects.toMatchObject({ code: "clickup_webhook_raw_body_missing" });

    await expect(
      provider.verifyWebhook?.({
        headers: { "x-signature": signature },
        rawBody,
        body: JSON.parse(rawBody),
        connectors: [{ id: "connector-1", configJson: { webhookIds: ["webhook-1"] } } as any],
        credentialsByConnectorId: { "connector-1": null }
      })
    ).rejects.toMatchObject({ code: "clickup_webhook_secret_missing" });

    const envFallbackProvider = new ClickUpProvider(createEnv({
      CLICKUP_WEBHOOK_SECRET: "stored-webhook-secret",
      CLICKUP_WEBHOOK_SECRET_STORAGE_MODE: "env_fallback"
    }), fetchMock as any);
    await expect(
      envFallbackProvider.verifyWebhook?.({
        headers: { "x-signature": signature },
        rawBody,
        body: JSON.parse(rawBody),
        connectors: [{ id: "connector-1", configJson: { webhookIds: ["webhook-1"], taskIds: ["task-1"] } } as any],
        credentialsByConnectorId: { "connector-1": null }
      })
    ).resolves.toMatchObject({ providerEventId: "webhook-1:hist-2" });
  });

  it("rejects disabled provider connect attempts in MVP mode", async () => {
    const env = createEnv({
      MVP_MODE: true,
      MVP_EQUAL_PROJECT_ACCESS: true,
      MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "fireflies_ai", "slack", "clickup"],
      MVP_ENABLE_ADVANCED_CONNECTORS: false
    });
    const service = new ConnectorsService(
      {} as any,
      env,
      { ensureProjectMemberCanMutate: vi.fn(async () => ({ projectRole: "dev", isActive: true })) } as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      {} as any,
      new Map([["gmail", new GmailProvider(env)]]),
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    await expect(service.connect("project-1", "gmail", "dev-1")).rejects.toMatchObject({
      code: "communication_provider_disabled_in_mvp"
    });
  });

  it("reuses an existing connected manual-import connector for internal imports without rerunning setup", async () => {
    const env = createEnv({
      MVP_MODE: true,
      MVP_EQUAL_PROJECT_ACCESS: true,
      MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "fireflies_ai"]
    });
    const existingConnector = {
      id: "connector-existing",
      projectId: "project-1",
      provider: "manual_import",
      status: "connected",
      accountLabel: "Manual import",
      configJson: {}
    };
    const adapterConnect = vi.fn(async () => ({
      status: "connected",
      accountLabel: "Manual import",
      config: {},
      credential: null
    }));
    const prisma = {
      project: {
        findUniqueOrThrow: vi.fn(async () => ({ orgId: "org-1" }))
      },
      communicationConnector: {
        findFirst: vi.fn(async () => existingConnector),
        update: vi.fn(async () => existingConnector)
      }
    } as any;
    const audit = { record: vi.fn(async () => undefined) };
    const jobs = { enqueue: vi.fn(async () => undefined) };
    const credentialVault = { putCredential: vi.fn(async () => ({ ref: "vault:manual_import:connector-existing" })) };
    const service = new ConnectorsService(
      prisma,
      env,
      { ensureProjectMemberCanMutate: vi.fn(async () => ({ projectRole: "manager", isActive: true })) } as any,
      audit as any,
      jobs as any,
      credentialVault as any,
      new Map([["manual_import", { provider: "manual_import", connect: adapterConnect } as any]]),
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    const reused = await service.connect("project-1", "manual_import", "manager-1");

    expect(reused).toEqual({
      connectorId: "connector-existing",
      provider: "manual_import",
      status: "connected",
      redirectUrl: null
    });
    expect(prisma.project.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(adapterConnect).not.toHaveBeenCalled();
    expect(prisma.communicationConnector.update).not.toHaveBeenCalled();
    expect(credentialVault.putCredential).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();

    await service.connect("project-1", "manual_import", "manager-1", {});

    expect(adapterConnect).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", actorUserId: "manager-1", body: {} }));
    expect(prisma.project.findUniqueOrThrow).toHaveBeenCalledTimes(1);
    expect(prisma.communicationConnector.update).toHaveBeenCalled();
    expect(credentialVault.putCredential).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalled();
  });

  it("rejects disabled provider webhooks in MVP mode before provider verification", async () => {
    const env = createEnv({
      MVP_MODE: true,
      MVP_EQUAL_PROJECT_ACCESS: true,
      MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "fireflies_ai", "slack", "clickup"],
      MVP_ENABLE_ADVANCED_CONNECTORS: false
    });
    const verifyWebhook = vi.fn();
    const service = new ConnectorsService(
      { communicationConnector: { findMany: vi.fn() } } as any,
      env,
      { ensureProjectMemberCanMutate: vi.fn(async () => ({ projectRole: "dev", isActive: true })) } as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      {} as any,
      new Map([["gmail", { provider: "gmail", verifyWebhook } as any]]),
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    await expect(
      service.handleWebhook("gmail", {
        headers: {},
        rawBody: "{}",
        body: {}
      })
    ).rejects.toMatchObject({
      code: "communication_provider_disabled_in_mvp"
    });
    expect(verifyWebhook).not.toHaveBeenCalled();
  });

  it("rejects disabled provider sync attempts in MVP mode", async () => {
    const env = createEnv({
      MVP_MODE: true,
      MVP_EQUAL_PROJECT_ACCESS: true,
      MVP_ENABLED_COMMUNICATION_PROVIDERS: ["manual_import", "fireflies_ai", "slack", "clickup"],
      MVP_ENABLE_ADVANCED_CONNECTORS: false
    });
    const sync = new SyncService(
      {
        communicationConnector: {
          findFirstOrThrow: vi.fn(async () => ({
            id: "connector-1",
            projectId: "project-1",
            provider: "gmail",
            status: "connected",
            providerCursorJson: {}
          }))
        }
      } as any,
      env,
      { ensureProjectMemberCanMutate: vi.fn(async () => ({ projectRole: "dev", isActive: true })) } as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      new CredentialVault(env),
      new Map([["gmail", { provider: "gmail", sync: vi.fn() } as any]]),
      {} as MessageIngestionService,
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    await expect(sync.queueSync("project-1", "connector-1", "dev-1", "manual")).rejects.toMatchObject({
      code: "communication_provider_disabled_in_mvp"
    });
  });

  it("builds Notion OAuth and internal-token foundation without returning credential material in config", async () => {
    const env = createEnv();
    const provider = new NotionProvider(env);

    await expect(provider.connect({ projectId: "project-1", actorUserId: "user-1" })).rejects.toMatchObject({
      code: "notion_oauth_state_required"
    });

    const oauth = await provider.connect({ projectId: "project-1", actorUserId: "user-1", oauthState: "state-123" });
    expect(oauth).toMatchObject({
      mode: "oauth_pending",
      status: "pending_auth",
      accountLabel: "Notion",
      config: {
        selectedNotionRootIds: [],
        selectedNotionPageIds: [],
        selectedNotionDatabaseIds: [],
        selectedNotionMode: "oauth",
        selectedNotionResourceMode: "selected_shared_only"
      }
    });
    expect(oauth.redirectUrl).toContain("client_id=notion-client-id");
    expect(oauth.redirectUrl).toContain("state=state-123");
    expect(JSON.stringify(oauth.config)).not.toMatch(/token|secret|authorization/i);

    const disabledInternal = new NotionProvider(createEnv({ NOTION_INTERNAL_TOKEN_MODE_ENABLED: false }));
    await expect(
      disabledInternal.connect({ projectId: "project-1", actorUserId: "user-1", body: { mode: "internal_token" } })
    ).rejects.toMatchObject({ code: "notion_internal_token_mode_disabled" });

    const internal = await provider.connect({
      projectId: "project-1",
      actorUserId: "user-1",
      body: { mode: "internal_token" }
    });
    expect(internal).toMatchObject({
      mode: "connected",
      status: "connected",
      accountLabel: "Notion Internal",
      config: {
        selectedNotionMode: "internal_token",
        selectedNotionResourceMode: "selected_shared_only"
      },
      credential: {
        provider: "notion",
        mode: "internal_token"
      }
    });
    expect(JSON.stringify(internal.config)).not.toContain("secret_notion_internal_demo");
    expect(JSON.stringify(internal.credential)).toContain("secret_notion_internal_demo");
  });

  it("handles Notion OAuth callback through a credential-only result and no-op foundation sync", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: "notion-oauth-access-token",
            token_type: "bearer",
            workspace_id: "workspace-1",
            workspace_name: "Pilot Workspace",
            bot_id: "bot-1",
            owner: { type: "user", user: { id: "user-1", name: "Karthik" } }
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected Notion URL: ${url}`);
    });
    const provider = new NotionProvider(createEnv(), fetchMock as typeof fetch);

    const callback = await provider.handleOAuthCallback({ code: "temporary-code", redirectUri: "http://localhost/callback" });
    expect(callback).toMatchObject({
      accountLabel: "Pilot Workspace",
      credential: {
        accessToken: "notion-oauth-access-token",
        workspaceId: "workspace-1",
        workspaceName: "Pilot Workspace"
      },
      configPatch: {
        selectedNotionWorkspaceId: "workspace-1",
        selectedNotionMode: "oauth",
        selectedNotionResourceMode: "selected_shared_only",
        selectedNotionRootIds: [],
        selectedNotionPageIds: [],
        selectedNotionDatabaseIds: []
      }
    });
    expect(JSON.stringify(callback.configPatch)).not.toContain("notion-oauth-access-token");

    const sync = await provider.sync({
      projectId: "project-1",
      connector: { id: "connector-1", provider: "notion", configJson: {}, providerCursorJson: {} } as any,
      credential: callback.credential,
      syncType: "backfill",
      batchSize: 50,
      maxBackfillDays: 30
    });
    expect(sync).toMatchObject({
      queued: false,
      status: "completed",
      batches: [],
      summary: {
        provider: "notion",
        selectedResourceMode: "selected_shared_only",
        pagesFetched: 0,
        documentsCreated: 0,
        documentsUpdated: 0,
        skipped: 0,
        noop: true,
        reason: "no_selected_resources"
      }
    });
  });

  it("lists selected Notion resources without exposing credential material", async () => {
    const pageId = "11111111-1111-1111-1111-111111111111";
    const databaseId = "22222222-2222-2222-2222-222222222222";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1/search")) {
        return new Response(
          JSON.stringify({
            object: "list",
            results: [
              {
                object: "page",
                id: pageId,
                url: "https://www.notion.so/Pilot-PRD-11111111111111111111111111111111",
                last_edited_time: "2026-06-01T10:00:00.000Z",
                parent: { type: "workspace" },
                properties: {
                  title: { type: "title", title: [{ plain_text: "Pilot PRD" }] }
                }
              },
              {
                object: "database",
                id: databaseId,
                url: "https://www.notion.so/Tasks-22222222222222222222222222222222",
                last_edited_time: "2026-06-01T11:00:00.000Z",
                parent: { type: "page_id" },
                title: [{ plain_text: "Tasks" }]
              }
            ],
            next_cursor: null,
            has_more: false
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected Notion URL: ${url}`);
    });
    const provider = new NotionProvider(createEnv(), fetchMock as typeof fetch);

    const result = await provider.listResources!({
      connector: {
        id: "connector-1",
        provider: "notion",
        configJson: {
          selectedNotionPageIds: [pageId],
          selectedNotionResourceLabels: [{ id: pageId, label: "Pilot PRD", type: "page" }]
        }
      } as any,
      credential: { accessToken: "secret_notion_token", workspaceId: "workspace-1" },
      query: { search: "pilot", limit: 10 }
    });

    expect(result.resources).toEqual([
      expect.objectContaining({ id: pageId, type: "page", title: "Pilot PRD", selected: true }),
      expect.objectContaining({ id: databaseId, type: "database", title: "Tasks", selected: false })
    ]);
    expect(JSON.stringify(result)).not.toContain("secret_notion_token");
  });

  it("syncs only selected Notion pages into document workspace resources", async () => {
    const pageId = "11111111-1111-1111-1111-111111111111";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(`/v1/pages/${encodeURIComponent(pageId)}`)) {
        return new Response(
          JSON.stringify({
            object: "page",
            id: pageId,
            url: "https://www.notion.so/Pilot-PRD-11111111111111111111111111111111",
            last_edited_time: "2026-06-01T10:00:00.000Z",
            properties: {
              Name: { type: "title", title: [{ plain_text: "Pilot PRD" }] },
              Status: { type: "status", status: { name: "Ready" } }
            }
          }),
          { status: 200 }
        );
      }
      if (url.includes(`/v1/blocks/${encodeURIComponent(pageId)}/children`)) {
        return new Response(
          JSON.stringify({
            object: "list",
            results: [
              {
                object: "block",
                id: "block-1",
                type: "paragraph",
                has_children: false,
                paragraph: { rich_text: [{ plain_text: "Backpackers need itinerary collaboration and budget planning." }] }
              },
              {
                object: "block",
                id: "block-2",
                type: "heading_2",
                has_children: false,
                heading_2: { rich_text: [{ plain_text: "Acceptance criteria" }] }
              }
            ],
            next_cursor: null,
            has_more: false
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected Notion URL: ${url}`);
    });
    const provider = new NotionProvider(createEnv(), fetchMock as typeof fetch);

    const result = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        provider: "notion",
        configJson: {
          selectedNotionPageIds: [pageId],
          selectedNotionResourceLabels: [{ id: pageId, label: "Pilot PRD", type: "page" }]
        },
        providerCursorJson: {}
      } as any,
      credential: { accessToken: "secret_notion_token", workspaceId: "workspace-1" },
      syncType: "manual",
      batchSize: 50,
      maxBackfillDays: 30
    });

    expect(result.batches).toEqual([]);
    expect(result.documentResources).toHaveLength(1);
    expect(result.documentResources?.[0]).toMatchObject({
      provider: "notion",
      providerResourceId: pageId,
      resourceType: "page",
      selectedResourceId: pageId,
      selectedResourceLabel: "Pilot PRD",
      title: "Pilot PRD"
    });
    expect(result.documentResources?.[0]?.content).toContain("Backpackers need itinerary collaboration");
    expect(result.summary).toMatchObject({
      provider: "notion",
      selectedResourceMode: "selected_shared_only",
      documentsReadyForIndexing: 1,
      skipped: 0
    });
    expect(JSON.stringify(result)).not.toContain("secret_notion_token");
  });

  it("skips inaccessible selected Notion pages without failing the whole sync", async () => {
    const pageId = "33333333-3333-3333-3333-333333333333";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ object: "error", message: "restricted" }), { status: 403 }));
    const provider = new NotionProvider(createEnv(), fetchMock as typeof fetch);

    const result = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        provider: "notion",
        configJson: { selectedNotionPageIds: [pageId] },
        providerCursorJson: {}
      } as any,
      credential: { accessToken: "secret_notion_token", workspaceId: "workspace-1" },
      syncType: "manual",
      batchSize: 50,
      maxBackfillDays: 30
    });

    expect(result.status).toBe("partial");
    expect(result.documentResources).toEqual([]);
    expect(result.skippedDocumentResources).toEqual([
      expect.objectContaining({
        providerResourceId: pageId,
        skipReason: "inaccessible"
      })
    ]);
  });

  it("persists selected Notion resources through Project Memory without storing credential material", async () => {
    const uploadFile = vi.fn(async () => ({
      documentId: "doc-1",
      documentVersionId: "version-1",
      status: "pending"
    }));
    const upsert = vi.fn(async () => ({}));
    const service = new SyncService(
      {
        project: {
          findUniqueOrThrow: vi.fn(async () => ({ orgId: "org-1" }))
        },
        projectNotionResource: {
          findUnique: vi.fn(async () => null),
          upsert,
          update: vi.fn()
        }
      } as any,
      createEnv(),
      {} as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      new CredentialVault(createEnv()),
      new Map(),
      {} as MessageIngestionService,
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any,
      { uploadFile } as any
    );

    const result = await (service as any).persistDocumentWorkspaceResources({
      connector: { id: "connector-1", provider: "notion", projectId: "project-1", createdBy: "manager-1" },
      projectId: "project-1",
      resources: [
        {
          provider: "notion",
          providerResourceId: "page-1",
          resourceType: "page",
          selectedResourceId: "page-1",
          selectedResourceLabel: "Launch PRD",
          title: "Launch PRD",
          url: "https://www.notion.so/page-1",
          content: "# Launch PRD\n\nOnly selected content.",
          contentHash: "hash-1",
          metadata: {
            source: "notion",
            token: "must-not-persist",
            nested: { Authorization: "Bearer secret" }
          }
        }
      ],
      skippedResources: []
    });

    expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        actorUserId: "manager-1",
        sourceLabel: "notion",
        title: "Launch PRD",
        contentType: "text/markdown"
      })
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          documentId: "doc-1",
          documentVersionId: "version-1",
          notionResourceId: "page-1",
          selectedResourceLabel: "Launch PRD",
          metadataJson: { source: "notion", nested: {} }
        })
      })
    );
    expect(JSON.stringify(upsert.mock.calls)).not.toContain("must-not-persist");
    expect(JSON.stringify(upsert.mock.calls)).not.toContain("Bearer secret");
    expect(result.summary).toMatchObject({
      notionDocumentsCreated: 1,
      notionDocumentsUpdated: 0,
      notionDocumentsUnchanged: 0,
      notionSkippedResources: 0
    });
  });

  it("builds Teams OAuth with delegated read scopes and selected-resource config", async () => {
    const provider = new TeamsProvider(createEnv());
    const result = await provider.connect({ oauthState: "state-abc" });
    const scope = new URL(result.redirectUrl!).searchParams.get("scope") ?? "";

    expect(result).toMatchObject({
      mode: "oauth_pending",
      status: "pending_auth",
      accountLabel: "Microsoft Teams",
      config: {
        selectedMicrosoftTenantId: null,
        selectedMicrosoftTeamIds: [],
        selectedMicrosoftChannelIds: [],
        selectedMicrosoftChatIds: [],
        selectedMicrosoftResourceConsentMode: "delegated",
        includeBotMessages: false
      }
    });
    expect(scope.split(" ")).toEqual(
      expect.arrayContaining([
        "openid",
        "profile",
        "offline_access",
        "User.Read",
        "Team.ReadBasic.All",
        "Channel.ReadBasic.All",
        "ChannelMessage.Read.All",
        "Chat.Read"
      ])
    );
    expect(JSON.stringify(result.config)).not.toMatch(/token|secret|authorization/i);
  });

  it("does not call Microsoft Graph when Teams has no selected resources", async () => {
    const fetchMock = vi.fn();
    const provider = new TeamsProvider(createEnv(), fetchMock as typeof fetch);
    const result = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        provider: "microsoft_teams",
        configJson: {
          selectedMicrosoftTeamIds: [],
          selectedMicrosoftChannelIds: [],
          selectedMicrosoftChatIds: [],
          selectedMicrosoftResourceConsentMode: "delegated"
        },
        providerCursorJson: {}
      } as any,
      credential: { accessToken: "teams-access", expiryDate: Date.now() + 3600_000 },
      syncType: "backfill",
      batchSize: 50,
      maxBackfillDays: 30
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      queued: false,
      status: "completed",
      summary: {
        provider: "microsoft_teams",
        selectedResourceMode: "selected_teams_channels_chats_only",
        teamCount: 0,
        messageCount: 0,
        threadCount: 0
      }
    });
  });

  it("lists selected Microsoft Teams, channels, and chats without message export", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/me/joinedTeams")) {
        return new Response(JSON.stringify({ value: [{ id: "team-1", displayName: "Product", description: "Product team" }] }));
      }
      if (url.includes("/teams/team-1/channels")) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "channel-1",
                displayName: "Launch",
                description: "Launch work",
                membershipType: "standard",
                webUrl: "https://teams.microsoft.com/channel-1"
              }
            ]
          })
        );
      }
      if (url.includes("/me/chats")) {
        return new Response(
          JSON.stringify({
            value: [{ id: "chat-1", topic: "Founder sync", chatType: "group", lastUpdatedDateTime: "2026-06-01T12:00:00Z" }]
          })
        );
      }
      return new Response(JSON.stringify({ value: [] }));
    });
    const provider = new TeamsProvider(createEnv(), fetchMock as typeof fetch);

    const result = await provider.listResources!({
      connector: {
        id: "connector-1",
        provider: "microsoft_teams",
        configJson: {
          selectedMicrosoftTeamIds: ["team-1"],
          selectedMicrosoftChannelIds: ["team:team-1:channel:channel-1"],
          selectedMicrosoftChatIds: ["chat-1"],
          includeMicrosoftChats: true
        }
      } as any,
      credential: { accessToken: "teams-access", expiryDate: Date.now() + 3600_000 }
    });

    expect(result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "team-1", type: "team", title: "Product", selected: true }),
        expect.objectContaining({
          id: "team:team-1:channel:channel-1",
          type: "channel",
          title: "Launch",
          parentLabel: "Product",
          selected: true
        }),
        expect.objectContaining({ id: "chat-1", type: "chat", title: "Founder sync", selected: true })
      ])
    );
    expect(calls.some((url) => url.includes("/messages"))).toBe(false);
  });

  it("syncs selected Teams channel roots and replies into neutral communication evidence", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/channels/channel-1/messages?")) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "root-1",
                messageType: "message",
                createdDateTime: "2026-06-01T10:00:00Z",
                lastModifiedDateTime: "2026-06-01T10:01:00Z",
                from: { user: { id: "user-1", displayName: "Maya Reddy" } },
                body: { contentType: "html", content: "<p>We need to approve the onboarding scope before Friday.</p>" },
                webUrl: "https://teams.microsoft.com/l/message/root-1",
                attachments: [{ id: "att-1", name: "scope.docx", contentType: "reference", contentUrl: "https://contoso.sharepoint.com/scope.docx" }]
              }
            ]
          })
        );
      }
      if (url.includes("/messages/root-1/replies")) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "reply-1",
                messageType: "message",
                createdDateTime: "2026-06-01T10:05:00Z",
                from: { user: { id: "user-2", displayName: "Priya S" } },
                body: { contentType: "html", content: "<p>Agreed, but keep GitHub evidence read-only.</p>" },
                webUrl: "https://teams.microsoft.com/l/message/reply-1"
              }
            ]
          })
        );
      }
      return new Response(JSON.stringify({ value: [] }));
    });
    const provider = new TeamsProvider(createEnv(), fetchMock as typeof fetch);

    const result = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        provider: "microsoft_teams",
        configJson: {
          selectedMicrosoftTeamIds: ["team-1"],
          selectedMicrosoftChannelIds: ["team:team-1:channel:channel-1"],
          selectedMicrosoftResourceLabels: [{ id: "team-1", label: "Product" }],
          selectedMicrosoftChannelLabels: [{ id: "team:team-1:channel:channel-1", label: "Launch" }]
        },
        providerCursorJson: {}
      } as any,
      credential: { accessToken: "teams-access", expiryDate: Date.now() + 3600_000 },
      syncType: "backfill",
      batchSize: 50,
      maxBackfillDays: 30
    });

    const batch = result.batches?.[0];
    expect(batch?.provider).toBe("microsoft_teams");
    expect(batch?.threads).toHaveLength(1);
    expect(batch?.messages).toHaveLength(2);
    expect(batch?.threads[0]).toMatchObject({
      subject: "Microsoft Teams · Product / Launch",
      rawMetadata: expect.objectContaining({ sourceSubType: "teams_channel" })
    });
    expect(batch?.messages[0]).toMatchObject({
      providerThreadId: batch?.threads[0].providerThreadId,
      senderLabel: "Maya Reddy",
      bodyText: "We need to approve the onboarding scope before Friday.",
      attachments: [expect.objectContaining({ filename: "scope.docx" })],
      rawMetadata: expect.objectContaining({ sourceSubType: "teams_channel_message" })
    });
    expect(batch?.messages[1]).toMatchObject({
      replyToProviderMessageId: "microsoft_teams:channel:team-1:channel-1:root-1",
      bodyText: "Agreed, but keep GitHub evidence read-only.",
      rawMetadata: expect.objectContaining({ sourceSubType: "teams_channel_reply" })
    });
    expect(result.cursorAfter).toMatchObject({ channels: { "team:team-1:channel:channel-1": { latestCreatedDateTime: "2026-06-01T10:05:00Z" } } });
    expect(calls.some((url) => url.includes("contoso.sharepoint.com"))).toBe(false);
  });

  it("syncs selected Teams chats only when chat sync is explicitly enabled", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/chats/chat-1/messages")) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "chat-message-1",
                messageType: "message",
                createdDateTime: "2026-06-01T11:00:00Z",
                from: { user: { id: "user-1", displayName: "Maya Reddy" } },
                body: { contentType: "html", content: "<p>Calendar launch review moved to Tuesday.</p>" }
              }
            ]
          })
        );
      }
      return new Response(JSON.stringify({ value: [] }));
    });
    const provider = new TeamsProvider(createEnv(), fetchMock as typeof fetch);

    const disabled = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        provider: "microsoft_teams",
        configJson: {
          selectedMicrosoftChatIds: ["chat-1"],
          includeMicrosoftChats: false
        },
        providerCursorJson: {}
      } as any,
      credential: { accessToken: "teams-access", expiryDate: Date.now() + 3600_000 },
      syncType: "backfill",
      batchSize: 50,
      maxBackfillDays: 30
    });

    expect(disabled.batches).toEqual([]);
    expect(calls.some((url) => url.includes("/chats/chat-1/messages"))).toBe(false);

    const enabled = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        provider: "microsoft_teams",
        configJson: {
          selectedMicrosoftChatIds: ["chat-1"],
          selectedMicrosoftChatLabels: [{ id: "chat-1", label: "Founder sync" }],
          includeMicrosoftChats: true
        },
        providerCursorJson: {}
      } as any,
      credential: { accessToken: "teams-access", expiryDate: Date.now() + 3600_000 },
      syncType: "backfill",
      batchSize: 50,
      maxBackfillDays: 30
    });

    expect(enabled.batches?.[0].threads[0]).toMatchObject({
      subject: "Microsoft Teams · Founder sync",
      rawMetadata: expect.objectContaining({ sourceSubType: "teams_chat" })
    });
    expect(enabled.batches?.[0].messages[0]).toMatchObject({
      bodyText: "Calendar launch review moved to Tuesday.",
      rawMetadata: expect.objectContaining({ sourceSubType: "teams_chat_message" })
    });
  });

  it("reports deleted Teams messages as provider deletions without ingesting message bodies", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/channels/channel-1/messages?")) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "deleted-1",
                messageType: "message",
                createdDateTime: "2026-06-01T10:00:00Z",
                deletedDateTime: "2026-06-01T10:10:00Z",
                body: { contentType: "html", content: "<p>removed</p>" }
              }
            ]
          })
        );
      }
      return new Response(JSON.stringify({ value: [] }));
    });
    const provider = new TeamsProvider(createEnv(), fetchMock as typeof fetch);

    const result = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        provider: "microsoft_teams",
        configJson: {
          selectedMicrosoftTeamIds: ["team-1"],
          selectedMicrosoftChannelIds: ["team:team-1:channel:channel-1"]
        },
        providerCursorJson: {}
      } as any,
      credential: { accessToken: "teams-access", expiryDate: Date.now() + 3600_000 },
      syncType: "backfill",
      batchSize: 50,
      maxBackfillDays: 30
    });

    expect(result.batches).toEqual([]);
    expect(result.deletedProviderMessageIds).toEqual(["microsoft_teams:channel:team-1:channel-1:deleted-1"]);
  });

  it("blocks production inline queue mode and exposes retry policy metadata", () => {
    expect(() => assertProductionQueueMode(createEnv({ NODE_ENV: "production", QUEUE_MODE: "inline" }))).toThrow(
      /QUEUE_MODE=bullmq/
    );

    expect(getJobExecutionPolicy(JobNames.syncCommunicationConnector, createEnv())).toMatchObject({
      attempts: 3,
      backoffMs: 1000,
      heavy: true,
      concurrencyGroup: "communication"
    });
    expect(getJobExecutionPolicy(JobNames.refreshDashboardSnapshot, createEnv())).toMatchObject({
      heavy: false,
      concurrencyGroup: "dashboard"
    });
  });

  it("keeps provider-controlled error text out of user-facing connector errors", async () => {
    const sensitiveProviderText = "invalid token Bearer xoxb-secret-value client_secret=provider-secret";

    const slackProvider = new SlackProvider(
      createEnv(),
      vi.fn(async () => new Response(JSON.stringify({ ok: false, error: sensitiveProviderText }), { status: 400 })) as typeof fetch
    );
    const slackError = await slackProvider
      .handleOAuthCallback({ code: "code", redirectUri: "http://localhost:3000/v1/oauth/slack/callback" })
      .catch((error) => error as AppError);
    expect(slackError).toMatchObject({ code: "slack_oauth_failed", message: "Slack OAuth callback failed" });
    expect(JSON.stringify(slackError)).not.toContain("xoxb-secret-value");
    expect(JSON.stringify(slackError)).not.toContain("provider-secret");

    const gmailProvider = new GmailProvider(
      createEnv(),
      vi.fn(async () => new Response(JSON.stringify({ error_description: sensitiveProviderText }), { status: 400 })) as typeof fetch
    );
    const gmailError = await gmailProvider
      .handleOAuthCallback({ code: "code", redirectUri: "http://localhost:3000/v1/oauth/google/callback" })
      .catch((error) => error as AppError);
    expect(gmailError).toMatchObject({ code: "google_oauth_failed", message: "Google OAuth callback failed" });
    expect(JSON.stringify(gmailError)).not.toContain("xoxb-secret-value");
    expect(JSON.stringify(gmailError)).not.toContain("provider-secret");

    const clickupProvider = new ClickUpProvider(
      createEnv(),
      vi.fn(async () => new Response(JSON.stringify({ err: sensitiveProviderText }), { status: 401 })) as typeof fetch
    );
    const clickupError = await clickupProvider
      .listChannels({ credential: { accessToken: "clickup-access-token" } })
      .catch((error) => error as AppError);
    expect(clickupError).toMatchObject({ code: "clickup_api_error", message: "ClickUp API request failed" });
    expect(JSON.stringify(clickupError)).not.toContain("xoxb-secret-value");
    expect(JSON.stringify(clickupError)).not.toContain("provider-secret");

    const microsoftError = await callMicrosoftGraph(
      vi.fn(async () => new Response(sensitiveProviderText, { status: 500 })) as typeof fetch,
      { accessToken: "token" },
      "/me/messages"
    ).catch((error) => error as AppError);
    expect(microsoftError).toMatchObject({ code: "microsoft_api_error", message: "Microsoft API request failed" });
    expect(JSON.stringify(microsoftError)).not.toContain("xoxb-secret-value");
    expect(JSON.stringify(microsoftError)).not.toContain("provider-secret");
  });

  it("rejects non-Graph absolute Microsoft URLs before provider HTTP dispatch", async () => {
    const fetchMock = vi.fn();

    await expect(
      callMicrosoftGraph(fetchMock as typeof fetch, { accessToken: "token" }, "https://evil.example/v1.0/me")
    ).rejects.toMatchObject({
      code: "microsoft_graph_host_not_allowed"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires signed Microsoft webhook clientState values outside local development", async () => {
    const env = createEnv({ NODE_ENV: "test" });
    const provider = new OutlookProvider(env);
    const teamsProvider = new TeamsProvider(env);

    await expect(
      provider.verifyWebhook({
        body: { value: [{ clientState: "connector-1", subscriptionId: "sub-1", resourceData: { id: "msg-1" } }] },
        query: {}
      })
    ).rejects.toMatchObject({ code: "microsoft_webhook_client_state_invalid" });
    await expect(
      provider.verifyWebhook({
        body: { value: [{ subscriptionId: "sub-1", resourceData: { id: "msg-1" } }] },
        query: {}
      })
    ).rejects.toMatchObject({ code: "microsoft_webhook_client_state_invalid" });

    const signed = signMicrosoftWebhookClientState("connector-1", env.CONNECTOR_OAUTH_STATE_SECRET);
    const noisyNotification = {
      clientState: signed,
      subscriptionId: "sub-1",
      changeType: "updated",
      resource: `${"resource/".repeat(120)}secret-token-should-not-persist`,
      resourceData: {
        id: "msg-1",
        "@odata.type": "#microsoft.graph.message",
        "@odata.id": `${"https://graph.example/messages/".repeat(40)}secret-token-should-not-persist`,
        body: "large raw provider body that should not enter webhook job payload"
      },
      attackerControlledBlob: "secret-token-should-not-persist"
    };
    const verified = await provider.verifyWebhook({
      body: { value: [noisyNotification] },
      query: {}
    });
    expect(verified.connectorIds).toEqual(["connector-1"]);
    expect(JSON.stringify(verified.jobPayload)).not.toContain("attackerControlledBlob");
    expect(JSON.stringify(verified.jobPayload)).not.toContain("large raw provider body");

    await expect(
      teamsProvider.verifyWebhook({
        body: { value: [{ clientState: "connector-1", subscriptionId: "sub-1", resourceData: { id: "msg-1" } }] },
        query: {}
      })
    ).rejects.toMatchObject({ code: "microsoft_webhook_client_state_invalid" });
    await expect(
      teamsProvider.verifyWebhook({
        body: { value: [{ subscriptionId: "sub-1", resourceData: { id: "msg-1" } }] },
        query: {}
      })
    ).rejects.toMatchObject({ code: "microsoft_webhook_client_state_invalid" });

    const teamsVerified = await teamsProvider.verifyWebhook({
      body: { value: [noisyNotification] },
      query: {}
    });
    expect(teamsVerified.connectorIds).toEqual(["connector-1"]);
    expect(JSON.stringify(teamsVerified.jobPayload)).not.toContain("attackerControlledBlob");
    expect(JSON.stringify(teamsVerified.jobPayload)).not.toContain("large raw provider body");
  });

  it("requires WhatsApp app secret before accepting inbound POST webhooks", async () => {
    const provider = new WhatsAppBusinessProvider(
      createEnv({ WHATSAPP_READINESS_MODE: "webhook_inbound", WHATSAPP_APP_SECRET: undefined })
    );

    await expect(
      provider.verifyWebhook({
        headers: {},
        rawBody: JSON.stringify({ entry: [] }),
        body: { entry: [] },
        connectors: [],
        query: {}
      })
    ).rejects.toMatchObject({
      code: "whatsapp_webhook_app_secret_missing"
    });
  });

  it("stores credentials only through the vault envelope and can retrieve them", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "orchestra-vault-"));
    const originalCwd = process.cwd();
    process.chdir(tempRoot);

    try {
      const env = createEnv({
        CONNECTOR_CREDENTIAL_VAULT_MODE: "encrypted_file"
      });
      const vault = new CredentialVault(env);
      const stored = await vault.putCredential({
        provider: "slack",
        connectorId: "connector-1",
        credential: { accessToken: "xoxb-secret-token", refreshToken: "secret-refresh" }
      });

      const fileContents = await readFile(
        path.join(tempRoot, "storage", ".vault", "connectors", "vault_slack_connector-1.json"),
        "utf8"
      );
      expect(fileContents).not.toContain("xoxb-secret-token");
      expect(stored.ref).toContain("vault:slack:connector-1");

      const credential = await vault.getCredential("slack", "connector-1", stored.ref);
      expect(credential).toEqual(
        expect.objectContaining({
          accessToken: "xoxb-secret-token"
        })
      );
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses a credential encryption key separate from the OAuth state secret", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "orchestra-vault-"));
    const originalCwd = process.cwd();
    process.chdir(tempRoot);

    try {
      const env = createEnv({
        CONNECTOR_CREDENTIAL_VAULT_MODE: "encrypted_file",
        CONNECTOR_OAUTH_STATE_SECRET: "oauth-state-secret-a",
        CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: "credential-encryption-key-a"
      });
      const vault = new CredentialVault(env);
      const stored = await vault.putCredential({
        provider: "slack",
        connectorId: "connector-2",
        credential: { accessToken: "xoxb-secret-token" }
      });

      const sameOauthDifferentEncryption = new CredentialVault({
        ...env,
        CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: "credential-encryption-key-b"
      });
      await expect(
        sameOauthDifferentEncryption.getCredential("slack", "connector-2", stored.ref)
      ).rejects.toThrow();
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("requires external managed secret references in managed credential-vault mode", async () => {
    const vault = new CredentialVault(
      createEnv({
        CONNECTOR_CREDENTIAL_VAULT_MODE: "managed_reference",
        CONNECTOR_MANAGED_SECRET_PREFIX: "orchestra/prod/"
      })
    );

    await expect(
      vault.putCredential({
        provider: "slack",
        connectorId: "connector-managed",
        credential: { accessToken: "xoxb-secret-token" }
      })
    ).rejects.toMatchObject({ code: "managed_credential_reference_required" });

    await expect(
      vault.putCredential({
        provider: "slack",
        connectorId: "connector-managed",
        credential: { managedSecretRef: "other/slack/connector-managed" }
      })
    ).rejects.toMatchObject({ code: "managed_credential_reference_invalid" });

    const stored = await vault.putCredential({
      provider: "slack",
      connectorId: "connector-managed",
      credential: { managedSecretRef: "orchestra/prod/slack/connector-managed" }
    });

    expect(stored.ref).toBe("orchestra/prod/slack/connector-managed");
    await expect(vault.getCredential("slack", "connector-managed", stored.ref)).rejects.toMatchObject({
      code: "managed_credential_resolution_unavailable"
    });
  });

  it("builds Slack OAuth URLs and exchanges callbacks into credentials", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      expect(String(input)).toContain("oauth.v2.access");
      return new Response(
        JSON.stringify({
          ok: true,
          access_token: "xoxb-test",
          scope: "channels:history",
          team: { id: "T123", name: "Arrayah" },
          authed_user: { id: "U123" },
          bot_user_id: "B123"
        }),
        { status: 200 }
      );
    });

    const provider = new SlackProvider(createEnv(), fetchMock as typeof fetch);
    const connect = await provider.connect({ oauthState: "signed-state" });
    expect(connect.redirectUrl).toContain("state=signed-state");

    const callback = await provider.handleOAuthCallback({
      code: "test-code",
      redirectUri: "http://localhost:3000/v1/oauth/slack/callback"
    });

    expect(callback.accountLabel).toBe("Arrayah");
    expect(callback.credential).toEqual(
      expect.objectContaining({
        accessToken: "xoxb-test",
        teamId: "T123"
      })
    );
  });

  it("syncs Slack history plus replies and verifies webhook signatures", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("conversations.history")) {
        return new Response(
          JSON.stringify({
            ok: true,
            messages: [
              {
                ts: "1713600000.000100",
                thread_ts: "1713600000.000100",
                text: "Need weekly reporting",
                user: "U123",
                reply_count: 1
              }
            ],
            response_metadata: { next_cursor: "" }
          }),
          { status: 200 }
        );
      }

      if (url.includes("conversations.replies")) {
        return new Response(
          JSON.stringify({
            ok: true,
            messages: [
              {
                ts: "1713600000.000100",
                thread_ts: "1713600000.000100",
                text: "Need weekly reporting",
                user: "U123"
              },
              {
                ts: "1713600060.000200",
                thread_ts: "1713600000.000100",
                text: "Approved by client",
                user: "U456"
              }
            ]
          }),
          { status: 200 }
        );
      }

      throw new Error(`Unexpected Slack URL: ${url}`);
    });

    const provider = new SlackProvider(createEnv(), fetchMock as typeof fetch);
    const result = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        projectId: "project-1",
        provider: "slack",
        accountLabel: "Slack",
        status: "connected",
        configJson: { channelIds: ["C123"], includeBotMessages: false, backfillDays: 30 },
        providerCursorJson: { channels: {} }
      } as any,
      credential: { accessToken: "xoxb-test", teamId: "T123", teamName: "Arrayah" },
      syncType: "backfill",
      batchSize: 50,
      maxBackfillDays: 30
    });

    expect(result.batches?.[0]?.messages).toHaveLength(2);
    expect(result.batches?.[0]?.threads).toHaveLength(1);
    expect(result.batches?.[0]?.threads[0]).toMatchObject({
      providerThreadId: "C123:1713600000.000100",
      threadUrl: "https://app.slack.com/client/T123/C123/p1713600000000100"
    });
    expect(result.batches?.[0]?.messages.map((message) => message.providerMessageId)).toEqual([
      "C123:1713600000.000100",
      "C123:1713600060.000200"
    ]);
    expect(result.batches?.[0]?.messages[1]).toMatchObject({
      providerThreadId: "C123:1713600000.000100",
      replyToProviderMessageId: "C123:1713600000.000100",
      providerPermalink: "https://app.slack.com/client/T123/C123/p1713600060000200"
    });

    const rawBody = JSON.stringify({
      type: "url_verification",
      challenge: "challenge-token"
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac("sha256", "slack-signing-secret")
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex")}`;

    const verified = await provider.verifyWebhook({
      headers: {
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature
      },
      rawBody,
      body: JSON.parse(rawBody),
      connectors: []
    });

    expect(verified.handledImmediately?.body).toEqual({ challenge: "challenge-token" });

    await expect(
      provider.verifyWebhook({
        headers: {
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": "v0=bad"
        },
        rawBody,
        body: JSON.parse(rawBody),
        connectors: []
      })
    ).rejects.toMatchObject({ code: "slack_webhook_signature_invalid" });

    await expect(
      provider.verifyWebhook({
        headers: {
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature
        },
        rawBody: "",
        body: JSON.parse(rawBody),
        connectors: []
      })
    ).rejects.toMatchObject({ code: "slack_webhook_raw_body_missing" });
  });

  it("bounds Slack webhook job payloads to normalized event fields", async () => {
    const provider = new SlackProvider(createEnv(), vi.fn() as any);
    const eventBody = {
      type: "event_callback",
      team_id: "T123",
      event_id: "Ev123",
      event: {
        type: "message",
        channel: "C123",
        ts: "1713600000.000100",
        event_ts: "1713600000.000100",
        user: "U123",
        text: "Webhook evidence text",
        attackerControlledBlob: "large raw provider body",
        files: [{ url_private: "https://files.slack.com/secret" }]
      }
    };
    const rawBody = JSON.stringify(eventBody);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac("sha256", "slack-signing-secret")
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex")}`;

    const verified = await provider.verifyWebhook({
      headers: {
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature
      },
      rawBody,
      body: eventBody,
      connectors: [{ id: "connector-1", configJson: { teamId: "T123", channelIds: ["C123"] } } as any]
    });

    expect(verified.connectorIds).toEqual(["connector-1"]);
    expect(JSON.stringify(verified.jobPayload)).not.toContain("attackerControlledBlob");
    expect(JSON.stringify(verified.jobPayload)).not.toContain("large raw provider body");
    expect(JSON.stringify(verified.jobPayload)).not.toContain("url_private");
  });

  it("does not enqueue Slack webhook evidence when no channels are selected", async () => {
    const provider = new SlackProvider(createEnv(), vi.fn() as any);
    const eventBody = {
      type: "event_callback",
      team_id: "T123",
      event_id: "EvUnselected",
      event: {
        type: "message",
        channel: "C999",
        ts: "1713600000.000100",
        event_ts: "1713600000.000100",
        user: "U123",
        text: "This channel was not selected for Socrates."
      }
    };
    const rawBody = JSON.stringify(eventBody);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac("sha256", "slack-signing-secret")
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex")}`;

    const verified = await provider.verifyWebhook({
      headers: {
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature
      },
      rawBody,
      body: eventBody,
      connectors: [{ id: "connector-1", configJson: { teamId: "T123", channelIds: [] } } as any]
    });

    expect(verified.connectorIds).toEqual([]);
    expect(verified.jobPayload).toMatchObject({
      ignored: true,
      reason: "slack_channel_not_selected"
    });
  });

  it("keeps Slack file attachment URLs out of evidence unless file ingestion is explicitly enabled", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          messages: [
            {
              ts: "1713600000.000100",
              text: "Attached latest mockup",
              user: "U123",
              subtype: "file_share",
              files: [
                {
                  id: "F123",
                  name: "mockup.png",
                  mimetype: "image/png",
                  size: 1234,
                  url_private: "https://files.slack.com/files-pri/T123-F123/mockup.png",
                  title: "Mockup"
                }
              ]
            }
          ],
          response_metadata: { next_cursor: "" }
        }),
        { status: 200 }
      )
    );
    const connector = {
      id: "connector-1",
      projectId: "project-1",
      provider: "slack",
      accountLabel: "Slack",
      status: "connected",
      configJson: { channelIds: ["C123"], includeBotMessages: false, backfillDays: 30 },
      providerCursorJson: { channels: {} }
    } as any;
    const credential = { accessToken: "xoxb-test", teamId: "T123", teamName: "Arrayah" };

    const metadataOnly = await new SlackProvider(createEnv(), fetchMock as typeof fetch).sync({
      projectId: "project-1",
      connector,
      credential,
      syncType: "backfill",
      batchSize: 50,
      maxBackfillDays: 30
    });
    expect(metadataOnly.batches?.[0]?.messages[0]?.attachments?.[0]).toMatchObject({
      providerAttachmentId: "F123",
      filename: "mockup.png",
      providerUrl: null
    });

    const withFileUrls = await new SlackProvider(
      createEnv({ SLACK_FILE_INGESTION_ENABLED: true }),
      fetchMock as typeof fetch
    ).sync({
      projectId: "project-1",
      connector,
      credential,
      syncType: "backfill",
      batchSize: 50,
      maxBackfillDays: 30
    });
    expect(withFileUrls.batches?.[0]?.messages[0]?.attachments?.[0]?.providerUrl).toBe(
      "https://files.slack.com/files-pri/T123-F123/mockup.png"
    );
  });

  it("syncs Gmail threads, cleans HTML, preserves attachment metadata, and refreshes expired tokens", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "gmail-access-refreshed",
            expires_in: 3600,
            token_type: "Bearer"
          }),
          { status: 200 }
        );
      }
      if (url.includes("/users/me/threads?")) {
        return new Response(JSON.stringify({ threads: [{ id: "thread-1" }] }), { status: 200 });
      }
      if (url.includes("/users/me/threads/thread-1")) {
        return new Response(
          JSON.stringify({
            id: "thread-1",
            historyId: "11",
            messages: [
              {
                id: "msg-1",
                threadId: "thread-1",
                historyId: "11",
                internalDate: "1713600000000",
                snippet: "Weekly reporting",
                payload: {
                  headers: [
                    { name: "Subject", value: "Reporting" },
                    { name: "From", value: "Client <client@example.com>" },
                    { name: "To", value: "PM <pm@example.com>" }
                  ],
                  parts: [
                    {
                      mimeType: "text/html",
                      body: {
                        data: Buffer.from("<div>Need <b>weekly</b> reporting</div>").toString("base64url")
                      }
                    },
                    {
                      mimeType: "application/pdf",
                      filename: "brief.pdf",
                      body: {
                        attachmentId: "att-1",
                        size: 128
                      }
                    }
                  ]
                }
              }
            ]
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected Gmail URL: ${url}`);
    });

    const provider = new GmailProvider(createEnv(), fetchMock as typeof fetch);
    const result = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        projectId: "project-1",
        provider: "gmail",
        accountLabel: "Gmail",
        status: "connected",
        configJson: { query: "label:client-project", labelIds: ["INBOX"], includeAttachmentsMetadata: true, backfillDays: 30 },
        providerCursorJson: { latestInternalDate: null, historyId: null }
      } as any,
      credential: {
        accessToken: "gmail-access-stale",
        refreshToken: "gmail-refresh",
        expiryDate: Date.now() - 1_000,
        emailAddress: "client@example.com"
      },
      syncType: "backfill",
      batchSize: 50,
      maxBackfillDays: 30
    });

    expect(result.updatedCredential).toEqual(
      expect.objectContaining({
        accessToken: "gmail-access-refreshed"
      })
    );
    expect(result.batches?.[0]?.messages[0]?.bodyText).toContain("Need weekly reporting");
    expect(result.batches?.[0]?.messages[0]?.attachments?.[0]).toEqual(
      expect.objectContaining({
        filename: "brief.pdf",
        providerAttachmentId: "att-1"
      })
    );
  });

  it("builds Microsoft OAuth URLs and exchanges Outlook callbacks into credentials", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("oauth2/v2.0/token")) {
        return new Response(
          JSON.stringify({
            access_token: "outlook-access",
            refresh_token: "outlook-refresh",
            expires_in: 3600,
            scope: "Mail.Read offline_access"
          }),
          { status: 200 }
        );
      }
      if (url.includes("/me?")) {
        return new Response(
          JSON.stringify({
            id: "graph-user-1",
            displayName: "Client Inbox",
            userPrincipalName: "client@example.com"
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected Outlook URL: ${url}`);
    });

    const provider = new OutlookProvider(createEnv(), fetchMock as typeof fetch);
    const connect = await provider.connect({ oauthState: "signed-state" });
    expect(connect.redirectUrl).toContain("state=signed-state");

    const callback = await provider.handleOAuthCallback({
      code: "test-code"
    });

    expect(callback.accountLabel).toBe("client@example.com");
    expect(callback.credential).toEqual(
      expect.objectContaining({
        accessToken: "outlook-access",
        refreshToken: "outlook-refresh"
      })
    );
  });

  it("syncs Outlook messages and preserves attachment metadata", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("oauth2/v2.0/token")) {
        return new Response(
          JSON.stringify({
            access_token: "outlook-access-refreshed",
            expires_in: 3600,
            refresh_token: "outlook-refresh",
            scope: "Mail.Read offline_access"
          }),
          { status: 200 }
        );
      }
      if (url.includes("/mailFolders/Inbox/messages?")) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "graph-message-1",
                conversationId: "conversation-1",
                subject: "Reporting cadence",
                body: { contentType: "html", content: "<div>Please send weekly reporting.</div>" },
                bodyPreview: "Please send weekly reporting.",
                from: { emailAddress: { name: "Client", address: "client@example.com" } },
                toRecipients: [{ emailAddress: { name: "PM", address: "pm@example.com" } }],
                createdDateTime: "2026-04-20T10:00:00.000Z",
                lastModifiedDateTime: "2026-04-20T10:00:00.000Z",
                webLink: "https://outlook.office.com/mail/inbox/id/graph-message-1",
                attachments: [
                  {
                    id: "attachment-1",
                    name: "brief.pdf",
                    contentType: "application/pdf",
                    size: 128
                  }
                ]
              }
            ],
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected Outlook sync URL: ${url}`);
    });

    const provider = new OutlookProvider(createEnv(), fetchMock as typeof fetch);
    const result = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        projectId: "project-1",
        provider: "outlook",
        accountLabel: "Outlook",
        status: "connected",
        configJson: { folderIds: ["Inbox"], includeAttachmentsMetadata: true, backfillDays: 30 },
        providerCursorJson: {}
      } as any,
      credential: {
        accessToken: "outlook-access",
        refreshToken: "outlook-refresh",
        expiryDate: Date.now() - 1_000,
        accountId: "graph-user-1",
        accountLabel: "Client Inbox"
      },
      syncType: "backfill",
      batchSize: 50,
      maxBackfillDays: 30
    });

    expect(result.batches?.[0]?.threads[0]?.providerThreadId).toBe("conversation-1");
    expect(result.batches?.[0]?.messages[0]?.providerMessageId).toBe("graph-message-1");
    expect(result.batches?.[0]?.messages[0]?.bodyText).toContain("weekly reporting");
    expect(result.batches?.[0]?.messages[0]?.attachments?.[0]).toEqual(
      expect.objectContaining({
        providerAttachmentId: "attachment-1",
        filename: "brief.pdf"
      })
    );
    expect(result.cursorAfter).toEqual(
      expect.objectContaining({
        deltaLink: expect.stringContaining("/me/messages/delta")
      })
    );
    expect(result.updatedCredential).toEqual(
      expect.objectContaining({
        accessToken: "outlook-access-refreshed"
      })
    );
  });

  it("syncs Teams channel roots and replies into normalized messages", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("oauth2/v2.0/token")) {
        return new Response(
          JSON.stringify({
            access_token: "teams-access-refreshed",
            expires_in: 3600,
            refresh_token: "teams-refresh"
          }),
          { status: 200 }
        );
      }
      if (url.includes("$skiptoken=root-page-2")) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "root-2",
                createdDateTime: "2026-04-20T10:10:00.000Z",
                body: { contentType: "html", content: "<div>Second paged Teams root</div>" },
                from: { user: { id: "user-1", displayName: "Client" } }
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.includes("/teams/team-1/channels/channel-1/messages?")) {
        return new Response(
          JSON.stringify({
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages?$skiptoken=root-page-2",
            value: [
              {
                id: "root-1",
                createdDateTime: "2026-04-20T10:00:00.000Z",
                body: { contentType: "html", content: "<div>Need weekly reporting</div>" },
                from: { user: { id: "user-1", displayName: "Client" } }
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.includes("$skiptoken=reply-page-2")) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "reply-2",
                replyToId: "root-1",
                createdDateTime: "2026-04-20T10:06:00.000Z",
                body: { contentType: "html", content: "<div>Follow-up from paged replies</div>" },
                from: { user: { id: "user-3", displayName: "Engineer" } }
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.includes("/teams/team-1/channels/channel-1/messages/root-1/replies")) {
        return new Response(
          JSON.stringify({
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages/root-1/replies?$skiptoken=reply-page-2",
            value: [
              {
                id: "reply-1",
                replyToId: "root-1",
                createdDateTime: "2026-04-20T10:05:00.000Z",
                body: { contentType: "html", content: "<div>Approved by client</div>" },
                from: { user: { id: "user-2", displayName: "PM" } }
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.includes("/teams/team-1/channels/channel-1/messages/root-2/replies")) {
        return new Response(JSON.stringify({ value: [] }), { status: 200 });
      }
      throw new Error(`Unexpected Teams URL: ${url}`);
    });

    const provider = new TeamsProvider(createEnv(), fetchMock as typeof fetch);
    const result = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        projectId: "project-1",
        provider: "microsoft_teams",
        accountLabel: "Teams",
        status: "connected",
        configJson: {
          teams: [{ teamId: "team-1", channelIds: ["channel-1"] }],
          includeBotMessages: false,
          backfillDays: 30
        },
        providerCursorJson: {}
      } as any,
      credential: {
        accessToken: "teams-access",
        refreshToken: "teams-refresh",
        expiryDate: Date.now() - 1_000,
        accountId: "graph-user-1",
        accountLabel: "Teams Account"
      },
      syncType: "backfill",
      batchSize: 50,
      maxBackfillDays: 30
    });

    expect(result.batches?.[0]?.threads[0]?.providerThreadId).toBe("microsoft_teams:unknown:channel:team-1:channel-1:root-1");
    expect(result.batches?.[0]?.messages).toHaveLength(4);
    expect(result.batches?.[0]?.messages[1]?.providerMessageId).toBe("microsoft_teams:channel:team-1:channel-1:reply-1");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("$skiptoken=root-page-2"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("$skiptoken=reply-page-2"))).toBe(true);
    expect(result.updatedCredential).toEqual(
      expect.objectContaining({
        accessToken: "teams-access-refreshed"
      })
    );
  });

  it("verifies WhatsApp challenge requests and normalizes inbound messages", async () => {
    const provider = new WhatsAppBusinessProvider(createEnv());

    const verification = await provider.verifyWebhook({
      headers: {},
      rawBody: "",
      body: {},
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "whatsapp-verify-token",
        "hub.challenge": "challenge-value"
      },
      connectors: []
    });
    expect(verification.handledImmediately).toEqual({
      statusCode: 200,
      body: "challenge-value"
    });

    const inboundBody = {
      entry: [
        {
          changes: [
            {
              attackerControlledBlob: "large raw provider body",
              value: {
                metadata: { phone_number_id: "phone-1" },
                contacts: [{ wa_id: "61400000000", profile: { name: "Client" } }],
                messages: [
                  {
                    id: "wamid-1",
                    from: "61400000000",
                    timestamp: "1713600000",
                    type: "text",
                    text: { body: "Can we add weekly reporting?" }
                  }
                ]
              }
            }
          ]
        }
      ]
    };
    const rawBody = JSON.stringify(inboundBody);
    const signature = `sha256=${createHmac("sha256", "whatsapp-app-secret").update(rawBody).digest("hex")}`;

    const verified = await provider.verifyWebhook({
      headers: { "x-hub-signature-256": signature },
      rawBody,
      body: inboundBody,
      connectors: [
        {
          id: "connector-1",
          configJson: { phoneNumberIds: ["phone-1"] }
        } as any
      ],
      query: {}
    });
    expect(verified.connectorIds).toEqual(["connector-1"]);
    expect(JSON.stringify(verified.jobPayload)).not.toContain("attackerControlledBlob");
    expect(JSON.stringify(verified.jobPayload)).not.toContain("large raw provider body");

    const result = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        projectId: "project-1",
        provider: "whatsapp_business",
        accountLabel: "WhatsApp",
        status: "connected",
        configJson: { phoneNumberIds: ["phone-1"] }
      } as any,
      syncType: "webhook",
      webhookPayload: verified.jobPayload
    });

    expect(result.batches?.[0]?.messages[0]?.providerMessageId).toBe("wamid-1");
    expect(result.batches?.[0]?.threads[0]?.providerThreadId).toBe("phone-1:61400000000");
  });

  it("stores OAuth callback credentials on the connector and queues initial backfill", async () => {
    const env = createEnv();
    const vault = new CredentialVault(env);
    const adapter = {
      provider: "slack",
      connect: vi.fn(),
      handleOAuthCallback: vi.fn(async () => ({
        accountLabel: "Arrayah",
        credential: { accessToken: "xoxb-test", teamId: "T123" },
        providerCursor: { teamId: "T123", channels: {} },
        configPatch: { teamId: "T123" }
      }))
    };
    const prisma = {
      oAuthState: {
        findFirst: vi.fn(async () => ({
          id: "oauth-1",
          orgId: "org-1",
          projectId: "project-1",
          provider: "slack",
          actorUserId: "user-1",
          nonceHash: "hash",
          redirectAfter: null,
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null
        })),
        updateMany: vi.fn(async () => ({ count: 1 }))
      },
      communicationConnector: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: "connector-1", provider: "slack", status: "connected" })),
        update: vi.fn(async () => ({ id: "connector-1", provider: "slack", status: "connected" }))
      }
    } as any;
    const syncService = {
      enqueueSync: vi.fn(async () => ({ connectorId: "connector-1", syncRunId: "sync-1", queued: true }))
    } as any;

    const service = new ConnectorsService(
      prisma,
      env,
      { ensureProjectManager: vi.fn(async () => ({ projectRole: "manager" })) } as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      vault,
      new Map([["slack", adapter as any]]),
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );
    service.setSyncService(syncService);

    const statePayload = Buffer.from(
      JSON.stringify({
        nonce: "nonce-1",
        provider: "slack",
        projectId: "project-1",
        issuedAt: Date.now()
      }),
      "utf8"
    ).toString("base64url");
    const cryptoNode = await import("node:crypto");
    const signature = cryptoNode
      .createHmac("sha256", env.CONNECTOR_OAUTH_STATE_SECRET)
      .update(statePayload)
      .digest("hex");

    const result = await service.handleOAuthCallback("slack", {
      code: "oauth-code",
      state: `${statePayload}.${signature}`
    });

    expect(result.connectorId).toBe("connector-1");
    expect(syncService.enqueueSync).toHaveBeenCalledWith(
      expect.objectContaining({ connectorId: "connector-1", syncType: "backfill" })
    );
    expect(prisma.oAuthState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "oauth-1", usedAt: null }),
        data: expect.objectContaining({ usedAt: expect.any(Date) })
      })
    );
    const storedCredential = await vault.getCredential("slack", "connector-1", "vault:slack:connector-1");
    expect(storedCredential).toEqual(expect.objectContaining({ accessToken: "xoxb-test" }));
  });

  it("rejects reused OAuth callback states before provider exchange", async () => {
    const env = createEnv();
    const adapter = {
      provider: "slack",
      handleOAuthCallback: vi.fn(async () => ({
        accountLabel: "Slack",
        credential: { accessToken: "xoxb-test" },
        configPatch: {}
      }))
    };
    const prisma = {
      oAuthState: {
        findFirst: vi.fn(async () => ({
          id: "oauth-1",
          orgId: "org-1",
          projectId: "project-1",
          provider: "slack",
          actorUserId: "user-1",
          nonceHash: "hash",
          redirectAfter: null,
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null
        })),
        updateMany: vi.fn(async () => ({ count: 0 }))
      }
    } as any;
    const service = new ConnectorsService(
      prisma,
      env,
      { ensureProjectManager: vi.fn(async () => ({ projectRole: "manager" })) } as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      new CredentialVault(env),
      new Map([["slack", adapter as any]]),
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );
    const statePayload = Buffer.from(
      JSON.stringify({ nonce: "nonce-1", provider: "slack", projectId: "project-1", issuedAt: Date.now() }),
      "utf8"
    ).toString("base64url");
    const cryptoNode = await import("node:crypto");
    const signature = cryptoNode.createHmac("sha256", env.CONNECTOR_OAUTH_STATE_SECRET).update(statePayload).digest("hex");

    await expect(service.handleOAuthCallback("slack", { code: "oauth-code", state: `${statePayload}.${signature}` }))
      .rejects.toMatchObject({ code: "oauth_state_expired" });
    expect(adapter.handleOAuthCallback).not.toHaveBeenCalled();
  });

  it("rechecks project access before completing OAuth callbacks", async () => {
    const env = createEnv();
    const adapter = {
      provider: "slack",
      handleOAuthCallback: vi.fn(async () => ({
        accountLabel: "Slack",
        credential: { accessToken: "xoxb-test" },
        configPatch: {}
      }))
    };
    const prisma = {
      oAuthState: {
        findFirst: vi.fn(async () => ({
          id: "oauth-1",
          orgId: "org-1",
          projectId: "project-1",
          provider: "slack",
          actorUserId: "removed-user",
          nonceHash: "hash",
          redirectAfter: null,
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null
        }))
      }
    } as any;
    const projectService = {
      ensureProjectManager: vi.fn(async () => {
        throw new AppError(403, "Forbidden", "project_access_denied");
      })
    } as any;
    const service = new ConnectorsService(
      prisma,
      env,
      projectService,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      new CredentialVault(env),
      new Map([["slack", adapter as any]]),
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );
    const statePayload = Buffer.from(
      JSON.stringify({ nonce: "nonce-1", provider: "slack", projectId: "project-1", issuedAt: Date.now() }),
      "utf8"
    ).toString("base64url");
    const cryptoNode = await import("node:crypto");
    const signature = cryptoNode.createHmac("sha256", env.CONNECTOR_OAUTH_STATE_SECRET).update(statePayload).digest("hex");

    await expect(service.handleOAuthCallback("slack", { code: "oauth-code", state: `${statePayload}.${signature}` }))
      .rejects.toMatchObject({ code: "project_access_denied" });
    expect(adapter.handleOAuthCallback).not.toHaveBeenCalled();
  });

  it("does not create a null vault credential for manual-only Fireflies connectors", async () => {
    const env = createEnv({ FIREFLIES_READINESS_MODE: "manual_only" });
    const putCredential = vi.fn(async () => ({ ref: "vault:fireflies_ai:connector-1" }));
    const prisma = {
      project: {
        findUnique: vi.fn(async () => ({ id: "project-1", orgId: "org-1" })),
        findUniqueOrThrow: vi.fn(async () => ({ orgId: "org-1" }))
      },
      communicationConnector: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({
          id: "connector-1",
          projectId: "project-1",
          provider: "fireflies_ai",
          accountLabel: "Fireflies.ai manual import",
          status: "connected",
          configJson: { readinessMode: "manual_only", liveApi: "readiness_gated" }
        })),
        update: vi.fn(async () => {
          throw new Error("manual-only Fireflies connect must not update credentialsRef");
        })
      },
      jobRun: {
        upsert: vi.fn(async () => undefined)
      }
    } as any;
    const jobs = { enqueue: vi.fn(async () => undefined) };
    const service = new ConnectorsService(
      prisma,
      env,
      { ensureProjectManager: vi.fn(async () => ({ projectRole: "manager" })) } as any,
      { record: vi.fn(async () => undefined) } as any,
      jobs as any,
      { putCredential } as any,
      new Map([["fireflies_ai", new FirefliesProvider(env)]]),
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    const result = await service.connect("project-1", "fireflies_ai", "manager-1");

    expect(result).toMatchObject({
      connectorId: "connector-1",
      provider: "fireflies_ai",
      status: "connected"
    });
    expect(putCredential).not.toHaveBeenCalled();
    expect(prisma.communicationConnector.update).not.toHaveBeenCalled();
    expect(JSON.stringify(prisma.communicationConnector.create.mock.calls)).not.toContain("apiKey");
  });

  it("connects Granola with vault-only API-key storage and safe connector config", async () => {
    const env = createEnv({ CONNECTOR_CREDENTIAL_VAULT_MODE: "memory" });
    const putCredential = vi.fn(async () => ({ ref: "vault:granola:connector-1" }));
    const prisma = {
      project: {
        findUnique: vi.fn(async () => ({ id: "project-1", orgId: "org-1" })),
        findUniqueOrThrow: vi.fn(async () => ({ orgId: "org-1" }))
      },
      communicationConnector: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async (args) => ({
          id: "connector-1",
          projectId: "project-1",
          provider: "granola",
          accountLabel: args.data.accountLabel,
          status: args.data.status,
          configJson: args.data.configJson
        })),
        update: vi.fn(async (args) => ({
          id: "connector-1",
          projectId: "project-1",
          provider: "granola",
          accountLabel: "Granola Personal",
          status: "connected",
          configJson: {},
          ...args.data
        }))
      },
      jobRun: {
        upsert: vi.fn(async () => undefined)
      }
    } as any;
    const audit = { record: vi.fn(async () => undefined) };
    const service = new ConnectorsService(
      prisma,
      env,
      { ensureProjectManager: vi.fn(async () => ({ projectRole: "manager", isActive: true })) } as any,
      audit as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      { putCredential } as any,
      new Map([["granola", new GranolaProvider(env)]]),
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    const result = await service.connect("project-1", "granola", "manager-1", {
      apiKey: "fake-granola-test-key",
      keyType: "personal",
      config: {
        selectedFolderIds: ["fol_123"],
        includeTranscript: true,
        includeSummary: true,
        syncBatchSize: 30
      }
    });

    expect(result).toMatchObject({
      connectorId: "connector-1",
      provider: "granola",
      status: "connected",
      redirectUrl: null
    });
    expect(putCredential).toHaveBeenCalledWith({
      provider: "granola",
      connectorId: "connector-1",
      credential: expect.objectContaining({
        mode: "api_key",
        apiKey: "fake-granola-test-key",
        keyType: "personal"
      })
    });
    expect(prisma.communicationConnector.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "connector-1" },
        data: { credentialsRef: "vault:granola:connector-1" }
      })
    );
    const persistedConnectorPayload = JSON.stringify(prisma.communicationConnector.create.mock.calls);
    expect(persistedConnectorPayload).not.toContain("fake-granola-test-key");
    expect(persistedConnectorPayload).not.toContain("apiKey");
    expect(persistedConnectorPayload).not.toContain("Authorization");
    expect(JSON.stringify(result)).not.toContain("fake-granola-test-key");
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("fake-granola-test-key");
  });

  it("requires managed Granola secret references in managed-reference vault mode", async () => {
    const env = createEnv({ CONNECTOR_CREDENTIAL_VAULT_MODE: "managed_reference" });
    const provider = new GranolaProvider(env);

    await expect(
      provider.connect({
        projectId: "project-1",
        actorUserId: "manager-1",
        body: { apiKey: "fake-granola-test-key", keyType: "personal" }
      })
    ).rejects.toMatchObject({ code: "granola_managed_secret_ref_required" });

    await expect(
      provider.connect({
        projectId: "project-1",
        actorUserId: "manager-1",
        body: {
          managedSecretRef: "orchestra/granola/connector-1",
          keyType: "enterprise",
          config: { workspaceScope: "team_space" }
        }
      })
    ).resolves.toMatchObject({
      mode: "connected",
      status: "connected",
      config: expect.objectContaining({
        keyType: "enterprise",
        workspaceScope: "team_space"
      }),
      credential: {
        mode: "managed_reference",
        managedSecretRef: "orchestra/granola/connector-1",
        keyType: "enterprise",
        createdAt: expect.any(String)
      }
    });
  });

  it("syncs Granola folders, notes, summaries, and transcript segments as provider-neutral evidence", async () => {
    const calls: Array<{ url: URL; authorization?: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, authorization: (init?.headers as Record<string, string> | undefined)?.Authorization });
      if (url.pathname.endsWith("/folders")) {
        expect(Number(url.searchParams.get("page_size"))).toBeLessThanOrEqual(30);
        return new Response(
          JSON.stringify({
            folders: [{ id: "fol_123", name: "Client calls", parent_folder_id: "fol_root" }],
            hasMore: false,
            cursor: null
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.pathname.endsWith("/notes")) {
        expect(Number(url.searchParams.get("page_size"))).toBeLessThanOrEqual(30);
        expect(url.searchParams.get("created_after")).toBeTruthy();
        if (url.searchParams.get("cursor") === "cursor-2") {
          return new Response(
            JSON.stringify({
              notes: [{ id: "not_otherfolder1", title: "Other folder", created_at: "2026-05-01T10:00:00Z", updated_at: "2026-05-01T10:30:00Z" }],
              hasMore: false,
              cursor: null
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            notes: [
              { id: "not_summary0001", title: "Client onboarding", created_at: "2026-05-01T10:00:00Z", updated_at: "2026-05-01T10:30:00Z" },
              { id: "not_missing0001", title: "Still processing", created_at: "2026-05-01T11:00:00Z", updated_at: "2026-05-01T11:30:00Z" }
            ],
            hasMore: true,
            cursor: "cursor-2"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.pathname.endsWith("/notes/not_missing0001")) {
        return new Response(JSON.stringify({ error: "processing" }), { status: 404 });
      }
      if (url.pathname.endsWith("/notes/not_otherfolder1")) {
        return new Response(
          JSON.stringify({
            id: "not_otherfolder1",
            title: "Other folder",
            created_at: "2026-05-01T10:00:00Z",
            updated_at: "2026-05-01T10:30:00Z",
            web_url: "https://notes.granola.ai/d/not_otherfolder1",
            folder_membership: [{ id: "fol_other", name: "Other" }],
            summary_text: "Other folder note."
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.pathname.endsWith("/notes/not_summary0001")) {
        expect(url.searchParams.get("include")).toBe("transcript");
        return new Response(
          JSON.stringify({
            id: "not_summary0001",
            title: "Client onboarding",
            owner: { name: "Taylor PM", email: "taylor@example.test" },
            created_at: "2026-05-01T10:00:00Z",
            updated_at: "2026-05-01T10:30:00Z",
            web_url: "https://notes.granola.ai/d/not_summary0001",
            calendar_event: {
              event_title: "Client onboarding",
              scheduled_start_time: "2026-05-01T10:00:00Z",
              scheduled_end_time: "2026-05-01T10:45:00Z",
              organiser: "taylor@example.test",
              calendar_event_id: "event-1"
            },
            attendees: [{ name: "Casey Client", email: "casey@example.test" }],
            folder_membership: [{ id: "fol_123", name: "Client calls", parent_folder_id: "fol_root" }],
            summary_markdown: "## Decisions\n\nClient approved onboarding checklist.",
            summary_text: "Client approved onboarding checklist.",
            transcript: [
              {
                speaker: { source: "microphone", diarization_label: "Speaker A" },
                text: "Client approved onboarding checklist.",
                start_time: "2026-05-01T10:05:00Z",
                end_time: "2026-05-01T10:05:15Z"
              },
              {
                speaker: { source: "speaker" },
                text: "We need auth changes next sprint.",
                start_time: "2026-05-01T10:06:00Z",
                end_time: "2026-05-01T10:06:20Z"
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });
    const env = createEnv({ GRANOLA_SYNC_BATCH_SIZE: 50 });
    const provider = new GranolaProvider(env, fetchMock as typeof fetch, async () => undefined);

    const channels = await provider.listChannels?.({ credential: { apiKey: "fake-granola-test-key" } });
    expect(channels?.[0]).toMatchObject({ id: "fol_123", name: "Client calls" });

    const result = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        provider: "granola",
        configJson: { selectedFolderIds: ["fol_123"], syncBatchSize: 30 },
        providerCursorJson: null,
        lastSyncedAt: null
      } as any,
      credential: { apiKey: "fake-granola-test-key" },
      syncType: "backfill",
      batchSize: 50,
      maxBackfillDays: 30
    });

    expect(result.status).toBe("completed");
    expect(result.summary).toMatchObject({
      notesListed: 3,
      notesFetched: 2,
      notesSkippedUnavailable: 1,
      notesSkippedByFolder: 1,
      summariesNormalized: 1,
      transcriptSegmentsNormalized: 2,
      threadsCreated: 1,
      messagesCreated: 3
    });
    expect(result.batches?.[0]?.threads[0]).toMatchObject({
      providerThreadId: "granola_note:not_summary0001",
      subject: "Client onboarding",
      threadUrl: "https://notes.granola.ai/d/not_summary0001"
    });
    expect(result.batches?.[0]?.messages.map((message) => message.providerMessageId)).toEqual(
      expect.arrayContaining([
        "granola_note:not_summary0001:summary",
        "granola_note:not_summary0001:transcript:0:2026-05-01T10:05:00Z",
        "granola_note:not_summary0001:transcript:1:2026-05-01T10:06:00Z"
      ])
    );
    const transcript = result.batches?.[0]?.messages.find((message) => message.providerMessageId.includes("transcript:0"));
    expect(transcript).toMatchObject({
      senderLabel: "Speaker A",
      rawMetadata: expect.objectContaining({
        sourceSubType: "granola_transcript_segment",
        noteId: "not_summary0001",
        speaker: { source: "microphone", diarizationLabel: "Speaker A" },
        notTruth: true
      })
    });
    expect(calls.every((call) => call.authorization === "Bearer fake-granola-test-key")).toBe(true);
    expect(calls.some((call) => call.url.pathname.endsWith("/notes/not_summary0001") && call.url.searchParams.get("include") === "transcript")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fake-granola-test-key");
  });

  it("does not advance Granola provider cursors when a sync is rate limited", async () => {
    const calls: URL[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname.endsWith("/notes")) {
        expect(url.searchParams.get("cursor")).toBe("cursor-before");
        expect(url.searchParams.get("updated_after")).toBe("2026-05-01T00:00:00Z");
        return new Response(
          JSON.stringify({
            notes: [{ id: "not_rate_limited", title: "Rate limited", created_at: "2026-05-02T10:00:00Z", updated_at: "2026-05-02T10:30:00Z" }],
            hasMore: true,
            cursor: "cursor-after"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.pathname.endsWith("/notes/not_rate_limited")) {
        return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { "retry-after": "0" } });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });
    const provider = new GranolaProvider(createEnv(), fetchMock as typeof fetch, async () => undefined);

    const result = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        provider: "granola",
        configJson: { selectedFolderIds: ["fol_123"] },
        providerCursorJson: {
          lastGranolaCursor: "cursor-before",
          lastGranolaUpdatedAfter: "2026-05-01T00:00:00Z"
        },
        lastSyncedAt: null
      } as any,
      credential: { apiKey: "fake-granola-test-key" },
      syncType: "incremental",
      batchSize: 30,
      maxBackfillDays: 30
    });

    expect(result.status).toBe("partial");
    expect(result.cursorAfter).toMatchObject({
      lastGranolaCursor: "cursor-before",
      lastGranolaUpdatedAfter: "2026-05-01T00:00:00Z",
      lastGranolaCursorAdvanceBlocked: true
    });
    expect(result.summary).toMatchObject({
      rateLimitCount: 1,
      partialFailures: [{ noteId: "not_rate_limited", code: "granola_rate_limited" }]
    });
    expect(calls.filter((url) => url.pathname.endsWith("/notes/not_rate_limited")).length).toBe(3);
    expect(JSON.stringify(result)).not.toContain("fake-granola-test-key");
  });

  it("requires explicit Granola folder selection before live sync", async () => {
    const provider = new GranolaProvider(createEnv(), vi.fn() as unknown as typeof fetch, async () => undefined);

    await expect(
      provider.sync({
        projectId: "project-1",
        connector: {
          id: "connector-1",
          provider: "granola",
          configJson: {},
          providerCursorJson: null,
          lastSyncedAt: null
        } as any,
        credential: { apiKey: "fake-granola-test-key" },
        syncType: "backfill",
        batchSize: 30,
        maxBackfillDays: 30
      })
    ).rejects.toMatchObject({ code: "granola_folder_selection_required" });
  });

  it("keeps Granola free of OAuth, webhook, write, and direct truth mutation behavior", async () => {
    const env = createEnv();
    const provider = new GranolaProvider(env);

    await expect(provider.registerWebhook?.({ connector: {} as any, credential: null, endpointUrl: "https://api.example.test/v1/webhooks/granola" })).rejects.toMatchObject({
      code: "granola_webhooks_not_supported"
    });
    await expect(provider.verifyWebhook?.({ headers: {}, rawBody: "{}", body: {}, connectors: [] })).rejects.toMatchObject({
      code: "granola_webhooks_not_supported"
    });
    await expect(
      provider.sync({
        projectId: "project-1",
        connector: { id: "connector-1" } as any,
        credential: null,
        syncType: "manual",
        batchSize: 10,
        maxBackfillDays: 30
      })
    ).rejects.toMatchObject({ code: "granola_credential_unavailable" });
  });

  it("does not use the deployment-wide Fireflies API key as a hidden sync credential", async () => {
    const provider = new FirefliesProvider(createEnv({ FIREFLIES_READINESS_MODE: "api", FIREFLIES_API_KEY: "fireflies-api-key" }));

    await expect(
      provider.sync({
        projectId: "project-1",
        connector: {
          id: "connector-fireflies",
          provider: "fireflies_ai",
          configJson: {},
          providerCursorJson: null,
          lastSyncedAt: null
        } as any,
        credential: null,
        syncType: "backfill",
        batchSize: 10,
        maxBackfillDays: 30
      })
    ).rejects.toMatchObject({ code: "fireflies_credential_missing" });
  });

  it("does not expose connector credential references after update or revoke", async () => {
    const env = createEnv();
    const projectService = { ensureProjectManager: vi.fn(async () => ({ projectRole: "manager" })) };
    const prisma = {
      project: {
        findUnique: vi.fn(async () => ({ id: "project-1", orgId: "org-1" })),
        findUniqueOrThrow: vi.fn(async () => ({ orgId: "org-1" }))
      },
      jobRun: {
        upsert: vi.fn(async () => undefined)
      },
      communicationConnector: {
        findFirstOrThrow: vi
          .fn()
          .mockResolvedValueOnce({
            id: "connector-1",
            projectId: "project-1",
            provider: "slack",
            accountLabel: "Slack",
            status: "connected",
            configJson: {},
            credentialsRef: "vault:slack:connector-1"
          })
          .mockResolvedValueOnce({
            id: "connector-1",
            projectId: "project-1",
            provider: "slack",
            accountLabel: "Slack",
            status: "connected",
            configJson: {},
            credentialsRef: "vault:slack:connector-1"
          }),
        update: vi
          .fn()
          .mockResolvedValueOnce({
            id: "connector-1",
            projectId: "project-1",
            provider: "slack",
            accountLabel: "Renamed Slack",
            status: "connected",
            configJson: {},
            credentialsRef: "vault:slack:connector-1",
            lastSyncedAt: null,
            lastError: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-02T00:00:00.000Z")
          })
          .mockResolvedValueOnce({
            id: "connector-1",
            projectId: "project-1",
            provider: "slack",
            accountLabel: "Renamed Slack",
            status: "revoked",
            configJson: {},
            credentialsRef: "vault:slack:connector-1",
            lastSyncedAt: null,
            lastError: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-02T00:00:00.000Z")
          })
      }
    } as any;
    const vault = {
      getCredential: vi.fn(async () => ({ accessToken: "xoxb-test" })),
      revokeCredential: vi.fn(async () => undefined)
    };
    const adapter = { provider: "slack", revoke: vi.fn(async () => undefined) };
    const service = new ConnectorsService(
      prisma,
      env,
      projectService as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      vault as any,
      new Map([["slack", adapter as any]]),
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    const updated = await service.update("project-1", "connector-1", "manager-1", { accountLabel: "Renamed Slack" });
    const revoked = await service.revoke("project-1", "connector-1", "manager-1");

    expect(JSON.stringify(updated)).not.toContain("credentialsRef");
    expect(JSON.stringify(revoked)).not.toContain("credentialsRef");
    expect(updated).not.toHaveProperty("credentialsRef");
    expect(revoked).not.toHaveProperty("credentialsRef");
  });

  it("rejects connector config patches that would persist credential material", async () => {
    const env = createEnv();
    const projectService = { ensureProjectManager: vi.fn(async () => ({ projectRole: "manager" })) };
    const update = vi.fn(async () => undefined);
    const prisma = {
      communicationConnector: {
        findFirstOrThrow: vi.fn(async () => ({
          id: "connector-1",
          projectId: "project-1",
          provider: "slack",
          accountLabel: "Slack",
          status: "connected",
          configJson: { channelIds: ["C123"] },
          credentialsRef: "vault:slack:connector-1"
        })),
        update
      }
    } as any;
    const service = new ConnectorsService(
      prisma,
      env,
      projectService as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      { getCredential: vi.fn(), revokeCredential: vi.fn(), putCredential: vi.fn() } as any,
      new Map(),
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    await expect(
      service.update("project-1", "connector-1", "manager-1", {
        config: { channelIds: ["C123"], nested: { refreshToken: "secret-refresh" } }
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "connector_config_contains_secret"
    });

    await expect(
      service.update("project-1", "connector-1", "manager-1", {
        config: { channelIds: ["C123"], apiKey: "provider-api-key", headers: { authorization: "Bearer provider-token" } }
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "connector_config_contains_secret"
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("sanitizes connector list/detail/readiness and project job-run visibility", async () => {
    const env = createEnv();
    const projectService = { ensureProjectManager: vi.fn(async () => ({ projectRole: "manager" })) };
    const connector = {
      id: "connector-1",
      projectId: "project-1",
      provider: "slack",
      accountLabel: "Slack",
      status: "connected",
      configJson: {
        channelIds: ["C123"],
        accessToken: "xoxb-should-not-leak",
        apiKey: "provider-api-key",
        nested: { refreshToken: "secret-refresh", authorization: "Bearer provider-token" }
      },
      credentialsRef: "vault:slack:connector-1",
      lastSyncedAt: null,
      lastError: "Bearer connector.secret.token failed",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      _count: { threads: 1, messages: 2, syncRuns: 3 },
      syncRuns: [
        {
          id: "sync-1",
          provider: "slack",
          syncType: "incremental",
          status: "failed",
          startedAt: new Date("2026-01-03T00:00:01.000Z"),
          finishedAt: new Date("2026-01-03T00:00:02.000Z"),
          errorMessage: "access_token=xoxb-sync-secret failed",
          summaryJson: { imported: 0 }
        }
      ]
    };
    const prisma = {
      communicationConnector: {
        findMany: vi.fn(async () => [connector]),
        findFirstOrThrow: vi.fn(async () => connector)
      },
      communicationSyncRun: {
        findMany: vi.fn(async () => [
          {
            id: "sync-public",
            connectorId: "connector-1",
            projectId: "project-1",
            provider: "slack",
            syncType: "manual",
            status: "failed",
            cursorBeforeJson: { accessToken: "xoxb-before" },
            cursorAfterJson: { refreshToken: "xoxb-after" },
            summaryJson: { imported: 1, nested: { authorization: "Bearer public-sync-token" } },
            errorMessage: "Bearer public-error-token failed",
            startedAt: new Date("2026-01-04T00:00:01.000Z"),
            finishedAt: new Date("2026-01-04T00:00:02.000Z"),
            createdAt: new Date("2026-01-04T00:00:00.000Z")
          }
        ])
      },
      jobRun: {
        findMany: vi.fn(async () => [
          {
            id: "job-1",
            jobType: "sync_communication_connector",
            status: "failed",
            idempotencyKey: "sync-connector:connector-1",
            payloadJson: { projectId: "project-1", accessToken: "xoxb-secret" },
            attemptCount: 2,
            scheduledAt: new Date("2026-01-03T00:00:00.000Z"),
            startedAt: new Date("2026-01-03T00:00:01.000Z"),
            finishedAt: new Date("2026-01-03T00:00:02.000Z"),
            lastError: "Bearer abc.def.ghi failed",
            createdAt: new Date("2026-01-03T00:00:00.000Z")
          }
        ])
      }
    } as any;
    const service = new ConnectorsService(
      prisma,
      env,
      projectService as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      {} as any,
      new Map(),
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    const listed = await service.list("project-1", "manager-1", {});
    const detail = await service.get("project-1", "connector-1", "manager-1");
    const readiness = await service.listReadiness("project-1", "manager-1");
    const jobRuns = await service.listProjectJobRuns("project-1", "manager-1", { limit: 10, status: "failed" });
    const syncRuns = await service.listSyncRuns("project-1", "connector-1", "manager-1", { limit: 10 });

    expect(JSON.stringify(listed)).not.toContain("credentialsRef");
    expect(JSON.stringify(listed)).not.toContain("connector.secret.token");
    expect(JSON.stringify(detail)).not.toContain("xoxb-should-not-leak");
    expect(JSON.stringify(detail)).not.toContain("provider-api-key");
    expect(JSON.stringify(detail)).not.toContain("provider-token");
    expect(JSON.stringify(detail)).not.toContain("secret-refresh");
    expect(JSON.stringify(detail)).not.toContain("connector.secret.token");
    expect(JSON.stringify(detail)).not.toContain("xoxb-sync-secret");
    expect(listed[0]?.lastError).toBe("Bearer [redacted] failed");
    expect(detail.lastError).toBe("Bearer [redacted] failed");
    expect(detail.recentSyncRuns[0]?.errorMessage).toBe("access_token=[redacted] failed");
    expect(detail).toHaveProperty("readiness.state", "enabled");
    expect(readiness.map((item) => item.provider)).toEqual(
      expect.arrayContaining(["manual_import", "slack", "gmail", "outlook", "microsoft_teams", "whatsapp_business"])
    );
    expect(JSON.stringify(jobRuns)).not.toContain("xoxb-secret");
    expect(jobRuns[0]).toMatchObject({
      id: "job-1",
      status: "failed",
      lastError: "Bearer [redacted] failed"
    });
    expect(JSON.stringify(syncRuns)).not.toContain("cursorBeforeJson");
    expect(JSON.stringify(syncRuns)).not.toContain("cursorAfterJson");
    expect(JSON.stringify(syncRuns)).not.toContain("public-sync-token");
    expect(JSON.stringify(syncRuns)).not.toContain("public-error-token");
    expect(syncRuns[0]).toMatchObject({
      id: "sync-public",
      errorMessage: "Bearer [redacted] failed",
      summary: { imported: 1, nested: {} }
    });
  });

  it("returns existing active sync runs and blocks revoked connector syncs", async () => {
    const sync = new SyncService(
      {
        communicationConnector: {
          findFirstOrThrow: vi.fn(async () => ({
            id: "connector-1",
            projectId: "project-1",
            provider: "slack",
            status: "connected",
            credentialsRef: "vault:slack:connector-1",
            providerCursorJson: { channels: {} }
          }))
        },
        communicationSyncRun: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({ id: "sync-running", createdAt: new Date() })
            .mockResolvedValueOnce(null),
          create: vi.fn(async () => ({ id: "sync-new" }))
        },
        project: {
          findUniqueOrThrow: vi.fn(async () => ({ orgId: "org-1" }))
        },
        jobRun: {
          upsert: vi.fn(async () => undefined)
        }
      } as any,
      createEnv(),
      { ensureProjectManager: vi.fn(async () => undefined) } as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      new CredentialVault(createEnv()),
      new Map([["slack", { provider: "slack", sync: vi.fn() } as any]]),
      {} as MessageIngestionService,
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    const reused = await sync.queueSync("project-1", "connector-1", "user-1", "manual");
    expect(reused).toEqual({ connectorId: "connector-1", syncRunId: "sync-running", queued: false });

    const fresh = await sync.queueSync("project-1", "connector-1", "user-1", "manual");
    expect(fresh).toEqual({ connectorId: "connector-1", syncRunId: "sync-new", queued: true });
  });

  it("does not let stale queued sync runs block a retry", async () => {
    const staleCreatedAt = new Date(Date.now() - 5 * 60 * 1000);
    const prisma = {
      communicationConnector: {
        findFirstOrThrow: vi.fn(async () => ({
          id: "connector-1",
          projectId: "project-1",
          provider: "slack",
          status: "connected",
          credentialsRef: "vault:slack:connector-1",
          providerCursorJson: { channels: {} }
        }))
      },
      communicationSyncRun: {
        findFirst: vi.fn(async () => ({ id: "sync-stale", status: "queued", createdAt: staleCreatedAt })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        create: vi.fn(async () => ({ id: "sync-new" }))
      },
      project: {
        findUniqueOrThrow: vi.fn(async () => ({ orgId: "org-1" }))
      },
      jobRun: {
        upsert: vi.fn(async () => undefined)
      }
    } as any;
    const sync = new SyncService(
      prisma,
      createEnv(),
      { ensureProjectManager: vi.fn(async () => undefined) } as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      new CredentialVault(createEnv()),
      new Map([["slack", { provider: "slack", sync: vi.fn() } as any]]),
      {} as MessageIngestionService,
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    const result = await sync.queueSync("project-1", "connector-1", "user-1", "manual");
    expect(result).toEqual({ connectorId: "connector-1", syncRunId: "sync-new", queued: true });
    expect(prisma.communicationSyncRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sync-stale", status: "queued" },
        data: expect.objectContaining({ status: "failed" })
      })
    );
  });

  it("deduplicates repeated webhook sync enqueue by stable provider event identity", async () => {
    const create = vi.fn();
    const enqueue = vi.fn();
    const sync = new SyncService(
      {
        communicationConnector: {
          findFirstOrThrow: vi.fn(async () => ({
            id: "connector-fireflies",
            projectId: "project-1",
            provider: "fireflies_ai",
            status: "connected",
            credentialsRef: "vault:fireflies_ai:connector-fireflies",
            providerCursorJson: {}
          }))
        },
        communicationSyncRun: {
          findFirst: vi.fn(async () => null),
          findUnique: vi.fn(async () => ({ id: "sync-existing", status: "queued" })),
          create
        }
      } as any,
      createEnv({ FIREFLIES_READINESS_MODE: "api_and_webhook", FIREFLIES_API_KEY: "key", FIREFLIES_WEBHOOK_SECRET: "secret" }),
      {} as any,
      { record: vi.fn() } as any,
      { enqueue } as any,
      new CredentialVault(createEnv()),
      new Map(),
      {} as MessageIngestionService,
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    const result = await sync.enqueueSync({
      projectId: "project-1",
      connectorId: "connector-fireflies",
      syncType: "webhook",
      webhookPayload: { providerEventId: "fireflies:meeting.transcribed:ff-1:1710876543210" }
    });

    expect(result).toEqual({ connectorId: "connector-fireflies", syncRunId: "sync-existing", queued: false });
    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does not permanently deduplicate intentional manual syncs with an unchanged cursor", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({ id: "sync-1" })
      .mockResolvedValueOnce({ id: "sync-2" });
    const prisma = {
      communicationConnector: {
        findFirstOrThrow: vi.fn(async () => ({
          id: "connector-1",
          projectId: "project-1",
          provider: "slack",
          status: "connected",
          credentialsRef: "vault:slack:connector-1",
          providerCursorJson: { channels: {} }
        }))
      },
      communicationSyncRun: {
        findFirst: vi.fn(async () => null),
        findUnique: vi.fn(async () => null),
        create
      },
      project: { findUniqueOrThrow: vi.fn(async () => ({ orgId: "org-1" })) },
      jobRun: { upsert: vi.fn(async () => undefined) }
    } as any;
    const sync = new SyncService(
      prisma,
      createEnv(),
      { ensureProjectManager: vi.fn(async () => undefined) } as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      new CredentialVault(createEnv()),
      new Map(),
      {} as MessageIngestionService,
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    await sync.queueSync("project-1", "connector-1", "user-1", "manual");
    await sync.queueSync("project-1", "connector-1", "user-1", "manual");

    const firstKey = create.mock.calls[0]?.[0]?.data?.idempotencyKey;
    const secondKey = create.mock.calls[1]?.[0]?.data?.idempotencyKey;
    expect(firstKey).toMatch(/^sync-connector:connector-1:manual:/);
    expect(secondKey).toMatch(/^sync-connector:connector-1:manual:/);
    expect(firstKey).not.toBe(secondKey);
  });

  it("marks stale running sync runs failed so a retry can queue", async () => {
    const staleCreatedAt = new Date(Date.now() - 10 * 60 * 1000);
    const prisma = {
      communicationConnector: {
        findFirstOrThrow: vi.fn(async () => ({
          id: "connector-1",
          projectId: "project-1",
          provider: "slack",
          status: "connected",
          credentialsRef: "vault:slack:connector-1",
          providerCursorJson: { channels: {} }
        }))
      },
      communicationSyncRun: {
        findFirst: vi.fn(async () => ({ id: "sync-running", status: "running", startedAt: staleCreatedAt, createdAt: staleCreatedAt })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        create: vi.fn(async () => ({ id: "sync-new" }))
      },
      project: {
        findUniqueOrThrow: vi.fn(async () => ({ orgId: "org-1" }))
      },
      jobRun: {
        upsert: vi.fn(async () => undefined)
      }
    } as any;
    const sync = new SyncService(
      prisma,
      createEnv(),
      { ensureProjectManager: vi.fn(async () => undefined) } as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      new CredentialVault(createEnv()),
      new Map([["slack", { provider: "slack", sync: vi.fn() } as any]]),
      {} as MessageIngestionService,
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    const result = await sync.queueSync("project-1", "connector-1", "user-1", "manual");

    expect(result).toEqual({ connectorId: "connector-1", syncRunId: "sync-new", queued: true });
    expect(prisma.communicationSyncRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sync-running", status: "running" },
        data: expect.objectContaining({ status: "failed" })
      })
    );
  });

  it("does not resurrect a stale queued sync run after it has been failed for retry", async () => {
    const adapter = { provider: "slack", sync: vi.fn() };
    const prisma = {
      communicationConnector: {
        findFirstOrThrow: vi.fn(async () => ({
          id: "connector-1",
          projectId: "project-1",
          provider: "slack",
          status: "connected",
          credentialsRef: "vault:slack:connector-1",
          providerCursorJson: {}
        })),
        update: vi.fn(async () => undefined)
      },
      communicationSyncRun: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(async () => ({ id: "sync-stale", status: "failed" })),
        findFirst: vi.fn(async () => null),
        update: vi.fn(async () => undefined)
      },
      jobRun: {
        update: vi.fn(async () => undefined),
        upsert: vi.fn(async () => undefined)
      }
    } as any;
    const sync = new SyncService(
      prisma,
      createEnv(),
      {} as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      new CredentialVault(createEnv()),
      new Map([["slack", adapter as any]]),
      {} as MessageIngestionService,
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    const result = await sync.runSyncJob({
      connectorId: "connector-1",
      projectId: "project-1",
      syncType: "manual",
      syncRunId: "sync-stale",
      idempotencyKey: "sync:connector-1:stale"
    });

    expect(result).toEqual({ skipped: true, reason: "sync_run_not_claimable", syncRunStatus: "failed" });
    expect(adapter.sync).not.toHaveBeenCalled();
    expect(prisma.communicationSyncRun.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "running" }) })
    );
  });

  it("returns connector locked partial summaries when another sync run is already active", async () => {
    const prisma = {
      communicationConnector: {
        findFirstOrThrow: vi.fn(async () => ({
          id: "connector-1",
          projectId: "project-1",
          provider: "slack",
          status: "connected",
          credentialsRef: "vault:slack:connector-1",
          providerCursorJson: {}
        })),
        update: vi.fn(async () => undefined)
      },
      communicationSyncRun: {
        findFirst: vi.fn(async () => ({ id: "sync-running", createdAt: new Date() })),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => undefined)
      },
      jobRun: {
        upsert: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined)
      }
    } as any;

    const sync = new SyncService(
      prisma,
      createEnv(),
      {} as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      new CredentialVault(createEnv()),
      new Map([["slack", { provider: "slack", sync: vi.fn() } as any]]),
      {} as MessageIngestionService,
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    const result = await sync.runSyncJob({
      connectorId: "connector-1",
      projectId: "project-1",
      syncType: "manual",
      syncRunId: "sync-new",
      idempotencyKey: "sync:connector-1"
    });

    expect(result).toEqual(
      expect.objectContaining({
        skipped: true,
        reason: "connector_locked",
        competingSyncRunId: "sync-running"
      })
    );
  });

  it("marks communication sync jobs dead after the configured retry budget is exhausted", async () => {
    const prisma = {
      communicationConnector: {
        findFirstOrThrow: vi.fn(async () => ({
          id: "connector-1",
          projectId: "project-1",
          provider: "slack",
          status: "connected",
          credentialsRef: "vault:slack:connector-1",
          providerCursorJson: {}
        })),
        update: vi.fn(async () => undefined)
      },
      communicationSyncRun: {
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => undefined)
      },
      project: {
        findUniqueOrThrow: vi.fn(async () => ({ orgId: "org-1" }))
      },
      jobRun: {
        upsert: vi.fn(async () => ({ id: "job-1", attemptCount: 3 })),
        update: vi.fn(async () => undefined)
      }
    } as any;
    const sync = new SyncService(
      prisma,
      createEnv({ JOB_DEFAULT_ATTEMPTS: 3 }),
      {} as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      new CredentialVault(createEnv()),
      new Map([["slack", { provider: "slack", sync: vi.fn(async () => { throw new Error("provider unavailable"); }) } as any]]),
      {} as MessageIngestionService,
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    await expect(
      sync.runSyncJob({
        connectorId: "connector-1",
        projectId: "project-1",
        syncType: "manual",
        syncRunId: "sync-1",
        idempotencyKey: "sync:connector-1:manual:dead"
      })
    ).rejects.toThrow("provider unavailable");

    expect(prisma.jobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: "sync:connector-1:manual:dead" },
        data: expect.objectContaining({ status: "dead" })
      })
    );
  });

  it("marks queued provider webhook events processed only after sync succeeds", async () => {
    const prisma = {
      communicationConnector: {
        findFirstOrThrow: vi.fn(async () => ({
          id: "connector-fireflies",
          projectId: "project-1",
          provider: "fireflies_ai",
          status: "connected",
          credentialsRef: "vault:fireflies_ai:connector-fireflies",
          providerCursorJson: {}
        })),
        update: vi.fn(async () => undefined)
      },
      communicationSyncRun: {
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => undefined)
      },
      providerWebhookEvent: {
        updateMany: vi.fn(async () => ({ count: 1 }))
      },
      project: {
        findUniqueOrThrow: vi.fn(async () => ({ orgId: "org-1" }))
      },
      jobRun: {
        upsert: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined)
      }
    } as any;
    const firefliesWebhookEnv = createEnv({
      FIREFLIES_READINESS_MODE: "api_and_webhook",
      FIREFLIES_API_KEY: "fireflies-api-key",
      FIREFLIES_WEBHOOK_SECRET: "fireflies-webhook-secret"
    });
    const sync = new SyncService(
      prisma,
      firefliesWebhookEnv,
      {} as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      new CredentialVault(firefliesWebhookEnv),
      new Map([["fireflies_ai", { provider: "fireflies_ai", sync: vi.fn(async () => ({ status: "completed", batches: [], cursorAfter: null })) } as any]]),
      { ingestNormalizedBatch: vi.fn(async () => ({ createdMessageCount: 0, updatedRevisionCount: 0, indexedMessageCount: 0 })) } as any,
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    await sync.runSyncJob({
      connectorId: "connector-fireflies",
      projectId: "project-1",
      syncType: "webhook",
      syncRunId: "sync-webhook",
      webhookPayload: { providerEventId: "fireflies:meeting.transcribed:ff-1:1710876543210", meetingId: "ff-1" },
      idempotencyKey: "sync:connector-fireflies:webhook"
    });

    expect(prisma.providerWebhookEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: "fireflies_ai",
          providerEventId: "fireflies:meeting.transcribed:ff-1:1710876543210",
          status: { in: ["queued", "failed"] }
        }),
        data: expect.objectContaining({ status: "processed" })
      })
    );
  });

  it("filters bot messages from Slack sync when includeBotMessages is false", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("conversations.history")) {
        return new Response(
          JSON.stringify({
            ok: true,
            messages: [
              {
                ts: "1713600000.000100",
                text: "User message from human",
                user: "U123"
              },
              {
                ts: "1713600001.000200",
                text: "Bot notification",
                subtype: "bot_message",
                bot_id: "B456"
              },
              {
                ts: "1713600002.000300",
                text: "Another bot via bot_id only",
                bot_id: "B789"
              }
            ],
            response_metadata: { next_cursor: "" }
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const provider = new SlackProvider(createEnv(), fetchMock as typeof fetch);

    const result = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        projectId: "project-1",
        provider: "slack",
        accountLabel: "Slack",
        status: "connected",
        configJson: { channelIds: ["C123"], includeBotMessages: false, backfillDays: 30 },
        providerCursorJson: { channels: {} }
      } as any,
      credential: { accessToken: "xoxb-test", teamId: "T123" },
      syncType: "backfill",
      batchSize: 50,
      maxBackfillDays: 30
    });

    const messages = result.batches?.[0]?.messages ?? [];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.bodyText).toBe("User message from human");
    expect(messages.every((m) => m.messageType !== "bot")).toBe(true);
  });

  it("lists Slack channels with pagination and handles missing scopes safely", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            channels: [
              { id: "C123", name: "client-delivery", is_private: false, is_archived: false },
              { id: "G123", name: "leadership-private", is_private: true, is_archived: false }
            ],
            response_metadata: { next_cursor: "next-page" }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            channels: [{ id: "C999", name: "archived", is_private: false, is_archived: true }],
            response_metadata: { next_cursor: "" }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: "missing_scope", needed: "channels:read" }), {
          status: 200
        })
      );
    const provider = new SlackProvider(createEnv(), fetchMock as typeof fetch);

    await expect(provider.listChannels?.({ credential: { accessToken: "xoxb-test" }, includePrivateChannels: true })).resolves.toEqual([
      { id: "C123", name: "client-delivery", isPrivate: false, isArchived: false },
      { id: "G123", name: "leadership-private", isPrivate: true, isArchived: false },
      { id: "C999", name: "archived", isPrivate: false, isArchived: true }
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("conversations.list");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("types=public_channel%2Cprivate_channel");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("cursor=next-page");

    await expect(provider.listChannels?.({ credential: { accessToken: "xoxb-test" } })).rejects.toMatchObject({
      code: "slack_missing_scope",
      statusCode: 403,
      details: expect.objectContaining({ method: "conversations.list" })
    });
  });

  it("marks Slack sync partial when thread replies are blocked by missing scope", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("conversations.history")) {
        return new Response(
          JSON.stringify({
            ok: true,
            messages: [
              {
                ts: "1713600000.000100",
                thread_ts: "1713600000.000100",
                text: "Need weekly reporting",
                user: "U123",
                reply_count: 1
              }
            ],
            response_metadata: { next_cursor: "" }
          }),
          { status: 200 }
        );
      }
      if (url.includes("conversations.replies")) {
        return new Response(JSON.stringify({ ok: false, error: "missing_scope", needed: "channels:history" }), {
          status: 200
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const provider = new SlackProvider(createEnv(), fetchMock as typeof fetch);

    const result = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        projectId: "project-1",
        provider: "slack",
        accountLabel: "Slack",
        status: "connected",
        configJson: { channelIds: ["C123"], includeBotMessages: false, backfillDays: 30 },
        providerCursorJson: { channels: {} }
      } as any,
      credential: { accessToken: "xoxb-test", teamId: "T123" },
      syncType: "backfill",
      batchSize: 50,
      maxBackfillDays: 30
    });

    expect(result.status).toBe("partial");
    expect(result.batches?.[0]?.messages.map((message) => message.providerMessageId)).toEqual([
      "C123:1713600000.000100"
    ]);
    expect(result.summary).toMatchObject({
      provider: "slack",
      partial: true,
      warnings: expect.arrayContaining([
        expect.objectContaining({
          code: "slack_missing_scope",
          method: "conversations.replies",
          channelId: "C123"
        })
      ])
    });
  });

  it("maps Slack delete events to channel-scoped message ids and ignores unsupported event callbacks", async () => {
    const provider = new SlackProvider(createEnv());
    const deleteResult = await provider.sync({
      projectId: "project-1",
      connector: {
        id: "connector-1",
        projectId: "project-1",
        provider: "slack",
        accountLabel: "Slack",
        status: "connected",
        configJson: { channelIds: ["C123"], includeBotMessages: false, backfillDays: 30 },
        providerCursorJson: { channels: {} }
      } as any,
      credential: { accessToken: "xoxb-test", teamId: "T123" },
      syncType: "webhook",
      webhookPayload: {
        event: {
          type: "message",
          channel: "C123",
          subtype: "message_deleted",
          deleted_ts: "1713600000.000100"
        }
      },
      batchSize: 50,
      maxBackfillDays: 30
    });

    expect(deleteResult.deletedProviderMessageIds).toEqual(["C123:1713600000.000100"]);

    const rawBody = JSON.stringify({
      type: "event_callback",
      event_id: "EvUnsupported",
      event: { type: "reaction_added", event_ts: "1713600001.000200" }
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac("sha256", "slack-signing-secret")
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex")}`;

    await expect(
      provider.verifyWebhook({
        headers: {
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature
        },
        rawBody,
        body: JSON.parse(rawBody),
        connectors: []
      })
    ).resolves.toMatchObject({
      handledImmediately: {
        statusCode: 202,
        body: { ok: true, ignored: true, reason: "slack_event_type_unsupported" }
      }
    });
  });

  it("retries provider sync on rate limits before succeeding", async () => {
    const env = createEnv();
    const telemetry = { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any;
    const vault = new CredentialVault(env);
    await vault.putCredential({
      provider: "slack",
      connectorId: "connector-1",
      credential: { accessToken: "xoxb-test" }
    });

    const adapter = {
      provider: "slack",
      sync: vi
        .fn()
        .mockRejectedValueOnce(
          new AppError(429, "Rate limited", "communication_provider_rate_limited", { retryAfterMs: 1 })
        )
        .mockResolvedValueOnce({
          queued: false,
          batches: [],
          summary: {}
        })
    };

    const prisma = {
      communicationConnector: {
        findFirstOrThrow: vi.fn(async () => ({
          id: "connector-1",
          projectId: "project-1",
          provider: "slack",
          status: "connected",
          credentialsRef: "vault:slack:connector-1",
          providerCursorJson: {}
        })),
        update: vi.fn(async () => undefined)
      },
      communicationSyncRun: {
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => undefined)
      },
      project: {
        findUnique: vi.fn(async () => ({ id: "project-1", orgId: "org-1" })),
        findUniqueOrThrow: vi.fn(async () => ({ orgId: "org-1" }))
      },
      jobRun: {
        upsert: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined)
      }
    } as any;

    const jobs = { enqueue: vi.fn(async () => undefined) };
    const sync = new SyncService(
      prisma,
      env,
      {} as any,
      { record: vi.fn(async () => undefined) } as any,
      jobs as any,
      vault,
      new Map([["slack", adapter as any]]),
      {
        ingestNormalizedBatch: vi.fn(async () => ({
          createdMessageCount: 0,
          updatedRevisionCount: 0,
          indexedMessageCount: 0
        }))
      } as any,
      telemetry
    );

    await sync.runSyncJob({
      connectorId: "connector-1",
      projectId: "project-1",
      syncType: "incremental",
      syncRunId: "sync-1",
      idempotencyKey: "sync:connector-1"
    });

    expect(adapter.sync).toHaveBeenCalledTimes(2);
    expect(telemetry.increment).toHaveBeenCalledWith("communication_provider_rate_limited_total", {
      provider: "slack"
    });
  });

  it("redacts provider secrets before persisting sync failures", async () => {
    const env = createEnv();
    const vault = new CredentialVault(env);
    await vault.putCredential({
      provider: "slack",
      connectorId: "connector-1",
      credential: { accessToken: "xoxb-test" }
    });

    const prisma = {
      communicationConnector: {
        findFirstOrThrow: vi.fn(async () => ({
          id: "connector-1",
          projectId: "project-1",
          provider: "slack",
          status: "connected",
          credentialsRef: "vault:slack:connector-1",
          providerCursorJson: {}
        })),
        update: vi.fn(async () => undefined)
      },
      communicationSyncRun: {
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => undefined)
      },
      project: {
        findUnique: vi.fn(async () => ({ id: "project-1", orgId: "org-1" })),
        findUniqueOrThrow: vi.fn(async () => ({ orgId: "org-1" }))
      },
      jobRun: {
        upsert: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined)
      }
    } as any;
    const audit = { record: vi.fn(async () => undefined) };
    const sync = new SyncService(
      prisma,
      env,
      {} as any,
      audit as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      vault,
      new Map([
        [
          "slack",
          {
            provider: "slack",
            sync: vi.fn(async () => {
              throw new Error("Bearer xoxb-provider-secret failed access_token=xoxb-access refresh_token=refresh-secret client_secret=client-secret");
            })
          } as any
        ]
      ]),
      { ingestNormalizedBatch: vi.fn(async () => undefined) } as any,
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    await expect(
      sync.runSyncJob({
        connectorId: "connector-1",
        projectId: "project-1",
        syncType: "incremental",
        syncRunId: "sync-1",
        idempotencyKey: "sync:connector-1"
      })
    ).rejects.toThrow("xoxb-provider-secret");

    const persisted = JSON.stringify([
      prisma.communicationSyncRun.update.mock.calls,
      prisma.communicationConnector.update.mock.calls,
      prisma.jobRun.update.mock.calls,
      audit.record.mock.calls
    ]);
    expect(persisted).not.toContain("xoxb-provider-secret");
    expect(persisted).not.toContain("xoxb-access");
    expect(persisted).not.toContain("refresh-secret");
    expect(persisted).not.toContain("client-secret");
    expect(persisted).toContain("Bearer [redacted]");
    expect(persisted).toContain("access_token=[redacted]");
    expect(persisted).toContain("refresh_token=[redacted]");
    expect(persisted).toContain("client_secret=[redacted]");
  });

  it("does not advance connector cursor when batch persistence fails", async () => {
    const env = createEnv();
    const vault = new CredentialVault(env);
    await vault.putCredential({
      provider: "slack",
      connectorId: "connector-1",
      credential: { accessToken: "xoxb-test" }
    });

    const prisma = {
      communicationConnector: {
        findFirstOrThrow: vi.fn(async () => ({
          id: "connector-1",
          projectId: "project-1",
          provider: "slack",
          status: "connected",
          credentialsRef: "vault:slack:connector-1",
          providerCursorJson: { before: "cursor-before" }
        })),
        update: vi.fn(async () => undefined)
      },
      communicationSyncRun: {
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => undefined)
      },
      project: {
        findUnique: vi.fn(async () => ({ id: "project-1", orgId: "org-1" })),
        findUniqueOrThrow: vi.fn(async () => ({ orgId: "org-1" }))
      },
      jobRun: {
        upsert: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined)
      }
    } as any;
    const jobs = { enqueue: vi.fn(async () => undefined) };
    const sync = new SyncService(
      prisma,
      env,
      {} as any,
      { record: vi.fn(async () => undefined) } as any,
      jobs as any,
      vault,
      new Map([
        [
          "slack",
          {
            provider: "slack",
            sync: vi.fn(async () => ({
              queued: false,
              cursorAfter: { after: "cursor-after" },
              batches: [{ threads: [], messages: [] }]
            }))
          } as any
        ]
      ]),
      { ingestNormalizedBatch: vi.fn(async () => Promise.reject(new Error("database write failed"))) } as any,
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    await expect(
      sync.runSyncJob({
        connectorId: "connector-1",
        projectId: "project-1",
        syncType: "incremental",
        syncRunId: "sync-1",
        idempotencyKey: "sync:connector-1"
      })
    ).rejects.toThrow("database write failed");

    expect(prisma.communicationConnector.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerCursorJson: expect.objectContaining({ after: "cursor-after" })
        })
      })
    );
    expect(prisma.communicationConnector.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "error",
          lastError: "database write failed"
        })
      })
    );
    expect(jobs.enqueue).toHaveBeenCalledWith(
      "refresh_dashboard_snapshot",
      expect.objectContaining({
        scope: "project",
        orgId: "org-1",
        projectId: "project-1",
        reason: "communication_sync_failed"
      }),
      expect.stringContaining("dashboard:project:project-1:")
    );
  });

  it("does not advance Fireflies cursor when transcript persistence fails", async () => {
    const env = createEnv({ FIREFLIES_READINESS_MODE: "api", FIREFLIES_API_KEY: "fireflies-api-key" });
    const vault = new CredentialVault(env);
    await vault.putCredential({
      provider: "fireflies_ai",
      connectorId: "connector-fireflies",
      credential: { apiKey: "fireflies-api-key" }
    });

    const prisma = {
      communicationConnector: {
        findFirstOrThrow: vi.fn(async () => ({
          id: "connector-fireflies",
          projectId: "project-1",
          provider: "fireflies_ai",
          status: "connected",
          credentialsRef: "vault:fireflies_ai:connector-fireflies",
          providerCursorJson: { lastSeenDateString: "2026-05-01T00:00:00.000Z" }
        })),
        update: vi.fn(async () => undefined)
      },
      communicationSyncRun: {
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => undefined)
      },
      project: {
        findUnique: vi.fn(async () => ({ id: "project-1", orgId: "org-1" })),
        findUniqueOrThrow: vi.fn(async () => ({ orgId: "org-1" }))
      },
      jobRun: {
        upsert: vi.fn(async () => undefined),
        update: vi.fn(async () => undefined)
      }
    } as any;
    const jobs = { enqueue: vi.fn(async () => undefined) };
    const sync = new SyncService(
      prisma,
      env,
      {} as any,
      { record: vi.fn(async () => undefined) } as any,
      jobs as any,
      vault,
      new Map([
        [
          "fireflies_ai",
          {
            provider: "fireflies_ai",
            sync: vi.fn(async () => ({
              queued: false,
              cursorAfter: {
                lastSeenDateString: "2026-05-12T10:00:00.000Z",
                lastSeenTranscriptIds: ["ff-1"]
              },
              batches: [{ threads: [], messages: [] }]
            }))
          } as any
        ]
      ]),
      { ingestNormalizedBatch: vi.fn(async () => Promise.reject(new Error("fireflies persistence failed"))) } as any,
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any
    );

    await expect(
      sync.runSyncJob({
        connectorId: "connector-fireflies",
        projectId: "project-1",
        syncType: "incremental",
        syncRunId: "sync-fireflies",
        idempotencyKey: "sync:connector-fireflies"
      })
    ).rejects.toThrow("fireflies persistence failed");

    expect(prisma.communicationConnector.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerCursorJson: expect.objectContaining({
            lastSeenDateString: "2026-05-12T10:00:00.000Z"
          })
        })
      })
    );
    expect(prisma.communicationConnector.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "error",
          lastError: "fireflies persistence failed"
        })
      })
    );
  });

  it("normalizes Fireflies transcript imports without exposing provider URLs by default", async () => {
    const provider = new FirefliesProvider(createEnv());

    const batch = await provider.normalizeImport({
      provider: "fireflies_ai",
      meeting: {
        providerTranscriptId: "ff-1",
        title: "Client Kickoff",
        startedAt: "2026-05-12T10:00:00.000Z",
        participants: [{ name: "Sarah Client", email: "sarah@example.com" }],
        sourceUrl: "https://app.fireflies.ai/view/ff-1",
        recordingUrl: "https://download.fireflies.ai/audio/ff-1"
      },
      summary: "Weekly reporting was discussed.",
      actionItems: ["Confirm reporting cadence"],
      segments: [
        {
          speakerName: "Sarah Client",
          speakerEmail: "sarah@example.com",
          startMs: 724000,
          endMs: 741000,
          text: "Let's change reporting from monthly to weekly."
        }
      ]
    });

    expect(batch.provider).toBe("fireflies_ai");
    expect(batch.threads[0]).toMatchObject({
      providerThreadId: "fireflies:transcript:ff-1",
      threadUrl: null
    });
    expect(batch.messages[0]).toMatchObject({
      providerMessageId: "fireflies:transcript:ff-1:full",
      providerPermalink: null,
      messageType: "note"
    });
    expect(JSON.stringify(batch.messages[0].rawMetadata)).toContain("notTruth");
    expect(JSON.stringify(batch.messages[0].rawMetadata)).toContain("hasSuppressedRecordingUrl");
    expect(batch.messages[0].attachments).toHaveLength(0);
  });

  it("does not emit a vault credential for manual-only Fireflies connect", async () => {
    const provider = new FirefliesProvider(createEnv({ FIREFLIES_READINESS_MODE: "manual_only" }));

    const result = await provider.connect({ projectId: "project-1", actorUserId: "manager-1" });

    expect(result).toMatchObject({
      mode: "connected",
      status: "connected",
      accountLabel: "Fireflies.ai manual import",
      config: expect.objectContaining({
        readinessMode: "manual_only",
        liveApi: "readiness_gated"
      })
    });
    expect(result).not.toHaveProperty("credential");
    expect(JSON.stringify(result)).not.toContain("apiKey");
  });

  it("verifies Fireflies HMAC signatures and maps webhook events to connector sync payloads", async () => {
    const env = createEnv({
      FIREFLIES_READINESS_MODE: "api_and_webhook",
      FIREFLIES_WEBHOOK_SECRET: "fireflies-webhook-secret",
      FIREFLIES_API_KEY: "fireflies-api-key"
    });
    const provider = new FirefliesProvider(env);
    const body = { event: "meeting.transcribed", timestamp: 1710876543210, meeting_id: "ff-1" };
    const rawBody = JSON.stringify(body);
    const signature = `sha256=${createHmac("sha256", env.FIREFLIES_WEBHOOK_SECRET).update(rawBody).digest("hex")}`;

    expect(verifyFirefliesSignature(rawBody, signature, env.FIREFLIES_WEBHOOK_SECRET)).toBe(true);

    const scopeToken = signFirefliesConnectorScope("connector-1", env.CONNECTOR_OAUTH_STATE_SECRET);
    const result = await provider.verifyWebhook({
      headers: { "x-hub-signature": signature },
      rawBody,
      body,
      query: { connectorId: "connector-1", scopeToken },
      connectors: [{ id: "connector-1" } as any],
      credentialsByConnectorId: { "connector-1": { apiKey: "fireflies-api-key" } }
    });

    expect(result).toMatchObject({
      providerEventId: "fireflies:meeting.transcribed:ff-1:1710876543210",
      eventType: "meeting.transcribed",
      connectorIds: ["connector-1"],
      jobPayload: { meetingId: "ff-1" }
    });

    await expect(
      provider.verifyWebhook({
        headers: { "x-hub-signature": "sha256=bad" },
        rawBody,
        body,
        connectors: []
      })
    ).rejects.toMatchObject({ statusCode: 401, code: "fireflies_webhook_signature_invalid" });

    await expect(
      provider.verifyWebhook({
        headers: { "x-hub-signature": signature },
        rawBody: "",
        body,
        connectors: []
      })
    ).rejects.toMatchObject({ statusCode: 401, code: "fireflies_webhook_raw_body_missing" });
  });

  it("requires explicit connector scope before Fireflies webhooks enqueue API sync", async () => {
    const env = createEnv({
      FIREFLIES_READINESS_MODE: "api_and_webhook",
      FIREFLIES_WEBHOOK_SECRET: "fireflies-webhook-secret",
      FIREFLIES_API_KEY: "fireflies-api-key"
    });
    const provider = new FirefliesProvider(env);
    const body = { event: "meeting.transcribed", timestamp: 1710876543210, meeting_id: "ff-ambiguous" };
    const rawBody = JSON.stringify(body);
    const signature = `sha256=${createHmac("sha256", env.FIREFLIES_WEBHOOK_SECRET).update(rawBody).digest("hex")}`;

    const result = await provider.verifyWebhook({
      headers: { "x-hub-signature": signature },
      rawBody,
      body,
      connectors: [{ id: "connector-1" } as any]
    });

    expect(result.handledImmediately).toMatchObject({
      statusCode: 202,
      body: {
        ok: true,
        ignored: true,
        reason: "fireflies_connector_scope_required"
      }
    });
    expect(result.connectorIds).toBeUndefined();
  });

  it("ignores Fireflies webhooks scoped to an unknown connector", async () => {
    const env = createEnv({
      FIREFLIES_READINESS_MODE: "api_and_webhook",
      FIREFLIES_WEBHOOK_SECRET: "fireflies-webhook-secret",
      FIREFLIES_API_KEY: "fireflies-api-key"
    });
    const provider = new FirefliesProvider(env);
    const body = { event: "meeting.transcribed", timestamp: 1710876543210, meeting_id: "ff-unknown-connector" };
    const rawBody = JSON.stringify(body);
    const signature = `sha256=${createHmac("sha256", env.FIREFLIES_WEBHOOK_SECRET).update(rawBody).digest("hex")}`;

    const scopeToken = signFirefliesConnectorScope("connector-missing", env.CONNECTOR_OAUTH_STATE_SECRET);
    const result = await provider.verifyWebhook({
      headers: { "x-hub-signature": signature },
      rawBody,
      body,
      query: { connectorId: "connector-missing", scopeToken },
      connectors: [{ id: "connector-1" } as any]
    });

    expect(result.handledImmediately).toMatchObject({
      statusCode: 202,
      body: {
        ok: true,
        ignored: true,
        reason: "fireflies_connector_scope_not_found"
      }
    });
  });

  it("verifies Fireflies webhook-only mode without enqueueing API-dependent sync", async () => {
    const env = createEnv({
      FIREFLIES_READINESS_MODE: "webhook",
      FIREFLIES_WEBHOOK_SECRET: "fireflies-webhook-secret",
      FIREFLIES_API_KEY: undefined
    });
    const provider = new FirefliesProvider(env);
    const body = { event: "meeting.transcribed", timestamp: 1710876543210, meeting_id: "ff-webhook-only" };
    const rawBody = JSON.stringify(body);
    const signature = `sha256=${createHmac("sha256", env.FIREFLIES_WEBHOOK_SECRET).update(rawBody).digest("hex")}`;

    const result = await provider.verifyWebhook({
      headers: { "X-Hub-Signature": signature },
      rawBody,
      body,
      connectors: [{ id: "connector-1" } as any]
    });

    expect(result).toMatchObject({
      providerEventId: "fireflies:meeting.transcribed:ff-webhook-only:1710876543210",
      eventType: "meeting.transcribed",
      connectorIds: []
    });
    expect(result.jobPayload).toBeUndefined();
  });

  it("syncs Fireflies transcripts through GraphQL with cursor metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              transcripts: [{ id: "ff-1", title: "Client Kickoff", dateString: "2026-05-12T10:00:00.000Z" }]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              transcript: {
                id: "ff-1",
                title: "Client Kickoff",
                dateString: "2026-05-12T10:00:00.000Z",
                duration: 60,
                participants: ["sarah@example.com"],
                meeting_attendees: [
                  {
                    displayName: "Taylor Dev",
                    email: "taylor@example.com",
                    phoneNumber: null,
                    name: null,
                    location: null
                  }
                ],
                sentences: [
                  {
                    index: 0,
                    speaker_name: "Sarah Client",
                    text: "We approved weekly reporting.",
                    start_time: "00:12:04",
                    end_time: "00:12:21"
                  }
                ],
                summary: { action_items: "Follow up" }
              }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    const provider = new FirefliesProvider(
      createEnv({ FIREFLIES_READINESS_MODE: "api", FIREFLIES_API_KEY: "fireflies-api-key" }),
      fetchMock as any
    );

    const result = await provider.sync({
      projectId: "project-1",
      connector: { id: "connector-1", providerCursorJson: null } as any,
      credential: { apiKey: "fireflies-api-key" },
      syncType: "backfill",
      batchSize: 50,
      maxBackfillDays: 30
    } as any);

    expect(result.batches?.[0]?.messages[0]?.providerMessageId).toBe("fireflies:transcript:ff-1:full");
    expect(result.batches?.[0]?.threads[0]?.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "sarah@example.com", email: "sarah@example.com" }),
        expect.objectContaining({ label: "Taylor Dev", email: "taylor@example.com" })
      ])
    );
    expect(result.cursorAfter).toMatchObject({
      lastSeenTranscriptIds: ["ff-1"],
      providerLimitations: {
        updatedAtUnavailable: true,
        deleteFeedUnavailable: true
      }
    });
  });

  it("uses Fireflies list pagination parameters while respecting the per-run detail cap", async () => {
    const firstPage = Array.from({ length: 2 }, (_, index) => ({
      id: `ff-${index + 1}`,
      title: `Meeting ${index + 1}`,
      dateString: `2026-05-12T10:0${index}:00.000Z`
    }));
    const transcriptDetail = (id: string) =>
      new Response(
        JSON.stringify({
          data: {
            transcript: {
              id,
              title: `Meeting ${id}`,
              dateString: "2026-05-12T10:00:00.000Z",
              duration: 30,
              sentences: [
                {
                  index: 0,
                  speaker_name: "Sarah Client",
                  text: `Transcript detail for ${id}`,
                  start_time: "00:00:01",
                  end_time: "00:00:03"
                }
              ]
            }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { transcripts: firstPage } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(transcriptDetail("ff-1"))
      .mockResolvedValueOnce(transcriptDetail("ff-2"));
    const provider = new FirefliesProvider(
      createEnv({
        FIREFLIES_READINESS_MODE: "api",
        FIREFLIES_API_KEY: "fireflies-api-key",
        FIREFLIES_SYNC_BATCH_SIZE: 2
      }),
      fetchMock as any
    );

    const result = await provider.sync({
      projectId: "project-1",
      connector: { id: "connector-1", providerCursorJson: { lastSeenDateString: "2026-05-01T00:00:00.000Z" } } as any,
      credential: { apiKey: "fireflies-api-key" },
      syncType: "backfill",
      batchSize: 2,
      maxBackfillDays: 30
    } as any);

    const requestBodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    const listRequests = requestBodies.filter((body) => String(body.query).includes("FirefliesTranscripts"));
    expect(listRequests.map((body) => body.variables.skip)).toEqual([0]);
    expect(listRequests.map((body) => body.variables.limit)).toEqual([2]);
    expect(listRequests.every((body) => typeof body.variables.fromDate === "string")).toBe(true);
    expect(listRequests.every((body) => typeof body.variables.toDate === "string")).toBe(true);
    expect(result.batches?.map((batch) => batch.messages[0]?.providerMessageId)).toEqual([
      "fireflies:transcript:ff-1:full",
      "fireflies:transcript:ff-2:full"
    ]);
    expect(result.cursorAfter).toMatchObject({
      firefliesContinuation: {
        fromDate: "2026-05-01T00:00:00.000Z",
        nextSkip: 2
      }
    });
    expect(result.summary).toMatchObject({ cursorAdvanced: true, continuationCursor: true, hasMore: true });
  });

  it("does not advance the pull cursor for targeted Fireflies webhook syncs", async () => {
    const transcriptDetail = (id: string | null) =>
      new Response(
        JSON.stringify({
          data: {
            transcript: id
              ? {
                  id,
                  title: "Webhook Meeting",
                  dateString: "2026-05-01T10:00:00.000Z",
                  duration: 30,
                  sentences: [
                    {
                      index: 0,
                      speaker_name: "Sarah Client",
                      text: "Approved: weekly reporting is required.",
                      start_time: "00:01:00",
                      end_time: "00:01:12"
                    }
                  ]
                }
              : null
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const fetchMock = vi.fn().mockResolvedValueOnce(transcriptDetail("ff-webhook")).mockResolvedValueOnce(transcriptDetail(null));
    const provider = new FirefliesProvider(
      createEnv({ FIREFLIES_READINESS_MODE: "api_and_webhook", FIREFLIES_API_KEY: "fireflies-api-key" }),
      fetchMock as any
    );

    const result = await provider.sync({
      projectId: "project-1",
      connector: { id: "connector-1", providerCursorJson: { lastSeenDateString: "2026-05-12T10:00:00.000Z" } } as any,
      credential: { apiKey: "fireflies-api-key" },
      syncType: "webhook",
      webhookPayload: { meetingId: "ff-webhook" },
      batchSize: 50,
      maxBackfillDays: 30
    } as any);

    expect(result.batches).toHaveLength(1);
    expect(result.cursorAfter).toBeNull();

    const missing = await provider.sync({
      projectId: "project-1",
      connector: { id: "connector-1", providerCursorJson: { lastSeenDateString: "2026-05-12T10:00:00.000Z" } } as any,
      credential: { apiKey: "fireflies-api-key" },
      syncType: "webhook",
      webhookPayload: { meetingId: "ff-missing" },
      batchSize: 50,
      maxBackfillDays: 30
    } as any);

    expect(missing.batches).toEqual([]);
    expect(missing.cursorAfter).toBeNull();
  });

  it("caps Fireflies transcript detail fan-out to the sync batch size", async () => {
    const page = Array.from({ length: 4 }, (_, index) => ({
      id: `ff-cap-${index + 1}`,
      title: `Meeting ${index + 1}`,
      dateString: `2026-05-12T10:0${index}:00.000Z`
    }));
    const transcriptDetail = (id: string) =>
      new Response(
        JSON.stringify({
          data: {
            transcript: {
              id,
              title: `Meeting ${id}`,
              dateString: "2026-05-12T10:00:00.000Z",
              duration: 30,
              sentences: [{ index: 0, speaker_name: "Sarah", text: `Detail ${id}`, start_time: "00:00:01" }]
            }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("FirefliesTranscripts")) {
        return new Response(JSON.stringify({ data: { transcripts: page } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return transcriptDetail(String(body.variables.transcriptId));
    });
    const provider = new FirefliesProvider(
      createEnv({ FIREFLIES_READINESS_MODE: "api", FIREFLIES_API_KEY: "fireflies-api-key", FIREFLIES_SYNC_BATCH_SIZE: 2 }),
      fetchMock as any
    );

    const result = await provider.sync({
      projectId: "project-1",
      connector: { id: "connector-1", providerCursorJson: null } as any,
      credential: { apiKey: "fireflies-api-key" },
      syncType: "backfill",
      batchSize: 2,
      maxBackfillDays: 30
    } as any);

    const requestBodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    const detailRequests = requestBodies.filter((body) => String(body.query).includes("FirefliesTranscript("));
    expect(detailRequests.map((body) => body.variables.transcriptId)).toEqual(["ff-cap-1", "ff-cap-2"]);
    expect(result.batches).toHaveLength(2);
    expect(result.cursorAfter).toMatchObject({
      firefliesContinuation: {
        nextSkip: 2
      }
    });
    expect(result.summary).toMatchObject({ cursorAdvanced: true, continuationCursor: true, hasMore: true });
  });

  it("does not mutate processed webhook event rows on duplicate Fireflies deliveries", async () => {
    const verifyWebhook = vi.fn(async () => ({
      providerEventId: "fireflies:meeting.transcribed:ff-1:1710876543210",
      eventType: "meeting.transcribed",
      connectorIds: ["connector-fireflies"],
      jobPayload: { meetingId: "ff-1" }
    }));
    const prisma = {
      communicationConnector: {
        findMany: vi.fn(async () => [
          {
            id: "connector-fireflies",
            projectId: "project-1",
            provider: "fireflies_ai",
            status: "connected"
          }
        ])
      },
      providerWebhookEvent: {
        findUnique: vi.fn(async () => ({
          id: "webhook-event-1",
          provider: "fireflies_ai",
          providerEventId: "fireflies:meeting.transcribed:ff-1:1710876543210",
          status: "processed"
        })),
        update: vi.fn(async () => undefined),
        create: vi.fn(async () => undefined)
      }
    } as any;
    const telemetry = { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") };
    const firefliesWebhookEnv = createEnv({
      FIREFLIES_READINESS_MODE: "api_and_webhook",
      FIREFLIES_API_KEY: "fireflies-api-key",
      FIREFLIES_WEBHOOK_SECRET: "fireflies-webhook-secret"
    });
    const service = new ConnectorsService(
      prisma,
      firefliesWebhookEnv,
      {} as any,
      {} as any,
      { enqueue: vi.fn() } as any,
      new CredentialVault(firefliesWebhookEnv),
      new Map([["fireflies_ai", { provider: "fireflies_ai", verifyWebhook } as any]]),
      telemetry as any,
      { enqueueSync: vi.fn() } as any
    );

    const result = await service.handleWebhook("fireflies_ai", {
      headers: { "x-hub-signature": "sha256=test" },
      rawBody: "{\"event\":\"meeting.transcribed\"}",
      body: { event: "meeting.transcribed", meeting_id: "ff-1", timestamp: 1710876543210 }
    });

    expect(result).toEqual({ statusCode: 200, body: { ok: true, duplicate: true } });
    expect(prisma.providerWebhookEvent.update).not.toHaveBeenCalled();
    expect(prisma.providerWebhookEvent.create).not.toHaveBeenCalled();
    expect(telemetry.increment).toHaveBeenCalledWith("communication_webhook_duplicates_total", {
      provider: "fireflies_ai"
    });
  });

  it("re-enqueues retryable queued Fireflies webhook events instead of dropping them as duplicates", async () => {
    const verifyWebhook = vi.fn(async () => ({
      providerEventId: "fireflies:meeting.transcribed:ff-retry:1710876543210",
      eventType: "meeting.transcribed",
      connectorIds: ["connector-fireflies"],
      jobPayload: { meetingId: "ff-retry" }
    }));
    const prisma = {
      communicationConnector: {
        findMany: vi.fn(async () => [
          {
            id: "connector-fireflies",
            projectId: "project-1",
            provider: "fireflies_ai",
            status: "connected"
          }
        ])
      },
      providerWebhookEvent: {
        findUnique: vi.fn(async () => ({
          id: "webhook-event-retry",
          provider: "fireflies_ai",
          providerEventId: "fireflies:meeting.transcribed:ff-retry:1710876543210",
          status: "queued"
        })),
        update: vi.fn(async (args) => ({ id: args.where.id, ...args.data })),
        create: vi.fn(async () => undefined)
      }
    } as any;
    const syncService = { enqueueSync: vi.fn(async () => undefined) };
    const firefliesWebhookEnv = createEnv({
      FIREFLIES_READINESS_MODE: "api_and_webhook",
      FIREFLIES_API_KEY: "fireflies-api-key",
      FIREFLIES_WEBHOOK_SECRET: "fireflies-webhook-secret"
    });
    const service = new ConnectorsService(
      prisma,
      firefliesWebhookEnv,
      {} as any,
      {} as any,
      { enqueue: vi.fn() } as any,
      new CredentialVault(firefliesWebhookEnv),
      new Map([["fireflies_ai", { provider: "fireflies_ai", verifyWebhook } as any]]),
      { increment: vi.fn(), observeDuration: vi.fn(), setGauge: vi.fn(), renderPrometheus: vi.fn(() => "") } as any,
      syncService as any
    );

    const result = await service.handleWebhook("fireflies_ai", {
      headers: { "x-hub-signature": "sha256=test" },
      rawBody: "{\"event\":\"meeting.transcribed\"}",
      body: { event: "meeting.transcribed", meeting_id: "ff-retry", timestamp: 1710876543210 }
    });

    expect(result).toEqual({ statusCode: 200, body: { ok: true, retried: true } });
    expect(syncService.enqueueSync).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        connectorId: "connector-fireflies",
        syncType: "webhook",
        webhookPayload: expect.objectContaining({ meetingId: "ff-retry" })
      })
    );
    expect(prisma.providerWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "webhook-event-retry" },
        data: expect.objectContaining({ status: "queued", processedAt: null })
      })
    );
  });

  it("redacts Fireflies GraphQL rate-limit failures before persistence surfaces them", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Bearer fireflies-api-key" }), {
        status: 429,
        headers: { "retry-after": "2" }
      })
    );
    const provider = new FirefliesProvider(
      createEnv({ FIREFLIES_READINESS_MODE: "api", FIREFLIES_API_KEY: "fireflies-api-key" }),
      fetchMock as any
    );

    await expect(
      provider.sync({
        projectId: "project-1",
        connector: { id: "connector-fireflies", providerCursorJson: null } as any,
        credential: { apiKey: "fireflies-api-key" },
        syncType: "backfill",
        batchSize: 50,
        maxBackfillDays: 30
      } as any)
    ).rejects.toMatchObject({
      code: "communication_provider_rate_limited",
      details: expect.objectContaining({
        provider: "fireflies_ai",
        operation: "transcripts"
      })
    });
    const serializedError = await provider.sync({
      projectId: "project-1",
      connector: { id: "connector-fireflies", providerCursorJson: null } as any,
      credential: { apiKey: "fireflies-api-key" },
      syncType: "backfill",
      batchSize: 50,
      maxBackfillDays: 30
    } as any).catch((error) => JSON.stringify(error));
    expect(serializedError).not.toContain("fireflies-api-key");
  });
});
