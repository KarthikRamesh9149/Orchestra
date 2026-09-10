import type { CommunicationProvider } from "@prisma/client";
import { AppError } from "../../../../app/errors.js";
import type { AppEnv } from "../../../../config/env.js";
import { resolveZohoAccountsServer, resolveZohoApiDomain, inferZohoDataCenter } from "./zoho-domains.js";
import { sanitizeZohoErrorMessage } from "./zoho-redaction.js";
import { zohoScopesForProvider } from "./zoho-scopes.js";
import type { ZohoCredential, ZohoService, ZohoTokenResponse } from "./zoho-types.js";

type FetchLike = typeof fetch;

export class ZohoOAuthClient {
  constructor(
    private readonly env: AppEnv,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  buildAuthorizationUrl(input: { provider: CommunicationProvider; state: string; redirectUri: string }) {
    const accountsServer = resolveZohoAccountsServer(this.env);
    const url = new URL("/oauth/v2/auth", accountsServer);
    url.searchParams.set("client_id", this.requireClientId());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("scope", zohoScopesForProvider(this.env, input.provider).join(","));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", input.state);
    return url.toString();
  }

  async exchangeCode(input: { code: string; redirectUri: string; service: ZohoService; accountsServer?: string | null }) {
    const accountsServer = resolveZohoAccountsServer(this.env, input.accountsServer);
    const payload = await this.tokenRequest(accountsServer, {
      code: input.code,
      client_id: this.requireClientId(),
      client_secret: this.requireClientSecret(),
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code"
    });
    return this.toCredential(payload, accountsServer, input.service);
  }

  async refresh(credential: ZohoCredential, service: ZohoService) {
    if (!credential.refreshToken) {
      throw new AppError(401, "Zoho refresh token is missing", "zoho_refresh_token_missing");
    }
    const accountsServer = resolveZohoAccountsServer(this.env, credential.accountsServer);
    const payload = await this.tokenRequest(accountsServer, {
      refresh_token: credential.refreshToken,
      client_id: this.requireClientId(),
      client_secret: this.requireClientSecret(),
      grant_type: "refresh_token"
    });
    return {
      ...credential,
      ...this.toCredential(payload, accountsServer, service),
      refreshToken: credential.refreshToken
    };
  }

  async revoke(credential: ZohoCredential | null) {
    const token = credential?.refreshToken ?? credential?.accessToken;
    if (!token) return false;
    const accountsServer = resolveZohoAccountsServer(this.env, credential?.accountsServer);
    await this.tokenRequest(accountsServer, { token }, "/oauth/v2/token/revoke");
    return true;
  }

  private async tokenRequest(accountsServer: string, input: Record<string, string>, path = "/oauth/v2/token") {
    const body = new URLSearchParams(input);
    const response = await this.fetchImpl(new URL(path, accountsServer), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    const payload = (await response.json().catch(() => ({}))) as ZohoTokenResponse;
    if (!response.ok || payload.error) {
      throw new AppError(response.ok ? 400 : response.status, sanitizeZohoErrorMessage(payload.error_description ?? payload.error), "zoho_oauth_failed");
    }
    return payload;
  }

  private toCredential(payload: ZohoTokenResponse, accountsServer: string, service: ZohoService): ZohoCredential {
    if (!payload.access_token) {
      throw new AppError(502, "Zoho token response did not include an access token", "zoho_oauth_failed");
    }
    const expiresIn = Number(payload.expires_in ?? 3600);
    const apiDomain = resolveZohoApiDomain(this.env, payload.api_domain, service);
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: new Date(Date.now() + Math.max(60, Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000).toISOString(),
      apiDomain,
      accountsServer,
      tokenType: payload.token_type ?? "Bearer",
      scope: payload.scope,
      dataCenter: inferZohoDataCenter(accountsServer)
    } as ZohoCredential & { dataCenter: string };
  }

  private requireClientId() {
    if (!this.env.ZOHO_CLIENT_ID) throw new AppError(503, "Zoho OAuth client id is not configured", "zoho_oauth_not_configured");
    return this.env.ZOHO_CLIENT_ID;
  }

  private requireClientSecret() {
    if (!this.env.ZOHO_CLIENT_SECRET) throw new AppError(503, "Zoho OAuth client secret is not configured", "zoho_oauth_not_configured");
    return this.env.ZOHO_CLIENT_SECRET;
  }
}
