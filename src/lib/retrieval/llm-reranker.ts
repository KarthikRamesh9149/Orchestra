import { z } from "zod";
import type { GenerationProvider } from "../ai/provider.js";
import type { RetrievalCandidate } from "./types.js";

const llmRerankSchema = z.object({
  ranked: z.array(
    z.object({
      id: z.string(),
      score: z.number().min(0).max(1),
      reason: z.string().optional()
    })
  )
});

export async function llmRerank(input: {
  generationProvider: GenerationProvider;
  query: string;
  candidates: RetrievalCandidate[];
  topK: number;
  model?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): Promise<RetrievalCandidate[]> {
  const cards = input.candidates.map((candidate, index) => ({
    id: candidate.id,
    index,
    sourceType: candidate.sourceType,
    title: candidate.label,
    excerpt: (candidate.contextualContent ?? candidate.content).slice(0, 700),
    score: candidate.finalScore
  }));

  const result = await input.generationProvider.generateObject({
    schema: llmRerankSchema,
    task: "rerank",
    model: input.model,
    maxOutputTokens: input.maxOutputTokens ?? 700,
    timeoutMs: input.timeoutMs,
    systemPrompt:
      "Rank only the provided evidence cards for the user query. Do not invent evidence. Return compact JSON.",
    prompt: JSON.stringify({ query: input.query, cards }, null, 2),
    fallback: () => ({
      ranked: input.candidates
        .slice(0, input.topK)
        .map((candidate) => ({ id: candidate.id, score: candidate.finalScore, reason: "deterministic_fallback" }))
    })
  });

  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const ranked: RetrievalCandidate[] = [];
  for (const item of result.ranked) {
    const candidate = byId.get(item.id);
    if (!candidate) continue;
    ranked.push({
        ...candidate,
        finalScore: item.score,
        retrievalStage: "reranked" as const,
        whySelected: `${candidate.whySelected ?? "candidate"}; llm=${item.reason ?? item.score.toFixed(3)}`
    });
  }
  return ranked.slice(0, input.topK);
}
