import { z } from "zod";
import type { EvidenceCard } from "../../lib/retrieval/evidence-pack.js";
import { answerSchema, openTargetRefSchema, type AnswerSchema, type CitationSchema, type OpenTargetRef } from "./schemas.js";

const SAFE_DEGRADED_PROMPTS = [
  "Ask a narrower question about this section",
  "Show the closest source evidence",
  "List accepted changes related to this area",
];

function safeCitationType(type: string): CitationSchema["type"] | null {
  const parsed = z
    .enum([
      "live_doc_section",
      "document_section",
      "document_chunk",
      "message",
      "brain_node",
      "product_brain",
      "change_proposal",
      "decision_record",
      "dashboard_snapshot",
      "project_responsibility",
      "project_context",
      "project_diagram",
      "coding_requirements",
    ])
    .safeParse(type);
  return parsed.success ? parsed.data : null;
}

function citationsFromEvidence(evidenceCards: EvidenceCard[], limit = 3): CitationSchema[] {
  const citations: CitationSchema[] = [];
  const seen = new Set<string>();
  for (const card of evidenceCards) {
    if (!card.citationRef?.id) continue;
    const type = safeCitationType(card.citationRef.type);
    if (!type) continue;
    const key = `${type}:${card.citationRef.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      type,
      refId: card.citationRef.id,
      label: card.citationRef.label ?? card.title,
      confidence: Math.max(0, Math.min(1, card.confidence)),
    });
    if (citations.length >= limit) break;
  }
  return citations;
}

function openTargetsFromEvidence(evidenceCards: EvidenceCard[], citations: CitationSchema[], limit = 3): OpenTargetRef[] {
  const citationIds = new Set(citations.map((citation) => citation.refId));
  const targets: OpenTargetRef[] = [];
  for (const card of evidenceCards) {
    if (!card.openTarget || !card.citationRef || !citationIds.has(card.citationRef.id)) continue;
    const parsed = openTargetRefSchema.safeParse(card.openTarget);
    if (!parsed.success) continue;
    targets.push(parsed.data);
    if (targets.length >= limit) break;
  }
  return targets;
}

export function buildSafeDegradedAnswer(evidenceCards: EvidenceCard[] = []): AnswerSchema {
  const citations = citationsFromEvidence(evidenceCards);
  return {
    answer_md:
      "I could not produce a fully valid structured answer. I found limited project evidence, so I am returning the safest available summary.",
    citations,
    open_targets: openTargetsFromEvidence(evidenceCards, citations),
    suggested_prompts: SAFE_DEGRADED_PROMPTS,
    suggested_actions: [],
    confidence: "low",
    limitations: [
      "The generated answer failed schema validation.",
      "Only backend-validated evidence is included.",
    ],
  };
}

export function buildLowEvidenceAnswer(evidenceCards: EvidenceCard[] = [], limitations: string[] = []): AnswerSchema {
  const citations = citationsFromEvidence(evidenceCards);
  const closest = citations.length > 0
    ? " The closest validated evidence is included for inspection."
    : "";
  return {
    answer_md:
      `I could not find enough project evidence to answer this confidently.${closest}`,
    citations,
    open_targets: openTargetsFromEvidence(evidenceCards, citations),
    suggested_prompts: [
      "Show the closest source evidence",
      "Ask about this specific document section",
      "List accepted changes for this module",
    ],
    suggested_actions: [],
    confidence: "low",
    limitations: limitations.length > 0
      ? limitations
      : ["The retrieved evidence may be adjacent rather than conclusive."],
  };
}

export interface FinalizeSocratesAnswerInput {
  rawText: string;
  evidenceCards: EvidenceCard[];
  repair?: (input: { malformedText: string; validationErrors: string[] }) => Promise<unknown>;
}

export interface FinalizeSocratesAnswerResult {
  answer: AnswerSchema;
  repaired: boolean;
  degraded: boolean;
  validationErrors: string[];
}

function parseUnknownAnswer(value: unknown) {
  const parsed = answerSchema.safeParse(value);
  if (parsed.success) {
    return { answer: parsed.data, errors: [] as string[] };
  }
  return {
    answer: null,
    errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`),
  };
}

function parseRawJson(rawText: string) {
  try {
    return JSON.parse(rawText.trim());
  } catch (error) {
    return error;
  }
}

export async function finalizeSocratesAnswer(
  input: FinalizeSocratesAnswerInput
): Promise<FinalizeSocratesAnswerResult> {
  const firstValue = parseRawJson(input.rawText);
  const first = firstValue instanceof Error
    ? { answer: null, errors: [`invalid_json: ${firstValue.message}`] }
    : parseUnknownAnswer(firstValue);
  if (first.answer) {
    return { answer: first.answer, repaired: false, degraded: false, validationErrors: [] };
  }

  if (input.repair) {
    try {
      const repairedValue = await input.repair({
        malformedText: input.rawText.slice(0, 2000),
        validationErrors: first.errors,
      });
      const repaired = parseUnknownAnswer(repairedValue);
      if (repaired.answer) {
        return {
          answer: repaired.answer,
          repaired: true,
          degraded: false,
          validationErrors: first.errors,
        };
      }
      return {
        answer: buildSafeDegradedAnswer(input.evidenceCards),
        repaired: true,
        degraded: true,
        validationErrors: [...first.errors, ...repaired.errors],
      };
    } catch (error) {
      return {
        answer: buildSafeDegradedAnswer(input.evidenceCards),
        repaired: true,
        degraded: true,
        validationErrors: [...first.errors, error instanceof Error ? error.message : "repair_failed"],
      };
    }
  }

  return {
    answer: buildSafeDegradedAnswer(input.evidenceCards),
    repaired: false,
    degraded: true,
    validationErrors: first.errors,
  };
}
