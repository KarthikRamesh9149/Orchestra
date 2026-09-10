import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/app/errors.js";
import { ChangeProposalService } from "../src/modules/changes/service.js";

function makeProjectService(overrides: Record<string, unknown> = {}) {
  return {
    ensureProjectMemberCanUseSocrates: vi.fn().mockResolvedValue({ projectRole: "manager", isActive: true }),
    ensureProjectManager: vi.fn().mockResolvedValue(undefined),
    ensureProjectTruthApprover: vi.fn().mockResolvedValue({ authority: "manager", delegatedApproverGrantId: null }),
    ensureProjectAccess: vi.fn().mockResolvedValue({ projectRole: "manager", isActive: true }),
    ...overrides
  };
}

describe("ChangeProposalService", () => {
  it("denies project-role clients from internal proposal reads", async () => {
    const prisma = {
      specChangeProposal: {
        findMany: vi.fn(),
        findFirstOrThrow: vi.fn()
      }
    } as any;
    const projectService = {
      ensureProjectMemberCanUseSocrates: vi
        .fn()
        .mockRejectedValue(new AppError(403, "Project access denied", "project_access_denied"))
    };
    const service = new ChangeProposalService(
      prisma,
      { enqueue: vi.fn() } as any,
      projectService as any,
      {} as any,
      { record: vi.fn() } as any
    );

    await expect(service.list("project-1", "client-1")).rejects.toMatchObject({
      statusCode: 403,
      code: "project_access_denied"
    });
    await expect(service.get("project-1", "proposal-1", "client-1")).rejects.toMatchObject({
      statusCode: 403,
      code: "project_access_denied"
    });
    expect(prisma.specChangeProposal.findMany).not.toHaveBeenCalled();
    expect(prisma.specChangeProposal.findFirstOrThrow).not.toHaveBeenCalled();
  });

  it("blocks users without truth-approval authority before accepting authoritative truth changes", async () => {
    const prisma = {
      project: {
        findUniqueOrThrow: vi.fn()
      },
      specChangeProposal: {
        findFirstOrThrow: vi.fn()
      }
    } as any;
    const projectService = {
      ensureProjectTruthApprover: vi.fn().mockRejectedValue(new AppError(403, "Truth approval authority required", "truth_approver_required")),
      ensureProjectManager: vi.fn().mockRejectedValue(new AppError(403, "Manager required", "manager_access_required")),
      ensureProjectAccess: vi.fn()
    };
    const brainService = {
      generateProductBrain: vi.fn()
    };

    const service = new ChangeProposalService(
      prisma,
      { enqueue: vi.fn() } as any,
      projectService as any,
      brainService as any,
      { record: vi.fn() } as any
    );

    await expect(service.accept("project-1", "proposal-1", "dev-1")).rejects.toMatchObject({
      code: "truth_approver_required",
      statusCode: 403
    });
    expect(prisma.specChangeProposal.findFirstOrThrow).not.toHaveBeenCalled();
    expect(brainService.generateProductBrain).not.toHaveBeenCalled();
  });

  it("rejects proposal creation when linked targets do not belong to the project", async () => {
    const prisma = {
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" })
      },
      documentSection: {
        count: vi.fn().mockResolvedValue(0)
      },
      brainNode: {
        count: vi.fn().mockResolvedValue(1)
      },
      communicationMessage: {
        count: vi.fn().mockResolvedValue(1)
      }
    } as any;

    const service = new ChangeProposalService(
      prisma,
      { enqueue: vi.fn() } as any,
      makeProjectService() as any,
      {} as any,
      { record: vi.fn() } as any
    );

    await expect(
      service.create("project-1", "manager-1", {
        title: "Change payments copy",
        summary: "Update the CTA wording",
        proposalType: "clarification",
        affectedDocumentSectionIds: ["sec-1"],
        affectedBrainNodeIds: ["node-1"],
        communicationMessageIds: ["msg-1"],
        externalEvidenceRefs: []
      })
    ).rejects.toMatchObject({
      code: "invalid_document_section_links",
      statusCode: 422
    });
  });

  it("creates a decision record and enqueues application when accepting a decision change", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const tx = {
      decisionRecord: {
        create: vi.fn().mockResolvedValue({ id: "decision-1" })
      },
      specChangeProposal: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(undefined)
      },
      liveDocSectionDraft: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      documentSection: {
        findFirst: vi.fn().mockResolvedValue({
          id: "sec-1",
          projectId: "project-1",
          documentId: "doc-1",
          documentVersionId: "doc-version-1",
          documentVersion: { documentId: "doc-1" },
          anchorId: "decision",
          headingPath: ["Decision"],
          normalizedText: "Original decision text"
        })
      },
      liveDocSectionRevision: {
        upsert: vi.fn().mockResolvedValue(undefined)
      }
    };

    const prisma = {
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" })
      },
      specChangeProposal: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "proposal-1",
          projectId: "project-1",
          proposalType: "decision_change",
          status: "needs_review",
          sourceMessageCount: 1,
          externalEvidenceRefsJson: [],
          decisionRecordId: null,
          links: [
            { linkType: "document_section", linkRefId: "sec-1" },
            { linkType: "brain_node", linkRefId: "node-1" },
            { linkType: "message", linkRefId: "msg-1" },
            { linkType: "thread", linkRefId: "thread-1" }
          ]
        })
      },
      documentSection: {
        count: vi.fn().mockResolvedValue(1)
      },
      brainNode: {
        count: vi.fn().mockResolvedValue(1)
      },
      communicationMessage: {
        count: vi.fn().mockResolvedValue(1)
      },
      communicationThread: {
        count: vi.fn().mockResolvedValue(1)
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined)
      }
    } as any;

    const service = new ChangeProposalService(
      prisma,
      { enqueue } as any,
      makeProjectService() as any,
      {} as any,
      { record: vi.fn() } as any
    );

    prisma.specChangeProposal.findFirstOrThrow.mockResolvedValue({
      id: "proposal-1",
      projectId: "project-1",
      proposalType: "decision_change",
      status: "needs_review",
      sourceMessageCount: 1,
      externalEvidenceRefsJson: [],
      decisionRecordId: null,
      links: [
        { linkType: "document_section", linkRefId: "sec-1" },
        { linkType: "brain_node", linkRefId: "node-1" },
        { linkType: "message", linkRefId: "msg-1" },
        { linkType: "thread", linkRefId: "thread-1" }
      ]
    });

    prisma.specChangeProposal.findFirstOrThrow.mockResolvedValueOnce({
      id: "proposal-1",
      projectId: "project-1",
      proposalType: "decision_change",
      status: "needs_review",
      sourceMessageCount: 1,
      externalEvidenceRefsJson: [],
      decisionRecordId: null,
      links: [
        { linkType: "document_section", linkRefId: "sec-1" },
        { linkType: "brain_node", linkRefId: "node-1" },
        { linkType: "message", linkRefId: "msg-1" },
        { linkType: "thread", linkRefId: "thread-1" }
      ]
    });
    prisma.specChangeProposal.findFirstOrThrow.mockResolvedValueOnce({
      id: "proposal-1",
      projectId: "project-1",
      proposalType: "decision_change",
      status: "accepted"
    });

    prisma.specChangeProposal.findFirstOrThrow.mockImplementation(async () => ({
      id: "proposal-1",
      projectId: "project-1",
      proposalType: "decision_change",
      status: "accepted",
      sourceMessageCount: 1,
      externalEvidenceRefsJson: [],
      decisionRecordId: "decision-1",
      links: [
        { linkType: "document_section", linkRefId: "sec-1" },
        { linkType: "brain_node", linkRefId: "node-1" },
        { linkType: "message", linkRefId: "msg-1" },
        { linkType: "thread", linkRefId: "thread-1" }
      ]
    }));

    await service.accept("project-1", "proposal-1", "manager-1");

    expect(tx.decisionRecord.create).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      "apply_accepted_change",
      { projectId: "project-1", proposalId: "proposal-1" },
      "apply-change:proposal-1"
    );
  });

  it("returns the existing accepted brain version during duplicate apply runs", async () => {
    const brainService = {
      generateBrainGraph: vi.fn(),
      generateProductBrain: vi.fn()
    };

    const prisma = {
      specChangeProposal: {
        findFirst: vi.fn().mockResolvedValue({
          id: "proposal-1",
          projectId: "project-1",
          status: "accepted",
          acceptedBrainVersionId: "brain-1",
          acceptedBy: "manager-1",
          links: [{ linkType: "document_section" }]
        })
      },
      artifactVersion: {
        findUnique: vi.fn().mockResolvedValue({
          id: "brain-1",
          artifactType: "product_brain"
        })
      }
    } as any;

    const service = new ChangeProposalService(
      prisma,
      { enqueue: vi.fn() } as any,
      makeProjectService() as any,
      brainService as any,
      { record: vi.fn() } as any
    );

    const result = await service.applyAcceptedProposal("project-1", "proposal-1");

    expect(result).toEqual({
      id: "brain-1",
      artifactType: "product_brain"
    });
    expect(brainService.generateProductBrain).not.toHaveBeenCalled();
  });

  it("re-enqueues accepted-change application when retrying an accepted proposal without a brain version", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" }),
        findUnique: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" })
      },
      specChangeProposal: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "proposal-retry",
          projectId: "project-1",
          proposalType: "requirement_change",
          status: "accepted",
          acceptedBrainVersionId: null,
          sourceMessageCount: 1,
          externalEvidenceRefsJson: [],
          decisionRecordId: null,
          links: [
            { linkType: "document_section", linkRefId: "sec-1" },
            { linkType: "brain_node", linkRefId: "node-1" },
            { linkType: "message", linkRefId: "msg-1" }
          ]
        })
      },
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined)
      }
    } as any;

    const service = new ChangeProposalService(
      prisma,
      { enqueue } as any,
      makeProjectService() as any,
      {} as any,
      { record: vi.fn() } as any
    );

    await service.accept("project-1", "proposal-retry", "manager-1");

    expect(prisma.jobRun.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { idempotencyKey: "apply-change:proposal-retry" }
      })
    );
    expect(enqueue).toHaveBeenCalledWith(
      "apply_accepted_change",
      { projectId: "project-1", proposalId: "proposal-retry" },
      "apply-change:proposal-retry"
    );
  });

  it("accepts an existing open decision candidate instead of creating a second decision record", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const tx = {
      decisionRecord: {
        update: vi.fn().mockResolvedValue({ id: "decision-open-1" }),
        create: vi.fn()
      },
      specChangeProposal: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(undefined)
      },
      liveDocSectionDraft: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      documentSection: {
        findFirst: vi.fn().mockResolvedValue({
          id: "sec-1",
          projectId: "project-1",
          documentId: "doc-1",
          documentVersionId: "doc-version-1",
          documentVersion: { documentId: "doc-1" },
          anchorId: "decision",
          headingPath: ["Decision"],
          normalizedText: "Original decision text"
        })
      },
      liveDocSectionRevision: {
        upsert: vi.fn().mockResolvedValue(undefined)
      }
    };

    const prisma = {
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" })
      },
      specChangeProposal: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "proposal-2",
          projectId: "project-1",
          proposalType: "decision_change",
          status: "needs_review",
          sourceMessageCount: 1,
          externalEvidenceRefsJson: [],
          decisionRecordId: "decision-open-1",
          links: [
            { linkType: "document_section", linkRefId: "sec-1" },
            { linkType: "brain_node", linkRefId: "node-1" },
            { linkType: "message", linkRefId: "msg-1" },
            { linkType: "thread", linkRefId: "thread-1" }
          ]
        })
      },
      documentSection: {
        count: vi.fn().mockResolvedValue(1)
      },
      brainNode: {
        count: vi.fn().mockResolvedValue(1)
      },
      communicationMessage: {
        count: vi.fn().mockResolvedValue(1)
      },
      communicationThread: {
        count: vi.fn().mockResolvedValue(1)
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined)
      }
    } as any;

    const service = new ChangeProposalService(
      prisma,
      { enqueue } as any,
      makeProjectService() as any,
      {} as any,
      { record: vi.fn() } as any
    );

    await service.accept("project-1", "proposal-2", "manager-1");

    expect(tx.decisionRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "decision-open-1" },
        data: expect.objectContaining({
          status: "accepted",
          acceptedBy: "manager-1"
        })
      })
    );
    expect(tx.decisionRecord.create).not.toHaveBeenCalled();
  });

  it("allows a rejected proposal to be approved again when provenance still resolves", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const tx = {
      specChangeProposal: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue(undefined)
      },
      liveDocSectionDraft: {
        findFirst: vi.fn().mockResolvedValue(null)
      },
      documentSection: {
        findFirst: vi.fn().mockResolvedValue({
          id: "sec-1",
          projectId: "project-1",
          documentVersionId: "doc-version-1",
          documentVersion: { documentId: "doc-1" },
          anchorId: "scope",
          headingPath: ["Scope"],
          normalizedText: "Previous rejected scope text"
        })
      },
      liveDocSectionRevision: {
        upsert: vi.fn().mockResolvedValue(undefined)
      }
    };
    const rejectedProposal = {
      id: "proposal-rejected",
      projectId: "project-1",
      proposalType: "requirement_change",
      status: "rejected",
      title: "Reconsider communication-derived scope",
      summary: "A rejected communication proposal is now approved after review.",
      sourceMessageCount: 1,
      externalEvidenceRefsJson: [],
      decisionRecordId: null,
      newUnderstandingJson: { summary: "Approved scope after review." },
      links: [
        { linkType: "document_section", linkRefId: "sec-1" },
        { linkType: "brain_node", linkRefId: "node-1" },
        { linkType: "message", linkRefId: "msg-1" }
      ]
    };
    const prisma = {
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" })
      },
      specChangeProposal: {
        findFirstOrThrow: vi
          .fn()
          .mockResolvedValueOnce(rejectedProposal)
          .mockResolvedValueOnce({ ...rejectedProposal, status: "accepted", acceptedBy: "manager-1" })
      },
      documentSection: {
        count: vi.fn().mockResolvedValue(1)
      },
      brainNode: {
        count: vi.fn().mockResolvedValue(1)
      },
      communicationMessage: {
        count: vi.fn().mockResolvedValue(1)
      },
      communicationThread: {
        count: vi.fn().mockResolvedValue(0)
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined)
      }
    } as any;

    const service = new ChangeProposalService(
      prisma,
      { enqueue } as any,
      makeProjectService() as any,
      {} as any,
      { record: vi.fn().mockResolvedValue(undefined) } as any
    );

    await service.accept("project-1", "proposal-rejected", "manager-1");

    expect(tx.specChangeProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "proposal-rejected", status: "rejected" }),
        data: expect.objectContaining({
          status: "accepted",
          acceptedBy: "manager-1"
        })
      })
    );
    expect(tx.liveDocSectionRevision.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventKey: "live-doc-proposal-accepted:proposal-rejected" },
        create: expect.objectContaining({
          eventType: "proposal_accepted",
          proposalId: "proposal-rejected",
          documentSectionId: "sec-1"
        })
      })
    );
  });

  it("keeps superseded proposals blocked from later acceptance", async () => {
    const prisma = {
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" })
      },
      specChangeProposal: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "proposal-superseded",
          projectId: "project-1",
          status: "superseded",
          sourceMessageCount: 1,
          externalEvidenceRefsJson: [],
          links: [
            { linkType: "document_section", linkRefId: "sec-1" },
            { linkType: "brain_node", linkRefId: "node-1" },
            { linkType: "message", linkRefId: "msg-1" }
          ]
        })
      },
      $transaction: vi.fn()
    } as any;

    const service = new ChangeProposalService(
      prisma,
      { enqueue: vi.fn() } as any,
      makeProjectService() as any,
      {} as any,
      { record: vi.fn() } as any
    );

    await expect(service.accept("project-1", "proposal-superseded", "manager-1")).rejects.toMatchObject({
      code: "proposal_not_acceptable",
      statusCode: 409
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects acceptance when persisted proposal links do not resolve inside the project", async () => {
    const prisma = {
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" })
      },
      specChangeProposal: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "proposal-invalid-links",
          projectId: "project-1",
          proposalType: "requirement_change",
          status: "needs_review",
          sourceMessageCount: 1,
          externalEvidenceRefsJson: [],
          decisionRecordId: null,
          links: [
            { linkType: "document_section", linkRefId: "sec-1" },
            { linkType: "brain_node", linkRefId: "node-1" },
            { linkType: "message", linkRefId: "msg-cross-project" },
            { linkType: "thread", linkRefId: "thread-1" }
          ]
        })
      },
      documentSection: {
        count: vi.fn().mockResolvedValue(1)
      },
      brainNode: {
        count: vi.fn().mockResolvedValue(1)
      },
      communicationMessage: {
        count: vi.fn().mockResolvedValue(0)
      },
      communicationThread: {
        count: vi.fn().mockResolvedValue(1)
      },
      $transaction: vi.fn()
    } as any;

    const service = new ChangeProposalService(
      prisma,
      { enqueue: vi.fn() } as any,
      makeProjectService() as any,
      {} as any,
      { record: vi.fn() } as any
    );

    await expect(service.accept("project-1", "proposal-invalid-links", "manager-1")).rejects.toMatchObject({
      code: "invalid_message_links",
      statusCode: 422
    });
    expect(prisma.communicationMessage.count).toHaveBeenCalledWith({
      where: {
        projectId: "project-1",
        id: { in: ["msg-cross-project"] },
        isDeletedByProvider: false
      }
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not generate a Product Brain version when rejecting a proposal", async () => {
    const tx = {
      liveDocSectionDraft: {
        findFirst: vi.fn().mockResolvedValue(null)
      }
    };
    const prisma = {
      project: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" }),
        findUnique: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" })
      },
      specChangeProposal: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "proposal-1",
          projectId: "project-1",
          status: "needs_review"
        }),
        update: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      },
      liveDocSectionDraft: tx.liveDocSectionDraft,
      jobRun: {
        upsert: vi.fn().mockResolvedValue(undefined)
      }
    } as any;
    const brainService = {
      generateBrainGraph: vi.fn(),
      generateProductBrain: vi.fn()
    };
    prisma.$transaction = vi.fn((callback: (client: any) => unknown) => callback(prisma));

    const service = new ChangeProposalService(
      prisma,
      { enqueue: vi.fn().mockResolvedValue(undefined) } as any,
      makeProjectService() as any,
      brainService as any,
      { record: vi.fn(), recordWithClient: vi.fn() } as any
    );

    await service.reject("project-1", "proposal-1", "manager-1");

    expect(prisma.specChangeProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "proposal-1", status: "needs_review" }),
        data: { status: "rejected" }
      })
    );
    expect(brainService.generateBrainGraph).not.toHaveBeenCalled();
    expect(brainService.generateProductBrain).not.toHaveBeenCalled();
  });

  it("fails closed when another reviewer changes proposal state concurrently", async () => {
    const prisma = {
      project: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "project-1", orgId: "org-1" }) },
      specChangeProposal: {
        findFirstOrThrow: vi.fn().mockResolvedValue({
          id: "proposal-race",
          projectId: "project-1",
          status: "needs_review",
          updatedAt: new Date("2026-08-24T00:00:00.000Z"),
          links: []
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 })
      },
      liveDocSectionDraft: { findFirst: vi.fn() }
    } as any;
    prisma.$transaction = vi.fn((callback) => callback(prisma));
    const service = new ChangeProposalService(
      prisma,
      { enqueue: vi.fn() } as any,
      makeProjectService() as any,
      {} as any,
      { record: vi.fn() } as any
    );

    await expect(service.reject("project-1", "proposal-race", "manager-1")).rejects.toMatchObject({
      code: "proposal_state_changed",
      statusCode: 409
    });
    expect(prisma.liveDocSectionDraft.findFirst).not.toHaveBeenCalled();
  });
});
