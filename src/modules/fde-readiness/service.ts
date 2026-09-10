import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import type { AppEnv } from "../../config/env.js";
import type { AuditService } from "../audit/service.js";
import type { ProjectService } from "../projects/service.js";
import type { DecisionEngineeringLinkInput, FdeFindingQuery, RationaleTraceInput } from "./schemas.js";

type Actor = { userId: string; orgId: string };
type FindingType = "conflict" | "safe_to_touch" | "duplicate_work" | "live_working_signal";
type EvidenceRow = {
  id: string;
  projectId: string;
  provider: string;
  sourceType: string;
  sourceSubType: string;
  repositoryLinkId: string | null;
  repositoryOwner: string | null;
  repositoryName: string | null;
  branch: string | null;
  sha: string | null;
  pullRequestNumber: number | null;
  filePath: string | null;
  routeMethod: string | null;
  routePath: string | null;
  environment: string | null;
  actorGithubLogin: string | null;
  mappedUserId: string | null;
  occurredAt: Date | null;
  status: string;
  confidence: string;
  severity: string | null;
  sourceUrl: string | null;
  providerRawId: string | null;
  title: string | null;
  summary: string | null;
  citationJson: unknown;
  openTargetJson: unknown;
  metadataJson: unknown;
};

type FindingInput = {
  findingType: FindingType;
  findingSubType: string;
  findingKey: string;
  targetKind?: string | null;
  targetRef?: string | null;
  status?: string;
  severity: "info" | "watch" | "blocking";
  confidence: "exact" | "high" | "medium" | "low" | "unknown";
  summary: string;
  whyItMatters?: string | null;
  suggestedAction?: string | null;
  sourceDomains: string[];
  evidence: EvidenceRow[];
  affected: Record<string, unknown>;
  actors?: unknown[];
  reasons: string[];
  limitations?: string[];
  warnings?: string[];
  metadata?: Record<string, unknown>;
};

const NOTICE = "FDE readiness intelligence is operational evidence, not Product Brain truth.";
const NO_WRITE_NOTICE = "Read-only: no GitHub writes, deploy actions, auto-merge, Product Brain mutation, Live Doc mutation, or proposal accept/reject.";
const LIVE_MAP_LIMITATION = "Live Working Map is near-real-time evidence from PRs, branches, commits, agent runs, context packs, and manual entries; it is not true IDE live presence.";
const MVP_ALLOWED_PROVIDERS = new Set(["github", "orchestra", "manual", "manual_import", "fireflies_ai", "route_registry"]);
const MVP_HIDDEN_COMMUNICATION_PROVIDERS = new Set(["slack", "slack_webhook", "gmail", "google_gmail", "outlook", "microsoft_outlook", "teams", "microsoft_teams", "whatsapp", "whatsapp_business"]);
const SECRET_PATTERN =
  /\b(gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|mcp_[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|xox[abprs]-[A-Za-z0-9-]{12,}|postgresql:\/\/\S+:\S+@\S+|(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|FIREFLIES_API_KEY|GITHUB_APP_PRIVATE_KEY|GITHUB_APP_WEBHOOK_SECRET|GITHUB_APP_CLIENT_SECRET|JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|CLIENT_SHARE_TOKEN_SECRET|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|DATABASE_URL|PRIVATE_KEY)\s*=\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/gi;

export class FdeReadinessIntelligenceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService
  ) {}

  async refreshAll(projectId: string, actor: Actor) {
    this.assertEnabled();
    return this.runRefresh(projectId, actor, "all", (evidence) => [
      ...this.buildConflictFindings(evidence),
      ...this.buildSafeToTouchSignals(evidence),
      ...this.buildDuplicateFindings(evidence),
      ...this.buildLiveWorkingSignals(evidence)
    ]);
  }

  async refreshConflicts(projectId: string, actor: Actor) {
    this.assertEnabled();
    return this.runRefresh(projectId, actor, "conflict", (evidence) => this.buildConflictFindings(evidence));
  }

  async refreshSafeToTouch(projectId: string, actor: Actor) {
    this.assertEnabled();
    return this.runRefresh(projectId, actor, "safe_to_touch", (evidence) => this.buildSafeToTouchSignals(evidence));
  }

  async refreshDuplicates(projectId: string, actor: Actor) {
    this.assertEnabled();
    return this.runRefresh(projectId, actor, "duplicate_work", (evidence) => this.buildDuplicateFindings(evidence));
  }

  async refreshLiveWorkingMap(projectId: string, actor: Actor) {
    this.assertEnabled();
    return this.runRefresh(projectId, actor, "live_working_signal", (evidence) => this.buildLiveWorkingSignals(evidence));
  }

  async listConflicts(projectId: string, actor: Actor, query: FdeFindingQuery) {
    this.assertEnabled();
    return this.listFindings(projectId, actor, "conflict", query);
  }

  async listSafeToTouch(projectId: string, actor: Actor, query: FdeFindingQuery) {
    this.assertEnabled();
    return this.listFindings(projectId, actor, "safe_to_touch", query);
  }

  async getSafeToTouchForFile(projectId: string, actor: Actor, filePath: string) {
    this.assertEnabled();
    const result = await this.listFindings(projectId, actor, "safe_to_touch", { limit: 25, targetKind: "file", targetRef: filePath });
    if (result.items.length > 0) return { ...result, item: result.items[0] };
    return {
      ...this.baseCollection(projectId, []),
      item: {
        id: null,
        projectId,
        findingType: "safe_to_touch",
        targetKind: "file",
        targetRef: filePath,
        status: "unknown",
        severity: "info",
        confidence: "unknown",
        summary: "Insufficient evidence to mark this file safe.",
        reasons: [],
        limitations: ["No current engineering evidence matched this file path. Do not treat absence of evidence as safe."]
      }
    };
  }

  async listDuplicates(projectId: string, actor: Actor, query: FdeFindingQuery) {
    this.assertEnabled();
    return this.listFindings(projectId, actor, "duplicate_work", query);
  }

  async listLiveWorkingMap(projectId: string, actor: Actor, query: FdeFindingQuery) {
    this.assertEnabled();
    return this.listFindings(projectId, actor, "live_working_signal", query);
  }

  async createRationaleTrace(projectId: string, actor: Actor, input: RationaleTraceInput) {
    this.assertEnabled();
    const project = await this.loadProject(projectId, actor);
    await this.audit("rationale_trace.requested", projectId, actor, { anchorType: input.anchorType, anchorRef: input.anchorRef });
    const [evidence, decisions] = await Promise.all([this.loadEvidence(projectId, actor), this.loadAcceptedDecisions(projectId)]);
    const matching = evidence
      .filter((item) => evidenceMatchesAnchor(item, input.anchorType, input.anchorRef))
      .sort((a, b) => timestamp(a.occurredAt) - timestamp(b.occurredAt))
      .slice(0, 8);
    const decision = decisions.find((row: any) => textIncludes(row.title, input.anchorRef) || textIncludes(row.statement, input.anchorRef));
    const hops = [
      ...matching.map((item, index) => this.evidenceHop(item, index + 1)),
      ...(decision ? [this.decisionHop(decision, matching.length + 1)] : [])
    ].slice(0, 12);
    const status = hops.length > 1 ? "complete" : hops.length === 1 ? "partial" : "low_confidence";
    const overallConfidence = decision ? "exact_link" : hops.length > 0 ? "unverified" : "weak_semantic";
    const trace = await this.prisma.fdeRationaleTrace.create({
      data: {
        orgId: project.orgId,
        projectId,
        anchorType: input.anchorType,
        anchorRef: redact(input.anchorRef),
        status,
        overallConfidence,
        summary: hops.length > 0 ? `Possible rationale trace for ${input.anchorType}:${redact(input.anchorRef)}` : "Insufficient evidence for a confident rationale trace.",
        citationsJson: redactJson(hops.map((hop) => hop.citationJson)),
        openTargetsJson: redactJson(hops.map((hop) => hop.openTargetJson)),
        limitationsJson: traceLimitations(status, overallConfidence),
        warningsJson: [NOTICE, "Weak semantic links are possible related rationale, not confirmed cause."],
        metadataJson: { readOnly: true, truthMutationAllowed: false },
        createdByUserId: actor.userId
      }
    });
    for (const hop of hops) {
      await this.prisma.fdeRationaleTraceHop.create({ data: { ...hop, traceId: trace.id, projectId } });
    }
    await this.audit(status === "low_confidence" ? "rationale_trace.low_confidence" : status === "partial" ? "rationale_trace.partial" : "rationale_trace.created", projectId, actor, { traceId: trace.id, status });
    return this.getRationaleTrace(projectId, trace.id, actor);
  }

  async listRationaleTraces(projectId: string, actor: Actor) {
    this.assertEnabled();
    await this.loadProject(projectId, actor);
    const traces = await this.prisma.fdeRationaleTrace.findMany({ where: { projectId, orgId: actor.orgId, archivedAt: null }, orderBy: { generatedAt: "desc" }, take: 100 });
    return this.baseCollection(projectId, traces.map((trace: any) => this.traceDto(trace, [])));
  }

  async getRationaleTrace(projectId: string, traceId: string, actor: Actor) {
    this.assertEnabled();
    await this.loadProject(projectId, actor);
    const trace = await this.prisma.fdeRationaleTrace.findFirst({
      where: { id: traceId, projectId, orgId: actor.orgId, archivedAt: null },
      include: { hops: { orderBy: { hopOrder: "asc" } } }
    });
    if (!trace) throw new AppError(404, "Rationale trace not found", "rationale_trace_not_found");
    return { ...this.traceDto(trace, trace.hops), readOnly: true, truthMutationAllowed: false };
  }

  async createDecisionEngineeringLink(projectId: string, actor: Actor, input: DecisionEngineeringLinkInput) {
    this.assertEnabled();
    const project = await this.loadProject(projectId, actor);
    const decision = await this.prisma.decisionRecord.findFirst({ where: { id: input.decisionId, projectId, status: "accepted" } });
    if (!decision) throw new AppError(404, "Accepted decision not found", "accepted_decision_not_found");
    if (input.evidenceIds.length > 0) {
      const [engineeringEvidence, githubEvidence] = await Promise.all([
        this.prisma.engineeringEvidenceItem.findMany({
          where: { projectId, id: { in: input.evidenceIds }, archivedAt: null },
          select: { id: true }
        }),
        this.prisma.gitHubEngineeringEvidence.findMany({
          where: { projectId, id: { in: input.evidenceIds }, evidenceStatus: "active" },
          select: { id: true }
        })
      ]);
      const resolvedIds = new Set([...engineeringEvidence, ...githubEvidence].map((item) => item.id));
      const unresolvedIds = input.evidenceIds.filter((id) => !resolvedIds.has(id));
      if (unresolvedIds.length > 0) {
        throw new AppError(400, "Every linked evidence ID must resolve to active evidence in this project", "decision_evidence_invalid");
      }
    }
    const row = await this.prisma.fdeDecisionEngineeringLink.upsert({
      where: {
        projectId_decisionId_targetType_targetRef_relationshipType: {
          projectId,
          decisionId: input.decisionId,
          targetType: input.targetType,
          targetRef: input.targetRef,
          relationshipType: input.relationshipType
        }
      },
      create: {
        orgId: project.orgId,
        projectId,
        decisionId: input.decisionId,
        targetType: input.targetType,
        targetRef: redact(input.targetRef),
        relationshipType: input.relationshipType,
        confidence: input.confidence,
        evidenceIdsJson: redactJson(input.evidenceIds),
        citationsJson: redactJson(input.citations.length ? input.citations : [{ source: "decision_record", decisionId: input.decisionId }]),
        openTargetsJson: redactJson(input.openTargets.length ? input.openTargets : [{ targetType: "decision_record", targetRef: { decisionRecordId: input.decisionId } }]),
        limitationsJson: redactJson(input.limitations.length ? input.limitations : ["Decision engineering links connect existing accepted decisions to engineering evidence; they do not create accepted decisions."]),
        metadataJson: redactJson(input.metadata),
        createdByUserId: actor.userId
      },
      update: {
        confidence: input.confidence,
        evidenceIdsJson: redactJson(input.evidenceIds),
        citationsJson: redactJson(input.citations),
        openTargetsJson: redactJson(input.openTargets),
        limitationsJson: redactJson(input.limitations),
        metadataJson: redactJson(input.metadata),
        archivedAt: null
      }
    });
    await this.audit("decision_engineering_link.created", projectId, actor, { decisionId: input.decisionId, targetType: input.targetType, targetRef: input.targetRef });
    return { ...this.decisionLinkDto(row), readOnly: true, truthMutationAllowed: false };
  }

  async listDecisionEngineeringLinks(projectId: string, actor: Actor) {
    this.assertEnabled();
    await this.loadProject(projectId, actor);
    const rows = await this.prisma.fdeDecisionEngineeringLink.findMany({ where: { projectId, orgId: actor.orgId, archivedAt: null }, orderBy: { updatedAt: "desc" }, take: 200 });
    return this.baseCollection(projectId, rows.map((row: any) => this.decisionLinkDto(row)));
  }

  private async runRefresh(projectId: string, actor: Actor, runType: string, build: (evidence: EvidenceRow[]) => FindingInput[]) {
    const project = await this.loadProject(projectId, actor);
    const run = await this.prisma.fdeReadinessRun.create({ data: { orgId: project.orgId, projectId, startedByUserId: actor.userId, runType, status: "running" } });
    await this.audit(`${auditPrefix(runType)}.refresh_started`, projectId, actor, { runId: run.id, runType });
    try {
      const evidence = await this.loadEvidence(projectId, actor);
      const findings = build(evidence);
      for (const finding of findings) await this.upsertFinding(project, actor, finding);
      const counts = countBy(findings, (finding) => finding.findingType);
      await this.prisma.fdeReadinessRun.update({ where: { id: run.id }, data: { status: "completed", finishedAt: new Date(), countsJson: counts } });
      await this.audit(`${auditPrefix(runType)}.refresh_completed`, projectId, actor, { runId: run.id, counts });
      return { projectId, runId: run.id, status: "completed", counts, ...this.baseFlags() };
    } catch (error) {
      const message = error instanceof Error ? error.message : "FDE readiness refresh failed";
      await this.prisma.fdeReadinessRun.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date(), errorsJson: [{ message: message.slice(0, 500) }] } });
      await this.audit(`${auditPrefix(runType)}.refresh_failed`, projectId, actor, { runId: run.id, error: message.slice(0, 200) });
      throw new AppError(500, "FDE readiness refresh failed", "fde_readiness_refresh_failed");
    }
  }

  private buildConflictFindings(evidence: EvidenceRow[]): FindingInput[] {
    const findings: FindingInput[] = [];
    for (const [file, rows] of groupBy(evidence.filter((row) => row.filePath), (row) => row.filePath ?? "")) {
      const prNumbers = unique(rows.map((row) => row.pullRequestNumber).filter(Boolean).map(String));
      const branches = unique(rows.map((row) => row.branch).filter(Boolean).map(String));
      const hasAgent = rows.some((row) => row.sourceType === "agent_activity" || row.provider === "orchestra");
      const hasPr = prNumbers.length > 0;
      if (prNumbers.length > 1 || branches.length > 1) {
        findings.push(this.finding("conflict", "overlapping_edit", `conflict:file:${file}`, "file", file, prNumbers.length > 1 ? "blocking" : "watch", "high", `Multiple active branches/PRs touch ${file}.`, "Concurrent edits can create merge conflicts or duplicated implementation.", "Inspect open PRs and coordinate before editing.", rows, { files: [file], pullRequests: prNumbers, branches }));
      }
      if (hasAgent && hasPr) {
        findings.push(this.finding("conflict", "agent_overlap", `conflict:agent-pr:${file}`, "file", file, "watch", "medium", `Agent and PR activity overlap on ${file}.`, "Agent output is implementation evidence and may be unreviewed.", "Review agent run and PR context before editing.", rows, { files: [file], pullRequests: prNumbers, branches }));
      }
      if (rows.some((row) => /todo|fixme|blocked|drift/i.test(`${row.title ?? ""} ${row.summary ?? ""}`))) {
        findings.push(this.finding("conflict", "drift", `conflict:todo:${file}`, "file", file, "watch", "medium", `Known TODO/FIXME or drift signal affects ${file}.`, "Known unresolved implementation notes can invalidate assumptions.", "Open TODO/FIXME evidence before editing.", rows, { files: [file] }));
      }
    }
    for (const [route, rows] of groupBy(evidence.filter((row) => row.routePath), (row) => `${row.routeMethod ?? "GET"} ${row.routePath}`)) {
      if (rows.length > 1) {
        findings.push(this.finding("conflict", "route_collision", `conflict:route:${route}`, "route", route, "watch", "medium", `Multiple evidence records target route ${route}.`, "Repeated route evidence may indicate duplicate work or stale seams.", "Compare route/schema evidence before changing this endpoint.", rows, { routes: [route] }));
      }
    }
    return findings;
  }

  private buildSafeToTouchSignals(evidence: EvidenceRow[]): FindingInput[] {
    const conflicts = this.buildConflictFindings(evidence);
    const byTarget = new Map<string, FindingInput[]>();
    for (const conflict of conflicts) byTarget.set(`${conflict.targetKind}:${conflict.targetRef}`, [...(byTarget.get(`${conflict.targetKind}:${conflict.targetRef}`) ?? []), conflict]);
    const targets = [...new Set(evidence.flatMap((row) => [row.filePath ? `file:${row.filePath}` : null, row.routePath ? `route:${row.routeMethod ?? "GET"} ${row.routePath}` : null]).filter(Boolean) as string[])];
    return targets.map((target) => {
      const [targetKind, ...rest] = target.split(":");
      const targetRef = rest.join(":");
      const rows = evidence.filter((row) => row.filePath === targetRef || `${row.routeMethod ?? "GET"} ${row.routePath}` === targetRef);
      const targetConflicts = byTarget.get(target) ?? [];
      const hasBlocking = targetConflicts.some((conflict) => conflict.severity === "blocking");
      const hasWarning = targetConflicts.length > 0 || rows.some((row) => /todo|fixme|mock|partial|assumed|failed|stale|drift/i.test(`${row.status} ${row.title ?? ""} ${row.summary ?? ""}`));
      const status = hasBlocking ? "red" : hasWarning ? "yellow" : rows.length >= 1 ? "green" : "unknown";
      return this.finding(
        "safe_to_touch",
        status,
        `safe:${target}`,
        targetKind,
        targetRef,
        hasBlocking ? "blocking" : hasWarning ? "watch" : "info",
        rows.length ? "medium" : "unknown",
        `${targetRef} is ${status === "green" ? "safe enough to inspect/edit" : status === "red" ? "not safe to touch until blockers are resolved" : status === "yellow" ? "inspect-first before editing" : "unknown"}.`,
        "Safe-to-touch is an operational warning based on current evidence, not a write lock.",
        status === "green" ? "Proceed with normal review and tests." : "Open the linked evidence and resolve warnings before editing.",
        rows,
        { targetKind, targetRef, status, blockingReasons: targetConflicts.filter((item) => item.severity === "blocking").map((item) => item.summary), warnings: targetConflicts.map((item) => item.summary) },
        targetConflicts.map((item) => item.summary),
        status === "unknown" ? ["Insufficient evidence; do not treat unknown as safe."] : []
      );
    });
  }

  private buildDuplicateFindings(evidence: EvidenceRow[]): FindingInput[] {
    const findings: FindingInput[] = [];
    for (const [file, rows] of groupBy(evidence.filter((row) => row.filePath), (row) => row.filePath ?? "")) {
      if (rows.length > 1) findings.push(this.finding("duplicate_work", "file_overlap", `duplicate:file:${file}`, "file", file, "watch", "medium", `Multiple work items reference ${file}.`, "File overlap can indicate duplicated work or coordination risk.", "Compare PRs, agent runs, and context before duplicating work.", rows, { files: [file] }));
    }
    for (const [route, rows] of groupBy(evidence.filter((row) => row.routePath), (row) => `${row.routeMethod ?? "GET"} ${row.routePath}`)) {
      if (rows.length > 1) findings.push(this.finding("duplicate_work", "same_api_route", `duplicate:route:${route}`, "route", route, "watch", "medium", `Multiple work items target ${route}.`, "Same-route overlap can duplicate backend/frontend contract work.", "Confirm one owner and one accepted route contract.", rows, { routes: [route] }));
    }
    return findings;
  }

  private buildLiveWorkingSignals(evidence: EvidenceRow[]): FindingInput[] {
    return evidence
      .filter((row) => row.filePath || row.routePath || row.branch || row.pullRequestNumber)
      .slice(0, 200)
      .map((row) => {
        const targetRef = row.filePath ?? row.routePath ?? row.branch ?? `PR #${row.pullRequestNumber}`;
        const targetKind = row.filePath ? "file" : row.routePath ? "route" : row.branch ? "branch" : "pull_request";
        return this.finding("live_working_signal", row.sourceSubType, `live:${row.id}`, targetKind, targetRef, "info", row.confidence === "low" ? "low" : "medium", `${row.actorGithubLogin ?? row.provider} activity observed on ${targetRef}.`, LIVE_MAP_LIMITATION, "Use this as a freshness signal, not true editor presence.", [row], { targetKind, targetRef, branch: row.branch, pullRequestNumber: row.pullRequestNumber, sha: row.sha, freshness: freshness(row.occurredAt) }, [], [LIVE_MAP_LIMITATION]);
      });
  }

  private finding(
    findingType: FindingType,
    findingSubType: string,
    findingKey: string,
    targetKind: string | null,
    targetRef: string | null,
    severity: "info" | "watch" | "blocking",
    confidence: "exact" | "high" | "medium" | "low" | "unknown",
    summary: string,
    whyItMatters: string,
    suggestedAction: string,
    evidence: EvidenceRow[],
    affected: Record<string, unknown>,
    reasons: string[] = [],
    limitations: string[] = []
  ): FindingInput {
    return {
      findingType,
      findingSubType,
      findingKey,
      targetKind,
      targetRef,
      severity,
      confidence,
      summary,
      whyItMatters,
      suggestedAction,
      sourceDomains: unique(evidence.map((row) => row.sourceType)),
      evidence,
      affected,
      actors: unique(evidence.map((row) => row.actorGithubLogin ?? row.mappedUserId).filter(Boolean).map(String)),
      reasons,
      limitations
    };
  }

  private async upsertFinding(project: { id: string; orgId: string }, actor: Actor, finding: FindingInput) {
    const data = {
      orgId: project.orgId,
      projectId: project.id,
      findingType: finding.findingType,
      findingSubType: finding.findingSubType,
      findingKey: finding.findingKey,
      targetKind: finding.targetKind ?? null,
      targetRef: finding.targetRef ? redact(finding.targetRef) : null,
      status: finding.status ?? "active",
      severity: finding.severity,
      confidence: finding.confidence,
      summary: redact(finding.summary),
      whyItMatters: finding.whyItMatters ? redact(finding.whyItMatters) : null,
      suggestedAction: finding.suggestedAction ? redact(finding.suggestedAction) : null,
      sourceDomainsJson: redactJson(finding.sourceDomains),
      evidenceIdsJson: redactJson(finding.evidence.map((row) => row.id)),
      affectedJson: redactJson(finding.affected),
      actorsJson: redactJson(finding.actors ?? []),
      citationsJson: redactJson(collectCitations(finding.evidence)),
      openTargetsJson: redactJson(collectOpenTargets(finding.evidence)),
      reasonsJson: redactJson(finding.reasons),
      limitationsJson: redactJson(finding.limitations ?? []),
      warningsJson: redactJson([NOTICE, NO_WRITE_NOTICE, ...(finding.warnings ?? [])]),
      metadataJson: redactJson(finding.metadata ?? {}),
      createdByUserId: actor.userId,
      archivedAt: null,
      dismissedAt: null
    };
    const row = await this.prisma.fdeReadinessFinding.upsert({
      where: { projectId_findingKey: { projectId: project.id, findingKey: finding.findingKey } },
      create: data,
      update: data
    });
    if (finding.findingType === "conflict") await this.audit("conflict_radar.finding_created", project.id, actor, { findingId: row.id, findingSubType: finding.findingSubType, severity: finding.severity });
    if (finding.findingType === "safe_to_touch") await this.audit("safe_to_touch.signal_created", project.id, actor, { findingId: row.id, targetKind: finding.targetKind, targetRef: finding.targetRef });
    if (finding.findingType === "duplicate_work") await this.audit("duplicate_work.finding_created", project.id, actor, { findingId: row.id, findingSubType: finding.findingSubType });
    if (finding.findingType === "live_working_signal") await this.audit("live_working_map.signal_created", project.id, actor, { findingId: row.id, targetKind: finding.targetKind });
    return row;
  }

  private async listFindings(projectId: string, actor: Actor, findingType: FindingType, query: FdeFindingQuery) {
    await this.loadProject(projectId, actor);
    const where: Prisma.FdeReadinessFindingWhereInput = {
      orgId: actor.orgId,
      projectId,
      findingType,
      archivedAt: null,
      dismissedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.targetKind ? { targetKind: query.targetKind } : {}),
      ...(query.targetRef ? { targetRef: query.targetRef } : {})
    };
    const rows = await this.prisma.fdeReadinessFinding.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: Math.min(query.limit * 5, 1000)
    });
    const sortedRows = rows
      .sort((a: any, b: any) => severityRank(b.severity) - severityRank(a.severity) || timestamp(b.updatedAt) - timestamp(a.updatedAt))
      .slice(0, query.limit);
    return this.baseCollection(projectId, sortedRows.map((row: any) => this.findingDto(row)));
  }

  private async loadProject(projectId: string, actor: Actor) {
    await this.projectService.ensureProjectAccess(projectId, actor.userId);
    return this.prisma.project.findFirstOrThrow({ where: { id: projectId, orgId: actor.orgId }, select: { id: true, orgId: true } });
  }

  private async loadEvidence(projectId: string, actor: Actor): Promise<EvidenceRow[]> {
    await this.projectService.ensureProjectAccess(projectId, actor.userId);
    const rows = (await this.prisma.engineeringEvidenceItem.findMany({
      where: { projectId, orgId: actor.orgId, archivedAt: null },
      orderBy: [{ occurredAt: "desc" }, { updatedAt: "desc" }],
      take: this.env.FDE_READINESS_MAX_EVIDENCE_ITEMS
    })) as unknown as EvidenceRow[];
    if (!this.env.MVP_MODE) return rows;
    const filtered = rows.filter((row) => isMvpVisibleProvider(row));
    if (filtered.length !== rows.length) {
      await this.audit("readiness_intelligence.disabled_provider_evidence_excluded", projectId, actor, {
        excludedCount: rows.length - filtered.length
      });
    }
    return filtered;
  }

  private async loadAcceptedDecisions(projectId: string) {
    return this.prisma.decisionRecord.findMany({ where: { projectId, status: "accepted" }, orderBy: { acceptedAt: "desc" }, take: 50 });
  }

  private evidenceHop(row: EvidenceRow, hopOrder: number) {
    return {
      hopOrder,
      hopType: hopTypeForEvidence(row),
      sourceType: row.sourceType,
      sourceRef: row.id,
      title: redact(row.title ?? `${row.sourceSubType} evidence`),
      excerpt: row.summary ? redact(row.summary).slice(0, 1000) : null,
      actor: row.actorGithubLogin ?? row.mappedUserId ?? row.provider,
      occurredAt: row.occurredAt,
      confidence: row.sourceUrl || row.providerRawId ? "exact_link" : "unverified",
      citationJson: redactJson(row.citationJson ?? { source: row.sourceType, evidenceId: row.id }),
      openTargetJson: redactJson(row.openTargetJson ?? { targetType: "engineering_evidence", targetRef: { evidenceId: row.id } }),
      inclusionReason: "Matched requested rationale anchor through engineering evidence.",
      orderingReason: "Ordered by observed evidence timestamp where available.",
      limitationsJson: redactJson(["Evidence hop does not mutate or create accepted truth."])
    };
  }

  private decisionHop(decision: any, hopOrder: number) {
    return {
      hopOrder,
      hopType: "decision",
      sourceType: "decision_record",
      sourceRef: decision.id,
      title: redact(decision.title),
      excerpt: redact(decision.statement ?? decision.sourceSummary ?? "").slice(0, 1000),
      actor: decision.acceptedBy,
      occurredAt: decision.acceptedAt,
      confidence: "exact_link",
      citationJson: redactJson({ source: "accepted_decision", decisionRecordId: decision.id }),
      openTargetJson: redactJson({ targetType: "decision_record", targetRef: { decisionRecordId: decision.id } }),
      inclusionReason: "Accepted decision text matched the requested anchor.",
      orderingReason: "Accepted decisions are truth-layer hops and are placed after implementation evidence.",
      limitationsJson: redactJson(["Only existing accepted decisions are treated as decision truth."])
    };
  }

  private findingDto(row: any) {
    return {
      id: row.id,
      projectId: row.projectId,
      findingType: row.findingType,
      findingSubType: row.findingSubType,
      targetKind: row.targetKind,
      targetRef: row.targetRef,
      status: row.status,
      severity: row.severity,
      confidence: row.confidence,
      summary: row.summary,
      whyItMatters: row.whyItMatters,
      suggestedAction: row.suggestedAction,
      sourceDomains: row.sourceDomainsJson,
      evidenceIds: row.evidenceIdsJson,
      affected: row.affectedJson,
      actors: row.actorsJson,
      citations: row.citationsJson,
      openTargets: row.openTargetsJson,
      reasons: row.reasonsJson,
      limitations: row.limitationsJson,
      warnings: row.warningsJson,
      updatedAt: row.updatedAt?.toISOString?.() ?? null,
      notice: NOTICE
    };
  }

  private traceDto(trace: any, hops: any[]) {
    return {
      id: trace.id,
      projectId: trace.projectId,
      anchorType: trace.anchorType,
      anchorRef: trace.anchorRef,
      status: trace.status,
      overallConfidence: trace.overallConfidence,
      summary: trace.summary,
      hops: hops.map((hop) => ({
        id: hop.id,
        hopOrder: hop.hopOrder,
        hopType: hop.hopType,
        sourceType: hop.sourceType,
        sourceRef: hop.sourceRef,
        title: hop.title,
        excerpt: hop.excerpt,
        actor: hop.actor,
        occurredAt: hop.occurredAt?.toISOString?.() ?? null,
        confidence: hop.confidence,
        citation: hop.citationJson,
        openTarget: hop.openTargetJson,
        inclusionReason: hop.inclusionReason,
        orderingReason: hop.orderingReason,
        limitations: hop.limitationsJson
      })),
      citations: trace.citationsJson,
      openTargets: trace.openTargetsJson,
      limitations: trace.limitationsJson,
      warnings: trace.warningsJson,
      notice: NOTICE
    };
  }

  private decisionLinkDto(row: any) {
    return {
      id: row.id,
      projectId: row.projectId,
      decisionId: row.decisionId,
      targetType: row.targetType,
      targetRef: row.targetRef,
      relationshipType: row.relationshipType,
      confidence: row.confidence,
      evidenceIds: row.evidenceIdsJson,
      citations: row.citationsJson,
      openTargets: row.openTargetsJson,
      limitations: row.limitationsJson,
      createdAt: row.createdAt?.toISOString?.() ?? null,
      notice: "Decision engineering links connect existing accepted decisions to engineering evidence; they do not create accepted decisions."
    };
  }

  private baseCollection(projectId: string, items: unknown[]) {
    return { projectId, generatedAt: new Date().toISOString(), items, evidenceCount: items.length, warnings: [NOTICE, NO_WRITE_NOTICE], limitations: ["Part 3 prepares readiness intelligence; it is not the final full FDE dashboard replacement."], ...this.baseFlags() };
  }

  private baseFlags() {
    return { readOnly: true, truthMutationAllowed: false, githubWritesAllowed: false, autoMergeAllowed: false };
  }

  private assertEnabled() {
    if (!this.env.FDE_READINESS_INTELLIGENCE_ENABLED) {
      throw new AppError(403, "FDE readiness intelligence is disabled", "fde_readiness_disabled");
    }
  }

  private async audit(eventType: string, projectId: string, actor: Actor, payload: Record<string, unknown>) {
    await this.auditService.record({ orgId: actor.orgId, projectId, actorUserId: actor.userId, eventType, entityType: "fde_readiness", payload: redactJson(payload) as Record<string, unknown> });
  }
}

function collectCitations(evidence: EvidenceRow[]) {
  return evidence.map((row) => (hasJsonContent(row.citationJson) ? row.citationJson : { source: row.sourceType, evidenceId: row.id })).slice(0, 50);
}

function collectOpenTargets(evidence: EvidenceRow[]) {
  return evidence.map((row) => (hasJsonContent(row.openTargetJson) ? row.openTargetJson : { targetType: "engineering_evidence", targetRef: { evidenceId: row.id } })).slice(0, 50);
}

function evidenceMatchesAnchor(row: EvidenceRow, anchorType: string, anchorRef: string) {
  const value = anchorRef.toLowerCase();
  if (anchorType === "file" || anchorType === "module") return String(row.filePath ?? "").toLowerCase().includes(value);
  if (anchorType === "route" || anchorType === "api") return `${row.routeMethod ?? ""} ${row.routePath ?? ""}`.toLowerCase().includes(value);
  if (anchorType === "pr") return String(row.pullRequestNumber ?? row.sourceUrl ?? "").toLowerCase().includes(value.replace(/^#/, ""));
  if (anchorType === "branch") return String(row.branch ?? "").toLowerCase().includes(value);
  return `${row.title ?? ""} ${row.summary ?? ""} ${row.providerRawId ?? ""}`.toLowerCase().includes(value);
}

function isMvpVisibleProvider(row: EvidenceRow) {
  const provider = row.provider.toLowerCase();
  const sourceType = row.sourceType.toLowerCase();
  if (MVP_HIDDEN_COMMUNICATION_PROVIDERS.has(provider) || MVP_HIDDEN_COMMUNICATION_PROVIDERS.has(sourceType)) {
    return false;
  }
  return (
    MVP_ALLOWED_PROVIDERS.has(provider) ||
    MVP_ALLOWED_PROVIDERS.has(sourceType) ||
    sourceType === "github" ||
    sourceType === "agent_activity"
  );
}

function hopTypeForEvidence(row: EvidenceRow) {
  if (row.sourceSubType.includes("commit")) return "commit";
  if (row.sourceSubType.includes("pull_request")) return "pull_request";
  if (row.sourceSubType.includes("review")) return "review_comment";
  if (row.sourceType === "agent_activity") return "agent_run";
  if (row.sourceSubType.includes("route")) return "code";
  return "code";
}

function traceLimitations(status: string, confidence: string) {
  const base = ["Rationale traces are provenance aids and do not mutate decisions or Product Brain truth."];
  if (status !== "complete" || confidence === "weak_semantic") base.push("Trace is partial or low confidence; treat it as possible related rationale.");
  return base;
}

function auditPrefix(runType: string) {
  if (runType === "all") return "fde_readiness";
  if (runType === "conflict") return "conflict_radar";
  if (runType === "safe_to_touch") return "safe_to_touch";
  if (runType === "duplicate_work") return "duplicate_work";
  if (runType === "live_working_signal") return "live_working_map";
  return "fde_readiness";
}

function groupBy<T>(items: T[], keyFn: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

function countBy<T>(items: T[], keyFn: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function textIncludes(text: unknown, needle: string) {
  return String(text ?? "").toLowerCase().includes(needle.toLowerCase());
}

function freshness(date: Date | null) {
  if (!date) return "unknown";
  const ageMs = Date.now() - date.getTime();
  if (ageMs < 1000 * 60 * 60 * 24) return "fresh";
  if (ageMs < 1000 * 60 * 60 * 24 * 14) return "recent";
  return "stale";
}

function timestamp(date: Date | null) {
  return date ? date.getTime() : 0;
}

function severityRank(severity: string | null | undefined) {
  if (severity === "blocking") return 3;
  if (severity === "watch") return 2;
  if (severity === "info") return 1;
  return 0;
}

function redact(value: string) {
  return value.replace(SECRET_PATTERN, "[redacted]").slice(0, 4000);
}

function redactJson(value: unknown): Prisma.InputJsonValue {
  return redactJsonValue(value) as Prisma.InputJsonValue;
}

function redactJsonValue(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "string") return redact(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => redactJsonValue(item));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, nested]) => nested !== undefined).map(([key, nested]) => [key, redactJsonValue(nested)]));
  return redact(String(value));
}

function hasJsonContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return false;
}
