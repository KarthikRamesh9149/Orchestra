import type { ProjectContextEntry } from "../api";
import { apiEnvelope, ApiError } from "./client";

export {
  addDeepResearchToMemory,
  downloadDeepResearchReport,
  getDeepResearchRun,
  getDeepResearchUsage,
  getProjectContextEntry,
  startDeepResearch
} from "../api";
export type { DeepResearchResults, DeepResearchSourceKey, DeepResearchUsage, ProjectContextEntry } from "../api";

export type SavedResearchPage = {
  items: ProjectContextEntry[];
  meta: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
};

function isPaginationMeta(value: unknown): value is SavedResearchPage["meta"] {
  if (!value || typeof value !== "object") return false;
  const meta = value as Record<string, unknown>;
  const isPositiveInteger = (key: string) => Number.isSafeInteger(meta[key]) && (meta[key] as number) >= 1;
  return isPositiveInteger("page") && isPositiveInteger("pageSize") && isPositiveInteger("totalPages") &&
    Number.isSafeInteger(meta.totalCount) && (meta.totalCount as number) >= 0;
}

function isContextEntry(value: unknown, projectId: string): value is ProjectContextEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return ["id", "projectId", "type", "title", "body", "source", "status", "createdAt", "updatedAt"].every((key) =>
    typeof entry[key] === "string" && entry[key].length > 0
  ) && entry.projectId === projectId && entry.type === "manual_note" && Array.isArray(entry.tags) &&
    entry.tags.every((tag) => typeof tag === "string") && entry.tags.includes("deep-research") &&
    !Number.isNaN(Date.parse(entry.createdAt as string)) && !Number.isNaN(Date.parse(entry.updatedAt as string));
}

/**
 * The context API supplies pagination in its envelope. This intentionally reads
 * that envelope directly rather than apiJson, which returns only `data`.
 */
export async function listSavedResearch(projectId: string, page = 1, signal?: AbortSignal): Promise<SavedResearchPage> {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new ApiError({ status: 0, code: "invalid_request", message: "Saved research page must be a positive integer." });
  }
  const query = new URLSearchParams({
    tag: "deep-research",
    type: "manual_note",
    page: String(page),
    pageSize: "10",
  });
  const payload = await apiEnvelope<unknown, unknown>(`/v1/projects/${encodeURIComponent(projectId)}/context?${query}`, { signal });
  if (!Array.isArray(payload.data) || !isPaginationMeta(payload.meta) || payload.meta.page !== page ||
      payload.meta.page > payload.meta.totalPages ||
      payload.meta.totalPages !== Math.max(1, Math.ceil(payload.meta.totalCount / payload.meta.pageSize)) ||
      payload.data.some((entry) => !isContextEntry(entry, projectId))) {
    throw new ApiError({ status: 200, code: "invalid_response", message: "The server returned an incomplete response. Please retry." });
  }
  return { items: payload.data, meta: payload.meta };
}
