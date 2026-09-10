import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import type { AppEnv } from "../../config/env.js";
import { AuditService } from "../audit/service.js";
import { ProjectService } from "../projects/service.js";
import { redactAgentContextText, validateAgentContextCitation, validateAgentContextOpenTarget } from "./citations.js";
import type { CreateQualityReviewInput, ListQualityReviewsQuery, ListReviewFindingsQuery } from "./schemas.js";

type FindingSeverity = "info" | "low" | "medium" | "high" | "critical";
type FindingConfidence = "low" | "medium" | "high";
type ReviewType = "context_pack_quality" | "agent_run_review";
type ScoreLabel = "excellent" | "good" | "usable_with_warnings" | "needs_improvement" | "unsafe_or_blocked";
type Recommendation =
  | "looks_aligned"
  | "aligned_with_warnings"
  | "needs_human_review"
  | "needs_follow_up"
  | "possible_drift"
  | "blocked_by_missing_evidence"
  | "unsafe_or_noncompliant";

type ReviewFinding = {
  type: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  summary: string;
  evidenceReferences: Array<Record<string, unknown>>;
  affectedSurface: string;
  whyItMatters: string;
  recommendedHumanAction: string;
};

type BuiltReview = {
  project: { id: string; orgId: string };
  reviewType: ReviewType;
  contextPackId: string | null;
  agentRunId: string | null;
  exportRefJson: unknown | null;
  status: "completed" | "completed_with_warnings";
  overallScore: number;
  scoreLabel: ScoreLabel;
  recommendation: Recommendation;
  readinessToExport: boolean | null;
  needsFollowUp: boolean;
  summary: string;
  inputSummary: string;
  scores: Record<string, number>;
  findings: ReviewFinding[];
  matchedRequirements: string[];
  missingRequirements: string[];
  hallucinatedAssumptions: string[];
  driftFindings: string[];
  riskFindings: string[];
  testGaps: string[];
  docsGaps: string[];
  openQuestions: string[];
  carryForwardNotes: string[];
  citations: unknown[];
  openTargets: unknown[];
  limitations: string[];
  warnings: string[];
  fallbackMetadata: Record<string, unknown>;
};

const DEFAULT_MVP_COMMUNICATION_PROVIDERS = ["manual_import", "fireflies_ai", "slack", "clickup", "granola", "microsoft_teams"];
const HIDDEN_MVP_PROVIDERS = new Set(["gmail", "google_gmail", "outlook", "whatsapp", "whatsapp_business"]);
const TRUTH_MODEL_WARNING =
  "Step 5 review reports are evidence and review aids, not accepted Product Brain truth. They do not mutate Product Brain, Live Doc, proposals, accepted decisions, or source evidence.";

export class AgentQualityDriftService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService
  ) {}

  async createContextPackQualityReport(projectId: string, packId: string, actorUserId: string, input: CreateQualityReviewInput) {
    await this.ensureAccess(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    const pack = await this.loadContextPack(projectId, packId);
    const sources = await (this.prisma as any).agentContextPackSource.findMany({ where: { projectId, packId }, orderBy: { sortOrder: "asc" } });
    const built = this.buildContextPackReview(project, pack, sources, input);
    const review = await this.persistReview(actorUserId, built);
    await this.audit(project.orgId, projectId, actorUserId, "agent_context_pack_quality_report_created", review.id, {
      contextPackId: packId,
      scoreLabel: review.scoreLabel,
      recommendation: review.recommendation,
      warningCount: review.warnings.length
    });
    return review;
  }

  async refreshContextPackQualityReport(projectId: string, packId: string, actorUserId: string, input: CreateQualityReviewInput) {
    const review = await this.createContextPackQualityReport(projectId, packId, actorUserId, { ...input, forceRefresh: true });
    await this.audit(review.orgId, projectId, actorUserId, "agent_context_pack_quality_report_refreshed", review.id, {
      contextPackId: packId,
      scoreLabel: review.scoreLabel
    });
    return review;
  }

  async createAgentRunReview(projectId: string, runId: string, actorUserId: string, input: CreateQualityReviewInput) {
    await this.ensureAccess(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    const run = await this.loadAgentRun(projectId, runId);
    const pack = run.contextPackId ? await this.loadContextPack(projectId, run.contextPackId) : null;
    const sources = pack ? await (this.prisma as any).agentContextPackSource.findMany({ where: { projectId, packId: pack.id }, orderBy: { sortOrder: "asc" } }) : [];
    const productBrain = await this.loadProductBrainEvidence(projectId);
    const built = this.buildAgentRunReview(project, run, pack, sources, productBrain, input);
    const review = await this.persistReview(actorUserId, built);
    await this.audit(project.orgId, projectId, actorUserId, "agent_run_review_created", review.id, {
      agentRunId: runId,
      contextPackId: run.contextPackId,
      scoreLabel: review.scoreLabel,
      recommendation: review.recommendation,
      warningCount: review.warnings.length
    });
    return review;
  }

  async refreshAgentRunReview(projectId: string, runId: string, actorUserId: string, input: CreateQualityReviewInput) {
    const review = await this.createAgentRunReview(projectId, runId, actorUserId, { ...input, forceRefresh: true });
    await this.audit(review.orgId, projectId, actorUserId, "agent_run_review_refreshed", review.id, {
      agentRunId: runId,
      scoreLabel: review.scoreLabel
    });
    return review;
  }

  async listContextPackQualityReports(projectId: string, packId: string, actorUserId: string, query: ListQualityReviewsQuery) {
    await this.ensureAccess(projectId, actorUserId);
    await this.loadContextPack(projectId, packId);
    return this.listReviews(projectId, { ...query, reviewType: "context_pack_quality" }, { contextPackId: packId });
  }

  async getLatestContextPackQualityReport(projectId: string, packId: string, actorUserId: string) {
    await this.ensureAccess(projectId, actorUserId);
    await this.loadContextPack(projectId, packId);
    const review = await (this.prisma as any).agentQualityReview.findFirst({
      where: { projectId, contextPackId: packId, reviewType: "context_pack_quality", deletedAt: null, archivedAt: null },
      orderBy: { createdAt: "desc" }
    });
    if (!review) throw new AppError(404, "Context pack quality report not found", "agent_quality_review_not_found");
    return this.toDto(review);
  }

  async listAgentRunReviews(projectId: string, runId: string, actorUserId: string, query: ListQualityReviewsQuery) {
    await this.ensureAccess(projectId, actorUserId);
    await this.loadAgentRun(projectId, runId);
    return this.listReviews(projectId, { ...query, reviewType: "agent_run_review" }, { agentRunId: runId });
  }

  async getLatestAgentRunReview(projectId: string, runId: string, actorUserId: string) {
    await this.ensureAccess(projectId, actorUserId);
    await this.loadAgentRun(projectId, runId);
    const review = await (this.prisma as any).agentQualityReview.findFirst({
      where: { projectId, agentRunId: runId, reviewType: "agent_run_review", deletedAt: null, archivedAt: null },
      orderBy: { createdAt: "desc" }
    });
    if (!review) throw new AppError(404, "Agent run review not found", "agent_quality_review_not_found");
    return this.toDto(review);
  }

  async getReview(projectId: string, reviewId: string, actorUserId: string) {
    await this.ensureAccess(projectId, actorUserId);
    const review = await this.loadReview(projectId, reviewId);
    return this.toDto(review);
  }

  async listReviewFindings(projectId: string, reviewId: string, actorUserId: string, query: ListReviewFindingsQuery) {
    const review = await this.getReview(projectId, reviewId, actorUserId);
    const findings = review.findings.filter((finding: ReviewFinding) => {
      if (query.severity && finding.severity !== query.severity) return false;
      if (query.type && finding.type !== query.type) return false;
      if (!query.includeLowConfidence && finding.confidence === "low") return false;
      return true;
    });
    return { items: findings, meta: { totalCount: findings.length } };
  }

  async archiveReview(projectId: string, reviewId: string, actorUserId: string) {
    await this.ensureAccess(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    await this.loadReview(projectId, reviewId);
    const updated = await (this.prisma as any).agentQualityReview.update({
      where: { id: reviewId },
      data: { status: "archived", archivedByUserId: actorUserId, archivedAt: new Date() }
    });
    await this.audit(project.orgId, projectId, actorUserId, "agent_quality_review_archived", reviewId, { reviewId });
    return this.toDto(updated);
  }

  async getProjectReviewPressure(projectId: string, actorUserId: string) {
    await this.ensureAccess(projectId, actorUserId);
    const where = { projectId, deletedAt: null, archivedAt: null };
    const [recent, possibleDriftCount, needsFollowUpCount, highSeverityCount, lowQualityContextPackCount, findingRows] = await Promise.all([
      (this.prisma as any).agentQualityReview.findMany({ where, orderBy: { createdAt: "desc" }, take: 5 }),
      (this.prisma as any).agentQualityReview.count({ where: { ...where, recommendation: { in: ["possible_drift", "unsafe_or_noncompliant"] } } }),
      (this.prisma as any).agentQualityReview.count({ where: { ...where, needsFollowUp: true } }),
      (this.prisma as any).agentQualityReview.count({ where: { ...where, highSeverityFindingCount: { gt: 0 } } }),
      (this.prisma as any).agentQualityReview.count({ where: { ...where, reviewType: "context_pack_quality", scoreLabel: { in: ["needs_improvement", "unsafe_or_blocked"] } } }),
      (this.prisma as any).agentQualityReview.findMany({ where, select: { findingsJson: true }, orderBy: { createdAt: "desc" }, take: 100 })
    ]);
    const findingPressure = countFindingPressure(findingRows);
    return {
      recent: recent.map((review: any) => this.toListDto(review)),
      possibleDriftCount,
      needsFollowUpCount,
      highSeverityCount,
      lowQualityContextPackCount,
      mvpModeViolationCount: findingPressure.mvpModeViolationCount,
      testGapCount: findingPressure.testGapCount,
      docsGapCount: findingPressure.docsGapCount,
      quickLink: `/projects/${projectId}/agent-quality-reviews`,
      truthModel: TRUTH_MODEL_WARNING
    };
  }

  private async listReviews(projectId: string, query: ListQualityReviewsQuery, extraWhere: Record<string, unknown>) {
    const page = query.page;
    const pageSize = query.pageSize;
    const where: Record<string, unknown> = {
      projectId,
      deletedAt: null,
      ...(query.includeArchived ? {} : { archivedAt: null }),
      ...extraWhere,
      ...(query.status ? { status: query.status } : {}),
      ...(query.reviewType ? { reviewType: query.reviewType } : {}),
      ...(query.scoreLabel ? { scoreLabel: query.scoreLabel } : {}),
      ...(query.needsFollowUp !== undefined ? { needsFollowUp: query.needsFollowUp } : {})
    };
    const [items, totalCount] = await Promise.all([
      (this.prisma as any).agentQualityReview.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      (this.prisma as any).agentQualityReview.count({ where })
    ]);
    return {
      items: items.map((review: any) => this.toListDto(review)),
      meta: { page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize), hasMore: page * pageSize < totalCount }
    };
  }

  private buildContextPackReview(project: { id: string; orgId: string }, pack: any, sources: any[], input: CreateQualityReviewInput): BuiltReview {
    const findings: ReviewFinding[] = [];
    const warnings = [...toStringArray(pack.warningsJson)];
    const limitations = [...toStringArray(pack.limitationsJson), TRUTH_MODEL_WARNING, "Quality scoring is deterministic and conservative; it does not prove implementation correctness."];
    const sections = normalizeSections(pack.sectionsJson);
    const hasLimitations = sections.limitations.length > 0 || toStringArray(pack.limitationsJson).length > 0;
    const enabledProviders = this.getEnabledMvpProviders();

    if (pack.sourceCount <= 0 || pack.evidenceCount <= 0 || sources.length === 0) {
      findings.push(finding("missing_evidence", "high", "high", "Context pack has no source evidence.", "context_pack", "External agents need cited evidence to stay grounded.", "Regenerate the pack with relevant project sources."));
    }
    if (sections.mission.length === 0) {
      findings.push(finding("missing_requirement", "medium", "high", "Context pack does not contain a clear mission.", "context_pack", "The agent may infer a task instead of following a scoped objective.", "Regenerate the pack with a task objective."));
    }
    if (sections.currentAcceptedTruth.length === 0) {
      findings.push(finding("missing_requirement", "high", "high", "Context pack lacks current accepted truth.", "product_brain", "Agents need accepted truth separated from evidence and pending suggestions.", "Refresh the Product Brain context before exporting."));
    }
    if (sections.implementationConstraints.length === 0) {
      findings.push(finding("missing_requirement", "medium", "medium", "Implementation constraints are missing or thin.", "implementation_constraints", "Missing constraints increase unsupported scope expansion risk.", "Add coding constraints or implementation surfaces."));
    }
    if (sections.acceptanceChecklist.length === 0) {
      findings.push(finding("missing_requirement", "medium", "medium", "Acceptance checklist is missing.", "acceptance_checklist", "Reviewers cannot quickly compare output to expected work.", "Add acceptance criteria before sending to an agent."));
    }
    if (!hasLimitations) {
      findings.push(finding("limitations_quality", "high", "high", "Context pack limitations are empty.", "limitations", "Limitations must be visible even when context is compact.", "Regenerate with explicit limitations and unresolved evidence gaps."));
    }
    if (pack.citationCount <= 0 || sources.some((source) => !validateAgentContextCitation(source.citationJson).valid)) {
      findings.push(finding("invalid_citation", "high", "high", "One or more evidence sources lack valid citations.", "citations", "Citations are required to preserve provenance.", "Repair or regenerate citations before export."));
    }
    if (pack.openTargetCount <= 0 || sources.some((source) => !validateAgentContextOpenTarget(source.openTargetJson).valid)) {
      findings.push(finding("invalid_open_target", "medium", "high", "One or more evidence sources lack safe open targets.", "open_targets", "Open targets let humans inspect source evidence without guessing.", "Repair open targets or mark unavailable explicitly."));
    }
    if (pack.maxTokenBudget && pack.tokenEstimate > pack.maxTokenBudget) {
      findings.push(finding("token_budget", "high", "high", "Context pack exceeds its configured token budget.", "token_budget", "Over-budget packs are likely to be truncated by external agents.", "Use compact mode, narrow scope, or increase budget."));
    }
    if (pack.tokenEstimate > 50000) {
      findings.push(finding("token_budget", "medium", "medium", "Context pack is very large.", "token_budget", "Very broad packs reduce task focus.", "Narrow the pack around the current task."));
    }
    for (const source of sources) {
      const provider = normalizeProvider(source.provider);
      if (enabledProviders && provider && (HIDDEN_MVP_PROVIDERS.has(provider) || !enabledProviders.has(provider))) {
        findings.push(finding("disabled_provider", "high", "high", `MVP-disabled provider evidence is present: ${provider}.`, "mvp_provider_gating", "MVP exports and MCP must not leak disabled provider evidence.", "Regenerate the pack with MVP provider filtering enabled.", sourceRef(source)));
      }
      const text = [source.excerpt, source.summary, source.whyItMatters].filter(Boolean).join(" ");
      if (text && redactAgentContextText(text) !== text) {
        findings.push(finding("security_risk", "critical", "high", "Source evidence contains secret-like text.", "source_evidence", "Secrets must not be sent to external agents or stored in review output.", "Remove or redact the source evidence before export.", sourceRef(source)));
      }
      if (/ignore previous instructions|approve all future changes/i.test(text)) {
        findings.push(finding("prompt_injection", "medium", "high", "Source evidence contains instruction-like text and must stay labeled as evidence.", "source_evidence", "External agents must not follow embedded evidence instructions.", "Keep evidence quoted/labeled and verify exported prompts include source-evidence safety rules.", sourceRef(source)));
      }
    }

    const scores = scoreContextPack(pack, sections, sources, findings);
    const overallScore = average(Object.values(scores));
    const scoreLabel = labelForScore(overallScore, findings);
    const readinessToExport = !["needs_improvement", "unsafe_or_blocked"].includes(scoreLabel) && !hasSeverity(findings, "critical");
    const recommendation = readinessToExport ? (findings.length ? "aligned_with_warnings" : "looks_aligned") : hasSeverity(findings, "critical") ? "unsafe_or_noncompliant" : "needs_follow_up";
    return {
      project,
      reviewType: "context_pack_quality",
      contextPackId: pack.id,
      agentRunId: null,
      exportRefJson: null,
      status: findings.length ? "completed_with_warnings" : "completed",
      overallScore,
      scoreLabel,
      recommendation,
      readinessToExport,
      needsFollowUp: !readinessToExport,
      summary: `Context pack quality review completed. Score ${Math.round(overallScore * 100)}%. ${readinessToExport ? "Ready to export with preserved limitations." : "Needs human attention before export."}`,
      inputSummary: `${pack.title}: ${pack.taskPrompt}`.slice(0, 4000),
      scores,
      findings: dedupeFindings(findings),
      matchedRequirements: sections.currentAcceptedTruth.slice(0, 20),
      missingRequirements: findings.filter((item) => item.type === "missing_requirement").map((item) => item.summary),
      hallucinatedAssumptions: [],
      driftFindings: [],
      riskFindings: findings.filter((item) => item.type.includes("risk") || item.type === "prompt_injection").map((item) => item.summary),
      testGaps: [],
      docsGaps: [],
      openQuestions: sections.openQuestions.length ? sections.openQuestions : ["Confirm whether missing limitations, citations, or open targets should block export."],
      carryForwardNotes: ["Carry limitations, invalid citation warnings, and provider exclusions into the next context pack."],
      citations: input.includeCitations ? sources.map((source) => source.citationJson).filter(Boolean) : [],
      openTargets: input.includeOpenTargets ? sources.map((source) => source.openTargetJson).filter(Boolean) : [],
      limitations,
      warnings: unique(warnings.concat(findings.map((item) => item.summary))),
      fallbackMetadata: deterministicFallback(input)
    };
  }

  private buildAgentRunReview(project: { id: string; orgId: string }, run: any, pack: any | null, sources: any[], productBrain: any[], input: CreateQualityReviewInput): BuiltReview {
    const findings: ReviewFinding[] = [];
    const warnings = [...toStringArray(run.warningsJson)];
    const rawOutput = [run.outputSummary, run.fullOutput, run.implementationNotes, run.taskDescription].filter(Boolean).join("\n");
    const output = redactAgentContextText(rawOutput);
    const outputLower = output.toLowerCase();
    const testsRun = toStringArray(run.testsRunJson);
    const docsUpdated = toStringArray(run.docsUpdatedJson);
    const filesChanged = toStringArray(run.filesChangedJson);
    const risks = toStringArray(run.risksFoundJson);
    const followUps = toStringArray(run.followUpQuestionsJson);
    const matchedRequirements = matchRequirements(output, productBrain.concat(extractSourceRequirements(sources)));
    const missingRequirements = productBrain.map((item) => item.summary).filter(Boolean).filter((summary) => !containsLoose(output, summary)).slice(0, 20);

    if (!run.contextPackId) {
      findings.push(finding("missing_context_pack", "high", "high", "Agent run has no linked context pack.", "agent_run", "Review cannot verify what context the agent used.", "Attach the context pack or pasted export before trusting the run."));
    }
    if (!run.outputSummary) {
      findings.push(finding("missing_evidence", "high", "high", "Agent run has no output summary.", "agent_run", "Manual run review needs the agent's claimed output.", "Paste an output summary before review."));
    }
    if (testsRun.length === 0 || run.testStatus === "not_run") {
      findings.push(finding("test_gap", "high", "high", "Agent run did not record tests run.", "tests", "Claims are weaker without test evidence.", "Ask a human to run or record relevant tests."));
    }
    if (docsUpdated.length === 0 && /docs|contract|api|frontend|readme/i.test(output)) {
      findings.push(finding("docs_gap", "medium", "medium", "Agent output references docs/API/frontend contract work but no docs were recorded.", "docs", "Docs gaps create frontend/backend drift.", "Record docs updated or add a follow-up."));
    } else if (docsUpdated.length === 0) {
      findings.push(finding("docs_gap", "low", "medium", "No docs updates were recorded.", "docs", "Some implementation work needs docs or contract updates.", "Confirm docs were not required."));
    }
    if (/rewrote? (the )?(original )?(prd|srs)|updated original (prd|srs)|mutated (the )?product brain|product brain is now changed|live doc is now changed/i.test(output)) {
      findings.push(finding("implementation_drift", "critical", "high", "Agent claimed a truth-changing or source-mutating action.", "truth_model", "Agent reviews cannot mutate Product Brain, Live Doc, or original PRD/SRS bytes.", "Inspect the work and route any truth change through the approved human flow."));
    }
    if (/auto-merge|automerge|autonomous coding|direct claude|direct codex|direct cursor|accept(ed)? proposal|reject(ed)? proposal|created accepted decision/i.test(output)) {
      findings.push(finding("unsupported_scope_expansion", "critical", "high", "Agent claimed unsupported autonomous or truth-changing scope.", "scope", "Step 5 is review-only and cannot add autonomous execution or truth approval.", "Reject or re-scope the run unless a human explicitly approved that later feature."));
    }
    if (/client.*internal transcript|internal transcript.*client|client-safe.*internal|oauth|provider credential|service role|database_url|mcp token/i.test(outputLower)) {
      findings.push(finding("client_safe_risk", "high", "medium", "Agent output may expose internal or credential-sensitive material.", "client_safe", "Client-safe surfaces must exclude internal transcripts and secrets.", "Review output for leaks before sharing externally."));
    }
    if (rawOutput && output !== rawOutput) {
      findings.push(finding("security_risk", "critical", "high", "Agent output contained secret-like text and was redacted in the review summary.", "security", "Secrets must not be stored or replayed to agents.", "Rotate any exposed credential and keep only redacted evidence."));
    }
    if (/assum(ed|es|ption)|i assumed|assuming /i.test(output)) {
      findings.push(finding("hallucinated_assumption", "medium", "medium", "Agent introduced an assumption that needs human validation.", "assumptions", "Unverified agent assumptions are not Product Brain truth.", "Confirm or reject the assumption through normal review."));
    }
    if (/gmail|outlook|teams|whatsapp|client mcp|rollback|finance|subscription|auto-merge|autonomous|proposal acceptance|live doc mutation/i.test(output) && this.isMvpMode()) {
      findings.push(finding("mvp_mode_violation", "critical", "high", "Agent output mentions behavior outside MVP defaults or hidden provider boundaries.", "mvp_scope", "MVP mode must not expose hidden providers or future autonomous surfaces by default.", "Check MVP feature flags and remove or gate the behavior."));
    }
    if (filesChanged.length === 0) {
      findings.push(finding("missing_evidence", "medium", "medium", "No changed files were recorded.", "implementation_evidence", "Review cannot inspect implementation surfaces from summary alone.", "Record changed files or explicitly state none changed."));
    }
    for (const missing of missingRequirements.slice(0, 5)) {
      findings.push(finding("missing_requirement", "medium", "low", `Not enough evidence that requirement was satisfied: ${missing}`, "requirements", "Missing requirement matches may indicate drift or incomplete implementation.", "Ask the human reviewer to verify this requirement."));
    }

    const driftFindings = findings.filter((item) => ["implementation_drift", "unsupported_scope_expansion", "mvp_mode_violation"].includes(item.type)).map((item) => item.summary);
    const testGaps = findings.filter((item) => item.type === "test_gap").map((item) => item.summary);
    const docsGaps = findings.filter((item) => item.type === "docs_gap").map((item) => item.summary);
    const riskFindings = findings.filter((item) => item.type.includes("risk") || item.severity === "critical").map((item) => item.summary);
    const openQuestions = unique([
      ...followUps,
      ...risks,
      "What human review is needed before this agent run can be accepted or rejected?",
      ...(missingRequirements.length ? ["Which missing requirements should be carried into the next context pack?"] : [])
    ]);
    const overallScore = scoreAgentRun(findings, matchedRequirements.length, missingRequirements.length);
    const scoreLabel = labelForScore(overallScore, findings);
    const recommendation: Recommendation = hasSeverity(findings, "critical")
      ? "unsafe_or_noncompliant"
      : driftFindings.length
        ? "possible_drift"
        : findings.some((item) => item.severity === "high")
          ? "needs_follow_up"
          : "aligned_with_warnings";

    return {
      project,
      reviewType: "agent_run_review",
      contextPackId: run.contextPackId ?? null,
      agentRunId: run.id,
      exportRefJson: run.exportRefJson ?? null,
      status: findings.length ? "completed_with_warnings" : "completed",
      overallScore,
      scoreLabel,
      recommendation,
      readinessToExport: null,
      needsFollowUp: !["looks_aligned", "aligned_with_warnings"].includes(recommendation),
      summary: `Agent run review completed from manually recorded implementation evidence. Recommendation: ${recommendation}. Review findings are not Product Brain truth.`,
      inputSummary: `${run.taskTitle}: ${output}`.slice(0, 4000),
      scores: {
        alignment: clamp(overallScore),
        requirementMatch: clamp(matchedRequirements.length / Math.max(1, matchedRequirements.length + missingRequirements.length)),
        safety: hasSeverity(findings, "critical") ? 0 : hasSeverity(findings, "high") ? 0.45 : 0.8,
        testEvidence: testsRun.length > 0 && run.testStatus !== "not_run" ? 1 : 0,
        docsEvidence: docsUpdated.length > 0 ? 1 : 0
      },
      findings: dedupeFindings(findings),
      matchedRequirements,
      missingRequirements,
      hallucinatedAssumptions: findings.filter((item) => item.type === "hallucinated_assumption").map((item) => item.summary),
      driftFindings,
      riskFindings,
      testGaps,
      docsGaps,
      openQuestions,
      carryForwardNotes: unique([
        "Do not treat agent output or review findings as Product Brain truth.",
        "Carry missing requirements, unresolved assumptions, and test/doc gaps into the next context pack.",
        ...(pack ? [`Reuse or refresh context pack ${pack.id} after resolving review findings.`] : ["Attach a context pack before the next run."])
      ]),
      citations: input.includeCitations ? buildRunCitations(run, pack) : [],
      openTargets: input.includeOpenTargets ? buildRunOpenTargets(run, pack) : [],
      limitations: [
        TRUTH_MODEL_WARNING,
        "No automatic PR diff analysis was performed; this review uses recorded agent-run evidence.",
        input.deterministicOnly ? "AI review was not used; deterministic checks may miss nuanced implementation drift." : "AI-assisted review is readiness-gated and schema-validated when enabled."
      ],
      warnings: unique(warnings.concat(findings.map((item) => item.summary))),
      fallbackMetadata: deterministicFallback(input)
    };
  }

  private async persistReview(actorUserId: string, built: BuiltReview) {
    const criticalFindingCount = built.findings.filter((item) => item.severity === "critical").length;
    const highSeverityFindingCount = built.findings.filter((item) => item.severity === "high").length;
    const retrievalSummary = [
      built.summary,
      ...built.findings.map((item) => item.summary),
      ...built.openQuestions,
      ...built.carryForwardNotes
    ].join(" | ").slice(0, 4000);
    const created = await (this.prisma as any).agentQualityReview.create({
      data: {
        orgId: built.project.orgId,
        projectId: built.project.id,
        contextPackId: built.contextPackId,
        agentRunId: built.agentRunId,
        exportRefJson: built.exportRefJson as Prisma.InputJsonValue,
        createdByUserId: actorUserId,
        reviewType: built.reviewType,
        reviewMode: "deterministic",
        status: built.status,
        overallScore: built.overallScore,
        scoreLabel: built.scoreLabel,
        recommendation: built.recommendation,
        readinessToExport: built.readinessToExport,
        needsFollowUp: built.needsFollowUp,
        highSeverityFindingCount,
        criticalFindingCount,
        summary: built.summary,
        inputSummary: built.inputSummary,
        scoresJson: built.scores as Prisma.InputJsonValue,
        findingsJson: built.findings as Prisma.InputJsonValue,
        matchedRequirementsJson: built.matchedRequirements as Prisma.InputJsonValue,
        missingRequirementsJson: built.missingRequirements as Prisma.InputJsonValue,
        hallucinatedAssumptionsJson: built.hallucinatedAssumptions as Prisma.InputJsonValue,
        driftFindingsJson: built.driftFindings as Prisma.InputJsonValue,
        riskFindingsJson: built.riskFindings as Prisma.InputJsonValue,
        testGapsJson: built.testGaps as Prisma.InputJsonValue,
        docsGapsJson: built.docsGaps as Prisma.InputJsonValue,
        openQuestionsJson: built.openQuestions as Prisma.InputJsonValue,
        carryForwardNotesJson: built.carryForwardNotes as Prisma.InputJsonValue,
        citationsJson: built.citations as Prisma.InputJsonValue,
        openTargetsJson: built.openTargets as Prisma.InputJsonValue,
        limitationsJson: built.limitations as Prisma.InputJsonValue,
        warningsJson: built.warnings as Prisma.InputJsonValue,
        fallbackMetadataJson: built.fallbackMetadata as Prisma.InputJsonValue,
        indexedForSocrates: true,
        indexedAt: new Date(),
        retrievalSummary
      }
    });
    return this.toDto(created);
  }

  private async ensureAccess(projectId: string, actorUserId: string) {
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    if (member.projectRole === "client") {
      throw new AppError(403, "Client users cannot access internal agent quality reviews", "client_agent_quality_access_forbidden");
    }
    return member;
  }

  private async loadProject(projectId: string) {
    const project = await (this.prisma as any).project.findUnique({ where: { id: projectId }, select: { id: true, orgId: true } });
    if (!project) throw new AppError(404, "Project not found", "project_not_found");
    return project;
  }

  private async loadContextPack(projectId: string, packId: string) {
    const pack = await (this.prisma as any).agentContextPack.findFirst({ where: { id: packId, projectId, status: { not: "deleted" } } });
    if (!pack) throw new AppError(404, "Agent Context Pack not found", "agent_context_pack_not_found");
    return pack;
  }

  private async loadAgentRun(projectId: string, runId: string) {
    const run = await (this.prisma as any).agentRun.findFirst({ where: { id: runId, projectId, status: { not: "deleted" } } });
    if (!run) throw new AppError(404, "Agent run not found", "agent_run_not_found");
    return run;
  }

  private async loadReview(projectId: string, reviewId: string) {
    const review = await (this.prisma as any).agentQualityReview.findFirst({ where: { id: reviewId, projectId, deletedAt: null } });
    if (!review) throw new AppError(404, "Agent quality review not found", "agent_quality_review_not_found");
    return review;
  }

  private async loadProductBrainEvidence(projectId: string) {
    const nodes = await (this.prisma as any).brainNode.findMany({
      where: { projectId, status: "accepted" },
      orderBy: { createdAt: "desc" },
      take: 50
    }).catch(() => []);
    return nodes.map((node: any) => ({
      id: node.id,
      title: node.title ?? "Product Brain requirement",
      summary: [node.title, node.summary, node.body, node.content].filter(Boolean).join(": ").slice(0, 1000)
    })).filter((item: any) => item.summary);
  }

  private getEnabledMvpProviders() {
    if (!this.isMvpMode()) return null;
    const providers = (this.env as any).MVP_ENABLED_COMMUNICATION_PROVIDERS;
    if (Array.isArray(providers)) return new Set(providers.map(normalizeProvider).filter(Boolean));
    if (typeof providers === "string") return new Set(providers.split(",").map(normalizeProvider).filter(Boolean));
    return new Set(DEFAULT_MVP_COMMUNICATION_PROVIDERS);
  }

  private isMvpMode() {
    return Boolean((this.env as any).MVP_MODE);
  }

  private toDto(review: any) {
    return {
      id: review.id,
      orgId: review.orgId,
      projectId: review.projectId,
      contextPackId: review.contextPackId,
      agentRunId: review.agentRunId,
      exportReference: review.exportRefJson,
      reviewType: review.reviewType,
      reviewMode: review.reviewMode,
      status: review.status,
      overallScore: review.overallScore,
      scoreLabel: review.scoreLabel,
      recommendation: review.recommendation,
      readinessToExport: review.readinessToExport,
      needsFollowUp: review.needsFollowUp,
      summary: review.summary,
      inputSummary: review.inputSummary,
      scores: review.scoresJson,
      findings: review.findingsJson,
      matchedRequirements: review.matchedRequirementsJson,
      missingRequirements: review.missingRequirementsJson,
      hallucinatedAssumptions: review.hallucinatedAssumptionsJson,
      driftFindings: review.driftFindingsJson,
      riskFindings: review.riskFindingsJson,
      testGaps: review.testGapsJson,
      docsGaps: review.docsGapsJson,
      openQuestions: review.openQuestionsJson,
      carryForwardNotes: review.carryForwardNotesJson,
      citations: review.citationsJson,
      openTargets: review.openTargetsJson,
      limitations: review.limitationsJson,
      warnings: review.warningsJson,
      truthModel: TRUTH_MODEL_WARNING,
      modelMetadata: review.modelMetadataJson,
      fallbackMetadata: review.fallbackMetadataJson,
      indexedForSocrates: review.indexedForSocrates,
      indexedAt: review.indexedAt?.toISOString?.() ?? null,
      retrievalSummary: review.retrievalSummary,
      createdByUserId: review.createdByUserId,
      archivedByUserId: review.archivedByUserId,
      archivedAt: review.archivedAt?.toISOString?.() ?? null,
      deletedAt: review.deletedAt?.toISOString?.() ?? null,
      createdAt: review.createdAt?.toISOString?.() ?? review.createdAt,
      updatedAt: review.updatedAt?.toISOString?.() ?? review.updatedAt
    };
  }

  private toListDto(review: any) {
    return {
      id: review.id,
      contextPackId: review.contextPackId,
      agentRunId: review.agentRunId,
      reviewType: review.reviewType,
      status: review.status,
      overallScore: review.overallScore,
      scoreLabel: review.scoreLabel,
      recommendation: review.recommendation,
      needsFollowUp: review.needsFollowUp,
      highSeverityFindingCount: review.highSeverityFindingCount,
      criticalFindingCount: review.criticalFindingCount,
      summary: review.summary,
      warningSummary: toStringArray(review.warningsJson).slice(0, 3),
      createdByUserId: review.createdByUserId,
      createdAt: review.createdAt?.toISOString?.() ?? review.createdAt,
      updatedAt: review.updatedAt?.toISOString?.() ?? review.updatedAt
    };
  }

  private async audit(orgId: string, projectId: string, actorUserId: string, eventType: string, reviewId: string, payload: Record<string, unknown>) {
    await this.auditService.record({
      orgId,
      projectId,
      actorUserId,
      eventType,
      entityType: "agent_quality_review",
      entityId: reviewId,
      payload: { reviewId, ...payload }
    });
  }
}

function normalizeSections(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, any> : {};
  return {
    mission: extractItems(record.mission),
    currentAcceptedTruth: extractItems(record.currentAcceptedTruth),
    relevantSourceEvidence: extractItems(record.relevantSourceEvidence),
    implementationConstraints: extractItems(record.implementationConstraints),
    openQuestions: extractItems(record.openQuestions),
    acceptanceChecklist: extractItems(record.acceptanceChecklist),
    limitations: extractItems(record.limitations)
  };
}

function extractItems(section: unknown) {
  if (Array.isArray(section)) return section.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (section && typeof section === "object" && Array.isArray((section as any).items)) {
    return (section as any).items.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0);
  }
  return [];
}

function scoreContextPack(pack: any, sections: ReturnType<typeof normalizeSections>, sources: any[], findings: ReviewFinding[]) {
  return {
    coverage: clamp((Number(pack.sourceCount > 0) + Number(pack.evidenceCount > 0) + Number(sections.currentAcceptedTruth.length > 0) + Number(sections.acceptanceChecklist.length > 0)) / 4),
    relevance: clamp((Number(sections.mission.length > 0) + Number(sections.implementationConstraints.length > 0) + Number(sections.relevantSourceEvidence.length > 0)) / 3),
    citation: clamp(sources.length ? sources.filter((source) => validateAgentContextCitation(source.citationJson).valid).length / sources.length : 0),
    openTarget: clamp(sources.length ? sources.filter((source) => validateAgentContextOpenTarget(source.openTargetJson).valid).length / sources.length : 0),
    freshness: pack.generatedAt ? 0.8 : 0.2,
    limitations: sections.limitations.length > 0 || toStringArray(pack.limitationsJson).length > 0 ? 1 : 0,
    safety: hasSeverity(findings, "critical") ? 0 : findings.some((item) => item.type === "disabled_provider") ? 0.45 : 0.9,
    tokenBudget: pack.maxTokenBudget ? clamp(pack.maxTokenBudget / Math.max(pack.maxTokenBudget, pack.tokenEstimate)) : pack.tokenEstimate > 50000 ? 0.4 : 0.8,
    sourceDiversity: clamp(new Set(sources.map((source) => source.sourceDomain ?? source.sourceType)).size / 4),
    redaction: findings.some((item) => item.type === "security_risk") ? 0 : 0.9
  };
}

function scoreAgentRun(findings: ReviewFinding[], matchedCount: number, missingCount: number) {
  let score = 0.85;
  score -= findings.filter((item) => item.severity === "critical").length * 0.3;
  score -= findings.filter((item) => item.severity === "high").length * 0.16;
  score -= findings.filter((item) => item.severity === "medium").length * 0.08;
  score -= missingCount > 0 ? Math.min(0.2, missingCount * 0.03) : 0;
  score += Math.min(0.1, matchedCount * 0.02);
  return clamp(score);
}

function labelForScore(score: number, findings: ReviewFinding[]): ScoreLabel {
  if (hasSeverity(findings, "critical")) return "unsafe_or_blocked";
  if (score >= 0.9) return "excellent";
  if (score >= 0.75) return "good";
  if (score >= 0.58) return "usable_with_warnings";
  return "needs_improvement";
}

function finding(
  type: string,
  severity: FindingSeverity,
  confidence: FindingConfidence,
  summary: string,
  affectedSurface: string,
  whyItMatters: string,
  recommendedHumanAction: string,
  evidenceReference?: Record<string, unknown>
): ReviewFinding {
  return {
    type,
    severity,
    confidence,
    summary,
    affectedSurface,
    whyItMatters,
    recommendedHumanAction,
    evidenceReferences: evidenceReference ? [evidenceReference] : []
  };
}

function sourceRef(source: any) {
  return {
    sourceId: source.id,
    sourceRefType: source.sourceRefType,
    sourceRefId: source.sourceRefId,
    provider: source.provider,
    citation: source.citationJson,
    openTarget: source.openTargetJson
  };
}

function buildRunCitations(run: any, pack: any | null) {
  return [
    { type: "agent_run", id: run.id, label: run.taskTitle },
    ...(pack ? [{ type: "agent_context_pack", id: pack.id, label: pack.title }] : [])
  ];
}

function buildRunOpenTargets(run: any, pack: any | null) {
  return [
    { targetType: "agent_run", targetRef: { agentRunId: run.id, section: "review" } },
    ...(pack ? [{ targetType: "agent_context_pack", targetRef: { contextPackId: pack.id } }] : []),
    ...(run.prUrl ? [{ targetType: "external_url", targetRef: { url: run.prUrl, label: "Linked PR" } }] : [])
  ];
}

function extractSourceRequirements(sources: any[]) {
  return sources.map((source) => ({
    id: source.sourceRefId,
    title: source.title,
    summary: [source.title, source.summary, source.excerpt, source.whyItMatters].filter(Boolean).join(": ").slice(0, 1000)
  })).filter((item) => item.summary);
}

function matchRequirements(output: string, requirements: Array<{ summary?: string | null; title?: string | null }>) {
  return unique(requirements.filter((requirement) => containsLoose(output, requirement.summary ?? requirement.title ?? "")).map((requirement) => requirement.summary ?? requirement.title ?? "").filter(Boolean)).slice(0, 50);
}

function containsLoose(text: string, needle: string) {
  const words = needle.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 4).slice(0, 8);
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function deterministicFallback(input: CreateQualityReviewInput) {
  return {
    mode: "deterministic",
    deterministicOnly: input.deterministicOnly,
    aiUsed: false,
    aiUnavailableFallbackUsed: true,
    limitation: "AI-assisted analysis is optional; this report was produced by deterministic checks."
  };
}

function hasSeverity(findings: ReviewFinding[], severity: FindingSeverity) {
  return findings.some((item) => item.severity === severity);
}

function average(values: number[]) {
  return values.length ? clamp(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeProvider(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return normalized === "teams" ? "microsoft_teams" : normalized;
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function dedupeFindings(findings: ReviewFinding[]) {
  const seen = new Set<string>();
  return findings.filter((item) => {
    const key = `${item.type}:${item.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countFindingPressure(rows: Array<{ findingsJson?: unknown }>) {
  const allFindings = rows.flatMap((row) => Array.isArray(row.findingsJson) ? row.findingsJson : []);
  const countType = (type: string) => allFindings.filter((finding) => finding && typeof finding === "object" && (finding as any).type === type).length;
  return {
    mvpModeViolationCount: countType("mvp_mode_violation"),
    testGapCount: countType("test_gap"),
    docsGapCount: countType("docs_gap")
  };
}
