import type { TruthInboxOpenTarget } from "./truth-inbox.types.js";

export type TruthImpactGroupKey =
  | "product_brain"
  | "requirements"
  | "live_doc"
  | "source_documents"
  | "previous_decisions"
  | "owners"
  | "repositories"
  | "files_modules"
  | "pull_requests"
  | "tests"
  | "context_packs"
  | "agent_files"
  | "client_commitments";

export type TruthImpactConfidence = "verified" | "recorded" | "related";

export type TruthImpactItem = {
  id: string;
  group: TruthImpactGroupKey;
  label: string;
  detail: string;
  status: string | null;
  relationship: {
    kind: "direct_proposal_link" | "persisted_graph_link" | "accepted_shared_reference" | "recorded_impact";
    label: string;
    reason: string;
  };
  confidence: TruthImpactConfidence;
  openTarget: TruthInboxOpenTarget | null;
};

export type TruthImpactGroup = {
  key: TruthImpactGroupKey;
  label: string;
  coverage: "mapped" | "not_recorded" | "not_applicable";
  items: TruthImpactItem[];
};

export type TruthImpactMap = {
  proposalId: string | null;
  status: "mapped" | "partial" | "review_only";
  groups: TruthImpactGroup[];
  summary: {
    mappedGroups: number;
    totalGroups: number;
    mappedItems: number;
    verifiedItems: number;
    recordedItems: number;
  };
  generatedAt: string;
  limitations: string[];
};

export type TruthImpactProposal = {
  id: string;
  title: string;
  summary: string;
  status: string;
  decisionRecordId: string | null;
  impactSummaryJson: unknown;
  links: Array<{ linkType: string; linkRefId: string; relationship: string }>;
  decisionRecord: { id: string; title: string; statement: string; status: string } | null;
};

export type TruthImpactBrainNode = {
  id: string;
  artifactVersionId: string;
  nodeType: string;
  title: string;
  summary: string;
  status: string;
  artifactVersion: { artifactType: string; status: string; acceptedAt: Date | null };
};

export type TruthImpactDocumentSection = {
  id: string;
  documentVersionId: string;
  anchorId: string;
  headingPath: string[];
  normalizedText: string;
  pageNumber: number | null;
  documentVersion: {
    id: string;
    status: string;
    document: {
      id: string;
      title: string;
      currentVersionId: string | null;
      visibility?: string;
    };
  };
};
