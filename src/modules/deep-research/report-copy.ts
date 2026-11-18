import type { DeepResearchResults } from "./schemas.js";

const readerTerms = {
  acceptedDecisionReferences: "recorded decision references",
  providedEvidenceReferences: "retrieved evidence references",
  completeProjectInventory: "complete project inventory",
} as const;

function readerCopy(text: string) {
  return text.replace(/`?\b(acceptedDecisionReferences|providedEvidenceReferences|completeProjectInventory)\b`?/g,
    (_match, term: keyof typeof readerTerms) => readerTerms[term]);
}

// Only generated prose changes. Keep original evidence titles/quotes, source
// references, and persistent action identities intact.
export function presentResearchReport<T extends DeepResearchResults>(report: T) {
  return {
    ...report,
    executiveSummary: readerCopy(report.executiveSummary),
    findings: report.findings.map((item) => ({ ...item, title: readerCopy(item.title), description: readerCopy(item.description) })),
    marketContext: report.marketContext.map((item) => ({ ...item, title: readerCopy(item.title), body: readerCopy(item.body) })),
    expansionOpportunities: report.expansionOpportunities.map(readerCopy),
    recommendedActions: report.recommendedActions.map((item) => ({ ...item, action: readerCopy(item.action) })),
  };
}
