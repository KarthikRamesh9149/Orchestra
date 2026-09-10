export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string | null;
}

export interface SearchProvider {
  readonly kind: "openai" | "mock";
  /**
   * Run one or more PUBLIC web queries. Inputs must be derived only from the
   * research focus / public sub-questions — never internal evidence text — so
   * no internal data is sent to an external search tool.
   */
  search(queries: string[], maxResults: number): Promise<SearchResult[]>;
}
