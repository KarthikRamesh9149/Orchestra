import OpenAI from "openai";
import { getEnv } from "../src/config/env.js";
import { DEEP_RESEARCH_SYSTEM_PROMPT, buildDeepResearchUserPrompt } from "../src/modules/deep-research/prompts.js";
import { deepResearchLlmSchema } from "../src/modules/deep-research/schemas.js";

async function main() {
  const env = getEnv();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY! });
  const model = env.SOCRATES_ESCALATION_MODEL ?? env.SOCRATES_MODEL ?? "gpt-4o";
  const prompt = buildDeepResearchUserPrompt({
    researchFocus: "overall project health and delivery risks",
    outputFormat: "full_report",
    sources: ["docs", "web"] as any,
    evidenceCards: [],
    webResults: [
      { title: "SaaS reliability benchmarks 2026", url: "https://example.com/a", snippet: "Teams that ship weekly see fewer incidents.", publishedAt: null },
      { title: "Common startup delivery risks", url: "https://example.com/b", snippet: "Spec drift and unreviewed PRs are top risks.", publishedAt: null }
    ]
  });

  console.log("model:", model);
  const sys = /\bjson\b/i.test(DEEP_RESEARCH_SYSTEM_PROMPT)
    ? DEEP_RESEARCH_SYSTEM_PROMPT
    : DEEP_RESEARCH_SYSTEM_PROMPT + "\n\nReturn valid JSON only.";
  let text = "";
  try {
    const resp = await client.chat.completions.create({
      model,
      max_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: prompt }
      ]
    });
    text = resp.choices[0]?.message?.content?.trim() ?? "";
    console.log("=== RAW LLM OUTPUT (first 1200 chars) ===\n" + text.slice(0, 1200));
    console.log("... [len " + text.length + "]");
  } catch (e) {
    console.log("=== OPENAI CALL THREW ===");
    console.log(e instanceof Error ? e.message : e);
    return;
  }

  try {
    const parsed = deepResearchLlmSchema.parse(JSON.parse(text));
    console.log("=== ZOD PARSE: OK ===");
    console.log("findings:", parsed.findings.length, "marketContext:", parsed.marketContext.length, "actions:", parsed.recommendedActions.length);
  } catch (e: any) {
    console.log("=== ZOD/JSON PARSE FAILED — THIS is why generation fell back ===");
    console.log(e?.message ?? e);
    if (e?.issues) console.log("issues:", JSON.stringify(e.issues.slice(0, 8), null, 2));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
