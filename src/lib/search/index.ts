import type { AppEnv } from "../../config/env.js";
import { MockSearchProvider } from "./mock-search.js";
import { OpenAiSearchProvider } from "./openai-search.js";
import type { SearchProvider } from "./provider.js";

export type { SearchProvider, SearchResult } from "./provider.js";

export function createSearchProvider(env: AppEnv): SearchProvider {
  if (env.DEEP_RESEARCH_WEB_SEARCH_ENABLED && env.OPENAI_API_KEY) {
    return new OpenAiSearchProvider(env);
  }
  return new MockSearchProvider();
}
