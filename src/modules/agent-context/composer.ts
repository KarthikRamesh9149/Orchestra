import type { AgentContextPackBudgetPreset, AgentContextPackTaskType } from "@prisma/client";
import { redactAgentContextText } from "./citations.js";
import { isCurrentTruthEvidence } from "./source-selection.js";
import type { AgentContextEvidenceCandidate, AgentContextPackSections } from "./types.js";

function compact(text: string | null | undefined, fallback = "Not recorded.") {
  const value = redactAgentContextText((text ?? "").replace(/\s+/g, " ").trim());
  return value || fallback;
}

export function composeAgentContextPackSections(input: {
  title?: string;
  taskPrompt: string;
  taskType: AgentContextPackTaskType;
  candidates: AgentContextEvidenceCandidate[];
  limitations: string[];
  warnings: string[];
  budgetPreset: AgentContextPackBudgetPreset;
}): AgentContextPackSections {
  const currentTruth = input.candidates
    .filter((candidate) => isCurrentTruthEvidence(candidate) && !candidate.isPending)
    .slice(0, input.budgetPreset === "compact" ? 4 : 8)
    .map((candidate) => `${candidate.title}: ${compact(candidate.excerpt ?? candidate.summary, candidate.title)}`);

  const evidence = input.candidates.map((candidate) => ({
    sourceType: candidate.sourceType,
    sourceRefType: candidate.sourceRefType,
    sourceRefId: candidate.sourceRefId,
    title: candidate.title,
    excerpt: compact(candidate.excerpt ?? candidate.summary),
    whyItMatters: compact(candidate.whyItMatters, "Selected because it is relevant to the requested task."),
    evidenceStatus: candidate.evidenceStatus,
    relationship: candidate.relationship,
    citation: candidate.citation ?? null,
    openTarget: candidate.openTarget ?? null,
    confidence: candidate.confidence ?? null
  }));

  return {
    mission: {
      title: "Mission",
      items: [compact(input.taskPrompt)]
    },
    currentAcceptedTruth: {
      title: "Current accepted truth",
      items: currentTruth.length ? currentTruth : ["No accepted current truth was found for this task."]
    },
    relevantSourceEvidence: {
      title: "Relevant source evidence",
      items: evidence
    },
    implementationConstraints: {
      title: "Implementation constraints",
      items: [
        "Do not rewrite original uploaded or generated PRD/SRS bytes.",
        "Do not treat pending suggestions, raw insights, or unreviewed communication as current truth.",
        "Do not bypass the accepted-change flow or mutate Product Brain through this pack.",
        "Preserve citations, open targets, auth scoping, and client-safe filtering.",
        "Do not expose disabled full-product providers in MVP mode.",
        "Do not claim repository implementation state unless code evidence or an agent run has been recorded."
      ]
    },
    relevantImplementationSurfaces: {
      title: "Relevant implementation surfaces",
      items: inferSurfaces(input.taskType, input.candidates)
    },
    openQuestions: {
      title: "Open questions",
      items: inferOpenQuestions(input.candidates, input.warnings)
    },
    acceptanceChecklist: {
      title: "Acceptance checklist",
      items: [
        "Product Brain current truth is preserved.",
        "Original source evidence remains immutable and inspectable.",
        "Pending or rejected proposals are not represented as accepted truth.",
        "Citations and open targets resolve to project-scoped evidence.",
        "Client-safe and MVP provider visibility rules are preserved.",
        "Tests, evals, smoke checks, and docs are updated where the task changes behavior.",
        "No secrets, provider credentials, or signed URLs are included."
      ]
    },
    limitations: {
      title: "Limitations",
      items: input.limitations
    }
  };
}

export function renderAgentContextBodyMarkdown(sections: AgentContextPackSections) {
  const evidence = sections.relevantSourceEvidence.items
    .map((item, index) => {
      const ref = `${item.sourceRefType}:${item.sourceRefId}`;
      return `${index + 1}. ${item.title} (${item.evidenceStatus}, ${ref})\n   - ${item.excerpt}\n   - Why it matters: ${item.whyItMatters}`;
    })
    .join("\n");
  return [
    `# ${sections.mission.title}`,
    sections.mission.items.map((item) => `- ${item}`).join("\n"),
    `## ${sections.currentAcceptedTruth.title}`,
    sections.currentAcceptedTruth.items.map((item) => `- ${item}`).join("\n"),
    `## ${sections.relevantSourceEvidence.title}`,
    evidence || "- No evidence selected.",
    `## ${sections.implementationConstraints.title}`,
    sections.implementationConstraints.items.map((item) => `- ${item}`).join("\n"),
    `## ${sections.relevantImplementationSurfaces.title}`,
    sections.relevantImplementationSurfaces.items.map((item) => `- ${item}`).join("\n"),
    `## ${sections.openQuestions.title}`,
    sections.openQuestions.items.map((item) => `- ${item}`).join("\n"),
    `## ${sections.acceptanceChecklist.title}`,
    sections.acceptanceChecklist.items.map((item) => `- [ ] ${item}`).join("\n"),
    `## ${sections.limitations.title}`,
    sections.limitations.items.map((item) => `- ${item}`).join("\n")
  ].join("\n\n");
}

function inferSurfaces(taskType: AgentContextPackTaskType, candidates: AgentContextEvidenceCandidate[]) {
  const surfaces = new Set<string>();
  if (taskType === "implementation" || taskType === "debugging") surfaces.add("Backend/API contract and tests");
  if (taskType === "test_writing" || taskType === "review") surfaces.add("Unit, integration, eval, and smoke coverage");
  if (candidates.some((candidate) => candidate.sourceType.includes("document"))) surfaces.add("Document viewer and source provenance");
  if (candidates.some((candidate) => candidate.sourceType.includes("live_doc"))) surfaces.add("Live Doc current section");
  if (candidates.some((candidate) => candidate.sourceType.includes("coding"))) surfaces.add("Coding requirements and flowchart");
  if (candidates.some((candidate) => candidate.sourceType.includes("diagram"))) surfaces.add("Mermaid diagram surfaces");
  if (candidates.some((candidate) => candidate.sourceType.includes("communication"))) surfaces.add("Communication evidence and review flow");
  if (candidates.some((candidate) => candidate.sourceType.includes("responsibility"))) surfaces.add("Team responsibility/task context");
  surfaces.add("Docs and frontend handoff contract");
  return Array.from(surfaces);
}

function inferOpenQuestions(candidates: AgentContextEvidenceCandidate[], warnings: string[]) {
  const questions = [...warnings];
  if (candidates.length === 0) questions.push("No evidence was selected; ask the project owner for source material before implementation.");
  if (candidates.some((candidate) => candidate.evidenceStatus === "pending_suggestion")) {
    questions.push("Some related suggestions are pending review and must not be implemented as current truth until accepted.");
  }
  return questions.length ? questions : ["No unresolved questions were detected from available evidence."];
}
