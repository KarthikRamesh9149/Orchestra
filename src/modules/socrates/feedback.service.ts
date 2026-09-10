import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import type { AuditService } from "../audit/service.js";
import type { ProjectService } from "../projects/service.js";

export type SocratesFeedbackReason = "helpful" | "incorrect" | "outdated" | "missing_evidence" | "wrong_source" | "wrong_current_truth";

export class SocratesFeedbackService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService
  ) {}

  async record(input: {
    projectId: string;
    sessionId: string;
    assistantMessageId: string;
    actorUserId: string;
    actorOrgId: string;
    reason: SocratesFeedbackReason;
    correctionText?: string | null;
  }) {
    await this.projectService.ensureProjectMemberCanUseSocrates(input.projectId, input.actorUserId);
    const message = await this.prisma.socratesMessage.findFirst({
      where: {
        id: input.assistantMessageId,
        sessionId: input.sessionId,
        role: "assistant",
        session: { projectId: input.projectId }
      },
      include: {
        citations: { orderBy: { orderIndex: "asc" } },
        session: { select: { project: { select: { orgId: true } } } }
      }
    });
    if (!message || message.session.project.orgId !== input.actorOrgId) {
      throw new AppError(404, "Socrates response not found", "socrates_feedback_message_not_found");
    }
    if (message.responseStatus !== "completed") {
      throw new AppError(409, "Feedback can only be saved for a completed Socrates response", "socrates_feedback_response_incomplete");
    }
    const brain = await this.prisma.artifactVersion.findFirst({
      where: { projectId: input.projectId, status: "accepted", artifactType: { in: ["product_brain", "brain_graph"] } },
      orderBy: [{ acceptedAt: "desc" }, { versionNumber: "desc" }],
      select: { id: true }
    });
    const needsHumanReview = input.reason !== "helpful";
    const citationsSnapshot = message.citations.map((citation) => ({
      type: citation.citationType,
      refId: citation.refId,
      label: citation.label,
      confidence: citation.confidence == null ? null : Number(citation.confidence)
    }));
    const saved = await this.prisma.socratesResponseFeedback.upsert({
      where: { assistantMessageId_userId: { assistantMessageId: input.assistantMessageId, userId: input.actorUserId } },
      create: {
        orgId: input.actorOrgId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        assistantMessageId: input.assistantMessageId,
        userId: input.actorUserId,
        reason: input.reason,
        correctionText: needsHumanReview ? input.correctionText?.trim() || null : null,
        needsHumanReview,
        citationsSnapshotJson: citationsSnapshot as Prisma.InputJsonValue,
        productBrainVersionId: brain?.id ?? null
      },
      update: {
        reason: input.reason,
        correctionText: needsHumanReview ? input.correctionText?.trim() || null : null,
        needsHumanReview,
        citationsSnapshotJson: citationsSnapshot as Prisma.InputJsonValue,
        productBrainVersionId: brain?.id ?? null
      }
    });
    await this.auditService.record({
      orgId: input.actorOrgId,
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      eventType: "socrates_response_feedback_recorded",
      entityType: "socrates_response_feedback",
      entityId: saved.id,
      payload: {
        sessionId: input.sessionId,
        assistantMessageId: input.assistantMessageId,
        reason: input.reason,
        needsHumanReview,
        productBrainVersionId: brain?.id ?? null,
        citationCount: citationsSnapshot.length
      }
    });
    return {
      id: saved.id,
      reason: saved.reason as SocratesFeedbackReason,
      correctionText: saved.correctionText,
      needsHumanReview: saved.needsHumanReview,
      productBrainVersionId: saved.productBrainVersionId,
      updatedAt: saved.updatedAt.toISOString(),
      acceptedTruthChanged: false as const
    };
  }
}
