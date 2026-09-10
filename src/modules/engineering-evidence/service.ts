import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import type { AppEnv } from "../../config/env.js";
import type { AuditService } from "../audit/service.js";
import type { ProjectService } from "../projects/service.js";
import type { ListEngineeringEvidenceQuery, ManualEngineeringEvidenceInput, RefreshEngineeringEvidenceInput } from "./schemas.js";

type Actor = { userId: string; orgId: string };

type NormalizedEvidence = {
  provider: string;
  sourceType: string;
  sourceSubType: string;
  evidenceKey: string;
  repositoryLinkId?: string | null;
  repositoryOwner?: string | null;
  repositoryName?: string | null;
  branch?: string | null;
  sha?: string | null;
  pullRequestNumber?: number | null;
  filePath?: string | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  routeMethod?: string | null;
  routePath?: string | null;
  environment?: string | null;
  actorGithubUserId?: string | null;
  actorGithubLogin?: string | null;
  mappedUserId?: string | null;
  occurredAt?: Date | null;
  status?: string | null;
  confidence?: string | null;
  severity?: string | null;
  sourceUrl?: string | null;
  providerRawId?: string | null;
  title?: string | null;
  summary?: string | null;
  citationJson?: unknown;
  openTargetJson?: unknown;
  metadataJson?: unknown;
};

type EvidenceDto = {
  id: string;
  projectId: string;
  provider: string;
  sourceType: string;
  sourceSubType: string;
  repository: string | null;
  branch: string | null;
  sha: string | null;
  pullRequestNumber: number | null;
  filePath: string | null;
  routeMethod: string | null;
  routePath: string | null;
  status: string | null;
  confidence: string | null;
  severity: string | null;
  actorGithubLogin: string | null;
  mappedUserId: string | null;
  occurredAt: string | null;
  sourceUrl: string | null;
  title: string | null;
  summary: string | null;
  citations: unknown;
  openTargets: unknown;
  metadata: unknown;
  notice: string;
};


const ROUTE_EVIDENCE = [
  { method: "GET", path: "/v1/projects/:projectId/engineering-evidence", title: "List engineering evidence" },
  { method: "POST", path: "/v1/projects/:projectId/engineering-evidence/refresh", title: "Refresh engineering evidence" },
  { method: "GET", path: "/v1/projects/:projectId/mock-real-registry", title: "Mock vs Real registry" },
  { method: "GET", path: "/v1/projects/:projectId/integration-seams", title: "Integration seams" },
  { method: "GET", path: "/v1/projects/:projectId/branch-deploy-truth", title: "Branch and deploy truth" },
  { method: "GET", path: "/v1/projects/:projectId/todo-fixme", title: "TODO and FIXME aggregator" }
] as const;

const TODO_LABELS = ["TODO", "FIXME", "HACK", "TEMP", "follow-up", "open question", "risk", "workaround", "cleanup"];

export class EngineeringEvidenceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService
  ) {}

  async refresh(projectId: string, actor: Actor, input: RefreshEngineeringEvidenceInput) {
    const project = await this.loadProject(projectId, actor);
    const refreshRun = await this.prisma.engineeringEvidenceRefreshRun.create({
      data: {
        orgId: actor.orgId,
        projectId,
        startedByUserId: actor.userId,
        status: "running",
        sourceTypesJson: input.sourceTypes as Prisma.InputJsonValue
      }
    });
    await this.audit("engineering_evidence.refresh_started", projectId, actor, { refreshRunId: refreshRun.id, sourceTypes: input.sourceTypes });

    try {
      const normalized: NormalizedEvidence[] = [];
      const counts = { github: 0, agentRuns: 0, routeRegistry: 0, normalized: 0 };
      if (input.sourceTypes.includes("github")) {
        const githubRows = await this.prisma.gitHubEngineeringEvidence.findMany({
          where: { orgId: actor.orgId, projectId, evidenceStatus: "active", repositoryLink: { status: "active", archivedAt: null } },
          orderBy: { updatedAt: "desc" },
          take: 1000
        });
        counts.github = githubRows.length;
        normalized.push(...githubRows.map((row) => this.fromGitHubEvidence(row)));
      }
      if (input.sourceTypes.includes("agent_run")) {
        const runs = await this.prisma.agentRun.findMany({
          where: { orgId: actor.orgId, projectId, deletedAt: null },
          orderBy: { updatedAt: "desc" },
          take: 250
        });
        counts.agentRuns = runs.length;
        normalized.push(...runs.map((run) => this.fromAgentRun(run)));
      }
      if (input.sourceTypes.includes("route_registry")) {
        counts.routeRegistry = ROUTE_EVIDENCE.length;
        normalized.push(...ROUTE_EVIDENCE.map((route) => this.fromRoute(project, route)));
      }

      for (const item of normalized) {
        await this.upsertEvidence(project, item);
      }
      counts.normalized = normalized.length;
      await this.prisma.engineeringEvidenceRefreshRun.update({
        where: { id: refreshRun.id },
        data: { status: "completed", finishedAt: new Date(), countsJson: counts }
      });
      await this.audit("engineering_evidence.refresh_completed", projectId, actor, { refreshRunId: refreshRun.id, counts });
      return {
        projectId,
        refreshRunId: refreshRun.id,
        status: "completed",
        counts,
        warnings: this.baseWarnings(),
        readOnly: true,
        truthMutationAllowed: false
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Engineering evidence refresh failed";
      await this.prisma.engineeringEvidenceRefreshRun.update({
        where: { id: refreshRun.id },
        data: { status: "failed", finishedAt: new Date(), errorsJson: [{ message: message.slice(0, 500) }] }
      });
      await this.audit("engineering_evidence.refresh_failed", projectId, actor, { refreshRunId: refreshRun.id, error: message.slice(0, 200) });
      throw new AppError(500, "Engineering evidence refresh failed", "engineering_evidence_refresh_failed");
    }
  }

  async listEvidence(projectId: string, actor: Actor, query: ListEngineeringEvidenceQuery) {
    await this.projectService.ensureProjectAccess(projectId, actor.userId);
    const where: Prisma.EngineeringEvidenceItemWhereInput = {
      orgId: actor.orgId,
      projectId,
      archivedAt: null,
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(query.sourceSubType ? { sourceSubType: query.sourceSubType } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.status ? { status: query.status } : {})
    };
    const items = await this.prisma.engineeringEvidenceItem.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { updatedAt: "desc" }],
      take: query.limit
    });
    return this.collection(projectId, items.map((item) => this.toEvidenceDto(item)));
  }

  async getEvidence(projectId: string, evidenceId: string, actor: Actor) {
    await this.projectService.ensureProjectAccess(projectId, actor.userId);
    const item = await this.prisma.engineeringEvidenceItem.findFirst({ where: { id: evidenceId, orgId: actor.orgId, projectId, archivedAt: null } });
    if (!item) throw new AppError(404, "Engineering evidence item not found", "engineering_evidence_not_found");
    return { ...this.toEvidenceDto(item), readOnly: true, truthMutationAllowed: false };
  }

  async listSources(projectId: string, actor: Actor) {
    const result = await this.listEvidence(projectId, actor, { limit: 200 });
    const counts = result.items.reduce<Record<string, number>>((accumulator, item) => {
      const key = `${item.provider}:${item.sourceType}:${item.sourceSubType}`;
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {});
    return { projectId, counts, warnings: this.baseWarnings(), readOnly: true, truthMutationAllowed: false };
  }

  async createManualEntry(projectId: string, actor: Actor, input: ManualEngineeringEvidenceInput) {
    const normalizedInput = { confidence: "medium" as const, citations: [], openTargets: [], metadata: {}, ...input };
    const project = await this.loadProject(projectId, actor);
    const entry = await this.prisma.engineeringEvidenceManualEntry.create({
      data: {
        orgId: actor.orgId,
        projectId,
        createdByUserId: actor.userId,
        entryType: normalizedInput.entryType,
        targetKind: normalizedInput.targetKind,
        targetRef: normalizedInput.targetRef ?? null,
        title: redact(normalizedInput.title),
        summary: normalizedInput.summary ? redact(normalizedInput.summary) : null,
        status: normalizedInput.status,
        confidence: normalizedInput.confidence,
        severity: normalizedInput.severity ?? null,
        citationJson: redactJson({ citations: normalizedInput.citations, manual: true }),
        openTargetJson: redactJson({ openTargets: normalizedInput.openTargets, manual: true }),
        metadataJson: redactJson(normalizedInput.metadata)
      }
    });
    await this.upsertEvidence(project, {
      provider: "manual",
      sourceType: "manual_registry",
      sourceSubType: normalizedInput.entryType,
      evidenceKey: `manual:${entry.id}`,
      status: normalizedInput.status,
      confidence: normalizedInput.confidence,
      severity: normalizedInput.severity ?? null,
      title: entry.title,
      summary: entry.summary,
      providerRawId: entry.id,
      citationJson: entry.citationJson,
      openTargetJson: entry.openTargetJson,
      metadataJson: { ...normalizedInput.metadata, targetKind: normalizedInput.targetKind, targetRef: normalizedInput.targetRef ?? null, manual: true }
    });
    await this.audit(`${manualAuditPrefix(normalizedInput.entryType)}.manual_created`, projectId, actor, { manualEntryId: entry.id, entryType: normalizedInput.entryType });
    return { ...this.toManualDto(entry), manual: true, readOnly: true, truthMutationAllowed: false };
  }

  async listMockRealRegistry(projectId: string, actor: Actor) {
    const [evidence, manual] = await Promise.all([this.listRawEvidence(projectId, actor), this.listManual(projectId, actor, "mock_real")]);
    const items = [
      ...evidence.filter((item) => item.filePath || item.routePath).map((item) => ({
        id: `mock-real:${item.id}`,
        targetKind: item.routePath ? "api_route" : "file",
        targetName: item.routePath ?? item.filePath ?? item.title ?? "unknown",
        routeMethod: item.routeMethod,
        routePath: item.routePath,
        filePath: item.filePath,
        status: classifyMockReal(item),
        confidence: item.routePath ? "medium" : item.confidence,
        summary: item.summary ?? item.title,
        evidenceIds: [item.id],
        citations: item.citationJson,
        openTargets: item.openTargetJson,
        limitations: item.routePath ? ["Backend route existence does not prove frontend integration."] : []
      })),
      ...manual.map((entry) => this.manualViewItem(entry))
    ];
    return this.view(projectId, items, ["Mock vs Real is a foundation view and not final readiness scoring."]);
  }

  async listIntegrationSeams(projectId: string, actor: Actor) {
    const [evidence, manual] = await Promise.all([this.listRawEvidence(projectId, actor), this.listManual(projectId, actor, "integration_seam")]);
    const routeItems = evidence.filter((item) => item.routePath).map((item) => ({
      id: `seam:${item.id}`,
      seamKey: `${item.routeMethod ?? "GET"} ${item.routePath}`,
      backendRoute: item.routePath,
      method: item.routeMethod,
      status: "unknown",
      confidence: "low",
      summary: item.title ?? "Backend route evidence",
      evidenceIds: [item.id],
      citations: item.citationJson,
      openTargets: item.openTargetJson,
      limitations: ["No connected frontend source was scanned; seam status abstains from mismatch claims."]
    }));
    return this.view(projectId, [...routeItems, ...manual.map((entry) => this.manualViewItem(entry))], ["frontend source may be unavailable; unknown seam status is intentional."]);
  }

  async listBranchDeployTruth(projectId: string, actor: Actor) {
    const [evidence, manual] = await Promise.all([this.listRawEvidence(projectId, actor), this.listManual(projectId, actor, "branch_deploy_truth")]);
    const items = evidence
      .filter((item) => item.branch || item.pullRequestNumber || item.sourceSubType.includes("deployment"))
      .map((item) => ({
        id: `branch-deploy:${item.id}`,
        branch: item.branch,
        sha: item.sha,
        pullRequestNumber: item.pullRequestNumber,
        environment: item.environment,
        status: classifyBranchDeploy(item),
        confidence: item.sourceSubType.includes("deployment") ? "medium" : "low",
        summary: item.summary ?? item.title,
        evidenceIds: [item.id],
        citations: item.citationJson,
        openTargets: item.openTargetJson,
        limitations: item.sourceSubType.includes("deployment") ? [] : ["Deployment truth is not claimed without deployment evidence."]
      }));
    return this.view(projectId, [...items, ...manual.map((entry) => this.manualViewItem(entry))], ["No deploy actions are available from this API."]);
  }

  async listTodoFixme(projectId: string, actor: Actor) {
    const [evidence, manual] = await Promise.all([this.listRawEvidence(projectId, actor), this.listManual(projectId, actor, "todo_fixme")]);
    const seen = new Set<string>();
    const items = evidence.flatMap((item) => {
      const label = detectTodoLabel(`${item.title ?? ""} ${item.summary ?? ""}`);
      if (!label) return [];
      const key = `${label}:${item.filePath ?? item.sourceUrl ?? item.id}:${hashText(item.summary ?? item.title ?? "")}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        id: `todo:${item.id}`,
        label,
        text: item.summary ?? item.title,
        normalizedSummary: item.summary ?? item.title,
        filePath: item.filePath,
        branch: item.branch,
        sha: item.sha,
        pullRequestNumber: item.pullRequestNumber,
        status: "open",
        confidence: item.confidence,
        severity: item.severity ?? "medium",
        evidenceIds: [item.id],
        citations: item.citationJson,
        openTargets: item.openTargetJson
      }];
    });
    return this.view(projectId, [...items, ...manual.map((entry) => this.manualViewItem(entry))], ["TODO/FIXME excerpts are bounded and secret-like content is redacted."]);
  }

  private async loadProject(projectId: string, actor: Actor) {
    await this.projectService.ensureProjectAccess(projectId, actor.userId);
    return this.prisma.project.findFirstOrThrow({ where: { id: projectId, orgId: actor.orgId }, select: { id: true, orgId: true } });
  }

  private async listRawEvidence(projectId: string, actor: Actor) {
    await this.projectService.ensureProjectAccess(projectId, actor.userId);
    return this.prisma.engineeringEvidenceItem.findMany({
      where: { orgId: actor.orgId, projectId, archivedAt: null },
      orderBy: [{ occurredAt: "desc" }, { updatedAt: "desc" }],
      take: 500
    });
  }

  private async listManual(projectId: string, actor: Actor, entryType: string) {
    await this.projectService.ensureProjectAccess(projectId, actor.userId);
    return this.prisma.engineeringEvidenceManualEntry.findMany({
      where: { orgId: actor.orgId, projectId, entryType, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 200
    });
  }

  private async upsertEvidence(project: { id: string; orgId: string }, item: NormalizedEvidence) {
    const data = {
      orgId: project.orgId,
      projectId: project.id,
      provider: item.provider,
      sourceType: item.sourceType,
      sourceSubType: item.sourceSubType,
      evidenceKey: item.evidenceKey,
      repositoryLinkId: item.repositoryLinkId ?? null,
      repositoryOwner: item.repositoryOwner ?? null,
      repositoryName: item.repositoryName ?? null,
      branch: item.branch ?? null,
      sha: item.sha ?? null,
      pullRequestNumber: item.pullRequestNumber ?? null,
      filePath: item.filePath ?? null,
      lineStart: item.lineStart ?? null,
      lineEnd: item.lineEnd ?? null,
      routeMethod: item.routeMethod ?? null,
      routePath: item.routePath ?? null,
      environment: item.environment ?? null,
      actorGithubUserId: item.actorGithubUserId ?? null,
      actorGithubLogin: item.actorGithubLogin ?? null,
      mappedUserId: item.mappedUserId ?? null,
      occurredAt: item.occurredAt ?? null,
      status: item.status ?? "active",
      confidence: item.confidence ?? "medium",
      severity: item.severity ?? null,
      sourceUrl: item.sourceUrl ? redact(item.sourceUrl) : null,
      providerRawId: item.providerRawId ?? null,
      title: item.title ? redact(item.title) : null,
      summary: item.summary ? redact(item.summary) : null,
      citationJson: redactJson(withCitationFallback(item, project)),
      openTargetJson: redactJson(withOpenTargetFallback(item)),
      metadataJson: redactJson(item.metadataJson ?? {})
    };
    if (item.provider === "github" && item.repositoryLinkId) {
      return this.prisma.$transaction(async (tx) => {
        const active = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM github_repository_project_links WHERE id = ${item.repositoryLinkId}::uuid AND status = 'active' AND archived_at IS NULL FOR UPDATE`;
        if (!active.length) return null;
        const key = { projectId: project.id, evidenceKey: item.evidenceKey };
        await tx.engineeringEvidenceItem.upsert({ where: { projectId_evidenceKey: key }, create: data, update: {} });
        if (item.occurredAt) await tx.engineeringEvidenceItem.updateMany({
          where: { ...key, OR: [{ occurredAt: null }, { occurredAt: { lt: item.occurredAt } }] },
          data: { ...data, archivedAt: null }
        });
        return tx.engineeringEvidenceItem.findUnique({ where: { projectId_evidenceKey: key } });
      });
    }
    return this.prisma.engineeringEvidenceItem.upsert({
      where: { projectId_evidenceKey: { projectId: project.id, evidenceKey: item.evidenceKey } },
      create: data,
      update: { ...data, archivedAt: null }
    });
  }

  private fromGitHubEvidence(row: any): NormalizedEvidence {
    const sourceSubType = githubSubType(String(row.evidenceType));
    return {
      provider: "github",
      sourceType: "github",
      sourceSubType,
      evidenceKey: `github:${row.repositoryLinkId}:${row.evidenceType}:${row.providerId}`,
      repositoryLinkId: row.repositoryLinkId,
      repositoryOwner: row.repositoryOwner,
      repositoryName: row.repositoryName,
      branch: row.branch,
      sha: row.sha,
      pullRequestNumber: row.pullRequestNumber,
      filePath: row.path,
      actorGithubUserId: row.actorGithubUserId,
      actorGithubLogin: row.actorGithubLogin,
      mappedUserId: row.mappedUserId,
      occurredAt: row.occurredAt,
      status: row.status ?? "active",
      confidence: "medium",
      sourceUrl: row.sourceUrl,
      providerRawId: row.providerId,
      title: row.title,
      summary: row.summary,
      citationJson: row.citationJson,
      openTargetJson: row.openTargetJson,
      metadataJson: { githubEvidenceId: row.id, payload: row.payloadJson, evidenceStatus: row.evidenceStatus }
    };
  }

  private fromAgentRun(run: any): NormalizedEvidence {
    return {
      provider: "orchestra",
      sourceType: "agent_activity",
      sourceSubType: "agent_run",
      evidenceKey: `agent_run:${run.id}`,
      branch: run.branchName,
      sha: run.commitSha,
      status: run.unverifiedClaims ? "unverified" : String(run.status),
      confidence: run.humanReviewResult === "unreviewed" ? "low" : "medium",
      sourceUrl: run.prUrl,
      providerRawId: run.id,
      title: run.taskTitle,
      summary: [run.outputSummary, ...arrayStrings(run.risksFoundJson), ...arrayStrings(run.followUpQuestionsJson)].filter(Boolean).join("\n").slice(0, 4000),
      citationJson: run.citationJson ?? { source: "agent_run", agentRunId: run.id },
      openTargetJson: run.openTargetJson ?? { targetType: "agent_run", targetRef: { agentRunId: run.id } },
      metadataJson: {
        provider: run.provider,
        agentLabel: run.agentLabel,
        filesChanged: run.filesChangedJson,
        risks: run.risksFoundJson,
        followUps: run.followUpQuestionsJson,
        humanReviewResult: run.humanReviewResult,
        evidenceNotice: "Agent activity is implementation evidence, not Product Brain truth."
      }
    };
  }

  private fromRoute(project: { id: string }, route: (typeof ROUTE_EVIDENCE)[number]): NormalizedEvidence {
    return {
      provider: "orchestra",
      sourceType: "route_registry",
      sourceSubType: "backend_route",
      evidenceKey: `route:${route.method}:${route.path}`,
      routeMethod: route.method,
      routePath: route.path,
      status: "real",
      confidence: "medium",
      title: route.title,
      summary: "Backend route is registered in Orchestra. This does not prove frontend integration.",
      providerRawId: `${route.method} ${route.path}`,
      citationJson: { source: "backend_route_registry", projectId: project.id },
      openTargetJson: { targetType: "backend_route", targetRef: { method: route.method, path: route.path } },
      metadataJson: { limitation: "Route registry evidence is not final FDE readiness intelligence." }
    };
  }

  private toEvidenceDto(item: any) {
    return {
      id: item.id,
      projectId: item.projectId,
      provider: item.provider,
      sourceType: item.sourceType,
      sourceSubType: item.sourceSubType,
      repositoryLinkId: item.repositoryLinkId,
      repository: item.repositoryOwner && item.repositoryName ? `${item.repositoryOwner}/${item.repositoryName}` : null,
      branch: item.branch,
      sha: item.sha,
      pullRequestNumber: item.pullRequestNumber,
      filePath: item.filePath,
      routeMethod: item.routeMethod,
      routePath: item.routePath,
      status: item.status,
      confidence: item.confidence,
      severity: item.severity,
      actorGithubLogin: item.actorGithubLogin,
      mappedUserId: item.mappedUserId,
      occurredAt: item.occurredAt?.toISOString?.() ?? null,
      sourceUrl: item.sourceUrl,
      title: item.title,
      summary: item.summary,
      citations: item.citationJson,
      openTargets: item.openTargetJson,
      metadata: item.metadataJson,
      notice: "Engineering evidence is evidence, not Product Brain truth."
    };
  }

  private toManualDto(entry: any) {
    return {
      id: entry.id,
      projectId: entry.projectId,
      entryType: entry.entryType,
      targetKind: entry.targetKind,
      targetRef: entry.targetRef,
      title: entry.title,
      summary: entry.summary,
      status: entry.status,
      confidence: entry.confidence,
      severity: entry.severity,
      citations: entry.citationJson,
      openTargets: entry.openTargetJson,
      createdAt: entry.createdAt?.toISOString?.() ?? null,
      updatedAt: entry.updatedAt?.toISOString?.() ?? null
    };
  }

  private manualViewItem(entry: any) {
    return {
      id: `manual:${entry.id}`,
      targetKind: entry.targetKind,
      targetName: entry.targetRef ?? entry.title,
      status: entry.status,
      confidence: entry.confidence,
      severity: entry.severity,
      summary: entry.summary ?? entry.title,
      evidenceIds: [],
      manualEntryId: entry.id,
      citations: entry.citationJson,
      openTargets: entry.openTargetJson,
      limitations: ["Manual registry entry is evidence, not Product Brain truth."]
    };
  }

  private collection(projectId: string, items: EvidenceDto[]) {
    return {
      projectId,
      generatedAt: new Date().toISOString(),
      items,
      evidenceCount: items.length,
      warnings: this.baseWarnings(),
      limitations: ["Engineering evidence is a readiness substrate, not final FDE dashboard intelligence."],
      readOnly: true,
      truthMutationAllowed: false,
      githubWritesAllowed: false
    };
  }

  private view(projectId: string, items: unknown[], limitations: string[]) {
    return {
      projectId,
      generatedAt: new Date().toISOString(),
      items,
      evidenceCount: items.length,
      warnings: this.baseWarnings(),
      limitations,
      readOnly: true,
      truthMutationAllowed: false,
      githubWritesAllowed: false
    };
  }

  private baseWarnings() {
    return [
      "Engineering evidence does not mutate Product Brain or Live Doc truth.",
      this.env.ENGINEERING_EVIDENCE_CONTENT_SCAN_ENABLED ? "Content scan is enabled and remains allowlist-bounded." : "Repo content scan is disabled; views rely on metadata, docs, routes, agent runs, and manual entries."
    ];
  }

  private async audit(eventType: string, projectId: string, actor: Actor, payload: Record<string, unknown>) {
    await this.auditService.record({ orgId: actor.orgId, projectId, actorUserId: actor.userId, eventType, entityType: "engineering_evidence", payload });
  }
}

function githubSubType(type: string) {
  return type.replace(/^github_/, "").replace("pull_request_file", "changed_file").replace("commit_file", "changed_file");
}

function classifyMockReal(item: any) {
  const text = `${item.filePath ?? ""} ${item.title ?? ""} ${item.summary ?? ""}`.toLowerCase();
  if (/(partial|partially implemented|incomplete|wip)/.test(text)) return "partial";
  if (/(assumed|assumption|unverified contract|expected contract)/.test(text)) return "assumed";
  if (/(mock|stub|fixture|demo|fake)/.test(text)) return "mocked";
  if (item.routePath) return "real";
  return "unknown";
}

function classifyBranchDeploy(item: any) {
  if (item.sourceSubType === "pull_request" && item.status === "open") return "open_pr";
  if (item.sourceSubType.includes("deployment") && /prod/i.test(String(item.environment ?? item.status ?? ""))) return "deployed_prod";
  if (item.sourceSubType.includes("deployment") && /stag/i.test(String(item.environment ?? item.status ?? ""))) return "deployed_staging";
  if (item.sourceSubType.includes("deployment")) return "deployed_preview";
  return item.pullRequestNumber ? "open_pr" : "unknown";
}

function detectTodoLabel(text: string) {
  return TODO_LABELS.find((label) => new RegExp(`\\b${escapeRegex(label)}\\b`, "i").test(text)) ?? null;
}

function manualAuditPrefix(entryType: string) {
  if (entryType === "mock_real") return "mock_real";
  if (entryType === "integration_seam") return "integration_seam";
  if (entryType === "branch_deploy_truth") return "branch_deploy_truth";
  if (entryType === "todo_fixme") return "todo_fixme";
  return "engineering_evidence";
}

function arrayStrings(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function redact(value: string) {
  return value
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[redacted]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
    .replace(/\bmcp_[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{12,}\b/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/g, "Bearer [redacted]")
    .replace(/\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|FIREFLIES_API_KEY|GITHUB_APP_PRIVATE_KEY|GITHUB_APP_WEBHOOK_SECRET|GITHUB_APP_CLIENT_SECRET|JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|CLIENT_SHARE_TOKEN_SECRET|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|DATABASE_URL|PRIVATE_KEY)\s*=\s*\S+/gi, "[redacted]")
    .replace(/postgresql:\/\/\S+:\S+@\S+/gi, "[redacted]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted]")
    .slice(0, 4000);
}

function withCitationFallback(item: NormalizedEvidence, project: { id: string; orgId: string }) {
  if (hasJsonContent(item.citationJson)) return item.citationJson;
  return {
    source: item.sourceType,
    sourceSubType: item.sourceSubType,
    provider: item.provider,
    projectId: project.id,
    orgId: project.orgId,
    providerRawId: item.providerRawId ?? item.evidenceKey,
    repositoryLinkId: item.repositoryLinkId ?? null,
    sourceUrl: item.sourceUrl ?? null
  };
}

function withOpenTargetFallback(item: NormalizedEvidence) {
  if (hasJsonContent(item.openTargetJson)) return item.openTargetJson;
  return {
    targetType: item.sourceSubType,
    targetRef: {
      provider: item.provider,
      providerRawId: item.providerRawId ?? item.evidenceKey,
      repositoryLinkId: item.repositoryLinkId ?? null,
      repository: item.repositoryOwner && item.repositoryName ? `${item.repositoryOwner}/${item.repositoryName}` : null,
      branch: item.branch ?? null,
      sha: item.sha ?? null,
      pullRequestNumber: item.pullRequestNumber ?? null,
      filePath: item.filePath ?? null,
      routeMethod: item.routeMethod ?? null,
      routePath: item.routePath ?? null,
      sourceUrl: item.sourceUrl ?? null
    }
  };
}

function hasJsonContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return false;
}

function redactJson(value: unknown): Prisma.InputJsonValue {
  return redactJsonValue(value) as Prisma.InputJsonValue;
}

function redactJsonValue(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string") return redact(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => redactJsonValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => [key, redactJsonValue(nested)])
    );
  }
  return redact(String(value));
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
