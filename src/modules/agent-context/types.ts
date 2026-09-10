import type {
  AgentContextEvidenceStatus,
  AgentContextPackBudgetPreset,
  AgentContextPackSourceMode,
  AgentContextPackTaskType,
  AgentContextPackVisibility
} from "@prisma/client";

export type AgentContextSeedReference = {
  type: string;
  id: string;
  label?: string;
};

export type AgentContextOpenTarget = {
  targetType: string;
  targetRef: Record<string, unknown>;
};

export type AgentContextCitation = {
  type: string;
  id: string;
  label?: string;
};

export type AgentContextEvidenceCandidate = {
  id: string;
  sourceType: string;
  sourceRefType: string;
  sourceRefId: string;
  relationship: string;
  title: string;
  excerpt?: string | null;
  summary?: string | null;
  whyItMatters?: string | null;
  citation?: AgentContextCitation | null;
  openTarget?: AgentContextOpenTarget | null;
  evidenceStatus: AgentContextEvidenceStatus | "pending_suggestion";
  confidence?: number | null;
  sortOrder: number;
  provider?: string | null;
  sourceDomain?: string | null;
  score: number;
  isCurrentTruth: boolean;
  isPending: boolean;
  visibility?: AgentContextPackVisibility;
  artifactVersionId?: string | null;
  documentVersionId?: string | null;
};

export type AgentContextPackSections = {
  mission: { title: "Mission"; items: string[] };
  currentAcceptedTruth: { title: "Current accepted truth"; items: string[] };
  relevantSourceEvidence: { title: "Relevant source evidence"; items: Array<Record<string, unknown>> };
  implementationConstraints: { title: "Implementation constraints"; items: string[] };
  relevantImplementationSurfaces: { title: "Relevant implementation surfaces"; items: string[] };
  openQuestions: { title: "Open questions"; items: string[] };
  acceptanceChecklist: { title: "Acceptance checklist"; items: string[] };
  limitations: { title: "Limitations"; items: string[] };
};

export type AgentContextBuildInput = {
  title?: string;
  taskPrompt: string;
  taskType: AgentContextPackTaskType;
  sourceMode: AgentContextPackSourceMode;
  seedReference?: AgentContextSeedReference;
  targetAgent?: { name?: string; kind?: string };
  budgetPreset: AgentContextPackBudgetPreset;
  maxTokenBudget?: number;
  visibility: AgentContextPackVisibility;
  includeEvidenceDomains?: string[];
  excludeEvidenceDomains?: string[];
};

export type AgentContextVersionMetadata = {
  productBrainVersionId?: string | null;
  liveDocVersionId?: string | null;
  documentVersionId?: string | null;
  artifactVersionId?: string | null;
};
