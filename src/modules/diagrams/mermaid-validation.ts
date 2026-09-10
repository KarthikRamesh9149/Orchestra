import type { ProjectDiagramType } from "@prisma/client";
import { AppError } from "../../app/errors.js";

export const maxMermaidSourceLength = 20_000;

const flowchartTypes = new Set<ProjectDiagramType>([
  "flowchart",
  "coding_flow",
  "requirement_flow",
  "system_process",
  "module_dependency",
  "architecture"
]);

const unsafeMermaidPatterns: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /<\s*script\b/i, label: "script tag" },
  { pattern: /<\/\s*script\b/i, label: "script tag" },
  { pattern: /<\s*iframe\b/i, label: "iframe tag" },
  { pattern: /<\/\s*iframe\b/i, label: "iframe tag" },
  { pattern: /<\s*object\b/i, label: "object tag" },
  { pattern: /<\s*embed\b/i, label: "embed tag" },
  { pattern: /<\s*img\b/i, label: "image tag" },
  { pattern: /<\s*svg\b/i, label: "svg tag" },
  { pattern: /foreignObject/i, label: "foreignObject" },
  { pattern: /javascript\s*:/i, label: "javascript URL" },
  { pattern: /data\s*:/i, label: "data URL" },
  { pattern: /vbscript\s*:/i, label: "vbscript URL" },
  { pattern: /\bonerror\s*=/i, label: "event handler" },
  { pattern: /\bonload\s*=/i, label: "event handler" },
  { pattern: /\bonclick\s*=/i, label: "event handler" },
  { pattern: /\bstyle\s*=/i, label: "inline style" },
  { pattern: /\bsrc\s*=/i, label: "src attribute" },
  { pattern: /\bhref\s*=/i, label: "href attribute" },
  { pattern: /^\s*click\s+\S+/im, label: "Mermaid click directive" },
  { pattern: /%%\s*\{\s*init/i, label: "Mermaid init directive" },
  { pattern: /%%\s*\{\s*config/i, label: "Mermaid config directive" }
];

export function validateMermaidSource(input: { diagramType: ProjectDiagramType; mermaidSource: string }) {
  const source = input.mermaidSource.trim();
  if (!source) {
    throw new AppError(422, "Mermaid source is required", "invalid_mermaid_source");
  }
  if (source.length > maxMermaidSourceLength) {
    throw new AppError(422, "Mermaid source exceeds maximum length", "invalid_mermaid_source");
  }
  for (const unsafe of unsafeMermaidPatterns) {
    if (unsafe.pattern.test(source)) {
      throw new AppError(422, `Mermaid source contains unsafe ${unsafe.label}`, "unsafe_mermaid_source");
    }
  }

  const firstMeaningfulLine = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("%%"));

  if (!firstMeaningfulLine) {
    throw new AppError(422, "Mermaid source is required", "invalid_mermaid_source");
  }

  if (input.diagramType === "sequence") {
    if (!/^sequenceDiagram\b/.test(firstMeaningfulLine)) {
      throw new AppError(422, "Sequence diagrams must start with sequenceDiagram", "mermaid_type_mismatch");
    }
    return source;
  }

  if (flowchartTypes.has(input.diagramType)) {
    if (!/^(flowchart|graph)\b/.test(firstMeaningfulLine)) {
      throw new AppError(422, "Flow-style diagrams must start with flowchart or graph", "mermaid_type_mismatch");
    }
    return source;
  }

  throw new AppError(422, "Unsupported diagram type", "invalid_diagram_type");
}

export function normalizeGeneratedMermaidSource(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:mermaid)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}
