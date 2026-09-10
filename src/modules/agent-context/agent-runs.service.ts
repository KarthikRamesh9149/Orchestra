import { createHash } from "node:crypto";
import type { AgentRun, AgentRunReviewResult, AgentRunStatus, Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { AuditService } from "../audit/service.js";
import { ProjectService } from "../projects/service.js";
import { redactAgentContextText } from "./citations.js";
import type {
  CreateAgentRunInput,
  ListAgentRunsQuery,
  ReviewAgentRunInput,
  UpdateAgentRunInput,
  UpdateAgentRunStatusInput
} from "./schemas.js";

const terminalReviewStatusByResult: Record<Exclude<AgentRunReviewResult, "unreviewed">, AgentRunStatus> = {
  accepted: "accepted",
  rejected: "rejected",
  needs_follow_up: "needs_follow_up",
  failed: "failed"
};

type RunTextFields = Pick<
  CreateAgentRunInput,
  "taskDescription" | "promptSent" | "outputSummary" | "fullOutput" | "implementationNotes"
>;

type NormalizedAgentRunInput = {
  text: Record<keyof RunTextFields, string | null>;
  filesChanged: string[];
  modulesTouched: string[];
  testsRun: string[];
  docsUpdated: string[];
  risksFound: string[];
  followUpQuestions: string[];
  productBrainImplications: string[];
  limitations: string[];
  warnings: string[];
};

export class AgentRunMemoryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService
  ) {}

  async createRun(projectId: string, actorUserId: string, input: CreateAgentRunInput) {
    await this.ensureAccess(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    const contextPack = input.contextPackId ? await this.loadContextPack(projectId, input.contextPackId) : null;
    const normalized = this.normalizeInput(input, contextPack?.generatedAt ?? null);
    const run = await this.prisma.agentRun.create({
      data: {
        orgId: project.orgId,
        projectId,
        contextPackId: input.contextPackId ?? null,
        contextPackGeneratedAt: contextPack?.generatedAt ?? null,
        exportRefJson: input.exportReference ? (input.exportReference as Prisma.InputJsonValue) : undefined,
        exportFormat: input.exportFormat ?? input.exportReference?.format ?? null,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
        targetAgentJson: input.targetAgent ? (input.targetAgent as Prisma.InputJsonValue) : undefined,
        provider: input.provider ?? input.targetAgent?.kind ?? null,
        agentLabel: input.agentLabel ?? input.targetAgent?.name ?? null,
        taskTitle: input.taskTitle,
        taskType: input.taskType,
        taskDescription: normalized.text.taskDescription,
        promptSource: input.promptSource ?? "manually_pasted",
        promptSent: normalized.text.promptSent,
        promptHash: normalized.text.promptSent ? hashText(normalized.text.promptSent) : null,
        status: input.status ?? (input.contextPackId ? "context_generated" : "planned"),
        outputSummary: normalized.text.outputSummary,
        fullOutput: normalized.text.fullOutput,
        implementationNotes: normalized.text.implementationNotes,
        branchName: input.branchName ?? null,
        commitSha: input.commitSha ?? null,
        prUrl: input.prUrl ?? null,
        filesChangedJson: normalized.filesChanged as Prisma.InputJsonValue,
        modulesTouchedJson: normalized.modulesTouched as Prisma.InputJsonValue,
        testsRunJson: normalized.testsRun as Prisma.InputJsonValue,
        testStatus: input.testStatus ?? null,
        docsUpdatedJson: normalized.docsUpdated as Prisma.InputJsonValue,
        risksFoundJson: normalized.risksFound as Prisma.InputJsonValue,
        followUpQuestionsJson: normalized.followUpQuestions as Prisma.InputJsonValue,
        possibleProductBrainImplications: input.possibleProductBrainImplications ?? false,
        productBrainImplicationsJson: normalized.productBrainImplications as Prisma.InputJsonValue,
        limitationsJson: normalized.limitations as Prisma.InputJsonValue,
        warningsJson: normalized.warnings as Prisma.InputJsonValue,
        visibility: input.visibility ?? "internal",
        indexedForSocrates: true,
        indexedAt: new Date(),
        retrievalSummary: buildRetrievalSummary(input, normalized),
        citationJson: { type: "agent_run", id: "pending", label: input.taskTitle },
        openTargetJson: { targetType: "agent_run", targetRef: { agentRunId: "pending" } }
      }
    });
    const updated = await this.prisma.agentRun.update({
      where: { id: run.id },
      data: {
        citationJson: { type: "agent_run", id: run.id, label: run.taskTitle },
        openTargetJson: { targetType: "agent_run", targetRef: { agentRunId: run.id } }
      }
    });
    await this.audit(project.orgId, projectId, actorUserId, "agent_run_created", updated, {
      contextPackId: updated.contextPackId,
      status: updated.status,
      warningCount: toStringArray(updated.warningsJson).length
    });
    return this.toDto(updated);
  }

  async listRuns(projectId: string, actorUserId: string, query: ListAgentRunsQuery) {
    await this.ensureAccess(projectId, actorUserId);
    const page = query.page;
    const pageSize = query.pageSize;
    const where: Prisma.AgentRunWhereInput = {
      projectId,
      ...(query.status ? { status: query.status as AgentRunStatus } : { status: { not: "deleted" } }),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.taskType ? { taskType: query.taskType } : {}),
      ...(query.contextPackId ? { contextPackId: query.contextPackId } : {}),
      ...(query.createdByUserId ? { createdByUserId: query.createdByUserId } : {}),
      ...(query.reviewState ? { humanReviewResult: query.reviewState as AgentRunReviewResult } : {}),
      ...(query.needsFollowUp ? { status: "needs_follow_up" } : {}),
      ...(query.branchName ? { branchName: query.branchName } : {}),
      ...(query.hasPrUrl === true ? { prUrl: { not: null } } : {}),
      ...(query.hasPrUrl === false ? { prUrl: null } : {}),
      ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {})
    };
    const [totalCount, rows] = await Promise.all([
      this.prisma.agentRun.count({ where }),
      this.prisma.agentRun.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    return {
      items: rows.map((run) => this.toListDto(run)),
      meta: { page, pageSize, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) }
    };
  }

  async getRun(projectId: string, runId: string, actorUserId: string) {
    await this.ensureAccess(projectId, actorUserId);
    return this.toDto(await this.loadRun(projectId, runId));
  }

  async updateRun(projectId: string, runId: string, actorUserId: string, input: UpdateAgentRunInput) {
    await this.ensureAccess(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    const existing = await this.loadRun(projectId, runId);
    if (existing.createdByUserId !== actorUserId) {
      throw new AppError(403, "Only the run owner can edit implementation evidence", "agent_run_owner_required");
    }
    if (existing.humanReviewResult !== "unreviewed" || existing.reviewedAt) {
      throw new AppError(409, "Reviewed agent-run evidence is immutable", "agent_run_reviewed_immutable");
    }
    const nextContextPack = input.contextPackId !== undefined ? await this.loadContextPack(projectId, input.contextPackId) : null;
    const normalized = this.normalizeInput(
      { ...dtoToInput(existing), ...input } as CreateAgentRunInput,
      nextContextPack?.generatedAt ?? existing.contextPackGeneratedAt
    );
    const data: Prisma.AgentRunUpdateInput = {
      updatedByUserId: actorUserId,
      ...(input.contextPackId !== undefined ? { contextPackId: input.contextPackId, contextPackGeneratedAt: nextContextPack?.generatedAt ?? null } : {}),
      ...(input.exportReference !== undefined ? { exportRefJson: input.exportReference as Prisma.InputJsonValue } : {}),
      ...(input.exportFormat !== undefined ? { exportFormat: input.exportFormat } : {}),
      ...(input.targetAgent !== undefined ? { targetAgentJson: input.targetAgent as Prisma.InputJsonValue } : {}),
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
      ...(input.agentLabel !== undefined ? { agentLabel: input.agentLabel } : {}),
      ...(input.taskTitle !== undefined ? { taskTitle: input.taskTitle } : {}),
      ...(input.taskType !== undefined ? { taskType: input.taskType } : {}),
      ...(input.taskDescription !== undefined ? { taskDescription: normalized.text.taskDescription } : {}),
      ...(input.promptSource !== undefined ? { promptSource: input.promptSource } : {}),
      ...(input.promptSent !== undefined ? { promptSent: normalized.text.promptSent, promptHash: normalized.text.promptSent ? hashText(normalized.text.promptSent) : null } : {}),
      ...(input.outputSummary !== undefined ? { outputSummary: normalized.text.outputSummary } : {}),
      ...(input.fullOutput !== undefined ? { fullOutput: normalized.text.fullOutput } : {}),
      ...(input.implementationNotes !== undefined ? { implementationNotes: normalized.text.implementationNotes } : {}),
      ...(input.branchName !== undefined ? { branchName: input.branchName } : {}),
      ...(input.commitSha !== undefined ? { commitSha: input.commitSha } : {}),
      ...(input.prUrl !== undefined ? { prUrl: input.prUrl } : {}),
      ...(input.filesChanged !== undefined ? { filesChangedJson: normalized.filesChanged as Prisma.InputJsonValue } : {}),
      ...(input.modulesTouched !== undefined ? { modulesTouchedJson: normalized.modulesTouched as Prisma.InputJsonValue } : {}),
      ...(input.testsRun !== undefined ? { testsRunJson: normalized.testsRun as Prisma.InputJsonValue } : {}),
      ...(input.testStatus !== undefined ? { testStatus: input.testStatus } : {}),
      ...(input.docsUpdated !== undefined ? { docsUpdatedJson: normalized.docsUpdated as Prisma.InputJsonValue } : {}),
      ...(input.risksFound !== undefined ? { risksFoundJson: normalized.risksFound as Prisma.InputJsonValue } : {}),
      ...(input.followUpQuestions !== undefined ? { followUpQuestionsJson: normalized.followUpQuestions as Prisma.InputJsonValue } : {}),
      ...(input.possibleProductBrainImplications !== undefined ? { possibleProductBrainImplications: input.possibleProductBrainImplications } : {}),
      ...(input.productBrainImplications !== undefined ? { productBrainImplicationsJson: normalized.productBrainImplications as Prisma.InputJsonValue } : {}),
      ...(input.limitations !== undefined ? { limitationsJson: normalized.limitations as Prisma.InputJsonValue } : {}),
      warningsJson: mergeWarnings(existing.warningsJson, normalized.warnings),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      retrievalSummary: buildRetrievalSummary({ ...dtoToInput(existing), ...input } as CreateAgentRunInput, normalized)
    };
    const updated = await this.prisma.agentRun.update({ where: { id: runId }, data });
    await this.audit(project.orgId, projectId, actorUserId, "agent_run_updated", updated, {
      previousStatus: existing.status,
      newStatus: updated.status
    });
    return this.toDto(updated);
  }

  async updateStatus(projectId: string, runId: string, actorUserId: string, input: UpdateAgentRunStatusInput) {
    await this.ensureAccess(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    const existing = await this.loadRun(projectId, runId);
    if (existing.createdByUserId !== actorUserId) {
      throw new AppError(403, "Only the run owner can update execution status", "agent_run_owner_required");
    }
    if (existing.humanReviewResult !== "unreviewed" || existing.reviewedAt) {
      throw new AppError(409, "Reviewed agent-run evidence is immutable", "agent_run_reviewed_immutable");
    }
    const statusNote = input.note ? redactAgentContextText(input.note) : null;
    const data: Prisma.AgentRunUpdateInput = {
      status: input.status,
      updatedByUserId: actorUserId,
      warningsJson: statusNote
        ? mergeWarnings(existing.warningsJson, [`Status note: ${statusNote}`])
        : (existing.warningsJson as Prisma.InputJsonValue)
    };
    if (input.status === "completed" || input.status === "failed") {
      data.requiresHumanReview = true;
      data.unverifiedClaims = true;
    }
    const updated = await this.prisma.agentRun.update({
      where: { id: runId },
      data
    });
    await this.audit(project.orgId, projectId, actorUserId, "agent_run_status_changed", updated, {
      previousStatus: existing.status,
      newStatus: updated.status,
      reviewResult: null
    });
    return this.toDto(updated);
  }

  async reviewRun(projectId: string, runId: string, actorUserId: string, input: ReviewAgentRunInput) {
    await this.projectService.ensureProjectTruthApprover(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    const existing = await this.loadRun(projectId, runId);
    if (existing.createdByUserId === actorUserId) {
      throw new AppError(409, "Agent-run authors cannot approve their own evidence", "agent_run_self_review_forbidden");
    }
    if (existing.humanReviewResult !== "unreviewed" || existing.reviewedAt) {
      throw new AppError(409, "Agent run has already been reviewed", "agent_run_already_reviewed");
    }
    const reviewResult = input.reviewResult as Exclude<AgentRunReviewResult, "unreviewed">;
    const updated = await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: terminalReviewStatusByResult[reviewResult],
        humanReviewResult: reviewResult,
        humanReviewNotes: input.humanReviewNotes ? redactAgentContextText(input.humanReviewNotes) : null,
        possibleProductBrainImplications: input.possibleProductBrainImplications ?? existing.possibleProductBrainImplications,
        ...(input.productBrainImplications
          ? { productBrainImplicationsJson: sanitizeStringArray(input.productBrainImplications).values as Prisma.InputJsonValue }
          : {}),
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
        updatedByUserId: actorUserId,
        requiresHumanReview: false,
        unverifiedClaims: reviewResult !== "accepted"
      }
    });
    await this.audit(project.orgId, projectId, actorUserId, `agent_run_${reviewResult}`, updated, {
      previousStatus: existing.status,
      newStatus: updated.status,
      reviewResult
    });
    return this.toDto(updated);
  }

  async archiveRun(projectId: string, runId: string, actorUserId: string) {
    await this.ensureAccess(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    const updated = await this.prisma.agentRun.update({
      where: { id: (await this.loadRun(projectId, runId)).id },
      data: { status: "archived", archivedAt: new Date(), updatedByUserId: actorUserId }
    });
    await this.audit(project.orgId, projectId, actorUserId, "agent_run_archived", updated, { runId });
    return this.toDto(updated);
  }

  async deleteRun(projectId: string, runId: string, actorUserId: string) {
    await this.ensureAccess(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    const updated = await this.prisma.agentRun.update({
      where: { id: (await this.loadRun(projectId, runId)).id },
      data: { status: "deleted", deletedAt: new Date(), updatedByUserId: actorUserId }
    });
    await this.audit(project.orgId, projectId, actorUserId, "agent_run_deleted", updated, { runId, softDeleted: true });
    return { ok: true, deletedId: updated.id, status: updated.status, deletedAt: updated.deletedAt?.toISOString() ?? null };
  }

  async getProjectAgentRunSummary(projectId: string) {
    const [recent, needingReview, needingFollowUp, acceptedCount, rejectedCount] = await Promise.all([
      this.prisma.agentRun.findMany({
        where: { projectId, status: { notIn: ["deleted", "archived"] } },
        orderBy: { updatedAt: "desc" },
        take: 5
      }),
      this.prisma.agentRun.count({ where: { projectId, requiresHumanReview: true, status: { in: ["completed", "human_reviewed", "needs_follow_up"] } } }),
      this.prisma.agentRun.count({ where: { projectId, status: "needs_follow_up" } }),
      this.prisma.agentRun.count({ where: { projectId, status: "accepted" } }),
      this.prisma.agentRun.count({ where: { projectId, status: "rejected" } })
    ]);
    return {
      recent: recent.map((run) => this.toListDto(run)),
      needingReview,
      needingFollowUp,
      acceptedCount,
      rejectedCount,
      latestByProvider: Object.values(
        recent.reduce<Record<string, ReturnType<AgentRunMemoryService["toListDto"]>>>((accumulator, run) => {
          const provider = run.provider ?? "unknown";
          accumulator[provider] ??= this.toListDto(run);
          return accumulator;
        }, {})
      ),
      quickLink: `/projects/${projectId}/agent-runs`
    };
  }

  private async ensureAccess(projectId: string, actorUserId: string) {
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    if (member.projectRole === "client") {
      throw new AppError(403, "Client users cannot access internal Agent Runs", "client_agent_run_access_forbidden");
    }
    return member;
  }

  private async loadProject(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, orgId: true } });
    if (!project) throw new AppError(404, "Project not found", "project_not_found");
    return project;
  }

  private async loadContextPack(projectId: string, contextPackId: string) {
    const pack = await this.prisma.agentContextPack.findFirst({
      where: { id: contextPackId, projectId, status: { not: "deleted" } },
      select: { id: true, generatedAt: true, title: true }
    });
    if (!pack) throw new AppError(404, "Agent Context Pack not found for this project", "agent_run_context_pack_not_found");
    return pack;
  }

  private async loadRun(projectId: string, runId: string) {
    const run = await this.prisma.agentRun.findFirst({ where: { id: runId, projectId, status: { not: "deleted" } } });
    if (!run) throw new AppError(404, "Agent run not found", "agent_run_not_found");
    return run;
  }

  private normalizeInput(input: CreateAgentRunInput, contextPackGeneratedAt: Date | null): NormalizedAgentRunInput {
    const warnings = [...(input.warnings ?? [])];
    const text = sanitizeTextFields(input, warnings);
    const filesChanged = sanitizeStringArray(input.filesChanged ?? []);
    const modulesTouched = sanitizeStringArray(input.modulesTouched ?? []);
    const testsRun = sanitizeStringArray(input.testsRun ?? []);
    const docsUpdated = sanitizeStringArray(input.docsUpdated ?? []);
    const risksFound = sanitizeStringArray(input.risksFound ?? []);
    const followUpQuestions = sanitizeStringArray(input.followUpQuestions ?? []);
    const productBrainImplications = sanitizeStringArray(input.productBrainImplications ?? []);
    for (const item of [filesChanged, modulesTouched, testsRun, docsUpdated, risksFound, followUpQuestions, productBrainImplications]) {
      warnings.push(...item.warnings);
    }
    if (input.promptSource === "export" && !input.exportReference) {
      warnings.push("Export reference is metadata-only because Step 2 exports are stateless in this branch.");
    }
    if (!contextPackGeneratedAt && input.contextPackId) {
      warnings.push("Linked context pack timestamp was unavailable.");
    }
    return {
      text,
      filesChanged: filesChanged.values,
      modulesTouched: modulesTouched.values,
      testsRun: testsRun.values,
      docsUpdated: docsUpdated.values,
      risksFound: risksFound.values,
      followUpQuestions: followUpQuestions.values,
      productBrainImplications: productBrainImplications.values,
      limitations: [...(input.limitations ?? []), "Agent runs are implementation evidence, not accepted Product Brain truth."],
      warnings: unique(warnings)
    };
  }

  private toDto(run: AgentRun) {
    return {
      id: run.id,
      projectId: run.projectId,
      orgId: run.orgId,
      contextPackId: run.contextPackId,
      contextPackGeneratedAt: run.contextPackGeneratedAt?.toISOString() ?? null,
      exportReference: run.exportRefJson,
      exportFormat: run.exportFormat,
      targetAgent: run.targetAgentJson,
      provider: run.provider,
      agentLabel: run.agentLabel,
      taskTitle: run.taskTitle,
      taskType: run.taskType,
      taskDescription: run.taskDescription,
      promptSource: run.promptSource,
      promptSent: run.visibility === "redacted" ? null : run.promptSent,
      promptHash: run.promptHash,
      status: run.status,
      outputSummary: run.outputSummary,
      fullOutput: run.visibility === "redacted" ? null : run.fullOutput,
      implementationNotes: run.implementationNotes,
      branchName: run.branchName,
      commitSha: run.commitSha,
      prUrl: run.prUrl,
      filesChanged: run.filesChangedJson,
      modulesTouched: run.modulesTouchedJson,
      testsRun: run.testsRunJson,
      testStatus: run.testStatus,
      docsUpdated: run.docsUpdatedJson,
      risksFound: run.risksFoundJson,
      followUpQuestions: run.followUpQuestionsJson,
      possibleProductBrainImplications: run.possibleProductBrainImplications,
      productBrainImplications: run.productBrainImplicationsJson,
      humanReviewResult: run.humanReviewResult,
      humanReviewNotes: run.humanReviewNotes,
      unverifiedClaims: run.unverifiedClaims,
      requiresHumanReview: run.requiresHumanReview,
      limitations: run.limitationsJson,
      warnings: run.warningsJson,
      indexedForSocrates: run.indexedForSocrates,
      indexedAt: run.indexedAt?.toISOString() ?? null,
      retrievalSummary: run.retrievalSummary,
      citation: run.citationJson,
      openTarget: run.openTargetJson,
      createdByUserId: run.createdByUserId,
      updatedByUserId: run.updatedByUserId,
      reviewedByUserId: run.reviewedByUserId,
      reviewedAt: run.reviewedAt?.toISOString() ?? null,
      archivedAt: run.archivedAt?.toISOString() ?? null,
      deletedAt: run.deletedAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString()
    };
  }

  private toListDto(run: AgentRun) {
    return {
      id: run.id,
      contextPackId: run.contextPackId,
      provider: run.provider,
      agentLabel: run.agentLabel,
      taskTitle: run.taskTitle,
      taskType: run.taskType,
      status: run.status,
      humanReviewResult: run.humanReviewResult,
      branchName: run.branchName,
      commitSha: run.commitSha,
      prUrl: run.prUrl,
      testStatus: run.testStatus,
      requiresHumanReview: run.requiresHumanReview,
      needsFollowUp: run.status === "needs_follow_up",
      possibleProductBrainImplications: run.possibleProductBrainImplications,
      outputSummary: run.outputSummary,
      warningSummary: toStringArray(run.warningsJson).slice(0, 3),
      limitationSummary: toStringArray(run.limitationsJson).slice(0, 3),
      createdByUserId: run.createdByUserId,
      reviewedByUserId: run.reviewedByUserId,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
      reviewedAt: run.reviewedAt?.toISOString() ?? null
    };
  }

  private async audit(orgId: string, projectId: string, actorUserId: string, eventType: string, run: AgentRun, payload: Record<string, unknown>) {
    await this.auditService.record({
      orgId,
      projectId,
      actorUserId,
      eventType,
      entityType: "agent_run",
      entityId: run.id,
      payload: { agentRunId: run.id, ...payload }
    });
  }
}

function sanitizeTextFields(input: RunTextFields, warnings: string[]) {
  return {
    taskDescription: sanitizeNullable(input.taskDescription, "task description", warnings),
    promptSent: sanitizeNullable(input.promptSent, "prompt sent", warnings),
    outputSummary: sanitizeNullable(input.outputSummary, "output summary", warnings),
    fullOutput: sanitizeNullable(input.fullOutput, "full output", warnings),
    implementationNotes: sanitizeNullable(input.implementationNotes, "implementation notes", warnings)
  };
}

function sanitizeNullable(value: string | null | undefined, label: string, warnings: string[]) {
  if (!value) return null;
  const redacted = redactAgentContextText(value);
  if (redacted !== value) warnings.push(`Secret-like content was redacted from ${label}.`);
  return redacted;
}

function sanitizeStringArray(values: string[]) {
  const warnings: string[] = [];
  return {
    values: values.map((value) => sanitizeNullable(value, "agent run list field", warnings)).filter((value): value is string => Boolean(value)),
    warnings
  };
}

function buildRetrievalSummary(input: CreateAgentRunInput, normalized: NormalizedAgentRunInput) {
  const parts = [
    input.taskTitle,
    input.provider ?? input.targetAgent?.kind,
    normalized.text.outputSummary,
    normalized.text.implementationNotes,
    ...normalized.filesChanged,
    ...normalized.modulesTouched,
    ...normalized.risksFound,
    ...normalized.followUpQuestions
  ].filter(Boolean);
  return parts.join(" | ").slice(0, 4000);
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mergeWarnings(existing: unknown, next: string[]) {
  return unique([...toStringArray(existing), ...next]) as Prisma.InputJsonValue;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}


function dtoToInput(run: AgentRun): Partial<CreateAgentRunInput> {
  return {
    contextPackId: run.contextPackId ?? undefined,
    exportReference: typeof run.exportRefJson === "object" && run.exportRefJson ? run.exportRefJson as any : undefined,
    exportFormat: run.exportFormat as any,
    targetAgent: typeof run.targetAgentJson === "object" && run.targetAgentJson ? run.targetAgentJson as any : undefined,
    provider: run.provider ?? undefined,
    agentLabel: run.agentLabel ?? undefined,
    taskTitle: run.taskTitle,
    taskType: run.taskType,
    taskDescription: run.taskDescription ?? undefined,
    promptSource: run.promptSource,
    promptSent: run.promptSent ?? undefined,
    outputSummary: run.outputSummary ?? undefined,
    fullOutput: run.fullOutput ?? undefined,
    implementationNotes: run.implementationNotes ?? undefined,
    branchName: run.branchName ?? undefined,
    commitSha: run.commitSha ?? undefined,
    prUrl: run.prUrl ?? undefined,
    filesChanged: toStringArray(run.filesChangedJson),
    modulesTouched: toStringArray(run.modulesTouchedJson),
    testsRun: toStringArray(run.testsRunJson),
    testStatus: run.testStatus as any,
    docsUpdated: toStringArray(run.docsUpdatedJson),
    risksFound: toStringArray(run.risksFoundJson),
    followUpQuestions: toStringArray(run.followUpQuestionsJson),
    possibleProductBrainImplications: run.possibleProductBrainImplications,
    productBrainImplications: toStringArray(run.productBrainImplicationsJson),
    limitations: toStringArray(run.limitationsJson),
    warnings: toStringArray(run.warningsJson),
    visibility: run.visibility
  };
}
