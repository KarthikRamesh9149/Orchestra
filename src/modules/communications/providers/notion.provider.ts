import { createHash } from "node:crypto";
import type { CommunicationConnector } from "@prisma/client";
import type { AppEnv } from "../../../config/env.js";
import { AppError } from "../../../app/errors.js";
import type {
  CommunicationProviderAdapter,
  NormalizedDocumentWorkspaceResource,
  ProviderCallbackResult,
  ProviderResourceCandidate,
  ProviderSyncResult,
  SkippedDocumentWorkspaceResource
} from "./provider.interface.js";

type FetchLike = typeof fetch;

type NotionTokenPayload = {
  access_token?: string;
  token_type?: string;
  workspace_id?: string;
  workspace_name?: string;
  bot_id?: string;
  owner?: unknown;
  duplicated_template_id?: string | null;
};

type NotionCredential = {
  accessToken?: string;
  workspaceId?: string | null;
  workspaceName?: string | null;
  notionVersion?: string | null;
};

type NotionObject = Record<string, any>;
type NotionListResponse = {
  object?: "list";
  results?: NotionObject[];
  next_cursor?: string | null;
  has_more?: boolean;
};

type SelectedResourceLabel = { id: string; label: string; type: "page" | "database" | "data_source" | "root" };
type NotionSyncConfig = {
  selectedNotionWorkspaceId: string | null;
  selectedNotionRootIds: string[];
  selectedNotionPageIds: string[];
  selectedNotionDatabaseIds: string[];
  selectedNotionDataSourceIds: string[];
  selectedNotionResourceMode: "selected_shared_only";
  selectedNotionResourceLabels: SelectedResourceLabel[];
  includeComments: boolean;
  includeChildPages: boolean;
  includeDatabaseItems: boolean;
  maxDepth: number;
  backfillDays: number;
};

const EMPTY_SELECTED_NOTION_CONFIG = {
  selectedNotionWorkspaceId: null,
  selectedNotionRootIds: [] as string[],
  selectedNotionPageIds: [] as string[],
  selectedNotionDatabaseIds: [] as string[],
  selectedNotionDataSourceIds: [] as string[],
  selectedNotionResourceMode: "selected_shared_only" as const,
  selectedNotionResourceLabels: [] as SelectedResourceLabel[],
  includeComments: false,
  includeChildPages: true,
  includeDatabaseItems: true,
  maxDepth: 3,
  backfillDays: 0
};

const MAX_RESOURCE_COUNT = 80;
const MAX_BLOCKS_PER_PAGE = 240;
const MAX_SEARCH_PAGES = 5;
const MAX_DATABASE_ITEMS = 100;

export class NotionProvider implements CommunicationProviderAdapter {
  readonly provider = "notion" as const;

  constructor(
    private readonly env: AppEnv,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async connect(input: Parameters<CommunicationProviderAdapter["connect"]>[0]) {
    const body = (input.body ?? {}) as Record<string, unknown>;
    const mode = body.mode === "internal_token" ? "internal_token" : "oauth";

    if (mode === "internal_token") {
      if (this.env.NOTION_INTERNAL_TOKEN_MODE_ENABLED !== true) {
        throw new AppError(403, "Notion internal token mode is disabled", "notion_internal_token_mode_disabled");
      }
      if (!this.env.NOTION_INTERNAL_INTEGRATION_TOKEN) {
        throw new AppError(503, "Notion internal integration token is not configured", "notion_internal_token_missing");
      }
      return {
        mode: "connected" as const,
        status: "connected" as const,
        accountLabel: "Notion Internal",
        config: {
          ...EMPTY_SELECTED_NOTION_CONFIG,
          selectedNotionMode: "internal_token" as const
        },
        credential: {
          provider: "notion",
          mode: "internal_token",
          accessToken: this.env.NOTION_INTERNAL_INTEGRATION_TOKEN,
          notionVersion: this.env.NOTION_API_VERSION
        }
      };
    }

    if (this.env.NOTION_OAUTH_ENABLED === false) {
      throw new AppError(403, "Notion OAuth is disabled", "notion_oauth_disabled");
    }
    if (!input.oauthState) {
      throw new AppError(400, "Notion OAuth state is required", "notion_oauth_state_required");
    }
    if (!this.env.NOTION_CLIENT_ID || !this.env.NOTION_CLIENT_SECRET || !this.env.NOTION_REDIRECT_URI || !this.env.NOTION_AUTH_URL) {
      throw new AppError(503, "Notion OAuth is not configured", "notion_oauth_not_configured");
    }

    const redirectUrl = new URL(this.env.NOTION_AUTH_URL);
    redirectUrl.searchParams.set("client_id", this.env.NOTION_CLIENT_ID);
    redirectUrl.searchParams.set("response_type", "code");
    redirectUrl.searchParams.set("owner", "user");
    redirectUrl.searchParams.set("redirect_uri", this.env.NOTION_REDIRECT_URI);
    redirectUrl.searchParams.set("state", input.oauthState);

    return {
      mode: "oauth_pending" as const,
      status: "pending_auth" as const,
      redirectUrl: redirectUrl.toString(),
      accountLabel: "Notion",
      config: {
        ...EMPTY_SELECTED_NOTION_CONFIG,
        selectedNotionMode: "oauth" as const
      }
    };
  }

  async handleOAuthCallback(input: { code: string; redirectUri: string }): Promise<ProviderCallbackResult> {
    if (!this.env.NOTION_CLIENT_ID || !this.env.NOTION_CLIENT_SECRET) {
      throw new AppError(503, "Notion OAuth is not configured", "notion_oauth_not_configured");
    }

    const response = await this.fetchImpl(this.resolveTokenUrl(), {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${this.env.NOTION_CLIENT_ID}:${this.env.NOTION_CLIENT_SECRET}`).toString("base64")}`,
        "content-type": "application/json",
        accept: "application/json",
        "Notion-Version": this.env.NOTION_API_VERSION
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri
      })
    });

    const payload = (await response.json()) as NotionTokenPayload & { error?: string; error_description?: string };
    if (!response.ok || !payload.access_token) {
      throw new AppError(
        response.status || 502,
        payload.error_description ?? payload.error ?? "Notion OAuth callback failed",
        "notion_oauth_callback_failed"
      );
    }

    const workspaceName = safeString(payload.workspace_name) ?? "Notion Workspace";
    const workspaceId = safeString(payload.workspace_id);

    return {
      accountLabel: workspaceName,
      credential: {
        provider: "notion",
        mode: "oauth",
        accessToken: payload.access_token,
        tokenType: safeString(payload.token_type),
        workspaceId,
        workspaceName,
        botId: safeString(payload.bot_id),
        notionVersion: this.env.NOTION_API_VERSION,
        ownerType: ownerType(payload.owner)
      },
      providerCursor: {},
      configPatch: {
        ...EMPTY_SELECTED_NOTION_CONFIG,
        selectedNotionWorkspaceId: workspaceId,
        selectedNotionMode: "oauth" as const
      }
    };
  }

  async listResources(input: {
    connector: CommunicationConnector;
    credential: Record<string, unknown> | null;
    query?: { search?: string; limit?: number; cursor?: string };
  }) {
    const credential = this.requireCredential(input.credential);
    const config = this.parseConfig(input.connector.configJson);
    const selectedIds = new Set([
      ...config.selectedNotionRootIds,
      ...config.selectedNotionPageIds,
      ...config.selectedNotionDatabaseIds,
      ...config.selectedNotionDataSourceIds
    ].map(normalizeNotionId));
    const page = await this.searchAccessibleResources(credential, {
      search: input.query?.search,
      limit: Math.min(Math.max(input.query?.limit ?? 50, 1), 100),
      cursor: input.query?.cursor
    });
    return {
      resources: (page.results ?? []).map((resource) => this.toResourceCandidate(resource, selectedIds)).filter(Boolean) as ProviderResourceCandidate[],
      nextCursor: page.next_cursor ?? null
    };
  }

  async sync(input: Parameters<CommunicationProviderAdapter["sync"]>[0]): Promise<ProviderSyncResult> {
    const credential = this.requireCredential(input.credential);
    const config = this.parseConfig(input.connector.configJson);
    const selectedIds = this.selectedResourceIds(config);
    if (selectedIds.length === 0) {
      return {
        queued: false,
        status: "completed",
        batches: [],
        documentResources: [],
        cursorAfter: this.mergeCursor(input.connector.providerCursorJson, {
          lastSyncNoopReason: "notion_selected_resources_required",
          lastSyncAt: new Date().toISOString()
        }),
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
      };
    }

    const documents: NormalizedDocumentWorkspaceResource[] = [];
    const skipped: SkippedDocumentWorkspaceResource[] = [];
    const seenPages = new Set<string>();

    for (const pageId of [...config.selectedNotionRootIds, ...config.selectedNotionPageIds].slice(0, MAX_RESOURCE_COUNT)) {
      await this.collectPageResource({
        credential,
        config,
        pageId,
        selectedResourceId: pageId,
        documents,
        skipped,
        seenPages,
        depth: 0
      });
    }

    for (const databaseId of config.selectedNotionDatabaseIds.slice(0, MAX_RESOURCE_COUNT)) {
      await this.collectDatabaseResource({
        credential,
        config,
        databaseId,
        selectedResourceId: databaseId,
        documents,
        skipped,
        seenPages,
        type: "database"
      });
    }

    for (const dataSourceId of config.selectedNotionDataSourceIds.slice(0, MAX_RESOURCE_COUNT)) {
      await this.collectDatabaseResource({
        credential,
        config,
        databaseId: dataSourceId,
        selectedResourceId: dataSourceId,
        documents,
        skipped,
        seenPages,
        type: "data_source"
      });
    }

    const cursorAfter = this.mergeCursor(input.connector.providerCursorJson, {
      lastSyncedAt: new Date().toISOString(),
      selectedNotionResourceIds: selectedIds,
      resourceCursors: Object.fromEntries(
        documents.map((resource) => [
          resource.providerResourceId,
          {
            contentHash: resource.contentHash,
            lastEditedAt: toIso(resource.lastEditedAt),
            title: resource.title
          }
        ])
      ),
      partialFailures: skipped.map((item) => ({
        providerResourceId: item.providerResourceId,
        reason: item.skipReason,
        error: item.error ?? null
      }))
    });

    return {
      queued: false,
      status: skipped.length > 0 ? "partial" : "completed",
      batches: [],
      documentResources: documents,
      skippedDocumentResources: skipped,
      cursorAfter,
      summary: {
        provider: "notion",
        selectedResourceMode: "selected_shared_only",
        workspaceId: config.selectedNotionWorkspaceId,
        selectedResourceCount: selectedIds.length,
        pagesFetched: documents.filter((item) => item.resourceType !== "database").length,
        databaseCount: config.selectedNotionDatabaseIds.length,
        dataSourceCount: config.selectedNotionDataSourceIds.length,
        documentsReadyForIndexing: documents.length,
        skipped: skipped.length,
        skippedInaccessible: skipped.filter((item) => item.skipReason === "inaccessible").length,
        includeComments: config.includeComments
      }
    };
  }

  async testConnection(input: Parameters<NonNullable<CommunicationProviderAdapter["testConnection"]>>[0]) {
    const credential = input.credential as NotionCredential | null;
    return {
      ok: typeof credential?.accessToken === "string",
      accountLabel: typeof credential?.workspaceName === "string" ? credential.workspaceName : "Notion"
    };
  }

  async revoke(): Promise<{ providerRevoked: boolean; reason?: string }> {
    return { providerRevoked: false, reason: "Notion access must also be removed in Notion settings; the local credential was removed." };
  }

  private async collectDatabaseResource(input: {
    credential: NotionCredential;
    config: NotionSyncConfig;
    databaseId: string;
    selectedResourceId: string;
    documents: NormalizedDocumentWorkspaceResource[];
    skipped: SkippedDocumentWorkspaceResource[];
    seenPages: Set<string>;
    type: "database" | "data_source";
  }) {
    const label = this.resourceLabel(input.config, input.selectedResourceId) ?? `${input.type} ${input.selectedResourceId}`;
    try {
      const rows = await this.queryDatabaseLike(input.credential, input.databaseId, input.type);
      for (const row of rows.slice(0, MAX_DATABASE_ITEMS)) {
        if (row.object === "page" && typeof row.id === "string") {
          await this.collectPageResource({
            credential: input.credential,
            config: input.config,
            pageId: row.id,
            selectedResourceId: input.selectedResourceId,
            selectedResourceLabel: label,
            documents: input.documents,
            skipped: input.skipped,
            seenPages: input.seenPages,
            depth: 0,
            resourceType: "database_item",
            parentResourceId: input.databaseId
          });
        }
      }
      input.documents.push({
        provider: "notion",
        providerResourceId: input.databaseId,
        resourceType: input.type,
        selectedResourceId: input.selectedResourceId,
        selectedResourceLabel: label,
        title: label,
        url: null,
        lastEditedAt: null,
        content: `# ${label}\n\nSynced ${rows.length} accessible Notion ${input.type === "database" ? "database" : "data source"} item(s). Each accessible row/page is indexed as its own Project Memory document.`,
        contentHash: sha256(`${input.databaseId}:${rows.length}:${rows.map((row) => row.id).join(",")}`),
        fileName: `${safeFileName(label)}.md`,
        metadata: {
          sourceProvider: "notion",
          notionResourceType: input.type,
          selectedResourceId: input.selectedResourceId,
          itemCount: rows.length
        }
      });
    } catch (error) {
      input.skipped.push(this.skippedResource(input.databaseId, input.type, input.selectedResourceId, label, error));
    }
  }

  private async collectPageResource(input: {
    credential: NotionCredential;
    config: NotionSyncConfig;
    pageId: string;
    selectedResourceId: string;
    selectedResourceLabel?: string | null;
    documents: NormalizedDocumentWorkspaceResource[];
    skipped: SkippedDocumentWorkspaceResource[];
    seenPages: Set<string>;
    depth: number;
    resourceType?: "page" | "database_item" | "child_page";
    parentResourceId?: string | null;
  }) {
    const normalizedPageId = normalizeNotionId(input.pageId);
    if (input.seenPages.has(normalizedPageId)) return;
    input.seenPages.add(normalizedPageId);
    try {
      const page = await this.retrievePage(input.credential, input.pageId);
      const blocks = await this.retrieveBlocksRecursive(input.credential, input.pageId, input.config.maxDepth, input.depth);
      const title = titleFromPage(page) ?? input.selectedResourceLabel ?? `Notion page ${input.pageId}`;
      const sections = blocks.map((block) => this.blockToMarkdown(block)).filter((value) => value.trim().length > 0);
      const properties = pagePropertiesToMarkdown(page.properties);
      const content = [
        `# ${title}`,
        properties ? `\n## Page properties\n${properties}` : "",
        sections.length ? `\n## Page content\n${sections.join("\n\n")}` : "",
        input.config.includeComments ? "\n<!-- Notion comments sync is capability-gated and not included unless available. -->" : ""
      ].filter(Boolean).join("\n");

      if (content.trim().length < title.length + 4) {
        input.skipped.push({
          provider: "notion",
          providerResourceId: input.pageId,
          resourceType: input.resourceType ?? (input.depth > 0 ? "child_page" : "page"),
          selectedResourceId: input.selectedResourceId,
          selectedResourceLabel: input.selectedResourceLabel ?? this.resourceLabel(input.config, input.selectedResourceId),
          title,
          skipped: true,
          skipReason: "empty",
          error: null
        });
        return;
      }

      input.documents.push({
        provider: "notion",
        providerResourceId: input.pageId,
        resourceType: input.resourceType ?? (input.depth > 0 ? "child_page" : "page"),
        parentResourceId: input.parentResourceId ?? null,
        selectedResourceId: input.selectedResourceId,
        selectedResourceLabel: input.selectedResourceLabel ?? this.resourceLabel(input.config, input.selectedResourceId),
        title,
        url: safePublicUrl(page.url),
        lastEditedAt: parseDate(page.last_edited_time),
        content,
        contentHash: sha256(content),
        fileName: `${safeFileName(title)}.md`,
        metadata: {
          sourceProvider: "notion",
          notionPageId: input.pageId,
          notionWorkspaceId: input.config.selectedNotionWorkspaceId,
          notionResourceType: input.resourceType ?? (input.depth > 0 ? "child_page" : "page"),
          selectedResourceId: input.selectedResourceId,
          selectedResourceLabel: input.selectedResourceLabel ?? this.resourceLabel(input.config, input.selectedResourceId),
          blockIds: blocks.map((block) => block.id).filter(Boolean).slice(0, 200),
          lastEditedTime: page.last_edited_time ?? null,
          url: safePublicUrl(page.url)
        }
      });

      if (input.config.includeChildPages && input.depth < input.config.maxDepth) {
        for (const block of blocks) {
          if (block.type === "child_page" && typeof block.id === "string") {
            await this.collectPageResource({
              credential: input.credential,
              config: input.config,
              pageId: block.id,
              selectedResourceId: input.selectedResourceId,
              selectedResourceLabel: input.selectedResourceLabel ?? this.resourceLabel(input.config, input.selectedResourceId),
              documents: input.documents,
              skipped: input.skipped,
              seenPages: input.seenPages,
              depth: input.depth + 1,
              resourceType: "child_page",
              parentResourceId: input.pageId
            });
          }
        }
      }
    } catch (error) {
      input.skipped.push(this.skippedResource(input.pageId, input.resourceType ?? "page", input.selectedResourceId, input.selectedResourceLabel, error));
    }
  }

  private skippedResource(
    providerResourceId: string,
    resourceType: SkippedDocumentWorkspaceResource["resourceType"],
    selectedResourceId: string,
    selectedResourceLabel: string | null | undefined,
    error: unknown
  ): SkippedDocumentWorkspaceResource {
    const status = error instanceof NotionApiError ? error.status : null;
    return {
      provider: "notion",
      providerResourceId,
      resourceType,
      selectedResourceId,
      selectedResourceLabel: selectedResourceLabel ?? null,
      title: selectedResourceLabel ?? null,
      skipped: true,
      skipReason: status === 403 || status === 404 ? "inaccessible" : status === 429 ? "rate_limited" : "provider_error",
      error: sanitizeProviderError(error)
    };
  }

  private async searchAccessibleResources(credential: NotionCredential, input: { search?: string; limit: number; cursor?: string }) {
    const body: Record<string, unknown> = {
      page_size: input.limit,
      sort: { direction: "descending", timestamp: "last_edited_time" }
    };
    if (input.search) body.query = input.search;
    if (input.cursor) body.start_cursor = input.cursor;
    return this.notionRequest<NotionListResponse>(credential, "/v1/search", { method: "POST", body });
  }

  private async retrievePage(credential: NotionCredential, pageId: string) {
    return this.notionRequest<NotionObject>(credential, `/v1/pages/${encodeURIComponent(pageId)}`);
  }

  private async retrieveBlocksRecursive(credential: NotionCredential, blockId: string, maxDepth: number, depth = 0) {
    const collected: NotionObject[] = [];
    let cursor: string | undefined;
    let pageCount = 0;
    while (pageCount < MAX_SEARCH_PAGES && collected.length < MAX_BLOCKS_PER_PAGE) {
      const params = new URLSearchParams({ page_size: "100" });
      if (cursor) params.set("start_cursor", cursor);
      const page = await this.notionRequest<NotionListResponse>(
        credential,
        `/v1/blocks/${encodeURIComponent(blockId)}/children?${params.toString()}`
      );
      for (const block of page.results ?? []) {
        collected.push(block);
        if (block.has_children === true && depth < maxDepth && block.type !== "child_page") {
          const children = await this.retrieveBlocksRecursive(credential, block.id, maxDepth, depth + 1);
          collected.push(...children.map((child) => ({ ...child, _parentBlockId: block.id })));
        }
        if (collected.length >= MAX_BLOCKS_PER_PAGE) break;
      }
      if (!page.has_more || !page.next_cursor) break;
      cursor = page.next_cursor;
      pageCount += 1;
    }
    return collected;
  }

  private async queryDatabaseLike(credential: NotionCredential, resourceId: string, type: "database" | "data_source") {
    const path =
      type === "data_source"
        ? `/v1/data_sources/${encodeURIComponent(resourceId)}/query`
        : `/v1/databases/${encodeURIComponent(resourceId)}/query`;
    const rows: NotionObject[] = [];
    let cursor: string | undefined;
    let pageCount = 0;
    while (pageCount < MAX_SEARCH_PAGES && rows.length < MAX_DATABASE_ITEMS) {
      const body: Record<string, unknown> = { page_size: Math.min(100, MAX_DATABASE_ITEMS - rows.length) };
      if (cursor) body.start_cursor = cursor;
      try {
        const page = await this.notionRequest<NotionListResponse>(credential, path, { method: "POST", body });
        rows.push(...(page.results ?? []));
        if (!page.has_more || !page.next_cursor) break;
        cursor = page.next_cursor;
      } catch (error) {
        if (type === "database" && error instanceof NotionApiError && error.status === 404) {
          const fallback = await this.notionRequest<NotionListResponse>(
            credential,
            `/v1/data_sources/${encodeURIComponent(resourceId)}/query`,
            { method: "POST", body }
          );
          rows.push(...(fallback.results ?? []));
          if (!fallback.has_more || !fallback.next_cursor) break;
          cursor = fallback.next_cursor;
        } else {
          throw error;
        }
      }
      pageCount += 1;
    }
    return rows;
  }

  private async notionRequest<T>(credential: NotionCredential, path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const accessToken = this.requireAccessToken(credential);
    const url = path.startsWith("http") ? path : `${this.apiBaseUrl()}${path}`;
    let attempt = 0;
    let lastError: unknown = null;
    while (attempt < 3) {
      attempt += 1;
      const response = await this.fetchImpl(url, {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
          ...(options.body ? { "content-type": "application/json" } : {}),
          "Notion-Version": credential.notionVersion ?? this.env.NOTION_API_VERSION
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      if (response.ok) {
        return (await response.json()) as T;
      }
      const body = await response.text().catch(() => "");
      lastError = new NotionApiError(response.status, sanitizeProviderError(body || response.statusText));
      if (response.status !== 429 || attempt >= 3) break;
      const retryAfter = Number(response.headers.get("retry-after") ?? "1");
      await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(retryAfter, 1), 3) * 1000));
    }
    throw lastError instanceof Error ? lastError : new AppError(502, "Notion API request failed", "notion_api_failed");
  }

  private toResourceCandidate(resource: NotionObject, selectedIds: Set<string>): ProviderResourceCandidate | null {
    if (resource.object !== "page" && resource.object !== "database" && resource.object !== "data_source") return null;
    const id = typeof resource.id === "string" ? resource.id : null;
    if (!id) return null;
    const type = resource.object === "database" ? "database" : resource.object === "data_source" ? "data_source" : "page";
    return {
      id,
      type,
      title: resource.object === "page" ? titleFromPage(resource) ?? "Untitled Notion page" : titleFromRichText(resource.title) ?? "Untitled Notion database",
      url: safePublicUrl(resource.url),
      parentLabel: parentLabel(resource.parent),
      lastEditedAt: typeof resource.last_edited_time === "string" ? resource.last_edited_time : null,
      selected: selectedIds.has(normalizeNotionId(id))
    };
  }

  private blockToMarkdown(block: NotionObject) {
    const type = block.type;
    const value = block[type] ?? {};
    const text = richTextToPlain(value.rich_text ?? value.text ?? []);
    if (!text && type !== "divider" && type !== "child_page" && type !== "table_row") return "";
    switch (type) {
      case "heading_1": return `# ${text}`;
      case "heading_2": return `## ${text}`;
      case "heading_3": return `### ${text}`;
      case "bulleted_list_item": return `- ${text}`;
      case "numbered_list_item": return `1. ${text}`;
      case "to_do": return `- [${value.checked ? "x" : " "}] ${text}`;
      case "toggle": return `<toggle>${text}</toggle>`;
      case "quote": return `> ${text}`;
      case "callout": return `> ${text}`;
      case "code": return `\`\`\`${safeString(value.language) ?? ""}\n${text}\n\`\`\``;
      case "child_page": return `Child page: ${safeString(value.title) ?? block.id}`;
      case "table_row": return Array.isArray(value.cells) ? `| ${value.cells.map((cell: unknown[]) => richTextToPlain(cell)).join(" | ")} |` : "";
      case "divider": return "---";
      default: return text;
    }
  }

  private parseConfig(configJson: unknown): NotionSyncConfig {
    const config = (configJson ?? {}) as Record<string, unknown>;
    return {
      selectedNotionWorkspaceId: safeString(config.selectedNotionWorkspaceId),
      selectedNotionRootIds: readStringArray(config.selectedNotionRootIds).slice(0, MAX_RESOURCE_COUNT),
      selectedNotionPageIds: readStringArray(config.selectedNotionPageIds).slice(0, MAX_RESOURCE_COUNT),
      selectedNotionDatabaseIds: readStringArray(config.selectedNotionDatabaseIds).slice(0, MAX_RESOURCE_COUNT),
      selectedNotionDataSourceIds: readStringArray(config.selectedNotionDataSourceIds).slice(0, MAX_RESOURCE_COUNT),
      selectedNotionResourceMode: "selected_shared_only",
      selectedNotionResourceLabels: readResourceLabels(config.selectedNotionResourceLabels),
      includeComments: config.includeComments === true,
      includeChildPages: config.includeChildPages !== false,
      includeDatabaseItems: config.includeDatabaseItems !== false,
      maxDepth: clampNumber(config.maxDepth, 0, 5, 3),
      backfillDays: clampNumber(config.backfillDays, 0, 365, 0)
    };
  }

  private selectedResourceIds(config: NotionSyncConfig) {
    return Array.from(new Set([
      ...config.selectedNotionRootIds,
      ...config.selectedNotionPageIds,
      ...config.selectedNotionDatabaseIds,
      ...config.selectedNotionDataSourceIds
    ].map(normalizeNotionId).filter(Boolean)));
  }

  private resourceLabel(config: NotionSyncConfig, id: string) {
    return config.selectedNotionResourceLabels.find((label) => normalizeNotionId(label.id) === normalizeNotionId(id))?.label ?? null;
  }

  private requireCredential(credential: Record<string, unknown> | null): NotionCredential {
    if (!credential || typeof credential.accessToken !== "string" || credential.accessToken.length === 0) {
      throw new AppError(409, "Notion connector credential is missing", "notion_credential_missing");
    }
    return credential as NotionCredential;
  }

  private requireAccessToken(credential: NotionCredential) {
    if (!credential.accessToken) {
      throw new AppError(409, "Notion connector credential is missing", "notion_credential_missing");
    }
    return credential.accessToken;
  }

  private apiBaseUrl() {
    return "https://api.notion.com";
  }

  private resolveTokenUrl() {
    const authUrl = new URL(this.env.NOTION_AUTH_URL ?? "https://api.notion.com/v1/oauth/authorize");
    authUrl.pathname = authUrl.pathname.replace(/\/authorize\/?$/, "/token");
    if (!authUrl.pathname.endsWith("/token")) {
      authUrl.pathname = "/v1/oauth/token";
    }
    return authUrl.toString();
  }

  private mergeCursor(existing: unknown, patch: Record<string, unknown>) {
    return {
      ...((existing as Record<string, unknown> | null) ?? {}),
      ...patch
    };
  }
}

class NotionApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "NotionApiError";
  }
}

function safeString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function ownerType(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" ? type : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function readResourceLabels(value: unknown): SelectedResourceLabel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : null;
    const id = safeString(record?.id);
    const label = safeString(record?.label);
    const type = safeString(record?.type);
    if (!id || !label || !["page", "database", "data_source", "root"].includes(type ?? "")) return [];
    return [{ id, label, type: type as SelectedResourceLabel["type"] }];
  });
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
}

function richTextToPlain(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((item) => {
    const record = item && typeof item === "object" ? item as Record<string, any> : null;
    return record?.plain_text ?? record?.text?.content ?? record?.mention?.plain_text ?? "";
  }).join("").trim();
}

function titleFromRichText(value: unknown) {
  const title = richTextToPlain(value);
  return title.length > 0 ? title : null;
}

function titleFromPage(page: NotionObject) {
  const properties = page.properties && typeof page.properties === "object" ? page.properties as Record<string, any> : {};
  for (const property of Object.values(properties)) {
    if (property?.type === "title") {
      const title = titleFromRichText(property.title);
      if (title) return title;
    }
  }
  return titleFromRichText(page.title) ?? safeString(page.id);
}

function pagePropertiesToMarkdown(properties: unknown) {
  if (!properties || typeof properties !== "object") return "";
  const rows: string[] = [];
  for (const [name, property] of Object.entries(properties as Record<string, any>)) {
    if (property?.type === "title") continue;
    const value = propertyToPlain(property);
    if (value) rows.push(`- ${name}: ${value}`);
  }
  return rows.slice(0, 40).join("\n");
}

function propertyToPlain(property: any): string | null {
  switch (property?.type) {
    case "rich_text": return richTextToPlain(property.rich_text);
    case "select": return safeString(property.select?.name);
    case "multi_select": return Array.isArray(property.multi_select) ? property.multi_select.map((item: any) => item.name).filter(Boolean).join(", ") : null;
    case "status": return safeString(property.status?.name);
    case "date": return [property.date?.start, property.date?.end].filter(Boolean).join(" - ") || null;
    case "checkbox": return property.checkbox ? "true" : "false";
    case "number": return property.number == null ? null : String(property.number);
    case "url": return safeString(property.url);
    case "email": return safeString(property.email);
    case "phone_number": return safeString(property.phone_number);
    case "people": return Array.isArray(property.people) ? property.people.map((person: any) => person.name ?? person.id).filter(Boolean).join(", ") : null;
    case "created_time": return safeString(property.created_time);
    case "last_edited_time": return safeString(property.last_edited_time);
    default: return null;
  }
}

function parentLabel(parent: unknown) {
  if (!parent || typeof parent !== "object") return null;
  const record = parent as Record<string, unknown>;
  if (typeof record.type === "string") return record.type.replace(/_/g, " ");
  return null;
}

function normalizeNotionId(value: string) {
  return value.replace(/-/g, "").toLowerCase();
}

function parseDate(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value) : null;
}

function toIso(value: string | Date | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeFileName(value: string) {
  const cleaned = value.replace(/[\\/:*?"<>|#{}%~&]+/g, "_").trim();
  return (cleaned || "notion-page").slice(0, 120);
}

function safePublicUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)notion\.so$/i.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

function sanitizeProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : String(error ?? "");
  return message
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    .replace(/(access[_-]?token[\"'=:\s]+)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    .slice(0, 500);
}
