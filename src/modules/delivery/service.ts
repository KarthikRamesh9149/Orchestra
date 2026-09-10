import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { isBlockingSeverity, isPassingEvidence, isSuccessfulDeployment, sameRevision, runMatchesEvidence, isImplementationEvidence, isTestEvidence, isDeploymentEvidence } from "./evidence-policy.js";
import type { AuditService } from "../audit/service.js";
import type { AgentContextPackService } from "../agent-context/service.js";
import type { AgentQualityDriftService } from "../agent-context/quality-drift.service.js";
import type { AgentRunMemoryService } from "../agent-context/agent-runs.service.js";
import type { IntegrationManagementService } from "../integrations/integrations.service.js";
import type { ProjectService } from "../projects/service.js";
import type { AgentPreflightInput } from "./schemas.js";
import type {
  AgentPreflight,
  BriefItem,
  ContextHealth,
  ContextHealthComponent,
  DecisionDeliveryTrace,
  DecisionReceiptContent,
  DecisionReceiptDto,
  DeliveryEvidence,
  DeliveryOverview,
  DeliveryTraceStep,
  HealthState,
  ReleaseTruth,
  ReleaseTruthItem,
  WeeklyBriefContent,
  WeeklyBriefDto
} from "./types.js";

type Actor = { userId: string; orgId: string };
type IntegrationStatus = Awaited<ReturnType<IntegrationManagementService["getProjectIntegrationStatus"]>>;

const OVERVIEW_TTL_MS = 15_000;
const RELEASE_OBSERVATION_LIMIT = 25;
const RELEASE_CANDIDATE_EVIDENCE_LIMIT = 100;
const RELEASE_CANDIDATE_MAX_AGE_MS = 30 * 86_400_000;
const overviewCache = new Map<string, { storedAt: number; value: DeliveryOverview }>();
const overviewRequests = new Map<string, Promise<DeliveryOverview>>();
const overviewGenerations = new Map<string, number>();
const REQUIRED_RECEIPT_STEPS = new Set<DeliveryTraceStep["key"]>([
  "evidence_received",
  "change_proposed",
  "human_approved",
  "product_brain_updated",
  "implementation_recorded",
  "tests_passed",
  "deployment_observed",
  "implementation_verified"
]);

export class DeliveryIntelligenceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly integrationManagementService: IntegrationManagementService,
    private readonly agentContextPackService: AgentContextPackService,
    private readonly agentRunMemoryService: AgentRunMemoryService,
    private readonly agentQualityDriftService: AgentQualityDriftService
  ) {}

  async getOverview(projectId: string, actor: Actor, refresh = false): Promise<DeliveryOverview> {
    await this.ensureInternalAccess(projectId, actor);
    if (refresh) this.clearOverview(projectId);
    const generation = overviewGenerations.get(projectId) ?? 0;
    const key = `${projectId}:${actor.orgId}:${actor.userId}`;
    const cached = refresh ? null : overviewCache.get(key);
    if (cached && Date.now() - cached.storedAt < OVERVIEW_TTL_MS) return { ...cached.value, cached: true };
    const pending = refresh ? null : overviewRequests.get(key);
    if (pending) return { ...(await pending), cached: true };
    const request = this.buildOverview(projectId, actor).then((value) => {
      if (generation === (overviewGenerations.get(projectId) ?? 0)) overviewCache.set(key, { storedAt: Date.now(), value });
      return value;
    }).finally(() => {
      if (overviewRequests.get(key) === request) overviewRequests.delete(key);
    });
    overviewRequests.set(key, request);
    return request;
  }

  async getTrace(projectId: string, itemId: string, actor: Actor): Promise<DecisionDeliveryTrace> {
    await this.ensureInternalAccess(projectId, actor);
    const proposalId = proposalIdFromItem(itemId);
    if (!proposalId) return reviewOnlyTrace(projectId, itemId);
    const proposal = await this.prisma.specChangeProposal.findFirst({
      where: { id: proposalId, projectId },
      include: {
        links: true,
        decisionRecord: true,
        accepter: { select: { displayName: true } },
        decisionReceipt: true
      }
    });
    if (!proposal) throw new AppError(404, "Decision-to-delivery trace proposal not found", "delivery_trace_proposal_not_found");

    const referenceFilters: Prisma.AgentContextPackSourceWhereInput[] = [
      { sourceRefType: "change_proposal", sourceRefId: proposal.id },
      ...(proposal.decisionRecordId ? [{ sourceRefType: "decision_record", sourceRefId: proposal.decisionRecordId }] : [])
    ];
    const [state, revisions, packSources, decisionLinks, recentRuns] = await Promise.all([
      this.prisma.truthInboxItemState.findUnique({
        where: { projectId_sourceType_sourceId: { projectId, sourceType: "proposal", sourceId: proposal.id } },
        include: { assignedUser: { select: { displayName: true, email: true } } }
      }),
      this.prisma.liveDocSectionRevision.findMany({
        where: { projectId, proposalId: proposal.id },
        select: { id: true, sectionKey: true, changeSummary: true, eventType: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 25
      }),
      this.prisma.agentContextPackSource.findMany({
        where: { projectId, OR: referenceFilters, pack: { is: { status: "active", deletedAt: null } } },
        select: { pack: { select: { id: true, title: true, generatedAt: true, status: true } } },
        orderBy: { createdAt: "desc" },
        take: 25
      }),
      proposal.decisionRecordId ? this.prisma.fdeDecisionEngineeringLink.findMany({
        where: { projectId, decisionId: proposal.decisionRecordId, archivedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 100
      }) : Promise.resolve([]),
      this.prisma.agentRun.findMany({
        where: { projectId, status: { notIn: ["archived", "deleted"] } },
        orderBy: { updatedAt: "desc" },
        take: 50
      })
    ]);

    const evidenceIds = unique(decisionLinks.flatMap((link) => strings(link.evidenceIdsJson)));
    const [engineeringRows, githubRows] = evidenceIds.length ? await Promise.all([
      this.prisma.engineeringEvidenceItem.findMany({ where: { projectId, id: { in: evidenceIds }, archivedAt: null } }),
      this.prisma.gitHubEngineeringEvidence.findMany({ where: { projectId, id: { in: evidenceIds }, evidenceStatus: "active" } })
    ]) : [[], []];
    // Manual registry rows and Orchestra projections remain useful review context,
    // but only provider-backed GitHub evidence can satisfy delivery receipt gates.
    const authoritativeEvidence = [
      ...engineeringRows.filter((row) => row.provider === "github").map((row) => engineeringEvidence(row)),
      ...githubRows.map((row) => githubEvidence(row))
    ];
    const packIds = new Set(packSources.map((source) => source.pack.id));
    const linkedRuns = recentRuns.filter((run) => run.contextPackId && packIds.has(run.contextPackId));
    const implementationEvidence = authoritativeEvidence.filter(isImplementationEvidence);
    const testEvidence = authoritativeEvidence.filter(isTestEvidence);
    const passingTests = testEvidence.filter(isPassingEvidence);
    const deploymentEvidence = authoritativeEvidence.filter(isDeploymentEvidence);
    const successfulDeployments = deploymentEvidence.filter((item) => isSuccessfulDeployment(item));
    const acceptedRuns = linkedRuns.filter((run) => run.humanReviewResult === "accepted" || run.status === "accepted");
    const externalEvidence: DeliveryEvidence[] = strings(proposal.externalEvidenceRefsJson).map((reference, index) => ({
      id: `external-source:${index}`,
      label: "External source evidence",
      detail: reference,
      status: "linked",
      occurredAt: proposal.createdAt.toISOString(),
      openTarget: /^https?:\/\//i.test(reference) ? { targetType: "external_url", targetRef: { url: reference } } : null
    }));
    const linkedSourceEvidence: DeliveryEvidence[] = proposal.links.filter((link) => link.linkType === "message" || link.linkType === "thread").map((link) => ({
      id: `source:${link.linkType}:${link.linkRefId}`,
      label: `${humanize(String(link.linkType))} evidence`,
      detail: "Persisted source reference",
      status: "linked",
      occurredAt: link.createdAt.toISOString(),
      openTarget: { targetType: String(link.linkType), targetRef: { [`${String(link.linkType)}Id`]: link.linkRefId } }
    } satisfies DeliveryEvidence));
    const sourceEvidence = [...linkedSourceEvidence, ...externalEvidence];
    const ownerEvidence: DeliveryEvidence[] = state?.assignedUser ? [{
      id: `owner:${state.assignedUserId}`,
      label: state.assignedUser.displayName,
      detail: state.assignedUser.email,
      status: "assigned",
      occurredAt: state.updatedAt.toISOString(),
      openTarget: null
    }] : [];
    const contextEvidence: DeliveryEvidence[] = packSources.map((source) => ({
      id: `context-pack:${source.pack.id}`,
      label: source.pack.title,
      detail: "Evidence-backed agent context pack",
      status: source.pack.status,
      occurredAt: source.pack.generatedAt.toISOString(),
      openTarget: { targetType: "agent_context_pack", targetRef: { contextPackId: source.pack.id } }
    }));
    const runEvidence: DeliveryEvidence[] = linkedRuns.map((run) => ({
      id: `agent-run:${run.id}`,
      label: run.taskTitle,
      detail: run.prUrl ?? run.commitSha ?? run.outputSummary,
      status: `${run.status}:${run.humanReviewResult}`,
      occurredAt: run.updatedAt.toISOString(),
      openTarget: { targetType: "agent_run", targetRef: { agentRunId: run.id } }
    }));
    const revisionEvidence: DeliveryEvidence[] = revisions.map((revision) => ({
      id: `live-doc-revision:${revision.id}`,
      label: revision.changeSummary ?? humanize(revision.sectionKey),
      detail: humanize(String(revision.eventType)),
      status: "recorded",
      occurredAt: revision.createdAt.toISOString(),
      openTarget: { targetType: "live_doc_section", targetRef: { sectionKey: revision.sectionKey } }
    }));
    const approved = proposal.status === "accepted" && Boolean(proposal.acceptedAt);
    const passingAcceptedRuns = acceptedRuns.filter((run) => ["passed", "success", "succeeded"].includes(run.testStatus ?? ""));
    const passingRunEvidence = passingAcceptedRuns.map((run) => ({
      id: `agent-run:${run.id}`,
      label: run.taskTitle,
      detail: run.prUrl ?? run.commitSha ?? run.outputSummary,
      status: `${run.status}:${run.humanReviewResult}:${run.testStatus ?? "unknown"}`,
      occurredAt: run.updatedAt.toISOString(),
      openTarget: { targetType: "agent_run", targetRef: { agentRunId: run.id } }
    } satisfies DeliveryEvidence));
    const hasPassingTests = passingTests.length > 0;
    const hasVerifiedImplementation = successfulDeployments.some((deployment) =>
      passingTests.some((check) => sameRevision(check, deployment))
      && implementationEvidence.some((implementation) => sameRevision(implementation, deployment))
      && acceptedRuns.some((run) => runMatchesEvidence(run, deployment))
    );
    const steps: DeliveryTraceStep[] = [
      step("evidence_received", "Evidence received", sourceEvidence.length > 0 ? "complete" : "blocked", sourceEvidence.length ? `${sourceEvidence.length} source record(s) are linked.` : "No source evidence is linked.", sourceEvidence, sourceEvidence.length > 0 ? null : "Link source evidence before review.", sourceEvidence[0]?.occurredAt ?? proposal.createdAt.toISOString()),
      step("change_proposed", "Change proposed", "complete", proposal.summary, [{ id: `proposal:${proposal.id}`, label: proposal.title, detail: proposal.summary, status: proposal.status, occurredAt: proposal.createdAt.toISOString(), openTarget: { targetType: "change_proposal", targetRef: { proposalId: proposal.id } } }], null, proposal.createdAt.toISOString()),
      step("human_approved", "Human approved", approved ? "complete" : proposal.status === "rejected" ? "blocked" : "pending", approved ? `Approved by ${proposal.accepter?.displayName ?? "an authorized truth approver"}.` : proposal.status === "rejected" ? "The proposed change was rejected." : "An authorized truth decision is still required.", [], approved || proposal.status === "rejected" ? null : "Accept or reject the proposal through the Truth Inbox.", proposal.acceptedAt?.toISOString() ?? null, proposal.accepter?.displayName ?? null),
      step("product_brain_updated", "Product Brain updated", proposal.acceptedBrainVersionId ? "complete" : approved ? "blocked" : "pending", proposal.acceptedBrainVersionId ? "The accepted proposal records its Product Brain version." : "No accepted Product Brain version is recorded.", proposal.acceptedBrainVersionId ? [{ id: `brain:${proposal.acceptedBrainVersionId}`, label: "Accepted Product Brain version", detail: null, status: "accepted", occurredAt: proposal.acceptedAt?.toISOString() ?? null, openTarget: { targetType: "product_brain", targetRef: { artifactVersionId: proposal.acceptedBrainVersionId } } }] : [], proposal.acceptedBrainVersionId ? null : "Update accepted truth through the authorized proposal workflow.", proposal.acceptedAt?.toISOString() ?? null),
      step("live_doc_updated", "Live Doc updated", revisionEvidence.length ? "complete" : "not_applicable", revisionEvidence.length ? `${revisionEvidence.length} linked Live Doc revision(s) are recorded.` : "No Live Doc section is recorded as affected.", revisionEvidence, null, revisionEvidence[0]?.occurredAt ?? null),
      step("owner_assigned", "Owner assigned", ownerEvidence.length ? "complete" : "pending", ownerEvidence.length ? "A delivery owner is assigned." : "No delivery owner is assigned.", ownerEvidence, ownerEvidence.length ? null : "Assign an owner in the Truth Inbox.", ownerEvidence[0]?.occurredAt ?? null, state?.assignedUser?.displayName ?? null),
      step("context_generated", "Agent or human context generated", contextEvidence.length ? "complete" : "pending", contextEvidence.length ? `${contextEvidence.length} context pack(s) are linked.` : "No context pack is linked to this change.", contextEvidence, contextEvidence.length ? null : "Run Agent Preflight before implementation.", contextEvidence[0]?.occurredAt ?? null),
      step("implementation_recorded", "Implementation recorded", implementationEvidence.length || runEvidence.length ? "complete" : approved ? "blocked" : "pending", implementationEvidence.length || runEvidence.length ? "Implementation evidence is linked to the approved decision." : "No PR, commit, file, route, or agent-run evidence is linked.", [...implementationEvidence, ...runEvidence], implementationEvidence.length || runEvidence.length ? null : "Link implementation evidence to the accepted decision.", latestDate([...implementationEvidence, ...runEvidence])),
      step("tests_passed", "Tests passed", hasPassingTests ? "complete" : approved ? "blocked" : "pending", hasPassingTests ? "Passing test or check evidence is recorded." : "No passing test evidence is recorded.", [...passingTests, ...passingRunEvidence], hasPassingTests ? null : "Record the tests and authoritative passing result.", latestDate([...passingTests, ...passingRunEvidence])),
      step("deployment_observed", "Deployment observed", successfulDeployments.length ? "complete" : approved ? "blocked" : "pending", successfulDeployments.length ? "A successful deployment is evidenced." : "No successful deployment evidence is linked.", successfulDeployments, successfulDeployments.length ? null : "Link provider-backed deployment evidence.", latestDate(successfulDeployments)),
      step("implementation_verified", "Implementation verified", hasVerifiedImplementation ? "complete" : approved ? "blocked" : "pending", hasVerifiedImplementation ? "Human review, passing tests, and deployment evidence are all recorded." : "Implementation is not yet verified by the complete evidence chain.", runEvidence.filter((item) => /accepted/.test(item.status ?? "")), hasVerifiedImplementation ? null : unique([acceptedRuns.length ? "" : "Complete Agent Postflight and human review.", hasPassingTests ? "" : "Record passing test evidence.", successfulDeployments.length ? "" : "Record successful deployment evidence.", "Link implementation, passing checks, production deployment and human review to the same repository and full commit SHA."]).join(" "), acceptedRuns[0]?.reviewedAt?.toISOString() ?? null)
    ];
    const receiptBlockers = steps.filter((candidate) => REQUIRED_RECEIPT_STEPS.has(candidate.key) && candidate.status !== "complete").map((candidate) => `${candidate.label}: ${candidate.remainingGap ?? candidate.detail}`);
    const applicable = steps.filter((candidate) => candidate.status !== "not_applicable");
    const completed = applicable.filter((candidate) => candidate.status === "complete");
    const status: DecisionDeliveryTrace["status"] = !approved
      ? proposal.status === "rejected" ? "blocked" : "awaiting_decision"
      : receiptBlockers.length ? "in_delivery" : "delivered";
    return {
      id: `trace:${proposal.id}`,
      projectId,
      proposalId: proposal.id,
      decisionRecordId: proposal.decisionRecordId,
      title: proposal.title,
      status,
      completedSteps: completed.length,
      applicableSteps: applicable.length,
      receiptEligible: receiptBlockers.length === 0,
      receiptBlockers,
      receipt: proposal.decisionReceipt ? receiptDto(proposal.decisionReceipt) : null,
      steps,
      generatedAt: new Date().toISOString(),
      limitations: [
        ...(proposal.decisionReceipt && receiptBlockers.length ? ["The historical receipt is retained for audit only. Its delivery claim cannot currently be verified; see the receipt blockers."] : []),
        "A complete step means a persisted record exists; it is not inferred from similar text.",
        "Agent output and engineering evidence remain implementation evidence until human review.",
        "The trace never updates accepted truth by itself."
      ]
    };
  }

  async issueReceipt(projectId: string, itemId: string, actor: Actor): Promise<DecisionReceiptDto> {
    await this.projectService.ensureProjectTruthApprover(projectId, actor.userId);
    const trace = await this.getTrace(projectId, itemId, actor);
    if (!trace.proposalId) throw new AppError(409, "A Decision Receipt requires a persisted proposal", "decision_receipt_proposal_required");
    const existing = await this.prisma.decisionReceipt.findUnique({ where: { proposalId: trace.proposalId } });
    if (!trace.receiptEligible) throw new AppError(409, `Decision Receipt is blocked: ${trace.receiptBlockers.join(" ")}`, "decision_receipt_incomplete");
    if (existing) return receiptDto(existing);
    const proposal = await this.prisma.specChangeProposal.findUniqueOrThrow({
      where: { id: trace.proposalId },
      include: { decisionRecord: true, accepter: { select: { displayName: true } } }
    });
    const step = (key: DeliveryTraceStep["key"]) => trace.steps.find((candidate) => candidate.key === key)!;
    const issuedAt = new Date().toISOString();
    const content: DecisionReceiptContent = {
      version: 1,
      projectId,
      proposalId: proposal.id,
      decisionRecordId: proposal.decisionRecordId,
      originalRequest: proposal.summary,
      supportingEvidence: step("evidence_received").evidence,
      approvedBy: proposal.accepter?.displayName ?? null,
      approvedAt: proposal.acceptedAt?.toISOString() ?? null,
      acceptedWording: proposal.decisionRecord?.statement ?? proposal.summary,
      affectedScope: summarizeJson(proposal.impactSummaryJson),
      responsibleOwners: step("owner_assigned").evidence.map((item) => item.label),
      implementationEvidence: step("implementation_recorded").evidence,
      testEvidence: step("tests_passed").evidence,
      deploymentEvidence: step("deployment_observed").evidence,
      knownLimitations: trace.limitations,
      remainingFollowUp: trace.steps.filter((candidate) => candidate.status === "pending" || candidate.status === "blocked").map((candidate) => candidate.remainingGap ?? candidate.detail),
      issuedAt
    };
    const contentHash = sha256(stableStringify(content));
    const created = await this.prisma.decisionReceipt.upsert({
      where: { proposalId: proposal.id },
      create: {
        orgId: actor.orgId,
        projectId,
        proposalId: proposal.id,
        decisionRecordId: proposal.decisionRecordId,
        issuedByUserId: actor.userId,
        contentHash,
        receiptJson: content as unknown as Prisma.InputJsonValue,
        issuedAt: new Date(issuedAt)
      },
      update: {}
    });
    await this.auditService.record({
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      eventType: "decision_receipt_issued",
      entityType: "decision_receipt",
      entityId: created.id,
      payload: { proposalId: proposal.id, decisionRecordId: proposal.decisionRecordId, contentHash }
    });
    this.clearOverview(projectId);
    return receiptDto(created);
  }

  async generateWeeklyBrief(projectId: string, actor: Actor): Promise<WeeklyBriefDto> {
    await this.ensureInternalAccess(projectId, actor);
    const overview = await this.getOverview(projectId, actor, true);
    const { start, end } = currentUtcWeek();
    const [changedProposals, events] = await Promise.all([
      this.prisma.specChangeProposal.findMany({
        where: { projectId, updatedAt: { gte: start, lt: end } },
        include: { decisionRecord: true },
        orderBy: { updatedAt: "desc" },
        take: 50
      }),
      this.prisma.projectEvent.findMany({
        where: { projectId, startsAt: { gte: start, lt: end } },
        orderBy: { startsAt: "desc" },
        take: 50
      })
    ]);
    const proposalItem = (proposal: typeof changedProposals[number]): BriefItem => ({
      id: `proposal:${proposal.id}`,
      statement: proposal.status === "accepted" ? proposal.decisionRecord?.statement ?? proposal.summary : proposal.summary,
      sourceLabel: proposal.title,
      occurredAt: proposal.updatedAt.toISOString(),
      openTarget: { targetType: "change_proposal", targetRef: { proposalId: proposal.id } }
    });
    const releaseItem = (item: ReleaseTruthItem): BriefItem => ({ id: item.id, statement: item.detail, sourceLabel: item.label, occurredAt: item.occurredAt, openTarget: item.openTarget });
    const content: WeeklyBriefContent = {
      title: "Weekly executive brief",
      weekStart: dateOnly(start),
      weekEnd: dateOnly(new Date(end.getTime() - 86_400_000)),
      whatChanged: [
        ...changedProposals.map(proposalItem),
        ...events.map((event) => ({ id: `timeline:${event.id}`, statement: event.description ?? event.title, sourceLabel: event.title, occurredAt: event.startsAt.toISOString(), openTarget: { targetType: "timeline_event", targetRef: { eventId: event.id } } }))
      ].slice(0, 20),
      approved: changedProposals.filter((proposal) => proposal.status === "accepted").map(proposalItem),
      rejected: changedProposals.filter((proposal) => proposal.status === "rejected").map(proposalItem),
      implemented: overview.releaseTruth.implementationEvidence.map(releaseItem),
      blocked: overview.releaseTruth.unsafeAreas.map(releaseItem),
      needsDecision: overview.releaseTruth.unresolvedDecisions.map(releaseItem),
      possibleDrift: overview.releaseTruth.unsafeAreas.map(releaseItem),
      missingEvidence: overview.releaseTruth.missingTests.map(releaseItem),
      limitations: [
        "Every statement is projected from a persisted project record and opens to its source when a target exists.",
        "The brief is a point-in-time summary, not accepted Product Brain truth."
      ]
    };
    const sourceFingerprint = sha256(stableStringify(content));
    const saved = await this.prisma.weeklyExecutiveBrief.upsert({
      where: { projectId_weekStart: { projectId, weekStart: start } },
      create: { orgId: actor.orgId, projectId, generatedByUserId: actor.userId, weekStart: start, weekEnd: new Date(end.getTime() - 86_400_000), sourceFingerprint, contentJson: content as unknown as Prisma.InputJsonValue },
      update: { generatedByUserId: actor.userId, weekEnd: new Date(end.getTime() - 86_400_000), sourceFingerprint, contentJson: content as unknown as Prisma.InputJsonValue, generatedAt: new Date() }
    });
    await this.auditService.record({ orgId: actor.orgId, projectId, actorUserId: actor.userId, eventType: "weekly_executive_brief_generated", entityType: "weekly_executive_brief", entityId: saved.id, payload: { weekStart: content.weekStart, sourceFingerprint } });
    this.clearOverview(projectId);
    return weeklyBriefDto(saved);
  }

  async generatePreflight(projectId: string, actor: Actor, input: AgentPreflightInput): Promise<AgentPreflight> {
    await this.ensureInternalAccess(projectId, actor);
    const [truthNodes, conflicts, fdeFindings, codingRequirements, responsibilities, projectContradictionCount, projectContradictionExample, persistedBlockingFindingCount, persistedBlockingFindingExample] = await Promise.all([
      this.prisma.brainNode.findMany({
        where: { projectId, artifactVersion: { status: "accepted", artifactType: { in: ["product_brain", "brain_graph"] } } },
        select: { title: true, summary: true, nodeType: true, priority: true },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        take: 40
      }),
      this.prisma.specChangeProposal.findMany({
        where: { projectId, status: { in: ["detected", "needs_review"] }, ...(input.proposalId ? { id: input.proposalId } : {}) },
        select: { id: true, title: true, summary: true, proposalType: true },
        orderBy: { updatedAt: "desc" },
        take: 20
      }),
      this.prisma.fdeReadinessFinding.findMany({
        where: { projectId, archivedAt: null, dismissedAt: null },
        select: { id: true, findingType: true, severity: true, summary: true, suggestedAction: true, targetKind: true },
        orderBy: { updatedAt: "desc" },
        take: 40
      }),
      this.prisma.projectCodingRequirements.findMany({
        where: { projectId },
        select: { artifactVersion: { select: { payloadJson: true, status: true, versionNumber: true } } },
        orderBy: { createdAt: "desc" },
        take: 2
      }),
      this.prisma.projectResponsibility.findMany({
        where: { projectId, status: { in: ["open", "in_progress"] } },
        select: { title: true, description: true, area: true, assigneeName: true, member: { select: { user: { select: { displayName: true } } } } },
        take: 30
      }),
      this.prisma.specChangeProposal.count({
        where: { projectId, status: { in: ["detected", "needs_review"] }, proposalType: "contradiction_resolution" }
      }),
      this.prisma.specChangeProposal.findFirst({
        where: { projectId, status: { in: ["detected", "needs_review"] }, proposalType: "contradiction_resolution" },
        select: { title: true, summary: true },
        orderBy: { updatedAt: "desc" }
      }),
      this.prisma.fdeReadinessFinding.count({
        where: { projectId, archivedAt: null, dismissedAt: null, severity: { in: ["blocking", "high", "critical"] } }
      }),
      this.prisma.fdeReadinessFinding.findFirst({
        where: { projectId, archivedAt: null, dismissedAt: null, severity: { in: ["blocking", "high", "critical"] } },
        select: { id: true, findingType: true, severity: true, summary: true, suggestedAction: true, targetKind: true },
        orderBy: { updatedAt: "desc" }
      })
    ]);
    const criticalConflicts = conflicts.filter((conflict) => conflict.proposalType === "contradiction_resolution");
    const unsafe = fdeFindings.filter((finding) => isBlockingSeverity(finding.severity));
    const blockingFindingCount = Math.max(persistedBlockingFindingCount, unsafe.length);
    const contradictionCount = Math.max(projectContradictionCount, criticalConflicts.length);
    const contradictionExample = projectContradictionExample?.title ?? criticalConflicts[0]?.title;
    const blockingFindingExample = persistedBlockingFindingExample?.summary ?? unsafe[0]?.summary;
    const decisionBlockers = unique([
      ...(contradictionCount ? [`${contradictionCount} unresolved project-wide contradiction(s)${contradictionExample ? ` (example: ${contradictionExample})` : ""}.`] : []),
      ...(blockingFindingCount ? [`Blocking finding: ${blockingFindingExample ?? `${blockingFindingCount} active scoped finding(s)`}`] : [])
    ]);
    const pack = await this.agentContextPackService.createPack(projectId, actor.userId, {
      title: `Agent Preflight · ${input.taskPrompt.slice(0, 80)}`,
      taskPrompt: input.taskPrompt,
      taskType: "implementation",
      sourceMode: input.proposalId ? "other" : "task_prompt",
      ...(input.proposalId ? {
        seedReference: {
          type: "change_proposal",
          id: input.proposalId,
          label: conflicts.find((conflict) => conflict.id === input.proposalId)?.title ?? "Proposed change"
        }
      } : {}),
      targetAgent: { kind: input.targetAgent },
      budgetPreset: input.budgetPreset,
      visibility: "internal"
    });
    const packRecord = pack as unknown as Record<string, unknown>;
    const packSources = Array.isArray(packRecord.sources) ? packRecord.sources as Array<Record<string, unknown>> : [];
    const constraints = truthNodes.filter((node) => node.nodeType === "constraint").map((node) => `${node.title}: ${node.summary}`);
    const requiredTests = unique([
      ...codingRequirements.flatMap((requirement) => summarizeJson(requirement.artifactVersion.payloadJson).filter((line) => /test|check|acceptance|verify/i.test(line))),
      ...fdeFindings.filter((finding) => /test/i.test(`${finding.findingType} ${finding.summary}`)).map((finding) => finding.suggestedAction ?? finding.summary)
    ]).slice(0, 20);
    const packEvidenceCount = Number(packRecord.evidenceCount ?? 0);
    const readinessBlockers = unique([
      ...decisionBlockers,
      ...(truthNodes.length === 0 ? ["No accepted Product Brain truth is available for this project."] : []),
      ...(packEvidenceCount === 0 && packSources.length === 0 ? ["No supporting project evidence is available for this task."] : []),
      ...(requiredTests.length === 0 ? ["No project testing or acceptance requirements are recorded for this task."] : [])
    ]);
    const hardBlocked = blockingFindingCount > 0 || truthNodes.length === 0 || (packEvidenceCount === 0 && packSources.length === 0) || requiredTests.length === 0
      || readinessBlockers.some((blocker) => /unsafe|blocked/i.test(blocker));
    return {
      ready: readinessBlockers.length === 0,
      readinessLabel: hardBlocked ? "blocked" : readinessBlockers.length ? "needs_decision" : "ready",
      blockers: readinessBlockers,
      currentAcceptedTruth: truthNodes.slice(0, 15).map((node) => `${node.title}: ${node.summary}`),
      relevantEvidence: packSources.slice(0, 20).map((source) => String(source.title ?? source.label ?? source.sourceRefType ?? "Project evidence")),
      technicalConstraints: constraints.slice(0, 20),
      knownConflicts: uniqueByNormalizedText(conflicts.map((conflict) => formatConflict(conflict.title, conflict.summary))),
      safeToTouch: fdeFindings.filter((finding) => /safe.to.touch/i.test(finding.findingType)).map((finding) => finding.summary),
      affectedAreas: unique(responsibilities.map((responsibility) => `${humanize(String(responsibility.area))}: ${responsibility.title}`)),
      requiredTests,
      openQuestions: unique(strings(packRecord.warnings).filter((warning) => !readinessBlockers.includes(warning))),
      implementationBoundaries: unique([
        "Do not convert agent output into accepted Product Brain truth.",
        "Stay within the evidence and affected areas included in this context pack.",
        "Record files, tests, assumptions, and limitations in Agent Postflight.",
        ...responsibilities.filter((responsibility) => !responsibility.assigneeName && !responsibility.member).map((responsibility) => `${responsibility.title} has no recorded owner.`)
      ]),
      contextPack: {
        id: String(packRecord.id),
        title: String(packRecord.title),
        bodyMarkdown: String(packRecord.bodyMarkdown ?? ""),
        sourceCount: Number(packRecord.sourceCount ?? packSources.length),
        evidenceCount: packEvidenceCount,
        warnings: strings(packRecord.warnings),
        limitations: strings(packRecord.limitations)
      },
      generatedAt: new Date().toISOString(),
      limitations: ["Preflight is evidence-backed readiness guidance; it does not execute code or approve a product decision."]
    };
  }

  async generatePostflight(projectId: string, runId: string, actor: Actor) {
    await this.ensureInternalAccess(projectId, actor);
    const [run, review] = await Promise.all([
      this.agentRunMemoryService.getRun(projectId, runId, actor.userId),
      this.agentQualityDriftService.createAgentRunReview(projectId, runId, actor.userId, {
        reviewMode: "deterministic",
        forceRefresh: true,
        includeEvidence: true,
        includeCitations: true,
        includeOpenTargets: true,
        deterministicOnly: true,
        includeLowConfidenceFindings: true
      })
    ]);
    this.clearOverview(projectId);
    return { run, review, acceptedTruthChanged: false, generatedAt: new Date().toISOString() };
  }

  private async buildOverview(projectId: string, actor: Actor): Promise<DeliveryOverview> {
    await this.ensureInternalAccess(projectId, actor);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    let integrationError: string | null = null;
    const integrationPromise = this.integrationManagementService.getProjectIntegrationStatus(projectId, actor).catch((error) => {
      integrationError = error instanceof Error ? error.message : "Integration status unavailable";
      return null;
    });
    const [project, integration, acceptedChanges, unresolvedDecisions, fdeFindings, productionObservationRows, latestAgentFile, responsibilities, agentRuns, agentReviews, acceptedBrainNodes, allBrainNodes, documentCount, pendingFeedback, latestBrief, blockingFindingCount, contradictionCount] = await Promise.all([
      this.prisma.project.findFirst({ where: { id: projectId, orgId: actor.orgId }, select: { id: true, name: true } }),
      integrationPromise,
      this.prisma.specChangeProposal.findMany({ where: { projectId, status: "accepted", acceptedAt: { gte: weekAgo } }, include: { decisionRecord: true }, orderBy: { acceptedAt: "desc" }, take: 20 }),
      this.prisma.specChangeProposal.findMany({ where: { projectId, status: { in: ["detected", "needs_review"] } }, orderBy: { updatedAt: "desc" }, take: 30 }),
      this.prisma.fdeReadinessFinding.findMany({ where: { projectId, archivedAt: null, dismissedAt: null }, orderBy: { updatedAt: "desc" }, take: 60 }),
      this.prisma.gitHubEngineeringEvidence.findMany({
        where: { projectId, evidenceStatus: "active", evidenceType: { in: ["github_deployment", "github_deployment_status"] } },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        take: RELEASE_OBSERVATION_LIMIT,
        select: githubEvidenceSelect
      }),
      this.prisma.agentMarkdownFileVersion.findFirst({ where: { projectId }, orderBy: { generatedAt: "desc" }, select: { id: true, generatedAt: true, status: true, file: { select: { filePath: true } } } }),
      this.prisma.projectResponsibility.findMany({ where: { projectId, status: { in: ["open", "in_progress"] } }, select: { id: true, title: true, status: true, assigneeName: true, memberId: true }, take: 100 }),
      this.prisma.agentRun.findMany({ where: { projectId, status: { notIn: ["archived", "deleted"] } }, orderBy: { updatedAt: "desc" }, take: 12 }),
      this.prisma.agentQualityReview.findMany({ where: { projectId, agentRunId: { not: null }, archivedAt: null, deletedAt: null }, orderBy: { createdAt: "desc" }, take: 30 }),
      this.prisma.brainNode.count({ where: { projectId, artifactVersion: { status: "accepted", artifactType: { in: ["product_brain", "brain_graph"] } } } }),
      this.prisma.brainNode.count({ where: { projectId, status: "active" } }),
      this.prisma.document.count({ where: { projectId } }),
      this.prisma.socratesResponseFeedback.count({ where: { projectId, needsHumanReview: true } }),
      this.prisma.weeklyExecutiveBrief.findFirst({ where: { projectId }, orderBy: { generatedAt: "desc" } }),
      this.prisma.fdeReadinessFinding.count({ where: { projectId, archivedAt: null, dismissedAt: null, severity: { in: ["blocking", "high", "critical"] } } }),
      this.prisma.specChangeProposal.count({ where: { projectId, status: { in: ["detected", "needs_review"] }, proposalType: "contradiction_resolution" } })
    ]);
    if (!project) throw new AppError(404, "Project not found", "project_not_found");
    const providers = integration?.providers ?? [];
    const connectedProviders = providers.filter((provider) => provider.connected);
    const degradedProviders = providers.filter((provider) => provider.degraded || provider.needsReauth);
    const latestSync = latestIso(connectedProviders.map((provider) => provider.lastSyncedAt).filter((value): value is string => Boolean(value)));
    const releaseSourceStale = Boolean(latestSync && Date.now() - Date.parse(latestSync) > RELEASE_CANDIDATE_MAX_AGE_MS);
    const missingOwners = responsibilities.filter((responsibility) => !responsibility.memberId && !responsibility.assigneeName);
    const drift = fdeFindings.filter((finding) => /drift|mismatch|conflict/i.test(`${finding.findingType} ${finding.findingSubType}`));
    const unsafe = fdeFindings.filter((finding) => isBlockingSeverity(finding.severity));
    const completeBlockingFindingCount = Math.max(blockingFindingCount, unsafe.length);
    const completeContradictionCount = Math.max(contradictionCount, unresolvedDecisions.filter((proposal) => proposal.proposalType === "contradiction_resolution").length);
    const testGaps = fdeFindings.filter((finding) => /test|missing.evidence/i.test(`${finding.findingType} ${finding.findingSubType} ${finding.summary}`));
    const productionObservations = productionObservationRows.map(githubEvidence).sort(byOccurredAtDesc);
    const candidateAssessment = assessProductionCandidate(productionObservations);
    const candidate = candidateAssessment.candidate;
    const candidateRows = candidate ? await this.prisma.gitHubEngineeringEvidence.findMany({
      where: {
        projectId,
        evidenceStatus: "active",
        repositoryOwner: candidate.repository?.split("/")[0],
        repositoryName: candidate.repository?.split("/")[1],
        sha: candidate.sha,
        evidenceType: { in: ["github_commit", "github_check_run", "github_workflow_run", "github_deployment", "github_deployment_status"] }
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: RELEASE_CANDIDATE_EVIDENCE_LIMIT,
      select: githubEvidenceSelect
    }) : [];
    const candidateEvidence = candidate ? candidateRows.map(githubEvidence).filter((item) => sameRevision(item, candidate)) : [];
    const allEvidence: DeliveryEvidence[] = candidateEvidence;
    const implementation = candidateEvidence.filter(isImplementationEvidence).slice(0, 20);
    const candidateImplementation = candidateEvidence.filter(isImplementationEvidence);
    const candidateTests = latestEvidenceByIdentity(candidateEvidence.filter(isTestEvidence));
    const sourceFreshnessState: HealthState = integrationError ? "unknown" : degradedProviders.length ? "attention" : connectedProviders.length ? "healthy" : "unknown";
    const components: ContextHealthComponent[] = [
      component("source_freshness", "Source freshness", sourceFreshnessState, latestSync ? `Latest connected source sync: ${latestSync}.` : "No connected source has a recorded sync time.", connectedProviders.map((provider) => `${provider.label}: ${provider.lastSyncedAt ?? provider.status}`), { targetType: "integrations", targetRef: {} }),
      component("evidence_coverage", "Evidence coverage", acceptedBrainNodes > 0 && documentCount > 0 ? "healthy" : acceptedBrainNodes || documentCount ? "attention" : "blocked", `${acceptedBrainNodes} accepted Product Brain node(s) across ${documentCount} document(s).`, [`${allBrainNodes} active Product Brain node(s) are stored.`, "Coverage is shown as explicit counts, not a mysterious AI score."], { targetType: "memory", targetRef: {} }),
      component("open_contradictions", "Open contradictions", completeContradictionCount ? "blocked" : "healthy", `${completeContradictionCount} unresolved project-wide contradiction(s).`, unresolvedDecisions.filter((proposal) => proposal.proposalType === "contradiction_resolution").map((proposal) => proposal.title), { targetType: "truth_inbox", targetRef: { category: "decision_conflicts" } }),
      component("pending_changes", "Pending changes", unresolvedDecisions.length ? "attention" : "healthy", `${unresolvedDecisions.length} proposed change(s) await a decision.`, unresolvedDecisions.slice(0, 8).map((proposal) => proposal.title), { targetType: "truth_inbox", targetRef: {} }),
      component("implementation_drift", "Implementation drift", completeBlockingFindingCount ? "blocked" : drift.length ? "attention" : "healthy", `${drift.length} displayed drift finding(s); ${completeBlockingFindingCount} blocking or unsafe finding(s) across the authorized project scope.`, drift.slice(0, 8).map((finding) => finding.summary), { targetType: "truth_inbox", targetRef: { category: "agent_drift" } }),
      component("agent_context_freshness", "Agent context freshness", !latestAgentFile ? "unknown" : Date.now() - latestAgentFile.generatedAt.getTime() > 7 * 86_400_000 ? "attention" : "healthy", latestAgentFile ? `${latestAgentFile.file.filePath} generated ${latestAgentFile.generatedAt.toISOString()}.` : "No generated agent file is recorded.", latestAgentFile ? [latestAgentFile.status] : ["Run Agent Preflight before agent work."], { targetType: "agent_context", targetRef: {} }),
      component("ownership", "Ownership", missingOwners.length ? "attention" : responsibilities.length ? "healthy" : "unknown", `${missingOwners.length} open responsibility item(s) have no recorded owner.`, missingOwners.slice(0, 8).map((responsibility) => responsibility.title), { targetType: "settings", targetRef: { section: "team" } }),
      component("connector_health", "Connector health", integrationError ? "unknown" : degradedProviders.length ? "attention" : connectedProviders.length ? "healthy" : "unknown", integrationError ?? `${connectedProviders.length} connected; ${degradedProviders.length} degraded or needs reauthorization.`, degradedProviders.map((provider) => `${provider.label}: ${provider.lastError ?? provider.status}`), { targetType: "integrations", targetRef: {} }),
      component("socrates_quality", "Socrates quality loop", pendingFeedback ? "attention" : "healthy", `${pendingFeedback} response feedback item(s) require human review.`, pendingFeedback ? ["Incorrect, outdated, missing-evidence, wrong-source, and wrong-truth reports remain review evidence until resolved."] : ["No unresolved Socrates correction reports."], { targetType: "socrates", targetRef: {} })
    ];
    const healthState: HealthState = components.some((item) => item.state === "blocked") ? "blocked" : components.some((item) => item.state === "attention") ? "attention" : components.every((item) => item.state === "healthy") ? "healthy" : "unknown";
    const contextHealth: ContextHealth = {
      state: healthState,
      components,
      generatedAt: new Date().toISOString(),
      limitations: unique(["Context Health reports separate evidence-backed components; it does not collapse them into an opaque score.", ...(integrationError ? [`Integration status failed explicitly: ${integrationError}`] : [])])
    };
    const candidateBlockers = candidate ? unique([
      ...(isSuccessfulDeployment(candidate) ? [] : [`Latest production deployment for ${candidate.repository}@${candidate.sha} did not succeed.`]),
      ...(candidateImplementation.length ? [] : [`No implementation evidence matches assessed revision ${candidate.sha}.`]),
      ...(candidateTests.length ? [] : [`No authoritative test result matches assessed revision ${candidate.sha}.`]),
      ...candidateTests.filter((item) => !isPassingEvidence(item)).map((item) => `Latest authoritative test outcome failed for assessed revision ${candidate.sha}: ${item.label}.`),
      ...(candidateAssessment.reason ? [candidateAssessment.reason] : []),
      ...(candidate && candidate.occurredAt && Date.now() - Date.parse(candidate.occurredAt) > RELEASE_CANDIDATE_MAX_AGE_MS ? [`Production candidate ${candidate.sha} is older than the 30-day freshness policy.`] : []),
      ...(releaseSourceStale ? ["Connected release evidence has not synced within the 30-day freshness policy."] : []),
      "Required-check inventory is not recorded by the authorized provider evidence."
    ]) : [candidateAssessment.reason ?? "Production candidate could not be identified from authorized persisted evidence."];
    const knownCandidateFailure = Boolean(candidate && (!isSuccessfulDeployment(candidate) || candidateTests.some((item) => !isPassingEvidence(item))));
    const releaseBlockers = unique([
      ...(completeBlockingFindingCount ? [`${completeBlockingFindingCount} active blocking or unsafe finding(s) exist across the authorized project scope.`] : []),
      ...(completeContradictionCount ? [`${completeContradictionCount} unresolved project-wide contradiction(s) exist.`] : []),
      ...testGaps.map((finding) => `Missing test evidence: ${finding.summary}`),
      ...candidateBlockers
    ]);
    const releaseTruth: ReleaseTruth = {
      readiness: completeBlockingFindingCount || completeContradictionCount ? "blocked" : knownCandidateFailure ? "needs_attention" : candidateAssessment.unknown || !candidate || candidateBlockers.some((blocker) => /Required-check inventory|older than the 30-day|has not synced/.test(blocker)) ? "unknown" : releaseBlockers.length ? "needs_attention" : "unknown",
      summary: !candidate ? "Release readiness is unknown because a current production candidate revision and environment cannot be identified." : candidateAssessment.unknown ? "Release readiness is unknown because the bounded production observation scope is ambiguous or incomplete." : releaseBlockers.length ? `${releaseBlockers.length} evidence-backed release gap(s) require attention for ${candidate.repository}@${candidate.sha}.` : `Release readiness is unknown because required-check inventory is not recorded for ${candidate.repository}@${candidate.sha}.`,
      assessedRevision: candidate?.sha ?? null,
      assessedRepository: candidate?.repository ?? null,
      assessedEnvironment: candidate?.environment ?? null,
      assessmentScope: candidate ? `Latest ${RELEASE_OBSERVATION_LIMIT} production observations and up to ${RELEASE_CANDIDATE_EVIDENCE_LIMIT} candidate records from the authorized GitHub provider; required-check inventory is not recorded.` : candidateAssessment.reason ?? "Production candidate could not be identified from authorized persisted evidence.",
      acceptedChanges: acceptedChanges.map((proposal) => releaseProposal(proposal)),
      implementationEvidence: implementation.map(releaseEvidence),
      unresolvedDecisions: unresolvedDecisions.map((proposal) => releaseProposal(proposal)),
      missingTests: testGaps.map(releaseFinding),
      unsafeAreas: unsafe.map(releaseFinding),
      staleAgentContext: latestAgentFile && Date.now() - latestAgentFile.generatedAt.getTime() > 7 * 86_400_000 ? [{ id: `agent-file:${latestAgentFile.id}`, label: latestAgentFile.file.filePath, detail: "Agent context is older than seven days.", status: "stale", occurredAt: latestAgentFile.generatedAt.toISOString(), openTarget: { targetType: "agent_context", targetRef: {} } }] : [],
      deploymentEvidence: candidate ? [releaseEvidence(candidate)] : [],
      blockers: releaseBlockers,
      generatedAt: new Date().toISOString(),
      limitations: ["Release Truth uses bounded provider observations to identify a candidate and cannot certify readiness without a required-check inventory.", "Safety counts cover the complete authorized project scope; evidence lists remain display-limited."]
    };
    const reviewByRun = new Map<string, typeof agentReviews[number]>();
    for (const review of agentReviews) if (review.agentRunId && !reviewByRun.has(review.agentRunId)) reviewByRun.set(review.agentRunId, review);
    return {
      projectId,
      contextHealth,
      releaseTruth,
      weeklyBrief: latestBrief ? weeklyBriefDto(latestBrief) : null,
      recentAgentRuns: agentRuns.map((run) => {
        const review = reviewByRun.get(run.id);
        return {
          id: run.id,
          title: run.taskTitle,
          status: run.status,
          provider: run.provider,
          commitSha: run.commitSha,
          prUrl: run.prUrl,
          testStatus: run.testStatus,
          requiresHumanReview: run.requiresHumanReview,
          review: review ? { scoreLabel: review.scoreLabel, recommendation: review.recommendation, summary: review.summary, needsFollowUp: review.needsFollowUp } : null,
          updatedAt: run.updatedAt.toISOString()
        };
      }),
      generatedAt: new Date().toISOString(),
      cached: false
    };
  }

  private async ensureInternalAccess(projectId: string, actor: Actor) {
    const member = await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actor.userId);
    if (member.projectRole === "client") throw new AppError(403, "Client users cannot access internal delivery intelligence", "delivery_intelligence_client_forbidden");
    const project = await this.prisma.project.findFirst({ where: { id: projectId, orgId: actor.orgId }, select: { id: true } });
    if (!project) throw new AppError(404, "Project not found", "project_not_found");
    return member;
  }

  private clearOverview(projectId: string) {
    overviewGenerations.set(projectId, (overviewGenerations.get(projectId) ?? 0) + 1);
    for (const key of overviewRequests.keys()) if (key.startsWith(`${projectId}:`)) overviewRequests.delete(key);
    for (const key of overviewCache.keys()) if (key.startsWith(`${projectId}:`)) overviewCache.delete(key);
  }
}

function step(key: DeliveryTraceStep["key"], label: string, status: DeliveryTraceStep["status"], detail: string, evidence: DeliveryEvidence[], remainingGap: string | null, occurredAt: string | null, owner: string | null = null): DeliveryTraceStep {
  return { key, label, status, owner, occurredAt, detail, evidence, remainingGap };
}

function reviewOnlyTrace(projectId: string, itemId: string): DecisionDeliveryTrace {
  return { id: `trace:${itemId}`, projectId, proposalId: null, decisionRecordId: null, title: "Review signal", status: "review_only", completedSteps: 0, applicableSteps: 0, receiptEligible: false, receiptBlockers: ["Create a persisted change proposal before delivery can be traced."], receipt: null, steps: [], generatedAt: new Date().toISOString(), limitations: ["Signals are not decisions and cannot receive a delivery receipt."] };
}

function proposalIdFromItem(itemId: string) {
  return itemId.startsWith("proposal:") ? itemId.slice("proposal:".length) : null;
}

function engineeringEvidence(row: { id: string; sourceSubType: string; title: string | null; summary: string | null; status: string; occurredAt: Date | null; sourceUrl: string | null; environment?: string | null; sha?: string | null; repositoryOwner?: string | null; repositoryName?: string | null }): DeliveryEvidence {
  return { sha: row.sha, repository: row.repositoryOwner && row.repositoryName ? `${row.repositoryOwner}/${row.repositoryName}` : null, environment: row.environment, id: `engineering:${row.sourceSubType}:${row.id}`, label: row.title ?? humanize(row.sourceSubType), detail: row.summary ?? row.environment ?? null, status: row.status, occurredAt: row.occurredAt?.toISOString() ?? null, openTarget: row.sourceUrl ? { targetType: "external_url", targetRef: { url: row.sourceUrl } } : { targetType: "engineering_evidence", targetRef: { evidenceId: row.id } } };
}

function githubEvidence(row: { id: string; evidenceType: string; providerId?: string; title: string | null; summary: string | null; status: string | null; occurredAt: Date | null; sourceUrl: string | null; sha?: string | null; repositoryOwner?: string | null; repositoryName?: string | null; payloadJson?: unknown }): DeliveryEvidence {
  const payload = row.payloadJson as Record<string, unknown> | null;
  return { identity: row.providerId ?? null, sha: row.sha, repository: row.repositoryOwner && row.repositoryName ? `${row.repositoryOwner}/${row.repositoryName}` : null, environment: typeof payload?.environment === "string" ? payload.environment : null, id: `github:${row.evidenceType}:${row.id}`, label: row.title ?? humanize(String(row.evidenceType)), detail: row.summary, status: row.status, occurredAt: row.occurredAt?.toISOString() ?? null, openTarget: row.sourceUrl ? { targetType: "external_url", targetRef: { url: row.sourceUrl } } : { targetType: "github_evidence", targetRef: { evidenceId: row.id } } };
}

function component(key: ContextHealthComponent["key"], label: string, state: HealthState, summary: string, detail: string[], openTarget: ContextHealthComponent["openTarget"]): ContextHealthComponent {
  return { key, label, state, summary, detail: unique(detail), openTarget };
}

function releaseProposal(proposal: { id: string; title: string; summary: string; status: string; acceptedAt?: Date | null; updatedAt: Date; decisionRecord?: { statement: string } | null }): ReleaseTruthItem {
  return { id: `proposal:${proposal.id}`, label: proposal.title, detail: proposal.decisionRecord?.statement ?? proposal.summary, status: proposal.status, occurredAt: (proposal.acceptedAt ?? proposal.updatedAt).toISOString(), openTarget: { targetType: "change_proposal", targetRef: { proposalId: proposal.id } } };
}

function releaseEvidence(item: DeliveryEvidence): ReleaseTruthItem {
  return { id: item.id, label: item.label, detail: item.detail ?? "Persisted engineering evidence", status: item.status ?? "recorded", occurredAt: item.occurredAt, openTarget: item.openTarget };
}

function releaseFinding(finding: { id: string; summary: string; severity: string; updatedAt: Date; suggestedAction: string | null }): ReleaseTruthItem {
  return { id: `fde:${finding.id}`, label: finding.summary, detail: finding.suggestedAction ?? "Human review required.", status: finding.severity, occurredAt: finding.updatedAt.toISOString(), openTarget: { targetType: "fde_finding", targetRef: { findingId: finding.id } } };
}

const githubEvidenceSelect = {
  id: true, evidenceType: true, providerId: true, title: true, summary: true, status: true,
  occurredAt: true, createdAt: true, sourceUrl: true, sha: true, repositoryOwner: true,
  repositoryName: true, payloadJson: true
} as const;

function byOccurredAtDesc(a: DeliveryEvidence, b: DeliveryEvidence) {
  return Date.parse(b.occurredAt ?? "") - Date.parse(a.occurredAt ?? "");
}

function assessProductionCandidate(observations: DeliveryEvidence[]) {
  const production = observations.filter((item) => isDeploymentEvidence(item) && ["production", "prod"].includes(item.environment?.toLowerCase() ?? ""));
  const repositories = new Set(production.map((item) => item.repository).filter((value): value is string => Boolean(value)));
  if (!production.length) return { candidate: null, unknown: true, reason: "Production candidate could not be identified from authorized persisted evidence." };
  if (repositories.size > 1) return { candidate: null, unknown: true, reason: "Production observations span multiple repositories; no release candidate scope is selected." };
  const latest = production[0];
  if (!latest.occurredAt || !Number.isFinite(Date.parse(latest.occurredAt)) || !sameRevision(latest, latest)) {
    return { candidate: null, unknown: true, reason: "Latest production observation is missing a full revision or repository identity." };
  }
  return { candidate: latest, unknown: false, reason: null as string | null };
}

function latestEvidenceByIdentity(items: DeliveryEvidence[]) {
  const latest = new Map<string, DeliveryEvidence>();
  for (const item of items.sort(byOccurredAtDesc)) {
    const identity = item.identity ?? item.id;
    if (!latest.has(identity)) latest.set(identity, item);
  }
  return [...latest.values()];
}

function weeklyBriefDto(row: { id: string; weekStart: Date; weekEnd: Date; sourceFingerprint: string; contentJson: unknown; generatedAt: Date }): WeeklyBriefDto {
  return { id: row.id, weekStart: dateOnly(row.weekStart), weekEnd: dateOnly(row.weekEnd), sourceFingerprint: row.sourceFingerprint, content: row.contentJson as WeeklyBriefContent, generatedAt: row.generatedAt.toISOString() };
}

function receiptDto(row: { id: string; proposalId: string; decisionRecordId: string | null; receiptVersion: number; contentHash: string; receiptJson: unknown; issuedAt: Date }): DecisionReceiptDto {
  return { id: row.id, proposalId: row.proposalId, decisionRecordId: row.decisionRecordId, receiptVersion: row.receiptVersion, contentHash: row.contentHash, content: row.receiptJson as DecisionReceiptContent, issuedAt: row.issuedAt.toISOString(), immutable: true };
}

function currentUtcWeek() {
  const now = new Date();
  const day = now.getUTCDay() || 7;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 1));
  const end = new Date(start.getTime() + 7 * 86_400_000);
  return { start, end };
}

function dateOnly(value: Date) { return value.toISOString().slice(0, 10); }
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : []; }
function unique(values: string[]): string[] { return Array.from(new Set(values.filter(Boolean))); }
function uniqueByNormalizedText(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().replace(/\s+/g, " ").replace(/[.:]+$/, "").toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function formatConflict(title: string, summary: string) {
  const cleanTitle = title.trim();
  const cleanSummary = summary.trim();
  const comparableTitle = cleanTitle.replace(/[.:]+$/, "").toLocaleLowerCase();
  const comparableSummary = cleanSummary.replace(/[.:]+$/, "").toLocaleLowerCase();
  return comparableTitle === comparableSummary
    ? cleanTitle
    : `${cleanTitle}: ${cleanSummary}`;
}
function humanize(value: string) { return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase()); }
function latestDate(items: DeliveryEvidence[]) { return latestIso(items.map((item) => item.occurredAt).filter((value): value is string => Boolean(value))); }
function latestIso(values: string[]) { return values.length ? [...values].sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null : null; }
function summarizeJson(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return unique(value.flatMap(summarizeJson)).slice(0, 30);
  if (typeof value !== "object") return [String(value)];
  return unique(Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => summarizeJson(entry).map((line) => `${humanize(key)}: ${line}`))).slice(0, 30);
}
