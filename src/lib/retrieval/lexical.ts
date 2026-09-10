export function tokenizeQuery(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

const WEBSEARCH_SCAFFOLD_TERMS = new Set([
  "about",
  "and",
  "after",
  "before",
  "communication",
  "communications",
  "current",
  "currently",
  "did",
  "docs",
  "document",
  "documents",
  "does",
  "evidence",
  "find",
  "for",
  "from",
  "give",
  "github",
  "message",
  "messages",
  "project",
  "repository",
  "repo",
  "said",
  "say",
  "says",
  "show",
  "shows",
  "slack",
  "source",
  "sources",
  "summarize",
  "summary",
  "the",
  "thread",
  "threads",
  "tell",
  "use",
  "using",
  "what",
  "when",
  "where",
  "which",
  "with"
]);

/**
 * Builds a bounded, recall-preserving query for PostgreSQL
 * `websearch_to_tsquery`. Provider/source words are enforced by SQL filters,
 * so requiring those words in indexed content would incorrectly lose matches.
 * The normal lexical ranker still orders and filters the retrieved candidates.
 */
export function buildRecallPreservingWebsearchQuery(value: string, maxTerms = 12) {
  const terms = Array.from(
    new Set(tokenizeQuery(value).filter((term) => !WEBSEARCH_SCAFFOLD_TERMS.has(term)))
  ).slice(0, Math.max(1, maxTerms));
  return terms.join(" OR ");
}

export function exactPhraseScore(query: string, content: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length < 4) {
    return 0;
  }

  return content.toLowerCase().includes(normalizedQuery) ? 1 : 0;
}

export function lexicalScore(query: string, content: string) {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return 0;
  }

  const lower = content.toLowerCase();
  const matched = tokens.filter((token) => lower.includes(token)).length;
  const tokenScore = matched / tokens.length;
  const phraseBoost = exactPhraseScore(query, content) * 0.25;

  return Math.min(1, tokenScore + phraseBoost);
}
