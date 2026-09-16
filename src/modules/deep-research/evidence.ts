import { buildSocratesEvidencePack } from "../socrates/evidence.js";

// Background research must not inherit the interactive chat's 900-character
// prefix. Keep complete normal-sized chunks while retaining the same total
// context/item budgets and the prompt serializer's 4,000-character ceiling.
export function buildDeepResearchEvidencePack(input: Parameters<typeof buildSocratesEvidencePack>[0]) {
  return buildSocratesEvidencePack({
    ...input,
    // Contextual retrieval text may be a generated heading/summary, not the
    // source itself. Research must synthesize the retrieved source bytes.
    candidates: input.candidates.map((candidate) => candidate.content.trim()
      ? { ...candidate, contextualContent: candidate.content }
      : candidate),
    budget: { ...input.budget, maxEvidenceExcerptChars: 4000 }
  });
}
