import { z } from "zod";

export const DEEP_RESEARCH_SOURCE_KEYS = ["github", "slack", "calendar", "docs", "web"] as const;
export type DeepResearchSourceKey = (typeof DEEP_RESEARCH_SOURCE_KEYS)[number];

export const DEEP_RESEARCH_OUTPUT_FORMATS = ["exec_summary", "full_report", "action_items"] as const;
export type DeepResearchOutputFormat = (typeof DEEP_RESEARCH_OUTPUT_FORMATS)[number];
export const DEEP_RESEARCH_PRIVACY_MODES = ["internal_only", "internal_plus_web"] as const;
export type DeepResearchPrivacyMode = (typeof DEEP_RESEARCH_PRIVACY_MODES)[number];

function normalizeOutputFormat(value: unknown): DeepResearchOutputFormat {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "executive summary" || raw === "exec_summary" || raw === "summary") return "exec_summary";
  if (raw === "action items only" || raw === "action_items" || raw === "actions") return "action_items";
  return "full_report";
}

export const startDeepResearchSchema = z.object({
  researchFocus: z.string().trim().min(3).max(500),
  sources: z.array(z.enum(DEEP_RESEARCH_SOURCE_KEYS)).min(1).default(["docs"]),
  outputFormat: z.preprocess(normalizeOutputFormat, z.enum(DEEP_RESEARCH_OUTPUT_FORMATS)).default("full_report"),
  privacyMode: z.enum(DEEP_RESEARCH_PRIVACY_MODES).default("internal_only"),
  webSearchEnabled: z.boolean().default(false)
}).superRefine((value, ctx) => {
  const selectedWeb = value.sources.includes("web");
  if (selectedWeb !== value.webSearchEnabled) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Web source selection must match webSearchEnabled",
      path: ["webSearchEnabled"]
    });
  }
  if (value.webSearchEnabled && value.privacyMode !== "internal_plus_web") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Web search requires internal_plus_web privacy mode",
      path: ["privacyMode"]
    });
  }
});
export type StartDeepResearchInput = z.infer<typeof startDeepResearchSchema>;

export const deepResearchParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const deepResearchRunParamsSchema = z.object({
  projectId: z.string().uuid(),
  runId: z.string().uuid()
});

export const deepResearchExportQuerySchema = z.object({
  format: z.enum(["pdf", "markdown"]).default("pdf")
});

// ── The report shape the frontend renders (LLM produces everything except stats) ──
export const deepResearchFindingSchema = z.object({
  category: z.string().trim().min(1).max(60),
  severity: z.enum(["HIGH", "MEDIUM"]),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(2000),
  sources: z.string().trim().max(400).default("")
});

export const deepResearchActionSchema = z.object({
  priority: z.enum(["IMMEDIATE", "THIS WEEK", "THIS SPRINT"]),
  action: z.string().trim().min(1).max(400),
  source: z.string().trim().max(400).default("")
});

export const deepResearchSourceSchema = z.object({
  provider: z.string().trim().min(1).max(80),
  ref: z.string().trim().regex(/^[EW]\d+$/).optional(),
  label: z.string().trim().min(1).max(240),
  kind: z.enum(["internal", "web"]),
  href: z.string().trim().min(1).max(2000).refine((value) => {
    if (value.startsWith("/")) return !value.startsWith("//");
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "Source href must be an internal path or HTTP(S) URL")
});
export type DeepResearchSource = z.infer<typeof deepResearchSourceSchema>;

// Base report shape (post-normalization). LLM output is coerced into this by
// normalizeReport before validation, so real-world LLM key/type variance
// (sources as array, "description" vs "body", missing category/title, etc.) still parses.
export const deepResearchReportShape = z.object({
  executiveSummary: z.string().trim().min(1).max(4000),
  findings: z.array(deepResearchFindingSchema).max(12).default([]),
  marketContext: z.array(z.object({ title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(1200) })).max(8).default([]),
  expansionOpportunities: z.array(z.string().trim().min(1).max(600)).max(8).default([]),
  recommendedActions: z.array(deepResearchActionSchema).max(12).default([])
});
export type DeepResearchLlmOutput = z.infer<typeof deepResearchReportShape>;

// ── LLM-output normalization (tolerant of key/type drift) ──
function coerceStr(v: unknown, max: number): string {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).filter(Boolean).join(" · ").slice(0, max);
  if (v == null) return "";
  return String(v).trim().slice(0, max);
}
function firstSentence(s: string, max: number): string {
  const t = (s ?? "").trim();
  const m = t.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : t).trim().slice(0, max);
}
function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== "") return v;
  }
  return undefined;
}
function normSeverity(v: unknown): "HIGH" | "MEDIUM" {
  return String(v ?? "").toUpperCase().includes("HIGH") ? "HIGH" : "MEDIUM";
}
function normPriority(v: unknown): "IMMEDIATE" | "THIS WEEK" | "THIS SPRINT" {
  const s = String(v ?? "").toUpperCase();
  if (/IMMEDIATE|URGENT|\bNOW\b|CRITICAL/.test(s)) return "IMMEDIATE";
  if (/SPRINT/.test(s)) return "THIS SPRINT";
  return "THIS WEEK";
}
export function normalizeReport(raw: unknown): unknown {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const arr = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter((x) => x && typeof x === "object") as Record<string, unknown>[] : [];
  return {
    executiveSummary: coerceStr(pick(o, ["executiveSummary", "summary", "exec_summary", "overview"]), 4000) || "No summary available.",
    findings: arr(o.findings).map((f) => {
      const description = coerceStr(pick(f, ["description", "detail", "body", "text"]), 2000);
      const title = coerceStr(pick(f, ["title", "name", "headline"]), 240) || firstSentence(description, 240);
      return {
        category: (coerceStr(pick(f, ["category", "type", "area", "kind"]), 60) || "GENERAL").toUpperCase(),
        severity: normSeverity(f.severity),
        title: title || "Finding",
        description: description || title || "—",
        sources: coerceStr(pick(f, ["sources", "source", "evidence", "refs", "citations"]), 400)
      };
    }).filter((f) => f.title !== "Finding" || f.description !== "—").slice(0, 12),
    marketContext: arr(o.marketContext).map((m) => {
      const body = coerceStr(pick(m, ["body", "description", "summary", "text", "content", "insight"]), 1200);
      const title = coerceStr(pick(m, ["title", "topic", "name", "heading"]), 200) || firstSentence(body, 120);
      return { title: title || "Web context", body };
    }).filter((m) => m.body).slice(0, 8),
    expansionOpportunities: (Array.isArray(o.expansionOpportunities) ? o.expansionOpportunities : [])
      .map((e) => (typeof e === "string" ? e : coerceStr(pick((e ?? {}) as Record<string, unknown>, ["text", "opportunity", "description", "title"]), 600)))
      .map((s) => coerceStr(s, 600)).filter(Boolean).slice(0, 8),
    recommendedActions: arr(o.recommendedActions).map((a) => ({
      priority: normPriority(a.priority),
      action: coerceStr(pick(a, ["action", "recommendation", "text", "task", "title"]), 400),
      source: coerceStr(pick(a, ["source", "sources", "evidence", "refs"]), 400)
    })).filter((a) => a.action).slice(0, 12)
  };
}

/** Schema used for LLM generation: normalizes raw output, then validates. */
export const deepResearchLlmSchema = z.preprocess(normalizeReport, deepResearchReportShape);

export const deepResearchStatsSchema = z.object({
  totalSources: z.number().int().nonnegative(),
  slackMessages: z.number().int().nonnegative(),
  commits: z.number().int().nonnegative(),
  docs: z.number().int().nonnegative(),
  webSources: z.number().int().nonnegative(),
  duration: z.string()
});
export type DeepResearchStats = z.infer<typeof deepResearchStatsSchema>;

/** Schema for stored/returned results (already-normalized report + computed stats). */
export const deepResearchResultsSchema = deepResearchReportShape.extend({
  stats: deepResearchStatsSchema,
  sources: z.array(deepResearchSourceSchema).max(40).default([])
});
export type DeepResearchResults = z.infer<typeof deepResearchResultsSchema>;
