import type { CommunicationProvider, PrismaClient } from "@prisma/client";
import type { AppEnv } from "../../config/env.js";
import { getProviderReadiness } from "../communications/provider-readiness.js";
import { sanitizeCommunicationErrorMessage } from "../communications/redaction.js";
import type { ProjectService } from "../projects/service.js";
import type { CalendarConnectionsService } from "../project-ops/calendar-connections.service.js";
import type { GitHubIntegrationService } from "../github/service.js";
import type { GoogleDriveService } from "../google-drive/service.js";
import {
  isProviderReleaseValidated,
  PROVIDER_RELEASE_VALIDATION_REASON
} from "../../lib/integrations/provider-release.js";

type Actor = { userId: string; orgId: string };

export class IntegrationManagementService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly projectService: ProjectService,
    private readonly calendarConnectionsService: CalendarConnectionsService,
    private readonly googleDriveService: GoogleDriveService,
    private readonly githubIntegrationService: GitHubIntegrationService
  ) {}

  async getProjectIntegrationStatus(projectId: string, actor: Actor) {
    await this.projectService.ensureProjectAccess(projectId, actor.userId);
    const [slack, gmail, clickup, granola, fireflies, vscode, calendar, drive, github] = await Promise.all([
      this.slackStatus(projectId),
      this.communicationProviderStatus(projectId, "gmail", "Gmail invitations", "BETA_GMAIL_INVITE_SENDER_ENABLED"),
      this.communicationProviderStatus(projectId, "clickup", "ClickUp", "BETA_CLICKUP_CONNECTOR_ENABLED"),
      this.communicationProviderStatus(projectId, "granola", "Granola", "BETA_GRANOLA_CONNECTOR_ENABLED"),
      this.communicationProviderStatus(projectId, "fireflies_ai", "Fireflies.ai", "BETA_FIREFLIES_CONNECTOR_ENABLED"),
      this.vscodeStatus(projectId, actor.userId),
      this.googleCalendarStatus(projectId, actor),
      this.googleDriveStatus(projectId, actor),
      this.githubStatus(projectId, actor)
    ]);
    const providers = [slack, gmail, clickup, granola, fireflies, vscode, calendar, drive, github].map((provider) => {
      if (this.env.RUNTIME_PROFILE === "desktop-local") {
        return {...provider, status:provider.connected?provider.status:'not_configured', configured:provider.connected,
          degraded:provider.connected?provider.degraded:false, needsReauth:provider.connected?provider.needsReauth:false,
          availableActions: [], capabilities: {canConnect:false,canSync:false,canDisconnect:false},
          limitations: [...provider.limitations, "Desktop provider and agent pairing is not qualified yet. Local file evidence remains available in Memory."]};
      }
      const actions = new Set(provider.availableActions);
      return {
        ...provider,
        capabilities: {
          canConnect: actions.has("connect"),
          canSync: actions.has("sync"),
          canDisconnect: actions.has("disconnect") || actions.has("revoke")
        }
      };
    });
    return {
      projectId,
      providers,
      hiddenProviders: ["microsoft_teams", "outlook", "whatsapp_business"],
      generatedAt: new Date().toISOString()
    };
  }

  private async slackStatus(projectId: string) {
    const connector = await this.prisma.communicationConnector.findFirst({
      where: { projectId, provider: "slack" },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });
    const readiness = getProviderReadiness(this.env, "slack", connector ?? undefined);
    const connected = connector != null && ["connected", "syncing"].includes(connector.status);
    const channelIds = readStringArray(readRecord(connector?.configJson).channelIds);
    return {
      provider: "slack",
      label: "Slack",
      category: "communications",
      status: connected ? "connected" : readiness.canConnect ? "connectable" : "not_configured",
      configured: readiness.canConnect || connected,
      connected,
      degraded: Boolean(connector?.lastError),
      needsReauth: connector?.status === "error",
      lastSyncedAt: connector?.lastSyncedAt?.toISOString() ?? null,
      lastError: sanitizeCommunicationErrorMessage(connector?.lastError ?? null),
      availableActions: [
        ...(!connected && readiness.canConnect ? ["connect"] : []),
        ...(connected && readiness.canSync ? ["sync"] : []),
        ...(connector && connector.status !== "revoked" ? ["disconnect"] : [])
      ],
      featureFlag: "BETA_SLACK_CONNECTOR_ENABLED",
      setupUrl: null,
      connectedAccountLabel: connector?.accountLabel ?? null,
      selectedResourcesSummary: channelIds.length ? `${channelIds.length} selected channel${channelIds.length === 1 ? "" : "s"}` : "No channels selected",
      writeActionsEnabled: false,
      limitations: readiness.reasons
    };
  }

  private async communicationProviderStatus(
    projectId: string,
    provider: CommunicationProvider,
    label: string,
    featureFlag: string
  ) {
    const connector = await this.prisma.communicationConnector.findFirst({
      where: { projectId, provider },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });
    const readiness = getProviderReadiness(this.env, provider, connector ?? undefined);
    const connected = connector != null && ["connected", "syncing"].includes(connector.status);
    return {
      provider,
      label,
      description: provider === "gmail"
        ? "Send secure workspace invitations and verification emails. Orchestra does not read or sync this mailbox."
        : undefined,
      category: "communications",
      status: connected ? "connected" : readiness.canConnect || readiness.canManualImport ? "connectable" : readiness.state,
      configured: readiness.state !== "disabled" && readiness.state !== "readiness_gated",
      connected,
      degraded: Boolean(connector?.lastError) || readiness.state === "readiness_gated",
      needsReauth: connector?.status === "error",
      lastSyncedAt: connector?.lastSyncedAt?.toISOString() ?? null,
      lastError: sanitizeCommunicationErrorMessage(connector?.lastError ?? null),
      availableActions: [
        ...(readiness.state === "enabled" && readiness.canConnect ? ["connect"] : []),
        ...(readiness.canManualImport ? ["manual_import"] : []),
        ...(connected && readiness.canSync ? ["sync"] : []),
        ...(connector && connector.status !== "revoked" ? ["disconnect"] : [])
      ],
      featureFlag,
      setupUrl: null,
      connectedAccountLabel: connector?.accountLabel ?? null,
      selectedResourcesSummary: connected
        ? connector?.lastSyncedAt
          ? `Last synced ${connector.lastSyncedAt.toISOString()}`
          : "Connected, not synced yet"
        : readiness.reasons.join(", ") || "Not connected",
      writeActionsEnabled: false,
      limitations: [...readiness.reasons, ...readiness.deferredFeatures]
    };
  }

  private async vscodeStatus(projectId: string, userId: string) {
    const connectors = await this.prisma.projectEditorConnector.findMany({
      where: { projectId, userId, connectorType: "vscode", status: { in: ["pairing_pending", "connected"] } },
      orderBy: [{ lastUsedAt: "desc" }, { createdAt: "desc" }],
      take: 5
    });
    const active = connectors.find((connector) => connector.status === "connected") ?? null;
    const pairing = connectors.find((connector) => connector.status === "pairing_pending") ?? null;
    const releaseValidated = isProviderReleaseValidated(this.env, "vscode");
    return {
      provider: "vscode",
      label: "VS Code",
      category: "editor",
      status: active ? "connected" : pairing ? "pairing_pending" : "not_connected",
      configured: true,
      connected: Boolean(active),
      degraded: false,
      needsReauth: false,
      lastSyncedAt: active?.lastUsedAt?.toISOString() ?? pairing?.createdAt?.toISOString() ?? null,
      lastError: null,
      availableActions: active || pairing ? ["revoke"] : releaseValidated ? ["connect"] : [],
      featureFlag: "VSCODE_CONNECTOR_TOKEN_SECRET",
      setupUrl: null,
      connectedAccountLabel: active?.label ?? pairing?.label ?? null,
      selectedResourcesSummary: active ? "Extension paired" : pairing ? "Pairing code pending" : "No editor paired",
      writeActionsEnabled: false,
      limitations: releaseValidated ? [] : [PROVIDER_RELEASE_VALIDATION_REASON]
    };
  }

  private async googleCalendarStatus(projectId: string, actor: Actor) {
    const status = await this.calendarConnectionsService.getGoogleCalendarStatus(projectId, actor.userId);
    const selectedCount = status.selectedCalendarIds.length;
    const releaseValidated = isProviderReleaseValidated(this.env, "google_calendar");
    return {
      provider: "google_calendar",
      label: "Google Calendar",
      category: "calendar",
      status: !status.enabled || !status.configured ? "not_configured" : status.connected ? "connected" : "not_connected",
      configured: status.configured,
      connected: status.connected,
      degraded: Boolean(status.error) || status.webhookState.status === "fallback",
      needsReauth: status.connection?.status === "error",
      lastSyncedAt: status.lastSyncedAt,
      lastError: sanitizeCommunicationErrorMessage(status.error),
      availableActions: [
        ...(releaseValidated && status.configured && !status.connected ? ["connect"] : []),
        ...(status.connected ? ["disconnect"] : []),
        ...(releaseValidated && status.connected ? ["select_resources", "sync"] : [])
      ],
      featureFlag: "BETA_GOOGLE_CALENDAR_ENABLED",
      setupUrl: null,
      connectedAccountLabel: status.connection?.accountLabel ?? null,
      selectedResourcesSummary: selectedCount ? `${selectedCount} selected calendar${selectedCount === 1 ? "" : "s"}` : "No calendars selected",
      writeActionsEnabled: false,
      limitations: [
        ...(releaseValidated ? [] : [PROVIDER_RELEASE_VALIDATION_REASON]),
        ...(status.webhookState.reason ? [status.webhookState.reason] : [])
      ]
    };
  }

  private async googleDriveStatus(projectId: string, actor: Actor) {
    const status = await this.googleDriveService.getStatus(projectId, actor.userId);
    const connected = status.connected;
    const releaseValidated = isProviderReleaseValidated(this.env, "google_drive");
    return {
      provider: "google_drive",
      label: "Google Drive",
      category: "documents",
      status: !status.enabled || !status.configured ? "not_configured" : connected ? status.state : "not_connected",
      configured: status.configured,
      connected,
      degraded: status.state === "error" || Boolean(status.connection?.lastError),
      needsReauth: status.state === "needs_reauth",
      lastSyncedAt: status.connection?.lastSyncedAt ?? status.latestSyncRun?.finishedAt ?? null,
      lastError: sanitizeCommunicationErrorMessage(status.connection?.lastError ?? status.latestSyncRun?.errorMessage ?? null),
      availableActions: [
        ...(releaseValidated && status.configured && !connected ? ["connect"] : []),
        ...(connected ? ["disconnect"] : []),
        ...(releaseValidated && connected ? ["select_resources", "sync"] : [])
      ],
      featureFlag: "BETA_GOOGLE_DRIVE_ENABLED",
      setupUrl: null,
      connectedAccountLabel: status.connection?.accountLabel ?? null,
      selectedResourcesSummary: connected
        ? `${status.indexedFileCount} indexed file${status.indexedFileCount === 1 ? "" : "s"}`
        : "No Drive account connected",
      writeActionsEnabled: false,
      limitations: [
        ...(releaseValidated ? [] : [PROVIDER_RELEASE_VALIDATION_REASON]),
        ...status.limitations
      ]
    };
  }

  private async githubStatus(projectId: string, actor: Actor) {
    const integration = await this.githubIntegrationService.getProjectIntegration(projectId, actor);
    const link = integration.linkedRepositories[0] ?? null;
    const latestRun = integration.latestSyncRuns[0] ?? null;
    const readiness = integration.readiness;
    const configured = readiness.enabled && readiness.configured;
    const connected = Boolean(link);
    const status = !readiness.enabled
      ? "disabled"
      : !configured
        ? "not_configured"
        : connected
          ? "connected"
          : "not_connected";
    const releaseValidated = isProviderReleaseValidated(this.env, "github");
    const setupUrl = configured && releaseValidated ? this.env.GITHUB_APP_SETUP_URL || null : null;
    return {
      provider: "github",
      label: "GitHub",
      category: "code",
      status,
      configured,
      connected,
      degraded: Boolean(latestRun && /fail|error|cancel|timed_out/i.test(latestRun.status)),
      needsReauth: false,
      lastSyncedAt: link?.lastSyncedAt ?? latestRun?.finishedAt ?? null,
      lastError: null,
      availableActions: [
        ...(setupUrl ? ["connect"] : []),
        ...(link ? ["disconnect"] : []),
        ...(link && releaseValidated ? ["sync"] : [])
      ],
      featureFlag: "BETA_GITHUB_PAGE_ENABLED",
      setupUrl,
      connectedAccountLabel: link?.repository?.fullName ?? null,
      selectedResourcesSummary: link?.repository?.fullName ?? "No repository linked",
      writeActionsEnabled: false,
      limitations: releaseValidated ? [] : [PROVIDER_RELEASE_VALIDATION_REASON]
    };
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
