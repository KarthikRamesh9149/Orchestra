export type DeliveryStepStatus = "complete" | "pending" | "blocked" | "not_applicable";

export type DeliveryEvidence = {
  identity?: string | null;
  sha?: string | null;
  repository?: string | null;
  environment?: string | null;
  id: string;
  label: string;
  detail: string | null;
  status: string | null;
  occurredAt: string | null;
  openTarget: { targetType: string; targetRef: Record<string, unknown> } | null;
};

export type DeliveryTraceStep = {
  key:
    | "evidence_received"
    | "change_proposed"
    | "human_approved"
    | "product_brain_updated"
    | "live_doc_updated"
    | "owner_assigned"
    | "context_generated"
    | "implementation_recorded"
    | "tests_passed"
    | "deployment_observed"
    | "implementation_verified";
  label: string;
  status: DeliveryStepStatus;
  owner: string | null;
  occurredAt: string | null;
  detail: string;
  evidence: DeliveryEvidence[];
  remainingGap: string | null;
};

export type DecisionDeliveryTrace = {
  id: string;
  projectId: string;
  proposalId: string | null;
  decisionRecordId: string | null;
  title: string;
  status: "review_only" | "awaiting_decision" | "in_delivery" | "blocked" | "delivered";
  completedSteps: number;
  applicableSteps: number;
  receiptEligible: boolean;
  receiptBlockers: string[];
  receipt: DecisionReceiptDto | null;
  steps: DeliveryTraceStep[];
  generatedAt: string;
  limitations: string[];
};

export type DecisionReceiptContent = {
  version: 1;
  projectId: string;
  proposalId: string;
  decisionRecordId: string | null;
  originalRequest: string;
  supportingEvidence: DeliveryEvidence[];
  approvedBy: string | null;
  approvedAt: string | null;
  acceptedWording: string;
  affectedScope: string[];
  responsibleOwners: string[];
  implementationEvidence: DeliveryEvidence[];
  testEvidence: DeliveryEvidence[];
  deploymentEvidence: DeliveryEvidence[];
  knownLimitations: string[];
  remainingFollowUp: string[];
  issuedAt: string;
};

export type DecisionReceiptDto = {
  id: string;
  proposalId: string;
  decisionRecordId: string | null;
  receiptVersion: number;
  contentHash: string;
  content: DecisionReceiptContent;
  issuedAt: string;
  immutable: true;
};

export type HealthState = "healthy" | "attention" | "blocked" | "unknown";

export type ContextHealthComponent = {
  key: "source_freshness" | "evidence_coverage" | "open_contradictions" | "pending_changes" | "implementation_drift" | "agent_context_freshness" | "ownership" | "connector_health" | "socrates_quality";
  label: string;
  state: HealthState;
  summary: string;
  detail: string[];
  openTarget: { targetType: string; targetRef: Record<string, unknown> } | null;
};

export type ContextHealth = {
  state: HealthState;
  components: ContextHealthComponent[];
  generatedAt: string;
  limitations: string[];
};

export type ReleaseTruthItem = {
  id: string;
  label: string;
  detail: string;
  status: string;
  occurredAt: string | null;
  openTarget: { targetType: string; targetRef: Record<string, unknown> } | null;
};

export type ReleaseTruth = {
  readiness: "ready" | "needs_attention" | "blocked" | "unknown";
  summary: string;
  assessedRevision: string | null;
  assessedRepository: string | null;
  assessedEnvironment: string | null;
  assessmentScope: string;
  acceptedChanges: ReleaseTruthItem[];
  implementationEvidence: ReleaseTruthItem[];
  unresolvedDecisions: ReleaseTruthItem[];
  missingTests: ReleaseTruthItem[];
  unsafeAreas: ReleaseTruthItem[];
  staleAgentContext: ReleaseTruthItem[];
  deploymentEvidence: ReleaseTruthItem[];
  blockers: string[];
  generatedAt: string;
  limitations: string[];
};

export type BriefItem = {
  id: string;
  statement: string;
  sourceLabel: string;
  occurredAt: string | null;
  openTarget: { targetType: string; targetRef: Record<string, unknown> } | null;
};

export type WeeklyBriefContent = {
  title: string;
  weekStart: string;
  weekEnd: string;
  whatChanged: BriefItem[];
  approved: BriefItem[];
  rejected: BriefItem[];
  implemented: BriefItem[];
  blocked: BriefItem[];
  needsDecision: BriefItem[];
  possibleDrift: BriefItem[];
  missingEvidence: BriefItem[];
  limitations: string[];
};

export type WeeklyBriefDto = {
  id: string;
  weekStart: string;
  weekEnd: string;
  sourceFingerprint: string;
  content: WeeklyBriefContent;
  generatedAt: string;
};

export type AgentPreflight = {
  ready: boolean;
  readinessLabel: "ready" | "needs_decision" | "blocked";
  blockers: string[];
  currentAcceptedTruth: string[];
  relevantEvidence: string[];
  technicalConstraints: string[];
  knownConflicts: string[];
  safeToTouch: string[];
  affectedAreas: string[];
  requiredTests: string[];
  openQuestions: string[];
  implementationBoundaries: string[];
  contextPack: {
    id: string;
    title: string;
    bodyMarkdown: string;
    sourceCount: number;
    evidenceCount: number;
    warnings: string[];
    limitations: string[];
  };
  generatedAt: string;
  limitations: string[];
};

export type DeliveryOverview = {
  projectId: string;
  contextHealth: ContextHealth;
  releaseTruth: ReleaseTruth;
  weeklyBrief: WeeklyBriefDto | null;
  recentAgentRuns: Array<{
    id: string;
    title: string;
    status: string;
    provider: string | null;
    commitSha: string | null;
    prUrl: string | null;
    testStatus: string | null;
    requiresHumanReview: boolean;
    review: { scoreLabel: string; recommendation: string; summary: string; needsFollowUp: boolean } | null;
    updatedAt: string;
  }>;
  generatedAt: string;
  cached: boolean;
};
