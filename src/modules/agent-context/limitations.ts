import type { AgentContextEvidenceCandidate } from "./types.js";

export function buildAgentContextLimitations(input: {
  hasProductBrain: boolean;
  hasLiveDoc: boolean;
  hasDocuments: boolean;
  hasCodingRequirements: boolean;
  hasDiagrams: boolean;
  hasResponsibilities: boolean;
  hasManualContext: boolean;
  hasCommunicationEvidence: boolean;
  excludedProviders: string[];
  invalidReferenceWarnings: string[];
  candidates: AgentContextEvidenceCandidate[];
}) {
  const limitations: string[] = [];
  if (!input.hasProductBrain) limitations.push("No accepted Product Brain version was available for this pack.");
  if (!input.hasLiveDoc) limitations.push("No accepted Live Doc artifact was available; source document evidence was used where possible.");
  if (!input.hasDocuments) limitations.push("No parsed document sections were available as original source evidence.");
  if (!input.hasCodingRequirements) limitations.push("No current coding requirements artifact was available.");
  if (!input.hasDiagrams) limitations.push("No active Mermaid diagrams or flowcharts were available.");
  if (!input.hasResponsibilities) limitations.push("No active responsibility or task context was available.");
  if (!input.hasManualContext) limitations.push("No manual project context entries were available.");
  if (!input.hasCommunicationEvidence) limitations.push("No allowed communication or transcript evidence was available.");
  if (input.excludedProviders.length > 0) {
    limitations.push(
      `Communication evidence from disabled providers was excluded: ${Array.from(new Set(input.excludedProviders)).join(", ")}.`
    );
  }
  if (input.candidates.some((candidate) => candidate.isPending)) {
    limitations.push("Pending suggestions were included only as review pressure, not current accepted truth.");
  }
  limitations.push("This context pack is a derived artifact; it does not prove repository implementation state or mutate Product Brain truth.");
  return Array.from(new Set([...limitations, ...input.invalidReferenceWarnings]));
}
