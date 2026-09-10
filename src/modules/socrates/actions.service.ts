import type { Prisma, PrismaClient, SocratesAction, SocratesActionType } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";
import type { JobDispatcher } from "../../lib/jobs/types.js";
import type { AuditService } from "../audit/service.js";
import type { ProjectDocumentGenerationService } from "../documents/document-generation.service.js";
import type { ProjectContextService } from "../projects/context.service.js";
import type { ProjectDiagramService } from "../diagrams/service.js";
import type { CodingRequirementsService } from "../coding-requirements/service.js";
import type { ProjectResponsibilitiesService } from "../projects/responsibilities.service.js";
import type { ProjectOpsService } from "../project-ops/service.js";
import type { ProjectService } from "../projects/service.js";
import {
  type CreateActionBodyInput,
  type ListActionsQueryInput,
  type RejectActionBodyInput,
  type SocratesActionTypeInput,
  type SuggestedActionInput,
  parseActionPayload
} from "./actions.schemas.js";

type ActionResult = {
  entityType: string;
  entityId?: string | null;
  openTargets?: unknown[];
  data?: unknown;
};

type StoredActionResult = {
  entityType: string;
  entityId: string | null;
  openTargets: unknown[];
  summary: {
    hasDomainResult: boolean;
  };
};

export class SocratesActionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly jobs: JobDispatcher,
    private readonly documentGenerationService: ProjectDocumentGenerationService,
    private readonly projectContextService: ProjectContextService,
    private readonly projectDiagramService: ProjectDiagramService,
    private readonly codingRequirementsService: CodingRequirementsService,
    private readonly projectResponsibilitiesService: ProjectResponsibilitiesService,
    private readonly projectOpsService: ProjectOpsService
  ) {}

  async createAction(projectId: string, sessionId: string, actorUserId: string, input: CreateActionBodyInput) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    await this.ensureSession(projectId, sessionId);
    if (input.proposedByMessageId) {
      await this.ensureMessage(projectId, sessionId, input.proposedByMessageId);
    }
    const payload = this.parsePayload(input.actionType, input.payload);
    await this.validateActionReferences(projectId, input.actionType, payload);

    const row = await this.prisma.socratesAction.create({
      data: {
        orgId: project.orgId,
        projectId,
        sessionId,
        proposedByMessageId: input.proposedByMessageId ?? null,
        actionType: input.actionType,
        label: input.label,
        payloadJson: payload as Prisma.InputJsonValue,
        status: "proposed",
        createdByUserId: actorUserId
      }
    });

    await this.audit(row, actorUserId, "socrates_action_created", {
      ...this.baseAuditPayload(row, actorUserId),
      createdByUserId: actorUserId
    });
    return this.toDto(row);
  }

  async createActionsFromSocratesAnswer(input: {
    projectId: string;
    sessionId: string;
    messageId: string;
    actorUserId: string;
    suggestedActions: SuggestedActionInput[];
  }) {
    const created = [];
    for (const suggested of input.suggestedActions.slice(0, 5)) {
      try {
        const row = await this.createAction(input.projectId, input.sessionId, input.actorUserId, {
          actionType: suggested.type,
          label: suggested.label,
          payload: suggested.payload,
          proposedByMessageId: input.messageId
        });
        created.push({
          actionId: row.id,
          type: row.actionType,
          label: row.label,
          payload: row.payload,
          status: row.status,
          confidence: suggested.confidence ?? null,
          requiresConfirmation: true
        });
      } catch {
        // Suggestions are optional; invalid or unauthorized suggestions must not
        // break the answer stream or become executable.
      }
    }
    return created;
  }

  async listActions(projectId: string, actorUserId: string, query: ListActionsQueryInput) {
    await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    const page = Math.max(query.page, 1);
    const pageSize = Math.min(Math.max(query.pageSize, 1), 100);
    const where: Prisma.SocratesActionWhereInput = {
      projectId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.actionType ? { actionType: query.actionType } : {}),
      ...(query.sessionId ? { sessionId: query.sessionId } : {})
    };
    const [totalCount, rows] = await Promise.all([
      this.prisma.socratesAction.count({ where }),
      this.prisma.socratesAction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    return {
      items: rows.map((row) => this.toDto(row)),
      meta: { page, pageSize, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) }
    };
  }

  async getAction(projectId: string, actionId: string, actorUserId: string) {
    await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    const row = await this.loadAction(projectId, actionId);
    return this.toDto(row);
  }

  async applyAction(projectId: string, actionId: string, actorUserId: string) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    const claim = await this.claimActionForApply(projectId, actionId, actorUserId);
    if (claim.kind === "already_applied") {
      return this.toDto(claim.row);
    }

    const row = claim.row;
    let payload: unknown;
    try {
      payload = this.parsePayload(row.actionType, row.payloadJson);
      await this.validateActionReferences(projectId, row.actionType, payload);
    } catch (error) {
      const outcome = await this.finalizeFailedAction(projectId, row.id, actorUserId, error);
      await this.invalidateSuggestions(projectId, outcome.row.sessionId);
      await this.audit(outcome.row, actorUserId, outcome.auditType, outcome.auditPayload);
      return this.toDto(outcome.row);
    }

    let result: ActionResult;
    try {
      result = await this.executeAction(projectId, actorUserId, row.actionType, payload);
    } catch (error) {
      const outcome = await this.finalizeFailedAction(projectId, row.id, actorUserId, error);
      await this.invalidateSuggestions(projectId, outcome.row.sessionId);
      await this.audit(outcome.row, actorUserId, outcome.auditType, outcome.auditPayload);
      return this.toDto(outcome.row);
    }

    const storedResult = this.toStoredResult(result);
    const outcome = await this.finalizeAppliedAction(projectId, row.id, actorUserId, storedResult);
    await this.invalidateSuggestions(projectId, outcome.row.sessionId);
    await this.refreshDashboard(projectId, `socrates_action_applied_${outcome.row.actionType}`);
    await this.audit(outcome.row, actorUserId, outcome.auditType, outcome.auditPayload);
    return this.toDto(outcome.row);
  }

  async rejectAction(projectId: string, actionId: string, actorUserId: string, input: RejectActionBodyInput) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    const outcome = await this.prisma.$transaction(async (tx) => {
      await this.lockActionRow(tx, projectId, actionId);
      const row = await tx.socratesAction.findFirst({ where: { id: actionId, projectId } });
      if (!row) throw new AppError(404, "Socrates action not found", "socrates_action_not_found");
      if (row.status === "applied") {
        throw new AppError(409, "Applied Socrates actions cannot be rejected", "socrates_action_already_applied");
      }
      if (row.status === "applying") {
        throw new AppError(409, "Socrates action is already being applied", "socrates_action_applying");
      }
      if (row.status === "rejected") {
        return { row, audit: false as const, auditPayload: null as unknown };
      }
      const updated = await tx.socratesAction.update({
        where: { id: row.id },
        data: {
          status: "rejected",
          failureReason: input.reason ?? null,
          rejectedByUserId: actorUserId,
          rejectedAt: new Date()
        }
      });
      return {
        row: updated,
        audit: true as const,
        auditPayload: {
          ...this.baseAuditPayload(updated, actorUserId),
          rejectedByUserId: actorUserId,
          reason: input.reason ?? null
        }
      };
    });
    if (outcome.audit) {
      await this.invalidateSuggestions(projectId, outcome.row.sessionId);
      await this.audit(outcome.row, actorUserId, "socrates_action_rejected", outcome.auditPayload);
    }
    return this.toDto(outcome.row);
  }

  async validateActionReferences(projectId: string, actionType: SocratesActionTypeInput, payload: unknown) {
    if (actionType === "generate_prd" || actionType === "generate_srs") {
      const contextIds = (payload as { contextIds?: string[] }).contextIds ?? [];
      for (const ref of contextIds) {
        await this.ensureDocumentGenerationContextRef(projectId, ref);
      }
    }
    if (actionType === "create_context_note") {
      const linkedMemberId = (payload as { linkedMemberId?: string | null }).linkedMemberId;
      if (linkedMemberId) await this.ensureActiveProjectMember(projectId, linkedMemberId);
    }
    if (actionType === "create_diagram") {
      await this.ensureDiagramPayloadReferences(projectId, payload as Record<string, unknown>);
    }
    if (actionType === "embed_diagram_in_live_doc") {
      const diagramId = (payload as { diagramId: string }).diagramId;
      await this.ensureActiveDiagram(projectId, diagramId);
    }
    if (actionType === "generate_coding_requirements") {
      const sourceRefs = (payload as { sourceRefs?: Array<{ type: string; id: string }> }).sourceRefs ?? [];
      for (const ref of sourceRefs) {
        await this.ensureCodingRequirementsSourceRef(projectId, ref);
      }
    }
    if (actionType === "update_team_member_responsibility") {
      const responsibilityId = (payload as { responsibilityId: string }).responsibilityId;
      await this.ensureResponsibility(projectId, responsibilityId);
      const memberId = (payload as { memberId?: string | null }).memberId;
      if (memberId) await this.ensureActiveProjectMember(projectId, memberId);
    }
    if (actionType === "create_responsibility" || actionType === "assign_task") {
      const memberId = (payload as { memberId?: string | null }).memberId;
      if (memberId) await this.ensureActiveProjectMember(projectId, memberId);
    }
    if (actionType === "create_calendar_event") {
      const attendeeMemberIds = (payload as { attendeeMemberIds?: string[] }).attendeeMemberIds ?? [];
      for (const memberId of attendeeMemberIds) {
        await this.ensureActiveProjectMember(projectId, memberId);
      }
    }
  }

  private async executeAction(
    projectId: string,
    actorUserId: string,
    actionType: SocratesActionType,
    payload: unknown
  ): Promise<ActionResult> {
    switch (actionType) {
      case "generate_prd": {
        const input = payload as { prompt: string; template: "basic_mvp"; title?: string; includeCodingHints: boolean; contextIds: string[]; rebuildBrain: boolean };
        const result = await this.documentGenerationService.generateDocument(projectId, actorUserId, {
          kind: "prd",
          template: input.template,
          prompt: input.prompt,
          title: input.title,
          includeCodingHints: input.includeCodingHints,
          contextIds: input.contextIds,
          rebuildBrain: input.rebuildBrain,
          tone: "plain"
        });
        return { entityType: "document", entityId: result.documentId, data: result, openTargets: [{ targetType: "document", targetRef: { projectId, documentId: result.documentId, documentVersionId: result.documentVersionId } }] };
      }
      case "generate_srs": {
        const input = payload as { prompt: string; template: "basic_srs"; title?: string; includeCodingHints: boolean; contextIds: string[]; rebuildBrain: boolean };
        const result = await this.documentGenerationService.generateDocument(projectId, actorUserId, {
          kind: "srs",
          template: input.template,
          prompt: input.prompt,
          title: input.title,
          includeCodingHints: input.includeCodingHints,
          contextIds: input.contextIds,
          rebuildBrain: input.rebuildBrain,
          tone: "plain"
        });
        return { entityType: "document", entityId: result.documentId, data: result, openTargets: [{ targetType: "document", targetRef: { projectId, documentId: result.documentId, documentVersionId: result.documentVersionId } }] };
      }
      case "create_context_note": {
        const result = await this.projectContextService.createContext(projectId, actorUserId, payload as never);
        return { entityType: "project_context", entityId: result.id, data: result, openTargets: [{ targetType: "project_context", targetRef: { projectId, contextId: result.id } }] };
      }
      case "create_diagram": {
        const input = payload as { mode: "generate" | "save" };
        const result = input.mode === "generate"
          ? await this.projectDiagramService.generateDiagram(projectId, actorUserId, { ...(payload as object), save: true } as never)
          : await this.projectDiagramService.createDiagram(projectId, actorUserId, { ...(payload as object), source: "socrates_generated" } as never);
        if (!("id" in result)) {
          throw new AppError(500, "Diagram action did not persist a diagram", "socrates_action_diagram_not_persisted");
        }
        return { entityType: "project_diagram", entityId: result.id, data: result, openTargets: [{ targetType: "project_diagram", targetRef: { projectId, diagramId: result.id } }] };
      }
      case "embed_diagram_in_live_doc": {
        const input = payload as { diagramId: string; sectionKey: string; sortOrder: number };
        const result = await this.projectDiagramService.embedDiagramInLiveDoc(projectId, input.sectionKey, input.diagramId, actorUserId, { sortOrder: input.sortOrder });
        return { entityType: "live_doc_section_diagram", entityId: input.diagramId, data: result, openTargets: [{ targetType: "live_doc_section", targetRef: { sectionKey: input.sectionKey, diagramId: input.diagramId } }] };
      }
      case "generate_coding_requirements": {
        const result = await this.codingRequirementsService.generate(projectId, actorUserId, payload as never);
        return { entityType: "coding_requirements", entityId: result.id, data: result, openTargets: [{ targetType: "coding_requirements", targetRef: { projectId, codingRequirementsId: result.id, artifactVersionId: result.artifactVersionId } }] };
      }
      case "create_responsibility": {
        const result = await this.projectResponsibilitiesService.createResponsibility(projectId, actorUserId, { ...(payload as object), source: "socrates" } as never);
        return { entityType: "project_responsibility", entityId: result.id, data: result, openTargets: [{ targetType: "project_responsibility", targetRef: { projectId, responsibilityId: result.id } }] };
      }
      case "assign_task": {
        const input = payload as { taskTitle: string; taskDescription?: string | null };
        const result = await this.projectResponsibilitiesService.createResponsibility(projectId, actorUserId, {
          ...(payload as object),
          title: input.taskTitle,
          description: input.taskDescription ?? null,
          source: "socrates"
        } as never);
        return { entityType: "project_responsibility", entityId: result.id, data: result, openTargets: [{ targetType: "project_responsibility", targetRef: { projectId, responsibilityId: result.id } }] };
      }
      case "update_team_member_responsibility": {
        const input = payload as { responsibilityId: string };
        const { responsibilityId, ...update } = input;
        const result = await this.projectResponsibilitiesService.updateResponsibility(projectId, responsibilityId, actorUserId, update as never);
        return { entityType: "project_responsibility", entityId: result.id, data: result, openTargets: [{ targetType: "project_responsibility", targetRef: { projectId, responsibilityId: result.id } }] };
      }
      case "create_calendar_event": {
        const input = payload as { title: string; description?: string; startsAt: string; endsAt?: string; location?: string; source: "manual" | "socrates" };
        const result = await this.projectOpsService.createMeetingFromSocratesAction(projectId, actorUserId, {
          title: input.title,
          description: [input.description, input.location ? `Location: ${input.location}` : null].filter(Boolean).join("\n\n") || null,
          eventType: "meeting",
          startsAt: input.startsAt,
          endsAt: input.endsAt ?? null,
          source: input.source === "manual" ? "manual" : "manual",
          linkedRefType: "socrates_action"
        });
        return { entityType: "project_event", entityId: result.id, data: result, openTargets: [{ targetType: "project_event", targetRef: { projectId, eventId: result.id } }] };
      }
    }
  }

  private parsePayload(actionType: SocratesActionTypeInput, payload: unknown) {
    const parsed = parseActionPayload(actionType, payload);
    if (!parsed.success) {
      throw new AppError(400, "Invalid Socrates action payload", "invalid_socrates_action_payload", parsed.error.flatten());
    }
    return parsed.data;
  }

  private async loadProject(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, orgId: true } });
    if (!project) throw new AppError(404, "Project not found", "project_not_found");
    return project;
  }

  private async loadAction(projectId: string, actionId: string) {
    const row = await this.prisma.socratesAction.findFirst({ where: { id: actionId, projectId } });
    if (!row) throw new AppError(404, "Socrates action not found", "socrates_action_not_found");
    return row;
  }

  private async lockActionRow(tx: Prisma.TransactionClient, projectId: string, actionId: string) {
    await tx.$queryRaw`SELECT "id" FROM "socrates_actions" WHERE "id" = ${actionId}::uuid AND "project_id" = ${projectId}::uuid FOR UPDATE`;
  }

  private async claimActionForApply(projectId: string, actionId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockActionRow(tx, projectId, actionId);
      const row = await tx.socratesAction.findFirst({ where: { id: actionId, projectId } });
      if (!row) throw new AppError(404, "Socrates action not found", "socrates_action_not_found");
      if (row.status === "applied") {
        return { kind: "already_applied" as const, row };
      }
      if (row.status === "rejected") {
        throw new AppError(409, "Socrates action has already been rejected", "socrates_action_rejected");
      }
      if (row.status === "failed") {
        throw new AppError(409, "Socrates action has failed; create a new action to retry", "socrates_action_failed");
      }
      if (row.status === "applying") {
        throw new AppError(409, "Socrates action is already being applied", "socrates_action_applying");
      }

      const claimed = await tx.socratesAction.update({
        where: { id: row.id },
        data: {
          status: "applying",
          failureReason: null,
          appliedByUserId: actorUserId
        }
      });
      return { kind: "claimed" as const, row: claimed };
    });
  }

  private async finalizeAppliedAction(
    projectId: string,
    actionId: string,
    actorUserId: string,
    storedResult: StoredActionResult
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockActionRow(tx, projectId, actionId);
      const row = await tx.socratesAction.findFirst({ where: { id: actionId, projectId } });
      if (!row) throw new AppError(404, "Socrates action not found", "socrates_action_not_found");
      if (row.status !== "applying") {
        throw new AppError(409, "Socrates action is no longer applying", `socrates_action_${row.status}`);
      }
      const updated = await tx.socratesAction.update({
        where: { id: row.id },
        data: {
          status: "applied",
          resultJson: storedResult as Prisma.InputJsonValue,
          failureReason: null,
          appliedByUserId: actorUserId,
          appliedAt: new Date()
        }
      });
      return {
        row: updated,
        auditType: "socrates_action_applied",
        auditPayload: {
          ...this.baseAuditPayload(updated, actorUserId),
          appliedByUserId: actorUserId,
          result: this.auditResult(storedResult)
        }
      };
    });
  }

  private async finalizeFailedAction(projectId: string, actionId: string, actorUserId: string, error: unknown) {
    const failureReason = error instanceof AppError || error instanceof Error ? error.message : "Action failed";
    return this.prisma.$transaction(async (tx) => {
      await this.lockActionRow(tx, projectId, actionId);
      const row = await tx.socratesAction.findFirst({ where: { id: actionId, projectId } });
      if (!row) throw new AppError(404, "Socrates action not found", "socrates_action_not_found");
      if (row.status !== "applying") {
        throw new AppError(409, "Socrates action is no longer applying", `socrates_action_${row.status}`);
      }
      const failed = await tx.socratesAction.update({
        where: { id: row.id },
        data: {
          status: "failed",
          failureReason: failureReason.slice(0, 1000),
          resultJson: { errorCode: error instanceof AppError ? error.code : "socrates_action_apply_failed" },
          appliedByUserId: actorUserId,
          appliedAt: new Date()
        }
      });
      return {
        row: failed,
        auditType: "socrates_action_failed",
        auditPayload: {
          ...this.baseAuditPayload(failed, actorUserId),
          appliedByUserId: actorUserId,
          failureReason: failed.failureReason
        }
      };
    });
  }

  private async ensureSession(projectId: string, sessionId: string) {
    const session = await this.prisma.socratesSession.findFirst({ where: { id: sessionId, projectId }, select: { id: true } });
    if (!session) throw new AppError(404, "Socrates session not found", "socrates_session_not_found");
  }

  private async ensureMessage(projectId: string, sessionId: string, messageId: string) {
    const message = await this.prisma.socratesMessage.findFirst({
      where: { id: messageId, sessionId, session: { projectId } },
      select: { id: true }
    });
    if (!message) throw new AppError(422, "proposedByMessageId must belong to this Socrates session", "invalid_socrates_action_reference");
  }

  private async ensureActiveProjectMember(projectId: string, memberId: string) {
    const member = await this.prisma.projectMember.findFirst({ where: { id: memberId, projectId, isActive: true }, select: { id: true } });
    if (!member) throw new AppError(422, "Referenced project member is not active in this project", "invalid_socrates_action_reference");
  }

  private async ensureResponsibility(projectId: string, responsibilityId: string) {
    const row = await this.prisma.projectResponsibility.findFirst({ where: { id: responsibilityId, projectId }, select: { id: true } });
    if (!row) throw new AppError(422, "Referenced responsibility does not belong to this project", "invalid_socrates_action_reference");
  }

  private async ensureActiveDiagram(projectId: string, diagramId: string) {
    const row = await this.prisma.projectDiagram.findFirst({ where: { id: diagramId, projectId, status: "active" }, select: { id: true } });
    if (!row) throw new AppError(422, "Referenced diagram is not active in this project", "invalid_socrates_action_reference");
  }

  private async ensureDocumentGenerationContextRef(projectId: string, ref: string) {
    const [type, id] = ref.split(":");
    if (!type || !id) {
      throw new AppError(422, "Invalid document generation context reference", "invalid_socrates_action_reference");
    }
    if (type === "document") {
      const row = await this.prisma.document.findFirst({ where: { id, projectId }, select: { id: true } });
      if (row) return;
    }
    if (type === "responsibility") {
      const row = await this.prisma.projectResponsibility.findFirst({ where: { id, projectId }, select: { id: true } });
      if (row) return;
    }
    if (type === "context") {
      const row = await this.prisma.projectContextEntry.findFirst({ where: { id, projectId, status: "active" }, select: { id: true } });
      if (row) return;
    }
    throw new AppError(422, "Document generation context reference must belong to this project", "invalid_socrates_action_reference");
  }

  private async ensureDiagramPayloadReferences(projectId: string, payload: Record<string, unknown>) {
    if (payload.mode === "generate") {
      const sourceRefs = (payload.sourceRefs as Array<{ type: string; id: string }> | undefined) ?? [];
      for (const ref of sourceRefs) {
        await this.ensureDiagramSourceRef(projectId, ref);
      }
      return;
    }

    await this.ensureProjectIds(
      "documentSection",
      projectId,
      ((payload.linkedDocumentSectionIds as string[] | undefined) ?? []),
      "Invalid diagram document section reference"
    );
    await this.ensureProjectIds(
      "brainNode",
      projectId,
      ((payload.linkedBrainNodeIds as string[] | undefined) ?? []),
      "Invalid diagram brain node reference"
    );
    await this.ensureProjectIds(
      "projectContextEntry",
      projectId,
      ((payload.linkedContextEntryIds as string[] | undefined) ?? []),
      "Invalid diagram context reference",
      { status: "active" }
    );
  }

  private async ensureDiagramSourceRef(projectId: string, ref: { type: string; id: string }) {
    switch (ref.type) {
      case "document_section":
        return this.ensureProjectIds("documentSection", projectId, [ref.id], "Invalid diagram source reference");
      case "brain_node":
        return this.ensureProjectIds("brainNode", projectId, [ref.id], "Invalid diagram source reference");
      case "project_context":
        return this.ensureProjectIds("projectContextEntry", projectId, [ref.id], "Invalid diagram source reference", { status: "active" });
      case "responsibility":
        return this.ensureProjectIds("projectResponsibility", projectId, [ref.id], "Invalid diagram source reference");
      case "artifact_version":
        return this.ensureProjectIds("artifactVersion", projectId, [ref.id], "Invalid diagram source reference");
      default:
        throw new AppError(422, "Invalid diagram source reference", "invalid_socrates_action_reference");
    }
  }

  private async ensureCodingRequirementsSourceRef(projectId: string, ref: { type: string; id: string }) {
    switch (ref.type) {
      case "document":
        return this.ensureProjectIds("document", projectId, [ref.id], "Invalid coding requirements source reference");
      case "document_section":
        return this.ensureProjectIds("documentSection", projectId, [ref.id], "Invalid coding requirements source reference");
      case "brain_node":
        return this.ensureProjectIds("brainNode", projectId, [ref.id], "Invalid coding requirements source reference");
      case "project_context":
        return this.ensureProjectIds("projectContextEntry", projectId, [ref.id], "Invalid coding requirements source reference", { status: "active" });
      case "project_responsibility":
        return this.ensureProjectIds("projectResponsibility", projectId, [ref.id], "Invalid coding requirements source reference");
      case "project_diagram":
        return this.ensureProjectIds("projectDiagram", projectId, [ref.id], "Invalid coding requirements source reference", { status: "active" });
      case "artifact_version":
        return this.ensureProjectIds("artifactVersion", projectId, [ref.id], "Invalid coding requirements source reference");
      default:
        throw new AppError(422, "Invalid coding requirements source reference", "invalid_socrates_action_reference");
    }
  }

  private async ensureProjectIds(
    model: "document" | "documentSection" | "brainNode" | "projectContextEntry" | "projectResponsibility" | "projectDiagram" | "artifactVersion",
    projectId: string,
    ids: string[],
    message: string,
    extraWhere: Record<string, unknown> = {}
  ) {
    if (ids.length === 0) return;
    const uniqueIds = [...new Set(ids)];
    const count = await (this.prisma[model] as unknown as {
      count(args: { where: Record<string, unknown> }): Promise<number>;
    }).count({ where: { projectId, id: { in: uniqueIds }, ...extraWhere } });
    if (count !== uniqueIds.length) {
      throw new AppError(422, message, "invalid_socrates_action_reference");
    }
  }

  private async invalidateSuggestions(projectId: string, sessionId: string | null) {
    await this.prisma.socratesSuggestion.deleteMany({
      where: sessionId ? { sessionId } : { session: { projectId } }
    }).catch(() => undefined);
  }

  private async refreshDashboard(projectId: string, reason: string) {
    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, reason).catch(() => undefined);
  }

  private async audit(row: SocratesAction, actorUserId: string, eventType: string, payload: unknown) {
    await this.auditService.record({
      orgId: row.orgId,
      projectId: row.projectId,
      actorUserId,
      eventType,
      entityType: "socrates_action",
      entityId: row.id,
      payload
    });
  }

  private toStoredResult(result: ActionResult): StoredActionResult {
    return {
      entityType: result.entityType,
      entityId: result.entityId ?? null,
      openTargets: this.sanitizeOpenTargets(result.openTargets ?? []),
      summary: {
        hasDomainResult: result.data != null
      }
    };
  }

  private sanitizeOpenTargets(openTargets: unknown[]) {
    return openTargets.slice(0, 10).map((target) => JSON.parse(JSON.stringify(target))) as unknown[];
  }

  private auditResult(result: StoredActionResult) {
    return {
      entityType: result.entityType,
      entityId: result.entityId ?? null,
      openTargetCount: result.openTargets.length
    };
  }

  private baseAuditPayload(row: SocratesAction, actorUserId: string) {
    return {
      actionId: row.id,
      actionType: row.actionType,
      label: row.label,
      projectId: row.projectId,
      sessionId: row.sessionId,
      proposedByMessageId: row.proposedByMessageId,
      actorUserId,
      status: row.status
    };
  }

  private toDto(row: SocratesAction) {
    const result = row.resultJson as (Record<string, unknown> | null);
    return {
      id: row.id,
      projectId: row.projectId,
      sessionId: row.sessionId,
      proposedByMessageId: row.proposedByMessageId,
      actionType: row.actionType,
      label: row.label,
      payload: row.payloadJson,
      status: row.status,
      result,
      failureReason: row.failureReason,
      createdByUserId: row.createdByUserId,
      appliedByUserId: row.appliedByUserId,
      rejectedByUserId: row.rejectedByUserId,
      createdAt: row.createdAt.toISOString(),
      appliedAt: row.appliedAt?.toISOString() ?? null,
      rejectedAt: row.rejectedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      openTargets: Array.isArray(result?.openTargets) ? result.openTargets : []
    };
  }
}
