import OpenAI from "openai";
import type { AppEnv } from "../../config/env.js";
import { createOpenAiClient } from "../ai/openai-client.js";
import type { SearchProvider, SearchResult } from "./provider.js";

/**
 * Web search via OpenAI's hosted `web_search_preview` tool (Responses API). No new
 * vendor. Only focus-derived PUBLIC queries are sent — never internal evidence text.
 * On any runtime error it degrades to an empty result set (caller treats web as
 * unavailable, and the report's marketContext is simply omitted).
 */
export class OpenAiSearchProvider implements SearchProvider {
  readonly kind = "openai" as const;
  private readonly client: OpenAI;

  constructor(private readonly env: AppEnv) {
    this.client = createOpenAiClient({ apiKey: env.OPENAI_API_KEY! });
  }

  // Web search needs a capable model that supports the tool — use the main
  // generation/escalation model, not the fast/nano router.
  private searchModel(): string {
    return this.env.SOCRATES_ESCALATION_MODEL
      ?? this.env.SOCRATES_MODEL
      ?? this.env.OPENAI_GENERATION_MODEL
      ?? "gpt-4o";
  }

  async search(queries: string[], maxResults: number): Promise<SearchResult[]> {
    const model = this.searchModel();
    const collected: SearchResult[] = [];
    for (const query of queries) {
      const trimmed = query.trim();
      if (!trimmed) continue;
      try {
        const response = await this.client.responses.create({
          model,
          tools: [{ type: "web_search_preview" }],
          input:
            `Search the public web for: ${trimmed}\n` +
            `Summarize the most relevant, recent PUBLIC context (industry benchmarks, ` +
            `competitor signals, best practices) and cite your sources. ` +
            `Do not include any private or internal information.`
        });
        collected.push(...extractResults(response));
      } catch {
        // graceful degrade — skip this query, keep any results already gathered
      }
      if (collected.length >= maxResults) break;
    }
    return dedupeByUrl(collected).slice(0, maxResults);
  }
}

/** Pull URL citations (title + url) out of a Responses API result, using output_text as snippet. */
function extractResults(response: unknown): SearchResult[] {
  const out: SearchResult[] = [];
  const root = response as { output_text?: unknown; output?: unknown } | null;
  if (!root) return out;
  const outputText = typeof root.output_text === "string" ? root.output_text : "";
  const snippet = outputText.trim().slice(0, 400) || "Public web source.";
  const output = Array.isArray(root.output) ? root.output : [];
  for (const item of output) {
    const content = (item as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const annotations = (part as { annotations?: unknown })?.annotations;
      if (!Array.isArray(annotations)) continue;
      for (const ann of annotations) {
        const a = ann as { type?: unknown; url?: unknown; title?: unknown };
        if (a.type !== "url_citation") continue;
        const url = typeof a.url === "string" ? a.url : null;
        if (!url) continue;
        out.push({
          title: typeof a.title === "string" && a.title ? a.title : url,
          url,
          snippet,
          publishedAt: null
        });
      }
    }
  }
  return out;
}

function dedupeByUrl(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push(r);
  }
  return out;
}
