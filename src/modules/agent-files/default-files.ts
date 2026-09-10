export type AgentMarkdownFileKind =
  | "agents"
  | "root_context"
  | "product_brain"
  | "coding_requirements"
  | "open_questions"
  | "agent_memory"
  | "drift_and_review";

export type AgentMarkdownBranchProfileApi = "main" | "mvp-v0" | "custom";
export type AgentMarkdownBranchProfileDb = "main" | "mvp_v0" | "custom";

export interface DefaultAgentMarkdownFileDefinition {
  filePath: string;
  fileKind: AgentMarkdownFileKind;
  templateKey: AgentMarkdownFileKind;
  title: string;
  description: string;
  sourceDomains: string[];
  generationOrder: number;
}

export const AGENT_MARKDOWN_TEMPLATE_VERSION = "feature12-step3-v1";

export const DEFAULT_AGENT_MARKDOWN_FILES: DefaultAgentMarkdownFileDefinition[] = [
  {
    filePath: "AGENTS.md",
    fileKind: "agents",
    templateKey: "agents",
    title: "Coding Agent Instructions",
    description: "Persistent coding-agent instructions, branch rules, truth model, and safety constraints.",
    sourceDomains: ["product_brain", "live_doc", "accepted_changes", "coding_requirements", "agent_quality_reviews"],
    generationOrder: 1
  },
  {
    filePath: "ORCHESTRA_CONTEXT.md",
    fileKind: "root_context",
    templateKey: "root_context",
    title: "Current Orchestra Context",
    description: "Short current project context for agents.",
    sourceDomains: ["product_brain", "live_doc", "open_questions", "accepted_decisions", "accepted_changes"],
    generationOrder: 2
  },
  {
    filePath: "docs/orchestra/PRODUCT_BRAIN.md",
    fileKind: "product_brain",
    templateKey: "product_brain",
    title: "Product Brain Projection",
    description: "Fuller accepted Product Brain projection with provenance notes.",
    sourceDomains: ["product_brain", "brain_nodes", "accepted_decisions", "accepted_changes", "live_doc"],
    generationOrder: 3
  },
  {
    filePath: "docs/orchestra/CODING_REQUIREMENTS.md",
    fileKind: "coding_requirements",
    templateKey: "coding_requirements",
    title: "Coding Requirements Projection",
    description: "Developer-facing implementation requirements and safety rules.",
    sourceDomains: ["coding_requirements", "diagrams", "responsibilities", "product_brain", "api_contracts"],
    generationOrder: 4
  },
  {
    filePath: "docs/orchestra/OPEN_QUESTIONS.md",
    fileKind: "open_questions",
    templateKey: "open_questions",
    title: "Open Questions",
    description: "Unresolved questions and low-confidence areas agents must not guess.",
    sourceDomains: ["pending_changes", "agent_runs", "agent_quality_reviews", "manual_context"],
    generationOrder: 5
  },
  {
    filePath: "docs/orchestra/AGENT_MEMORY.md",
    fileKind: "agent_memory",
    templateKey: "agent_memory",
    title: "Agent Memory",
    description: "Recent external agent runs and carry-forward notes as implementation evidence.",
    sourceDomains: ["agent_context_packs", "agent_runs", "agent_quality_reviews"],
    generationOrder: 6
  },
  {
    filePath: "docs/orchestra/DRIFT_AND_REVIEW.md",
    fileKind: "drift_and_review",
    templateKey: "drift_and_review",
    title: "Drift and Review",
    description: "Recent drift, risk, test, docs, and MVP-mode review findings.",
    sourceDomains: ["agent_quality_reviews", "agent_runs", "accepted_changes", "mvp_flags"],
    generationOrder: 7
  }
];

export function toDbBranchProfile(profile: AgentMarkdownBranchProfileApi): AgentMarkdownBranchProfileDb {
  return profile === "mvp-v0" ? "mvp_v0" : profile;
}

export function toApiBranchProfile(profile: string): AgentMarkdownBranchProfileApi {
  return profile === "mvp_v0" || profile === "mvp-v0" ? "mvp-v0" : profile === "main" ? "main" : "custom";
}
