import type { SearchProvider, SearchResult } from "./provider.js";

/**
 * Deterministic web-search stub for dev/tests and for when no real provider is
 * configured. Results are clearly labelled so they are never mistaken for live data.
 */
export class MockSearchProvider implements SearchProvider {
  readonly kind = "mock" as const;

  async search(queries: string[], maxResults: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    for (const query of queries) {
      const trimmed = query.trim();
      if (!trimmed) continue;
      results.push({
        title: `Public context — ${trimmed.slice(0, 80)}`,
        url: `https://example.com/research?q=${encodeURIComponent(trimmed)}`,
        snippet: `Representative public/industry context for "${trimmed}". (Mock web search — set DEEP_RESEARCH_WEB_SEARCH_ENABLED=true with an OpenAI key for live results.)`,
        publishedAt: null
      });
      if (results.length >= maxResults) break;
    }
    return results.slice(0, maxResults);
  }
}
