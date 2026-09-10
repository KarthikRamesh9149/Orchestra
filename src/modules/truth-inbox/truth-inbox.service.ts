import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import type { AuditService } from "../audit/service.js";
import type { BetaTimelineService } from "../beta-timeline/beta-timeline.service.js";
import type { ChangeProposalService } from "../changes/service.js";
import type { ProjectService } from "../projects/service.js";
import type { SocratesService } from "../socrates/service.js";
import type { SuggestionsService } from "../suggestions/suggestions.service.js";
import type { ProjectSuggestion, SuggestionsListResponse } from "../suggestions/suggestions.types.js";
import type { TruthInboxActionInput, TruthInboxListQuery } from "./truth-inbox.schemas.js";
import type {
  TruthInboxAction,
  TruthInboxCategory,
  TruthInboxEvidence,
  TruthInboxItem,
  TruthInboxListResponse,
  TruthInboxMember,
  TruthInboxSeverity,
  TruthInboxSourceType,
  TruthInboxStatus
} from "./truth-inbox.types.js";

type Actor = { userId: string; orgId: string };
type InboxStateRow = any;
type Snapshot = {
  items: TruthInboxItem[];
  members: TruthInboxMember[];
  sourceStates: TruthInboxListResponse["sourceStates"];
  generatedAt: string;
  limitations: string[];
};

const SNAPSHOT_TTL_MS = 20_000;
const snapshotCache = new Map<string, { storedAt: number; value: Snapshot }>();
const snapshotRequests = new Map<string, Promise<Snapshot>>();
const snapshotGenerations = new Map<string, number>();
const SOURCE_TYPES = new Set<TruthInboxSourceType>(["suggestion", "proposal", "fde", "agent_drift", "connector"]);
const TERMINAL_STATUSES = new Set<TruthInboxStatus>(["dismissed", "resolved", "converted_to_review", "converted_to_timeline"]);

export class TruthInboxService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly betaTimelineService: BetaTimelineService,
    private readonly socratesService: SocratesService,
    private readonly suggestionsService: SuggestionsService,
    private readonly changeProposalService: ChangeProposalService
  ) {}

  async list(projectId: string, actor: Actor, query: TruthInboxListQuery): Promise<TruthInboxListResponse> {
    if (query.source && ["proposal", "fde", "agent_drift"].includes(query.source)) {
      const result = await this.loadSourcePage(projectId, actor, query);
      const members = (await this.prisma.projectMember.findMany({
        where: { projectId, isActive: true, projectRole: { in: ["manager", "dev"] } },
        include: { user: { select: { id: true, displayName: true, email: true, isActive: true } } },
        orderBy: [{ projectRole: "asc" }, { joinedAt: "asc" }],
        take: 200
      }))
        .filter((row) => row.user.isActive)
        .map((row) => ({
          userId: row.user.id,
          displayName: row.user.displayName,
          email: row.user.email,
          projectRole: row.projectRole as "manager" | "dev",
          canApproveTruthChanges: row.projectRole === "manager" || row.canApproveTruthChanges
        }));
      const active = result.items.filter((item) => item.status === "active");
      return {
        items: result.items,
        members,
        summary: {
          active: active.length,
          critical: active.filter((item) => item.severity === "critical").length,
          awaitingDecision: active.filter((item) => item.sourceType === "proposal").length,
          assignedToMe: active.filter((item) => item.owner?.userId === actor.userId).length
        },
        countsByCategory: countBy(result.items, "category"),
        countsByStatus: countBy(result.items, "status"),
        sourceStates: {},
        page: { limit: query.limit, hasMore: Boolean(result.cursor), nextCursor: result.cursor },
        generatedAt: new Date().toISOString(),
        cached: false,
        limitations: ["Full source history, newest source update first. Counts describe this page only. Continue loading to search older records; filtered pages can be empty while older records remain."]
      };
    }
    const cacheHit = this.hasFreshSnapshot(projectId, actor, query.refresh);
    const snapshot = await this.loadSnapshot(projectId, actor, query.refresh);
    const filtered = snapshot.items
      .filter((item) => query.category ? item.category === query.category : true)
      .filter((item) => query.severity ? item.severity === query.severity : true)
      .filter((item) => query.source ? item.sourceType === query.source : true)
      .filter((item) => {
        if (query.status) return item.status === query.status;
        return item.status === "active";
      })
      .filter((item) => {
        if (!query.owner) return true;
        if (query.owner === "unassigned") return !item.owner;
        if (query.owner === "me") return item.owner?.userId === actor.userId;
        return item.owner?.userId === query.owner;
      });
    const afterCursor = query.cursor ? this.afterCursor(filtered, query.cursor) : filtered;
    const pageRows = afterCursor.slice(0, query.limit + 1);
    const hasMore = pageRows.length > query.limit;
    const items = pageRows.slice(0, query.limit);
    const activeItems = snapshot.items.filter((item) => item.status === "active");

    return {
      items,
      members: snapshot.members,
      summary: {
        active: activeItems.length,
        critical: activeItems.filter((item) => item.severity === "critical").length,
        awaitingDecision: activeItems.filter((item) => item.sourceType === "proposal").length,
        assignedToMe: activeItems.filter((item) => item.owner?.userId === actor.userId).length
      },
      countsByCategory: countBy(snapshot.items, "category"),
      countsByStatus: countBy(snapshot.items, "status"),
      sourceStates: snapshot.sourceStates,
      page: {
        limit: query.limit,
        hasMore,
        nextCursor: hasMore && items.length > 0 ? encodeCursor(items[items.length - 1]!) : null
      },
      generatedAt: snapshot.generatedAt,
      cached: cacheHit,
      limitations: snapshot.limitations
    };
  }

  private async loadSourcePage(projectId: string, actor: Actor, query: TruthInboxListQuery) {
    const source = query.source!;
    const member = await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actor.userId);
    const scope = JSON.stringify([projectId, source, query.category, query.severity, query.status, query.owner]);
    let after: { id: string; updatedAt: string } | null = null;
    if (query.cursor) {
      try {
        const value = JSON.parse(Buffer.from(query.cursor, "base64url").toString());
        if (value.scope !== scope || typeof value.id !== "string" || !/^[a-f0-9-]{36}$/i.test(value.id) || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error();
        after = value;
      } catch { throw new AppError(400, "Invalid source-history cursor", "truth_inbox_cursor_invalid"); }
    }
    const items: TruthInboxItem[] = [];
    // Bounded work per request, not a permanent history cutoff. The continuation
    // advances over scanned rows even when a filter produces an empty page.
    for (let batch = 0; batch < 5; batch++) {
      const keyset = after ? { OR: [{ updatedAt: { lt: new Date(after.updatedAt) } }, { updatedAt: new Date(after.updatedAt), id: { gt: after.id } }] } : {};
      const common = { projectId, ...keyset };
      const orderBy = [{ updatedAt: "desc" as const }, { id: "asc" as const }];
      const rows = source === "proposal"
        ? await this.prisma.specChangeProposal.findMany({ where: common, include: { links: true, decisionRecord: true }, orderBy, take: 100 })
        : source === "fde"
          ? await this.prisma.fdeReadinessFinding.findMany({ where: { ...common, orgId: actor.orgId, archivedAt: null, dismissedAt: null }, orderBy, take: 100 })
          : await this.prisma.agentQualityReview.findMany({ where: { ...common, orgId: actor.orgId, archivedAt: null, deletedAt: null,
            AND: [{ OR: [{ needsFollowUp: true }, { recommendation: { in: ["possible_drift", "unsafe_or_noncompliant", "blocked_by_missing_evidence", "needs_human_review"] } }] }] }, orderBy, take: 100 });
      const states = await this.prisma.truthInboxItemState.findMany({ where: { projectId, orgId: actor.orgId, sourceType: source, sourceId: { in: rows.map((row) => row.id) } }, include: { assignedUser: { select: { id: true, displayName: true, email: true } } } });
      const statesById = new Map(states.map((state) => [state.sourceId, state]));
      for (const row of rows) {
        const args = [projectId, row, statesById.get(row.id), member.projectRole === "manager", member.projectRole === "manager" || member.canApproveTruthChanges] as const;
        const item = source === "proposal" ? this.fromProposal(...args) : source === "fde" ? this.fromFde(...args) : this.fromAgentReview(...args);
        const matches = (!query.category || item.category === query.category) && (!query.severity || item.severity === query.severity)
          && item.status === (query.status ?? "active") && (!query.owner || (query.owner === "unassigned" ? !item.owner : item.owner?.userId === (query.owner === "me" ? actor.userId : query.owner)));
        if (matches && items.length === query.limit) return { items, cursor: Buffer.from(JSON.stringify({ ...after, scope })).toString("base64url") };
        after = { id: row.id, updatedAt: row.updatedAt.toISOString() };
        if (matches) items.push(item);
      }
      if (rows.length < 100) return { items, cursor: null };
    }
    return { items, cursor: after ? Buffer.from(JSON.stringify({ ...after, scope })).toString("base64url") : null };
  }

  async get(projectId: string, itemId: string, actor: Actor, refresh = false) {
    const snapshot = await this.loadSnapshot(projectId, actor, refresh);
    const item = snapshot.items.find((candidate) => candidate.id === itemId);
    // Stable proposal links outlive the bounded recent inbox window.
    if (!item && itemId.startsWith("proposal:")) {
      const proposalId = itemId.slice("proposal:".length);
      const member = await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actor.userId);
      const proposal = await this.prisma.specChangeProposal.findFirst({ where: { id: proposalId, projectId, project: { orgId: actor.orgId } }, include: { links: true, decisionRecord: true } });
      if (proposal) {
        const state = await this.prisma.truthInboxItemState.findUnique({ where: { projectId_sourceType_sourceId: { projectId, sourceType: "proposal", sourceId: proposalId } }, include: { assignedUser: { select: { id: true, displayName: true, email: true } } } });
        return this.fromProposal(projectId, proposal, state, member.projectRole === "manager", member.projectRole === "manager" || member.canApproveTruthChanges);
      }
    }
    if (!item && /^(fde|agent_drift):/.test(itemId)) {
      const [source, id] = itemId.split(":");
      const member = await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actor.userId);
      const row = source === "fde"
        ? await this.prisma.fdeReadinessFinding.findFirst({ where: { id, projectId, orgId: actor.orgId, archivedAt: null, dismissedAt: null } })
        : await this.prisma.agentQualityReview.findFirst({ where: { id, projectId, orgId: actor.orgId, archivedAt: null, deletedAt: null } });
      if (row) {
        const state = await this.prisma.truthInboxItemState.findUnique({ where: { projectId_sourceType_sourceId: { projectId, sourceType: source!, sourceId: id! } }, include: { assignedUser: { select: { id: true, displayName: true, email: true } } } });
        const args = [projectId, row, state, member.projectRole === "manager", member.projectRole === "manager" || member.canApproveTruthChanges] as const;
        return source === "fde" ? this.fromFde(...args) : this.fromAgentReview(...args);
      }
    }
    if (!item) throw new AppError(404, "Truth Inbox item not found", "truth_inbox_item_not_found");
    return item;
  }

  async act(projectId: string, itemId: string, action: TruthInboxAction, actor: Actor, input: TruthInboxActionInput) {
    const item = await this.get(projectId, itemId, actor);
    if (!item.capabilities[action]) {
      throw new AppError(403, `The ${action.replace(/_/g, " ")} action is not allowed for this item`, "truth_inbox_action_forbidden");
    }

    if (action === "ask_socrates") {
      const answer = await this.socratesService.askV1ProjectMemory({
        projectId,
        actorUserId: actor.userId,
        question: [
          "Explain this Truth Inbox item using only authoritative project evidence.",
          `Title: ${item.title}`,
          `Category: ${item.category}`,
          `Description: ${item.description}`,
          `Evidence refs: ${item.evidence.map((evidence) => evidence.id).join(", ") || "none"}`,
          "Separate evidence, interpretation, proposed changes, and accepted truth. Do not mutate project truth."
        ].join("\n"),
        mode: "ask",
        includeArtifacts: true,
        includeHistory: false,
        selectedSources: sourceSelections(item)
      });
      await this.recordActionAudit(projectId, item, action, actor, { readOnly: true });
      return { item, outcome: { answer }, action };
    }

    if (action === "accept" || action === "reject") {
      await this.projectService.ensureProjectTruthApprover(projectId, actor.userId);
      if (item.sourceType !== "proposal") throw new AppError(409, "Only review proposals can be accepted or rejected", "truth_inbox_decision_invalid_source");
      const proposal = action === "accept"
        ? await this.changeProposalService.accept(projectId, item.sourceId, actor.userId)
        : await this.changeProposalService.reject(projectId, item.sourceId, actor.userId);
      await this.upsertState(projectId, actor, item, action, { status: "resolved" });
      await this.recordActionAudit(projectId, item, action, actor, { proposalId: item.sourceId, resultStatus: (proposal as any).status });
      this.clearCache(projectId);
      return { item: null, outcome: { proposal }, action };
    }

    let persistedState: InboxStateRow | null = null;
    if (action === "assign_owner") {
      await this.projectService.ensureProjectMemberCanMutate(projectId, actor.userId, "assign_truth_inbox_owner");
      const assignedUserId = input.assignedUserId ?? null;
      if (assignedUserId) await this.ensureAssignableMember(projectId, assignedUserId);
      persistedState = await this.upsertState(projectId, actor, item, action, { assignedUserId });
    } else if (action === "request_clarification") {
      await this.projectService.ensureProjectMemberCanMutate(projectId, actor.userId, "request_truth_inbox_clarification");
      if (!input.note) throw new AppError(400, "A clarification request is required", "truth_inbox_clarification_required");
      persistedState = await this.upsertState(projectId, actor, item, action, {
        clarificationNote: input.note,
        clarificationRequestedAt: new Date(),
        clarificationRequestedByUserId: actor.userId
      });
    } else if (action === "defer") {
      await this.projectService.ensureProjectMemberCanMutate(projectId, actor.userId, "defer_truth_inbox_item");
      const until = input.until ? this.validateFutureDate(input.until, false) : null;
      persistedState = await this.upsertState(projectId, actor, item, action, { status: "deferred", deferredUntil: until });
    } else if (action === "snooze") {
      await this.projectService.ensureProjectMemberCanMutate(projectId, actor.userId, "snooze_truth_inbox_item");
      if (!input.until) throw new AppError(400, "Snooze requires a future end time", "truth_inbox_snooze_until_required");
      persistedState = await this.upsertState(projectId, actor, item, action, { status: "snoozed", snoozedUntil: this.validateFutureDate(input.until, true) });
    } else if (action === "dismiss") {
      await this.projectService.ensureProjectMemberCanMutate(projectId, actor.userId, "dismiss_truth_inbox_item");
      if (item.sourceType === "suggestion") {
        await this.suggestionsService.dismiss(projectId, item.sourceId, actor, input.note);
      }
      persistedState = await this.upsertState(projectId, actor, item, action, { status: "dismissed" });
    } else if (action === "promote_to_timeline") {
      await this.projectService.ensureProjectMemberCanMutate(projectId, actor.userId, "promote_truth_inbox_item");
      const timeline = item.sourceType === "suggestion"
        ? await this.suggestionsService.promoteToTimeline(projectId, item.sourceId, actor)
        : await this.promoteToTimeline(projectId, item, actor);
      const timelineEventRef = String((timeline as any).timelineEvent?.id ?? (timeline as any).id ?? "");
      persistedState = await this.upsertState(projectId, actor, item, action, { status: "converted_to_timeline", timelineEventRef });
    } else if (action === "create_review_item") {
      await this.projectService.ensureProjectTruthApprover(projectId, actor.userId);
      const result = item.sourceType === "suggestion"
        ? await this.suggestionsService.createReviewItem(projectId, item.sourceId, actor)
        : await this.createReviewItem(projectId, item, actor);
      const proposalId = String((result as any).proposal?.id ?? "");
      persistedState = await this.upsertState(projectId, actor, item, action, { status: "converted_to_review", proposalId });
    }

    await this.recordActionAudit(projectId, item, action, actor, {
      assignedUserId: input.assignedUserId ?? null,
      until: input.until ?? null,
      note: input.note ?? null,
      acceptedTruthMutation: false
    });
    this.clearCache(projectId);
    const updatedItem = this.withPersistedState(item, persistedState!);
    return {
      item: updatedItem,
      outcome: null,
      action,
      summaryDelta: this.summaryDelta(item, updatedItem, actor),
      statusDelta: item.status === updatedItem.status ? null : { from: item.status, to: updatedItem.status }
    };
  }

  private async loadSnapshot(projectId: string, actor: Actor, refresh: boolean): Promise<Snapshot> {
    await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actor.userId);
    if (refresh) this.clearCache(projectId);
    const key = `${projectId}:${actor.orgId}:${actor.userId}`;
    const generation = snapshotGenerations.get(projectId) ?? 0;
    const cached = refresh ? null : snapshotCache.get(key);
    if (cached && Date.now() - cached.storedAt < SNAPSHOT_TTL_MS) return cached.value;
    const pending = refresh ? null : snapshotRequests.get(key);
    if (pending) return pending;
    const request = this.buildSnapshot(projectId, actor, refresh)
      .then((value) => {
        if (generation === (snapshotGenerations.get(projectId) ?? 0)) snapshotCache.set(key, { storedAt: Date.now(), value });
        return value;
      })
      .finally(() => {
        if (snapshotRequests.get(key) === request) snapshotRequests.delete(key);
      });
    snapshotRequests.set(key, request);
    return request;
  }

  private async buildSnapshot(projectId: string, actor: Actor, refresh: boolean): Promise<Snapshot> {
    const member = await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actor.userId);
    const project = await this.prisma.project.findFirst({ where: { id: projectId, orgId: actor.orgId }, select: { id: true } });
    if (!project) throw new AppError(404, "Project not found", "project_not_found");
    const suggestionsPromise = this.suggestionsService.list(projectId, actor, {
      includeDismissed: true,
      refresh,
      limit: 100,
      offset: 0
    } as any);
    const [suggestions, proposals, fdeFindings, agentReviews, members] = await Promise.all([
      suggestionsPromise,
      this.prisma.specChangeProposal.findMany({
        where: { projectId },
        include: { links: true, decisionRecord: true },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: 200
      }),
      this.prisma.fdeReadinessFinding.findMany({
        where: { projectId, orgId: actor.orgId, archivedAt: null, dismissedAt: null },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: 150
      }),
      this.prisma.agentQualityReview.findMany({
        where: {
          projectId,
          orgId: actor.orgId,
          archivedAt: null,
          deletedAt: null,
          OR: [
            { needsFollowUp: true },
            { recommendation: { in: ["possible_drift", "unsafe_or_noncompliant", "blocked_by_missing_evidence", "needs_human_review"] } }
          ]
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        take: 50
      }),
      this.prisma.projectMember.findMany({
        where: { projectId, isActive: true, projectRole: { in: ["manager", "dev"] } },
        include: { user: { select: { id: true, displayName: true, email: true, isActive: true } } },
        orderBy: [{ projectRole: "asc" }, { joinedAt: "asc" }],
        take: 200
      })
    ]);
    const states = await this.prisma.truthInboxItemState.findMany({
      where: { projectId, orgId: actor.orgId, OR: [
        { sourceType: "proposal", sourceId: { in: proposals.map((row) => row.id) } },
        { sourceType: "fde", sourceId: { in: fdeFindings.map((row) => row.id) } },
        { sourceType: "agent_drift", sourceId: { in: agentReviews.map((row) => row.id) } },
        { sourceType: "suggestion", sourceId: { in: suggestions.items.map((row) => row.id) } },
        { sourceType: "connector" }
      ] }, include: { assignedUser: { select: { id: true, displayName: true, email: true } } }
    });
    const stateByKey = new Map(states.map((state) => [itemKey(state.sourceType, state.sourceId), state]));
    const internalMembers: TruthInboxMember[] = members
      .filter((row) => row.user.isActive)
      .map((row) => ({
        userId: row.user.id,
        displayName: row.user.displayName,
        email: row.user.email,
        projectRole: row.projectRole as "manager" | "dev",
        canApproveTruthChanges: row.projectRole === "manager" || row.canApproveTruthChanges
      }));
    const canMutate = member.projectRole === "manager";
    const canApprove = member.projectRole === "manager" || member.canApproveTruthChanges;
    const proposalIds = new Set(proposals.map((proposal) => proposal.id));
    const suggestionItems = suggestions.items
      .filter((suggestion) => !suggestion.sourceRefs.some((ref) => ref.type === "spec_change_proposal" && proposalIds.has(ref.id)))
      .map((suggestion) => this.fromSuggestion(projectId, suggestion, stateByKey.get(itemKey("suggestion", suggestion.id)), canMutate, canApprove));
    const items = [
      ...suggestionItems,
      ...proposals.map((proposal) => this.fromProposal(projectId, proposal, stateByKey.get(itemKey("proposal", proposal.id)), canMutate, canApprove)),
      ...fdeFindings.map((finding) => this.fromFde(projectId, finding, stateByKey.get(itemKey("fde", finding.id)), canMutate, canApprove)),
      ...agentReviews.map((review) => this.fromAgentReview(projectId, review, stateByKey.get(itemKey("agent_drift", review.id)), canMutate, canApprove)),
      ...this.connectorItems(projectId, suggestions, stateByKey, canMutate, canApprove)
    ].sort(compareItems);

    return {
      items,
      members: internalMembers,
      sourceStates: suggestions.sourceStates,
      generatedAt: new Date().toISOString(),
      limitations: [
        "Scope-limited recent snapshot: up to 100 suggestions, 200 proposals, 150 FDE findings and 50 agent reviews. Counts describe this snapshot. Choose a Proposal, FDE or Agent drift source filter to page through its full history. All saved actions for displayed items are included.",
        "Inbox items are evidence-backed review signals, not accepted product truth.",
        "See Delivery Control for decision-to-delivery gaps."
      ]
    };
  }

  private fromSuggestion(projectId: string, suggestion: ProjectSuggestion, state: InboxStateRow | undefined, canMutate: boolean, canApprove: boolean): TruthInboxItem {
    const evidence = suggestion.evidence.map((row) => ({
      id: `${row.source}:${row.refId}`,
      source: row.source,
      label: row.label,
      excerpt: row.excerpt,
      occurredAt: row.occurredAt,
      openTarget: row.openTarget ?? null
    }));
    const sourceStatus = normalizeSuggestionStatus(suggestion.status);
    return this.baseItem({
      projectId,
      sourceType: "suggestion",
      sourceId: suggestion.id,
      sourceFingerprint: suggestion.sourceFingerprint,
      category: suggestion.category === "coverage_gaps"
        ? "missing_evidence"
        : suggestion.category === "reviewer_suggestions"
          ? "risk_flags"
          : suggestion.category,
      title: suggestion.title,
      description: suggestion.description,
      severity: suggestion.severity,
      confidence: suggestion.confidence,
      sourceStatus,
      evidence,
      limitations: suggestion.limitations,
      createdAt: suggestion.createdAt,
      updatedAt: suggestion.updatedAt,
      state,
      canMutate,
      canApprove,
      canDecide: false,
      canCreateReview: sourceStatus === "active"
    });
  }

  private fromProposal(projectId: string, proposal: any, state: InboxStateRow | undefined, canMutate: boolean, canApprove: boolean): TruthInboxItem {
    const evidence = [
      ...proposal.links.map((link: any) => evidenceFromProposalLink(link)),
      ...asStringArray(proposal.externalEvidenceRefsJson).map((ref, index) => ({
        id: `external:${ref}`,
        source: "external_evidence",
        label: `External evidence ${index + 1}`,
        excerpt: ref,
        occurredAt: null,
        openTarget: null
      }))
    ];
    const impact = asRecord(proposal.impactSummaryJson);
    const hasSourceEvidence = evidence.length > 0;
    const hasDocumentImpact = proposal.links.some((link: any) => link.linkType === "document_section" && link.relationship === "affected");
    const hasBrainImpact = proposal.links.some((link: any) => link.linkType === "brain_node" && link.relationship === "affected");
    const readinessLimitations = [
      ...(!hasSourceEvidence ? ["This proposal has no resolvable evidence links and cannot be safely accepted."] : []),
      ...(!hasDocumentImpact ? ["An affected LiveDoc or document section must be linked before acceptance."] : []),
      ...(!hasBrainImpact ? ["An affected Product Brain node must be linked before acceptance."] : [])
    ];
    return this.baseItem({
      projectId,
      sourceType: "proposal",
      sourceId: proposal.id,
      sourceFingerprint: `proposal:${proposal.id}:${proposal.updatedAt.toISOString()}`,
      category: proposalCategory(proposal.proposalType),
      title: proposal.title,
      description: proposal.summary,
      severity: normalizeSeverity(impact.severity, proposal.proposalType === "contradiction_resolution" ? "high" : "medium"),
      confidence: normalizeConfidence(impact.confidence, evidence.length > 0 ? 0.85 : 0.55),
      sourceStatus: ["accepted", "rejected", "superseded"].includes(proposal.status) ? "resolved" : "active",
      evidence,
      limitations: readinessLimitations,
      createdAt: proposal.createdAt.toISOString(),
      updatedAt: proposal.updatedAt.toISOString(),
      state,
      canMutate,
      canApprove,
      canDecide: ["detected", "needs_review"].includes(proposal.status),
      canCreateReview: false,
      acceptReady: hasSourceEvidence && hasDocumentImpact && hasBrainImpact
    });
  }

  private fromFde(projectId: string, finding: any, state: InboxStateRow | undefined, canMutate: boolean, canApprove: boolean): TruthInboxItem {
    const citations = asObjectArray(finding.citationsJson);
    const targets = asObjectArray(finding.openTargetsJson);
    const evidence = citations.map((citation, index) => ({
      id: String(citation.id ?? citation.refId ?? `${finding.id}:${index}`),
      source: String(citation.sourceType ?? citation.source ?? "engineering_evidence"),
      label: String(citation.label ?? citation.title ?? `Engineering evidence ${index + 1}`),
      excerpt: stringOrNull(citation.excerpt ?? citation.summary),
      occurredAt: stringOrNull(citation.occurredAt),
      openTarget: openTarget(targets[index] ?? citation.openTarget ?? null)
    }));
    return this.baseItem({
      projectId,
      sourceType: "fde",
      sourceId: finding.id,
      sourceFingerprint: `fde:${finding.findingKey}:${finding.updatedAt.toISOString()}`,
      category: fdeCategory(finding.findingType, finding.findingSubType),
      title: finding.summary,
      description: finding.whyItMatters ?? finding.suggestedAction ?? "Engineering-readiness evidence needs review.",
      severity: normalizeFdeSeverity(finding.severity),
      confidence: normalizeFdeConfidence(finding.confidence),
      sourceStatus: "active",
      evidence,
      limitations: [...asStringArray(finding.limitationsJson), ...(evidence.length === 0 ? ["No directly openable evidence citation is stored for this finding."] : [])],
      createdAt: finding.createdAt.toISOString(),
      updatedAt: finding.updatedAt.toISOString(),
      state,
      canMutate,
      canApprove,
      canDecide: false,
      canCreateReview: true
    });
  }

  private fromAgentReview(projectId: string, review: any, state: InboxStateRow | undefined, canMutate: boolean, canApprove: boolean): TruthInboxItem {
    const citations = asObjectArray(review.citationsJson);
    const targets = asObjectArray(review.openTargetsJson);
    const evidence = citations.map((citation, index) => ({
      id: String(citation.id ?? citation.refId ?? `${review.id}:${index}`),
      source: String(citation.sourceType ?? "agent_review"),
      label: String(citation.label ?? citation.title ?? `Agent review evidence ${index + 1}`),
      excerpt: stringOrNull(citation.excerpt ?? citation.summary),
      occurredAt: stringOrNull(citation.occurredAt),
      openTarget: openTarget(targets[index] ?? citation.openTarget ?? null)
    }));
    return this.baseItem({
      projectId,
      sourceType: "agent_drift",
      sourceId: review.id,
      sourceFingerprint: `agent-review:${review.id}:${review.updatedAt.toISOString()}`,
      category: review.recommendation === "blocked_by_missing_evidence" ? "missing_evidence" : "agent_drift",
      title: `Agent review needs attention: ${review.recommendation.replace(/_/g, " ")}`,
      description: review.summary,
      severity: review.criticalFindingCount > 0 ? "critical" : review.highSeverityFindingCount > 0 ? "high" : "medium",
      confidence: normalizeConfidence(review.overallScore, 0.7),
      sourceStatus: "active",
      evidence,
      limitations: asStringArray(review.limitationsJson),
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
      state,
      canMutate,
      canApprove,
      canDecide: false,
      canCreateReview: true
    });
  }

  private connectorItems(projectId: string, suggestions: SuggestionsListResponse, states: Map<string, InboxStateRow>, canMutate: boolean, canApprove: boolean) {
    return Object.entries(suggestions.sourceStates)
      .filter(([, source]) => source.state === "degraded")
      .map(([provider, source]) => {
        const state = states.get(itemKey("connector", provider));
        const stableTimestamp = state?.updatedAt?.toISOString?.() ?? "1970-01-01T00:00:00.000Z";
        return this.baseItem({
        projectId,
        sourceType: "connector",
        sourceId: provider,
        sourceFingerprint: `connector:${provider}:${source.detail ?? source.state}`,
        category: "connector_health",
        title: `${source.label} freshness needs attention`,
        description: source.detail ?? `${source.label} is degraded.`,
        severity: "high",
        confidence: 1,
        sourceStatus: "active",
        evidence: [],
        limitations: ["Connector health is operational state; it is not product truth."],
        createdAt: stableTimestamp,
        updatedAt: stableTimestamp,
        state,
        canMutate,
        canApprove,
        canDecide: false,
        canCreateReview: true
      });
      });
  }

  private baseItem(input: {
    projectId: string;
    sourceType: TruthInboxSourceType;
    sourceId: string;
    sourceFingerprint: string | null;
    category: TruthInboxCategory;
    title: string;
    description: string;
    severity: TruthInboxSeverity;
    confidence: number;
    sourceStatus: TruthInboxStatus;
    evidence: TruthInboxEvidence[];
    limitations: string[];
    createdAt: string;
    updatedAt: string;
    state?: InboxStateRow;
    canMutate: boolean;
    canApprove: boolean;
    canDecide: boolean;
    canCreateReview: boolean;
    acceptReady?: boolean;
  }): TruthInboxItem {
    const status = effectiveStatus(input.sourceStatus, input.state);
    const active = status === "active";
    return {
      id: itemKey(input.sourceType, input.sourceId),
      projectId: input.projectId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceFingerprint: input.sourceFingerprint,
      category: input.category,
      title: input.title,
      description: input.description,
      severity: input.severity,
      confidence: clamp(input.confidence),
      status,
      sourceLabels: Array.from(new Set(input.evidence.map((evidence) => evidence.source))),
      evidence: input.evidence,
      limitations: input.limitations,
      owner: input.state?.assignedUser ? {
        userId: input.state.assignedUser.id,
        displayName: input.state.assignedUser.displayName,
        email: input.state.assignedUser.email
      } : null,
      clarification: input.state?.clarificationNote && input.state?.clarificationRequestedAt && input.state?.clarificationRequestedByUserId ? {
        note: input.state.clarificationNote,
        requestedAt: input.state.clarificationRequestedAt.toISOString(),
        requestedByUserId: input.state.clarificationRequestedByUserId
      } : null,
      deferredUntil: input.state?.deferredUntil?.toISOString?.() ?? null,
      snoozedUntil: input.state?.snoozedUntil?.toISOString?.() ?? null,
      timelineEventRef: input.state?.timelineEventRef ?? null,
      reviewProposalId: input.state?.proposalId ?? null,
      capabilities: {
        ask_socrates: true,
        assign_owner: input.canMutate && !TERMINAL_STATUSES.has(status),
        request_clarification: input.canMutate && active,
        create_review_item: input.canApprove && active && input.canCreateReview,
        accept: input.canApprove && active && input.canDecide && (input.acceptReady ?? input.evidence.length > 0),
        reject: input.canApprove && active && input.canDecide,
        defer: input.canMutate && active,
        snooze: input.canMutate && active,
        dismiss: input.canMutate && active && !input.canDecide,
        promote_to_timeline: input.canMutate && active
      },
      createdAt: input.createdAt,
      updatedAt: input.state?.updatedAt?.toISOString?.() ?? input.updatedAt
    };
  }

  private withPersistedState(item: TruthInboxItem, state: InboxStateRow): TruthInboxItem {
    const status = effectiveStatus(item.status, state);
    const active = status === "active";
    return {
      ...item,
      status,
      owner: state.assignedUser ? {
        userId: state.assignedUser.id,
        displayName: state.assignedUser.displayName,
        email: state.assignedUser.email
      } : null,
      clarification: state.clarificationNote && state.clarificationRequestedAt && state.clarificationRequestedByUserId ? {
        note: state.clarificationNote,
        requestedAt: state.clarificationRequestedAt.toISOString(),
        requestedByUserId: state.clarificationRequestedByUserId
      } : null,
      deferredUntil: state.deferredUntil?.toISOString?.() ?? null,
      snoozedUntil: state.snoozedUntil?.toISOString?.() ?? null,
      timelineEventRef: state.timelineEventRef ?? null,
      reviewProposalId: state.proposalId ?? null,
      capabilities: {
        ...item.capabilities,
        assign_owner: item.capabilities.assign_owner && !TERMINAL_STATUSES.has(status),
        request_clarification: item.capabilities.request_clarification && active,
        create_review_item: item.capabilities.create_review_item && active,
        accept: item.capabilities.accept && active,
        reject: item.capabilities.reject && active,
        defer: item.capabilities.defer && active,
        snooze: item.capabilities.snooze && active,
        dismiss: item.capabilities.dismiss && active,
        promote_to_timeline: item.capabilities.promote_to_timeline && active
      },
      updatedAt: state.updatedAt?.toISOString?.() ?? item.updatedAt
    };
  }

  private summaryDelta(before: TruthInboxItem, after: TruthInboxItem, actor: Actor) {
    const contribution = (item: TruthInboxItem) => ({
      active: item.status === "active" ? 1 : 0,
      critical: item.status === "active" && item.severity === "critical" ? 1 : 0,
      awaitingDecision: item.status === "active" && item.sourceType === "proposal" ? 1 : 0,
      assignedToMe: item.status === "active" && item.owner?.userId === actor.userId ? 1 : 0
    });
    const previous = contribution(before);
    const next = contribution(after);
    return {
      active: next.active - previous.active,
      critical: next.critical - previous.critical,
      awaitingDecision: next.awaitingDecision - previous.awaitingDecision,
      assignedToMe: next.assignedToMe - previous.assignedToMe
    };
  }

  private afterCursor(items: TruthInboxItem[], rawCursor: string) {
    let cursor: { severity: number; updatedAt: string; id: string };
    try {
      cursor = JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8"));
    } catch {
      throw new AppError(400, "Invalid Truth Inbox cursor", "truth_inbox_cursor_invalid");
    }
    if (!Number.isInteger(cursor.severity) || cursor.severity < 1 || cursor.severity > 4 || !cursor.updatedAt || !cursor.id || Number.isNaN(Date.parse(cursor.updatedAt))) {
      throw new AppError(400, "Invalid Truth Inbox cursor", "truth_inbox_cursor_invalid");
    }
    return items.filter((item) => {
      const rank = severityRank(item.severity);
      if (rank !== cursor.severity) return rank < cursor.severity;
      const time = new Date(item.updatedAt).getTime();
      const cursorTime = new Date(cursor.updatedAt).getTime();
      if (time !== cursorTime) return time < cursorTime;
      return item.id > cursor.id;
    });
  }

  private async ensureAssignableMember(projectId: string, userId: string) {
    const member = await this.prisma.projectMember.findFirst({
      where: { projectId, userId, isActive: true, projectRole: { in: ["manager", "dev"] }, user: { isActive: true } },
      select: { id: true }
    });
    if (!member) throw new AppError(400, "Owner must be an active internal project member", "truth_inbox_owner_invalid");
  }

  private validateFutureDate(raw: string, required: boolean) {
    const date = new Date(raw);
    const now = Date.now();
    if (Number.isNaN(date.getTime()) || date.getTime() <= now) {
      throw new AppError(400, required ? "Snooze end time must be in the future" : "Defer end time must be in the future", "truth_inbox_until_invalid");
    }
    if (date.getTime() > now + 365 * 24 * 60 * 60 * 1000) {
      throw new AppError(400, "Inbox items cannot be deferred or snoozed for more than one year", "truth_inbox_until_too_far");
    }
    return date;
  }

  private async upsertState(
    projectId: string,
    actor: Actor,
    item: TruthInboxItem,
    action: TruthInboxAction,
    values: {
      status?: TruthInboxStatus;
      assignedUserId?: string | null;
      clarificationNote?: string;
      clarificationRequestedAt?: Date;
      clarificationRequestedByUserId?: string;
      deferredUntil?: Date | null;
      snoozedUntil?: Date | null;
      timelineEventRef?: string;
      proposalId?: string;
    }
  ) {
    const update = {
      sourceFingerprint: item.sourceFingerprint,
      lastActionType: action,
      actorUserId: actor.userId,
      ...(values.status !== undefined ? { status: values.status } : {}),
      ...(values.assignedUserId !== undefined ? { assignedUserId: values.assignedUserId } : {}),
      ...(values.clarificationNote !== undefined ? { clarificationNote: values.clarificationNote } : {}),
      ...(values.clarificationRequestedAt !== undefined ? { clarificationRequestedAt: values.clarificationRequestedAt } : {}),
      ...(values.clarificationRequestedByUserId !== undefined ? { clarificationRequestedByUserId: values.clarificationRequestedByUserId } : {}),
      ...(values.deferredUntil !== undefined ? { deferredUntil: values.deferredUntil } : {}),
      ...(values.snoozedUntil !== undefined ? { snoozedUntil: values.snoozedUntil } : {}),
      ...(values.timelineEventRef !== undefined ? { timelineEventRef: values.timelineEventRef } : {}),
      ...(values.proposalId !== undefined ? { proposalId: values.proposalId } : {})
    };
    return this.prisma.truthInboxItemState.upsert({
      where: { projectId_sourceType_sourceId: { projectId, sourceType: item.sourceType, sourceId: item.sourceId } },
      create: {
        orgId: actor.orgId,
        projectId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        sourceFingerprint: item.sourceFingerprint,
        status: values.status ?? "active",
        assignedUserId: values.assignedUserId ?? null,
        clarificationNote: values.clarificationNote ?? null,
        clarificationRequestedAt: values.clarificationRequestedAt ?? null,
        clarificationRequestedByUserId: values.clarificationRequestedByUserId ?? null,
        deferredUntil: values.deferredUntil ?? null,
        snoozedUntil: values.snoozedUntil ?? null,
        timelineEventRef: values.timelineEventRef ?? null,
        proposalId: values.proposalId ?? null,
        lastActionType: action,
        actorUserId: actor.userId
      },
      update,
      include: { assignedUser: { select: { id: true, displayName: true, email: true } } }
    });
  }

  private async promoteToTimeline(projectId: string, item: TruthInboxItem, actor: Actor) {
    return this.betaTimelineService.createManualEvent(projectId, actor.userId, {
      title: `Truth Inbox: ${item.title}`.slice(0, 255),
      description: `${item.description}\n\nEvidence: ${item.evidence.map((evidence) => evidence.label).join("; ") || "No direct citation stored"}`,
      source: "manual",
      sourceRef: item.id,
      eventType: "note",
      tier: item.severity === "critical" || item.severity === "high" ? "milestone" : "atomic",
      linkedRefType: "truth_inbox_item",
      linkedRefId: item.id
    });
  }

  private async createReviewItem(projectId: string, item: TruthInboxItem, actor: Actor) {
    const evidenceRefs = item.evidence.map((evidence) => evidence.id);
    if (evidenceRefs.length === 0 && item.sourceFingerprint) evidenceRefs.push(`truth_inbox_source:${item.id}:${item.sourceFingerprint}`);
    return this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`inbox-review:${projectId}:${item.id}`}, 0))::text`;
    const prior = await tx.truthInboxItemState.findUnique({ where: { projectId_sourceType_sourceId: { projectId, sourceType: item.sourceType, sourceId: item.sourceId } } });
    if (prior?.proposalId) {
      const proposal = await tx.specChangeProposal.findFirstOrThrow({ where: { id: prior.proposalId, projectId } });
      return { proposal, autoAccepted: false };
    }
    const proposal = await tx.specChangeProposal.create({
      data: {
        projectId,
        title: `Truth Inbox review: ${item.title}`.slice(0, 255),
        summary: item.description,
        proposalType: item.category === "decision_conflicts" ? "contradiction_resolution" : item.category === "spec_drift" ? "requirement_change" : "clarification",
        status: "needs_review",
        sourceMessageCount: item.evidence.filter((evidence) => /message|communication|slack|teams/i.test(evidence.source)).length,
        newUnderstandingJson: { source: "truth_inbox", itemId: item.id, proposedReviewOnly: true } as Prisma.InputJsonValue,
        impactSummaryJson: { severity: item.severity, confidence: item.confidence, limitations: item.limitations } as Prisma.InputJsonValue,
        externalEvidenceRefsJson: evidenceRefs
      }
    });
    await tx.truthInboxItemState.upsert({
      where: { projectId_sourceType_sourceId: { projectId, sourceType: item.sourceType, sourceId: item.sourceId } },
      create: { projectId, orgId: actor.orgId, sourceType: item.sourceType, sourceId: item.sourceId, sourceFingerprint: item.sourceFingerprint, proposalId: proposal.id, status: "converted_to_review", actorUserId: actor.userId, lastActionType: "create_review_item" },
      update: { proposalId: proposal.id, status: "converted_to_review", actorUserId: actor.userId, lastActionType: "create_review_item" },
    });
    await this.auditService.recordWithClient(tx, { orgId: actor.orgId, projectId, actorUserId: actor.userId, eventType: "truth_inbox.review_item_created", entityType: "truth_inbox_item", entityId: item.id, payload: { proposalId: proposal.id, autoAccepted: false } });
    return { proposal, autoAccepted: false };
    });
  }

  private async recordActionAudit(projectId: string, item: TruthInboxItem, action: TruthInboxAction, actor: Actor, payload: Record<string, unknown>) {
    await this.auditService.record({
      orgId: actor.orgId,
      projectId,
      actorUserId: actor.userId,
      eventType: `truth_inbox.${action}`,
      entityType: "truth_inbox_item",
      entityId: item.id,
      payload: { sourceType: item.sourceType, sourceId: item.sourceId, sourceFingerprint: item.sourceFingerprint, ...payload }
    });
  }

  private clearCache(projectId: string) {
    snapshotGenerations.set(projectId, (snapshotGenerations.get(projectId) ?? 0) + 1);
    for (const key of snapshotCache.keys()) if (key.startsWith(`${projectId}:`)) snapshotCache.delete(key);
    for (const key of snapshotRequests.keys()) if (key.startsWith(`${projectId}:`)) snapshotRequests.delete(key);
  }

  private hasFreshSnapshot(projectId: string, actor: Actor, refresh: boolean) {
    if (refresh) return false;
    const cached = snapshotCache.get(`${projectId}:${actor.orgId}:${actor.userId}`);
    return Boolean(cached && Date.now() - cached.storedAt < SNAPSHOT_TTL_MS);
  }
}

function itemKey(sourceType: string, sourceId: string) {
  if (!SOURCE_TYPES.has(sourceType as TruthInboxSourceType)) throw new AppError(400, "Invalid Truth Inbox source", "truth_inbox_source_invalid");
  return `${sourceType}:${sourceId}`;
}

function effectiveStatus(sourceStatus: TruthInboxStatus, state?: InboxStateRow): TruthInboxStatus {
  if (sourceStatus !== "active") return sourceStatus;
  if (!state) return "active";
  if (state.status === "snoozed" && state.snoozedUntil && state.snoozedUntil.getTime() <= Date.now()) return "active";
  if (state.status === "deferred" && state.deferredUntil && state.deferredUntil.getTime() <= Date.now()) return "active";
  return state.status as TruthInboxStatus;
}

function normalizeSuggestionStatus(status: string): TruthInboxStatus {
  return ["dismissed", "resolved", "converted_to_review", "converted_to_timeline"].includes(status)
    ? status as TruthInboxStatus
    : "active";
}

function evidenceFromProposalLink(link: any): TruthInboxEvidence {
  const target = link.linkType === "message"
    ? { targetType: "message", targetRef: { messageId: link.linkRefId } }
    : link.linkType === "thread"
      ? { targetType: "thread", targetRef: { threadId: link.linkRefId } }
      : link.linkType === "document_section"
        ? { targetType: "live_doc_section", targetRef: { sectionKey: `doc:${link.linkRefId}`, documentSectionId: link.linkRefId } }
        : link.linkType === "brain_node"
          ? { targetType: "product_brain_node", targetRef: { brainNodeId: link.linkRefId } }
          : null;
  return {
    id: `${link.linkType}:${link.linkRefId}`,
    source: link.linkType,
    label: `${String(link.relationship).replace(/_/g, " ")} ${String(link.linkType).replace(/_/g, " ")}`,
    excerpt: null,
    occurredAt: link.createdAt?.toISOString?.() ?? null,
    openTarget: target
  };
}

function proposalCategory(proposalType: string): TruthInboxCategory {
  if (proposalType === "requirement_change") return "spec_drift";
  if (proposalType === "clarification") return "missing_evidence";
  return "decision_conflicts";
}

function fdeCategory(findingType: string, findingSubType: string): TruthInboxCategory {
  if (findingType === "safe_to_touch") return "safe_to_touch";
  if (findingType === "duplicate_work") return "stalled_work";
  if (findingType === "conflict" && /decision|truth|requirement/i.test(findingSubType)) return "decision_conflicts";
  if (findingType === "conflict") return "merge_conflicts";
  return "risk_flags";
}

function normalizeFdeSeverity(value: unknown): TruthInboxSeverity {
  if (value === "blocking") return "critical";
  if (value === "watch") return "high";
  return "low";
}

function normalizeFdeConfidence(value: unknown) {
  return ({ exact: 0.98, high: 0.85, medium: 0.68, low: 0.4, unknown: 0.25 } as Record<string, number>)[String(value)] ?? 0.5;
}

function normalizeSeverity(value: unknown, fallback: TruthInboxSeverity): TruthInboxSeverity {
  return ["low", "medium", "high", "critical"].includes(String(value)) ? value as TruthInboxSeverity : fallback;
}

function normalizeConfidence(value: unknown, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return number > 1 ? number / 100 : number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asObjectArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function openTarget(value: unknown) {
  const record = asRecord(value);
  const targetType = typeof record.targetType === "string" ? record.targetType : typeof record.target_type === "string" ? record.target_type : null;
  const targetRef = asRecord(record.targetRef ?? record.target_ref);
  return targetType && Object.keys(targetRef).length > 0 ? { targetType, targetRef } : null;
}

function severityRank(value: TruthInboxSeverity) {
  return ({ low: 1, medium: 2, high: 3, critical: 4 } as const)[value];
}

function compareItems(left: TruthInboxItem, right: TruthInboxItem) {
  return severityRank(right.severity) - severityRank(left.severity)
    || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    || left.id.localeCompare(right.id);
}

function encodeCursor(item: TruthInboxItem) {
  return Buffer.from(JSON.stringify({ severity: severityRank(item.severity), updatedAt: item.updatedAt, id: item.id })).toString("base64url");
}

function countBy<T extends TruthInboxItem, K extends "category" | "status">(items: T[], key: K) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = item[key];
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function sourceSelections(item: TruthInboxItem) {
  const selected = new Set<string>();
  for (const source of item.sourceLabels) {
    if (/github|engineering|fde/i.test(source)) selected.add("github");
    else if (/document|drive/i.test(source)) selected.add("documents");
    else if (/notion/i.test(source)) selected.add("notion");
    else if (/message|thread|slack|teams|communication/i.test(source)) selected.add("communications");
    else if (/timeline|event/i.test(source)) selected.add("timeline");
    else if (/brain|live_doc/i.test(source)) selected.add("live_doc");
    else if (/member|responsibil/i.test(source)) selected.add("team");
    else if (/vscode|agent/i.test(source)) selected.add("vscode");
  }
  return Array.from(selected);
}
