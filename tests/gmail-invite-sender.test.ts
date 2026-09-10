import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../src/config/env.js";
import { getProviderReadiness } from "../src/modules/communications/provider-readiness.js";
import { GmailProvider } from "../src/modules/communications/providers/gmail.provider.js";
import { ConnectorsService } from "../src/modules/communications/connectors.service.js";
import { buildOAuthState } from "../src/lib/communications/oauth-state.js";
import { IntegrationManagementService } from "../src/modules/integrations/integrations.service.js";
import { isGmailInvitationOAuthState } from "../src/modules/google-drive/routes.js";
import { isAllowedBetaRoute } from "../src/app/build-app.js";

const betaEnv = {
  NODE_ENV: "production",
  ORCHESTRA_PROFILE: "mvp_beta",
  MVP_BETA_MODE: true,
  BETA_GMAIL_INVITE_SENDER_ENABLED: true,
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
  GOOGLE_REDIRECT_URI: "https://api.example.test/v1/oauth/google/callback",
  CONNECTOR_SYNC_MAX_BACKFILL_DAYS: 30,
  CONNECTOR_OAUTH_STATE_SECRET: "test-oauth-state-secret-with-32-characters"
} as AppEnv;

describe("Gmail invitation sender", () => {
  it("is separately beta-gated, connectable when configured, and never enables mailbox sync", () => {
    expect(getProviderReadiness(betaEnv, "gmail")).toMatchObject({
      state: "enabled",
      canConnect: true,
      canSync: false,
      reasons: ["gmail_invitation_sender_oauth_configured"],
      deferredFeatures: ["gmail_mailbox_sync_disabled_for_invitation_sender"]
    });

    expect(getProviderReadiness({ ...betaEnv, GOOGLE_CLIENT_SECRET: undefined }, "gmail")).toMatchObject({
      state: "readiness_gated",
      canConnect: false,
      canSync: false,
      missingConfig: ["GOOGLE_CLIENT_SECRET"]
    });
  });

  it("publishes an honest invitation-only Gmail action in unified integration status", async () => {
    const service = new IntegrationManagementService(
      {
        communicationConnector: { findFirst: vi.fn(async () => null) },
        projectEditorConnector: { findMany: vi.fn(async () => []) }
      } as any,
      betaEnv,
      { ensureProjectAccess: vi.fn(async () => ({ id: "membership-1" })) } as any,
      {
        getGoogleCalendarStatus: vi.fn(async () => ({
          enabled: false, configured: false, connected: false, selectedCalendarIds: [], lastSyncedAt: null,
          error: null, connection: null, webhookState: { status: "disabled", reason: null }
        }))
      } as any,
      {
        getStatus: vi.fn(async () => ({
          enabled: false, configured: false, connected: false, state: "not_connected", connection: null,
          latestSyncRun: null, indexedFileCount: 0, limitations: []
        }))
      } as any,
      {
        getProjectIntegration: vi.fn(async () => ({
          linkedRepositories: [], latestSyncRuns: [], readiness: { enabled: false, configured: false }
        }))
      } as any
    );

    const result = await service.getProjectIntegrationStatus("project-1", { userId: "user-1", orgId: "org-1" });
    expect(result.providers.find((provider) => provider.provider === "gmail")).toMatchObject({
      label: "Gmail invitations",
      description: "Send secure workspace invitations and verification emails. Orchestra does not read or sync this mailbox.",
      connected: false,
      availableActions: ["connect"],
      capabilities: { canConnect: true, canSync: false, canDisconnect: false },
      limitations: ["gmail_invitation_sender_oauth_configured", "gmail_mailbox_sync_disabled_for_invitation_sender"]
    });
    expect(result.hiddenProviders).not.toContain("gmail");
  });

  it("requests only identity and Gmail send access, then resolves the sending account without reading mail", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({
          access_token: "access-secret",
          refresh_token: "refresh-secret",
          expires_in: 3600,
          token_type: "Bearer",
          id_token: "signed-google-identity-token",
          scope: "openid email https://www.googleapis.com/auth/gmail.send"
        }), { status: 200 });
      }
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        return new Response(JSON.stringify({ email: "owner@example.com" }), { status: 200 });
      }
      throw new Error(`Unexpected provider request: ${url}`);
    });
    const provider = new GmailProvider(betaEnv, fetchImpl as typeof fetch);

    const start = await provider.connect({
      projectId: "project-1",
      actorUserId: "user-1",
      oauthState: "signed-state",
      body: { purpose: "invitation_sender" }
    });
    const authorizationUrl = new URL(start.redirectUrl!);
    const scopes = new Set((authorizationUrl.searchParams.get("scope") ?? "").split(" "));
    expect(scopes).toEqual(new Set(["openid", "email", "https://www.googleapis.com/auth/gmail.send"]));
    expect(scopes.has("https://www.googleapis.com/auth/gmail.readonly")).toBe(false);
    expect(authorizationUrl.searchParams.get("include_granted_scopes")).toBe("false");
    expect(start.config).toEqual({ purpose: "invitation_sender" });

    const callback = await provider.handleOAuthCallback({
      code: "one-time-code",
      redirectUri: betaEnv.GOOGLE_REDIRECT_URI!
    });
    expect(callback).toMatchObject({
      accountLabel: "owner@example.com",
      configPatch: { emailAddress: "owner@example.com", purpose: "invitation_sender" },
      credential: {
        emailAddress: "owner@example.com",
        scope: "openid email https://www.googleapis.com/auth/gmail.send"
      }
    });
    expect(fetchImpl.mock.calls.some(([input]) => String(input).includes("gmail.googleapis.com"))).toBe(false);
  });

  it("completes the one-time OAuth state without starting a mailbox backfill", async () => {
    const pendingConnector = {
      id: "connector-1",
      projectId: "11111111-1111-4111-8111-111111111111",
      provider: "gmail",
      status: "pending_auth",
      accountLabel: "Gmail",
      configJson: { purpose: "invitation_sender" },
      credentialsRef: null,
      providerCursorJson: null
    };
    const connectedConnector = { ...pendingConnector, status: "connected", accountLabel: "owner@example.com" };
    const prisma = {
      oAuthState: {
        findFirst: vi.fn(async () => ({
          id: "oauth-state-1",
          projectId: pendingConnector.projectId,
          orgId: "org-1",
          actorUserId: "user-1",
          usedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          redirectAfter: "/settings#integrations"
        })),
        updateMany: vi.fn(async () => ({ count: 1 }))
      },
      communicationConnector: {
        findFirst: vi.fn(async () => pendingConnector),
        update: vi.fn(async () => connectedConnector)
      }
    } as any;
    const syncService = { enqueueSync: vi.fn(async () => ({ syncRunId: "must-not-run" })) };
    const service = new ConnectorsService(
      prisma,
      betaEnv,
      { ensureProjectMemberCanMutate: vi.fn(async () => ({ projectRole: "manager", isActive: true })) } as any,
      { record: vi.fn(async () => undefined) } as any,
      { enqueue: vi.fn(async () => undefined) } as any,
      { putCredential: vi.fn(async () => ({ ref: "vault:gmail:connector-1" })) } as any,
      new Map([["gmail", {
        provider: "gmail",
        handleOAuthCallback: vi.fn(async () => ({
          accountLabel: "owner@example.com",
          credential: { accessToken: "secret", scope: "https://www.googleapis.com/auth/gmail.send" },
          configPatch: { emailAddress: "owner@example.com", purpose: "invitation_sender" },
          providerCursor: null
        }))
      } as any]]),
      { increment: vi.fn() } as any,
      syncService as any
    );
    const state = buildOAuthState(betaEnv, {
      nonce: "single-use-nonce",
      provider: "gmail",
      projectId: pendingConnector.projectId,
      issuedAt: Date.now()
    });

    await expect(service.handleOAuthCallback("gmail", { code: "one-time-code", state })).resolves.toMatchObject({
      connectorId: "connector-1",
      provider: "gmail",
      status: "connected",
      syncRunId: null,
      redirectAfter: "/settings#integrations"
    });
    expect(syncService.enqueueSync).not.toHaveBeenCalled();
  });

  it("distinguishes the Gmail state on the already registered Google Drive callback", () => {
    const gmailState = buildOAuthState(betaEnv, {
      nonce: "gmail-nonce",
      provider: "gmail",
      projectId: "11111111-1111-4111-8111-111111111111",
      issuedAt: Date.now()
    });
    const slackState = buildOAuthState(betaEnv, {
      nonce: "slack-nonce",
      provider: "slack",
      projectId: "11111111-1111-4111-8111-111111111111",
      issuedAt: Date.now()
    });

    expect(isGmailInvitationOAuthState(betaEnv, gmailState)).toBe(true);
    expect(isGmailInvitationOAuthState(betaEnv, slackState)).toBe(false);
    expect(isGmailInvitationOAuthState(betaEnv, "invalid-state")).toBe(false);
  });

  it("opens only the Gmail connect and callback routes when the beta sender flag is enabled", () => {
    const connectPath = "/v1/projects/11111111-1111-4111-8111-111111111111/connectors/gmail/connect";
    expect(isAllowedBetaRoute("POST", connectPath, betaEnv)).toBe(true);
    expect(isAllowedBetaRoute("GET", "/v1/oauth/google/drive/callback?code=one-time&state=signed", betaEnv)).toBe(true);
    expect(isAllowedBetaRoute("POST", connectPath, { ...betaEnv, BETA_GMAIL_INVITE_SENDER_ENABLED: false })).toBe(false);
    expect(isAllowedBetaRoute("POST", connectPath.replace("gmail", "outlook"), betaEnv)).toBe(false);
  });
});
