import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import type { AuditService } from "../audit/service.js";
import type { BetaTimelineService } from "../beta-timeline/beta-timeline.service.js";
import type { ProjectService } from "../projects/service.js";
import type { SocratesService } from "../socrates/service.js";
import type { SuggestionListQuery } from "./suggestions.schemas.js";
import type {
  ProjectSuggestion,
  SuggestionCategory,
  SuggestionEvidence,
  SuggestionSeverity,
  SuggestionsListResponse,
  SuggestionsSourceStates
} from "./suggestions.types.js";

type Actor = { userId: string; orgId: string };

type EvidenceBundle = {
  project: { id: string; orgId: string };
  proposals: any[];
  acceptedProposals: any[];
  messageInsights: any[];
  threadInsights: any[];
  timelineEvents: any[];
  calendarEvents: any[];
  calendarConnections: any[];
  documentsCount: number;
  documentSectionsCount: number;
  driveConnections: any[];
  driveFiles: any[];
  driveSections: any[];
  driveSyncRuns: any[];
  notionResources: any[];
  notionSections: any[];
  socratesMessages: any[];
  githubLinks: any[];
  githubSyncRuns: any[];
  githubEvidence: any[];
  githubPrs: any[];
  githubPrFiles: any[];
  githubChecks: any[];
  githubEvidenceDegradedReason: string | null;
  vscodeConnectors: any[];
  responsibilities: any[];
  members: any[];
  actions: any[];
  sourceStates: SuggestionsSourceStates;
};

const CATEGORIES: SuggestionCategory[] = [
  "merge_conflicts",
  "spec_drift",
  "stalled_work",
  "reviewer_suggestions",
  "risk_flags",
  "decision_conflicts",
  "ownership_gaps",
  "coverage_gaps"
];
const SEVERITIES: SuggestionSeverity[] = ["low", "medium", "high", "critical"];
const PENDING_PROPOSAL_STATUSES = ["detected", "needs_review"];
const REVIEW_KEYWORDS = /\b(review|decision|scope|proposal|approval|approve|change)\b/i;
const AREA_KEYWORDS = /\b(api|backend|frontend|auth|calendar|github|slack|socrates|timeline|memory|docs?|profile|billing|deploy|qa|test)\b/i;
const SUGGESTIONS_LIST_CACHE_TTL_MS = 60_000;
const suggestionsListCache = new Map<string, { storedAt: number; value: SuggestionsListResponse }>();

export class SuggestionsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly betaTimelineService: BetaTimelineService,
    private readonly socratesService: SocratesService
  ) {}

  async list(projectId: string, actor: Actor, query: SuggestionListQuery): Promise<SuggestionsListResponse> {
    await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actor.userId);
    const cacheKey = this.suggestionsListCacheKey(projectId, actor, query);
    const cached = query.refresh ? null : suggestionsListCache.get(cacheKey);
    if (cached && Date.now() - cached.storedAt < SUGGESTIONS_LIST_CACHE_TTL_MS) {
      return cached.value;
    }
    const bundle = await this.collectEvidence(projectId, actor);
    const generated = await this.generateSuggestions(bundle);
    const filtered = this.applyFilters(generated, query);
    const paged = filtered.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 50));

    const response = {
      items: paged,
      sourceStates: bundle.sourceStates,
      countsByCategory: this.countBy(CATEGORIES, filtered, "category"),
      countsBySeverity: this.countBy(SEVERITIES, filtered, "severity"),
      generatedAt: new Date().toISOString(),
      limitations: [
        "Suggestions are deterministic advisory evidence, not accepted product truth."
      ]
    };
    suggestionsListCache.set(cacheKey, { storedAt: Date.now(), value: response });
    return response;
  }

  async get(projectId: string, suggestionId: string, actor: Actor) {
    const response = await this.list(projectId, actor, {
      includeDismissed: true,
      limit: 100,
      offset: 0,
      refresh: false
    } as SuggestionListQuery);
    const item = response.items.find((suggestion) => suggestion.id === suggestionId);
    if (!item) {
      throw new AppError(404, "Suggestion not found", "suggestion_not_found");
    }
    const actions = await this.prisma.projectSuggestionAction.findMany({
      where: { projectId, suggestionId },
      orderBy: { createdAt: "desc" }
    });
    return { ...item, actionHistory: actions.map((action) => this.toActionDto(action)) };
  }

  async dismiss(projectId: string, suggestionId: string, actor: Actor, note?: string) {
    await this.projectService.ensureProjectMemberCanMutate(projectId, actor.userId, "dismiss_suggestion");
    const suggestion = await this.get(projectId, suggestionId, actor);
    const action = await this.upsertAction(projectId, actor, suggestion, "dismiss", { note: note ?? null });
    await this.auditService.record({
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      eventType: "suggestion.dismissed",
      entityType: "project_suggestion",
      entityId: suggestion.id,
      payload: { category: suggestion.category, sourceFingerprint: suggestion.sourceFingerprint }
    });
    this.clearSuggestionsListCache(projectId);
    return { suggestion: { ...suggestion, status: "dismissed", dismissedAt: action.createdAt.toISOString(), dismissedByUserId: actor.userId }, action: this.toActionDto(action) };
  }

  async promoteToTimeline(projectId: string, suggestionId: string, actor: Actor) {
    await this.projectService.ensureProjectMemberCanMutate(projectId, actor.userId, "promote_suggestion_to_timeline");
    const suggestion = await this.get(projectId, suggestionId, actor);
    const existing = await this.prisma.projectSuggestionAction.findUnique({
      where: {
        projectId_suggestionId_actionType: {
          projectId,
          suggestionId,
          actionType: "promote_to_timeline"
        }
      }
    });
    if (existing?.timelineEventId) {
      return { suggestion, action: this.toActionDto(existing), timelineEventId: existing.timelineEventId };
    }

    const timelineEvent = await this.betaTimelineService.createManualEvent(projectId, actor.userId, {
      title: `Watchtower: ${suggestion.title}`,
      description: `${suggestion.description}\n\nEvidence: ${suggestion.evidence.map((item) => item.label).join("; ")}`,
      source: "manual",
      sourceRef: suggestion.id,
      eventType: "note",
      tier: suggestion.severity === "critical" || suggestion.severity === "high" ? "milestone" : "atomic",
      linkedRefType: "suggestion",
      linkedRefId: suggestion.id
    });
    const action = await this.upsertAction(projectId, actor, suggestion, "promote_to_timeline", {
      timelineEventId: timelineEvent.id,
      note: "Promoted to manual timeline event. Provider spoofing is not allowed."
    }, this.extractRawTimelineEventId(timelineEvent.id));
    await this.auditService.record({
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      eventType: "suggestion.promoted_to_timeline",
      entityType: "project_suggestion",
      entityId: suggestion.id,
      payload: { timelineEventId: timelineEvent.id, category: suggestion.category }
    });
    this.clearSuggestionsListCache(projectId);
    return { suggestion: { ...suggestion, status: "converted_to_timeline", promotedTimelineEventId: timelineEvent.id }, action: this.toActionDto(action), timelineEvent };
  }

  async createReviewItem(projectId: string, suggestionId: string, actor: Actor) {
    await this.projectService.ensureProjectTruthApprover(projectId, actor.userId);
    const suggestion = await this.get(projectId, suggestionId, actor);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`suggestion-review:${projectId}:${suggestionId}`}, 0))::text`;
    const existing = await tx.projectSuggestionAction.findUnique({
      where: {
        projectId_suggestionId_actionType: {
          projectId,
          suggestionId,
          actionType: "create_review_item"
        }
      }
    });
    if (existing?.proposalId) {
      const proposal = await tx.specChangeProposal.findFirstOrThrow({ where: { id: existing.proposalId, projectId } });
      return { suggestion, action: this.toActionDto(existing), proposal };
    }

    const proposal = await tx.specChangeProposal.create({
      data: {
        projectId,
        title: `Watchtower review: ${suggestion.title}`.slice(0, 255),
        summary: suggestion.description,
        proposalType: this.proposalTypeForSuggestion(suggestion.category),
        status: "needs_review",
        sourceMessageCount: suggestion.sourceRefs.filter((ref) =>
          ["slack_message", "microsoft_teams_message", "message_insight", "communication_thread"].includes(ref.type)
        ).length,
        newUnderstandingJson: {
          source: "pm_watchtower_suggestion",
          suggestionId: suggestion.id,
          recommendation: suggestion.recommendedActions.map((action) => action.label)
        } as Prisma.InputJsonValue,
        impactSummaryJson: {
          severity: suggestion.severity,
          confidence: suggestion.confidence,
          limitations: suggestion.limitations
        } as Prisma.InputJsonValue,
        externalEvidenceRefsJson: suggestion.sourceRefs.map((ref) => `${ref.type}:${ref.id}`)
      }
    });
    const action = await this.upsertAction(projectId, actor, suggestion, "create_review_item", {
      proposalId: proposal.id,
      note: "Created needs_review proposal only; Product Brain and LiveDoc were not mutated."
    }, undefined, proposal.id, tx);
    await this.auditService.recordWithClient(tx, {
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      eventType: "suggestion.review_item_created",
      entityType: "project_suggestion",
      entityId: suggestion.id,
      payload: { proposalId: proposal.id, category: suggestion.category, autoAccepted: false }
    });
    return { suggestion: { ...suggestion, status: "converted_to_review", createdProposalId: proposal.id }, action: this.toActionDto(action), proposal };
    });
    this.clearSuggestionsListCache(projectId);
    return result;
  }

  async askSocrates(projectId: string, suggestionId: string, actor: Actor) {
    await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actor.userId);
    const suggestion = await this.get(projectId, suggestionId, actor);
    const question = [
      "Explain this PM Watchtower suggestion using only project evidence.",
      `Suggestion: ${suggestion.title}`,
      `Category: ${suggestion.category}`,
      `Description: ${suggestion.description}`,
      `Evidence refs: ${suggestion.sourceRefs.map((ref) => `${ref.type}:${ref.id}`).join(", ")}`,
      "Do not mutate Product Brain, LiveDoc, communication providers, GitHub, or Calendar."
    ].join("\n");
    const answer = await this.socratesService.askV1ProjectMemory({
      projectId,
      actorUserId: actor.userId,
      question,
      mode: "ask",
      includeArtifacts: true,
      includeHistory: false,
      selectedSources: suggestion.sourceRefs.map((ref) => ref.type)
    });
    const action = await this.upsertAction(projectId, actor, suggestion, "ask_socrates", {
      sessionId: answer.sessionId ?? answer.session?.sessionId ?? null,
      messageId: answer.messageId ?? answer.message?.assistantMessageId ?? null
    });
    await this.auditService.record({
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      eventType: "suggestion.socrates_asked",
      entityType: "project_suggestion",
      entityId: suggestion.id,
      payload: { readOnly: true, category: suggestion.category }
    });
    return { suggestion, action: this.toActionDto(action), answer };
  }

  private suggestionsListCacheKey(projectId: string, actor: Actor, query: SuggestionListQuery) {
    return [
      projectId,
      actor.orgId,
      query.category ?? "all",
      query.severity ?? "all",
      query.status ?? "any",
      query.source ?? "any",
      query.includeDismissed ? "with_dismissed" : "active_only",
      query.limit ?? 50,
      query.offset ?? 0
    ].join(":");
  }

  private clearSuggestionsListCache(projectId: string) {
    for (const key of suggestionsListCache.keys()) {
      if (key.startsWith(`${projectId}:`)) suggestionsListCache.delete(key);
    }
  }

  private async collectEvidence(projectId: string, actor: Actor): Promise<EvidenceBundle> {
    const project = await this.prisma.project.findFirstOrThrow({
      where: { id: projectId, orgId: actor.orgId },
      select: { id: true, orgId: true }
    });
    const now = new Date();
    const inThirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const [
      proposals,
      acceptedProposals,
      messageInsights,
      threadInsights,
      timelineEvents,
      calendarEvents,
      calendarConnections,
      documentsCount,
      documentSectionsCount,
      driveConnections,
      driveFiles
    ] = await Promise.all([
      this.prisma.specChangeProposal.findMany({
        where: { projectId, status: { in: PENDING_PROPOSAL_STATUSES as any } },
        include: { links: true },
        orderBy: { updatedAt: "asc" },
        take: 50
      }),
      this.prisma.specChangeProposal.findMany({
        where: { projectId, status: "accepted" },
        include: { links: true },
        orderBy: { acceptedAt: "desc" },
        take: 50
      }),
      this.prisma.messageInsight.findMany({
        where: { projectId, status: "detected" },
        orderBy: { createdAt: "desc" },
        take: 80
      }),
      this.prisma.threadInsight.findMany({
        where: { projectId, status: "detected" },
        orderBy: { createdAt: "desc" },
        take: 80
      }),
      this.prisma.projectEvent.findMany({
        where: { projectId },
        orderBy: { startsAt: "desc" },
        take: 80
      }),
      this.prisma.projectEvent.findMany({
        where: {
          projectId,
          startsAt: { gte: now, lte: inThirtyDays },
          OR: [{ source: "manual" }, { providerCalendarId: { not: null } }]
        },
        orderBy: { startsAt: "asc" },
        take: 80
      }),
      this.prisma.projectCalendarConnection.findMany({
        where: { projectId, provider: "google_calendar" },
        orderBy: { updatedAt: "desc" },
        take: 5
      }),
      this.prisma.document.count({ where: { projectId } }),
      this.prisma.documentSection.count({ where: { projectId } }),
      this.prisma.projectDriveConnection
        ? this.prisma.projectDriveConnection.findMany({
            where: { projectId, provider: "google_drive", status: { not: "disconnected" } },
            orderBy: { updatedAt: "desc" },
            take: 5
          })
        : Promise.resolve([]),
      this.prisma.projectDriveFile
        ? this.prisma.projectDriveFile.findMany({
            where: { projectId },
            orderBy: [{ modifiedTime: "desc" }, { updatedAt: "desc" }],
            take: 80
          })
        : Promise.resolve([])
    ]);
    const driveVersionIds = driveFiles.map((file) => file.documentVersionId).filter((id): id is string => Boolean(id));
    const notionResources = await (this.prisma.projectNotionResource
      ? this.prisma.projectNotionResource.findMany({
          where: { projectId },
          orderBy: [{ lastIndexedAt: "desc" }, { lastEditedAt: "desc" }, { updatedAt: "desc" }],
          take: 80
        })
      : Promise.resolve([]));
    const notionVersionIds = notionResources.map((resource) => resource.documentVersionId).filter((id): id is string => Boolean(id));
    const [
      driveSections,
      notionSections,
      driveSyncRuns,
      socratesMessages,
      githubLinks,
      githubSyncRuns,
      vscodeConnectors,
      responsibilities,
      members,
      actions
    ] = await Promise.all([
      driveVersionIds.length > 0
        ? this.prisma.documentSection.findMany({
            where: { projectId, documentVersionId: { in: driveVersionIds } },
            orderBy: [{ createdAt: "desc" }],
            take: 120
          })
        : Promise.resolve([]),
      notionVersionIds.length > 0
        ? this.prisma.documentSection.findMany({
            where: { projectId, documentVersionId: { in: notionVersionIds } },
            orderBy: [{ createdAt: "desc" }],
            take: 120
          })
        : Promise.resolve([]),
      this.prisma.projectDriveSyncRun
        ? this.prisma.projectDriveSyncRun.findMany({
            where: { projectId },
            orderBy: { createdAt: "desc" },
            take: 10
          })
        : Promise.resolve([]),
      this.prisma.socratesMessage.findMany({
        where: { role: "user", session: { projectId } },
        orderBy: { createdAt: "desc" },
        take: 30
      }),
      this.prisma.gitHubRepositoryProjectLink.findMany({
        where: { projectId, archivedAt: null },
        include: { repository: true },
        orderBy: { updatedAt: "desc" },
        take: 10
      }),
      this.prisma.gitHubSyncRun.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        take: 10
      }),
      this.prisma.projectEditorConnector.findMany({
        where: { projectId, connectorType: "vscode" },
        orderBy: [{ lastUsedAt: "desc" }, { updatedAt: "desc" }],
        take: 25
      }),
      this.prisma.projectResponsibility.findMany({
        where: { projectId, status: { in: ["open", "in_progress", "blocked"] } },
        include: { member: { include: { user: { select: { displayName: true, email: true } } } } },
        orderBy: { updatedAt: "desc" },
        take: 80
      }),
      this.prisma.projectMember.findMany({
        where: { projectId, isActive: true },
        include: { user: { select: { displayName: true, email: true } } },
        orderBy: { joinedAt: "asc" },
        take: 80
      }),
      this.prisma.projectSuggestionAction.findMany({ where: { projectId } })
    ]);
    let githubEvidenceDegradedReason: string | null = null;
    let githubEvidence: any[] = [];
    try {
      githubEvidence = await this.prisma.gitHubEngineeringEvidence.findMany({
        where: { projectId, evidenceStatus: "active" },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        take: 500
      });
    } catch (error) {
      if (!isDatabaseConnectionPressure(error)) throw error;
      githubEvidenceDegradedReason = "GitHub evidence refresh is temporarily degraded; PM Watchtower is showing other available project evidence.";
    }
    const githubPrs = githubEvidence.filter((item) => item.evidenceType === "github_pull_request").slice(0, 100);
    const githubPrFiles = githubEvidence.filter((item) => item.evidenceType === "github_pull_request_file" && item.path).slice(0, 200);
    const githubChecks = githubEvidence.filter((item) => item.evidenceType === "github_check_run").slice(0, 100);

    return {
      project,
      proposals,
      acceptedProposals,
      messageInsights,
      threadInsights,
      timelineEvents,
      calendarEvents,
      calendarConnections,
      documentsCount,
      documentSectionsCount,
      driveConnections,
      driveFiles,
      driveSections,
      driveSyncRuns,
      notionResources,
      notionSections,
      socratesMessages,
      githubLinks,
      githubSyncRuns,
      githubEvidence,
      githubPrs,
      githubPrFiles,
      githubChecks,
      githubEvidenceDegradedReason,
      vscodeConnectors,
      responsibilities,
      members,
      actions,
      sourceStates: this.buildSourceStates({
        messageInsights,
        threadInsights,
        proposals,
        acceptedProposals,
        timelineEvents,
        calendarEvents,
        calendarConnections,
        documentsCount,
        documentSectionsCount,
        driveConnections,
        driveFiles,
        driveSections,
        driveSyncRuns,
        notionResources,
        notionSections,
        socratesMessages,
        githubLinks,
        githubSyncRuns,
        githubEvidence,
        githubEvidenceDegradedReason,
        vscodeConnectors
      })
    };
  }

  private async generateSuggestions(bundle: EvidenceBundle) {
    const dismissed = new Map<string, any>();
    const promoted = new Map<string, any>();
    const reviewed = new Map<string, any>();
    for (const action of bundle.actions) {
      if (action.actionType === "dismiss") dismissed.set(action.suggestionId, action);
      if (action.actionType === "promote_to_timeline") promoted.set(action.suggestionId, action);
      if (action.actionType === "create_review_item") reviewed.set(action.suggestionId, action);
    }

    const suggestions = [
      ...this.detectStalePendingReviews(bundle),
      ...this.detectCommunicationSpecDrift(bundle),
      ...this.detectAcceptedChangeMissingTimeline(bundle),
      ...this.detectCalendarReviewMissing(bundle),
      ...this.detectGithubConflictRisks(bundle),
      ...this.detectStalePullRequests(bundle),
      ...this.detectOwnershipGaps(bundle),
      ...this.detectDocsMissingForActiveAreas(bundle),
      ...this.detectDriveEvidenceNeedsReview(bundle),
      ...this.detectNotionEvidenceNeedsReview(bundle),
      ...this.detectDriveSyncHealth(bundle),
      ...this.detectDecisionConflicts(bundle),
      ...this.detectReviewerSuggestions(bundle)
    ];
    const deduped = new Map<string, ProjectSuggestion>();
    for (const suggestion of suggestions) {
      const dismissedAction = dismissed.get(suggestion.id);
      const promotedAction = promoted.get(suggestion.id);
      const reviewedAction = reviewed.get(suggestion.id);
      const next: ProjectSuggestion = {
        ...suggestion,
        status: dismissedAction
          ? "dismissed"
          : reviewedAction
            ? "converted_to_review"
            : promotedAction
              ? "converted_to_timeline"
              : "active",
        dismissedAt: dismissedAction?.createdAt?.toISOString?.() ?? null,
        dismissedByUserId: dismissedAction?.actorUserId ?? null,
        promotedTimelineEventId: promotedAction?.timelineEventId ?? null,
        createdProposalId: reviewedAction?.proposalId ?? null
      };
      deduped.set(suggestion.sourceFingerprint, next);
    }
    return Array.from(deduped.values()).sort((left, right) => {
      const severityDelta = severityRank(right.severity) - severityRank(left.severity);
      return severityDelta || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }

  private detectStalePendingReviews(bundle: EvidenceBundle): ProjectSuggestion[] {
    const threshold = Date.now() - 3 * 24 * 60 * 60 * 1000;
    return bundle.proposals
      .filter((proposal) => new Date(proposal.updatedAt ?? proposal.createdAt).getTime() < threshold)
      .slice(0, 10)
      .map((proposal) =>
        this.suggestion(bundle, {
          detectorKey: "pending_livedoc_review_stale",
          category: "stalled_work",
          title: `Pending review is stale: ${proposal.title}`,
          description: `This LiveDoc/Product Brain proposal is still ${proposal.status} and has not been accepted or rejected for more than three days.`,
          severity: proposal.status === "needs_review" ? "high" : "medium",
          confidence: 0.86,
          refs: [proposalRef(proposal)],
          limitations: ["Age is measured from the proposal update timestamp; offline review activity may not be visible."]
        })
      );
  }

  private detectCommunicationSpecDrift(bundle: EvidenceBundle): ProjectSuggestion[] {
    const insights = [...bundle.messageInsights, ...bundle.threadInsights].filter((insight) =>
      ["contradiction", "requirement_change"].includes(String(insight.insightType))
    );
    return insights.slice(0, 12).map((insight) => {
      const provider = communicationProviderLabel(insight.provider);
      return this.suggestion(bundle, {
        detectorKey: communicationProviderDetectorKey(insight.provider, "spec_drift"),
        category: insight.insightType === "contradiction" ? "decision_conflicts" : "spec_drift",
        title: `${provider} evidence needs review: ${truncate(insight.summary, 90)}`,
        description: `A synced ${provider} insight was detected as ${insight.insightType}. It has not been converted into an accepted or rejected review item.`,
        severity: Number(insight.confidence ?? 0) >= 0.8 ? "high" : "medium",
        confidence: clampConfidence(Number(insight.confidence ?? 0.72)),
        refs: [insightRef(insight)],
        limitations: [`${provider} evidence is discussion evidence only until reviewed.`]
      });
    });
  }

  private detectAcceptedChangeMissingTimeline(bundle: EvidenceBundle): ProjectSuggestion[] {
    const linked = new Set(
      bundle.timelineEvents
        .filter((event) => String(event.linkedRefType ?? "").includes("proposal") || String(event.linkedRefType ?? "").includes("suggestion"))
        .map((event) => String(event.linkedRefId ?? ""))
    );
    return bundle.acceptedProposals
      .filter((proposal) => !linked.has(proposal.id))
      .slice(0, 8)
      .map((proposal) =>
        this.suggestion(bundle, {
          detectorKey: "accepted_change_missing_timeline",
          category: "coverage_gaps",
          title: `Accepted change is not represented on the timeline: ${proposal.title}`,
          description: "An accepted change exists without a linked manual timeline event. Add a timeline note if pilots need an operational milestone for the change.",
          severity: "medium",
          confidence: 0.78,
          refs: [proposalRef(proposal)],
          limitations: ["Generated LiveDoc revision markers may already exist; this detector only checks manual timeline reconciliation."]
        })
      );
  }

  private detectCalendarReviewMissing(bundle: EvidenceBundle): ProjectSuggestion[] {
    const hasCalendarConnection = bundle.calendarConnections.some((connection) => ["connected", "syncing"].includes(String(connection.status)));
    const reviewEvents = bundle.calendarEvents.filter((event) => REVIEW_KEYWORDS.test(`${event.title ?? ""} ${event.description ?? ""}`));
    if (!hasCalendarConnection && bundle.calendarEvents.length > 0) return [];
    return bundle.proposals
      .filter((proposal) => String(proposal.summary ?? proposal.title).match(/\b(risk|block|scope|decision|critical|high)\b/i))
      .filter(() => reviewEvents.length === 0)
      .slice(0, 6)
      .map((proposal) =>
        this.suggestion(bundle, {
          detectorKey: "calendar_review_missing",
          category: "risk_flags",
          title: `No review meeting found for high-risk change: ${proposal.title}`,
          description: hasCalendarConnection
            ? "No synced Google Calendar or manual project event in the next 30 days appears to cover review/decision for this high-risk pending change."
            : "No manual project review event was found. Google Calendar is not connected, so this is limited to manual calendar evidence.",
          severity: "high",
          confidence: hasCalendarConnection ? 0.8 : 0.62,
          refs: [proposalRef(proposal)],
          limitations: hasCalendarConnection
            ? ["Calendar titles/descriptions are keyword-matched conservatively."]
            : ["Google Calendar is not connected; connect it before treating this as complete calendar evidence."]
        })
      );
  }

  private detectGithubConflictRisks(bundle: EvidenceBundle): ProjectSuggestion[] {
    if (bundle.githubLinks.length === 0 || bundle.githubEvidence.length === 0) return [];
    const byPath = new Map<string, any[]>();
    for (const file of bundle.githubPrFiles) {
      if (!file.path || !file.pullRequestNumber) continue;
      const rows = byPath.get(file.path) ?? [];
      rows.push(file);
      byPath.set(file.path, rows);
    }
    const overlapSuggestions = Array.from(byPath.entries())
      .filter(([, files]) => new Set(files.map((file) => file.pullRequestNumber)).size > 1)
      .slice(0, 8)
      .map(([path, files]) =>
        this.suggestion(bundle, {
          detectorKey: "github_overlapping_pr_files",
          category: "merge_conflicts",
          title: `Conflict risk: multiple PRs touch ${path}`,
          description: "Real GitHub PR file evidence shows more than one open/recent PR touching the same path. This is a conflict risk, not a confirmed merge conflict.",
          severity: "high",
          confidence: 0.82,
          refs: files.slice(0, 4).map(githubPrFileRef),
          limitations: ["Overlapping files do not prove Git will report a merge conflict."]
        })
      );
    const failedChecks = bundle.githubChecks
      .filter((check) => /\b(fail|failure|cancelled|timed_out|action_required)\b/i.test(`${check.status ?? ""} ${JSON.stringify(check.payloadJson ?? {})}`))
      .slice(0, 6)
      .map((check) =>
        this.suggestion(bundle, {
          detectorKey: "github_failing_checks",
          category: "merge_conflicts",
          title: `GitHub check needs attention: ${check.title ?? check.providerId}`,
          description: "A real GitHub check-run evidence item indicates a failing or blocked check.",
          severity: "high",
          confidence: 0.82,
          refs: [githubEvidenceRef(check, "github_check")],
          limitations: ["Check status comes from synced/webhook evidence and may be stale until the next sync."]
        })
      );
    return [...overlapSuggestions, ...failedChecks];
  }

  private detectStalePullRequests(bundle: EvidenceBundle): ProjectSuggestion[] {
    if (bundle.githubLinks.length === 0) return [];
    const threshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return bundle.githubPrs
      .filter((pr) => String(pr.status) === "open")
      .filter((pr) => new Date(pr.occurredAt ?? pr.updatedAt ?? pr.createdAt).getTime() < threshold)
      .slice(0, 8)
      .map((pr) =>
        this.suggestion(bundle, {
          detectorKey: "github_stale_pr",
          category: "stalled_work",
          title: `Stale pull request: ${pr.title ?? `#${pr.pullRequestNumber}`}`,
          description: "A real open GitHub PR has not changed in more than seven days according to synced evidence.",
          severity: "medium",
          confidence: 0.8,
          refs: [githubEvidenceRef(pr, "github_pull_request")],
          limitations: ["Reviewer comments after the last sync may not be reflected yet."]
        })
      );
  }

  private detectOwnershipGaps(bundle: EvidenceBundle): ProjectSuggestion[] {
    const hasOwners = bundle.responsibilities.some((responsibility) => Boolean(responsibility.memberId || responsibility.assigneeName));
    if (hasOwners) return [];
    return bundle.proposals.slice(0, 6).map((proposal) =>
      this.suggestion(bundle, {
        detectorKey: "pending_proposal_no_owner",
        category: "ownership_gaps",
        title: `No owner found for pending proposal: ${proposal.title}`,
        description: "A pending proposal exists, but no active project responsibility owner is available to route review work.",
        severity: "medium",
        confidence: 0.72,
        refs: [proposalRef(proposal)],
        limitations: ["Ownership is based on Orchestra team responsibilities, not informal ownership outside the system."]
      })
    );
  }

  private detectDocsMissingForActiveAreas(bundle: EvidenceBundle): ProjectSuggestion[] {
    const hasActiveAreaAsk = bundle.socratesMessages.some((message) => AREA_KEYWORDS.test(message.content ?? ""));
    const hasEngineeringActivity = bundle.githubEvidence.length > 0 || bundle.messageInsights.some((insight) => AREA_KEYWORDS.test(insight.summary ?? ""));
    if (!hasActiveAreaAsk || !hasEngineeringActivity || bundle.documentSectionsCount > 0) return [];
    return [
      this.suggestion(bundle, {
        detectorKey: "docs_missing_for_active_area",
        category: "coverage_gaps",
        title: "Active project area has no uploaded document sections",
        description: "Socrates/API or engineering activity references an implementation area, but no parsed project document sections are available as source documentation.",
        severity: "medium",
        confidence: 0.66,
        refs: [
          ...bundle.socratesMessages.slice(0, 2).map(socratesRef),
          ...bundle.githubEvidence.slice(0, 2).map((item) => githubEvidenceRef(item, item.evidenceType === "github_commit" ? "github_commit" : "github_branch"))
        ],
        limitations: ["This detector only knows about uploaded/parsed docs in Orchestra."]
      })
    ];
  }

  private detectDriveEvidenceNeedsReview(bundle: EvidenceBundle): ProjectSuggestion[] {
    if (bundle.driveFiles.length === 0 || bundle.driveSections.length === 0) return [];
    const reviewSections = bundle.driveSections
      .filter((section) => REVIEW_KEYWORDS.test(section.text ?? ""))
      .slice(0, 8);
    return reviewSections.map((section) => {
      const file = bundle.driveFiles.find((candidate) => candidate.documentVersionId === section.documentVersionId);
      return this.suggestion(bundle, {
        detectorKey: "google_drive_doc_review_signal",
        category: "coverage_gaps",
        title: `Drive document mentions review-worthy change: ${file?.name ?? section.title ?? "Google Drive document"}`,
        description: "A synced Google Drive document section mentions review, approval, scope, or change language. It should be considered evidence and routed through human review before becoming project truth.",
        severity: "medium",
        confidence: 0.7,
        refs: [driveDocumentRef(section, file)],
        limitations: ["Drive content is source evidence only; this detector does not accept or reject the change."]
      });
    });
  }

  private detectNotionEvidenceNeedsReview(bundle: EvidenceBundle): ProjectSuggestion[] {
    if (bundle.notionResources.length === 0 || bundle.notionSections.length === 0) return [];
    const reviewSections = bundle.notionSections
      .filter((section) => REVIEW_KEYWORDS.test(section.text ?? ""))
      .slice(0, 8);
    return reviewSections.map((section) => {
      const resource = bundle.notionResources.find((candidate) => candidate.documentVersionId === section.documentVersionId);
      return this.suggestion(bundle, {
        detectorKey: "notion_doc_review_signal",
        category: "coverage_gaps",
        title: `Notion page mentions review-worthy change: ${resource?.title ?? section.title ?? "Notion document"}`,
        description: "A selected/shared Notion resource mentions review, approval, scope, or change language. It should be treated as evidence and routed through human review before becoming project truth.",
        severity: "medium",
        confidence: 0.7,
        refs: [notionDocumentRef(section, resource)],
        limitations: ["Notion content is selected/shared source evidence only; this detector does not accept or reject the change."]
      });
    });
  }

  private detectDriveSyncHealth(bundle: EvidenceBundle): ProjectSuggestion[] {
    if (bundle.driveConnections.length === 0) return [];
    const latest = bundle.driveSyncRuns[0];
    const failedFiles = bundle.driveFiles.filter((file) => file.indexStatus === "failed").slice(0, 5);
    const suggestions: ProjectSuggestion[] = [];
    if (latest && ["failed", "partial"].includes(String(latest.status))) {
      suggestions.push(this.suggestion(bundle, {
        detectorKey: "google_drive_sync_failed",
        category: "risk_flags",
        title: "Google Drive sync needs attention",
        description: `The latest Google Drive sync finished as ${latest.status}. Retry sync before relying on Drive evidence for Socrates or Watchtower decisions.`,
        severity: "medium",
        confidence: 0.84,
        refs: [driveSyncRunRef(latest)],
        limitations: ["Previously indexed Drive files remain visible, but the latest Drive state may be incomplete."]
      }));
    }
    for (const file of failedFiles) {
      suggestions.push(this.suggestion(bundle, {
        detectorKey: "google_drive_file_index_failed",
        category: "coverage_gaps",
        title: `Drive file could not be indexed: ${file.name}`,
        description: "A synced Google Drive file is visible but failed indexing, so Socrates cannot reliably cite its contents yet.",
        severity: "medium",
        confidence: 0.82,
        refs: [driveFileRef(file)],
        limitations: ["Unsupported file types, permissions, or transient provider errors can cause indexing failures."]
      }));
    }
    return suggestions.slice(0, 8);
  }

  private detectDecisionConflicts(bundle: EvidenceBundle): ProjectSuggestion[] {
    const conflictInsights = [...bundle.messageInsights, ...bundle.threadInsights].filter((insight) =>
      ["contradiction", "requirement_change"].includes(String(insight.insightType))
    );
    if (bundle.acceptedProposals.length === 0 || conflictInsights.length === 0) return [];
    return conflictInsights.slice(0, 5).map((insight) =>
      this.suggestion(bundle, {
        detectorKey: communicationProviderDetectorKey(insight.provider, "conflicts_with_accepted_decision"),
        category: "decision_conflicts",
        title: `Potential decision conflict: ${truncate(insight.summary, 90)}`,
        description: `A newer ${communicationProviderLabel(insight.provider)} insight may conflict with previously accepted project understanding. This is advisory and requires human review.`,
        severity: "high",
        confidence: 0.68,
        refs: [insightRef(insight), proposalRef(bundle.acceptedProposals[0])],
        limitations: ["The detector does not auto-compare semantic truth; it routes conservative contradiction evidence for review."]
      })
    );
  }

  private detectReviewerSuggestions(bundle: EvidenceBundle): ProjectSuggestion[] {
    if (bundle.githubLinks.length === 0 || bundle.githubPrs.length === 0 || bundle.responsibilities.length === 0) return [];
    return bundle.githubPrs
      .filter((pr) => String(pr.status) === "open")
      .slice(0, 5)
      .flatMap((pr) => {
        const files = bundle.githubPrFiles.filter((file) => file.pullRequestNumber === pr.pullRequestNumber);
        const owner = bundle.responsibilities.find((responsibility) => files.some((file) => areaMatchesPath(responsibility.area, file.path)));
        if (!owner) return [];
        return [
          this.suggestion(bundle, {
            detectorKey: "github_reviewer_from_responsibility",
            category: "reviewer_suggestions",
            title: `Reviewer evidence for PR #${pr.pullRequestNumber}`,
            description: `${owner.assigneeName ?? owner.member?.user?.displayName ?? "A project owner"} owns a related area and may be the right reviewer for this PR.`,
            severity: "low",
            confidence: 0.7,
            refs: [githubEvidenceRef(pr, "github_pull_request"), responsibilityRef(owner)],
            limitations: ["This suggests a reviewer from real project responsibility data; it does not assign reviewers in GitHub."]
          })
        ];
      });
  }

  private suggestion(
    bundle: EvidenceBundle,
    input: {
      detectorKey: string;
      category: SuggestionCategory;
      title: string;
      description: string;
      severity: SuggestionSeverity;
      confidence: number;
      refs: SuggestionEvidence[];
      limitations: string[];
    }
  ): ProjectSuggestion {
    const fingerprint = hashStable({
      detectorKey: input.detectorKey,
      refs: input.refs.map((ref) => `${ref.source}:${ref.refId}`)
    });
    const id = `sug_${fingerprint.slice(0, 24)}`;
    const now = new Date().toISOString();
    return {
      id,
      projectId: bundle.project.id,
      category: input.category,
      title: input.title,
      description: input.description,
      severity: input.severity,
      confidence: clampConfidence(input.confidence),
      status: "active",
      sourceRefs: input.refs.map((ref) => ({
        type: ref.source,
        id: ref.refId,
        label: ref.label,
        openTarget: ref.openTarget ?? null
      })),
      evidence: input.refs,
      recommendedActions: [
        { key: "ask_socrates", label: "Ask Socrates", description: "Explain this suggestion from project evidence." },
        { key: "promote_to_timeline", label: "Promote to Timeline", description: "Record this advisory finding as a manual project timeline event." },
        { key: "create_review_item", label: "Create review item", description: "Create a needs-review proposal without auto-accepting it." },
        { key: "dismiss", label: "Dismiss", description: "Hide this suggestion for the current project." }
      ],
      limitations: input.limitations,
      detectorKey: input.detectorKey,
      sourceFingerprint: fingerprint,
      staleAfter: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now,
      updatedAt: now,
      dismissedAt: null,
      dismissedByUserId: null,
      promotedTimelineEventId: null,
      createdProposalId: null,
      metadata: { advisoryOnly: true, deepResearchEnabled: false }
    };
  }

  private applyFilters(items: ProjectSuggestion[], query: SuggestionListQuery) {
    return items
      .filter((item) => (query.includeDismissed ? true : item.status !== "dismissed"))
      .filter((item) => (query.category ? item.category === query.category : true))
      .filter((item) => (query.severity ? item.severity === query.severity : true))
      .filter((item) => (query.status ? item.status === query.status : true))
      .filter((item) => (query.source ? item.sourceRefs.some((ref) => ref.type.includes(query.source!)) : true));
  }

  private async upsertAction(
    projectId: string,
    actor: Actor,
    suggestion: ProjectSuggestion,
    actionType: string,
    payload: Record<string, unknown>,
    timelineEventId?: string,
    proposalId?: string,
    client: Pick<PrismaClient, "projectSuggestionAction"> = this.prisma
  ) {
    return client.projectSuggestionAction.upsert({
      where: { projectId_suggestionId_actionType: { projectId, suggestionId: suggestion.id, actionType } },
      create: {
        orgId: actor.orgId,
        projectId,
        suggestionId: suggestion.id,
        sourceFingerprint: suggestion.sourceFingerprint,
        actionType,
        actorUserId: actor.userId,
        timelineEventId: timelineEventId ?? null,
        proposalId: proposalId ?? null,
        payloadJson: payload as Prisma.InputJsonValue
      },
      update: {
        status: "completed",
        actorUserId: actor.userId,
        timelineEventId: timelineEventId ?? undefined,
        proposalId: proposalId ?? undefined,
        payloadJson: payload as Prisma.InputJsonValue
      }
    });
  }

  private buildSourceStates(input: {
    messageInsights: any[];
    threadInsights: any[];
    proposals: any[];
    acceptedProposals: any[];
    timelineEvents: any[];
    calendarEvents: any[];
    calendarConnections: any[];
    documentsCount: number;
    documentSectionsCount: number;
    driveConnections: any[];
    driveFiles: any[];
    driveSections: any[];
    driveSyncRuns: any[];
    notionResources: any[];
    notionSections: any[];
    socratesMessages: any[];
    githubLinks: any[];
    githubSyncRuns: any[];
    githubEvidence: any[];
    githubEvidenceDegradedReason: string | null;
    vscodeConnectors: any[];
  }): SuggestionsSourceStates {
    const communicationInsights = [...input.messageInsights, ...input.threadInsights];
    const slackReady = communicationInsights.some((insight) => String(insight.provider) === "slack");
    const teamsReady = communicationInsights.some((insight) => String(insight.provider) === "microsoft_teams");
    const calendarConnected = input.calendarConnections.some((connection) => ["connected", "syncing"].includes(String(connection.status)));
    const githubConnected = input.githubLinks.length > 0;
    const driveConnected = input.driveConnections.some((connection) => ["connected", "syncing", "needs_reauth", "error"].includes(String(connection.status)));
    const driveIndexedCount = input.driveFiles.filter((file) => file.indexStatus === "indexed").length;
    const notionIndexedCount = input.notionResources.filter((resource) => ["indexed", "ready", "partial", "pending", "parsing"].includes(String(resource.indexStatus))).length;
    const latestDriveSync = input.driveSyncRuns[0];
    const driveSyncFailed = latestDriveSync && /fail|partial|error|cancel/i.test(String(latestDriveSync.status));
    const latestGithubSync = input.githubSyncRuns[0];
    const githubSyncStatus = String(latestGithubSync?.status ?? "").toLowerCase();
    const githubSyncStartedAt = latestGithubSync?.startedAt ?? latestGithubSync?.createdAt ?? null;
    const githubSyncAgeMs = githubSyncStartedAt ? Date.now() - new Date(githubSyncStartedAt).getTime() : Number.POSITIVE_INFINITY;
    const githubSyncFresh = Number.isFinite(githubSyncAgeMs) && githubSyncAgeMs >= 0 && githubSyncAgeMs < 2 * 60 * 1000;
    const githubSyncActive = ["running", "queued", "pending", "syncing", "in_progress"].includes(githubSyncStatus) && !latestGithubSync?.finishedAt;
    const githubSyncFailed = /fail|error|cancel|timed_out/i.test(githubSyncStatus);
    const githubState = !githubConnected
      ? "not_connected"
      : input.githubEvidence.length > 0
        ? "ready"
        : input.githubEvidenceDegradedReason || githubSyncFailed || (githubSyncActive && !githubSyncFresh)
          ? "degraded"
          : githubSyncActive
            ? "degraded"
            : "empty";
    const githubDetail = !githubConnected
      ? "No GitHub repository is linked."
      : input.githubEvidenceDegradedReason
        ? input.githubEvidenceDegradedReason
        : input.githubEvidence.length > 0
          ? null
          : githubSyncActive && githubSyncFresh
            ? "GitHub sync is still running; Watchtower will update when evidence is available."
            : githubSyncActive
              ? "Previous GitHub sync did not finish; retry sync is available."
              : githubSyncFailed
                ? "Latest GitHub sync failed; retry sync is available."
                : "Repository is linked, but no GitHub evidence has been synced yet.";
    return {
      slack: {
        state: slackReady ? "ready" : "empty",
        label: "Slack",
        detail: slackReady ? null : "No detected Slack insights are available."
      },
      microsoft_teams: {
        state: teamsReady ? "ready" : "empty",
        label: "Microsoft Teams",
        detail: teamsReady ? null : "No detected Microsoft Teams insights are available."
      },
      livedoc: { state: input.proposals.length + input.acceptedProposals.length > 0 ? "ready" : "empty", label: "LiveDoc", detail: "No review proposals available." },
      timeline: { state: input.timelineEvents.length > 0 ? "ready" : "empty", label: "Timeline", detail: "No timeline events available." },
      calendar: {
        state: calendarConnected ? (input.calendarEvents.length > 0 ? "ready" : "empty") : "not_connected",
        label: "Google Calendar",
        detail: calendarConnected ? null : "Google Calendar is not connected; manual project events are still considered."
      },
      documents: {
        state: input.documentSectionsCount > 0 ? "ready" : input.documentsCount > 0 ? "degraded" : "empty",
        label: "Uploaded docs",
        detail: input.documentSectionsCount > 0 ? null : "No parsed document sections are available."
      },
      notion: {
        state: input.notionResources.length === 0
          ? "empty"
          : input.notionSections.length > 0 || notionIndexedCount > 0
            ? "ready"
            : input.notionResources.some((resource) => ["inaccessible", "unsupported", "provider_error", "rate_limited", "failed"].includes(String(resource.indexStatus)))
              ? "degraded"
              : "empty",
        label: "Notion",
        detail: input.notionResources.length === 0
          ? "No selected Notion resources have been synced."
          : input.notionSections.length > 0 || notionIndexedCount > 0
            ? null
            : "Selected Notion resources exist, but no parsed sections are available yet."
      },
      google_drive: {
        state: !driveConnected
          ? "not_connected"
          : driveIndexedCount > 0
            ? "ready"
            : driveSyncFailed || input.driveFiles.some((file) => file.indexStatus === "failed")
              ? "degraded"
              : "empty",
        label: "Google Drive",
        detail: !driveConnected
          ? "Google Drive is not connected."
          : driveIndexedCount > 0
            ? null
            : driveSyncFailed
              ? "Latest Google Drive sync had failures; retry sync is available."
              : "Google Drive is connected, but no indexed Drive file evidence is available yet."
      },
      socrates: { state: input.socratesMessages.length > 0 ? "ready" : "empty", label: "Socrates", detail: "No Socrates question history is available." },
      github: {
        state: githubState,
        label: "GitHub",
        detail: githubDetail
      },
      vscode: { state: input.vscodeConnectors.length > 0 ? "ready" : "empty", label: "VS Code", detail: "No VS Code connector activity is available." }
    };
  }

  private countBy<T extends string>(keys: T[], items: ProjectSuggestion[], field: "category" | "severity") {
    return keys.reduce((acc, key) => {
      acc[key] = items.filter((item) => item[field] === key).length;
      return acc;
    }, {} as Record<T, number>);
  }

  private proposalTypeForSuggestion(category: SuggestionCategory) {
    if (category === "decision_conflicts") return "decision_change";
    if (category === "spec_drift") return "requirement_change";
    if (category === "coverage_gaps") return "clarification";
    return "contradiction_resolution";
  }

  private extractRawTimelineEventId(timelineId: string) {
    return timelineId.startsWith("manual:") ? timelineId.slice("manual:".length) : undefined;
  }

  private toActionDto(action: any) {
    return {
      id: action.id,
      actionType: action.actionType,
      status: action.status,
      actorUserId: action.actorUserId,
      timelineEventId: action.timelineEventId ?? null,
      proposalId: action.proposalId ?? null,
      payload: action.payloadJson ?? {},
      createdAt: action.createdAt?.toISOString?.() ?? new Date(action.createdAt).toISOString()
    };
  }
}

function proposalRef(proposal: any): SuggestionEvidence {
  return {
    source: "spec_change_proposal",
    refId: proposal.id,
    label: proposal.title,
    excerpt: proposal.summary ?? null,
    occurredAt: toIso(proposal.updatedAt ?? proposal.createdAt),
    openTarget: { targetType: "change_proposal", targetRef: { proposalId: proposal.id } }
  };
}

function insightRef(insight: any): SuggestionEvidence {
  const provider = String(insight.provider ?? "");
  const source =
    provider === "microsoft_teams"
      ? "microsoft_teams_message"
      : provider === "slack"
        ? "slack_message"
        : insight.messageId
          ? "message_insight"
          : "communication_thread";
  const targetType = insight.messageId ? "message_insight" : "communication_thread";
  return {
    source,
    refId: insight.id,
    label: `${communicationProviderLabel(provider)} ${insight.insightType}: ${truncate(insight.summary, 70)}`,
    excerpt: insight.summary ?? null,
    occurredAt: toIso(insight.createdAt),
    openTarget: {
      targetType,
      targetRef: { insightId: insight.id, messageId: insight.messageId ?? null, threadId: insight.threadId ?? null, provider }
    }
  };
}

function communicationProviderLabel(provider: unknown) {
  const value = String(provider ?? "");
  if (value === "microsoft_teams") return "Microsoft Teams";
  if (value === "slack") return "Slack";
  if (value === "fireflies_ai") return "Fireflies.ai";
  if (value === "granola") return "Granola";
  if (value === "clickup") return "ClickUp";
  if (value === "zoho_mail") return "Zoho Mail";
  if (value === "zoho_cliq") return "Zoho Cliq";
  if (value === "zoho_crm") return "Zoho CRM";
  if (value === "notion") return "Notion";
  if (!value) return "Communication";
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function communicationProviderDetectorKey(provider: unknown, suffix: string) {
  const value = String(provider ?? "communication").replace(/[^a-z0-9_]/gi, "_").toLowerCase();
  return `${value || "communication"}_${suffix}`;
}

function githubEvidenceRef(row: any, source: "github_pull_request" | "github_commit" | "github_check" | "github_branch"): SuggestionEvidence {
  return {
    source,
    refId: row.id,
    label: row.title ?? row.providerId ?? row.sha ?? "GitHub evidence",
    excerpt: row.summary ?? null,
    occurredAt: toIso(row.occurredAt ?? row.createdAt),
    openTarget: safeOpenTarget(row.openTargetJson) ?? { targetType: "github_evidence", targetRef: { evidenceId: row.id } }
  };
}

function githubPrFileRef(row: any): SuggestionEvidence {
  return {
    source: "github_pull_request",
    refId: row.id,
    label: `PR #${row.pullRequestNumber} file ${row.path}`,
    excerpt: row.summary ?? null,
    occurredAt: toIso(row.occurredAt ?? row.createdAt),
    openTarget: safeOpenTarget(row.openTargetJson) ?? { targetType: "github_pull_request_file", targetRef: { evidenceId: row.id, path: row.path } }
  };
}

function driveFileRef(row: any): SuggestionEvidence {
  return {
    source: "google_drive_file",
    refId: row.id,
    label: row.name ?? "Google Drive file",
    excerpt: row.lastError ? truncate(row.lastError, 180) : null,
    occurredAt: toIso(row.modifiedTime ?? row.updatedAt ?? row.createdAt),
    openTarget: row.documentId
      ? { targetType: "document", targetRef: { documentId: row.documentId, documentVersionId: row.documentVersionId, driveFileId: row.id } }
      : { targetType: "google_drive_file", targetRef: { driveFileId: row.id, driveProviderFileId: row.driveFileId } }
  };
}

function driveDocumentRef(section: any, file?: any): SuggestionEvidence {
  return {
    source: "google_drive_document",
    refId: section.id,
    label: file?.name ?? section.title ?? "Google Drive document section",
    excerpt: truncate(section.text ?? "", 220),
    occurredAt: toIso(file?.modifiedTime ?? section.updatedAt ?? section.createdAt),
    openTarget: {
      targetType: "document_section",
      targetRef: {
        documentVersionId: section.documentVersionId,
        sectionId: section.id,
        anchorId: section.anchorId,
        driveFileId: file?.id ?? null
      }
    }
  };
}

function notionDocumentRef(section: any, resource?: any): SuggestionEvidence {
  return {
    source: "notion_document",
    refId: section.id,
    label: resource?.title ?? section.title ?? "Notion document section",
    excerpt: truncate(section.text ?? "", 220),
    occurredAt: toIso(resource?.lastEditedAt ?? resource?.lastIndexedAt ?? section.updatedAt ?? section.createdAt),
    openTarget: {
      targetType: "document_section",
      targetRef: {
        documentId: resource?.documentId ?? null,
        documentVersionId: section.documentVersionId,
        sectionId: section.id,
        anchorId: section.anchorId,
        notionResourceId: resource?.id ?? null
      }
    }
  };
}

function driveSyncRunRef(row: any): SuggestionEvidence {
  return {
    source: "google_drive_file",
    refId: row.id,
    label: `Google Drive sync ${row.status}`,
    excerpt: row.errorMessage ? truncate(row.errorMessage, 180) : `${row.filesIndexed ?? 0} indexed, ${row.filesFailed ?? 0} failed`,
    occurredAt: toIso(row.finishedAt ?? row.startedAt ?? row.createdAt),
    openTarget: { targetType: "google_drive_sync_run", targetRef: { syncRunId: row.id } }
  };
}

function responsibilityRef(row: any): SuggestionEvidence {
  return {
    source: "project_member",
    refId: row.id,
    label: row.assigneeName ?? row.member?.user?.displayName ?? row.title,
    excerpt: `${row.title} (${row.area})`,
    occurredAt: toIso(row.updatedAt ?? row.createdAt),
    openTarget: { targetType: "project_responsibility", targetRef: { responsibilityId: row.id } }
  };
}

function socratesRef(row: any): SuggestionEvidence {
  return {
    source: "socrates_artifact",
    refId: row.id,
    label: "Socrates question",
    excerpt: truncate(row.content ?? "", 160),
    occurredAt: toIso(row.createdAt),
    openTarget: { targetType: "socrates_message", targetRef: { messageId: row.id, sessionId: row.sessionId } }
  };
}

function areaMatchesPath(area: string, path?: string | null) {
  if (!path) return false;
  const lower = path.toLowerCase();
  if (area === "frontend") return lower.includes("app") || lower.includes("frontend") || lower.endsWith(".tsx") || lower.endsWith(".jsx");
  if (area === "backend" || area === "api") return lower.includes("src/") || lower.includes("server") || lower.includes("api");
  if (area === "docs") return lower.endsWith(".md") || lower.includes("docs/");
  if (area === "qa") return lower.includes("test") || lower.includes("spec");
  return lower.includes(area);
}

function severityRank(severity: SuggestionSeverity) {
  return { low: 1, medium: 2, high: 3, critical: 4 }[severity];
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0.6;
  return Math.min(0.99, Math.max(0.1, value));
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, Math.max(0, length - 1))}…` : value;
}

function toIso(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeOpenTarget(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.targetType !== "string" || typeof record.targetRef !== "object" || record.targetRef === null || Array.isArray(record.targetRef)) return null;
  return { targetType: record.targetType, targetRef: record.targetRef as Record<string, unknown> };
}

function isDatabaseConnectionPressure(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /EMAXCONNSESSION|max clients|too many clients|connection pool|pool_size|remaining connection slots/i.test(message);
}

function hashStable(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
