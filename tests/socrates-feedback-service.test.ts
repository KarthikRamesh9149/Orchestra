import { describe, expect, it, vi } from "vitest";
import { SocratesFeedbackService } from "../src/modules/socrates/feedback.service.js";

const input = {
  projectId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  assistantMessageId: "33333333-3333-4333-8333-333333333333",
  actorUserId: "44444444-4444-4444-8444-444444444444",
  actorOrgId: "55555555-5555-4555-8555-555555555555",
  reason: "incorrect" as const,
  correctionText: "The launch date is Friday."
};

function harness(overrides: Record<string, unknown> = {}) {
  const saved = { id: "feedback-1", reason: "incorrect", correctionText: input.correctionText, needsHumanReview: true, productBrainVersionId: "brain-1", updatedAt: new Date("2026-08-24T01:00:00.000Z") };
  const prisma = {
    socratesMessage: { findFirst: vi.fn().mockResolvedValue({ responseStatus: "completed", citations: [{ citationType: "document", refId: "chunk-1", label: "Launch PRD", confidence: 0.9 }], session: { project: { orgId: input.actorOrgId } }, ...overrides }) },
    artifactVersion: { findFirst: vi.fn().mockResolvedValue({ id: "brain-1" }) },
    socratesResponseFeedback: { upsert: vi.fn().mockResolvedValue(saved) }
  };
  const projectService = { ensureProjectMemberCanUseSocrates: vi.fn().mockResolvedValue({ projectRole: "manager" }) };
  const auditService = { record: vi.fn().mockResolvedValue(undefined) };
  return { service: new SocratesFeedbackService(prisma as any, projectService as any, auditService as any), prisma, projectService, auditService };
}

describe("SocratesFeedbackService", () => {
  it("persists a correction as review evidence without changing accepted truth", async () => {
    const { service, prisma, auditService } = harness();
    const result = await service.record(input);
    expect(prisma.socratesResponseFeedback.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { assistantMessageId_userId: { assistantMessageId: input.assistantMessageId, userId: input.actorUserId } },
      create: expect.objectContaining({ reason: "incorrect", needsHumanReview: true, productBrainVersionId: "brain-1", citationsSnapshotJson: [expect.objectContaining({ refId: "chunk-1" })] })
    }));
    expect(result).toMatchObject({ reason: "incorrect", needsHumanReview: true, acceptedTruthChanged: false });
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "socrates_response_feedback_recorded" }));
  });

  it("clears review-only correction content when an answer is marked helpful", async () => {
    const { service, prisma } = harness();
    prisma.socratesResponseFeedback.upsert.mockResolvedValue({ id: "feedback-1", reason: "helpful", correctionText: null, needsHumanReview: false, productBrainVersionId: "brain-1", updatedAt: new Date() });
    const result = await service.record({ ...input, reason: "helpful", correctionText: "must not persist" });
    expect(prisma.socratesResponseFeedback.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ correctionText: null, needsHumanReview: false }) }));
    expect(result.needsHumanReview).toBe(false);
  });

  it("rejects cross-tenant and incomplete response feedback", async () => {
    const crossTenant = harness({ session: { project: { orgId: "another-org" } } });
    await expect(crossTenant.service.record(input)).rejects.toMatchObject({ statusCode: 404, code: "socrates_feedback_message_not_found" });
    const streaming = harness({ responseStatus: "streaming" });
    await expect(streaming.service.record(input)).rejects.toMatchObject({ statusCode: 409, code: "socrates_feedback_response_incomplete" });
  });
});
