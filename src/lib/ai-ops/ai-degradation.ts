import type { AnswerSchema, CitationSchema, OpenTargetRef } from "../../modules/socrates/schemas.js";
import type { AiDegradationReason } from "./ai-ops-schemas.js";

const DEFAULT_PROMPTS = [
  "Show the closest source evidence",
  "Ask a narrower question about this section",
  "List accepted changes related to this area"
];

export function buildEvidenceOnlyDegradedAnswer(input: {
  reason: AiDegradationReason;
  citations?: CitationSchema[];
  openTargets?: OpenTargetRef[];
  limitations?: string[];
}): AnswerSchema {
  return {
    answer_md:
      "The generated answer is unavailable or limited right now. I am returning only backend-validated project evidence and safe navigation targets.",
    citations: input.citations ?? [],
    open_targets: input.openTargets ?? [],
    suggested_prompts: DEFAULT_PROMPTS,
    suggested_actions: [],
    confidence: "low",
    limitations: [
      `Degraded mode reason: ${input.reason}.`,
      "No unsupported model-memory claims were included.",
      ...(input.limitations ?? [])
    ]
  };
}
