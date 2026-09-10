import { apiJson } from "./client";

export type WatchtowerEvidence = {
  source: string;
  refId: string;
  label: string;
  excerpt: string | null;
  occurredAt: string | null;
  openTarget?: { targetType: string; targetRef: Record<string, unknown> } | null;
};

export type WatchtowerSuggestion = {
  id: string;
  category: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  status: "active" | "dismissed" | "converted_to_timeline" | "converted_to_review" | "resolved" | "superseded";
  evidence: WatchtowerEvidence[];
  limitations: string[];
  promotedTimelineEventId: string | null;
  createdProposalId: string | null;
};

export type WatchtowerSuggestionsResponse = {
  items: WatchtowerSuggestion[];
  generatedAt: string;
  limitations: string[];
};

export type FdeFinding = {
  id: string;
  findingType: string;
  findingSubType: string;
  targetKind: string | null;
  targetRef: string | null;
  severity: "info" | "watch" | "blocking";
  confidence: string;
  summary: string;
  whyItMatters: string | null;
  suggestedAction: string | null;
  reasons: string[];
  limitations: string[];
};

export type FdeFindingsResponse = {
  items: FdeFinding[];
  limitations: string[];
  readOnly: boolean;
  truthMutationAllowed: false;
};

export function getWatchtowerSuggestions(projectId: string, includeDismissed = true) {
  const query = new URLSearchParams({ includeDismissed: String(includeDismissed), refresh: "true", limit: "100" });
  return apiJson<WatchtowerSuggestionsResponse>(`/v1/projects/${projectId}/suggestions?${query}`);
}

export function getWatchtowerFde(projectId: string) {
  return Promise.all([
    apiJson<FdeFindingsResponse>(`/v1/projects/${projectId}/fde-readiness/conflicts?limit=50`),
    apiJson<FdeFindingsResponse>(`/v1/projects/${projectId}/fde-readiness/safe-to-touch?limit=50`)
  ]).then(([conflicts, safeToTouch]) => ({
    items: [...conflicts.items, ...safeToTouch.items],
    limitations: [...new Set([...(conflicts.limitations ?? []), ...(safeToTouch.limitations ?? [])])],
    readOnly: true as const,
    truthMutationAllowed: false as const
  }));
}

export function dismissWatchtowerSuggestion(projectId: string, suggestionId: string, note: string) {
  return apiJson(`/v1/projects/${projectId}/suggestions/${suggestionId}/dismiss`, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export function promoteWatchtowerSuggestion(projectId: string, suggestionId: string) {
  return apiJson(`/v1/projects/${projectId}/suggestions/${suggestionId}/promote-to-timeline`, { method: "POST" });
}

export function createWatchtowerReview(projectId: string, suggestionId: string) {
  return apiJson(`/v1/projects/${projectId}/suggestions/${suggestionId}/create-review-item`, { method: "POST" });
}
