import type { PrismaClient } from "@prisma/client";
import { stableBodyHash } from "../../lib/communications/idempotency.js";

type CandidateSection = {
  id: string;
  label: string;
  excerpt: string;
};

type CandidateBrainNode = {
  id: string;
  title: string;
  summary: string;
};

function tokenize(value: string) {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4)
        .slice(0, 12)
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

export class ImpactResolverService {
  constructor(private readonly prisma: PrismaClient) {}

  async buildMessageContext(projectId: string, messageId: string) {
    const message = await this.prisma.communicationMessage.findFirstOrThrow({
      where: { id: messageId, projectId, isDeletedByProvider: false },
      include: {
        thread: {
          include: {
            messages: {
              where: { isDeletedByProvider: false },
              orderBy: { sentAt: "desc" },
              take: 5
            }
          }
        }
      }
    });

    const threadMessages = [...message.thread.messages].sort((left, right) => left.sentAt.getTime() - right.sentAt.getTime());
    const threadStateHash = stableBodyHash(
      threadMessages.map((item) => `${item.id}:${item.bodyHash}`).join("|"),
      message.thread.subject ?? null
    );
    const baseText = [message.thread.subject ?? "", ...threadMessages.map((item) => item.bodyText)].join("\n");
    const tokens = tokenize(baseText);
    const related = await this.loadProjectContext(projectId, tokens);

    return {
      target: message,
      thread: message.thread,
      threadMessages,
      threadStateHash,
      ...related
    };
  }

  async buildThreadContext(projectId: string, threadId: string) {
    const thread = await this.prisma.communicationThread.findFirstOrThrow({
      where: { id: threadId, projectId },
      include: {
        messages: {
          where: { isDeletedByProvider: false },
          orderBy: { sentAt: "desc" },
          take: 8
        }
      }
    });

    const orderedMessages = [...thread.messages].sort((left, right) => left.sentAt.getTime() - right.sentAt.getTime());
    const baseText = [thread.subject ?? "", ...orderedMessages.map((item) => item.bodyText)].join("\n");
    const tokens = tokenize(baseText);
    const related = await this.loadProjectContext(projectId, tokens);
    const threadStateHash = stableBodyHash(
      orderedMessages.map((item) => `${item.id}:${item.bodyHash}`).join("|"),
      thread.subject ?? null
    );

    return {
      thread,
      threadMessages: orderedMessages,
      threadStateHash,
      ...related
    };
  }

  private async loadProjectContext(projectId: string, tokens: string[]) {
    const acceptedProductBrain = await this.prisma.artifactVersion.findFirst({
      where: {
        projectId,
        artifactType: "product_brain",
        status: "accepted"
      },
      orderBy: [{ acceptedAt: "desc" }, { createdAt: "desc" }]
    });

    const [candidateSections, candidateBrainNodes, acceptedChanges, acceptedDecisions, unresolvedProposals] =
      await Promise.all([
        this.loadCandidateSections(projectId, tokens),
        this.loadCandidateBrainNodes(projectId, tokens),
        this.prisma.specChangeProposal.findMany({
          where: {
            projectId,
            status: "accepted",
            ...(tokens.length > 0
              ? {
                  OR: [
                    ...buildContainsFilters(tokens, "title"),
                    ...buildContainsFilters(tokens, "summary")
                  ]
                }
              : {})
          },
          orderBy: { acceptedAt: "desc" },
          take: 5,
          select: { id: true, title: true, summary: true }
        }),
        this.prisma.decisionRecord.findMany({
          where: {
            projectId,
            status: "accepted",
            ...(tokens.length > 0
              ? {
                  OR: [
                    ...buildContainsFilters(tokens, "title"),
                    ...buildContainsFilters(tokens, "statement")
                  ]
                }
              : {})
          },
          orderBy: { acceptedAt: "desc" },
          take: 5,
          select: { id: true, title: true, statement: true }
        }),
        this.prisma.specChangeProposal.findMany({
          where: {
            projectId,
            status: "needs_review",
            ...(tokens.length > 0
              ? {
                  OR: [
                    ...buildContainsFilters(tokens, "title"),
                    ...buildContainsFilters(tokens, "summary")
                  ]
                }
              : {})
          },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, title: true, summary: true }
        })
      ]);

    return {
      acceptedProductBrainSummary: this.summarizeProductBrain(acceptedProductBrain?.payloadJson ?? null),
      candidateSections,
      candidateBrainNodes,
      acceptedChanges,
      acceptedDecisions,
      unresolvedProposals
    };
  }

  private async loadCandidateSections(projectId: string, tokens: string[]): Promise<CandidateSection[]> {
    const sections = await this.prisma.documentSection.findMany({
      where: {
        projectId,
        ...(tokens.length > 0
          ? {
              OR: buildContainsFilters(tokens, "normalizedText")
            }
          : {})
      },
      include: {
        documentVersion: {
          select: {
            parseRevision: true,
            document: { select: { title: true } }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 8
    });

    return sections
      .filter((section) => section.parseRevision === section.documentVersion.parseRevision)
      .map((section) => ({
        id: section.id,
        label: `${section.documentVersion.document.title} / ${section.anchorId}`,
        excerpt: section.normalizedText.slice(0, 320)
      }));
  }

  private async loadCandidateBrainNodes(projectId: string, tokens: string[]): Promise<CandidateBrainNode[]> {
    const nodes = await this.prisma.brainNode.findMany({
      where: {
        projectId,
        artifactVersion: {
          artifactType: "brain_graph",
          status: "accepted"
        },
        ...(tokens.length > 0
          ? {
              OR: [
                ...buildContainsFilters(tokens, "title"),
                ...buildContainsFilters(tokens, "summary")
              ]
            }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take: 8
    });

    return nodes.map((node) => ({
      id: node.id,
      title: node.title,
      summary: node.summary
    }));
  }

  private summarizeProductBrain(payload: unknown) {
    if (!payload || typeof payload !== "object") {
      return "No accepted Product Brain is available yet.";
    }

    const value = payload as Record<string, unknown>;
    return JSON.stringify(
      {
        whatTheProductIs: value.whatTheProductIs ?? null,
        mainFlows: value.mainFlows ?? [],
        modules: value.modules ?? [],
        constraints: value.constraints ?? [],
        unresolvedAreas: value.unresolvedAreas ?? []
      },
      null,
      2
    );
  }
}
