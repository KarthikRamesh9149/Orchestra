import { AppError } from "../../app/errors.js";

export type DocumentGenerationKind = "prd" | "srs";
export type DocumentGenerationTemplateId = "basic_mvp" | "basic_srs";

export type DocumentGenerationTemplate = {
  id: DocumentGenerationTemplateId;
  kind: DocumentGenerationKind;
  label: string;
  description: string;
  sections: string[];
  codingHintsSection: string;
};

export const DOCUMENT_GENERATION_TEMPLATES: DocumentGenerationTemplate[] = [
  {
    id: "basic_mvp",
    kind: "prd",
    label: "Basic MVP PRD",
    description: "Plain-language MVP PRD for early product scoping.",
    sections: [
      "Title",
      "Project Summary",
      "Problem",
      "Target Users / Personas",
      "Goals",
      "Non-Goals",
      "MVP Scope",
      "Core User Flows",
      "Functional Requirements",
      "Data / Content Requirements",
      "Integrations",
      "Assumptions",
      "Open Questions",
      "Risks / Constraints"
    ],
    codingHintsSection: "Coding Hints"
  },
  {
    id: "basic_srs",
    kind: "srs",
    label: "Basic SRS",
    description: "Simple software requirements specification.",
    sections: [
      "Title",
      "Purpose",
      "Scope",
      "System Overview",
      "User Roles / Actors",
      "Functional Requirements",
      "Non-Functional Requirements",
      "Data Requirements",
      "External Interfaces / Integrations",
      "User Flows",
      "Assumptions",
      "Open Questions",
      "Constraints"
    ],
    codingHintsSection: "Implementation Notes"
  }
];

export function getDocumentGenerationTemplate(id: DocumentGenerationTemplateId, kind: DocumentGenerationKind) {
  const template = DOCUMENT_GENERATION_TEMPLATES.find((candidate) => candidate.id === id && candidate.kind === kind);
  if (!template) {
    throw new AppError(422, "Document generation template does not match requested kind", "invalid_generation_template");
  }
  return template;
}

export function sanitizeGeneratedMarkdown(markdown: string) {
  return markdown
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/```mermaid[\s\S]*?```/gi, "")
    .trim();
}

export function sanitizeGeneratedTitle(title: string, fallback = "Generated Document") {
  const normalize = (value: string) =>
    sanitizeGeneratedMarkdown(value)
      .replace(/[\u0000-\u001F\u007F]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
  const sanitized = normalize(title);
  if (sanitized.length >= 2) return sanitized;
  const sanitizedFallback = normalize(fallback);
  return sanitizedFallback.length >= 2 ? sanitizedFallback : "Generated Document";
}

export function validateGeneratedPrdSrsMarkdown(
  kind: DocumentGenerationKind,
  templateId: DocumentGenerationTemplateId,
  markdown: string,
  includeCodingHints: boolean
) {
  const template = getDocumentGenerationTemplate(templateId, kind);
  const sanitized = sanitizeGeneratedMarkdown(markdown);
  if (sanitized.length < 100) {
    throw new AppError(502, "Generated document was too short to persist safely", "generated_document_invalid");
  }

  const missingSections = requiredSections(template, includeCodingHints).filter(
    (section) => !hasMarkdownHeading(sanitized, section)
  );
  if (missingSections.length > 0) {
    throw new AppError(502, "Generated document missed required sections", "generated_document_invalid", {
      missingSections
    });
  }

  if (/<script\b|<\/?[a-z][^>]*>|```mermaid/i.test(sanitized)) {
    throw new AppError(502, "Generated document contained unsupported markup", "generated_document_invalid");
  }

  return sanitized;
}

export function buildFallbackGeneratedMarkdown(input: {
  kind: DocumentGenerationKind;
  templateId: DocumentGenerationTemplateId;
  title: string;
  prompt: string;
  includeCodingHints: boolean;
  contextSummary: string[];
}) {
  const template = getDocumentGenerationTemplate(input.templateId, input.kind);
  const contextNote = input.contextSummary.length > 0
    ? `Based on provided project context: ${input.contextSummary.join("; ")}.`
    : "No additional project context was provided. This draft separates assumptions from facts.";
  const lines: string[] = [];

  for (const section of template.sections) {
    lines.push(`## ${section}`);
    lines.push(sectionContent(section, input.title, input.prompt, contextNote));
    lines.push("");
  }

  if (input.includeCodingHints) {
    lines.push(`## ${template.codingHintsSection}`);
    lines.push("- Keep implementation choices lightweight until requirements are validated.");
    lines.push("- Derive technical decisions from accepted project evidence and future team review.");
    lines.push("");
  }

  return lines.join("\n").trim();
}

function requiredSections(template: DocumentGenerationTemplate, includeCodingHints: boolean) {
  return includeCodingHints ? [...template.sections, template.codingHintsSection] : template.sections;
}

function hasMarkdownHeading(markdown: string, section: string) {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^#{1,3}\\s+${escaped}\\s*$`, "im").test(markdown);
}

function sectionContent(section: string, title: string, prompt: string, contextNote: string) {
  switch (section) {
    case "Title":
      return title;
    case "Assumptions":
      return `- This draft assumes the requested product direction is: ${prompt}.\n- ${contextNote}`;
    case "Open Questions":
      return "- Which constraints, integrations, user roles, and acceptance criteria should be confirmed before build?";
    case "Risks / Constraints":
    case "Constraints":
      return "- Requirements are low-context and should be validated with stakeholders before implementation.";
    case "Functional Requirements":
      return "- Capture the core user journey in a small set of testable requirements.\n- Keep non-essential workflow automation out of MVP scope.";
    default:
      return `${contextNote}\n\nDraft focus: ${prompt}`;
  }
}
