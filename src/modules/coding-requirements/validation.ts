import { AppError } from "../../app/errors.js";
import { validateMermaidSource } from "../diagrams/mermaid-validation.js";

const unsafeTextPattern =
  /<\s*script\b|<\/\s*script\b|<\s*iframe\b|<\s*object\b|<\s*embed\b|<\s*img\b|<\s*svg\b|foreignObject|javascript\s*:|data\s*:|vbscript\s*:|onerror\s*=|onload\s*=|onclick\s*=/i;

export function rejectUnsafeText(value: string, label: string) {
  if (unsafeTextPattern.test(value)) {
    throw new AppError(422, `${label} contains unsafe content`, "unsafe_coding_requirements_content");
  }
  return value;
}

export function validateCodingFlowchart(mermaid: string) {
  const source = validateMermaidSource({ diagramType: "coding_flow", mermaidSource: mermaid });
  const firstLine = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine || !/^flowchart\s+(TD|LR)\b/.test(firstLine)) {
    throw new AppError(422, "Main coding flowchart must start with flowchart TD or flowchart LR", "invalid_coding_flowchart");
  }
  return source;
}

export function safeMermaidLabel(value: string) {
  const stripped = value
    .replace(/[<>{}[\]()`]/g, " ")
    .replace(/["\\]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return (stripped || "Unknown").slice(0, 80);
}
