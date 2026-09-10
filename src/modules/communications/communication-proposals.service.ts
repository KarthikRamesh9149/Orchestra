import type { PrismaClient, ProposalType } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import type { AppEnv } from "../../config/env.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";
import type { JobDispatcher } from "../../lib/jobs/types.js";
import { AuditService } from "../audit/service.js";
import { ProjectService } from "../projects/service.js";

type ValidatedRefs = {
  documentSectionIds: string[];
  brainNodeIds: string[];
};

type InsightRecord = {
  id: string;
  projectId: string;
  threadId: string;
  summary: string;
  confidence: { toNumber(): number } | number;
  insightType: string;
  proposalType: ProposalType | null;
  shouldCreateProposal: boolean;
  shouldCreateDecision: boolean;
  oldUnderstandingJson: unknown;
  newUnderstandingJson: unknown;
  impactSummaryJson: unknown;
  uncertaintyJson: unknown;
  decisionStatement: string | null;
  generatedProposalId: string | null;
  generatedDecisionId: string | null;
};

export class CommunicationProposalsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly jobs: JobDispatcher,
    private readonly env?: Pick<AppEnv, "BETA_PRODUCT_BRAIN_MUTATION_FROM_COMMUNICATIONS">
  ) {}

  async createProposalFromMessageInsight(
    projectId: string,
    insightId: string,
    actorUserId: string | null,
    input: {
      insight: InsightRecord;
      messageId: string;
      sourceMessageIds?: string[];
      validatedRefs: ValidatedRefs;
      sourceKind?: "message" | "thread";
    }
  ) {
    if (actorUserId) {
      await this.ensureProposalMutation(projectId, actorUserId);
    }

    if (input.insight.projectId !== projectId) {
      throw new AppError(404, "Insight not found for project", "insight_not_found");
    }

    if (!input.insight.shouldCreateProposal && !input.insight.shouldCreateDecision) {
      throw new AppError(422, "Insight is not eligible for proposal generation", "insight_not_proposal_eligible");
    }

    if (input.insight.generatedProposalId) {
      const existing = await this.prisma.specChangeProposal.findFirst({
        where: { id: input.insight.generatedProposalId, projectId }
      });
      if (existing) {
        return {
          proposalId: existing.id,
          decisionId: existing.decisionRecordId ?? null,
          deduped: true
        };
      }
    }

    const proposalType = input.insight.proposalType ?? this.mapProposalType(input.insight.insightType);
    const sourceMessageIds = Array.from(new Set([...(input.sourceMessageIds ?? []), input.messageId].filter(Boolean)));
    const missingAffectedRefs =
      input.validatedRefs.documentSectionIds.length === 0 ||
      (this.requireBrainNodeRefs() && input.validatedRefs.brainNodeIds.length === 0);
    if (missingAffectedRefs) {
      throw new AppError(422, "Insight is missing validated affected refs", "insight_missing_validated_refs");
    }
    await this.validateProjectRefs(projectId, {
      sourceMessageIds,
      threadId: input.insight.threadId,
      documentSectionIds: input.validatedRefs.documentSectionIds,
      brainNodeIds: input.validatedRefs.brainNodeIds
    });

    const deduped = await this.findDuplicate(projectId, {
      proposalType,
      summary: input.insight.summary,
      documentSectionIds: input.validatedRefs.documentSectionIds,
      brainNodeIds: input.validatedRefs.brainNodeIds,
      sourceMessageIds,
      decisionStatement: input.insight.decisionStatement
    });
    if (deduped) {
      await this.updateInsightConversion(projectId, input.sourceKind ?? "message", insightId, {
        status: "superseded",
        generatedProposalId: deduped.id
      });

      return {
        proposalId: deduped.id,
        decisionId: deduped.decisionRecordId ?? null,
        deduped: true
      };
    }

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { orgId: true }
    });

    const created = await this.prisma.$transaction(async (tx) => {
      let decisionId: string | null = null;
      if (input.insight.shouldCreateDecision || input.insight.insightType === "decision" || input.insight.insightType === "approval") {
        const duplicateDecision = await tx.decisionRecord.findFirst({
          where: {
            projectId,
            status: { in: ["open", "accepted"] },
            OR: [
              { title: { contains: input.insight.summary.slice(0, 80), mode: "insensitive" } },
              ...(input.insight.decisionStatement
                ? [{ statement: { contains: input.insight.decisionStatement.slice(0, 120), mode: "insensitive" as const } }]
                : [])
            ]
          }
        });
        if (duplicateDecision) {
          decisionId = duplicateDecision.id;
        } else {
          const decision = await tx.decisionRecord.create({
            data: {
              projectId,
              title: input.insight.summary.slice(0, 180),
              statement: input.insight.decisionStatement ?? input.insight.summary,
              status: "open",
              sourceSummary: "Generated from communication insight review"
            }
          });
          decisionId = decision.id;
        }
      }

      const proposal = await tx.specChangeProposal.create({
        data: {
          projectId,
          title: input.insight.summary.slice(0, 180),
          summary: input.insight.summary,
          proposalType,
          status: "needs_review",
          sourceMessageCount: sourceMessageIds.length,
          oldUnderstandingJson: this.toJsonObject(input.insight.oldUnderstandingJson),
          newUnderstandingJson: this.toJsonObject(input.insight.newUnderstandingJson),
          impactSummaryJson: this.toJsonObject(input.insight.impactSummaryJson),
          externalEvidenceRefsJson: [],
          decisionRecordId: decisionId
        }
      });

      const links = [
        ...sourceMessageIds.map((messageId) => ({
          specChangeProposalId: proposal.id,
          projectId,
          linkType: "message" as const,
          linkRefId: messageId,
          relationship: "source" as const
        })),
        {
          specChangeProposalId: proposal.id,
          projectId,
          linkType: "thread" as const,
          linkRefId: input.insight.threadId,
          relationship: "evidence" as const
        },
        ...input.validatedRefs.documentSectionIds.map((sectionId) => ({
          specChangeProposalId: proposal.id,
          projectId,
          linkType: "document_section" as const,
          linkRefId: sectionId,
          relationship: "affected" as const
        })),
        ...input.validatedRefs.brainNodeIds.map((nodeId) => ({
          specChangeProposalId: proposal.id,
          projectId,
          linkType: "brain_node" as const,
          linkRefId: nodeId,
          relationship: "affected" as const
        }))
      ];
      await tx.specChangeLink.createMany({ data: links });

      if ((input.sourceKind ?? "message") === "thread") {
        const updated = await tx.threadInsight.updateMany({
          where: { id: insightId, projectId },
          data: {
            status: decisionId ? "converted_to_decision" : "converted_to_proposal",
            generatedProposalId: proposal.id,
            generatedDecisionId: decisionId
          }
        });
        if (updated.count !== 1) {
          throw new AppError(404, "Thread insight not found for project", "insight_not_found");
        }
      } else {
        const updated = await tx.messageInsight.updateMany({
          where: { id: insightId, projectId },
          data: {
            status: decisionId ? "converted_to_decision" : "converted_to_proposal",
            generatedProposalId: proposal.id,
            generatedDecisionId: decisionId
          }
        });
        if (updated.count !== 1) {
          throw new AppError(404, "Message insight not found for project", "insight_not_found");
        }
      }

      return { proposalId: proposal.id, decisionId };
    });

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId: actorUserId ?? undefined,
      eventType: "communication_change_proposal_created",
      entityType: "spec_change_proposal",
      entityId: created.proposalId,
      payload: { insightId, decisionId: created.decisionId }
    });

    if (created.decisionId) {
      await this.auditService.record({
        orgId: project.orgId,
        projectId,
        actorUserId: actorUserId ?? undefined,
        eventType: "communication_decision_candidate_created",
        entityType: "decision_record",
        entityId: created.decisionId,
        payload: { insightId, proposalId: created.proposalId }
      });
    }

    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, "communication_proposal_created");

    return {
      proposalId: created.proposalId,
      decisionId: created.decisionId,
      deduped: false
    };
  }

  private async findDuplicate(
    projectId: string,
    input: {
      proposalType: ProposalType;
      summary: string;
      documentSectionIds: string[];
      brainNodeIds: string[];
      sourceMessageIds: string[];
      decisionStatement: string | null;
    }
  ) {
    const candidates = await this.prisma.specChangeProposal.findMany({
      where: {
        projectId,
        proposalType: input.proposalType,
        status: { in: ["needs_review", "accepted"] },
        OR: [
          { title: { contains: input.summary.slice(0, 40), mode: "insensitive" } },
          { summary: { contains: input.summary.slice(0, 60), mode: "insensitive" } }
        ]
      },
      include: { links: true },
      orderBy: { createdAt: "desc" },
      take: 25
    });

    return candidates.find((candidate) => {
      const sectionIds = candidate.links.filter((link) => link.linkType === "document_section").map((link) => link.linkRefId);
      const nodeIds = candidate.links.filter((link) => link.linkType === "brain_node").map((link) => link.linkRefId);
      const messageIds = candidate.links.filter((link) => link.linkType === "message").map((link) => link.linkRefId);
      if (messageIds.some((id) => input.sourceMessageIds.includes(id))) {
        return true;
      }
      if (
        input.proposalType === "decision_change" &&
        input.decisionStatement &&
        candidate.decisionRecordId &&
        candidate.summary.toLowerCase().includes(input.decisionStatement.slice(0, 80).toLowerCase())
      ) {
        return true;
      }
      return (
        sectionIds.some((id) => input.documentSectionIds.includes(id)) &&
        nodeIds.some((id) => input.brainNodeIds.includes(id))
      );
    });
  }

  private async ensureProposalMutation(projectId: string, actorUserId: string) {
    if (typeof this.projectService.ensureProjectTruthApprover === "function") {
      return this.projectService.ensureProjectTruthApprover(projectId, actorUserId);
    }
    return this.projectService.ensureProjectManager(projectId, actorUserId);
  }

  private requireBrainNodeRefs() {
    return this.env?.BETA_PRODUCT_BRAIN_MUTATION_FROM_COMMUNICATIONS !== false;
  }

  private mapProposalType(insightType: string): ProposalType {
    switch (insightType) {
      case "decision":
      case "approval":
        return "decision_change";
      case "contradiction":
        return "contradiction_resolution";
      case "clarification":
        return "clarification";
      default:
        return "requirement_change";
    }
  }

  private toJsonObject(value: unknown) {
    return value && typeof value === "object" ? (value as object) : undefined;
  }

  private async updateInsightConversion(
    projectId: string,
    sourceKind: "message" | "thread",
    insightId: string,
    data: {
      status: "superseded";
      generatedProposalId: string;
    }
  ) {
    if (sourceKind === "thread") {
      const updated = await this.prisma.threadInsight.updateMany({
        where: { id: insightId, projectId },
        data
      });
      if (updated.count !== 1) {
        throw new AppError(404, "Thread insight not found for project", "insight_not_found");
      }
      return;
    }

    const updated = await this.prisma.messageInsight.updateMany({
      where: { id: insightId, projectId },
      data
    });
    if (updated.count !== 1) {
      throw new AppError(404, "Message insight not found for project", "insight_not_found");
    }
  }

  private async validateProjectRefs(
    projectId: string,
    input: {
      sourceMessageIds: string[];
      threadId: string;
      documentSectionIds: string[];
      brainNodeIds: string[];
    }
  ) {
    const [messages, thread, sections, nodes] = await Promise.all([
      this.prisma.communicationMessage.count({
        where: {
          projectId,
          id: { in: input.sourceMessageIds },
          isDeletedByProvider: false
        }
      }),
      this.prisma.communicationThread.count({
        where: {
          projectId,
          id: input.threadId
        }
      }),
      this.prisma.documentSection.count({
        where: {
          projectId,
          id: { in: input.documentSectionIds }
        }
      }),
      this.prisma.brainNode.count({
        where: {
          projectId,
          id: { in: input.brainNodeIds }
        }
      })
    ]);

    if (messages !== input.sourceMessageIds.length) {
      throw new AppError(422, "One or more source message links are invalid", "invalid_message_links");
    }
    if (thread !== 1) {
      throw new AppError(422, "Source thread link is invalid", "invalid_thread_links");
    }
    if (sections !== input.documentSectionIds.length) {
      throw new AppError(422, "One or more affected document section links are invalid", "invalid_document_section_links");
    }
    if (nodes !== input.brainNodeIds.length) {
      throw new AppError(422, "One or more affected brain node links are invalid", "invalid_brain_node_links");
    }
  }
}
