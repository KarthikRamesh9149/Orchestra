import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/app/errors.js";
import { createActionBodySchema } from "../src/modules/socrates/actions.schemas.js";
import { SocratesActionService } from "../src/modules/socrates/actions.service.js";

const now = new Date("2026-05-19T00:00:00.000Z");

function makeAction(overrides: Record<string, unknown> = {}) {
  return {
    id: "action-1",
    orgId: "org-1",
    projectId: "project-1",
    sessionId: "session-1",
    proposedByMessageId: "message-1",
    actionType: "assign_task",
    label: "Assign auth to Ali",
    payloadJson: {
      assigneeName: "Ali",
      taskTitle: "Build authentication",
      taskDescription: "Implement login",
      area: "backend",
      status: "open"
    },
    status: "proposed",
    resultJson: null,
    failureReason: null,
    createdByUserId: "manager-1",
    appliedByUserId: null,
    rejectedByUserId: null,
    createdAt: now,
    appliedAt: null,
    rejectedAt: null,
    updatedAt: now,
    ...overrides
  } as any;
}

function createDeps() {
  const actions = new Map<string, any>();
  let transactionQueue = Promise.resolve();
  let transactionDepth = 0;
  const prisma = {
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn((callback: (tx: any) => Promise<unknown>) => {
      const run = transactionQueue.then(async () => {
        transactionDepth += 1;
        try {
          return await callback(prisma);
        } finally {
          transactionDepth -= 1;
        }
      });
      transactionQueue = run.then(() => undefined, () => undefined);
      return run;
    }),
    project: {
      findUnique: vi.fn(async () => ({ id: "project-1", orgId: "org-1" }))
    },
    document: {
      count: vi.fn(async ({ where }: any) => where.id?.in?.length ?? 1),
      findFirst: vi.fn(async () => ({ id: "doc-1" }))
    },
    documentSection: {
      count: vi.fn(async ({ where }: any) => where.id?.in?.length ?? 1)
    },
    brainNode: {
      count: vi.fn(async ({ where }: any) => where.id?.in?.length ?? 1)
    },
    artifactVersion: {
      count: vi.fn(async ({ where }: any) => where.id?.in?.length ?? 1)
    },
    socratesSession: {
      findFirst: vi.fn(async () => ({ id: "session-1" }))
    },
    socratesMessage: {
      findFirst: vi.fn(async () => ({ id: "message-1" }))
    },
    socratesAction: {
      create: vi.fn(async ({ data }: any) => {
        const row = makeAction({ ...data, id: "action-1", createdAt: now, updatedAt: now });
        actions.set(row.id, row);
        return row;
      }),
      findFirst: vi.fn(async ({ where }: any) => actions.get(where.id) ?? null),
      findMany: vi.fn(async () => Array.from(actions.values())),
      count: vi.fn(async () => actions.size),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = actions.get(where.id);
        const updated = { ...existing, ...data, updatedAt: now };
        actions.set(where.id, updated);
        return updated;
      })
    },
    projectMember: {
      findFirst: vi.fn(async () => ({ id: "member-1" }))
    },
    projectContextEntry: {
      count: vi.fn(async ({ where }: any) => where.id?.in?.length ?? 1),
      findFirst: vi.fn(async () => ({ id: "ctx-1" }))
    },
    projectResponsibility: {
      count: vi.fn(async ({ where }: any) => where.id?.in?.length ?? 1),
      findFirst: vi.fn(async () => ({ id: "resp-1" }))
    },
    projectDiagram: {
      count: vi.fn(async ({ where }: any) => where.id?.in?.length ?? 1),
      findFirst: vi.fn(async () => ({ id: "diagram-1" }))
    },
    socratesSuggestion: {
      deleteMany: vi.fn(async () => ({ count: 1 }))
    },
    jobRun: {
      upsert: vi.fn(async () => ({}))
    }
  } as any;
  const projectService = {
    ensureProjectMemberCanManageTeamContext: vi.fn(async () => ({ id: "member-1", projectRole: "manager" })),
    ensureProjectMemberCanUseSocrates: vi.fn(async () => ({ id: "member-1", projectRole: "manager" }))
  } as any;
  const auditService = { record: vi.fn(async () => undefined) } as any;
  const jobs = { enqueue: vi.fn(async () => undefined) } as any;
  const documentGenerationService = {
    generateDocument: vi.fn(async () => ({ documentId: "doc-1", documentVersionId: "ver-1", kind: "prd" }))
  } as any;
  const projectContextService = {
    createContext: vi.fn(async () => ({ id: "ctx-1", body: "Sensitive context body that must not be stored in action result" }))
  } as any;
  const projectDiagramService = {
    generateDiagram: vi.fn(async () => ({ id: "diagram-1", mermaidSource: "flowchart TD\n  A --> B" })),
    createDiagram: vi.fn(async () => ({ id: "diagram-1", mermaidSource: "flowchart TD\n  A --> B" })),
    embedDiagramInLiveDoc: vi.fn(async () => ({ id: "embed-1" }))
  } as any;
  const codingRequirementsService = {
    generate: vi.fn(async () => ({ id: "coding-1", artifactVersionId: "artifact-1" }))
  } as any;
  const projectResponsibilitiesService = {
    createResponsibility: vi.fn(async () => ({ id: "resp-1" })),
    updateResponsibility: vi.fn(async () => ({ id: "resp-1" }))
  } as any;
  const projectOpsService = {
    createMeetingFromSocratesAction: vi.fn(async () => ({ id: "event-1" }))
  } as any;
  const service = new SocratesActionService(
    prisma,
    projectService,
    auditService,
    jobs,
    documentGenerationService,
    projectContextService,
    projectDiagramService,
    codingRequirementsService,
    projectResponsibilitiesService,
    projectOpsService
  );
  return {
    service,
    prisma,
    auditService,
    projectResponsibilitiesService,
    projectContextService,
    projectDiagramService,
    codingRequirementsService,
    documentGenerationService,
    projectOpsService,
    actions,
    isInTransaction: () => transactionDepth > 0
  };
}

describe("SocratesActionService", () => {
  it("creates, lists, gets, applies, and audits an assign_task action", async () => {
    const deps = createDeps();
    const created = await deps.service.createAction("project-1", "session-1", "manager-1", {
      actionType: "assign_task",
      label: "Assign auth to Ali",
      payload: {
        assigneeName: "Ali",
        taskTitle: "Build authentication",
        taskDescription: "Implement login",
        area: "backend",
        status: "open"
      },
      proposedByMessageId: "message-1"
    });
    expect(created.status).toBe("proposed");
    const listed = await deps.service.listActions("project-1", "manager-1", { page: 1, pageSize: 25 });
    expect(listed.items).toHaveLength(1);
    await expect(deps.service.getAction("project-1", "action-1", "manager-1")).resolves.toMatchObject({ id: "action-1" });

    const applied = await deps.service.applyAction("project-1", "action-1", "manager-1");
    expect(applied.status).toBe("applied");
    expect(deps.projectResponsibilitiesService.createResponsibility).toHaveBeenCalledWith(
      "project-1",
      "manager-1",
      expect.objectContaining({ title: "Build authentication", source: "socrates" })
    );
    expect(deps.auditService.record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "socrates_action_applied" }));
  });

  it("does not execute domain mutation services inside the action row transaction", async () => {
    const deps = createDeps();
    deps.actions.set("action-1", makeAction());
    deps.projectResponsibilitiesService.createResponsibility.mockImplementationOnce(async () => {
      expect(deps.isInTransaction()).toBe(false);
      return { id: "resp-1" };
    });

    const applied = await deps.service.applyAction("project-1", "action-1", "manager-1");

    expect(applied.status).toBe("applied");
    expect(deps.projectResponsibilitiesService.createResponsibility).toHaveBeenCalledTimes(1);
  });

  it("leaves the action applying if final applied status persistence fails after domain mutation", async () => {
    const deps = createDeps();
    deps.actions.set("action-1", makeAction());
    deps.prisma.socratesAction.update.mockImplementation(async ({ where, data }: any) => {
      if (data.status === "applied") {
        throw new Error("finalize failed");
      }
      const existing = deps.actions.get(where.id);
      const updated = { ...existing, ...data, updatedAt: now };
      deps.actions.set(where.id, updated);
      return updated;
    });

    await expect(deps.service.applyAction("project-1", "action-1", "manager-1")).rejects.toThrow("finalize failed");

    expect(deps.actions.get("action-1").status).toBe("applying");
    expect(deps.projectResponsibilitiesService.createResponsibility).toHaveBeenCalledTimes(1);
    expect(deps.auditService.record).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: "socrates_action_failed" }));
  });

  it("returns already applied actions idempotently without duplicating side effects", async () => {
    const deps = createDeps();
    deps.actions.set("action-1", makeAction({ status: "applied", resultJson: { entityType: "project_responsibility", entityId: "resp-1" } }));
    const applied = await deps.service.applyAction("project-1", "action-1", "manager-1");
    expect(applied.status).toBe("applied");
    expect(deps.projectResponsibilitiesService.createResponsibility).not.toHaveBeenCalled();
  });

  it("blocks concurrent apply calls while the first call owns the applying claim", async () => {
    const deps = createDeps();
    deps.actions.set("action-1", makeAction());
    let releaseDomainMutation!: () => void;
    const domainMutationStarted = new Promise<void>((resolve) => {
      deps.projectResponsibilitiesService.createResponsibility.mockImplementationOnce(async () => {
        resolve();
        await new Promise<void>((release) => {
          releaseDomainMutation = release;
        });
        return { id: "resp-1" };
      });
    });

    const firstApply = deps.service.applyAction("project-1", "action-1", "manager-1");
    await domainMutationStarted;

    await expect(deps.service.applyAction("project-1", "action-1", "manager-1")).rejects.toMatchObject({
      code: "socrates_action_applying"
    });

    releaseDomainMutation();
    const first = await firstApply;

    expect(first.status).toBe("applied");
    expect(deps.projectResponsibilitiesService.createResponsibility).toHaveBeenCalledTimes(1);
  });

  it("rejects proposed actions and blocks apply after reject", async () => {
    const deps = createDeps();
    deps.actions.set("action-1", makeAction());
    const rejected = await deps.service.rejectAction("project-1", "action-1", "manager-1", { reason: "Not needed" });
    expect(rejected.status).toBe("rejected");
    await expect(deps.service.applyAction("project-1", "action-1", "manager-1")).rejects.toMatchObject({
      code: "socrates_action_rejected"
    });
  });

  it("blocks rejecting an action that is already applying", async () => {
    const deps = createDeps();
    deps.actions.set("action-1", makeAction({ status: "applying" }));

    await expect(deps.service.rejectAction("project-1", "action-1", "manager-1", { reason: "Not needed" })).rejects.toMatchObject({
      code: "socrates_action_applying"
    });
  });

  it("marks domain failures as failed without reporting applied", async () => {
    const deps = createDeps();
    deps.actions.set("action-1", makeAction());
    deps.projectResponsibilitiesService.createResponsibility.mockRejectedValueOnce(new AppError(422, "Bad assignee", "bad_assignee"));
    const failed = await deps.service.applyAction("project-1", "action-1", "manager-1");
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toBe("Bad assignee");
  });

  it("stores only safe result metadata and not full domain payloads", async () => {
    const deps = createDeps();
    deps.actions.set("action-1", makeAction({
      actionType: "create_context_note",
      payloadJson: {
        type: "manual_note",
        title: "Context",
        body: "Useful body",
        participants: [],
        tags: [],
        importance: "normal"
      }
    }));

    const applied = await deps.service.applyAction("project-1", "action-1", "manager-1");
    expect(applied.status).toBe("applied");
    expect(JSON.stringify(applied.result)).not.toContain("Sensitive context body");
    expect(JSON.stringify(applied.result)).not.toContain("mermaidSource");
    expect(applied.result).toMatchObject({
      entityType: "project_context",
      entityId: "ctx-1"
    });
  });

  it("drops invalid model-suggested actions and persists valid suggestions with backend ids", async () => {
    const deps = createDeps();
    const created = await deps.service.createActionsFromSocratesAnswer({
      projectId: "project-1",
      sessionId: "session-1",
      messageId: "message-1",
      actorUserId: "manager-1",
      suggestedActions: [
        {
          type: "assign_task",
          label: "Assign auth",
          payload: { assigneeName: "Ali", taskTitle: "Build auth", area: "backend", status: "open" },
          requiresConfirmation: true
        },
        {
          type: "create_context_note",
          label: "Store secret",
          payload: { type: "manual_note", title: "Secret", body: "Do not store", apiKey: "sk-test" },
          requiresConfirmation: true
        } as any
      ]
    });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ actionId: "action-1", status: "proposed", requiresConfirmation: true });
    expect(deps.prisma.socratesAction.create).toHaveBeenCalledTimes(1);
  });

  it("rejects wrong-project action references at create time", async () => {
    const deps = createDeps();
    deps.prisma.document.findFirst.mockResolvedValueOnce(null);

    await expect(deps.service.createAction("project-1", "session-1", "manager-1", {
      actionType: "generate_prd",
      label: "Generate PRD",
      payload: {
        prompt: "Generate a useful PRD for onboarding",
        template: "basic_mvp",
        includeCodingHints: true,
        contextIds: ["document:11111111-1111-4111-8111-111111111111"],
        rebuildBrain: false
      }
    })).rejects.toMatchObject({ code: "invalid_socrates_action_reference" });
  });

  it("rejects unsafe Mermaid and secret-like action payloads at schema level", () => {
    expect(() =>
      createActionBodySchema.parse({
        actionType: "create_diagram",
        label: "Save unsafe diagram",
        payload: {
          mode: "save",
          diagramType: "flowchart",
          title: "Unsafe diagram",
          mermaidSource: "flowchart TD\n  A[Start] --> B[<script>alert(1)</script>]"
        }
      })
    ).toThrow();
    expect(() =>
      createActionBodySchema.parse({
        actionType: "create_context_note",
        label: "Secret note",
        payload: {
          type: "manual_note",
          title: "Token",
          body: "Never store secrets",
          apiKey: "sk-test"
        }
      })
    ).toThrow();
    expect(() =>
      createActionBodySchema.parse({
        actionType: "create_context_note",
        label: "Secret note",
        payload: {
          type: "manual_note",
          title: "Token",
          body: "OPENAI_API_KEY=sk-proj-1234567890abcdefghijklmnopqrstuvwxyz",
          participants: [],
          tags: [],
          importance: "normal"
        }
      })
    ).toThrow();
  });

  it("executes all supported action mappings through domain services", async () => {
    const deps = createDeps();
    const cases = [
      ["generate_prd", { prompt: "Generate a PRD for onboarding", template: "basic_mvp", includeCodingHints: true, contextIds: [], rebuildBrain: false }, deps.documentGenerationService.generateDocument],
      ["generate_srs", { prompt: "Generate an SRS for onboarding", template: "basic_srs", includeCodingHints: true, contextIds: [], rebuildBrain: false }, deps.documentGenerationService.generateDocument],
      ["create_context_note", { type: "manual_note", title: "Note", body: "A useful context note", participants: [], tags: [], importance: "normal" }, deps.projectContextService.createContext],
      ["create_diagram", { mode: "generate", diagramType: "flowchart", prompt: "Show onboarding", sourceRefs: [] }, deps.projectDiagramService.generateDiagram],
      ["embed_diagram_in_live_doc", { diagramId: "44444444-4444-4444-8444-444444444444", sectionKey: "overview", sortOrder: 1 }, deps.projectDiagramService.embedDiagramInLiveDoc],
      ["generate_coding_requirements", { focus: "full_project", includeMermaid: true, saveFlowchart: true, sourceRefs: [] }, deps.codingRequirementsService.generate],
      ["create_responsibility", { assigneeName: "Sara", title: "Own frontend", area: "frontend", status: "open" }, deps.projectResponsibilitiesService.createResponsibility],
      ["update_team_member_responsibility", { responsibilityId: "11111111-1111-1111-1111-111111111111", status: "blocked" }, deps.projectResponsibilitiesService.updateResponsibility],
      ["create_calendar_event", { title: "Kickoff", startsAt: "2026-05-20T00:00:00.000Z", attendeeMemberIds: [], source: "socrates" }, deps.projectOpsService.createMeetingFromSocratesAction]
    ] as const;
    for (const [actionType, payload, fn] of cases) {
      const id = `action-${actionType}`;
      deps.actions.set(id, makeAction({ id, actionType, payloadJson: payload, label: actionType }));
      await deps.service.applyAction("project-1", id, "manager-1");
      expect(fn).toHaveBeenCalled();
    }
  });
});
