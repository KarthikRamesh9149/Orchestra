import type { TruthInboxAction, TruthInboxEvidence, TruthInboxItem, TruthInboxOpenTarget } from "./truth-inbox.types.js";
import type { TruthImpactMap } from "./truth-impact-map.types.js";

export type TruthPacketReadiness = "decision_ready" | "needs_context" | "review_only";

export type TruthPacketReference = {
  id: string;
  type: "accepted_decision" | "brain_node" | "document_section" | "workflow_owner";
  label: string;
  detail: string;
  status: string | null;
  authority: "accepted_truth" | "affected_reference" | "workflow_assignment";
  openTarget: TruthInboxOpenTarget | null;
};

export type TruthPacketOwner = {
  userId: string;
  displayName: string;
  email: string;
  source: "truth_inbox_assignment";
};

export type TruthChangePacket = {
  id: string;
  projectId: string;
  item: TruthInboxItem;
  packetKind: "proposed_change" | "review_signal";
  readiness: TruthPacketReadiness;
  newEvidence: TruthInboxEvidence[];
  currentAcceptedTruth: TruthPacketReference[];
  recordedPriorUnderstanding: string[];
  proposedChange: {
    proposalId: string | null;
    proposalType: string | null;
    status: string;
    title: string;
    summary: string;
    statements: string[];
  } | null;
  potentialConflict: {
    summary: string;
    basis: string[];
    interpretationOnly: true;
  } | null;
  affected: {
    productAreas: TruthPacketReference[];
    engineering: string[];
    owners: TruthPacketOwner[];
  };
  impactMap: TruthImpactMap;
  confidence: {
    score: number;
    label: "low" | "medium" | "high";
    basis: string[];
  };
  decision: {
    required: boolean;
    options: Array<Extract<TruthInboxAction, "accept" | "reject" | "request_clarification" | "defer">>;
    blockers: string[];
  };
  boundaries: Array<{
    stage: "evidence" | "interpretation" | "proposed_change" | "accepted_truth";
    state: "present" | "pending" | "unchanged" | "missing";
    label: string;
    detail: string;
  }>;
  generatedAt: string;
  limitations: string[];
};
