import { describe, expect, it, vi } from "vitest";
import { DocumentService } from "../src/modules/documents/service.js";

function serviceWith(input: {
  document?: unknown;
  updateCount?: number;
  role?: string;
}) {
  const transactionDocument = { updateMany: vi.fn().mockResolvedValue({ count: input.updateCount ?? 1 }) };
  const transactionAudit = { create: vi.fn().mockResolvedValue({}) };
  const prisma = {
    document: { findFirst: vi.fn().mockResolvedValue(input.document ?? null) },
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({ document: transactionDocument, auditEvent: transactionAudit })),
  } as any;
  const projectService = {
    ensureProjectMemberCanUploadContext: vi.fn().mockResolvedValue({ projectRole: input.role ?? "manager" }),
  } as any;
  const service = new DocumentService(
    prisma,
    {} as any,
    { enqueue: vi.fn() } as any,
    {} as any,
    {} as any,
    projectService,
    { recordWithClient: vi.fn(async (tx, payload) => tx.auditEvent.create({ data: payload })) } as any,
    {} as any,
  );
  return { service, prisma, projectService, transactionDocument, transactionAudit };
}

describe("[FIX-20] Memory document archive", () => {
  it("authorizes, archives and audits atomically", async () => {
    const fixture = serviceWith({
      document: { id: "document-1", title: "PRD", project: { orgId: "org-1" } },
      role: "dev",
    });

    const result = await fixture.service.archiveDocument("project-1", "document-1", "user-1");

    expect(fixture.projectService.ensureProjectMemberCanUploadContext).toHaveBeenCalledWith("project-1", "user-1");
    expect(fixture.transactionDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "document-1", projectId: "project-1", archivedAt: null },
    }));
    expect(fixture.transactionAudit.create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ documentId: "document-1" });
  });

  it("does not disclose documents outside the authorized active project", async () => {
    const fixture = serviceWith({ document: null });
    await expect(fixture.service.archiveDocument("project-1", "document-1", "user-1")).rejects.toMatchObject({
      statusCode: 404,
      code: "document_not_found",
    });
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
  });
});
