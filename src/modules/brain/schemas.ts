import { z } from "zod";

export const evidenceRefSchema = z.object({
  documentId: z.string().optional(),
  documentVersionId: z.string().optional(),
  sectionId: z.string().optional(),
  contextId: z.string().optional(),
  contextChunkId: z.string().optional(),
  excerpt: z.string()
}).strict();

export const sourcePackageSchema = z.object({
  projectSummary: z.string(),
  actors: z.array(z.string()),
  features: z.array(z.string()),
  constraints: z.array(z.string()),
  integrations: z.array(z.string()),
  contradictions: z.array(z.string()),
  unknowns: z.array(z.string()),
  risks: z.array(z.string()),
  sourceConfidence: z.number().min(0).max(1),
  evidenceRefs: z.array(evidenceRefSchema)
}).strict();

export const clarifiedBriefSchema = z.object({
  summary: z.string(),
  targetUsers: z.array(z.string()),
  flows: z.array(z.string()),
  scope: z.array(z.string()),
  constraints: z.array(z.string()),
  integrations: z.array(z.string()),
  unresolvedDecisions: z.array(z.string()),
  assumptions: z.array(z.string()),
  risks: z.array(z.string()),
  evidenceRefs: z.array(evidenceRefSchema)
}).strict();

export const brainGraphNodeSchema = z.object({
  nodeKey: z.string(),
  nodeType: z.enum(["module", "flow", "constraint", "integration", "decision", "unknown", "source_cluster"]),
  title: z.string(),
  summary: z.string(),
  status: z.enum(["active", "unresolved", "changed", "deprecated"]),
  priority: z.enum(["high", "medium", "low"]).optional(),
  linkedSectionIds: z.array(z.string()).default([])
}).strict();

export const brainGraphEdgeSchema = z.object({
  fromNodeKey: z.string(),
  toNodeKey: z.string(),
  edgeType: z.enum(["depends_on", "relates_to", "changed_by", "supported_by", "references"])
}).strict();

export const brainGraphSchema = z.object({
  nodes: z.array(brainGraphNodeSchema),
  edges: z.array(brainGraphEdgeSchema),
  criticalPaths: z.array(z.string()),
  riskyAreas: z.array(z.string()),
  unresolvedAreas: z.array(z.string())
}).strict();

export const productBrainSchema = z.object({
  whatTheProductIs: z.string(),
  whoItIsFor: z.array(z.string()),
  mainFlows: z.array(z.string()),
  modules: z.array(z.string()),
  constraints: z.array(z.string()),
  integrations: z.array(z.string()),
  unresolvedAreas: z.array(z.string()),
  acceptedDecisions: z.array(
    z.object({
      decisionId: z.string(),
      title: z.string(),
      statement: z.string()
    }).strict()
  ),
  recentAcceptedChanges: z.array(
    z.object({
      proposalId: z.string(),
      title: z.string(),
      summary: z.string()
    }).strict()
  ),
  evidenceRefs: z.array(evidenceRefSchema)
}).strict();
