import { describe, expect, it } from "vitest";
import {
  deepResearchLlmSchema,
  deepResearchResultsSchema,
  normalizeReport,
  startDeepResearchSchema
} from "../src/modules/deep-research/schemas.js";
import { MockSearchProvider } from "../src/lib/search/mock-search.js";
import { createSearchProvider } from "../src/lib/search/index.js";
import type { AppEnv } from "../src/config/env.js";

describe("deep research report schema (LLM-output tolerance)", () => {
  it("accepts the ideal shape the prompt asks for", () => {
    const parsed = deepResearchLlmSchema.parse({
      executiveSummary: "Auth flow is stable but onboarding drop-off is high.",
      findings: [
        { category: "ONBOARDING", severity: "HIGH", title: "Drop-off spike", description: "Step 2 loses 40% of users.", sources: "W1 · E3" }
      ],
      marketContext: [{ title: "SaaS onboarding benchmarks", body: "Below 20% per-step drop-off is strong." }],
      expansionOpportunities: ["Add passwordless login"],
      recommendedActions: [{ priority: "THIS WEEK", action: "Instrument step 2 funnel", source: "W1" }]
    }) as any;
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.marketContext[0].title).toBe("SaaS onboarding benchmarks");
    expect(parsed.recommendedActions[0].priority).toBe("THIS WEEK");
  });

  it("coerces real-world LLM drift: array sources, alternate keys, missing category/title", () => {
    const parsed = deepResearchLlmSchema.parse({
      summary: "Overview via alternate key.",
      findings: [
        // sources as ARRAY, no category, no title, alt severity casing
        { description: "Spec drift is a top delivery risk for the team.", severity: "high", sources: ["W1", "W2"] }
      ],
      // marketContext with description/url instead of title/body
      marketContext: [{ description: "Weekly shipping reduces incidents.", url: "https://x.test" }],
      recommendedActions: [
        // action under alt key, priority phrased loosely, source as array
        { recommendation: "Add PR review gate", priority: "do it now", source: ["W2"] }
      ]
    }) as any;

    expect(parsed.executiveSummary).toContain("alternate key");
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].category).toBe("GENERAL");
    expect(parsed.findings[0].severity).toBe("HIGH");
    expect(parsed.findings[0].title.length).toBeGreaterThan(0);
    expect(parsed.findings[0].sources).toBe("W1 · W2"); // array joined
    expect(parsed.marketContext).toHaveLength(1);
    expect(parsed.marketContext[0].body).toContain("Weekly shipping");
    expect(parsed.marketContext[0].title.length).toBeGreaterThan(0);
    expect(parsed.recommendedActions[0].priority).toBe("IMMEDIATE");
    expect(parsed.recommendedActions[0].action).toBe("Add PR review gate");
    expect(parsed.recommendedActions[0].source).toBe("W2");
  });

  it("drops empty/garbage items instead of throwing", () => {
    const parsed = deepResearchLlmSchema.parse({
      executiveSummary: "",
      findings: [{ severity: "MEDIUM" }, {}, "not-an-object"],
      marketContext: [{ url: "https://x.test" }, {}],
      expansionOpportunities: ["", "  ", "Real opportunity"],
      recommendedActions: [{ priority: "THIS SPRINT" }, {}]
    }) as any;
    expect(parsed.executiveSummary.length).toBeGreaterThan(0); // fallback text
    expect(parsed.findings).toHaveLength(0);
    expect(parsed.marketContext).toHaveLength(0);
    expect(parsed.expansionOpportunities).toEqual(["Real opportunity"]);
    expect(parsed.recommendedActions).toHaveLength(0);
  });

  it("never throws on completely malformed input (defensive fallback)", () => {
    expect(() => deepResearchLlmSchema.parse(null)).not.toThrow();
    expect(() => deepResearchLlmSchema.parse("garbage")).not.toThrow();
    expect(() => deepResearchLlmSchema.parse(42)).not.toThrow();
    const empty = deepResearchLlmSchema.parse(undefined) as any;
    expect(empty.findings).toEqual([]);
    expect(empty.marketContext).toEqual([]);
  });

  it("truncates over-long content to max lengths", () => {
    const huge = "x".repeat(9000);
    const parsed = deepResearchLlmSchema.parse({
      executiveSummary: huge,
      findings: [{ title: huge, description: huge, category: huge, severity: "HIGH" }]
    }) as any;
    expect(parsed.executiveSummary.length).toBeLessThanOrEqual(4000);
    expect(parsed.findings[0].title.length).toBeLessThanOrEqual(240);
    expect(parsed.findings[0].description.length).toBeLessThanOrEqual(2000);
    expect(parsed.findings[0].category.length).toBeLessThanOrEqual(60);
  });

  it("results schema = normalized report + computed stats", () => {
    const report = normalizeReport({
      executiveSummary: "Summary",
      findings: [{ description: "A risk exists here.", severity: "HIGH" }]
    }) as Record<string, unknown>;
    const parsed = deepResearchResultsSchema.parse({
      ...report,
      stats: { totalSources: 3, slackMessages: 1, commits: 0, docs: 2, webSources: 0, duration: "20s" }
    });
    expect(parsed.stats.duration).toBe("20s");
    expect(parsed.findings).toHaveLength(1);
  });
});

describe("startDeepResearch request schema", () => {
  it("normalizes UI output-format labels and defaults sources", () => {
    const parsed = startDeepResearchSchema.parse({
      researchFocus: "auth reliability",
      outputFormat: "Executive Summary"
    });
    expect(parsed.outputFormat).toBe("exec_summary");
    expect(parsed.sources).toEqual(["docs"]);
    expect(parsed.privacyMode).toBe("internal_only");
    expect(parsed.webSearchEnabled).toBe(false);
  });

  it("rejects a too-short focus", () => {
    expect(startDeepResearchSchema.safeParse({ researchFocus: "hi" }).success).toBe(false);
  });

  it("requires public web selection and privacy consent to agree", () => {
    expect(startDeepResearchSchema.safeParse({
      researchFocus: "current market context",
      sources: ["docs", "web"],
      privacyMode: "internal_only",
      webSearchEnabled: true
    }).success).toBe(false);
    expect(startDeepResearchSchema.safeParse({
      researchFocus: "current market context",
      sources: ["docs", "web"],
      privacyMode: "internal_plus_web",
      webSearchEnabled: true
    }).success).toBe(true);
  });
});

describe("search provider", () => {
  it("MockSearchProvider is deterministic and respects maxResults", async () => {
    const provider = new MockSearchProvider();
    const a = await provider.search(["auth best practices", "onboarding drop-off", "extra"], 2);
    const b = await provider.search(["auth best practices", "onboarding drop-off", "extra"], 2);
    expect(a).toHaveLength(2);
    expect(a).toEqual(b); // deterministic
    expect(a[0].url).toContain("example.com");
  });

  it("MockSearchProvider skips blank queries", async () => {
    const provider = new MockSearchProvider();
    const results = await provider.search(["   ", "real query"], 5);
    expect(results).toHaveLength(1);
  });

  it("createSearchProvider falls back to mock without a key / when web disabled", () => {
    const base = { DEEP_RESEARCH_WEB_SEARCH_ENABLED: true, OPENAI_API_KEY: undefined } as unknown as AppEnv;
    expect(createSearchProvider(base).kind).toBe("mock");
    const disabled = { DEEP_RESEARCH_WEB_SEARCH_ENABLED: false, OPENAI_API_KEY: "sk-test" } as unknown as AppEnv;
    expect(createSearchProvider(disabled).kind).toBe("mock");
  });
});
