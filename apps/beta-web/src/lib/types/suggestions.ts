export type SuggestionCategory =
  | "merge_conflicts" | "spec_drift" | "stalled_work"
  | "reviewer_suggestions" | "risk_flags" | "decision_conflicts"
  | "ownership_gaps" | "coverage_gaps";

export type SuggestionSeverity = "low" | "medium" | "high";

export interface PR { number: number; title: string; author: string; additions?: number; deletions?: number }
export interface ReviewerSuggestion { name: string; initials: string; reason: string }

export type SuggestionEvidence =
  | { type: "merge_conflict"; prs: PR[]; overlappingFiles: string[] }
  | { type: "spec_drift"; docQuote: string; docSource: string; realityQuote: string; realitySource: string }
  | { type: "stalled"; pr: PR; lastActivityDays: number; blockedOn: string }
  | { type: "reviewer"; pr: PR; suggestions: ReviewerSuggestion[] }
  | { type: "risk_flag"; files: { path: string; risk: string }[]; coverageChange?: string }
  | { type: "decision_conflict"; slackQuote: string; slackSource: string; codeQuote: string; codeSource: string }
  | { type: "ownership_gap"; item: string; unassignedDays: number; suggestedOwners: { name: string; initials: string }[] }
  | { type: "coverage_gap"; docSection: string; inactivityDays: number; scopedSprint?: number; currentSprint?: number };

export interface Suggestion {
  id: string;
  category: SuggestionCategory;
  severity: SuggestionSeverity;
  title: string;
  description: string;
  detectedAt: string;
  evidence: SuggestionEvidence;
  primaryAction: { label: string; variant: "terracotta-filled" | "outline"; target?: string };
}
