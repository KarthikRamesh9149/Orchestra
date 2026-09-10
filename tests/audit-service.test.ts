import { describe, expect, it, vi } from "vitest";
import { AuditService, redactAuditPayload } from "../src/modules/audit/service.js";

describe("audit service visibility", () => {
  it("redacts secrets, credential references, and raw transcript payloads recursively", () => {
    expect(
      redactAuditPayload({
        action: "manual_import",
        credentialsRef: "vault:fireflies_ai:connector-1",
        nested: {
          apiKey: "secret",
          transcriptId: "ff-123",
          safe: "kept"
        },
        items: [{ rawBody: "full transcript body", count: 1 }]
      })
    ).toEqual({
      action: "manual_import",
      credentialsRef: "[redacted]",
      nested: {
        apiKey: "[redacted]",
        transcriptId: "[redacted]",
        safe: "kept"
      },
      items: [{ rawBody: "[redacted]", count: 1 }]
    });
  });

  it("lists project-scoped audit events with org/project filters and redacted payloads", async () => {
    const findMany = vi.fn(async () => [
      {
        id: "audit-1",
        projectId: "project-1",
        orgId: "org-1",
        actorUserId: "user-1",
        eventType: "proposal_accepted",
        entityType: "spec_change_proposal",
        entityId: "proposal-1",
        payloadJson: {
          proposalId: "proposal-1",
          credentialsRef: "vault:secret",
          transcriptId: "ff-123"
        },
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        actor: {
          id: "user-1",
          email: "manager@example.com",
          displayName: "Manager",
          workspaceRoleDefault: "manager"
        }
      }
    ]);

    const service = new AuditService({ auditEvent: { findMany } } as any);
    const result = await service.listProjectEvents({
      orgId: "org-1",
      projectId: "project-1",
      eventType: "proposal_accepted",
      from: new Date("2025-12-01T00:00:00.000Z"),
      limit: 50
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: "org-1",
          projectId: "project-1",
          eventType: "proposal_accepted"
        }),
        take: 51
      })
    );
    expect(result.items[0]).toMatchObject({
      id: "audit-1",
      payload: {
        proposalId: "proposal-1",
        credentialsRef: "[redacted]",
        transcriptId: "[redacted]"
      }
    });
    expect(result.meta).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it("redacts sensitive audit payload fields before persistence", async () => {
    const create = vi.fn(async () => ({}));
    const service = new AuditService({ auditEvent: { create } } as any);

    await service.record({
      orgId: "org-1",
      projectId: "project-1",
      eventType: "manual_import",
      entityType: "communication_message",
      payload: {
        bodyText: "Raw private transcript",
        safe: "kept",
        nested: { apiKey: "sk-proj-1234567890abcdefghijklmnopqrstuvwxyz" }
      }
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payloadJson: {
          bodyText: "[redacted]",
          safe: "kept",
          nested: { apiKey: "[redacted]" }
        }
      })
    });
  });
});
