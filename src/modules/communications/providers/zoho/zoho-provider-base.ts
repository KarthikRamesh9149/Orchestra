import type { CommunicationConnector, CommunicationProvider, CommunicationSyncType } from "@prisma/client";
import { AppError } from "../../../../app/errors.js";
import type { AppEnv } from "../../../../config/env.js";
import type { ProviderCallbackResult, ProviderChannel, ProviderConnectResult, ProviderSyncResult } from "../provider.interface.js";
import { ZohoApiClient } from "./zoho-client.js";
import { resolveZohoAccountsServer, inferZohoDataCenter, resolveZohoApiDomain } from "./zoho-domains.js";
import { ZohoOAuthClient } from "./zoho-oauth.js";
import { safeZohoValue } from "./zoho-redaction.js";
import { zohoScopesForProvider } from "./zoho-scopes.js";
import type { ZohoCredential, ZohoService } from "./zoho-types.js";

type FetchLike = typeof fetch;

export abstract class ZohoProviderBase {
  protected readonly oauth: ZohoOAuthClient;
  protected readonly client: ZohoApiClient;

  protected constructor(
    protected readonly env: AppEnv,
    protected readonly fetchImpl: FetchLike = fetch
  ) {
    this.oauth = new ZohoOAuthClient(env, fetchImpl);
    this.client = new ZohoApiClient(env, fetchImpl);
  }

  abstract readonly provider: CommunicationProvider;
  protected abstract readonly service: ZohoService;
  protected abstract readonly defaultAccountLabel: string;
  protected abstract providerConfigDefaults(): Record<string, unknown>;
  protected abstract resolveAccountLabel(credential: ZohoCredential): Promise<{ label: string; configPatch?: Record<string, unknown> }>;
  abstract listChannels(input: { credential: Record<string, unknown> | null; includePrivateChannels?: boolean }): Promise<ProviderChannel[]>;
  abstract testConnection(input: { credential: Record<string, unknown> | null }): Promise<{ ok: boolean; accountLabel?: string | null; details?: Record<string, unknown> }>;

  async connect(input: { projectId: string; actorUserId: string; oauthState?: string; body?: unknown }): Promise<ProviderConnectResult> {
    if (!this.env.ZOHO_CLIENT_ID || !this.env.ZOHO_CLIENT_SECRET || !this.env.ZOHO_REDIRECT_URI) {
      throw new AppError(503, "Zoho OAuth is not configured", "zoho_oauth_not_configured");
    }
    if (!input.oauthState) {
      throw new AppError(400, "Zoho OAuth state is required", "zoho_oauth_state_required");
    }
    return {
      mode: "oauth_pending",
      status: "pending_auth",
      redirectUrl: this.oauth.buildAuthorizationUrl({
        provider: this.provider,
        state: input.oauthState,
        redirectUri: this.env.ZOHO_REDIRECT_URI
      }),
      accountLabel: this.defaultAccountLabel,
      config: this.safeConfigPatch(null)
    };
  }

  async handleOAuthCallback(input: { code: string; redirectUri: string }): Promise<ProviderCallbackResult> {
    const credential = await this.oauth.exchangeCode({
      code: input.code,
      redirectUri: input.redirectUri,
      service: this.service
    });
    const account: { label: string; configPatch?: Record<string, unknown> } = await this.resolveAccountLabel(credential).catch(() => ({
      label: this.defaultAccountLabel
    }));
    return {
      accountLabel: account.label,
      credential,
      providerCursor: {
        lastSyncedAt: null,
        provider: this.provider
      },
      configPatch: this.safeConfigPatch(credential, account.configPatch)
    };
  }

  async sync(input: {
    connector: CommunicationConnector;
    credential: Record<string, unknown> | null;
    syncType: CommunicationSyncType;
    batchSize: number;
    maxBackfillDays: number;
  }): Promise<ProviderSyncResult> {
    this.requireCredential(input.credential);
    return {
      queued: false,
      batches: [],
      cursorAfter: {
        ...((input.connector.providerCursorJson as Record<string, unknown> | null) ?? {}),
        lastSyncedAt: new Date().toISOString(),
        deferred: true
      },
      summary: {
        provider: this.provider,
        providerMode: "read_only",
        writesEnabled: false,
        syncContract: "base_provider_noop",
        reason: `${this.provider}_sync_not_overridden`,
        batchSize: input.batchSize,
        maxBackfillDays: input.maxBackfillDays,
        syncType: input.syncType
      },
      status: "partial"
    };
  }

  async revoke(input: { credential: Record<string, unknown> | null }) {
    const providerRevoked = await this.oauth.revoke(this.asCredential(input.credential));
    return {
      providerRevoked,
      ...(providerRevoked ? {} : { reason: "Zoho credential was already absent; local connector access was removed." })
    };
  }

  protected requireCredential(credential: Record<string, unknown> | null): ZohoCredential & { accessToken: string } {
    const candidate = this.asCredential(credential);
    if (!candidate?.accessToken) {
      throw new AppError(401, "Zoho credential is missing", "zoho_credential_missing");
    }
    return candidate as ZohoCredential & { accessToken: string };
  }

  protected asCredential(credential: Record<string, unknown> | null): ZohoCredential | null {
    if (!credential || typeof credential !== "object") return null;
    return credential as ZohoCredential;
  }

  protected safeConfigPatch(credential: ZohoCredential | null, patch: Record<string, unknown> = {}) {
    const accountsServer = resolveZohoAccountsServer(this.env, credential?.accountsServer);
    const apiDomain = resolveZohoApiDomain(this.env, credential?.apiDomain, this.service);
    return {
      ...this.providerConfigDefaults(),
      accountsServer,
      apiDomain,
      dataCenter: credential?.dataCenter ?? inferZohoDataCenter(accountsServer),
      grantedScopes: credential?.scope?.split(/[,\s]+/).filter(Boolean) ?? zohoScopesForProvider(this.env, this.provider),
      providerLimitations: [
        `${this.provider}_read_only_sync_normalization_enabled`,
        `${this.provider}_selected_resources_only`,
        `${this.provider}_write_actions_disabled`
      ],
      ...(safeZohoValue(patch) as Record<string, unknown>)
    };
  }

  protected stringValue(value: unknown) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : value == null ? null : String(value);
  }

  protected arrayFromPayload(payload: Record<string, any>, keys: string[]) {
    for (const key of keys) {
      if (Array.isArray(payload[key])) return payload[key];
    }
    return [];
  }
}
