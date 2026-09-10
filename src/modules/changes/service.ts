import { AppError } from "../../app/errors.js";
import type { AppEnv } from "../../config/env.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";
import { jobKeys } from "../../lib/jobs/keys.js";
import type { JobDispatcher } from "../../lib/jobs/types.js";
import { JobNames } from "../../lib/jobs/types.js";
import { AuditService } from "../audit/service.js";
import { BrainService } from "../brain/service.js";
import { ProjectService } from "../projects/service.js";
import type { PrismaClient } from "@prisma/client";

function acceptedOverlayText(proposal: { newUnderstandingJson: unknown; summary: string }) {
  const value = proposal.newUnderstandingJson;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["content", "text", "summary", "requirement", "decision"]) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }
  return proposal.summary;
}

function linkRefIds(proposal: { links?: Array<{ linkType: string; linkRefId: string }> }, linkType: string) {
  return Array.from(
    new Set((proposal.links ?? []).filter((link) => link.linkType === linkType).map((link) => link.linkRefId))
  );
}

export class ChangeProposalService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly jobs: JobDispatcher,
    private readonly projectService: ProjectService,
    private readonly brainService: BrainService,
    private readonly auditService: AuditService,
    private readonly env?: Pick<AppEnv, "BETA_PRODUCT_BRAIN_MUTATION_FROM_COMMUNICATIONS" | "BETA_COMMUNICATION_AUTO_APPLY_ENABLED">
  ) {}

  async list(projectId: string, actorUserId: string) {
    await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    return this.prisma.specChangeProposal.findMany({
      where: {
        projectId
      },
      include: {
        links: true,
        decisionRecord: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });
  }

  async get(projectId: string, proposalId: string, actorUserId: string) {
    await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    return this.prisma.specChangeProposal.findFirstOrThrow({
      where: {
        id: proposalId,
        projectId
      },
      include: {
        links: true,
        decisionRecord: true
      }
    });
  }

  async create(
    projectId: string,
    actorUserId: string,
    input: {
      title: string;
      summary: string;
      proposalType: "requirement_change" | "decision_change" | "clarification" | "contradiction_resolution";
      oldUnderstanding?: Record<string, unknown>;
      newUnderstanding?: Record<string, unknown>;
      impactSummary?: Record<string, unknown>;
      affectedDocumentSectionIds: string[];
      affectedBrainNodeIds: string[];
      communicationMessageIds: string[];
      externalEvidenceRefs: string[];
    }
  ) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await this.validateLinkTargets(projectId, input);

    const proposal = await this.prisma.$transaction(async (tx) => {
      const created = await tx.specChangeProposal.create({
        data: {
          projectId,
          title: input.title,
          summary: input.summary,
          proposalType: input.proposalType,
          status: "needs_review",
          sourceMessageCount: input.communicationMessageIds.length,
          oldUnderstandingJson: input.oldUnderstanding as object | undefined,
          newUnderstandingJson: input.newUnderstanding as object | undefined,
          impactSummaryJson: input.impactSummary as object | undefined,
          externalEvidenceRefsJson: input.externalEvidenceRefs
        }
      });

      const links = [
        ...input.affectedDocumentSectionIds.map((sectionId) => ({
          specChangeProposalId: created.id,
          projectId,
          linkType: "document_section" as const,
          linkRefId: sectionId,
          relationship: "affected" as const
        })),
        ...input.affectedBrainNodeIds.map((nodeId) => ({
          specChangeProposalId: created.id,
          projectId,
          linkType: "brain_node" as const,
          linkRefId: nodeId,
          relationship: "affected" as const
        })),
        ...input.communicationMessageIds.map((messageId) => ({
          specChangeProposalId: created.id,
          projectId,
          linkType: "message" as const,
          linkRefId: messageId,
          relationship: "source" as const
        }))
      ];

      if (links.length > 0) {
        await tx.specChangeLink.createMany({
          data: links
        });
      }

      return created;
    });

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "change_proposal_created",
      entityType: "spec_change_proposal",
      entityId: proposal.id,
      payload: input
    });

    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, "change_proposal_created");

    return this.get(projectId, proposal.id, actorUserId);
  }

  async createOrUpdateSystemProposal(
    projectId: string,
    actorUserId: string,
    input: {
      existingProposalId?: string | null;
      title: string;
      summary: string;
      proposalType: "requirement_change" | "decision_change" | "clarification" | "contradiction_resolution";
      oldUnderstanding?: Record<string, unknown>;
      newUnderstanding?: Record<string, unknown>;
      impactSummary?: Record<string, unknown>;
      affectedDocumentSectionIds: string[];
      affectedBrainNodeIds: string[];
      communicationMessageIds: string[];
      externalEvidenceRefs: string[];
    }
  ) {
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    if (member.projectRole === "client") {
      throw new AppError(403, "Clients cannot create internal proposals", "change_proposal_access_denied");
    }

    await this.validateLinkTargets(projectId, input);
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });

    const result = await this.prisma.$transaction(async (tx) => {
      const existing =
        input.existingProposalId
          ? await tx.specChangeProposal.findFirst({
              where: {
                id: input.existingProposalId,
                projectId
              }
            })
          : null;

      const canUpdateExisting =
        existing && existing.status !== "accepted" && existing.status !== "rejected" && existing.status !== "superseded";

      if (canUpdateExisting) {
        const claimed = await tx.specChangeProposal.updateMany({
            where: { id: existing.id, projectId, status: { in: ["detected", "needs_review"] }, updatedAt: existing.updatedAt },
            data: {
              title: input.title,
              summary: input.summary,
              proposalType: input.proposalType,
              status: "needs_review",
              sourceMessageCount: input.communicationMessageIds.length,
              oldUnderstandingJson: input.oldUnderstanding as object | undefined,
              newUnderstandingJson: input.newUnderstanding as object | undefined,
              impactSummaryJson: input.impactSummary as object | undefined,
              externalEvidenceRefsJson: input.externalEvidenceRefs
            }
          });
        if (claimed.count !== 1) throw new AppError(409, "Proposal changed during refresh; reload before updating", "proposal_state_changed");
      }
      const proposal = canUpdateExisting
        ? await tx.specChangeProposal.findUniqueOrThrow({ where: { id: existing.id } })
        : await tx.specChangeProposal.create({
            data: {
              projectId,
              title: input.title,
              summary: input.summary,
              proposalType: input.proposalType,
              status: "needs_review",
              sourceMessageCount: input.communicationMessageIds.length,
              oldUnderstandingJson: input.oldUnderstanding as object | undefined,
              newUnderstandingJson: input.newUnderstanding as object | undefined,
              impactSummaryJson: input.impactSummary as object | undefined,
              externalEvidenceRefsJson: input.externalEvidenceRefs
            }
          });

      await tx.specChangeLink.deleteMany({
        where: {
          specChangeProposalId: proposal.id
        }
      });

      const links = [
        ...input.affectedDocumentSectionIds.map((sectionId) => ({
          specChangeProposalId: proposal.id,
          projectId,
          linkType: "document_section" as const,
          linkRefId: sectionId,
          relationship: "affected" as const
        })),
        ...input.affectedBrainNodeIds.map((nodeId) => ({
          specChangeProposalId: proposal.id,
          projectId,
          linkType: "brain_node" as const,
          linkRefId: nodeId,
          relationship: "affected" as const
        })),
        ...input.communicationMessageIds.map((messageId) => ({
          specChangeProposalId: proposal.id,
          projectId,
          linkType: "message" as const,
          linkRefId: messageId,
          relationship: "source" as const
        }))
      ];

      if (links.length > 0) {
        await tx.specChangeLink.createMany({
          data: links
        });
      }

      return { proposal, created: !canUpdateExisting };
    });

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: result.created ? "change_proposal_created" : "change_proposal_updated",
      entityType: "spec_change_proposal",
      entityId: result.proposal.id,
      payload: {
        source: "live_doc",
        title: input.title
      }
    });

    await enqueueProjectDashboardRefreshByProjectId(
      this.prisma,
      this.jobs,
      projectId,
      result.created ? "change_proposal_created" : "change_proposal_updated"
    );

    return this.get(projectId, result.proposal.id, actorUserId);
  }

  async accept(projectId: string, proposalId: string, actorUserId: string) {
    const approval = await this.projectService.ensureProjectTruthApprover(projectId, actorUserId);

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const proposal = await this.prisma.specChangeProposal.findFirstOrThrow({
      where: {
        id: proposalId,
        projectId
      },
      include: {
        links: true,
        decisionRecord: true
      }
    });

    if (proposal.status === "accepted") {
      if (!proposal.acceptedBrainVersionId && this.shouldApplyAcceptedProposalToProductBrain(proposal)) {
        await this.enqueueAcceptedChangeApplication(projectId, proposalId);
        await enqueueProjectDashboardRefreshByProjectId(
          this.prisma,
          this.jobs,
          projectId,
          "change_proposal_accepted_retry"
        );
      }
      return this.get(projectId, proposalId, actorUserId);
    }

    if (proposal.status === "superseded") {
      throw new AppError(409, "Superseded proposal can no longer be accepted", "proposal_not_acceptable");
    }

    const hasSourceEvidence =
      proposal.sourceMessageCount > 0 || (Array.isArray(proposal.externalEvidenceRefsJson) && proposal.externalEvidenceRefsJson.length > 0);
    const hasAffectedSections = proposal.links.some((link) => link.linkType === "document_section");
    const hasAffectedNodes = proposal.links.some((link) => link.linkType === "brain_node");
    if (!hasSourceEvidence || !hasAffectedSections || (this.requireBrainNodeLinksForAcceptance(proposal) && !hasAffectedNodes)) {
      throw new AppError(
        422,
        "Proposal is missing provenance-critical links required for acceptance",
        "proposal_missing_provenance"
      );
    }
    await this.validatePersistedProposalLinks(projectId, proposal);

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.specChangeProposal.updateMany({
        where: {
          id: proposalId,
          projectId,
          status: proposal.status,
          ...(proposal.updatedAt ? { updatedAt: proposal.updatedAt } : {})
        },
        data: {
          status: "accepted",
          acceptedBy: actorUserId,
          acceptedAt: new Date()
        }
      });
      if (claimed.count !== 1) {
        throw new AppError(409, "Proposal changed while it was being reviewed; reload before deciding", "proposal_state_changed");
      }
      let decisionRecordId = proposal.decisionRecordId;
      if (proposal.proposalType === "decision_change") {
        if (decisionRecordId) {
          await tx.decisionRecord.update({
            where: { id: decisionRecordId },
            data: {
              status: "accepted",
              acceptedBy: actorUserId,
              acceptedAt: new Date(),
              sourceSummary:
                proposal.sourceMessageCount > 0
                  ? `Accepted from ${proposal.sourceMessageCount} linked communication messages`
                  : "Accepted from explicit external evidence refs"
            }
          });
        } else {
          const decision = await tx.decisionRecord.create({
            data: {
              projectId,
              title: proposal.title,
              statement: proposal.summary,
              status: "accepted",
              sourceSummary:
                proposal.sourceMessageCount > 0
                  ? `Accepted from ${proposal.sourceMessageCount} linked communication messages`
                  : "Accepted from explicit external evidence refs",
              acceptedBy: actorUserId,
              acceptedAt: new Date()
            }
          });
          decisionRecordId = decision.id;
        }
      }

      await tx.specChangeProposal.update({
        where: { id: proposalId },
        data: {
          decisionRecordId
        }
      });

      const liveDocDraft = await tx.liveDocSectionDraft.findFirst({
        where: {
          projectId,
          linkedProposalId: proposalId
        }
      });

      if (liveDocDraft) {
        await tx.liveDocSectionDraft.update({
          where: { id: liveDocDraft.id },
          data: {
            status: "accepted"
          }
        });

        await tx.liveDocSectionRevision.upsert({
          where: {
            eventKey: `live-doc-proposal-accepted:${proposalId}`
          },
          update: {},
          create: {
            projectId,
            sectionKey: liveDocDraft.sectionKey,
            artifactVersionId: liveDocDraft.artifactVersionId,
            draftId: liveDocDraft.id,
            proposalId,
            actorUserId,
            eventType: "proposal_accepted",
            previousContent: liveDocDraft.baseContent,
            nextContent: liveDocDraft.proposedContent,
            changeSummary: `Accepted live doc proposal for ${liveDocDraft.sectionLabel}`,
            eventKey: `live-doc-proposal-accepted:${proposalId}`
          }
        });
      } else {
        const documentSectionLink = proposal.links.find((link) => link.linkType === "document_section");
        const documentSectionDelegate = "documentSection" in tx ? tx.documentSection : null;
        if (documentSectionLink && documentSectionDelegate && typeof documentSectionDelegate.findFirst === "function") {
          const sourceSection = await documentSectionDelegate.findFirst({
            where: {
              id: documentSectionLink.linkRefId,
              projectId
            },
            include: {
              documentVersion: true
            }
          });

          if (sourceSection) {
            await tx.liveDocSectionRevision.upsert({
              where: {
                eventKey: `live-doc-proposal-accepted:${proposalId}`
              },
              update: {},
              create: {
                projectId,
                sectionKey: `doc:${sourceSection.id}`,
                artifactVersionId: null,
                proposalId,
                actorUserId,
                eventType: "proposal_accepted",
                previousContent: sourceSection.normalizedText,
                nextContent: acceptedOverlayText(proposal),
                changeSummary: `Accepted proposal for ${sourceSection.headingPath.join(" > ") || sourceSection.anchorId}`,
                eventKey: `live-doc-proposal-accepted:${proposalId}`,
                sourceDocumentId: sourceSection.documentVersion.documentId,
                sourceDocumentVersionId: sourceSection.documentVersionId,
                documentSectionId: sourceSection.id,
                anchorId: sourceSection.anchorId
              }
            });
          }
        }
      }
    });

    if (this.shouldApplyAcceptedProposalToProductBrain(proposal)) {
      await this.enqueueAcceptedChangeApplication(projectId, proposalId);
    }

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "change_proposal_accepted",
      entityType: "spec_change_proposal",
      entityId: proposalId,
      payload: {
        acceptedByUserId: actorUserId,
        acceptedByAuthority: approval.authority,
        delegatedApproverGrantId: approval.delegatedApproverGrantId,
        proposalId,
        affectedDocumentSectionIds: linkRefIds(proposal, "document_section"),
        affectedBrainNodeIds: linkRefIds(proposal, "brain_node"),
        sourceMessageIds: linkRefIds(proposal, "message"),
        sourceThreadIds: linkRefIds(proposal, "thread")
      }
    });

    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, "change_proposal_accepted");

    return this.get(projectId, proposalId, actorUserId);
  }

  private async enqueueAcceptedChangeApplication(projectId: string, proposalId: string) {
    const jobKey = jobKeys.applyAcceptedChange(proposalId);
    await this.prisma.jobRun.upsert({
      where: {
        idempotencyKey: jobKey
      },
      update: {
        status: "pending",
        payloadJson: {
          projectId,
          proposalId
        }
      },
      create: {
        jobType: JobNames.applyAcceptedChange,
        status: "pending",
        idempotencyKey: jobKey,
        payloadJson: {
          projectId,
          proposalId
        }
      }
    });

    await this.jobs.enqueue(JobNames.applyAcceptedChange, { projectId, proposalId }, jobKey);
  }

  async reject(projectId: string, proposalId: string, actorUserId: string) {
    const approval = await this.projectService.ensureProjectTruthApprover(projectId, actorUserId);
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });

    const proposal = await this.prisma.specChangeProposal.findFirstOrThrow({
      where: { id: proposalId, projectId },
      include: { links: true }
    });

    if (proposal.status === "accepted") {
      throw new AppError(409, "Accepted proposals cannot be rejected", "accepted_proposal_cannot_be_rejected");
    }

    if (proposal.status === "rejected") {
      return this.get(projectId, proposalId, actorUserId);
    }

    await this.prisma.$transaction(async (tx) => {
    const claimed = await tx.specChangeProposal.updateMany({
      where: {
        id: proposalId,
        projectId,
        status: proposal.status,
        ...(proposal.updatedAt ? { updatedAt: proposal.updatedAt } : {})
      },
      data: {
        status: "rejected"
      }
    });
    if (claimed.count !== 1) {
      throw new AppError(409, "Proposal changed while it was being reviewed; reload before deciding", "proposal_state_changed");
    }

    const liveDocDraft = await tx.liveDocSectionDraft.findFirst({
      where: {
        projectId,
        linkedProposalId: proposalId
      }
    });

    if (liveDocDraft) {
      await tx.liveDocSectionDraft.update({
        where: { id: liveDocDraft.id },
        data: {
          status: "rejected"
        }
      });

      await tx.liveDocSectionRevision.upsert({
        where: {
          eventKey: `live-doc-proposal-rejected:${proposalId}`
        },
        update: {},
        create: {
          projectId,
          sectionKey: liveDocDraft.sectionKey,
          artifactVersionId: liveDocDraft.artifactVersionId,
          draftId: liveDocDraft.id,
          proposalId,
          actorUserId,
          eventType: "proposal_rejected",
          previousContent: liveDocDraft.baseContent,
          nextContent: liveDocDraft.proposedContent,
          changeSummary: `Rejected live doc proposal for ${liveDocDraft.sectionLabel}`,
          eventKey: `live-doc-proposal-rejected:${proposalId}`
        }
      });
    }

    await this.auditService.recordWithClient(tx, {
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "change_proposal_rejected",
      entityType: "spec_change_proposal",
      entityId: proposalId,
      payload: {
        rejectedByUserId: actorUserId,
        rejectedByAuthority: approval.authority,
        delegatedApproverGrantId: approval.delegatedApproverGrantId,
        proposalId,
        affectedDocumentSectionIds: linkRefIds(proposal, "document_section"),
        affectedBrainNodeIds: linkRefIds(proposal, "brain_node"),
        sourceMessageIds: linkRefIds(proposal, "message"),
        sourceThreadIds: linkRefIds(proposal, "thread")
      }
    });
    });

    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, "change_proposal_rejected");

    return this.get(projectId, proposalId, actorUserId);
  }

  async applyAcceptedProposal(projectId: string, proposalId: string) {
    const proposal = await this.prisma.specChangeProposal.findFirst({
      where: {
        id: proposalId,
        projectId,
        status: "accepted"
      },
      include: {
        links: true
      }
    });

    if (!proposal) {
      throw new AppError(404, "Accepted proposal not found", "accepted_proposal_not_found");
    }
    if (!this.shouldApplyAcceptedProposalToProductBrain(proposal)) {
      await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, "accepted_change_recorded");
      return proposal as any;
    }

    if (proposal.acceptedBrainVersionId) {
      const existing = await this.prisma.artifactVersion.findUnique({
        where: {
          id: proposal.acceptedBrainVersionId
        }
      });

      if (existing) {
        return existing;
      }
    }

    const shouldRefreshGraph = proposal.links.some(
      (link) => link.linkType === "brain_node" || link.linkType === "document_section"
    );

    if (shouldRefreshGraph) {
      await this.brainService.generateBrainGraph(projectId, proposal.acceptedBy);
    }

    const productBrain = await this.brainService.generateProductBrain(projectId, proposal.acceptedBy);
    await this.prisma.specChangeProposal.update({
      where: { id: proposalId },
      data: {
        acceptedBrainVersionId: productBrain.id
      }
    });

    const liveDocJobKey = jobKeys.generateLiveDoc(projectId, `${productBrain.id}:${proposalId}:accepted_change_applied`);
    await this.prisma.jobRun.upsert({
      where: {
        idempotencyKey: liveDocJobKey
      },
      update: {
        status: "pending",
        payloadJson: {
          projectId,
          actorUserId: proposal.acceptedBy,
          proposalId,
          reason: "accepted_change_applied"
        }
      },
      create: {
        jobType: JobNames.generateLiveDoc,
        status: "pending",
        idempotencyKey: liveDocJobKey,
        payloadJson: {
          projectId,
          actorUserId: proposal.acceptedBy,
          proposalId,
          reason: "accepted_change_applied"
        }
      }
    });
    await this.jobs.enqueue(
      JobNames.generateLiveDoc,
      {
        projectId,
        actorUserId: proposal.acceptedBy,
        proposalId,
        reason: "accepted_change_applied"
      },
      liveDocJobKey
    );

    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, "accepted_change_applied");

    return productBrain;
  }

  private async validateLinkTargets(
    projectId: string,
    input: {
      affectedDocumentSectionIds: string[];
      affectedBrainNodeIds: string[];
      communicationMessageIds: string[];
    }
  ) {
    const [sections, nodes, messages] = await Promise.all([
      input.affectedDocumentSectionIds.length
        ? this.prisma.documentSection.count({
            where: {
              projectId,
              id: {
                in: input.affectedDocumentSectionIds
              }
            }
          })
        : Promise.resolve(0),
      input.affectedBrainNodeIds.length
        ? this.prisma.brainNode.count({
            where: {
              projectId,
              id: {
                in: input.affectedBrainNodeIds
              }
            }
          })
        : Promise.resolve(0),
      input.communicationMessageIds.length
        ? this.prisma.communicationMessage.count({
            where: {
              projectId,
              id: {
                in: input.communicationMessageIds
              },
              isDeletedByProvider: false
            }
          })
        : Promise.resolve(0)
    ]);

    if (sections !== input.affectedDocumentSectionIds.length) {
      throw new AppError(422, "One or more document section links are invalid", "invalid_document_section_links");
    }

    if (nodes !== input.affectedBrainNodeIds.length) {
      throw new AppError(422, "One or more brain node links are invalid", "invalid_brain_node_links");
    }

    if (messages !== input.communicationMessageIds.length) {
      throw new AppError(422, "One or more communication message links are invalid", "invalid_message_links");
    }
  }

  private async validatePersistedProposalLinks(
    projectId: string,
    proposal: {
      sourceMessageCount: number;
      links: Array<{
        linkType: string;
        linkRefId: string;
      }>;
    }
  ) {
    const sectionIds = this.uniqueProposalLinkIds(proposal.links, "document_section");
    const nodeIds = this.uniqueProposalLinkIds(proposal.links, "brain_node");
    const messageIds = this.uniqueProposalLinkIds(proposal.links, "message");
    const threadIds = this.uniqueProposalLinkIds(proposal.links, "thread");

    if (proposal.sourceMessageCount > 0 && messageIds.length !== proposal.sourceMessageCount) {
      throw new AppError(422, "Proposal source message links do not match source message count", "proposal_source_links_invalid");
    }

    const [sections, nodes, messages, threads] = await Promise.all([
      this.countProjectRows("documentSection", projectId, sectionIds),
      this.countProjectRows("brainNode", projectId, nodeIds),
      this.countProjectRows("communicationMessage", projectId, messageIds),
      this.countProjectRows("communicationThread", projectId, threadIds)
    ]);

    if (sections !== sectionIds.length) {
      throw new AppError(422, "One or more accepted proposal document section links are invalid", "invalid_document_section_links");
    }
    if (nodeIds.length > 0 && nodes !== nodeIds.length) {
      throw new AppError(422, "One or more accepted proposal brain node links are invalid", "invalid_brain_node_links");
    }
    if (messages !== messageIds.length) {
      throw new AppError(422, "One or more accepted proposal source message links are invalid", "invalid_message_links");
    }
    if (threads !== threadIds.length) {
      throw new AppError(422, "One or more accepted proposal source thread links are invalid", "invalid_thread_links");
    }
  }

  private uniqueProposalLinkIds(links: Array<{ linkType: string; linkRefId: string }>, linkType: string) {
    return Array.from(new Set(links.filter((link) => link.linkType === linkType).map((link) => link.linkRefId)));
  }

  private async countProjectRows(
    modelName: "documentSection" | "brainNode" | "communicationMessage" | "communicationThread",
    projectId: string,
    ids: string[]
  ) {
    if (ids.length === 0) {
      return 0;
    }
    const where = {
      projectId,
      id: { in: ids }
    };
    switch (modelName) {
      case "documentSection":
        return this.prisma.documentSection.count({ where });
      case "brainNode":
        return this.prisma.brainNode.count({ where });
      case "communicationMessage":
        return this.prisma.communicationMessage.count({ where: { ...where, isDeletedByProvider: false } });
      case "communicationThread":
        return this.prisma.communicationThread.count({ where });
    }
  }

  private isCommunicationDerivedProposal(proposal: { sourceMessageCount?: number; links?: Array<{ linkType: string }> }) {
    return Boolean(proposal.sourceMessageCount && proposal.sourceMessageCount > 0) ||
      Boolean(proposal.links?.some((link) => link.linkType === "message" || link.linkType === "thread"));
  }

  private shouldApplyAcceptedProposalToProductBrain(proposal: { sourceMessageCount?: number; links?: Array<{ linkType: string }> }) {
    if (this.isCommunicationDerivedProposal(proposal) && this.env?.BETA_PRODUCT_BRAIN_MUTATION_FROM_COMMUNICATIONS === false) {
      return false;
    }
    if (this.env?.BETA_COMMUNICATION_AUTO_APPLY_ENABLED === false && this.isCommunicationDerivedProposal(proposal)) {
      return false;
    }
    return true;
  }

  private requireBrainNodeLinksForAcceptance(proposal: { sourceMessageCount?: number; links?: Array<{ linkType: string }> }) {
    return !(this.isCommunicationDerivedProposal(proposal) && this.env?.BETA_PRODUCT_BRAIN_MUTATION_FROM_COMMUNICATIONS === false);
  }
}
