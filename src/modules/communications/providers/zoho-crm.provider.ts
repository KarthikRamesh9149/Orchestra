import type { ProviderChannel } from "./provider.interface.js";
import type { CommunicationConnector, CommunicationSyncType } from "@prisma/client";
import type { AppEnv } from "../../../config/env.js";
import type {
  NormalizedCommunicationBatch,
  NormalizedMessage,
  NormalizedParticipant,
  NormalizedThread
} from "../../../lib/communications/provider-normalized-types.js";
import { ZohoProviderBase } from "./zoho/zoho-provider-base.js";
import type { ZohoCredential } from "./zoho/zoho-types.js";
import {
  zohoAllowlistedRecord,
  zohoArrayFromPayload,
  zohoBound,
  zohoDate,
  zohoIso,
  zohoParticipant,
  zohoSafeMetadata,
  zohoString,
  zohoStringArray,
  zohoText,
  zohoUniqueParticipants
} from "./zoho/zoho-normalization.js";

const DEFAULT_MODULES = ["Leads", "Accounts", "Contacts", "Deals", "Tasks", "Events", "Calls", "Notes", "Cases"];
const DEFAULT_SAFE_FIELDS = [
  "id",
  "Name",
  "Full_Name",
  "First_Name",
  "Last_Name",
  "Company",
  "Account_Name",
  "Contact_Name",
  "Deal_Name",
  "Subject",
  "Status",
  "Stage",
  "Priority",
  "Description",
  "Note_Title",
  "Note_Content",
  "Call_Purpose",
  "Call_Type",
  "Call_Start_Time",
  "Start_DateTime",
  "End_DateTime",
  "Due_Date",
  "Closing_Date",
  "Modified_Time",
  "Created_Time",
  "Owner",
  "$se_module"
];

export class ZohoCrmProvider extends ZohoProviderBase {
  readonly provider = "zoho_crm" as const;
  protected readonly service = "crm" as const;
  protected readonly defaultAccountLabel = "Zoho CRM";

  constructor(env: AppEnv, fetchImpl: typeof fetch = fetch) {
    super(env, fetchImpl);
  }

  protected providerConfigDefaults() {
    return {
      orgId: null,
      selectedModules: this.selectedModules(),
      selectedCustomModules: [],
      moduleFieldAllowlist: this.env.ZOHO_CRM_FIELD_ALLOWLIST,
      includeNotes: true,
      includeCalls: true,
      includeMeetings: true,
      includeTasks: true,
      maxBackfillDays: this.env.CONNECTOR_SYNC_MAX_BACKFILL_DAYS,
      syncBatchSize: this.env.ZOHO_CRM_SYNC_BATCH_SIZE,
      maxRecordsPerSync: this.env.ZOHO_CRM_MAX_RECORDS_PER_SYNC,
      includeCustomModules: this.env.ZOHO_CRM_INCLUDE_CUSTOM_MODULES,
      writeActionsEnabled: false
    };
  }

  protected async resolveAccountLabel(credential: ZohoCredential) {
    const { payload } = await this.client.getCrmModules(credential);
    return {
      label: "Zoho CRM",
      configPatch: {
        moduleCountAtConnect: this.arrayFromPayload(payload, ["modules", "data"]).length
      }
    };
  }

  async testConnection(input: { credential: Record<string, unknown> | null }) {
    const credential = this.requireCredential(input.credential);
    const { payload } = await this.client.getCrmModules(credential);
    return {
      ok: true,
      accountLabel: "Zoho CRM",
      details: { moduleCount: this.arrayFromPayload(payload, ["modules", "data"]).length }
    };
  }

  async listChannels(input: { credential: Record<string, unknown> | null }): Promise<ProviderChannel[]> {
    const credential = this.requireCredential(input.credential);
    const { payload } = await this.client.getCrmModules(credential);
    const selected = new Set(this.selectedModules().map((name) => name.toLowerCase()));
    return this.arrayFromPayload(payload, ["modules", "data"])
      .map((module) => module as Record<string, unknown>)
      .filter((module) => {
        const apiName = this.stringValue(module.api_name ?? module.module_name ?? module.plural_label);
        if (!apiName) return false;
        if (this.env.ZOHO_CRM_INCLUDE_CUSTOM_MODULES) return true;
        return selected.has(apiName.toLowerCase());
      })
      .map((module) => {
        const id = this.stringValue(module.api_name ?? module.module_name ?? module.id) ?? "unknown";
        return {
          id: `module:${id}`,
          name: this.stringValue(module.plural_label ?? module.module_name ?? module.api_name) ?? id,
          isPrivate: false,
          isArchived: Boolean(module.visibility === 0 || module.status === "inactive")
        };
      });
  }

  async sync(input: {
    projectId: string;
    connector: CommunicationConnector;
    credential: Record<string, unknown> | null;
    syncType: CommunicationSyncType;
    batchSize: number;
    maxBackfillDays: number;
  }) {
    let credential = this.requireCredential(input.credential);
    const config = this.parseConfig(input.connector.configJson, input.batchSize);
    const cursor = this.parseCursor(input.connector.providerCursorJson);
    const modules = await this.resolveModules(credential, config);
    credential = modules.credential;

    const threads = new Map<string, NormalizedThread>();
    const messages = new Map<string, NormalizedMessage>();
    const moduleCursors: Record<string, { lastModifiedTime: string | null; lastSyncedAt: string }> = {};
    let newestModifiedAt = cursor.lastModifiedTime;

    for (const moduleName of modules.moduleApiNames) {
      if (messages.size >= config.maxRecordsPerSync) break;
      let page = 1;
      let pageToken = cursor.crm?.[moduleName]?.pageToken ?? null;
      let moduleNewest = cursor.crm?.[moduleName]?.lastModifiedTime ?? null;
      do {
        const response = await this.client.getCrmRecords(
          credential,
          moduleName,
          Math.min(config.batchSize, config.maxRecordsPerSync - messages.size),
          { page, pageToken, sortBy: "Modified_Time", sortOrder: "desc" }
        );
        credential = response.credential as ZohoCredential & { accessToken: string };
        const records = zohoArrayFromPayload(response.payload, ["data"]);
        for (const item of records) {
          if (messages.size >= config.maxRecordsPerSync) break;
          const record = item as Record<string, unknown>;
          if (!this.shouldIncludeRecord(record, moduleName, config, cursor)) continue;
          const normalized = this.normalizeRecord(moduleName, record, config);
          if (!normalized) continue;
          threads.set(normalized.thread.providerThreadId, normalized.thread);
          messages.set(normalized.message.providerMessageId, normalized.message);
          const modifiedAt = zohoIso(record.Modified_Time ?? record.modified_time ?? record.Created_Time ?? record.created_time);
          if (modifiedAt && (!moduleNewest || new Date(modifiedAt) > new Date(moduleNewest))) moduleNewest = modifiedAt;
          if (modifiedAt && (!newestModifiedAt || new Date(modifiedAt) > new Date(newestModifiedAt))) newestModifiedAt = modifiedAt;
        }
        pageToken = this.nextPageToken(response.payload);
        const moreRecords = this.hasMore(response.payload);
        if (!moreRecords) break;
        if (!pageToken) page += 1;
      } while (messages.size < config.maxRecordsPerSync);
      moduleCursors[moduleName] = { lastModifiedTime: moduleNewest, lastSyncedAt: new Date().toISOString() };
    }

    const batches: NormalizedCommunicationBatch[] =
      messages.size > 0
        ? [
            {
              projectId: input.projectId,
              connectorId: input.connector.id,
              provider: this.provider,
              threads: [...threads.values()],
              messages: [...messages.values()]
            }
          ]
        : [];

    return {
      queued: false,
      batches,
      cursorAfter: {
        ...cursor,
        provider: this.provider,
        lastModifiedTime: newestModifiedAt ?? cursor.lastModifiedTime ?? null,
        lastSyncedAt: new Date().toISOString(),
        crm: {
          ...(cursor.crm ?? {}),
          ...moduleCursors
        }
      },
      updatedCredential: credential,
      summary: {
        provider: this.provider,
        providerMode: "read_only",
        writesEnabled: false,
        moduleCount: modules.moduleApiNames.length,
        threadCount: threads.size,
        messageCount: messages.size,
        fieldAllowlistCount: config.fieldAllowlist.length,
        customModulesIncluded: config.includeCustomModules
      },
      status: "completed" as const
    };
  }

  private selectedModules() {
    return Array.from(
      new Set(
        (this.env.ZOHO_CRM_SELECTED_MODULES || DEFAULT_MODULES.join(","))
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
  }

  private parseConfig(configJson: unknown, batchSize: number) {
    const raw = (configJson ?? {}) as Record<string, unknown>;
    const envSelected = this.selectedModules();
    const selectedModules = zohoStringArray(raw.selectedModules).length > 0 ? zohoStringArray(raw.selectedModules) : envSelected;
    const selectedCustomModules = zohoStringArray(raw.selectedCustomModules);
    const configuredAllowlist =
      typeof raw.moduleFieldAllowlist === "string" && raw.moduleFieldAllowlist.trim()
        ? raw.moduleFieldAllowlist
        : this.env.ZOHO_CRM_FIELD_ALLOWLIST;
    const fieldAllowlist =
      configuredAllowlist.trim().length > 0
        ? configuredAllowlist
            .split(",")
            .map((field) => field.trim())
            .filter(Boolean)
        : DEFAULT_SAFE_FIELDS;
    return {
      selectedModules,
      selectedCustomModules,
      fieldAllowlist,
      includeNotes: raw.includeNotes !== false,
      includeCalls: raw.includeCalls !== false,
      includeMeetings: raw.includeMeetings !== false,
      includeTasks: raw.includeTasks !== false,
      includeCustomModules: raw.includeCustomModules === true && this.env.ZOHO_CRM_INCLUDE_CUSTOM_MODULES,
      batchSize: Math.min(batchSize, this.env.ZOHO_CRM_SYNC_BATCH_SIZE),
      maxRecordsPerSync: Math.min(this.env.ZOHO_CRM_MAX_RECORDS_PER_SYNC, Math.max(1, batchSize * 10))
    };
  }

  private parseCursor(cursorJson: unknown) {
    const raw = (cursorJson ?? {}) as Record<string, any>;
    return {
      ...raw,
      lastModifiedTime: zohoIso(raw.lastModifiedTime),
      crm: raw.crm && typeof raw.crm === "object" ? (raw.crm as Record<string, { pageToken?: string | null; lastModifiedTime?: string | null }>) : {}
    };
  }

  private async resolveModules(
    credential: ZohoCredential & { accessToken: string },
    config: ReturnType<ZohoCrmProvider["parseConfig"]>
  ) {
    const response = await this.client.getCrmModules(credential);
    const defaultAllowed = new Set(config.selectedModules.map((item) => item.toLowerCase()));
    const customAllowed = new Set(config.selectedCustomModules.map((item) => item.toLowerCase()));
    const moduleApiNames = zohoArrayFromPayload(response.payload, ["modules", "data"])
      .map((module) => module as Record<string, unknown>)
      .map((module) => ({
        apiName: zohoString(module.api_name ?? module.module_name ?? module.plural_label),
        isCustom: Boolean(module.generated_type === "custom" || module.custom_view || module.custom)
      }))
      .filter((module): module is { apiName: string; isCustom: boolean } => Boolean(module.apiName))
      .filter((module) => {
        const normalized = module.apiName.toLowerCase();
        if (module.isCustom) return config.includeCustomModules && customAllowed.has(normalized);
        return defaultAllowed.has(normalized);
      })
      .map((module) => module.apiName);
    return { credential: response.credential as ZohoCredential & { accessToken: string }, moduleApiNames };
  }

  private shouldIncludeRecord(
    record: Record<string, unknown>,
    moduleName: string,
    config: ReturnType<ZohoCrmProvider["parseConfig"]>,
    cursor: ReturnType<ZohoCrmProvider["parseCursor"]>
  ) {
    if (moduleName === "Notes" && !config.includeNotes) return false;
    if (moduleName === "Calls" && !config.includeCalls) return false;
    if (moduleName === "Events" && !config.includeMeetings) return false;
    if (moduleName === "Tasks" && !config.includeTasks) return false;
    const modifiedAt = zohoIso(record.Modified_Time ?? record.modified_time ?? record.Created_Time ?? record.created_time);
    const cursorTime = cursor.crm?.[moduleName]?.lastModifiedTime ?? cursor.lastModifiedTime;
    if (!modifiedAt || !cursorTime) return true;
    return new Date(modifiedAt) >= new Date(cursorTime);
  }

  private normalizeRecord(
    moduleName: string,
    record: Record<string, unknown>,
    config: ReturnType<ZohoCrmProvider["parseConfig"]>
  ) {
    const recordId = zohoString(record.id ?? record.ID);
    if (!recordId) return null;
    const subject = this.recordTitle(moduleName, record);
    const modifiedAt =
      zohoDate(record.Modified_Time ?? record.modified_time ?? record.Created_Time ?? record.created_time) ?? new Date();
    const owner = record.Owner && typeof record.Owner === "object" ? (record.Owner as Record<string, unknown>) : null;
    const participants = this.recordParticipants(record, owner);
    const thread: NormalizedThread = {
      providerThreadId: `crm:${moduleName}:${recordId}`,
      subject,
      participants,
      startedAt: zohoDate(record.Created_Time ?? record.created_time) ?? modifiedAt,
      lastMessageAt: modifiedAt,
      threadUrl: zohoString(record.$link_url ?? record.record_url),
      rawMetadata: {
        sourceSubType: "zoho_crm_record_thread",
        moduleName,
        recordId,
        owner: owner ? zohoSafeMetadata({ id: owner.id, name: owner.name, email: owner.email }) : null
      }
    };
    const safeFields = zohoAllowlistedRecord(record, config.fieldAllowlist);
    const message: NormalizedMessage = {
      providerThreadId: thread.providerThreadId,
      providerMessageId: `crm:${moduleName}:${recordId}:${zohoIso(record.Modified_Time ?? record.Created_Time) ?? "snapshot"}`,
      senderLabel: zohoString(owner?.name ?? owner?.email) ?? "Zoho CRM",
      senderExternalRef: zohoString(owner?.id),
      senderEmail: zohoString(owner?.email),
      sentAt: modifiedAt,
      bodyText: this.recordBody(moduleName, subject, safeFields),
      messageType: "system",
      providerPermalink: thread.threadUrl,
      rawMetadata: {
        sourceSubType: "zoho_crm_record_snapshot",
        moduleName,
        recordId,
        safeFields,
        stage: zohoString(record.Stage),
        status: zohoString(record.Status),
        modifiedTime: zohoIso(record.Modified_Time)
      }
    };
    return { thread, message };
  }

  private recordTitle(moduleName: string, record: Record<string, unknown>) {
    return (
      zohoString(
        record.Subject ??
          record.Deal_Name ??
          record.Full_Name ??
          record.Name ??
          record.Company ??
          record.Last_Name ??
          record.Note_Title
      ) ?? `${moduleName} record`
    );
  }

  private recordBody(moduleName: string, subject: string, fields: Record<string, unknown>) {
    const lines = [`Zoho CRM ${moduleName} evidence: ${subject}`];
    for (const [key, value] of Object.entries(fields)) {
      if (value == null || key === "id") continue;
      const text = typeof value === "object" ? JSON.stringify(zohoSafeMetadata(value)) : String(value);
      const normalizedText = zohoText(text, 1000);
      if (normalizedText) lines.push(`${key}: ${normalizedText}`);
    }
    return zohoBound(lines.join("\n"), 20_000);
  }

  private recordParticipants(record: Record<string, unknown>, owner: Record<string, unknown> | null): NormalizedParticipant[] {
    const account = record.Account_Name && typeof record.Account_Name === "object" ? (record.Account_Name as Record<string, unknown>) : null;
    const contact = record.Contact_Name && typeof record.Contact_Name === "object" ? (record.Contact_Name as Record<string, unknown>) : null;
    return zohoUniqueParticipants([
      zohoParticipant({ label: owner?.name, email: owner?.email, id: owner?.id, fallback: "Zoho CRM owner" }),
      zohoParticipant({ label: account?.name, id: account?.id }),
      zohoParticipant({ label: contact?.name, id: contact?.id })
    ]);
  }

  private hasMore(payload: Record<string, unknown>) {
    const info = payload.info && typeof payload.info === "object" ? (payload.info as Record<string, unknown>) : {};
    return info.more_records === true || Boolean(info.next_page_token);
  }

  private nextPageToken(payload: Record<string, unknown>) {
    const info = payload.info && typeof payload.info === "object" ? (payload.info as Record<string, unknown>) : {};
    return zohoString(info.next_page_token ?? payload.nextPageToken);
  }
}
