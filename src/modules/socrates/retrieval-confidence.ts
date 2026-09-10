import type { EvidenceCard } from "../../lib/retrieval/evidence-pack.js";
import type { RetrievalIntent } from "../../lib/retrieval/types.js";

export interface RetrievalConfidenceInput {
  query?: string;
  intent: RetrievalIntent;
  evidenceCards: EvidenceCard[];
  validatedCitationCount: number;
  validatedOpenTargetCount: number;
  selectedObjectWasRequested: boolean;
  selectedObjectWasFound: boolean;
  budgetTruncated: boolean;
}

export interface RetrievalConfidenceResult {
  confidence: "high" | "medium" | "low";
  shouldBypassModel: boolean;
  limitations: string[];
}

const ACCEPTED_TRUTH_TYPES = new Set([
  "product_brain",
  "client_safe_brain",
  "accepted_change",
  "change_proposal",
  "decision_record",
  "brain_node",
]);
const SOURCE_TYPES = new Set(["document_section", "document_chunk", "message", "message_chunk", "communication_message"]);
const DASHBOARD_TYPES = new Set(["dashboard_snapshot"]);

export function evaluateRetrievalConfidence(input: RetrievalConfidenceInput): RetrievalConfidenceResult {
  const limitations: string[] = [];
  const cards = input.evidenceCards;
  const topConfidence = Math.max(0, ...cards.map((card) => card.confidence));
  const sourceTypes = new Set(cards.map((card) => card.sourceType));
  const queryTokens = tokenizeSupport(input.query ?? "");
  const evidenceText = cards.map((card) => `${card.title} ${card.excerpt} ${card.whySelected}`).join(" ");
  const supportedQueryTokens = queryTokens.filter((token) => evidenceText.toLowerCase().includes(token));

  if (cards.length === 0) {
    limitations.push("No final evidence cards were available.");
  }
  if (input.validatedCitationCount === 0) {
    limitations.push("No backend-validated citations were available.");
  }
  if (input.selectedObjectWasRequested && !input.selectedObjectWasFound) {
    limitations.push("The selected object was not present in the final evidence pack.");
  }

  if (input.intent === "current_truth" && !cards.some((card) => ACCEPTED_TRUTH_TYPES.has(card.sourceType))) {
    limitations.push("No accepted Product Brain, accepted change, or accepted decision evidence was retrieved.");
  }
  if (
    (input.intent === "original_source" || input.intent === "communication_lookup") &&
    !cards.some((card) => SOURCE_TYPES.has(card.sourceType))
  ) {
    limitations.push("No original document or communication source evidence was retrieved.");
  }
  if (input.intent === "dashboard_status" && !cards.some((card) => DASHBOARD_TYPES.has(card.sourceType))) {
    limitations.push("No dashboard snapshot evidence was retrieved.");
  }

  if (topConfidence < 0.25) {
    limitations.push("The strongest retrieved evidence score was weak.");
  }
  if (queryTokens.length >= 2 && supportedQueryTokens.length === 0) {
    limitations.push("Retrieved evidence did not directly match the substantive terms in the question.");
  }

  if (limitations.length > 0) {
    return { confidence: "low", shouldBypassModel: true, limitations };
  }

  if (input.budgetTruncated || sourceTypes.size < 2 || topConfidence < 0.6) {
    return {
      confidence: "medium",
      shouldBypassModel: false,
      limitations: input.budgetTruncated ? ["Some evidence was omitted by the token budget."] : [],
    };
  }

  return { confidence: "high", shouldBypassModel: false, limitations: [] };
}

function tokenizeSupport(input: string) {
  const stopwords = new Set([
    "about",
    "after",
    "again",
    "could",
    "current",
    "does",
    "evidence",
    "find",
    "follow",
    "from",
    "have",
    "how",
    "into",
    "latest",
    "now",
    "project",
    "show",
    "should",
    "source",
    "that",
    "this",
    "truth",
    "what",
    "when",
    "where",
    "which",
    "with"
  ]);
  return Array.from(
    new Set(
      input
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4 && !stopwords.has(token))
    )
  );
}
