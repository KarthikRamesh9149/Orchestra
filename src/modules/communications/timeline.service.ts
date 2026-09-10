import type { PrismaClient, ProjectRole } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { decodeCursor, encodeCursor } from "../../lib/communications/sync-cursors.js";
import { getAggregateCache, setAggregateCache } from "../../lib/dashboard/aggregate-cache.js";
import { ensureCommunicationReadAccess } from "./authz.js";
import type { ProjectService } from "../projects/service.js";
import { AuditService } from "../audit/service.js";

type CursorShape = {
  lastMessageAt: string;
  id: string;
};

const COMMUNICATION_TIMELINE_CACHE_TTL_MS = 60_000;

function normalizeProjectionText(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function semanticThreadProjectionKey(thread: {
  provider: string;
  subject: string | null;
  threadUrl: string | null;
  messages: Array<{
    providerPermalink: string | null;
    senderLabel: string;
    bodyText: string;
  }>;
}) {
  const providerUrl = thread.threadUrl?.trim() || thread.messages[0]?.providerPermalink?.trim();
  if (providerUrl) return `${thread.provider}:url:${providerUrl}`;
  const latest = thread.messages[0];
  return [
    thread.provider,
    normalizeProjectionText(thread.subject),
    normalizeProjectionText(latest?.senderLabel),
    normalizeProjectionText(latest?.bodyText)
  ].join(":semantic:");
}

function timelineCacheKey(
  projectId: string,
  query: {
    provider?: string;
    connectorId?: string;
    sourceSubType?: string;
    insightType?: string;
    insightStatus?: string;
    proposalStatus?: string;
    hasChangeProposal?: boolean;
    hasOpenDecision?: boolean;
    hasBlocker?: boolean;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    cursor?: string;
    limit: number;
  },
  includeAttention: boolean
) {
  return `${projectId}:${JSON.stringify({
    includeAttention,
    provider: query.provider ?? null,
    connectorId: query.connectorId ?? null,
    sourceSubType: query.sourceSubType ?? null,
    insightType: query.insightType ?? null,
    insightStatus: query.insightStatus ?? null,
    proposalStatus: query.proposalStatus ?? null,
    hasChangeProposal: query.hasChangeProposal ?? null,
    hasOpenDecision: query.hasOpenDecision ?? null,
    hasBlocker: query.hasBlocker ?? null,
    dateFrom: query.dateFrom ?? null,
    dateTo: query.dateTo ?? null,
    search: query.search?.trim().toLowerCase() ?? null,
    cursor: query.cursor ?? null,
    limit: query.limit
  })}`;
}

export class TimelineService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService
  ) {}

  async getTimeline(
    projectId: string,
    actorUserId: string,
    query: {
      provider?: string;
      connectorId?: string;
      sourceSubType?: string;
      insightType?: string;
      insightStatus?: string;
      proposalStatus?: string;
      hasChangeProposal?: boolean;
      hasOpenDecision?: boolean;
      hasBlocker?: boolean;
      dateFrom?: string;
      dateTo?: string;
      search?: string;
      cursor?: string;
      limit: number;
    }
  ) {
    const member = await ensureCommunicationReadAccess(this.projectService, projectId, actorUserId);
    const result = await this.listThreadsInternal(projectId, query, true);

    void this.recordTimelineReadAudit(projectId, actorUserId, member.projectRole, result.items.length);

    return result;
  }

  async listThreads(
    projectId: string,
    actorUserId: string,
    query: {
      provider?: string;
      updatedSince?: string;
      search?: string;
      cursor?: string;
      limit: number;
    }
  ) {
    await ensureCommunicationReadAccess(this.projectService, projectId, actorUserId);
    return this.listThreadsInternal(projectId, {
      provider: query.provider,
      dateFrom: query.updatedSince,
      search: query.search,
      cursor: query.cursor,
      limit: query.limit
    }, false);
  }

  async getThread(projectId: string, threadId: string, actorUserId: string) {
    const member = await ensureCommunicationReadAccess(this.projectService, projectId, actorUserId);
    const thread = await this.prisma.communicationThread.findFirstOrThrow({
      where: { id: threadId, projectId },
      include: {
        connector: true,
        messages: {
          where: { isDeletedByProvider: false },
          orderBy: { sentAt: "asc" },
          include: {
            attachments: true
          }
        },
        threadInsights: {
          orderBy: { createdAt: "desc" },
          take: 10
        }
      }
    });

    const links = await this.prisma.specChangeLink.findMany({
      where: {
        projectId,
        OR: [
          { linkType: "thread", linkRefId: thread.id },
          { linkType: "message", linkRefId: { in: thread.messages.map((message) => message.id) } }
        ]
      },
      include: {
        proposal: {
          include: { decisionRecord: true }
        }
      }
    });

    const proposals = this.mapProposalLinks(links);
    const decisions = this.mapDecisions(links);

    return {
      thread: {
        id: thread.id,
        connectorId: thread.connectorId,
        provider: thread.provider,
        providerThreadId: thread.providerThreadId,
        subject: thread.subject,
        participants: thread.participantsJson,
        threadUrl: thread.threadUrl,
        startedAt: thread.startedAt?.toISOString() ?? null,
        lastMessageAt: thread.lastMessageAt?.toISOString() ?? null
      },
      connector: {
        id: thread.connector.id,
        provider: thread.connector.provider,
        accountLabel: thread.connector.accountLabel,
        status: thread.connector.status
      },
      messages: thread.messages.map((message) => ({
        id: message.id,
        providerMessageId: message.providerMessageId,
        providerPermalink: message.providerPermalink,
        sourceSubType: this.extractSourceSubType(message.rawMetadataJson),
        senderLabel: message.senderLabel,
        senderExternalRef: message.senderExternalRef,
        senderEmail: message.senderEmail,
        sentAt: message.sentAt.toISOString(),
        bodyText: message.bodyText,
        bodyHtml: message.bodyHtml,
        messageType: message.messageType,
        isEdited: message.isEdited,
        replyToMessageId: message.replyToMessageId,
        attachmentCount: message.attachments.length,
        providerOpenTarget: this.buildProviderOpenTarget(thread, message)
      })),
      insights: thread.threadInsights.map((insight) => ({
        id: insight.id,
        insightType: insight.insightType,
        status: insight.status,
        summary: insight.summary,
        confidence: Number(insight.confidence),
        generatedProposalId: insight.generatedProposalId,
        generatedDecisionId: insight.generatedDecisionId
      })),
      linkedChanges: proposals,
      linkedDecisions: decisions,
      openTargets: {
        thread: this.buildThreadOpenTarget(thread.id),
        providerEvidence: this.buildProviderOpenTarget(thread, thread.messages[0] ?? null),
        documents: await this.loadDocumentTargets(projectId, proposals.map((proposal) => proposal.proposalId))
      },
      viewerState: {
        pageContext: "doc_viewer" as const,
        selectedRefType: "document" as const,
        selectedRefId: (await this.loadDocumentTargets(projectId, proposals.map((proposal) => proposal.proposalId)))[0]?.targetRef.documentId ?? null
      },
      projectRole: member.projectRole
    };
  }

  async getMessage(projectId: string, messageId: string, actorUserId: string) {
    const member = await ensureCommunicationReadAccess(this.projectService, projectId, actorUserId);
    const message = await this.prisma.communicationMessage.findFirstOrThrow({
      where: { id: messageId, projectId, isDeletedByProvider: false },
      include: {
        connector: true,
        thread: true,
        revisions: { orderBy: { revisionIndex: "desc" } },
        attachments: true,
        chunks: { orderBy: { chunkIndex: "asc" } },
        insights: { orderBy: { createdAt: "desc" } }
      }
    });

    const links = await this.prisma.specChangeLink.findMany({
      where: {
        projectId,
        OR: [
          { linkType: "message", linkRefId: message.id },
          { linkType: "thread", linkRefId: message.threadId }
        ]
      },
      include: {
        proposal: {
          include: { decisionRecord: true }
        }
      }
    });
    const proposals = this.mapProposalLinks(links);
    const decisions = this.mapDecisions(links);
    const documentTargets = await this.loadDocumentTargets(projectId, proposals.map((proposal) => proposal.proposalId));

    await this.auditService.record({
      orgId: await this.resolveOrgId(projectId),
      projectId,
      actorUserId,
      eventType: "communication_message_opened",
      entityType: "communication_message",
      entityId: message.id,
      payload: { projectRole: member.projectRole }
    });

    return {
      connector: {
        id: message.connector.id,
        provider: message.connector.provider,
        accountLabel: message.connector.accountLabel,
        status: message.connector.status
      },
      thread: {
        id: message.thread.id,
        providerThreadId: message.thread.providerThreadId,
        subject: message.thread.subject,
        participants: message.thread.participantsJson,
        threadUrl: message.thread.threadUrl,
        openTarget: this.buildThreadOpenTarget(message.thread.id)
      },
      message: {
        id: message.id,
        provider: message.provider,
        providerMessageId: message.providerMessageId,
        providerPermalink: message.providerPermalink,
        senderLabel: message.senderLabel,
        senderExternalRef: message.senderExternalRef,
        senderEmail: message.senderEmail,
        sentAt: message.sentAt.toISOString(),
        bodyText: message.bodyText,
        bodyHtml: message.bodyHtml,
        bodyHash: message.bodyHash,
        messageType: message.messageType,
        sourceSubType: this.extractSourceSubType(message.rawMetadataJson),
        isEdited: message.isEdited,
        isDeletedByProvider: message.isDeletedByProvider,
        replyToMessageId: message.replyToMessageId
      },
      revisions: message.revisions.map((revision) => ({
        id: revision.id,
        revisionIndex: revision.revisionIndex,
        bodyText: revision.bodyText,
        bodyHtml: revision.bodyHtml,
        bodyHash: revision.bodyHash,
        editedAt: revision.editedAt?.toISOString() ?? null,
        createdAt: revision.createdAt.toISOString()
      })),
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        providerAttachmentId: attachment.providerAttachmentId,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize != null ? Number(attachment.fileSize) : null,
        providerUrl: attachment.providerUrl,
        storageStatus: attachment.storageStatus
      })),
      chunks: message.chunks.map((chunk) => ({
        id: chunk.id,
        chunkIndex: chunk.chunkIndex,
        tokenCount: chunk.tokenCount,
        createdAt: chunk.createdAt.toISOString()
      })),
      insights: message.insights.map((insight) => ({
        id: insight.id,
        insightType: insight.insightType,
        status: insight.status,
        summary: insight.summary,
        confidence: Number(insight.confidence),
        generatedProposalId: insight.generatedProposalId,
        generatedDecisionId: insight.generatedDecisionId
      })),
      linkedChanges: proposals,
      linkedDecisions: decisions,
      linkedDocuments: documentTargets,
      openTargets: {
        thread: this.buildThreadOpenTarget(message.thread.id),
        message: this.buildMessageOpenTarget(message.id),
        providerEvidence: this.buildProviderOpenTarget(message.thread, message),
        documents: documentTargets
      }
    };
  }

  private async listThreadsInternal(
    projectId: string,
    query: {
      provider?: string;
      connectorId?: string;
      sourceSubType?: string;
      insightType?: string;
      insightStatus?: string;
      proposalStatus?: string;
      hasChangeProposal?: boolean;
      hasOpenDecision?: boolean;
      hasBlocker?: boolean;
      dateFrom?: string;
      dateTo?: string;
      search?: string;
      cursor?: string;
      limit: number;
    },
    includeAttention: boolean
  ) {
    const cacheKey = timelineCacheKey(projectId, query, includeAttention);
    const cached = getAggregateCache<any>("communication-timeline", cacheKey, COMMUNICATION_TIMELINE_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }

    const cursor = decodeCursor<CursorShape>(query.cursor);
    const candidateTake = this.resolveThreadCandidateTake(query);
    const threads = await this.prisma.communicationThread.findMany({
      where: {
        projectId,
        ...(query.provider ? { provider: query.provider as never } : {}),
        ...(query.connectorId ? { connectorId: query.connectorId } : {}),
        ...(query.sourceSubType
          ? {
              OR: [
                {
                  rawMetadataJson: {
                    path: ["sourceSubType"],
                    equals: query.sourceSubType
                  }
                },
                {
                  messages: {
                    some: {
                      rawMetadataJson: {
                        path: ["sourceSubType"],
                        equals: query.sourceSubType
                      }
                    }
                  }
                }
              ]
            }
          : {}),
        ...(query.dateFrom || query.dateTo
          ? {
              lastMessageAt: {
                ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
                ...(query.dateTo ? { lte: new Date(query.dateTo) } : {})
              }
            }
          : {}),
        ...(query.search
          ? {
              OR: [
                { subject: { contains: query.search, mode: "insensitive" } },
                { normalizedSubject: { contains: query.search.toLowerCase(), mode: "insensitive" } },
                {
                  messages: {
                    some: {
                      isDeletedByProvider: false,
                      bodyText: { contains: query.search, mode: "insensitive" }
                    }
                  }
                }
              ]
            }
          : {}),
        ...(cursor
          ? {
              OR: [
                { lastMessageAt: { lt: new Date(cursor.lastMessageAt) } },
                { lastMessageAt: new Date(cursor.lastMessageAt), id: { lt: cursor.id } }
              ]
            }
          : {})
      },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: candidateTake,
      select: {
        id: true,
        connectorId: true,
        provider: true,
        providerThreadId: true,
        subject: true,
        participantsJson: true,
        threadUrl: true,
        rawMetadataJson: true,
        startedAt: true,
        lastMessageAt: true,
        connector: {
          select: {
            accountLabel: true
          }
        },
        messages: {
          orderBy: { sentAt: "desc" },
          take: 1,
          select: {
            id: true,
            providerMessageId: true,
            providerPermalink: true,
            senderLabel: true,
            sentAt: true,
            bodyText: true,
            isDeletedByProvider: true,
            rawMetadataJson: true
          }
        }
      }
    });

    const seenThreadProjections = new Set<string>();
    const uniqueThreads = threads.filter((thread) => {
      const key = semanticThreadProjectionKey(thread);
      if (seenThreadProjections.has(key)) return false;
      seenThreadProjections.add(key);
      return true;
    });
    const threadIds = uniqueThreads.map((thread) => thread.id);
    const [proposalCounts, decisionLinks, blockerCounts, insightTypeCounts, insightStatusCounts, linkedProposals] = await Promise.all([
      this.prisma.specChangeLink.groupBy({
      by: ["linkRefId"],
      where: {
        projectId,
        linkType: "thread",
        linkRefId: { in: threadIds }
      },
      _count: { _all: true }
      }).catch(() => []),
      this.prisma.specChangeProposal.findMany({
        where: {
          projectId,
          decisionRecordId: { not: null },
          links: {
            some: {
              linkType: "thread",
              linkRefId: { in: threadIds }
            }
          }
        },
        select: {
          links: {
            select: {
              linkType: true,
              linkRefId: true
            }
          }
        }
      }),
      this.prisma.messageInsight.groupBy({
        by: ["threadId"],
        where: {
          projectId,
          insightType: "blocker",
          threadId: { in: threadIds }
        },
        _count: { _all: true }
      }).catch(() => []),
      query.insightType
        ? this.prisma.messageInsight.groupBy({
            by: ["threadId"],
            where: {
              projectId,
              insightType: query.insightType as never,
              threadId: { in: threadIds }
            },
            _count: { _all: true }
          }).catch(() => [])
        : Promise.resolve([]),
      this.prisma.messageInsight.groupBy({
        by: ["threadId", "status"],
        where: {
          projectId,
          threadId: { in: threadIds },
          ...(query.insightStatus ? { status: query.insightStatus as never } : {})
        },
        _count: { _all: true }
      }).catch(() => []),
      this.prisma.specChangeProposal.findMany({
        where: {
          projectId,
          ...(query.proposalStatus ? { status: query.proposalStatus as never } : {}),
          links: {
            some: {
              linkType: "thread",
              linkRefId: { in: threadIds }
            }
          }
        },
        select: {
          status: true,
          links: {
            select: {
              linkType: true,
              linkRefId: true
            }
          }
        }
      }).catch(() => [])
    ]);
    const proposalCountByThreadId = new Map(proposalCounts.map((item) => [item.linkRefId, item._count._all]));
    const decisionThreadIds = new Set(
      decisionLinks.flatMap((proposal) =>
        proposal.links.filter((link) => link.linkType === "thread").map((link) => link.linkRefId)
      )
    );
    const blockerCountByThreadId = new Map(blockerCounts.map((item) => [item.threadId, item._count._all]));
    const insightCountByThreadId = new Map(insightTypeCounts.map((item) => [item.threadId, item._count._all]));
    const insightStatusesByThreadId = new Map<string, Set<string>>();
    for (const item of insightStatusCounts) {
      if (!insightStatusesByThreadId.has(item.threadId)) {
        insightStatusesByThreadId.set(item.threadId, new Set());
      }
      insightStatusesByThreadId.get(item.threadId)!.add(item.status);
    }
    const proposalStatusesByThreadId = new Map<string, Set<string>>();
    for (const proposal of linkedProposals) {
      for (const link of proposal.links.filter((item) => item.linkType === "thread")) {
        if (!proposalStatusesByThreadId.has(link.linkRefId)) {
          proposalStatusesByThreadId.set(link.linkRefId, new Set());
        }
        proposalStatusesByThreadId.get(link.linkRefId)!.add(proposal.status);
      }
    }

    let filteredThreads = uniqueThreads;
    if (query.hasChangeProposal !== undefined) {
      filteredThreads = uniqueThreads.filter((thread) => {
        const hasLinks = (proposalCountByThreadId.get(thread.id) ?? 0) > 0;
        return query.hasChangeProposal ? hasLinks : !hasLinks;
      });
    }
    if (query.hasOpenDecision !== undefined) {
      filteredThreads = filteredThreads.filter((thread) =>
        query.hasOpenDecision ? decisionThreadIds.has(thread.id) : !decisionThreadIds.has(thread.id)
      );
    }
    if (query.hasBlocker !== undefined) {
      filteredThreads = filteredThreads.filter((thread) => {
        const hasBlocker = (blockerCountByThreadId.get(thread.id) ?? 0) > 0;
        return query.hasBlocker ? hasBlocker : !hasBlocker;
      });
    }
    if (query.insightType) {
      filteredThreads = filteredThreads.filter((thread) => (insightCountByThreadId.get(thread.id) ?? 0) > 0);
    }
    if (query.insightStatus) {
      filteredThreads = filteredThreads.filter((thread) =>
        insightStatusesByThreadId.get(thread.id)?.has(query.insightStatus!) ?? false
      );
    }
    if (query.proposalStatus) {
      filteredThreads = filteredThreads.filter((thread) =>
        proposalStatusesByThreadId.get(thread.id)?.has(query.proposalStatus!) ?? false
      );
    }

    const hasMore = filteredThreads.length > query.limit || threads.length === candidateTake;
    const pageItems = filteredThreads.slice(0, query.limit);
    const cursorSource =
      filteredThreads.length > query.limit
        ? pageItems[pageItems.length - 1]
        : threads.length === candidateTake
          ? threads[threads.length - 1]
          : null;
    const nextCursor =
      hasMore && cursorSource
        ? encodeCursor({
            lastMessageAt: cursorSource.lastMessageAt?.toISOString() ?? new Date(0).toISOString(),
            id: cursorSource.id
          })
        : null;

    const payload = {
      items: pageItems.map((thread) => ({
        threadId: thread.id,
        connectorId: thread.connectorId,
        provider: thread.provider,
        accountLabel: thread.connector.accountLabel,
        providerThreadId: thread.providerThreadId,
        subject: thread.subject,
        participants: thread.participantsJson,
        startedAt: thread.startedAt?.toISOString() ?? null,
        lastMessageAt: thread.lastMessageAt?.toISOString() ?? null,
        latestMessage: thread.messages[0]
          ? {
              id: thread.messages[0].id,
              senderLabel: thread.messages[0].senderLabel,
              sentAt: thread.messages[0].sentAt.toISOString(),
              excerpt: thread.messages[0].isDeletedByProvider ? null : thread.messages[0].bodyText.slice(0, 220),
              sourceSubType: this.extractSourceSubType(thread.messages[0].rawMetadataJson),
              unavailable: thread.messages[0].isDeletedByProvider
            }
          : null,
        sourceSubTypes: this.extractThreadSourceSubTypes(thread),
        proposalStatuses: Array.from(proposalStatusesByThreadId.get(thread.id) ?? []),
        insightStatuses: Array.from(insightStatusesByThreadId.get(thread.id) ?? []),
        changeProposalCount: proposalCountByThreadId.get(thread.id) ?? 0,
        blockerCount: blockerCountByThreadId.get(thread.id) ?? 0,
        hasOpenDecision: decisionThreadIds.has(thread.id),
        openTarget: this.buildThreadOpenTarget(thread.id),
        providerOpenTarget: this.buildProviderOpenTarget(thread, thread.messages[0] ?? null),
        attention:
          includeAttention && (blockerCountByThreadId.get(thread.id) ?? 0) > 0
            ? { label: "attention", reason: "linked blocker insights" }
            : includeAttention && decisionThreadIds.has(thread.id)
              ? { label: "watch", reason: "open decision candidate" }
              : includeAttention && (proposalCountByThreadId.get(thread.id) ?? 0) > 0
                ? { label: "watch", reason: "linked change proposals" }
            : null
      })),
      meta: {
        limit: query.limit,
        nextCursor,
        hasMore
      }
    };
    setAggregateCache("communication-timeline", cacheKey, payload);
    return payload;
  }

  private resolveThreadCandidateTake(query: {
    insightType?: string;
    insightStatus?: string;
    proposalStatus?: string;
    hasChangeProposal?: boolean;
    hasOpenDecision?: boolean;
    hasBlocker?: boolean;
    limit: number;
  }) {
    const hasPostFetchFilter =
      query.insightType !== undefined ||
      query.insightStatus !== undefined ||
      query.proposalStatus !== undefined ||
      query.hasChangeProposal !== undefined ||
      query.hasOpenDecision !== undefined ||
      query.hasBlocker !== undefined;
    if (!hasPostFetchFilter) {
      return Math.min(Math.max(query.limit * 4 + 1, query.limit + 1), 500);
    }

    return Math.min(Math.max(query.limit * 20 + 1, query.limit + 1), 500);
  }

  private extractThreadSourceSubTypes(thread: {
    rawMetadataJson?: unknown;
    messages: Array<{ rawMetadataJson?: unknown }>;
  }) {
    const sourceSubTypes = new Set<string>();
    const threadSubType = this.extractSourceSubType(thread.rawMetadataJson);
    if (threadSubType) {
      sourceSubTypes.add(threadSubType);
    }
    for (const message of thread.messages) {
      const messageSubType = this.extractSourceSubType(message.rawMetadataJson);
      if (messageSubType) {
        sourceSubTypes.add(messageSubType);
      }
    }
    return Array.from(sourceSubTypes);
  }

  private extractSourceSubType(rawMetadataJson: unknown) {
    if (!rawMetadataJson || typeof rawMetadataJson !== "object" || Array.isArray(rawMetadataJson)) {
      return null;
    }
    const value = (rawMetadataJson as Record<string, unknown>).sourceSubType;
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private buildProviderOpenTarget(
    thread: {
      id: string;
      connectorId: string;
      provider: string;
      providerThreadId: string;
      threadUrl?: string | null;
    },
    message: {
      id: string;
      providerMessageId: string;
      providerPermalink?: string | null;
      rawMetadataJson?: unknown;
      isDeletedByProvider?: boolean;
    } | null
  ) {
    return {
      targetType: "provider_evidence" as const,
      provider: thread.provider,
      connectorId: thread.connectorId,
      threadId: thread.id,
      messageId: message?.id ?? null,
      providerThreadId: thread.providerThreadId,
      providerMessageId: message?.providerMessageId ?? null,
      sourceSubType: message ? this.extractSourceSubType(message.rawMetadataJson) : null,
      url: message?.providerPermalink ?? thread.threadUrl ?? null,
      unavailable: message?.isDeletedByProvider ?? false,
      visibility: "project_internal" as const
    };
  }

  private mapProposalLinks(
    links: Array<{
      specChangeProposalId: string;
      proposal: {
        id: string;
        title: string;
        summary: string;
        proposalType: string;
        status: string;
        decisionRecordId: string | null;
        decisionRecord: { id: string; title: string; statement: string; status: string } | null;
      };
    }>
  ) {
    return links
      .filter(
        (link, index, collection) =>
          collection.findIndex((candidate) => candidate.specChangeProposalId === link.specChangeProposalId) === index
      )
      .map((link) => ({
        proposalId: link.proposal.id,
        title: link.proposal.title,
        summary: link.proposal.summary,
        proposalType: link.proposal.proposalType,
        status: link.proposal.status,
        openTarget: {
          targetType: "change_proposal" as const,
          targetRef: { proposalId: link.proposal.id }
        }
      }));
  }

  private mapDecisions(
    links: Array<{
      proposal: {
        decisionRecordId: string | null;
        decisionRecord: { id: string; title: string; statement: string; status: string } | null;
      };
    }>
  ) {
    const decisions = new Map<string, { id: string; title: string; statement: string; status: string }>();
    for (const link of links) {
      if (link.proposal.decisionRecord) {
        decisions.set(link.proposal.decisionRecord.id, link.proposal.decisionRecord);
      }
    }

    return Array.from(decisions.values()).map((decision) => ({
      decisionId: decision.id,
      title: decision.title,
      statement: decision.statement,
      status: decision.status,
      openTarget: {
        targetType: "decision_record" as const,
        targetRef: { decisionId: decision.id }
      }
    }));
  }

  private async loadDocumentTargets(projectId: string, proposalIds: string[]) {
    if (proposalIds.length === 0) {
      return [];
    }

    const sectionLinks = await this.prisma.specChangeLink.findMany({
      where: {
        projectId,
        specChangeProposalId: { in: proposalIds },
        linkType: "document_section"
      }
    });
    if (sectionLinks.length === 0) {
      return [];
    }

    const sections = await this.prisma.documentSection.findMany({
      where: {
        projectId,
        id: { in: sectionLinks.map((link) => link.linkRefId) }
      },
      include: {
        documentVersion: {
          include: { document: true }
        }
      }
    });

    return sections.map((section) => ({
      sectionId: section.id,
      anchorId: section.anchorId,
      pageNumber: section.pageNumber,
      documentId: section.documentVersion.documentId,
      documentTitle: section.documentVersion.document.title,
      targetType: "document_section" as const,
      targetRef: {
        documentId: section.documentVersion.documentId,
        documentVersionId: section.documentVersionId,
        anchorId: section.anchorId,
        pageNumber: section.pageNumber ?? undefined
      }
    }));
  }

  private buildThreadOpenTarget(threadId: string) {
    return {
      targetType: "thread" as const,
      targetRef: { threadId }
    };
  }

  private buildMessageOpenTarget(messageId: string) {
    return {
      targetType: "message" as const,
      targetRef: { messageId }
    };
  }

  private async recordTimelineReadAudit(
    projectId: string,
    actorUserId: string,
    projectRole: ProjectRole,
    count: number
  ) {
    try {
      await this.auditService.record({
        orgId: await this.resolveOrgId(projectId),
        projectId,
        actorUserId,
        eventType: "communication_thread_opened",
        entityType: "communication_timeline",
        payload: { count, projectRole }
      });
    } catch {
      // Read-side audit failures should not make the timeline feel slower or unavailable.
    }
  }

  private async resolveOrgId(projectId: string) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { orgId: true }
    });

    return project.orgId;
  }
}
