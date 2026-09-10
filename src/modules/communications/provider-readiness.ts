import type { CommunicationConnectorStatus, CommunicationProvider } from "@prisma/client";
import type { AppEnv } from "../../config/env.js";
import { isMvpBetaMode } from "../../lib/beta/policy.js";
import { isProviderEnabledForMvp } from "../../lib/mvp/policy.js";
import {
  isProviderReleaseValidated,
  PROVIDER_RELEASE_VALIDATION_REASON
} from "../../lib/integrations/provider-release.js";

export type ProviderReadinessState = "enabled" | "disabled" | "readiness_gated" | "error" | "revoked";

export interface ProviderReadiness {
  state: ProviderReadinessState;
  canConnect: boolean;
  canSync: boolean;
  canManualImport: boolean;
  canWebhook: boolean;
  reasons: string[];
  missingConfig: string[];
  deferredFeatures: string[];
  authModes?: string[];
  selectedResourceMode?: string;
  writeActionsEnabled?: false;
  syncImplemented?: boolean | "foundation_only";
  warnings?: string[];
  scopes?: string[];
  backfillEnabled?: boolean;
  incrementalSyncEnabled?: boolean;
  webhooksEnabled?: boolean;
}

function hasAll(env: AppEnv, fields: Array<keyof AppEnv>) {
  return fields.filter((field) => !env[field]);
}

export function getProviderReadiness(
  env: AppEnv,
  provider: CommunicationProvider,
  connector?: {
    status?: CommunicationConnectorStatus | string | null;
    credentialsRef?: string | null;
    configJson?: unknown;
  }
): ProviderReadiness {
  if (connector?.status === "revoked") {
    return {
      state: "revoked",
      canConnect: false,
      canSync: false,
      canManualImport: false,
      canWebhook: false,
      reasons: ["connector_revoked"],
      missingConfig: [],
      deferredFeatures: []
    };
  }

  const gmailInviteSenderEnabled = provider === "gmail" && env.BETA_GMAIL_INVITE_SENDER_ENABLED === true;
  if (provider !== "manual_import" && !gmailInviteSenderEnabled && !isProviderReleaseValidated(env, provider)) {
    return {
      state: "readiness_gated",
      canConnect: false,
      canSync: false,
      canManualImport: false,
      canWebhook: false,
      reasons: [PROVIDER_RELEASE_VALIDATION_REASON],
      missingConfig: [],
      deferredFeatures: ["provider_actions_disabled_until_live_validation_passes"]
    };
  }

  if (connector?.status === "error") {
    return {
      ...baseReadiness(env, provider, connector),
      state: "error",
      reasons: ["connector_error", ...baseReadiness(env, provider, connector).reasons]
    };
  }

  const readiness = baseReadiness(env, provider, connector);
  if (
    readiness.canSync &&
    connector != null &&
    ["connected", "syncing"].includes(String(connector.status ?? "")) &&
    requiresCredentialRef(provider) &&
    !connector.credentialsRef
  ) {
    return {
      ...readiness,
      state: "error",
      canSync: false,
      canWebhook: false,
      reasons: ["connector_credential_missing", ...readiness.reasons],
      deferredFeatures: [...readiness.deferredFeatures, "reconnect_required"]
    };
  }

  return readiness;
}

function baseReadiness(
  env: AppEnv,
  provider: CommunicationProvider,
  connector?: {
    configJson?: unknown;
  }
): ProviderReadiness {
  if (!isBetaVisibleProvider(env, provider) && !isProviderEnabledForMvp(env, provider)) {
    return {
      state: "disabled",
      canConnect: false,
      canSync: false,
      canManualImport: false,
      canWebhook: false,
      reasons: ["disabled_in_mvp_mode"],
      missingConfig: [],
      deferredFeatures: ["provider_disabled_by_mvp_profile"]
    };
  }

  if (provider === "manual_import") {
    return {
      state: "enabled",
      canConnect: true,
      canSync: false,
      canManualImport: true,
      canWebhook: false,
      reasons: ["manual_import_available_without_external_credentials", "manual_import_has_no_external_sync_source"],
      missingConfig: [],
      deferredFeatures: []
    };
  }

  if (provider === "slack") {
    if (isMvpBetaMode(env) && env.BETA_SLACK_CONNECTOR_ENABLED === false) {
      return {
        state: "disabled",
        canConnect: false,
        canSync: false,
        canManualImport: false,
        canWebhook: false,
        reasons: ["beta_slack_connector_disabled"],
        missingConfig: [],
        deferredFeatures: ["slack_connector_disabled_by_beta_env"]
      };
    }
    if (env.SLACK_CONNECTOR_ENABLED === false) {
      return {
        state: "disabled",
        canConnect: false,
        canSync: false,
        canManualImport: false,
        canWebhook: false,
        reasons: ["slack_connector_disabled"],
        missingConfig: [],
        deferredFeatures: ["slack_connector_disabled_by_env"]
      };
    }
    const missing = hasAll(env, ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_REDIRECT_URI", "SLACK_SIGNING_SECRET"]);
    return readinessFromMissing(missing, {
      enabledReason: "slack_oauth_and_webhooks_configured",
      gatedReason: "slack_configuration_incomplete",
      canSync: env.SLACK_BACKFILL_ENABLED !== false,
      canWebhook:
        env.SLACK_WEBHOOKS_ENABLED !== false &&
        (!isMvpBetaMode(env) || env.BETA_SLACK_WEBHOOKS_ENABLED === true),
      deferredFeatures: [
        ...(env.SLACK_BACKFILL_ENABLED === false ? ["slack_backfill_disabled_by_env"] : []),
        ...(env.SLACK_WEBHOOKS_ENABLED === false ? ["slack_webhooks_disabled_by_env"] : []),
        ...(isMvpBetaMode(env) && env.BETA_SLACK_WEBHOOKS_ENABLED === false ? ["beta_slack_webhooks_deferred"] : []),
        ...(env.SLACK_WRITE_ACTIONS_ENABLED ? ["slack_write_actions_must_remain_disabled_for_mvp"] : [])
      ]
    });
  }

  if (provider === "gmail") {
    if (isMvpBetaMode(env) && env.BETA_GMAIL_INVITE_SENDER_ENABLED !== true) {
      return {
        state: "disabled",
        canConnect: false,
        canSync: false,
        canManualImport: false,
        canWebhook: false,
        reasons: ["beta_gmail_invite_sender_disabled"],
        missingConfig: [],
        deferredFeatures: ["gmail_invitation_delivery_disabled_by_beta_env"]
      };
    }
    const missing = hasAll(env, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"]);
    return readinessFromMissing(missing, {
      enabledReason: "gmail_invitation_sender_oauth_configured",
      gatedReason: "gmail_configuration_incomplete",
      canSync: !isMvpBetaMode(env),
      deferredFeatures: isMvpBetaMode(env)
        ? ["gmail_mailbox_sync_disabled_for_invitation_sender"]
        : env.GOOGLE_PUBSUB_TOPIC ? [] : ["gmail_push_watch_deferred_without_google_pubsub_topic"]
    });
  }

  if (provider === "outlook") {
    const missing = hasAll(env, [
      "MICROSOFT_CLIENT_ID",
      "MICROSOFT_CLIENT_SECRET",
      "MICROSOFT_REDIRECT_URI",
      "MICROSOFT_TENANT_ID"
    ]);
    return readinessFromMissing(missing, {
      enabledReason: "microsoft_oauth_configured_for_outlook",
      gatedReason: "microsoft_configuration_incomplete",
      canSync: true,
      deferredFeatures: []
    });
  }

  if (provider === "microsoft_teams") {
    if (isMvpBetaMode(env) && env.BETA_MICROSOFT_TEAMS_CONNECTOR_ENABLED === false) {
      return {
        state: "disabled",
        canConnect: false,
        canSync: false,
        canManualImport: false,
        canWebhook: false,
        reasons: ["beta_microsoft_teams_connector_disabled"],
        missingConfig: [],
        deferredFeatures: ["microsoft_teams_connector_disabled_by_beta_env"],
        selectedResourceMode: "selected_teams_channels_chats_only",
        writeActionsEnabled: false,
        webhooksEnabled: false
      };
    }
    if (env.MICROSOFT_TEAMS_CONNECTOR_ENABLED === false) {
      return {
        state: "disabled",
        canConnect: false,
        canSync: false,
        canManualImport: false,
        canWebhook: false,
        reasons: ["microsoft_teams_connector_disabled"],
        missingConfig: [],
        deferredFeatures: ["microsoft_teams_connector_disabled_by_env"],
        selectedResourceMode: "selected_teams_channels_chats_only",
        writeActionsEnabled: false,
        webhooksEnabled: false
      };
    }
    const missing = hasAll(env, [
      "MICROSOFT_CLIENT_ID",
      "MICROSOFT_CLIENT_SECRET",
      "MICROSOFT_REDIRECT_URI",
      "MICROSOFT_TENANT_ID",
      "MICROSOFT_GRAPH_BASE_URL"
    ]);
    const config = (connector?.configJson ?? {}) as Record<string, unknown>;
    const selectedTeamIds = Array.isArray(config.selectedMicrosoftTeamIds) ? config.selectedMicrosoftTeamIds : [];
    const selectedChannelIds = Array.isArray(config.selectedMicrosoftChannelIds) ? config.selectedMicrosoftChannelIds : [];
    const selectedChatIds = Array.isArray(config.selectedMicrosoftChatIds) ? config.selectedMicrosoftChatIds : [];
    const hasLegacyTeamsConfig = Array.isArray(config.teams) && config.teams.length > 0;
    const includeChats = config.includeMicrosoftChats === true || config.includeChats === true;
    const hasSelectedChannelConfig =
      hasLegacyTeamsConfig ||
      selectedChannelIds.some((value) => typeof value === "string" && /^team:[^:]+:channel:.+/.test(value)) ||
      (selectedTeamIds.length === 1 && selectedChannelIds.length > 0);
    const hasSelectedConfig = hasSelectedChannelConfig || (includeChats && selectedChatIds.length > 0);
    const readiness = readinessFromMissing(missing, {
      enabledReason: "microsoft_oauth_configured_for_teams",
      gatedReason: "microsoft_configuration_incomplete",
      canSync: hasSelectedConfig && env.MICROSOFT_TEAMS_BACKFILL_ENABLED !== false,
      canWebhook: env.MICROSOFT_TEAMS_WEBHOOKS_ENABLED === true,
      deferredFeatures: [
        ...(env.MICROSOFT_TEAMS_BACKFILL_ENABLED === false ? ["teams_backfill_disabled_by_env"] : []),
        ...(env.MICROSOFT_TEAMS_INCREMENTAL_SYNC_ENABLED === false ? ["teams_incremental_sync_disabled_by_env"] : []),
        ...(env.MICROSOFT_TEAMS_WEBHOOKS_ENABLED === false ? ["teams_webhooks"] : []),
        "teams_write_actions"
      ]
    });
    return {
      ...readiness,
      reasons: hasSelectedConfig ? readiness.reasons : [...readiness.reasons, "teams_selected_resource_config_required_for_sync"],
      canSync: readiness.canSync && hasSelectedConfig,
      selectedResourceMode: "selected_teams_channels_chats_only",
      writeActionsEnabled: false,
      backfillEnabled: env.MICROSOFT_TEAMS_BACKFILL_ENABLED !== false,
      incrementalSyncEnabled: env.MICROSOFT_TEAMS_INCREMENTAL_SYNC_ENABLED !== false,
      webhooksEnabled: env.MICROSOFT_TEAMS_WEBHOOKS_ENABLED === true,
      warnings: [
        "teams_admin_consent_may_be_required",
        "teams_application_permissions_private_pilot_gated",
        "teams_no_all_tenant_sync"
      ],
      scopes: env.MICROSOFT_GRAPH_SCOPES
    };
  }

  if (provider === "notion") {
    return notionReadiness(env);
  }

  if (provider === "fireflies_ai") {
    if (isMvpBetaMode(env) && env.BETA_FIREFLIES_CONNECTOR_ENABLED === false) {
      return {
        state: "disabled",
        canConnect: false,
        canSync: false,
        canManualImport: false,
        canWebhook: false,
        reasons: ["beta_fireflies_connector_disabled"],
        missingConfig: [],
        deferredFeatures: ["fireflies_connector_disabled_by_beta_env"]
      };
    }
    return firefliesReadiness(env);
  }

  if (provider === "clickup") {
    if (isMvpBetaMode(env) && env.BETA_CLICKUP_CONNECTOR_ENABLED === false) {
      return {
        state: "disabled",
        canConnect: false,
        canSync: false,
        canManualImport: false,
        canWebhook: false,
        reasons: ["beta_clickup_connector_disabled"],
        missingConfig: [],
        deferredFeatures: ["clickup_connector_disabled_by_beta_env"]
      };
    }
    if (env.CLICKUP_CONNECTOR_ENABLED === false) {
      return {
        state: "disabled",
        canConnect: false,
        canSync: false,
        canManualImport: false,
        canWebhook: false,
        reasons: ["clickup_connector_disabled"],
        missingConfig: [],
        deferredFeatures: ["clickup_connector_disabled_by_env"]
      };
    }
    const oauthMissing = hasAll(env, ["CLICKUP_CLIENT_ID", "CLICKUP_CLIENT_SECRET", "CLICKUP_REDIRECT_URI"]);
    const webhookMissing = env.CLICKUP_WEBHOOKS_ENABLED === false ? [] : hasAll(env, ["CLICKUP_WEBHOOK_SECRET"]);
    const missing = [...oauthMissing, ...webhookMissing];
    if (oauthMissing.length > 0) {
      return {
        state: "readiness_gated",
        canConnect: false,
        canSync: false,
        canManualImport: false,
        canWebhook: false,
        reasons: ["clickup_configuration_incomplete"],
        missingConfig: missing,
        deferredFeatures: [
          ...(env.CLICKUP_BACKFILL_ENABLED === false ? ["clickup_backfill_disabled_by_env"] : []),
          ...(env.CLICKUP_WEBHOOKS_ENABLED === false ? ["clickup_webhooks_disabled_by_env"] : []),
          ...(env.CLICKUP_WRITE_ACTIONS_ENABLED ? ["clickup_write_actions_must_remain_disabled"] : [])
        ]
      };
    }
    return {
      state: "enabled",
      canConnect: true,
      canSync: env.CLICKUP_BACKFILL_ENABLED !== false,
      canManualImport: false,
      canWebhook: env.CLICKUP_WEBHOOKS_ENABLED !== false && webhookMissing.length === 0,
      reasons: [
        "clickup_oauth_configured",
        ...(webhookMissing.length > 0 ? ["clickup_webhook_secret_missing_until_webhooks_registered"] : ["clickup_webhook_secret_configured"])
      ],
      missingConfig: missing,
      deferredFeatures: [
        "clickup_write_actions_disabled",
        "clickup_attachment_ingestion_disabled",
        ...(env.CLICKUP_BACKFILL_ENABLED === false ? ["clickup_backfill_disabled_by_env"] : []),
        ...(env.CLICKUP_WEBHOOKS_ENABLED === false ? ["clickup_webhooks_disabled_by_env"] : [])
      ]
    };
  }

  if (provider === "granola") {
    if (isMvpBetaMode(env) && env.BETA_GRANOLA_CONNECTOR_ENABLED === false) {
      return {
        state: "disabled",
        canConnect: false,
        canSync: false,
        canManualImport: false,
        canWebhook: false,
        reasons: ["beta_granola_connector_disabled"],
        missingConfig: [],
        deferredFeatures: ["granola_connector_disabled_by_beta_env"]
      };
    }
    if (env.GRANOLA_CONNECTOR_ENABLED === false) {
      return {
        state: "disabled",
        canConnect: false,
        canSync: false,
        canManualImport: false,
        canWebhook: false,
        reasons: ["granola_connector_disabled"],
        missingConfig: [],
        deferredFeatures: ["granola_connector_disabled_by_env"]
      };
    }
    const readiness = readinessFromMissing(hasAll(env, ["GRANOLA_API_BASE_URL"]), {
      enabledReason: connector ? "granola_connector_ready" : "granola_api_key_connection_available",
      gatedReason: "granola_configuration_incomplete",
      canSync: Boolean(connector) && (env.GRANOLA_BACKFILL_ENABLED !== false || env.GRANOLA_INCREMENTAL_SYNC_ENABLED !== false),
      canWebhook: false,
      deferredFeatures: [
        "granola_webhooks_not_supported",
        "granola_write_actions_disabled",
        "granola_note_creation_disabled",
        "granola_note_update_disabled",
        "granola_audio_sync_not_supported",
        ...(env.GRANOLA_BACKFILL_ENABLED === false ? ["granola_backfill_disabled_by_env"] : []),
        ...(env.GRANOLA_INCREMENTAL_SYNC_ENABLED === false ? ["granola_incremental_sync_disabled_by_env"] : []),
        ...(env.GRANOLA_WRITE_ACTIONS_ENABLED ? ["granola_write_actions_must_remain_disabled"] : []),
        ...(env.GRANOLA_ATTACHMENT_INGESTION_ENABLED ? ["granola_attachment_ingestion_must_remain_disabled"] : [])
      ]
    });
    return {
      ...readiness,
      reasons: connector == null ? [...readiness.reasons, "granola_connector_not_connected"] : readiness.reasons,
      canSync: readiness.canSync && Boolean(connector)
    };
  }

  if (provider === "zoho_mail" || provider === "zoho_cliq" || provider === "zoho_crm") {
    return zohoReadiness(env, provider, Boolean(connector));
  }

  if (env.WHATSAPP_READINESS_MODE === "disabled") {
    return {
      state: "disabled",
      canConnect: false,
      canSync: false,
      canManualImport: false,
      canWebhook: false,
      reasons: ["whatsapp_readiness_mode_disabled"],
      missingConfig: [],
      deferredFeatures: ["whatsapp_outbound_messaging_deferred"]
    };
  }

  const missing = hasAll(env, ["WHATSAPP_WEBHOOK_VERIFY_TOKEN", "WHATSAPP_APP_SECRET"]);
  return readinessFromMissing(missing, {
      enabledReason: "whatsapp_inbound_webhook_configured",
      gatedReason: "whatsapp_webhook_configuration_incomplete",
      canSync: false,
      canWebhook: true,
      deferredFeatures: ["whatsapp_manual_sync_noop", "whatsapp_outbound_messaging_deferred"]
  });
}

function isBetaVisibleProvider(env: AppEnv, provider: CommunicationProvider) {
  return (
    isMvpBetaMode(env) &&
    (provider === "manual_import" ||
      (provider === "slack" && env.BETA_SLACK_CONNECTOR_ENABLED !== false) ||
      (provider === "gmail" && env.BETA_GMAIL_INVITE_SENDER_ENABLED === true) ||
      (provider === "clickup" && env.BETA_CLICKUP_CONNECTOR_ENABLED !== false) ||
      (provider === "granola" && env.BETA_GRANOLA_CONNECTOR_ENABLED !== false) ||
      (provider === "fireflies_ai" && env.BETA_FIREFLIES_CONNECTOR_ENABLED !== false) ||
      (provider === "microsoft_teams" && env.BETA_MICROSOFT_TEAMS_CONNECTOR_ENABLED !== false) ||
      (provider === "zoho_mail" && env.BETA_ZOHO_MAIL_CONNECTOR_ENABLED !== false) ||
      (provider === "zoho_cliq" && env.BETA_ZOHO_CLIQ_CONNECTOR_ENABLED !== false) ||
      (provider === "zoho_crm" && env.BETA_ZOHO_CRM_CONNECTOR_ENABLED !== false) ||
      (provider === "notion" && env.BETA_NOTION_CONNECTOR_ENABLED !== false))
  );
}

function requiresCredentialRef(provider: CommunicationProvider) {
  return [
    "slack",
    "gmail",
    "outlook",
    "microsoft_teams",
    "clickup",
    "granola",
    "fireflies_ai",
    "zoho_mail",
    "zoho_cliq",
    "zoho_crm",
    "notion"
  ].includes(provider);
}

function notionReadiness(env: AppEnv): ProviderReadiness {
  const base = {
    canManualImport: false,
    canWebhook: false,
    selectedResourceMode: "selected_shared_only",
    writeActionsEnabled: false as const,
    syncImplemented: true as const,
    warnings: ["notion_pages_and_databases_must_be_selected_or_shared", "notion_no_all_workspace_crawl"],
    deferredFeatures: ["notion_comment_ingestion_deferred", "notion_write_actions_disabled"]
  };

  if (isMvpBetaMode(env) && env.BETA_NOTION_CONNECTOR_ENABLED === false) {
    return {
      ...base,
      state: "disabled",
      canConnect: false,
      canSync: false,
      reasons: ["beta_notion_connector_disabled"],
      missingConfig: [],
      authModes: []
    };
  }

  if (env.NOTION_CONNECTOR_ENABLED === false) {
    return {
      ...base,
      state: "disabled",
      canConnect: false,
      canSync: false,
      reasons: ["notion_connector_disabled"],
      missingConfig: [],
      authModes: []
    };
  }

  const oauthEnabled = env.NOTION_OAUTH_ENABLED !== false;
  const internalTokenModeEnabled = env.NOTION_INTERNAL_TOKEN_MODE_ENABLED === true;
  const oauthMissing = oauthEnabled
    ? hasAll(env, ["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET", "NOTION_REDIRECT_URI", "NOTION_AUTH_URL", "NOTION_API_VERSION"])
    : [];
  const authModes = [
    ...(oauthEnabled && oauthMissing.length === 0 ? ["oauth_public_connection"] : []),
    ...(internalTokenModeEnabled && env.NOTION_INTERNAL_INTEGRATION_TOKEN ? ["internal_token_demo"] : [])
  ];

  if (oauthMissing.length > 0) {
    return {
      ...base,
      state: "readiness_gated",
      canConnect: false,
      canSync: false,
      reasons: ["notion_configuration_incomplete"],
      missingConfig: oauthMissing,
      authModes
    };
  }

  if (authModes.length === 0) {
    return {
      ...base,
      state: "readiness_gated",
      canConnect: false,
      canSync: false,
      reasons: ["notion_auth_mode_unavailable"],
      missingConfig: [],
      authModes
    };
  }

  return {
    ...base,
    state: "enabled",
    canConnect: true,
    canSync: true,
    reasons: ["notion_selected_sync_ready", "notion_selected_shared_resources_required"],
    missingConfig: oauthMissing,
    authModes
  };
}

function zohoReadiness(env: AppEnv, provider: "zoho_mail" | "zoho_cliq" | "zoho_crm", hasConnector: boolean): ProviderReadiness {
  const providerLabel = provider.replace(/_/g, "-");
  const betaFlag =
    provider === "zoho_mail"
      ? env.BETA_ZOHO_MAIL_CONNECTOR_ENABLED
      : provider === "zoho_cliq"
        ? env.BETA_ZOHO_CLIQ_CONNECTOR_ENABLED
        : env.BETA_ZOHO_CRM_CONNECTOR_ENABLED;
  const connectorFlag =
    provider === "zoho_mail"
      ? env.ZOHO_MAIL_CONNECTOR_ENABLED
      : provider === "zoho_cliq"
        ? env.ZOHO_CLIQ_CONNECTOR_ENABLED
        : env.ZOHO_CRM_CONNECTOR_ENABLED;
  const backfillEnabled =
    provider === "zoho_mail"
      ? env.ZOHO_MAIL_BACKFILL_ENABLED
      : provider === "zoho_cliq"
        ? env.ZOHO_CLIQ_BACKFILL_ENABLED
        : env.ZOHO_CRM_BACKFILL_ENABLED;
  const webhookEnabled =
    provider === "zoho_mail"
      ? env.ZOHO_MAIL_WEBHOOKS_ENABLED
      : provider === "zoho_cliq"
        ? env.ZOHO_CLIQ_WEBHOOKS_ENABLED
        : env.ZOHO_CRM_WEBHOOKS_ENABLED;
  const scopes =
    provider === "zoho_mail"
      ? env.ZOHO_MAIL_SCOPES
      : provider === "zoho_cliq"
        ? env.ZOHO_CLIQ_SCOPES
        : env.ZOHO_CRM_SCOPES;

  if (isMvpBetaMode(env) && betaFlag === false) {
    return {
      state: "disabled",
      canConnect: false,
      canSync: false,
      canManualImport: false,
      canWebhook: false,
      reasons: [`beta_${provider}_connector_disabled`],
      missingConfig: [],
      deferredFeatures: [`${provider}_connector_disabled_by_beta_env`]
    };
  }

  if (connectorFlag === false) {
    return {
      state: "disabled",
      canConnect: false,
      canSync: false,
      canManualImport: false,
      canWebhook: false,
      reasons: [`${provider}_connector_disabled`],
      missingConfig: [],
      deferredFeatures: [`${provider}_connector_disabled_by_env`]
    };
  }

  const missing = [
    ...hasAll(env, ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REDIRECT_URI", "ZOHO_ACCOUNTS_SERVER"]),
    ...(Array.isArray(scopes) && scopes.length > 0 ? [] : [`${provider.toUpperCase()}_SCOPES`])
  ];

  if (missing.length > 0) {
    return {
      state: "readiness_gated",
      canConnect: false,
      canSync: false,
      canManualImport: false,
      canWebhook: false,
      reasons: [`${provider}_configuration_incomplete`],
      missingConfig: missing,
      deferredFeatures: [`${provider}_sync_deferred_until_oauth_configured`, `${provider}_write_actions_disabled`]
    };
  }

  return {
    state: "enabled",
    canConnect: true,
    canSync: hasConnector && backfillEnabled !== false,
    canManualImport: false,
    canWebhook: webhookEnabled === true,
    reasons: hasConnector
      ? [`${provider}_connected_read_only`, `${provider}_sync_normalization_ready`]
      : [`${providerLabel}_oauth_configured`, `${provider}_connector_not_connected`],
    missingConfig: [],
    deferredFeatures: [
      `${provider}_write_actions_disabled`,
      ...(backfillEnabled === false ? [`${provider}_backfill_disabled_by_env`] : []),
      ...(webhookEnabled === false ? [`${provider}_webhooks_disabled_by_env`] : [])
    ]
  };
}

function firefliesReadiness(env: AppEnv): ProviderReadiness {
  if (env.FIREFLIES_READINESS_MODE === "disabled") {
    return {
      state: "disabled",
      canConnect: false,
      canSync: false,
      canManualImport: false,
      canWebhook: false,
      reasons: ["fireflies_readiness_mode_disabled"],
      missingConfig: [],
      deferredFeatures: ["fireflies_manual_import_disabled", "fireflies_live_api_disabled"]
    };
  }

  const apiEnabled = env.FIREFLIES_READINESS_MODE === "api" || env.FIREFLIES_READINESS_MODE === "api_and_webhook";
  const webhookEnabled =
    env.FIREFLIES_READINESS_MODE === "webhook" || env.FIREFLIES_READINESS_MODE === "api_and_webhook";
  const missingConfig = [
    ...(apiEnabled && !env.FIREFLIES_API_KEY ? ["FIREFLIES_API_KEY"] : []),
    ...(webhookEnabled && !env.FIREFLIES_WEBHOOK_SECRET ? ["FIREFLIES_WEBHOOK_SECRET"] : [])
  ];

  if (missingConfig.length > 0) {
    return {
      state: "readiness_gated",
      canConnect: true,
      canSync: false,
      canManualImport: true,
      canWebhook: false,
      reasons: ["manual_import_available_live_api_gated", "fireflies_configuration_incomplete"],
      missingConfig,
      deferredFeatures: ["fireflies_live_sync_gated_until_credentials_configured"]
    };
  }

  if (env.FIREFLIES_READINESS_MODE === "manual_only") {
    return {
      state: "readiness_gated",
      canConnect: true,
      canSync: false,
      canManualImport: true,
      canWebhook: false,
      reasons: ["manual_import_available_live_api_gated"],
      missingConfig: [],
      deferredFeatures: ["fireflies_live_sync_disabled_in_manual_only_mode", "fireflies_webhook_disabled_in_manual_only_mode"]
    };
  }

  return {
    state: "enabled",
    canConnect: true,
    canSync: apiEnabled,
    canManualImport: true,
    canWebhook: webhookEnabled,
    reasons: [apiEnabled ? "fireflies_api_configured" : "fireflies_webhook_configured"],
    missingConfig: [],
    deferredFeatures: apiEnabled ? [] : ["fireflies_pull_sync_disabled_without_api_mode"]
  };
}

function readinessFromMissing(
  missingConfig: string[],
  input: {
    enabledReason: string;
    gatedReason: string;
    canSync: boolean;
    canWebhook?: boolean;
    deferredFeatures: string[];
  }
): ProviderReadiness {
  if (missingConfig.length > 0) {
    return {
      state: "readiness_gated",
      canConnect: false,
      canSync: false,
      canManualImport: false,
      canWebhook: false,
      reasons: [input.gatedReason],
      missingConfig,
      deferredFeatures: input.deferredFeatures
    };
  }

  return {
    state: "enabled",
    canConnect: true,
    canSync: input.canSync,
    canManualImport: false,
    canWebhook: input.canWebhook ?? false,
    reasons: [input.enabledReason],
    missingConfig: [],
    deferredFeatures: input.deferredFeatures
  };
}
