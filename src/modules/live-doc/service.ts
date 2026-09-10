import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../../app/errors.js";
import type { GenerationProvider } from "../../lib/ai/provider.js";
import { AuditService } from "../audit/service.js";
import { productBrainSchema } from "../brain/schemas.js";
import { ChangeProposalService } from "../changes/service.js";
import { ProjectService } from "../projects/service.js";
import { codingRequirementsPayloadSchema } from "../coding-requirements/schemas.js";
import {
  liveDocArtifactSchema,
  type LiveDocArtifact,
  type LiveDocSectionArtifact
} from "./schemas.js";

type InternalMemberRole = "manager" | "dev";

type SourceRef = {
  refType: "document_section" | "brain_node" | "change_proposal" | "decision_record" | "message";
  refId: string;
  label: string;
  documentId?: string;
  documentVersionId?: string;
  anchorId?: string;
  pageNumber?: number;
};

type OverlayMarkerType =
  | "accepted_change"
  | "accepted_decision"
  | "superseded_change"
  | "pending_review_internal_only"
  | "conflict_detected_internal_only";

type OverlayMarker = {
  markerType: OverlayMarkerType;
  label: string;
  refType?: SourceRef["refType"];
  refId?: string;
  visibility: "internal" | "client_safe";
};

type PrdBackedSection = {
  id: string;
  documentVersionId: string;
  projectId: string;
  anchorId: string;
  headingPath: string[];
  pageNumber: number | null;
  normalizedText: string;
  orderIndex: number;
};

function proposalRefs(proposal: any, linkType: string): string[] {
  return Array.from(
    new Set<string>(
      (proposal?.links ?? []).filter((link: any) => link.linkType === linkType).map((link: any) => link.linkRefId)
    )
  );
}

function proposalOpenTargets(proposal: any) {
  return [
    {
      targetType: "change_proposal",
      targetRef: { proposalId: proposal.id }
    },
    ...proposalRefs(proposal, "message").map((messageId) => ({
      targetType: "message",
      targetRef: { messageId }
    })),
    ...proposalRefs(proposal, "thread").map((threadId) => ({
      targetType: "thread",
      targetRef: { threadId }
    }))
  ];
}

function unique<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(item);
  }
  return output;
}

function toInitials(name?: string | null) {
  if (!name) return "SY";
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);
  return parts.map((part) => part[0]!.toUpperCase()).join("") || "SY";
}

function tokenize(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4)
        .slice(0, 16)
    )
  );
}

function buildContainsFilters(tokens: string[], field: string) {
  return tokens.map((token) => ({
    [field]: {
      contains: token,
      mode: "insensitive" as const
    }
  }));
}

function renderBulletList(values: string[]) {
  if (values.length === 0) return "None recorded.";
  return values.map((value) => `- ${value}`).join("\n");
}

function buildSectionContent(label: string, values: string[] | string) {
  if (typeof values === "string") {
    return values.trim();
  }
  return values.length > 0 ? renderBulletList(values) : `${label}: none recorded.`;
}

function buildOverlayMarkers(input: {
  section: LiveDocSectionArtifact;
  draft?: any | null;
  latestRevision?: any | null;
  linkedChanges?: any[];
}): OverlayMarker[] {
  const markers: OverlayMarker[] = [];
  for (const ref of input.section.sourceRefs) {
    if (ref.refType === "change_proposal") {
      markers.push({
        markerType: "accepted_change",
        label: ref.label,
        refType: ref.refType,
        refId: ref.refId,
        visibility: "client_safe"
      });
    }
    if (ref.refType === "decision_record") {
      markers.push({
        markerType: "accepted_decision",
        label: ref.label,
        refType: ref.refType,
        refId: ref.refId,
        visibility: "client_safe"
      });
    }
  }

  if (input.draft && (input.draft.status === "draft" || input.draft.status === "needs_review")) {
    markers.push({
      markerType: "pending_review_internal_only",
      label: input.draft.linkedProposal?.title ?? "Pending review",
      refType: "change_proposal",
      refId: input.draft.linkedProposalId ?? input.draft.linkedProposal?.id,
      visibility: "internal"
    });
  }

  const superseded = [
    ...(input.linkedChanges ?? []),
    input.draft?.linkedProposal,
    input.latestRevision?.proposal
  ].filter((proposal) => proposal?.status === "superseded");
  for (const proposal of superseded) {
    markers.push({
      markerType: "superseded_change",
      label: proposal.title ?? "Superseded change",
      refType: "change_proposal",
      refId: proposal.id,
      visibility: "internal"
    });
  }

  const conflict = [
    input.draft?.linkedProposal,
    ...(input.linkedChanges ?? [])
  ].find((proposal) => /conflict/i.test(`${proposal?.title ?? ""} ${proposal?.summary ?? ""}`));
  if (conflict) {
    markers.push({
      markerType: "conflict_detected_internal_only",
      label: conflict.title ?? "Conflict detected",
      refType: "change_proposal",
      refId: conflict.id,
      visibility: "internal"
    });
  }

  return unique(markers, (marker) => `${marker.markerType}:${marker.refType ?? ""}:${marker.refId ?? marker.label}`);
}

export class LiveDocService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly generationProvider: GenerationProvider,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly changeProposalService: ChangeProposalService
  ) {}

  async getCurrent(projectId: string, actorUserId: string, options?: { forceRefresh?: boolean }) {
    await this.ensureInternalAccess(projectId, actorUserId);
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const prdBacked = await this.getPrdBackedCurrent(projectId, project.name);
    if (prdBacked) {
      return prdBacked;
    }

    const artifact = await this.ensureCurrentArtifact(projectId, actorUserId, options?.forceRefresh ?? false);
    const parsed = liveDocArtifactSchema.parse(artifact.payloadJson);
    const [drafts, comments, revisions, diagramEmbeds, codingRequirements] = await Promise.all([
      this.prisma.liveDocSectionDraft.findMany({
        where: { projectId },
        include: {
          creator: true,
          linkedProposal: true
        }
      }),
      this.prisma.liveDocComment.findMany({
        where: { projectId },
        include: {
          author: true
        },
        orderBy: { createdAt: "desc" },
        take: 50
      }),
      this.prisma.liveDocSectionRevision.findMany({
        where: { projectId },
        include: {
          actor: true,
          proposal: true
        },
        orderBy: { createdAt: "desc" },
        take: 25
      }),
      this.prisma.liveDocSectionDiagram.findMany({
        where: {
          projectId,
          diagram: { status: "active" }
        },
        include: { diagram: true },
        orderBy: [{ sectionKey: "asc" }, { sortOrder: "asc" }, { embeddedAt: "asc" }]
      }),
      this.prisma.projectCodingRequirements.findFirst({
        where: {
          projectId,
          artifactVersion: { artifactType: "engineering_requirements", status: "accepted" }
        },
        include: { artifactVersion: true, mermaidDiagram: true },
        orderBy: { createdAt: "desc" }
      })
    ]);

    const status = this.computeStatus(drafts);
    const latestRevisionBySection = new Map(
      unique(revisions, (revision) => revision.sectionKey).map((revision) => [revision.sectionKey, revision])
    );
    const draftBySection = new Map(drafts.map((draft) => [draft.sectionKey, draft]));
    const diagramsBySection = new Map<string, typeof diagramEmbeds>();
    for (const embed of diagramEmbeds) {
      const existing = diagramsBySection.get(embed.sectionKey) ?? [];
      existing.push(embed);
      diagramsBySection.set(embed.sectionKey, existing);
    }

    const baseSections = parsed.sections.map((section) => {
      const draft = draftBySection.get(section.sectionKey);
      const latestRevision = latestRevisionBySection.get(section.sectionKey);
      const actor = draft?.creator ?? latestRevision?.actor ?? null;
      return {
        id: section.sectionKey,
        anchorId: section.anchorId,
        sectionLabel: section.sectionLabel,
        type: section.type,
        content: draft?.status === "draft" || draft?.status === "needs_review" ? draft.proposedContent : section.content,
        highlight: section.highlight ?? null,
        sourceIds: unique(section.sourceRefs, (ref) => `${ref.refType}:${ref.refId}`).map((ref) => ref.refId),
        openTargets: section.sourceRefs.map((ref) => this.mapSourceRefToOpenTarget(ref)),
        hasPendingDraft: Boolean(draft && (draft.status === "draft" || draft.status === "needs_review")),
        acceptedChangeSummaries: section.sourceRefs
          .filter((ref) => ref.refType === "change_proposal")
          .map((ref) => ref.label),
        overlayMarkers: buildOverlayMarkers({ section, draft, latestRevision }),
        diagrams: (diagramsBySection.get(section.sectionKey) ?? []).map((embed) => ({
          id: embed.diagram.id,
          title: embed.diagram.title,
          description: embed.diagram.description,
          diagramType: embed.diagram.diagramType,
          mermaidSource: embed.diagram.mermaidSource,
          source: embed.diagram.source,
          embeddedAt: embed.embeddedAt.toISOString(),
          sortOrder: embed.sortOrder
        })),
        lastEditedAt: latestRevision?.createdAt ?? draft?.updatedAt ?? null,
        lastEditedBy: actor
          ? {
              userId: actor.id,
              displayName: actor.displayName,
              initials: toInitials(actor.displayName)
            }
          : null,
        hasHistory: revisions.some((revision) => revision.sectionKey === section.sectionKey)
      };
    });
    const derivedCodingSections = codingRequirements
      ? buildCodingRequirementLiveDocSections(codingRequirements)
      : [];

    return {
      projectName: project.name,
      docType: "LIVE_DOC",
      sourceStatus: "no_primary_prd",
      source: null,
      version: {
        artifactVersionId: artifact.id,
        versionNumber: artifact.versionNumber,
        generatedAt: artifact.acceptedAt ?? artifact.createdAt
      },
      status,
      sections: [...baseSections, ...derivedCodingSections],
      comments: comments.map((comment) => ({
        id: comment.id,
        authorInitials: toInitials(comment.author?.displayName ?? comment.sourceLabel ?? "System"),
        authorName: comment.author?.displayName ?? comment.sourceLabel ?? "System",
        time: comment.createdAt.toISOString(),
        date: comment.createdAt.toISOString(),
        content: comment.bodyText,
        source: comment.commentType,
        linkedSectionId: comment.sectionKey,
        commentType: comment.commentType
      })),
      recentEdits: revisions.map((revision) => ({
        revisionId: revision.id,
        sectionKey: revision.sectionKey,
        sectionLabel: parsed.sections.find((section) => section.sectionKey === revision.sectionKey)?.sectionLabel ?? revision.sectionKey,
        actor: revision.actor
          ? {
              userId: revision.actor.id,
              displayName: revision.actor.displayName,
              initials: toInitials(revision.actor.displayName)
            }
          : null,
        eventType: revision.eventType,
        timestamp: revision.createdAt,
        changeSummary: revision.changeSummary
      }))
    };
  }

  async getPrimarySource(projectId: string, actorUserId: string) {
    await this.ensureInternalAccess(projectId, actorUserId);
    const source = await this.loadPrimarySource(projectId);
    if (!source) {
      return { sourceStatus: "missing" as const };
    }
    return this.toSourcePayload(source);
  }

  async listReviewItems(projectId: string, actorUserId: string, query?: { sectionKey?: string }) {
    await this.ensureInternalAccess(projectId, actorUserId);
    const documentSectionId = query?.sectionKey?.startsWith("doc:") ? query.sectionKey.slice(4) : null;
    const proposals = await this.prisma.specChangeProposal.findMany({
      where: {
        projectId,
        status: { in: ["detected", "needs_review"] },
        ...(documentSectionId
          ? {
              links: {
                some: {
                  linkType: "document_section",
                  linkRefId: documentSectionId
                }
              }
            }
          : {})
      },
      include: {
        links: true,
        decisionRecord: true
      },
      orderBy: { createdAt: "desc" }
    });

    return proposals.map((proposal: any) => {
      const documentSectionIds = proposalRefs(proposal, "document_section");
      const brainNodeIds = proposalRefs(proposal, "brain_node");
      return {
        proposalId: proposal.id,
        title: proposal.title,
        summary: proposal.summary,
        status: proposal.status,
        proposalType: proposal.proposalType,
        sectionKeys: documentSectionIds.map((sectionId) => `doc:${sectionId}`),
        affectedDocumentSectionIds: documentSectionIds,
        linkedBrainNodeIds: brainNodeIds,
        linkedMessageRefs: proposalRefs(proposal, "message").map((messageId) => ({ messageId })),
        linkedThreadRefs: proposalRefs(proposal, "thread").map((threadId) => ({ threadId })),
        markerType: "pending_review_internal_only",
        openTargets: [
          ...documentSectionIds.map((sectionId) => ({
            targetType: "live_doc_section",
            targetRef: { sectionKey: `doc:${sectionId}`, documentSectionId: sectionId }
          })),
          ...proposalOpenTargets(proposal)
        ],
        createdAt: proposal.createdAt,
        updatedAt: proposal.updatedAt
      };
    });
  }

  async listChangeMarkers(projectId: string, actorUserId: string) {
    await this.ensureInternalAccess(projectId, actorUserId);
    const [revisions, pendingProposals] = await Promise.all([
      this.prisma.liveDocSectionRevision.findMany({
        where: {
          projectId,
          proposalId: { not: null },
          eventType: { in: ["proposal_accepted", "proposal_rejected", "proposal_created"] }
        },
        include: {
          actor: true,
          proposal: {
            include: {
              links: true,
              accepter: true
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: 100
      }),
      this.prisma.specChangeProposal.findMany({
        where: {
          projectId,
          status: "needs_review",
          links: {
            some: {
              linkType: { in: ["message", "thread"] }
            }
          }
        },
        include: {
          links: true,
          accepter: true
        },
        orderBy: { createdAt: "desc" },
        take: 100
      })
    ]);

    const proposalIdsWithRevisions = new Set(revisions.map((revision) => revision.proposalId).filter(Boolean));
    const proposalLinks = [
      ...revisions.flatMap((revision) => revision.proposal?.links ?? []),
      ...pendingProposals.flatMap((proposal) => proposal.links)
    ];
    const sourceMessageIds = Array.from(
      new Set(proposalLinks.filter((link) => link.linkType === "message").map((link) => link.linkRefId))
    );
    const sourceMessages = sourceMessageIds.length
      ? await this.prisma.communicationMessage.findMany({
          where: { projectId, id: { in: sourceMessageIds } }
        })
      : [];
    const messageById = new Map(sourceMessages.map((message) => [message.id, message]));

    const pendingMarkers = pendingProposals
      .filter((proposal) => !proposalIdsWithRevisions.has(proposal.id))
      .map((proposal) => this.mapProposalMarker(proposal, "pending", messageById));

    const revisionMarkers = revisions.map((revision) => {
      const proposal = revision.proposal;
      return {
        markerId: revision.id,
        proposalId: revision.proposalId,
        status:
          revision.eventType === "proposal_accepted"
            ? "accepted"
            : revision.eventType === "proposal_rejected"
              ? "rejected"
              : proposal?.status ?? "needs_review",
        markerType: revision.eventType,
        sectionKey: revision.sectionKey,
        documentSectionId: revision.documentSectionId,
        sourceDocumentId: revision.sourceDocumentId,
        sourceDocumentVersionId: revision.sourceDocumentVersionId,
        anchorId: revision.anchorId,
        title: proposal?.title ?? revision.changeSummary ?? "LiveDoc change",
        summary: proposal?.summary ?? revision.changeSummary ?? "",
        oldUnderstanding: proposal?.oldUnderstandingJson ?? revision.previousContent,
        newUnderstanding: proposal?.newUnderstandingJson ?? revision.nextContent,
        changeSummary: revision.changeSummary,
        acceptedBy: proposal?.accepter
          ? { userId: proposal.accepter.id, displayName: proposal.accepter.displayName }
          : revision.actor
            ? { userId: revision.actor.id, displayName: revision.actor.displayName }
            : null,
        acceptedAt: proposal?.acceptedAt ?? (revision.eventType === "proposal_accepted" ? revision.createdAt : null),
        createdAt: revision.createdAt,
        sourceMessages: proposal ? this.mapProposalSourceMessages(proposal, messageById) : []
      };
    });

    return [...pendingMarkers, ...revisionMarkers].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
  }

  async acceptReviewItem(projectId: string, proposalId: string, actorUserId: string) {
    const proposal = await this.changeProposalService.accept(projectId, proposalId, actorUserId);
    return {
      proposal,
      reviewStatus: "accepted",
      openTargets: [{ targetType: "change_proposal", targetRef: { proposalId } }]
    };
  }

  async rejectReviewItem(projectId: string, proposalId: string, actorUserId: string) {
    const proposal = await this.changeProposalService.reject(projectId, proposalId, actorUserId);
    return {
      proposal,
      reviewStatus: "rejected",
      openTargets: [{ targetType: "change_proposal", targetRef: { proposalId } }]
    };
  }

  async setPrimarySource(projectId: string, actorUserId: string, documentId: string) {
    await this.ensureInternalAccess(projectId, actorUserId);
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, projectId },
      include: { project: true }
    });
    if (!document) {
      throw new AppError(404, "Document was not found in this project", "document_not_found");
    }
    if (document.kind !== "prd" && document.kind !== "srs") {
      throw new AppError(422, "Only PRD or SRS documents can be the primary Live Doc source", "invalid_live_doc_source_kind");
    }

    const sourceKind = `uploaded_${document.kind}` as const;
    const source = await this.prisma.projectLiveDocSource.upsert({
      where: { projectId },
      create: {
        orgId: document.project.orgId,
        projectId,
        documentId: document.id,
        documentVersionId: document.currentVersionId,
        sourceKind,
        setByUserId: actorUserId
      },
      update: {
        documentId: document.id,
        documentVersionId: document.currentVersionId,
        sourceKind,
        setByUserId: actorUserId
      },
      include: this.primarySourceInclude()
    });

    await this.auditService.record({
      orgId: document.project.orgId,
      projectId,
      actorUserId,
      eventType: "live_doc_primary_source_set",
      entityType: "document",
      entityId: document.id,
      payload: {
        documentId: document.id,
        documentVersionId: document.currentVersionId,
        sourceKind
      }
    });

    return this.toSourcePayload(source);
  }


  async patchSection(
    projectId: string,
    sectionKey: string,
    actorUserId: string,
    input: { content: string; comment?: string }
  ) {
    const member = await this.ensureInternalAccess(projectId, actorUserId);
    const prdSection = await this.resolvePrdBackedSection(projectId, sectionKey);
    if (prdSection) {
      return this.patchPrdBackedSection(projectId, sectionKey, actorUserId, input, member, prdSection);
    }

    const artifact = await this.ensureCurrentArtifact(projectId, actorUserId, false);
    const parsed = liveDocArtifactSchema.parse(artifact.payloadJson);
    const section = parsed.sections.find((candidate) => candidate.sectionKey === sectionKey);
    if (!section) {
      throw new AppError(404, "Live doc section not found", "live_doc_section_not_found");
    }

    const normalizedContent = input.content.trim();
    if (!normalizedContent) {
      throw new AppError(422, "Section content cannot be empty", "live_doc_empty_section");
    }

    const existingDraft = await this.prisma.liveDocSectionDraft.findUnique({
      where: {
        projectId_sectionKey: {
          projectId,
          sectionKey
        }
      }
    });

    const impact = await this.resolveImpact(projectId, section, normalizedContent);
    const shouldCreateProposal = impact.affectedDocumentSectionIds.length > 0 && impact.affectedBrainNodeIds.length > 0;

    let linkedProposal = null;
    if (shouldCreateProposal) {
      linkedProposal = await this.changeProposalService.createOrUpdateSystemProposal(projectId, actorUserId, {
        existingProposalId: existingDraft?.linkedProposalId ?? null,
        title: `Live doc update: ${section.sectionLabel}`,
        summary: `Proposed live doc update for ${section.sectionLabel}`,
        proposalType: this.proposalTypeForSection(section.sectionKey),
        oldUnderstanding: {
          sectionKey,
          sectionLabel: section.sectionLabel,
          content: section.content
        },
        newUnderstanding: {
          sectionKey,
          sectionLabel: section.sectionLabel,
          content: normalizedContent
        },
        impactSummary: {
          liveDocSectionKey: sectionKey,
          changeSource: "live_doc_edit",
          actorRole: member.projectRole,
          affectedBrainNodeCount: impact.affectedBrainNodeIds.length,
          affectedDocumentSectionCount: impact.affectedDocumentSectionIds.length
        },
        affectedDocumentSectionIds: impact.affectedDocumentSectionIds,
        affectedBrainNodeIds: impact.affectedBrainNodeIds,
        communicationMessageIds: impact.communicationMessageIds,
        externalEvidenceRefs: [`live_doc:${projectId}:${sectionKey}`]
      });
    }

    const status = linkedProposal ? "needs_review" : "draft";
    const draft = await this.prisma.liveDocSectionDraft.upsert({
      where: {
        projectId_sectionKey: {
          projectId,
          sectionKey
        }
      },
      create: {
        projectId,
        artifactVersionId: artifact.id,
        sectionKey,
        sectionLabel: section.sectionLabel,
        baseContent: section.content,
        proposedContent: normalizedContent,
        status,
        createdBy: actorUserId,
        linkedProposalId: linkedProposal?.id ?? null
      },
      update: {
        artifactVersionId: artifact.id,
        sectionLabel: section.sectionLabel,
        baseContent: section.content,
        proposedContent: normalizedContent,
        status,
        createdBy: actorUserId,
        linkedProposalId: linkedProposal?.id ?? null
      },
      include: {
        creator: true,
        linkedProposal: true
      }
    });

    await this.prisma.liveDocSectionRevision.create({
      data: {
        projectId,
        sectionKey,
        artifactVersionId: artifact.id,
        draftId: draft.id,
        proposalId: linkedProposal?.id ?? null,
        actorUserId,
        eventType: existingDraft ? "draft_updated" : "draft_created",
        previousContent: existingDraft?.proposedContent ?? section.content,
        nextContent: normalizedContent,
        changeSummary: existingDraft
          ? `Updated draft for ${section.sectionLabel}`
          : `Created draft for ${section.sectionLabel}`
      }
    });

    if (linkedProposal && linkedProposal.id !== existingDraft?.linkedProposalId) {
      await this.prisma.liveDocSectionRevision.create({
        data: {
          projectId,
          sectionKey,
          artifactVersionId: artifact.id,
          draftId: draft.id,
          proposalId: linkedProposal.id,
          actorUserId,
          eventType: "proposal_created",
          previousContent: section.content,
          nextContent: normalizedContent,
          changeSummary: `Opened review proposal for ${section.sectionLabel}`,
          eventKey: `live-doc-proposal-created:${linkedProposal.id}`
        }
      });
    }

    let createdComment = null;
    if (input.comment?.trim()) {
      createdComment = await this.prisma.liveDocComment.create({
        data: {
          projectId,
          sectionKey,
          draftId: draft.id,
          commentType: "review",
          bodyText: input.comment.trim(),
          authorUserId: actorUserId
        },
        include: {
          author: true
        }
      });
    }

    const latestHistory = await this.getSectionHistory(projectId, sectionKey, actorUserId);
    const current = await this.getCurrent(projectId, actorUserId);

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "live_doc_section_saved",
      entityType: "live_doc_section",
      entityId: sectionKey,
      payload: {
        sectionLabel: section.sectionLabel,
        linkedProposalId: linkedProposal?.id ?? null
      }
    });

    return {
      draft: {
        id: draft.id,
        sectionKey: draft.sectionKey,
        sectionLabel: draft.sectionLabel,
        status: draft.status,
        proposedContent: draft.proposedContent,
        linkedProposalId: draft.linkedProposalId,
        updatedAt: draft.updatedAt
      },
      linkedProposal,
      latestHistory: latestHistory.revisions[0] ?? null,
      comment: createdComment
        ? {
            id: createdComment.id,
            authorName: createdComment.author?.displayName ?? "System",
            authorInitials: toInitials(createdComment.author?.displayName ?? "System"),
            content: createdComment.bodyText,
            createdAt: createdComment.createdAt
          }
        : null,
      status: current.status
    };
  }

  async listComments(projectId: string, actorUserId: string, query?: { sectionKey?: string }) {
    await this.ensureInternalAccess(projectId, actorUserId);
    const comments = await this.prisma.liveDocComment.findMany({
      where: {
        projectId,
        ...(query?.sectionKey ? { sectionKey: query.sectionKey } : {})
      },
      include: {
        author: true,
        draft: {
          select: {
            status: true,
            sectionLabel: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    return comments.map((comment) => ({
      id: comment.id,
      sectionKey: comment.sectionKey,
      draftId: comment.draftId,
      commentType: comment.commentType,
      bodyText: comment.bodyText,
      sourceLabel: comment.sourceLabel,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      author: comment.author
        ? {
            userId: comment.author.id,
            displayName: comment.author.displayName,
            initials: toInitials(comment.author.displayName)
          }
        : null,
      draft: comment.draft
    }));
  }

  async createComment(
    projectId: string,
    actorUserId: string,
    input: { sectionKey: string; draftId?: string; bodyText: string }
  ) {
    await this.ensureInternalAccess(projectId, actorUserId);
    await this.ensureCurrentArtifact(projectId, actorUserId, false);
    const comment = await this.prisma.liveDocComment.create({
      data: {
        projectId,
        sectionKey: input.sectionKey,
        draftId: input.draftId ?? null,
        commentType: "review",
        bodyText: input.bodyText.trim(),
        authorUserId: actorUserId
      },
      include: {
        author: true
      }
    });

    return {
      id: comment.id,
      sectionKey: comment.sectionKey,
      draftId: comment.draftId,
      bodyText: comment.bodyText,
      commentType: comment.commentType,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      author: comment.author
        ? {
            userId: comment.author.id,
            displayName: comment.author.displayName,
            initials: toInitials(comment.author.displayName)
          }
        : null
    };
  }

  async getSectionHistory(projectId: string, sectionKey: string, actorUserId: string) {
    await this.ensureInternalAccess(projectId, actorUserId);
    const artifact = await this.ensureCurrentArtifact(projectId, actorUserId, false);
    const parsed = liveDocArtifactSchema.parse(artifact.payloadJson);
    const section = parsed.sections.find((candidate) => candidate.sectionKey === sectionKey);
    if (!section) {
      throw new AppError(404, "Live doc section not found", "live_doc_section_not_found");
    }

    const revisions = await this.prisma.liveDocSectionRevision.findMany({
      where: {
        projectId,
        sectionKey
      },
      include: {
        actor: true,
        proposal: true
      },
      orderBy: { createdAt: "desc" }
    });

    return {
      section: {
        sectionKey: section.sectionKey,
        sectionLabel: section.sectionLabel,
        anchorId: section.anchorId,
        currentContent: section.content
      },
      revisions: revisions.map((revision) => ({
        revisionId: revision.id,
        actor: revision.actor
          ? {
              userId: revision.actor.id,
              displayName: revision.actor.displayName,
              initials: toInitials(revision.actor.displayName)
            }
          : null,
        eventType: revision.eventType,
        timestamp: revision.createdAt,
        previousContent: revision.previousContent,
        nextContent: revision.nextContent,
        changeSummary: revision.changeSummary,
        proposal: revision.proposal
          ? {
              proposalId: revision.proposal.id,
              title: revision.proposal.title,
              status: revision.proposal.status
            }
          : null
      }))
    };
  }

  async getSectionProvenance(projectId: string, sectionKey: string, actorUserId: string) {
    await this.ensureInternalAccess(projectId, actorUserId);
    const artifact = await this.ensureCurrentArtifact(projectId, actorUserId, false);
    const parsed = liveDocArtifactSchema.parse(artifact.payloadJson);
    const section = parsed.sections.find((candidate) => candidate.sectionKey === sectionKey);
    if (!section) {
      throw new AppError(404, "Live doc section not found", "live_doc_section_not_found");
    }

    const documentSectionIds = section.sourceRefs
      .filter((ref) => ref.refType === "document_section")
      .map((ref) => ref.refId);
    const changeProposalIds = section.sourceRefs
      .filter((ref) => ref.refType === "change_proposal")
      .map((ref) => ref.refId);
    const decisionIds = section.sourceRefs
      .filter((ref) => ref.refType === "decision_record")
      .map((ref) => ref.refId);

    const [supportingSections, linkedChanges, linkedDecisions] = await Promise.all([
      documentSectionIds.length
        ? this.prisma.documentSection.findMany({
            where: {
              id: { in: documentSectionIds },
              projectId
            },
            include: {
              documentVersion: {
                include: {
                  document: true
                }
              }
            }
          })
        : Promise.resolve([]),
      this.prisma.specChangeProposal.findMany({
        where: {
          projectId,
          OR: [
            ...(changeProposalIds.length ? [{ id: { in: changeProposalIds } }] : []),
            ...(documentSectionIds.length
              ? [
                  {
                    links: {
                      some: {
                        linkType: "document_section" as const,
                        linkRefId: { in: documentSectionIds }
                      }
                    }
                  }
                ]
              : [])
          ]
        },
        include: {
          links: true
        },
        orderBy: { acceptedAt: "desc" }
      }),
      decisionIds.length
        ? this.prisma.decisionRecord.findMany({
            where: {
              projectId,
              id: { in: decisionIds }
            }
          })
        : Promise.resolve([])
    ]);

    const linkedMessages = await this.prisma.communicationMessage.findMany({
      where: {
        projectId,
        id: {
          in: linkedChanges.flatMap((proposal) =>
            proposal.links.filter((link) => link.linkType === "message").map((link) => link.linkRefId)
          )
        }
      }
    }).catch(() => []);
    const overlayMarkers = buildOverlayMarkers({ section, linkedChanges });

    return {
      section: {
        sectionKey: section.sectionKey,
        sectionLabel: section.sectionLabel,
        content: section.content
      },
      currentInterpretation: section.content,
      overlayMarkers,
      suggestedPrompts: [
        `Show source evidence for ${section.sectionLabel}`,
        `List accepted changes for ${section.sectionLabel}`,
        `Explain current truth for ${section.sectionLabel}`
      ],
      conflicts: overlayMarkers.filter((marker) => marker.markerType === "conflict_detected_internal_only"),
      supportingSections: supportingSections.map((candidate) => ({
        sectionId: candidate.id,
        documentId: candidate.documentVersion.documentId,
        documentVersionId: candidate.documentVersionId,
        title: candidate.documentVersion.document.title,
        anchorId: candidate.anchorId,
        pageNumber: candidate.pageNumber,
        excerpt: candidate.normalizedText.slice(0, 320)
      })),
      linkedChanges: linkedChanges.map((proposal) => ({
        proposalId: proposal.id,
        title: proposal.title,
        summary: proposal.summary,
        status: proposal.status
      })),
      linkedDecisions: linkedDecisions.map((decision) => ({
        decisionId: decision.id,
        title: decision.title,
        statement: decision.statement,
        status: decision.status
      })),
      linkedMessageRefs: linkedMessages.map((message) => ({
        messageId: message.id,
        threadId: message.threadId,
        senderLabel: message.senderLabel,
        sentAt: message.sentAt,
        excerpt: message.bodyText.slice(0, 280)
      })),
      openTargets: {
        section: {
          targetType: "live_doc_section",
          targetRef: { sectionKey: section.sectionKey }
        },
        supportingSections: supportingSections.map((candidate) => ({
          targetType: "document_section",
          targetRef: {
            documentId: candidate.documentVersion.documentId,
            documentVersionId: candidate.documentVersionId,
            anchorId: candidate.anchorId,
            ...(candidate.pageNumber ? { pageNumber: candidate.pageNumber } : {})
          }
        })),
        messages: linkedMessages.map((message) => ({
          targetType: "message",
          targetRef: {
            messageId: message.id,
            threadId: message.threadId
          }
        })),
        changes: linkedChanges.map((proposal) => ({
          targetType: "change_proposal",
          targetRef: {
            proposalId: proposal.id
          }
        }))
      }
    };
  }

  async generateDiagram(
    projectId: string,
    actorUserId: string,
    input: { kind: "system" | "usecase" | "flowchart" | "sequence" }
  ) {
    await this.ensureInternalAccess(projectId, actorUserId);
    const artifact = await this.ensureCurrentArtifact(projectId, actorUserId, false);
    const parsed = liveDocArtifactSchema.parse(artifact.payloadJson);
    const prompt = [
      `Generate a ${input.kind} mermaid diagram for this live doc.`,
      "Use only the supplied current-truth sections.",
      JSON.stringify(parsed.sections.slice(0, 8), null, 2)
    ].join("\n\n");

    const fallback = {
      mermaid: [
        "flowchart TD",
        '  overview["Product Overview"]',
        '  flows["Main Flows"]',
        '  constraints["Constraints"]',
        '  integrations["Integrations"]',
        "  overview --> flows",
        "  flows --> constraints",
        "  flows --> integrations"
      ].join("\n")
    };

    const result = await this.generationProvider.generateObject({
      prompt,
      schema: z.object({
        mermaid: z.string().min(1)
      }),
      fallback: () => fallback
    });

    const citedSections = parsed.sections.slice(0, Math.min(3, parsed.sections.length));
    return {
      kind: input.kind,
      mermaid: result.mermaid,
      generatedFromArtifactVersionId: artifact.id,
      citations: citedSections.map((section) => ({
        type: "live_doc_section",
        refId: section.sectionKey,
        label: section.sectionLabel
      })),
      openTargets: citedSections.map((section) => ({
        targetType: "live_doc_section",
        targetRef: {
          sectionKey: section.sectionKey
        }
      }))
    };
  }

  private mapProposalMarker(
    proposal: {
      id: string;
      title: string;
      summary: string;
      status: string;
      oldUnderstandingJson: unknown;
      newUnderstandingJson: unknown;
      createdAt: Date;
      acceptedAt?: Date | null;
      accepter?: { id: string; displayName: string } | null;
      links: Array<{ linkType: string; linkRefId: string }>;
    },
    status: "pending" | "accepted" | "rejected",
    messageById: Map<string, { id: string; threadId: string; senderLabel: string; sentAt: Date; bodyText: string; providerPermalink?: string | null }>
  ) {
    const documentSectionIds = proposalRefs(proposal, "document_section");
    return {
      markerId: `proposal:${proposal.id}`,
      proposalId: proposal.id,
      status,
      markerType: "proposal_marker",
      sectionKey: documentSectionIds[0] ? `doc:${documentSectionIds[0]}` : null,
      documentSectionId: documentSectionIds[0] ?? null,
      title: proposal.title,
      summary: proposal.summary,
      oldUnderstanding: proposal.oldUnderstandingJson,
      newUnderstanding: proposal.newUnderstandingJson,
      changeSummary: proposal.summary,
      acceptedBy: proposal.accepter ? { userId: proposal.accepter.id, displayName: proposal.accepter.displayName } : null,
      acceptedAt: proposal.acceptedAt ?? null,
      createdAt: proposal.createdAt,
      sourceMessages: this.mapProposalSourceMessages(proposal, messageById)
    };
  }

  private mapProposalSourceMessages(
    proposal: { links: Array<{ linkType: string; linkRefId: string }> },
    messageById: Map<string, { id: string; threadId: string; senderLabel: string; sentAt: Date; bodyText: string; providerPermalink?: string | null }>
  ) {
    return proposalRefs(proposal, "message")
      .map((messageId) => messageById.get(messageId))
      .filter((message): message is NonNullable<typeof message> => Boolean(message))
      .map((message) => ({
        messageId: message.id,
        threadId: message.threadId,
        senderLabel: message.senderLabel,
        sentAt: message.sentAt,
        excerpt: message.bodyText.slice(0, 320),
        providerPermalink: message.providerPermalink ?? null
      }));
  }

  private primarySourceInclude() {
    return {
      document: true,
      documentVersion: true,
      setter: true
    } as const;
  }

  private async loadPrimarySource(projectId: string) {
    return this.prisma.projectLiveDocSource.findUnique({
      where: { projectId },
      include: this.primarySourceInclude()
    });
  }

  private toSourcePayload(source: any) {
    const version = source.documentVersion ?? null;
    const sourceStatus =
      !source.document
        ? "missing"
        : !version
          ? "processing"
          : version.status === "ready" || version.status === "partial"
            ? "ready"
            : version.status === "failed"
              ? "not_viewable"
              : "processing";
    return {
      sourceStatus,
      documentId: source.documentId,
      documentVersionId: source.documentVersionId,
      documentKind: source.document?.kind ?? null,
      title: source.document?.title ?? null,
      parseStatus: version?.status ?? null,
      sourceKind: source.sourceKind,
      setAt: source.updatedAt?.toISOString?.() ?? source.createdAt?.toISOString?.() ?? null,
      setByUserId: source.setByUserId
    };
  }

  private async getPrdBackedCurrent(projectId: string, projectName: string) {
    const source = await this.loadPrimarySource(projectId);
    if (!source) return null;
    const sourcePayload = this.toSourcePayload(source);
    if (sourcePayload.sourceStatus !== "ready") {
      return {
        projectName,
        docType: "LIVE_DOC",
        sourceStatus: sourcePayload.sourceStatus,
        source: sourcePayload,
        version: null,
        status: "draft",
        sections: [],
        comments: []
      };
    }

    const documentVersionId = source.documentVersionId ?? source.document.currentVersionId;
    if (!documentVersionId) return null;
    const parseRevision = source.documentVersion?.parseRevision ?? 1;
    const sections = await this.prisma.documentSection.findMany({
      where: { projectId, documentVersionId, parseRevision },
      orderBy: { orderIndex: "asc" }
    });
    const [drafts, revisions, linkedChanges, comments, diagramEmbeds] = await Promise.all([
      this.prisma.liveDocSectionDraft.findMany({
        where: { projectId },
        include: { creator: true, linkedProposal: true }
      }),
      this.prisma.liveDocSectionRevision.findMany({
        where: { projectId },
        include: { actor: true, proposal: true },
        orderBy: { createdAt: "desc" },
        take: 100
      }),
      this.prisma.specChangeLink.findMany({
        where: {
          projectId,
          linkType: "document_section",
          linkRefId: { in: sections.map((section: PrdBackedSection) => section.id) }
        },
        include: {
          proposal: {
            include: { links: true }
          }
        }
      }),
      this.prisma.liveDocComment.findMany({
        where: { projectId },
        include: { author: true },
        orderBy: { createdAt: "desc" },
        take: 50
      }),
      this.prisma.liveDocSectionDiagram.findMany({
        where: {
          projectId,
          diagram: { status: "active" }
        },
        include: { diagram: true },
        orderBy: [{ sectionKey: "asc" }, { sortOrder: "asc" }, { embeddedAt: "asc" }]
      })
    ]);

    const draftBySection = new Map(drafts.map((draft: any) => [draft.sectionKey, draft]));
    const latestRevisionBySection = new Map(
      unique(revisions, (revision: any) => revision.sectionKey).map((revision: any) => [revision.sectionKey, revision])
    );
    const acceptedLinksBySection = new Map<string, any[]>();
    const pendingLinksBySection = new Map<string, any[]>();
    for (const link of linkedChanges) {
      if (!link.proposal) continue;
      const target =
        link.proposal.status === "accepted"
          ? acceptedLinksBySection
          : link.proposal.status === "detected" || link.proposal.status === "needs_review"
            ? pendingLinksBySection
            : null;
      if (!target) continue;
      const existing = target.get(link.linkRefId) ?? [];
      existing.push(link.proposal);
      target.set(link.linkRefId, existing);
    }
    const diagramsBySection = new Map<string, typeof diagramEmbeds>();
    for (const embed of diagramEmbeds) {
      const existing = diagramsBySection.get(embed.sectionKey) ?? [];
      existing.push(embed);
      diagramsBySection.set(embed.sectionKey, existing);
    }

    return {
      projectName,
      docType: "LIVE_DOC",
      sourceStatus: "ready",
      source: sourcePayload,
      version: {
        artifactVersionId: null,
        versionNumber: null,
        generatedAt: source.documentVersion?.processedAt ?? source.updatedAt
      },
      status: this.computeStatus(drafts),
      sections: sections.map((section: PrdBackedSection) => {
        const sectionKey = `doc:${section.id}`;
        const draft = draftBySection.get(sectionKey);
        const latestRevision = latestRevisionBySection.get(sectionKey);
        const accepted = acceptedLinksBySection.get(section.id) ?? [];
        const pending = pendingLinksBySection.get(section.id) ?? [];
        const acceptedRevision = latestRevision?.eventType === "proposal_accepted" ? latestRevision : null;
        const currentText = acceptedRevision?.nextContent ?? accepted[0]?.newUnderstandingJson?.content ?? section.normalizedText;
        const hasPendingReview =
          Boolean(draft && (draft.status === "draft" || draft.status === "needs_review")) ||
          pending.some((proposal) => proposal?.status === "detected" || proposal?.status === "needs_review");
        const documentTarget = {
          targetType: "document_section",
          targetRef: {
            documentId: source.documentId,
            documentVersionId,
            anchorId: section.anchorId,
            pageNumber: section.pageNumber
          }
        };
        return {
          id: sectionKey,
          sectionKey,
          anchorId: section.anchorId,
          sectionLabel: section.headingPath.at(-1) ?? section.anchorId,
          type: "body",
          sourceDocumentId: source.documentId,
          sourceDocumentVersionId: documentVersionId,
          documentSectionId: section.id,
          pageNumber: section.pageNumber,
          headingPath: section.headingPath,
          originalText: section.normalizedText,
          currentText,
          effectiveText: currentText,
          content: currentText,
          currentTruthSummary: accepted.map((proposal) => proposal?.summary).filter(Boolean),
          hasCurrentTruthOverlay: currentText !== section.normalizedText || accepted.length > 0,
          hasPendingReview,
          acceptedChangeSummaries: accepted.map((proposal) => proposal?.summary ?? proposal?.title).filter(Boolean),
          overlayMarkers: accepted.map((proposal) => ({
            markerType: "accepted_change",
            label: proposal?.title ?? "Accepted change",
            refType: "change_proposal",
            refId: proposal?.id,
            visibility: "client_safe",
            status: proposal?.status,
            acceptedBy: proposal?.acceptedBy ?? null,
            acceptedAt: proposal?.acceptedAt ?? null,
            openTargets: proposal ? proposalOpenTargets(proposal) : []
          })),
          pendingMarkers: [
            ...(draft && (draft.status === "draft" || draft.status === "needs_review")
              ? [
                  {
                    markerType: "pending_review_internal_only",
                    label: draft.linkedProposal?.title ?? "Pending review",
                    refType: "change_proposal",
                    refId: draft.linkedProposalId ?? draft.linkedProposal?.id,
                    visibility: "internal",
                    status: draft.status,
                    proposalId: draft.linkedProposalId ?? draft.linkedProposal?.id ?? null,
                    affectedDocumentSectionId: section.id,
                    linkedMessageRefs: proposalRefs(draft.linkedProposal, "message").map((messageId) => ({ messageId })),
                    linkedThreadRefs: proposalRefs(draft.linkedProposal, "thread").map((threadId) => ({ threadId })),
                    linkedBrainNodeIds: proposalRefs(draft.linkedProposal, "brain_node"),
                    openTargets: draft.linkedProposal ? proposalOpenTargets(draft.linkedProposal) : []
                  }
                ]
              : []),
            ...pending.map((proposal) => ({
              markerType: "pending_review_internal_only",
              label: proposal?.title ?? "Pending review",
              refType: "change_proposal",
              refId: proposal?.id,
              visibility: "internal",
              status: proposal?.status,
              proposalId: proposal?.id,
              affectedDocumentSectionId: section.id,
              summary: proposal?.summary ?? null,
              linkedMessageRefs: proposalRefs(proposal, "message").map((messageId) => ({ messageId })),
              linkedThreadRefs: proposalRefs(proposal, "thread").map((threadId) => ({ threadId })),
              linkedBrainNodeIds: proposalRefs(proposal, "brain_node"),
              openTargets: proposal ? proposalOpenTargets(proposal) : []
            }))
          ],
          linkedMessageRefs: unique(
            [...accepted, ...pending].flatMap((proposal) =>
              proposalRefs(proposal, "message").map((messageId) => ({ messageId }))
            ),
            (ref) => ref.messageId
          ),
          linkedDecisionIds: accepted.map((proposal) => proposal?.decisionRecordId).filter(Boolean),
          linkedBrainNodeIds: Array.from(new Set([...accepted, ...pending].flatMap((proposal) => proposalRefs(proposal, "brain_node")))),
          citations: [
            {
              citationType: "document_section",
              refId: section.id,
              label: section.headingPath.join(" > ") || "Source section"
            }
          ],
          openTargets: [
            documentTarget,
            {
              targetType: "live_doc_section",
              targetRef: {
                sectionKey,
                documentSectionId: section.id
              }
            }
          ],
          provenanceOpenTarget: documentTarget,
          diagrams: (diagramsBySection.get(sectionKey) ?? []).map((embed) => ({
            id: embed.diagram.id,
            title: embed.diagram.title,
            description: embed.diagram.description,
            diagramType: embed.diagram.diagramType,
            mermaidSource: embed.diagram.mermaidSource,
            source: embed.diagram.source,
            embeddedAt: embed.embeddedAt.toISOString(),
            sortOrder: embed.sortOrder
          })),
          lastEditedAt: latestRevision?.createdAt ?? draft?.updatedAt ?? null,
          lastEditedBy: null,
          hasHistory: revisions.some((revision: any) => revision.sectionKey === sectionKey)
        };
      }),
      comments: comments.map((comment: any) => ({
        id: comment.id,
        authorInitials: toInitials(comment.author?.displayName ?? comment.sourceLabel ?? "System"),
        authorName: comment.author?.displayName ?? comment.sourceLabel ?? "System",
        time: comment.createdAt.toISOString(),
        date: comment.createdAt.toISOString(),
        content: comment.bodyText,
        source: comment.commentType,
        sectionKey: comment.sectionKey
      }))
    };
  }

  private async resolvePrdBackedSection(projectId: string, sectionKey: string) {
    if (!sectionKey.startsWith("doc:")) return null;
    const documentSectionId = sectionKey.slice(4);
    const source = await this.loadPrimarySource(projectId);
    if (!source) return null;
    const documentVersionId = source.documentVersionId ?? source.document.currentVersionId;
    if (!documentVersionId || (source.documentVersion?.status !== "ready" && source.documentVersion?.status !== "partial")) return null;
    const sections = await this.prisma.documentSection.findMany({
      where: {
        projectId,
        id: documentSectionId,
        documentVersionId,
        parseRevision: source.documentVersion?.parseRevision ?? 1
      },
      take: 1
    });
    const section = sections[0] as PrdBackedSection | undefined;
    return section ? { source, documentVersionId, section } : null;
  }

  private async patchPrdBackedSection(
    projectId: string,
    sectionKey: string,
    actorUserId: string,
    input: { content: string; comment?: string },
    member: { projectRole: string },
    resolved: { source: any; documentVersionId: string; section: PrdBackedSection }
  ) {
    const normalizedContent = input.content.trim();
    if (!normalizedContent) {
      throw new AppError(422, "Section content cannot be empty", "live_doc_empty_section");
    }
    const sectionLabel = resolved.section.headingPath.at(-1) ?? resolved.section.anchorId;
    const existingDraft = await this.prisma.liveDocSectionDraft.findUnique({
      where: { projectId_sectionKey: { projectId, sectionKey } }
    });
    const impact = await this.resolveImpact(projectId, {
      sectionKey,
      sectionLabel,
      content: resolved.section.normalizedText,
      sourceRefs: [
        {
          refType: "document_section",
          refId: resolved.section.id,
          label: sectionLabel,
          documentId: resolved.source.documentId,
          documentVersionId: resolved.documentVersionId,
          anchorId: resolved.section.anchorId,
          pageNumber: resolved.section.pageNumber ?? undefined
        }
      ]
    } as LiveDocSectionArtifact, normalizedContent);
    const shouldCreateProposal = impact.affectedDocumentSectionIds.length > 0 && impact.affectedBrainNodeIds.length > 0;
    const linkedProposal = shouldCreateProposal
      ? await this.changeProposalService.createOrUpdateSystemProposal(projectId, actorUserId, {
          existingProposalId: existingDraft?.linkedProposalId ?? null,
          title: `Live doc update: ${sectionLabel}`,
          summary: `Proposed live doc update for ${sectionLabel}`,
          proposalType: this.proposalTypeForSection(sectionKey),
          oldUnderstanding: {
            sectionKey,
            sectionLabel,
            content: resolved.section.normalizedText,
            documentSectionId: resolved.section.id
          },
          newUnderstanding: {
            sectionKey,
            sectionLabel,
            content: normalizedContent,
            documentSectionId: resolved.section.id
          },
          impactSummary: {
            liveDocSectionKey: sectionKey,
            changeSource: "live_doc_edit",
            actorRole: member.projectRole,
            affectedBrainNodeCount: impact.affectedBrainNodeIds.length,
            affectedDocumentSectionCount: impact.affectedDocumentSectionIds.length
          },
          affectedDocumentSectionIds: unique([resolved.section.id, ...impact.affectedDocumentSectionIds], (value) => value),
          affectedBrainNodeIds: impact.affectedBrainNodeIds,
          communicationMessageIds: impact.communicationMessageIds,
          externalEvidenceRefs: [`live_doc:${projectId}:${sectionKey}`, `document_section:${resolved.section.id}`]
        })
      : null;
    const status = linkedProposal ? "needs_review" : "draft";
    const sourceLinks = {
      sourceDocumentId: resolved.source.documentId,
      sourceDocumentVersionId: resolved.documentVersionId,
      documentSectionId: resolved.section.id,
      anchorId: resolved.section.anchorId
    };
    const draft = await this.prisma.liveDocSectionDraft.upsert({
      where: { projectId_sectionKey: { projectId, sectionKey } },
      create: {
        projectId,
        artifactVersionId: null,
        sectionKey,
        sectionLabel,
        baseContent: resolved.section.normalizedText,
        proposedContent: normalizedContent,
        ...sourceLinks,
        status,
        createdBy: actorUserId,
        linkedProposalId: linkedProposal?.id ?? null
      },
      update: {
        sectionLabel,
        baseContent: resolved.section.normalizedText,
        proposedContent: normalizedContent,
        ...sourceLinks,
        status,
        createdBy: actorUserId,
        linkedProposalId: linkedProposal?.id ?? null
      },
      include: { creator: true, linkedProposal: true }
    });
    await this.prisma.liveDocSectionRevision.create({
      data: {
        projectId,
        sectionKey,
        artifactVersionId: null,
        draftId: draft.id,
        proposalId: linkedProposal?.id ?? null,
        actorUserId,
        ...sourceLinks,
        eventType: existingDraft ? "draft_updated" : "draft_created",
        previousContent: existingDraft?.proposedContent ?? resolved.section.normalizedText,
        nextContent: normalizedContent,
        changeSummary: existingDraft ? `Updated draft for ${sectionLabel}` : `Created draft for ${sectionLabel}`
      }
    });
    await this.auditService.record({
      orgId: resolved.source.orgId,
      projectId,
      actorUserId,
      eventType: "live_doc_section_saved",
      entityType: "live_doc_section",
      entityId: sectionKey,
      payload: {
        sectionKey,
        documentSectionId: resolved.section.id,
        linkedProposalId: linkedProposal?.id ?? null,
        status
      }
    });
    return {
      draft: {
        id: draft.id,
        status: draft.status,
        sectionKey,
        updatedAt: draft.updatedAt
      },
      linkedProposal,
      current: await this.getCurrent(projectId, actorUserId)
    };
  }


  async refreshCurrentArtifact(
    projectId: string,
    actorUserId?: string | null,
    options?: { proposalId?: string | null; reason?: string | null }
  ) {
    const [productBrainArtifact, latestLiveDocArtifact] = await Promise.all([
      this.prisma.artifactVersion.findFirst({
        where: {
          projectId,
          artifactType: "product_brain",
          status: "accepted"
        },
        orderBy: { versionNumber: "desc" }
      }),
      this.prisma.artifactVersion.findFirst({
        where: {
          projectId,
          artifactType: "live_doc",
          status: "accepted"
        },
        orderBy: { versionNumber: "desc" }
      })
    ]);

    if (!productBrainArtifact) {
      throw new AppError(409, "Live doc is not ready until Product Brain is accepted", "live_doc_not_ready");
    }

    const productBrain = productBrainSchema.parse(productBrainArtifact.payloadJson);
    const sections = await this.compileSections(projectId, productBrain);
    const payload = {
      generatedFromProductBrainId: productBrainArtifact.id,
      sections,
      sourceRefs: unique(sections.flatMap((section) => section.sourceRefs), (ref) => `${ref.refType}:${ref.refId}`)
    } satisfies LiveDocArtifact;
    const signature = this.computeSignature(productBrainArtifact.id, payload);

    if (latestLiveDocArtifact?.changeSummary === signature) {
      return latestLiveDocArtifact;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const latestAny = await tx.artifactVersion.findFirst({
        where: {
          projectId,
          artifactType: "live_doc"
        },
        orderBy: { versionNumber: "desc" }
      });

      await tx.artifactVersion.updateMany({
        where: {
          projectId,
          artifactType: "live_doc",
          status: "accepted"
        },
        data: {
          status: "superseded"
        }
      });

      return tx.artifactVersion.create({
        data: {
          projectId,
          artifactType: "live_doc",
          versionNumber: (latestAny?.versionNumber ?? 0) + 1,
          parentVersionId: latestAny?.id ?? null,
          status: "accepted",
          payloadJson: payload as object,
          sourceRefsJson: payload.sourceRefs as object,
          changeSummary: signature,
          createdBy: actorUserId ?? null,
          acceptedAt: new Date()
        }
      });
    });

    await this.recordPublishedRefreshRevisions(
      projectId,
      latestLiveDocArtifact ? liveDocArtifactSchema.parse(latestLiveDocArtifact.payloadJson) : null,
      payload,
      created.id,
      actorUserId ?? null
    );

    if (options?.proposalId) {
      await this.prisma.liveDocSectionDraft.updateMany({
        where: {
          projectId,
          linkedProposalId: options.proposalId
        },
        data: {
          artifactVersionId: created.id
        }
      });
    }

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId: actorUserId ?? null,
      eventType: "live_doc_generated",
      entityType: "artifact_version",
      entityId: created.id,
      payload: {
        reason: options?.reason ?? "refresh",
        generatedFromProductBrainId: productBrainArtifact.id
      }
    });

    return created;
  }

  private async ensureCurrentArtifact(projectId: string, actorUserId: string, forceRefresh: boolean) {
    if (forceRefresh) {
      return this.refreshCurrentArtifact(projectId, actorUserId, { reason: "forced_read_refresh" });
    }

    const [productBrainArtifact, liveDocArtifact] = await Promise.all([
      this.prisma.artifactVersion.findFirst({
        where: {
          projectId,
          artifactType: "product_brain",
          status: "accepted"
        },
        orderBy: { versionNumber: "desc" }
      }),
      this.prisma.artifactVersion.findFirst({
        where: {
          projectId,
          artifactType: "live_doc",
          status: "accepted"
        },
        orderBy: { versionNumber: "desc" }
      })
    ]);

    if (!productBrainArtifact) {
      throw new AppError(409, "Live doc is not ready until Product Brain is accepted", "live_doc_not_ready");
    }

    if (!liveDocArtifact || !liveDocArtifact.changeSummary?.includes(productBrainArtifact.id)) {
      return this.refreshCurrentArtifact(projectId, actorUserId, { reason: "stale_or_missing" });
    }

    return liveDocArtifact;
  }

  private async ensureInternalAccess(projectId: string, actorUserId: string) {
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    if (member.projectRole === "client") {
      throw new AppError(403, "Clients cannot access the live doc surface", "live_doc_access_denied");
    }
    return member as typeof member & { projectRole: InternalMemberRole };
  }

  private computeStatus(drafts: Array<{ status: string }>) {
    if (drafts.some((draft) => draft.status === "draft")) {
      return "draft";
    }
    if (drafts.some((draft) => draft.status === "needs_review")) {
      return "review";
    }
    return "accepted";
  }

  private mapSourceRefToOpenTarget(ref: SourceRef) {
    switch (ref.refType) {
      case "document_section":
        return {
          targetType: "document_section",
          targetRef: {
            ...(ref.documentId ? { documentId: ref.documentId } : {}),
            ...(ref.documentVersionId ? { documentVersionId: ref.documentVersionId } : {}),
            ...(ref.anchorId ? { anchorId: ref.anchorId } : {}),
            ...(ref.pageNumber ? { pageNumber: ref.pageNumber } : {})
          }
        };
      case "message":
        return {
          targetType: "message",
          targetRef: {
            messageId: ref.refId
          }
        };
      case "brain_node":
        return {
          targetType: "brain_node",
          targetRef: {
            nodeId: ref.refId
          }
        };
      case "change_proposal":
        return {
          targetType: "change_proposal",
          targetRef: {
            proposalId: ref.refId
          }
        };
      case "decision_record":
        return {
          targetType: "decision_record",
          targetRef: {
            decisionId: ref.refId
          }
        };
    }
  }

  private proposalTypeForSection(sectionKey: string) {
    return sectionKey === "accepted-decisions" ? "decision_change" : "clarification";
  }

  private computeSignature(productBrainArtifactId: string, payload: LiveDocArtifact) {
    return createHash("sha256")
      .update(JSON.stringify({ productBrainArtifactId, payload }))
      .digest("hex")
      .slice(0, 24) + `:${productBrainArtifactId}`;
  }

  private async compileSections(
    projectId: string,
    productBrain: ReturnType<typeof productBrainSchema.parse>
  ): Promise<LiveDocSectionArtifact[]> {
    const evidenceRefs = productBrain.evidenceRefs ?? [];
    const sourceSectionIds = unique(
      evidenceRefs
        .map((ref) => ref.sectionId)
        .filter((value): value is string => Boolean(value)),
      (value) => value
    );

    const [sourceSections, acceptedChanges, acceptedDecisions] = await Promise.all([
      sourceSectionIds.length
        ? this.prisma.documentSection.findMany({
            where: {
              projectId,
              id: { in: sourceSectionIds }
            },
            include: {
              documentVersion: {
                include: {
                  document: true
                }
              }
            }
          })
        : Promise.resolve([]),
      productBrain.recentAcceptedChanges.length
        ? this.prisma.specChangeProposal.findMany({
            where: {
              projectId,
              id: { in: productBrain.recentAcceptedChanges.map((item) => item.proposalId) }
            },
            include: {
              links: true
            }
          })
        : Promise.resolve([]),
      productBrain.acceptedDecisions.length
        ? this.prisma.decisionRecord.findMany({
            where: {
              projectId,
              id: { in: productBrain.acceptedDecisions.map((item) => item.decisionId) }
            }
          })
        : Promise.resolve([])
    ]);

    const sourceMessages = await this.prisma.communicationMessage.findMany({
      where: {
        projectId,
        isDeletedByProvider: false,
        id: {
          in: acceptedChanges.flatMap((proposal) =>
            proposal.links.filter((link) => link.linkType === "message").map((link) => link.linkRefId)
          )
        }
      }
    }).catch(() => []);

    const sourceRefLookup = new Map<string, SourceRef>();
    for (const section of sourceSections) {
      sourceRefLookup.set(section.id, {
        refType: "document_section",
        refId: section.id,
        label: `${section.documentVersion.document.title} / ${section.anchorId}`,
        documentId: section.documentVersion.documentId,
        documentVersionId: section.documentVersionId,
        anchorId: section.anchorId,
        ...(section.pageNumber ? { pageNumber: section.pageNumber } : {})
      });
    }

    for (const proposal of acceptedChanges) {
      sourceRefLookup.set(`change:${proposal.id}`, {
        refType: "change_proposal",
        refId: proposal.id,
        label: proposal.title
      });
      for (const link of proposal.links.filter((link) => link.linkType === "message")) {
        const message = sourceMessages.find((candidate) => candidate.id === link.linkRefId);
        if (!message) continue;
        sourceRefLookup.set(`message:${message.id}`, {
          refType: "message",
          refId: message.id,
          label: `${message.senderLabel}: ${message.bodyText.slice(0, 80)}`
        });
      }
    }

    for (const decision of acceptedDecisions) {
      sourceRefLookup.set(`decision:${decision.id}`, {
        refType: "decision_record",
        refId: decision.id,
        label: decision.title
      });
    }

    const docRefs = unique(
      evidenceRefs
        .map((ref) => (ref.sectionId ? sourceRefLookup.get(ref.sectionId) : null))
        .filter((value): value is SourceRef => Boolean(value)),
      (ref) => `${ref.refType}:${ref.refId}`
    );

    const sections: LiveDocSectionArtifact[] = [
      {
        sectionKey: "overview",
        anchorId: "overview",
        sectionLabel: "Product Overview",
        type: "highlighted",
        content: buildSectionContent("Product Overview", productBrain.whatTheProductIs),
        highlight: "Current accepted product truth",
        sourceRefs: docRefs
      },
      {
        sectionKey: "audience",
        anchorId: "audience",
        sectionLabel: "Who It Is For",
        type: "body",
        content: buildSectionContent("Audience", productBrain.whoItIsFor),
        highlight: null,
        sourceRefs: docRefs
      },
      {
        sectionKey: "main-flows",
        anchorId: "main-flows",
        sectionLabel: "Main Flows",
        type: "body",
        content: buildSectionContent("Main Flows", productBrain.mainFlows),
        highlight: null,
        sourceRefs: docRefs
      },
      {
        sectionKey: "modules",
        anchorId: "modules",
        sectionLabel: "Modules",
        type: "body",
        content: buildSectionContent("Modules", productBrain.modules),
        highlight: null,
        sourceRefs: docRefs
      },
      {
        sectionKey: "constraints",
        anchorId: "constraints",
        sectionLabel: "Constraints",
        type: "body",
        content: buildSectionContent("Constraints", productBrain.constraints),
        highlight: null,
        sourceRefs: docRefs
      },
      {
        sectionKey: "integrations",
        anchorId: "integrations",
        sectionLabel: "Integrations",
        type: "body",
        content: buildSectionContent("Integrations", productBrain.integrations),
        highlight: null,
        sourceRefs: docRefs
      },
      {
        sectionKey: "unresolved",
        anchorId: "unresolved",
        sectionLabel: "Unresolved Areas",
        type: "body",
        content: buildSectionContent("Unresolved Areas", productBrain.unresolvedAreas),
        highlight: productBrain.unresolvedAreas.length > 0 ? "Needs review" : null,
        sourceRefs: docRefs
      },
      {
        sectionKey: "accepted-decisions",
        anchorId: "accepted-decisions",
        sectionLabel: "Accepted Decisions",
        type: "body",
        content: buildSectionContent(
          "Accepted Decisions",
          productBrain.acceptedDecisions.map((decision) => `${decision.title}: ${decision.statement}`)
        ),
        highlight: null,
        sourceRefs: unique(
          productBrain.acceptedDecisions
            .map((decision) => sourceRefLookup.get(`decision:${decision.decisionId}`))
            .filter((value): value is SourceRef => Boolean(value)),
          (ref) => `${ref.refType}:${ref.refId}`
        )
      },
      {
        sectionKey: "recent-changes",
        anchorId: "recent-changes",
        sectionLabel: "Recent Accepted Changes",
        type: "body",
        content: buildSectionContent(
          "Recent Accepted Changes",
          productBrain.recentAcceptedChanges.map((proposal) => `${proposal.title}: ${proposal.summary}`)
        ),
        highlight: null,
        sourceRefs: unique(
          [
            ...productBrain.recentAcceptedChanges
              .map((proposal) => sourceRefLookup.get(`change:${proposal.proposalId}`))
              .filter((value): value is SourceRef => Boolean(value)),
            ...Array.from(sourceRefLookup.values()).filter((ref) => ref.refType === "message")
          ],
          (ref) => `${ref.refType}:${ref.refId}`
        )
      }
    ];

    return sections;
  }

  private async resolveImpact(projectId: string, section: LiveDocSectionArtifact, proposedContent: string) {
    const baseText = [section.sectionLabel, section.content, proposedContent].join("\n");
    const tokens = tokenize(baseText);
    const directDocumentIds = section.sourceRefs
      .filter((ref) => ref.refType === "document_section")
      .map((ref) => ref.refId);

    const [candidateSections, candidateBrainNodes] = await Promise.all([
      this.prisma.documentSection.findMany({
        where: {
          projectId,
          OR: [
            ...(directDocumentIds.length ? [{ id: { in: directDocumentIds } }] : []),
            ...(tokens.length ? buildContainsFilters(tokens, "normalizedText") : [])
          ]
        },
        orderBy: { createdAt: "desc" },
        take: 6
      }),
      this.prisma.brainNode.findMany({
        where: {
          projectId,
          artifactVersion: {
            artifactType: "brain_graph",
            status: "accepted"
          },
          ...(tokens.length
            ? {
                OR: [...buildContainsFilters(tokens, "title"), ...buildContainsFilters(tokens, "summary")]
              }
            : {})
        },
        orderBy: { createdAt: "desc" },
        take: 4
      })
    ]);

    return {
      affectedDocumentSectionIds: unique(candidateSections, (candidate) => candidate.id).map((candidate) => candidate.id),
      affectedBrainNodeIds: unique(candidateBrainNodes, (candidate) => candidate.id).map((candidate) => candidate.id),
      communicationMessageIds: unique(
        section.sourceRefs.filter((ref) => ref.refType === "message"),
        (ref) => ref.refId
      ).map((ref) => ref.refId)
    };
  }

  private async recordPublishedRefreshRevisions(
    projectId: string,
    previousArtifact: LiveDocArtifact | null,
    nextArtifact: LiveDocArtifact,
    artifactVersionId: string,
    actorUserId: string | null
  ) {
    const previousBySection = new Map(
      (previousArtifact?.sections ?? []).map((section) => [section.sectionKey, section])
    );

    for (const section of nextArtifact.sections) {
      const previous = previousBySection.get(section.sectionKey);
      if (previous && previous.content === section.content) {
        continue;
      }

      await this.prisma.liveDocSectionRevision.upsert({
        where: {
          eventKey: `live-doc-published:${artifactVersionId}:${section.sectionKey}`
        },
        update: {},
        create: {
          projectId,
          sectionKey: section.sectionKey,
          artifactVersionId,
          actorUserId,
          eventType: "published_refresh",
          previousContent: previous?.content ?? null,
          nextContent: section.content,
          changeSummary: `Published current truth for ${section.sectionLabel}`,
          eventKey: `live-doc-published:${artifactVersionId}:${section.sectionKey}`
        }
      });
    }
  }
}

function buildCodingRequirementLiveDocSections(row: {
  id: string;
  projectId: string;
  artifactVersionId: string;
  mermaidDiagramId: string | null;
  createdAt: Date;
  artifactVersion: { payloadJson: unknown };
  mermaidDiagram: {
    id: string;
    title: string;
    description: string | null;
    diagramType: string;
    mermaidSource: string;
    source: string;
    status: string;
  } | null;
}) {
  const payload = codingRequirementsPayloadSchema.parse(row.artifactVersion.payloadJson);
  const activeDiagram =
    row.mermaidDiagram?.status === "active" && row.mermaidDiagram.diagramType === "coding_flow"
      ? row.mermaidDiagram
      : null;
  const base = {
    sourceIds: [row.artifactVersionId],
    openTargets: [
      {
        targetType: "coding_requirements",
        targetRef: { projectId: row.projectId, codingRequirementsId: row.id, artifactVersionId: row.artifactVersionId }
      }
    ],
    hasPendingDraft: false,
    acceptedChangeSummaries: [],
    overlayMarkers: [],
    lastEditedAt: row.createdAt,
    lastEditedBy: null,
    hasHistory: false
  };
  return [
    {
      id: "coding_requirements",
      anchorId: "coding_requirements",
      sectionLabel: "Coding Requirements",
      type: "body",
      content: payload.summary,
      highlight: null,
      diagrams: [],
      ...base
    },
    {
      id: "main_coding_flowchart",
      anchorId: "main_coding_flowchart",
      sectionLabel: "Main Coding Flowchart",
      type: "body",
      content: "Derived main coding flowchart for frontend Mermaid rendering.",
      highlight: null,
      diagrams: activeDiagram
        ? [
            {
              id: activeDiagram.id,
              title: activeDiagram.title,
              description: activeDiagram.description,
              diagramType: activeDiagram.diagramType,
              mermaidSource: activeDiagram.mermaidSource,
              source: activeDiagram.source,
              embeddedAt: row.createdAt.toISOString(),
              sortOrder: 0
            }
          ]
        : [],
      ...base
    },
    {
      id: "module_breakdown",
      anchorId: "module_breakdown",
      sectionLabel: "Module Breakdown",
      type: "body",
      content: payload.modules.map((module) => `${module.name}: ${module.purpose}`).join("\n"),
      highlight: null,
      diagrams: [],
      ...base
    },
    {
      id: "implementation_unknowns",
      anchorId: "implementation_unknowns",
      sectionLabel: "Implementation Unknowns",
      type: "body",
      content: payload.unknowns.length ? payload.unknowns.join("\n") : "No global implementation unknowns were generated.",
      highlight: null,
      diagrams: [],
      ...base
    }
  ];
}
