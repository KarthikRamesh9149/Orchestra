import { AppError } from "../../../../app/errors.js";
import type { AppEnv } from "../../../../config/env.js";
import { sanitizeZohoErrorMessage, safeZohoValue } from "./zoho-redaction.js";
import { resolveZohoApiDomain } from "./zoho-domains.js";
import { ZohoOAuthClient } from "./zoho-oauth.js";
import type { ZohoCredential, ZohoService } from "./zoho-types.js";

type FetchLike = typeof fetch;

type ZohoRequestInit = RequestInit & {
  service: ZohoService;
  credential: ZohoCredential;
  operation: string;
};

export class ZohoApiClient {
  private readonly oauth: ZohoOAuthClient;

  constructor(
    private readonly env: AppEnv,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    this.oauth = new ZohoOAuthClient(env, fetchImpl);
  }

  async requestJson(path: string, input: ZohoRequestInit): Promise<{ payload: Record<string, any>; credential: ZohoCredential }> {
    const first = await this.requestOnce(path, input);
    if (first.response.status !== 401) {
      return this.parseResponse(first.response, input.operation, input.credential);
    }

    const refreshed = await this.oauth.refresh(input.credential, input.service);
    const retry = await this.requestOnce(path, { ...input, credential: refreshed });
    const parsed = await this.parseResponse(retry.response, input.operation, refreshed);
    return { ...parsed, credential: refreshed };
  }

  async getMailAccounts(credential: ZohoCredential) {
    return this.requestJson("/api/accounts", { service: "mail", credential, operation: "mail_accounts" });
  }

  async getMailFolders(credential: ZohoCredential, accountId: string) {
    return this.requestJson(`/api/accounts/${encodeURIComponent(accountId)}/folders`, {
      service: "mail",
      credential,
      operation: "mail_folders"
    });
  }

  async listMailMessages(
    credential: ZohoCredential,
    accountId: string,
    folderId: string,
    limit: number,
    options: { start?: number; pageToken?: string | null } = {}
  ) {
    const query = new URLSearchParams({
      folderId,
      limit: String(Math.min(limit, 100))
    });
    if (typeof options.start === "number" && Number.isFinite(options.start)) {
      query.set("start", String(Math.max(0, options.start)));
    }
    if (options.pageToken) {
      query.set("pageToken", options.pageToken);
    }
    return this.requestJson(
      `/api/accounts/${encodeURIComponent(accountId)}/messages/view?${query.toString()}`,
      { service: "mail", credential, operation: "mail_messages" }
    );
  }

  async getMailMessageContent(credential: ZohoCredential, accountId: string, folderId: string, messageId: string) {
    return this.requestJson(
      `/api/accounts/${encodeURIComponent(accountId)}/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(messageId)}/content`,
      { service: "mail", credential, operation: "mail_message_content" }
    );
  }

  async getCliqChannels(credential: ZohoCredential) {
    return this.requestJson("/api/v2/channels", { service: "cliq", credential, operation: "cliq_channels" });
  }

  async getCliqChats(credential: ZohoCredential) {
    return this.requestJson("/api/v2/chats", { service: "cliq", credential, operation: "cliq_chats" });
  }

  async listCliqMessages(
    credential: ZohoCredential,
    chatOrChannelId: string,
    limit: number,
    options: { resourceType?: "chat" | "channel"; pageToken?: string | null } = {}
  ) {
    const resource = options.resourceType === "channel" ? "channels" : "chats";
    const query = new URLSearchParams({ limit: String(Math.min(limit, 100)) });
    if (options.pageToken) {
      query.set("pageToken", options.pageToken);
    }
    return this.requestJson(`/${resource === "channels" ? "api/v2" : "api/v2"}/${resource}/${encodeURIComponent(chatOrChannelId)}/messages?${query.toString()}`, {
      service: "cliq",
      credential,
      operation: "cliq_messages"
    });
  }

  async getCrmModules(credential: ZohoCredential) {
    return this.requestJson("/crm/v8/settings/modules", { service: "crm", credential, operation: "crm_modules" });
  }

  async getCrmFields(credential: ZohoCredential, moduleApiName: string) {
    return this.requestJson(`/crm/v8/settings/fields?module=${encodeURIComponent(moduleApiName)}`, {
      service: "crm",
      credential,
      operation: "crm_fields"
    });
  }

  async getCrmRecords(
    credential: ZohoCredential,
    moduleApiName: string,
    limit: number,
    options: { page?: number; pageToken?: string | null; sortBy?: string; sortOrder?: "asc" | "desc" } = {}
  ) {
    const query = new URLSearchParams({ per_page: String(Math.min(limit, 200)) });
    if (options.pageToken) {
      query.set("page_token", options.pageToken);
    } else if (options.page) {
      query.set("page", String(Math.max(1, options.page)));
    }
    if (options.sortBy) {
      query.set("sort_by", options.sortBy);
      query.set("sort_order", options.sortOrder ?? "desc");
    }
    return this.requestJson(`/crm/v8/${encodeURIComponent(moduleApiName)}?${query.toString()}`, {
      service: "crm",
      credential,
      operation: "crm_records"
    });
  }

  private async requestOnce(path: string, input: ZohoRequestInit) {
    if (!input.credential.accessToken) {
      throw new AppError(401, "Zoho credential is missing", "zoho_credential_missing");
    }
    const apiDomain = resolveZohoApiDomain(this.env, input.credential.apiDomain, input.service);
    const timeout = AbortSignal.timeout(this.env.ZOHO_REQUEST_TIMEOUT_MS);
    const response = await this.fetchImpl(new URL(path, apiDomain), {
      ...input,
      method: input.method ?? "GET",
      headers: {
        authorization: this.authorizationHeader(input.service, input.credential.accessToken),
        "content-type": "application/json",
        ...(input.headers ?? {})
      },
      signal: input.signal ?? timeout
    }).catch((error) => {
      throw new AppError(504, sanitizeZohoErrorMessage(error), "zoho_api_timeout_or_network_error", {
        service: input.service,
        operation: input.operation
      });
    });
    return { response };
  }

  private async parseResponse(response: Response, operation: string, credential: ZohoCredential) {
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new AppError(429, "Zoho API rate limit reached", "communication_provider_rate_limited", {
        provider: "zoho",
        operation,
        retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000
      });
    }
    const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
    if (!response.ok) {
      throw new AppError(response.status, sanitizeZohoErrorMessage(payload.message ?? payload.error ?? "Zoho API request failed"), "zoho_api_error", {
        operation,
        payload: safeZohoValue(payload)
      });
    }
    return { payload, credential };
  }

  private authorizationHeader(service: ZohoService, accessToken: string) {
    return `Zoho-oauthtoken ${accessToken}`;
  }
}
