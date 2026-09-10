import type { PrismaClient, ProjectEventType, ProjectRole } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import {
  getAggregateCache,
  invalidateProjectAggregateCaches,
  setAggregateCache
} from "../../lib/dashboard/aggregate-cache.js";
import { AuditService } from "../audit/service.js";
import { ProjectService } from "../projects/service.js";
import type { CreateTimelineEventInput, TimelineQuery } from "./schemas.js";
import type {
  TimelineActor,
  TimelineDiff,
  TimelineEventDto,
  TimelineEventType,
  TimelineOpenTarget,
  TimelineSource,
  TimelineStatus,
  TimelineTier
} from "./types.js";

const MAX_TEXT_LENGTH = 240;
const TIMELINE_CACHE_TTL_MS = 60_000;

type TimelineListPayload = {
  items: TimelineEventDto[];
  view: "summary" | "detailed";
  filters: {
    source: TimelineSource | null;
    status: TimelineStatus | null;
  };
  emptyState: string | null;
  updatedAt: string;
};

type UserLike = {
  id?: string | null;
  displayName?: string | null;
  email?: string | null;
  workspaceRoleDefault?: string | null;
};

export class BetaTimelineService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService
  ) {}

  async listTimeline(projectId: string, actorUserId: string, query: TimelineQuery = { view: "detailed", limit: 50 }) {
    await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const sourceFilter = query.source && query.source !== "all" ? query.source : null;
    const statusFilter = this.normalizeStatusFilter(query.status);
    const view = query.view ?? "detailed";
    const cacheKey = `${projectId}:${actorUserId}:${view}:${sourceFilter ?? "all"}:${statusFilter ?? "all"}:${limit}`;
    const cached = getAggregateCache<TimelineListPayload>("timeline", cacheKey, TIMELINE_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }
    const perSourceLimit = Math.max(limit, 25);
    const driveFilesRead = this.prisma.projectDriveFile?.findMany({
      where: { projectId },
      orderBy: [{ modifiedTime: "desc" }, { updatedAt: "desc" }],
      take: perSourceLimit
    }) ?? Promise.resolve([]);
    const driveSyncRunsRead = this.prisma.projectDriveSyncRun?.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "desc" }],
      take: Math.min(perSourceLimit, 10)
    }) ?? Promise.resolve([]);
    const notionResourcesRead = this.prisma.projectNotionResource?.findMany({
      where: { projectId },
      orderBy: [{ lastIndexedAt: "desc" }, { lastEditedAt: "desc" }, { updatedAt: "desc" }],
      take: perSourceLimit
    }) ?? Promise.resolve([]);

    const [
      manualEvents,
      communicationMessages,
      socratesMessages,
      githubEvidence,
      driveFiles,
      driveSyncRuns,
      notionResources,
      editorConnectors,
      documents,
      proposals,
      revisions
    ] = await Promise.all([
      this.prisma.projectEvent.findMany({
        where: { projectId },
        include: { creator: { select: safeUserSelect } },
        orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
        take: perSourceLimit
      }),
      this.prisma.communicationMessage.findMany({
        where: {
          projectId,
          provider: { in: ["manual_import", "slack", "fireflies_ai", "clickup", "granola", "microsoft_teams", "zoho_mail", "zoho_cliq", "zoho_crm"] },
          isDeletedByProvider: false
        },
        include: {
          thread: { select: { id: true, subject: true, threadUrl: true } },
          connector: { select: { id: true, accountLabel: true } }
        },
        orderBy: { sentAt: "desc" },
        take: perSourceLimit
      }),
      this.prisma.socratesMessage.findMany({
        where: { role: "user", session: { projectId } },
        include: {
          session: {
            select: {
              id: true,
              user: { select: safeUserSelect }
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: perSourceLimit
      }),
      this.prisma.gitHubEngineeringEvidence.findMany({
        where: { projectId, evidenceStatus: "active" },
        include: { mappedUser: { select: safeUserSelect } },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        take: perSourceLimit
      }),
      driveFilesRead,
      driveSyncRunsRead,
      notionResourcesRead,
      this.prisma.projectEditorConnector.findMany({
        where: { projectId, connectorType: "vscode" },
        include: { user: { select: safeUserSelect } },
        orderBy: [{ lastUsedAt: "desc" }, { updatedAt: "desc" }],
        take: perSourceLimit
      }),
      this.prisma.document.findMany({
        where: { projectId, archivedAt: null },
        include: {
          uploader: { select: safeUserSelect },
          versions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, status: true, createdAt: true, processedAt: true, fileSize: true, mimeType: true }
          }
        },
        orderBy: { createdAt: "desc" },
        take: perSourceLimit
      }),
      this.prisma.specChangeProposal.findMany({
        where: { projectId },
        include: {
          links: true,
          accepter: { select: safeUserSelect },
          decisionRecord: true
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: perSourceLimit
      }),
      this.prisma.liveDocSectionRevision.findMany({
        where: {
          projectId,
          proposalId: { not: null },
          eventType: { in: ["proposal_accepted", "proposal_rejected", "proposal_created"] }
        },
        include: {
          actor: { select: safeUserSelect },
          proposal: {
            include: {
              links: true,
              accepter: { select: safeUserSelect }
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: perSourceLimit
      })
    ]);

    const revisionProposalIds = new Set(
      revisions
        .map((revision) => revision.proposalId)
        .filter((proposalId): proposalId is string => Boolean(proposalId))
    );

    const events = [
      ...manualEvents.map((event) => this.fromProjectEvent(event)),
      ...communicationMessages.map((message) => this.fromCommunicationMessage(message)),
      ...socratesMessages.map((message) => this.fromSocratesMessage(message)),
      ...githubEvidence.map((evidence) => this.fromGithubEvidence(evidence)),
      ...driveFiles.map((file) => this.fromDriveFile(file)),
      ...driveSyncRuns.map((run) => this.fromDriveSyncRun(run)),
      ...notionResources.map((resource) => this.fromNotionResource(resource)),
      ...editorConnectors.map((connector) => this.fromEditorConnector(connector)),
      ...documents.map((document) => this.fromDocument(document)),
      ...proposals
        .filter((proposal) => !revisionProposalIds.has(proposal.id) || proposal.status === "detected" || proposal.status === "needs_review")
        .map((proposal) => this.fromProposal(proposal)),
      ...revisions.map((revision) => this.fromLiveDocRevision(revision))
    ]
      .filter((event) => (sourceFilter ? event.source === sourceFilter : true))
      .filter((event) => (statusFilter ? event.status === statusFilter : true))
      .sort((left, right) => {
        const timeDelta = new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
        return timeDelta || right.id.localeCompare(left.id);
      });

    const dedupedEvents = unique(events, (event) => {
      if (event.proposalId && event.status !== "pending") return `proposal:${event.proposalId}:${event.status}`;
      return event.id;
    });
    const deduped =
      sourceFilter || statusFilter
        ? dedupedEvents.slice(0, limit)
        : diversifyTimelineSources(dedupedEvents, limit);

    const payload = {
      items: deduped,
      view,
      filters: {
        source: sourceFilter,
        status: statusFilter
      },
      emptyState: deduped.length === 0 ? "No project timeline events are available for the selected filters." : null,
      updatedAt: new Date().toISOString()
    };
    setAggregateCache("timeline", cacheKey, payload);
    return payload;
  }

  async getTimelineEvent(projectId: string, eventId: string, actorUserId: string) {
    const timeline = await this.listTimeline(projectId, actorUserId, { view: "detailed", limit: 100 });
    const event = timeline.items.find((item) => item.id === eventId);
    if (!event) {
      throw new AppError(404, "Timeline event not found", "timeline_event_not_found");
    }
    return event;
  }

  async createManualEvent(projectId: string, actorUserId: string, input: CreateTimelineEventInput) {
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    if (!this.canCreateManualEvent(member.projectRole)) {
      throw new AppError(403, "Manager or developer access required", "timeline_event_create_denied");
    }

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { orgId: true }
    });
    const startsAt = new Date(input.startsAt ?? input.timestamp ?? new Date().toISOString());
    const sourceHint = input.source ?? "manual";
    const linkedRefType = input.linkedRefType ?? (sourceHint !== "manual" ? `manual_${sourceHint}_reference` : null);
    const linkedRefId = input.linkedRefId ?? input.sourceRef ?? null;

    const event = await this.prisma.projectEvent.create({
      data: {
        orgId: project.orgId,
        projectId,
        title: input.title,
        description: input.description ?? null,
        eventType: this.toProjectEventType(input.eventType, input.tier),
        source: "manual",
        startsAt,
        timezone: "UTC",
        createdBy: actorUserId,
        linkedRefType,
        linkedRefId,
        isAllDay: false
      },
      include: { creator: { select: safeUserSelect } }
    });

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "project_timeline_event_created",
      entityType: "project_event",
      entityId: event.id,
      payload: {
        title: event.title,
        source: "manual",
        sourceHint,
        linkedRefType,
        linkedRefId,
        spoofingPolicy: sourceHint === "manual" ? "manual_event" : "stored_as_manual_reference"
      }
    });

    invalidateProjectAggregateCaches(projectId);

    return this.fromProjectEvent(event, sourceHint !== "manual" ? sourceHint : null);
  }

  private fromProjectEvent(event: any, sourceHint: string | null = null): TimelineEventDto {
    const tier: TimelineTier = event.eventType === "milestone" ? "milestone" : "atomic";
    const isImportedCalendar = event.source === "imported" && event.providerCalendarId;
    const source: TimelineSource = isImportedCalendar ? "calendar" : "manual";
    return {
      id: `${source}:${event.id}`,
      source,
      type: event.eventType === "milestone" ? "milestone" : "note",
      title: event.title,
      description: event.description ?? null,
      timestamp: toIso(event.startsAt ?? event.createdAt),
      status: "informational",
      author: toActor(event.creator),
      sourceRef: event.linkedRefId ?? null,
      tier,
      diff: null,
      openTarget: {
        targetType: "project_event",
        targetRef: { eventId: event.id }
      },
      proposalId: null,
      reviewItemId: null,
      sectionKey: null,
      documentSectionId: null,
      sourceMessageId: null,
      sourceThreadId: null,
      sourceDocumentId: null,
      acceptedBy: null,
      acceptedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      metadataSummary:
        isImportedCalendar
          ? `Imported Google Calendar event from ${event.providerCalendarId}; operational evidence.`
          : sourceHint && sourceHint !== "manual"
          ? `Manual event referencing ${sourceHint}; not provider-originated evidence.`
          : event.linkedRefType
            ? `Manual event linked to ${event.linkedRefType}.`
            : null
    };
  }

  private fromCommunicationMessage(message: any): TimelineEventDto {
    const source = this.sourceFromCommunicationProvider(message.provider);
    const label = providerLabel(message.provider);
    return {
      id: `${source}:${message.id}`,
      source,
      type: "message",
      title: message.thread?.subject ?? `${label} message from ${message.senderLabel}`,
      description: truncate(message.bodyText),
      timestamp: toIso(message.sentAt),
      status: "informational",
      author: toActor({ displayName: message.senderLabel }),
      sourceRef: message.thread?.subject ?? message.connector?.accountLabel ?? null,
      tier: "atomic",
      diff: null,
      openTarget: {
        targetType: "communication_message",
        targetRef: {
          messageId: message.id,
          threadId: message.threadId,
          provider: message.provider
        }
      },
      proposalId: null,
      reviewItemId: null,
      sectionKey: null,
      documentSectionId: null,
      sourceMessageId: message.id,
      sourceThreadId: message.threadId,
      sourceDocumentId: null,
      acceptedBy: null,
      acceptedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      metadataSummary: message.connector?.accountLabel ? `${label} account: ${message.connector.accountLabel}` : `${label} communication evidence`
    };
  }

  private fromSocratesMessage(message: any): TimelineEventDto {
    return {
      id: `socrates:${message.id}`,
      source: "socrates",
      type: "query",
      title: "Socrates question",
      description: truncate(message.content),
      timestamp: toIso(message.createdAt),
      status: "informational",
      author: toActor(message.session?.user),
      sourceRef: message.sessionId,
      tier: "atomic",
      diff: null,
      openTarget: {
        targetType: "socrates_message",
        targetRef: { sessionId: message.sessionId, messageId: message.id }
      },
      proposalId: null,
      reviewItemId: null,
      sectionKey: null,
      documentSectionId: null,
      sourceMessageId: null,
      sourceThreadId: null,
      sourceDocumentId: null,
      acceptedBy: null,
      acceptedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      metadataSummary: "User question; assistant/system prompts are not exposed."
    };
  }

  private fromGithubEvidence(evidence: any): TimelineEventDto {
    const type: TimelineEventType = evidence.evidenceType === "github_commit" || evidence.sha ? "commit" : "change";
    return {
      id: `github:${evidence.id}`,
      source: "github",
      type,
      title: evidence.title ?? `${evidence.repositoryOwner}/${evidence.repositoryName}`,
      description: evidence.summary ?? null,
      timestamp: toIso(evidence.occurredAt ?? evidence.createdAt),
      status: "informational",
      author: toActor(evidence.mappedUser ?? { displayName: evidence.actorGithubLogin }),
      sourceRef: evidence.sha ?? evidence.pullRequestNumber?.toString() ?? evidence.providerId ?? null,
      tier: type === "commit" ? "atomic" : "milestone",
      diff: null,
      openTarget: this.safeOpenTarget(evidence.openTargetJson) ?? {
        targetType: "github_evidence",
        targetRef: { evidenceId: evidence.id }
      },
      proposalId: null,
      reviewItemId: null,
      sectionKey: null,
      documentSectionId: null,
      sourceMessageId: null,
      sourceThreadId: null,
      sourceDocumentId: null,
      acceptedBy: null,
      acceptedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      metadataSummary: `${evidence.repositoryOwner}/${evidence.repositoryName}${evidence.branch ? ` on ${evidence.branch}` : ""}`
    };
  }

  private fromDriveFile(file: any): TimelineEventDto {
    const status: TimelineStatus =
      file.indexStatus === "failed" ? "failed" : file.indexStatus === "skipped" ? "superseded" : "informational";
    return {
      id: `google-drive-file:${file.id}`,
      source: "google_drive",
      type: file.documentId ? "upload" : "change",
      title: file.name,
      description:
        file.indexStatus === "indexed"
          ? "Google Drive file indexed as read-only project evidence."
          : `Google Drive file ${String(file.indexStatus).replace(/_/g, " ")}.`,
      timestamp: toIso(file.modifiedTime ?? file.lastIndexedAt ?? file.updatedAt ?? file.createdAt),
      status,
      author: toActor({ displayName: file.lastModifyingUserSummary ?? file.ownersSummary ?? "Google Drive" }),
      sourceRef: file.webViewLink ?? file.driveFileId ?? null,
      tier: "atomic",
      diff: null,
      openTarget: file.documentId
        ? {
            targetType: "document",
            targetRef: { documentId: file.documentId, documentVersionId: file.documentVersionId, driveFileId: file.id }
          }
        : {
            targetType: "google_drive_file",
            targetRef: { driveFileId: file.id, driveProviderFileId: file.driveFileId }
          },
      proposalId: null,
      reviewItemId: null,
      sectionKey: null,
      documentSectionId: null,
      sourceMessageId: null,
      sourceThreadId: null,
      sourceDocumentId: file.documentId,
      acceptedBy: null,
      acceptedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      metadataSummary: `${file.mimeType}${file.sharedDrive ? " · shared drive" : ""}`
    };
  }

  private fromDriveSyncRun(run: any): TimelineEventDto {
    const status: TimelineStatus = ["failed", "partial"].includes(run.status) ? "failed" : "informational";
    const finishedAt = run.finishedAt ?? run.startedAt ?? run.createdAt;
    return {
      id: `google-drive-sync:${run.id}`,
      source: "google_drive",
      type: "connector",
      title: `Google Drive sync ${String(run.status).replace(/_/g, " ")}`,
      description: `${run.filesIndexed ?? 0} indexed, ${run.filesSkipped ?? 0} skipped, ${run.filesFailed ?? 0} failed.`,
      timestamp: toIso(finishedAt),
      status,
      author: toActor({ displayName: "Google Drive" }),
      sourceRef: run.syncType ?? null,
      tier: "atomic",
      diff: null,
      openTarget: { targetType: "google_drive_sync_run", targetRef: { syncRunId: run.id } },
      proposalId: null,
      reviewItemId: null,
      sectionKey: null,
      documentSectionId: null,
      sourceMessageId: null,
      sourceThreadId: null,
      sourceDocumentId: null,
      acceptedBy: null,
      acceptedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      metadataSummary: run.errorMessage ? truncate(String(run.errorMessage), 160) : `Sync type: ${run.syncType}`
    };
  }

  private fromNotionResource(resource: any): TimelineEventDto {
    const status: TimelineStatus =
      ["inaccessible", "unsupported", "provider_error", "rate_limited"].includes(resource.indexStatus)
        ? "failed"
        : "informational";
    return {
      id: `notion:${resource.id}`,
      source: "notion",
      type: resource.documentId ? "upload" : "change",
      title: resource.title,
      description:
        status === "failed"
          ? `Notion resource ${String(resource.indexStatus).replace(/_/g, " ")}.`
          : "Notion resource indexed as read-only project memory evidence.",
      timestamp: toIso(resource.lastEditedAt ?? resource.lastIndexedAt ?? resource.updatedAt ?? resource.createdAt),
      status,
      author: toActor({ displayName: "Notion" }),
      sourceRef: resource.selectedResourceLabel ?? resource.url ?? resource.notionResourceId,
      tier: "atomic",
      diff: null,
      openTarget: resource.documentId
        ? {
            targetType: "document",
            targetRef: {
              documentId: resource.documentId,
              documentVersionId: resource.documentVersionId,
              notionResourceId: resource.id
            }
          }
        : {
            targetType: "notion_resource",
            targetRef: {
              notionResourceId: resource.id
            }
          },
      proposalId: null,
      reviewItemId: null,
      sectionKey: null,
      documentSectionId: null,
      sourceMessageId: null,
      sourceThreadId: null,
      sourceDocumentId: resource.documentId,
      acceptedBy: null,
      acceptedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      metadataSummary: `${resource.resourceType}${resource.selectedResourceLabel ? ` · selected from ${resource.selectedResourceLabel}` : ""}`
    };
  }

  private fromEditorConnector(connector: any): TimelineEventDto {
    const status: TimelineStatus = connector.status === "revoked" ? "superseded" : "informational";
    return {
      id: `vscode:${connector.id}`,
      source: "vscode",
      type: "connector",
      title: `${connector.label || "VS Code connector"} ${connector.status}`,
      description: connector.lastUsedAt ? "VS Code connector was used recently." : "VS Code connector was paired or updated.",
      timestamp: toIso(connector.lastUsedAt ?? connector.updatedAt ?? connector.createdAt),
      status,
      author: toActor(connector.user),
      sourceRef: connector.label ?? null,
      tier: "atomic",
      diff: null,
      openTarget: {
        targetType: "vscode_connector",
        targetRef: { connectorId: connector.id }
      },
      proposalId: null,
      reviewItemId: null,
      sectionKey: null,
      documentSectionId: null,
      sourceMessageId: null,
      sourceThreadId: null,
      sourceDocumentId: null,
      acceptedBy: null,
      acceptedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      metadataSummary: `Connector status: ${connector.status}`
    };
  }

  private fromDocument(document: any): TimelineEventDto {
    const version = document.versions?.[0] ?? null;
    const status: TimelineStatus = version?.status === "failed" ? "failed" : "informational";
    return {
      id: `document:${document.id}`,
      source: "document",
      type: "upload",
      title: document.title,
      description: `Uploaded ${document.kind.toUpperCase()} document`,
      timestamp: toIso(document.createdAt),
      status,
      author: toActor(document.uploader),
      sourceRef: version?.id ?? document.currentVersionId ?? null,
      tier: "milestone",
      diff: null,
      openTarget: {
        targetType: "document",
        targetRef: { documentId: document.id, documentVersionId: version?.id ?? document.currentVersionId ?? null }
      },
      proposalId: null,
      reviewItemId: null,
      sectionKey: null,
      documentSectionId: null,
      sourceMessageId: null,
      sourceThreadId: null,
      sourceDocumentId: document.id,
      acceptedBy: null,
      acceptedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      metadataSummary: version ? `Parse status: ${version.status}` : "Document upload"
    };
  }

  private fromProposal(proposal: any): TimelineEventDto {
    const status = this.proposalStatus(proposal.status);
    const source = this.sourceFromProposal(proposal);
    const linkRefs = this.proposalRefs(proposal);
    const documentSectionId = linkRefs.documentSectionIds[0] ?? null;
    const sourceMessageId = linkRefs.messageIds[0] ?? null;
    const sourceThreadId = linkRefs.threadIds[0] ?? null;
    return {
      id: `proposal:${proposal.id}:${status}`,
      source,
      type: "change",
      title: proposal.title,
      description: proposal.summary,
      timestamp: toIso(proposal.updatedAt ?? proposal.createdAt),
      status,
      author: null,
      sourceRef: sourceMessageId ?? sourceThreadId ?? documentSectionId,
      tier: status === "pending" ? "milestone" : "atomic",
      diff: proposalDiff(proposal),
      openTarget: {
        targetType: "change_proposal",
        targetRef: { proposalId: proposal.id, documentSectionId, sourceMessageId, sourceThreadId }
      },
      proposalId: proposal.id,
      reviewItemId: proposal.id,
      sectionKey: documentSectionId ? `doc:${documentSectionId}` : null,
      documentSectionId,
      sourceMessageId,
      sourceThreadId,
      sourceDocumentId: null,
      acceptedBy: proposal.accepter ? toActor(proposal.accepter) : null,
      acceptedAt: proposal.acceptedAt ? toIso(proposal.acceptedAt) : null,
      rejectedBy: null,
      rejectedAt: null,
      metadataSummary: `Proposal type: ${proposal.proposalType}. Pending proposals are evidence, not truth.`
    };
  }

  private fromLiveDocRevision(revision: any): TimelineEventDto {
    const status: TimelineStatus =
      revision.eventType === "proposal_accepted"
        ? "accepted"
        : revision.eventType === "proposal_rejected"
          ? "rejected"
          : "pending";
    const proposal = revision.proposal;
    return {
      id: `livedoc:${revision.id}`,
      source: "approval",
      type: status === "accepted" ? "approval" : status === "rejected" ? "rejection" : "change",
      title: proposal?.title ?? revision.changeSummary ?? "LiveDoc review marker",
      description: proposal?.summary ?? revision.changeSummary ?? null,
      timestamp: toIso(revision.createdAt),
      status,
      author: toActor(revision.actor),
      sourceRef: revision.proposalId,
      tier: "milestone",
      diff: revisionDiff(revision, proposal),
      openTarget: {
        targetType: "live_doc_review",
        targetRef: {
          proposalId: revision.proposalId,
          revisionId: revision.id,
          sectionKey: revision.sectionKey,
          documentSectionId: revision.documentSectionId
        }
      },
      proposalId: revision.proposalId,
      reviewItemId: revision.proposalId,
      sectionKey: revision.sectionKey,
      documentSectionId: revision.documentSectionId,
      sourceMessageId: firstProposalRef(proposal, "message"),
      sourceThreadId: firstProposalRef(proposal, "thread"),
      sourceDocumentId: revision.sourceDocumentId,
      acceptedBy: status === "accepted" ? toActor(proposal?.accepter ?? revision.actor) : null,
      acceptedAt: status === "accepted" ? toIso(proposal?.acceptedAt ?? revision.createdAt) : null,
      rejectedBy: status === "rejected" ? toActor(revision.actor) : null,
      rejectedAt: status === "rejected" ? toIso(revision.createdAt) : null,
      metadataSummary:
        status === "accepted"
          ? "Accepted by a manager or delegated truth approver."
          : status === "rejected"
            ? "Rejected; truth was not mutated."
            : "Pending review marker."
    };
  }

  private normalizeStatusFilter(status?: string | null): TimelineStatus | null {
    if (!status || status === "all") return null;
    if (status === "needs_review") return "pending";
    if (status === "info") return "informational";
    return status as TimelineStatus;
  }

  private proposalStatus(status: string): TimelineStatus {
    if (status === "detected" || status === "needs_review") return "pending";
    if (status === "accepted") return "accepted";
    if (status === "rejected") return "rejected";
    if (status === "superseded") return "superseded";
    return "informational";
  }

  private sourceFromProposal(proposal: any): TimelineSource {
    const links = proposal?.links ?? [];
    if (links.some((link: any) => link.linkType === "message" || link.linkType === "thread")) return "approval";
    if (links.some((link: any) => link.linkType === "document_section")) return "document";
    return "approval";
  }

  private sourceFromCommunicationProvider(provider?: string | null): TimelineSource {
    if (provider === "clickup") return "clickup";
    if (provider === "granola") return "granola";
    if (provider === "fireflies_ai") return "fireflies_ai";
    if (provider === "manual_import") return "manual_import";
    if (provider === "microsoft_teams") return "microsoft_teams";
    if (provider === "zoho_mail") return "zoho_mail";
    if (provider === "zoho_cliq") return "zoho_cliq";
    if (provider === "zoho_crm") return "zoho_crm";
    return "slack";
  }

  private proposalRefs(proposal: any) {
    const links = proposal?.links ?? [];
    return {
      messageIds: links.filter((link: any) => link.linkType === "message").map((link: any) => link.linkRefId),
      threadIds: links.filter((link: any) => link.linkType === "thread").map((link: any) => link.linkRefId),
      documentSectionIds: links
        .filter((link: any) => link.linkType === "document_section")
        .map((link: any) => link.linkRefId)
    };
  }

  private safeOpenTarget(value: unknown): TimelineOpenTarget | null {
    if (!value || typeof value !== "object") return null;
    const target = value as { targetType?: unknown; targetRef?: unknown };
    if (typeof target.targetType !== "string" || !target.targetRef || typeof target.targetRef !== "object") {
      return null;
    }
    return {
      targetType: target.targetType,
      targetRef: target.targetRef as Record<string, unknown>
    };
  }

  private canCreateManualEvent(projectRole: ProjectRole) {
    return projectRole === "manager" || projectRole === "dev";
  }

  private toProjectEventType(type?: string | null, tier?: string | null): ProjectEventType {
    if (tier === "milestone") return "milestone";
    if (type === "milestone") return "milestone";
    if (type === "decision") return "review";
    return "other";
  }
}

const safeUserSelect = {
  id: true,
  displayName: true,
  email: true,
  workspaceRoleDefault: true
};

function toActor(user?: UserLike | null): TimelineActor | null {
  if (!user) return null;
  const name = user.displayName ?? user.email ?? "System";
  return {
    userId: user.id ?? null,
    name,
    initials: toInitials(name),
    role: user.workspaceRoleDefault ?? null
  };
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

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function truncate(value?: string | null, maxLength = MAX_TEXT_LENGTH) {
  if (!value) return null;
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 1)}...`;
}

function providerLabel(provider?: string | null) {
  switch (provider) {
    case "clickup":
      return "ClickUp";
    case "granola":
      return "Granola";
    case "fireflies_ai":
      return "Fireflies";
    case "manual_import":
      return "Manual import";
    case "microsoft_teams":
      return "Microsoft Teams";
    case "zoho_mail":
      return "Zoho Mail";
    case "zoho_cliq":
      return "Zoho Cliq";
    case "zoho_crm":
      return "Zoho CRM";
    case "slack":
    default:
      return "Slack";
  }
}

function proposalDiff(proposal: any): TimelineDiff[] | null {
  const oldValue = summarizeJson(proposal.oldUnderstandingJson);
  const newValue = summarizeJson(proposal.newUnderstandingJson);
  if (!oldValue && !newValue) return null;
  return [
    {
      field: proposal.proposalType ?? "understanding",
      old: oldValue,
      new: newValue
    }
  ];
}

function revisionDiff(revision: any, proposal?: any): TimelineDiff[] | null {
  if (revision.previousContent || revision.nextContent) {
    return [
      {
        field: revision.sectionKey ?? "live_doc_section",
        old: truncate(revision.previousContent, 500),
        new: truncate(revision.nextContent, 500)
      }
    ];
  }
  return proposal ? proposalDiff(proposal) : null;
}

function summarizeJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return truncate(value, 500);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["content", "text", "summary", "title", "value"]) {
      if (typeof record[key] === "string") {
        return truncate(record[key] as string, 500);
      }
    }
  }
  return truncate(JSON.stringify(value), 500);
}

function firstProposalRef(proposal: any, linkType: string) {
  return proposal?.links?.find((link: any) => link.linkType === linkType)?.linkRefId ?? null;
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

function diversifyTimelineSources(events: TimelineEventDto[], limit: number) {
  const selected = events.slice(0, limit);
  const selectedIds = new Set(selected.map((event) => event.id));
  const sourceCounts = new Map<TimelineSource, number>();
  selected.forEach((event) => sourceCounts.set(event.source, (sourceCounts.get(event.source) ?? 0) + 1));

  const sourceOrder: TimelineSource[] = [
    "slack",
    "clickup",
    "granola",
    "fireflies_ai",
    "manual_import",
    "microsoft_teams",
    "approval",
    "document",
    "google_drive",
    "notion",
    "github",
    "calendar",
    "socrates",
    "vscode",
    "manual",
    "system"
  ];

  for (const source of sourceOrder) {
    if (sourceCounts.has(source)) continue;
    const candidate = events.find((event) => event.source === source && !selectedIds.has(event.id));
    if (!candidate) continue;

    const replaceIndex = findReplaceableTimelineIndex(selected, sourceCounts);
    if (replaceIndex < 0) continue;

    const removed = selected[replaceIndex];
    selectedIds.delete(removed.id);
    const removedCount = Math.max((sourceCounts.get(removed.source) ?? 1) - 1, 0);
    if (removedCount > 0) {
      sourceCounts.set(removed.source, removedCount);
    } else {
      sourceCounts.delete(removed.source);
    }

    selected[replaceIndex] = candidate;
    selectedIds.add(candidate.id);
    sourceCounts.set(candidate.source, 1);
  }

  return selected.sort((left, right) => {
    const timeDelta = new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
    return timeDelta || right.id.localeCompare(left.id);
  });
}

function findReplaceableTimelineIndex(events: TimelineEventDto[], sourceCounts: Map<TimelineSource, number>) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.status === "pending" || event.status === "accepted" || event.status === "rejected") continue;
    if ((sourceCounts.get(event.source) ?? 0) <= 1) continue;
    return index;
  }
  return -1;
}
