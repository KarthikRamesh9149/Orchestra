import { Prisma, type BillingType, type DeadlineStatus, type PrismaClient, type ProjectEventSource, type ProjectEventType, type ProjectRole, type SubscriptionStatus } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";
import type { JobDispatcher } from "../../lib/jobs/types.js";
import { AuditService } from "../audit/service.js";
import { ProjectService } from "../projects/service.js";
import { assertProjectOpsReadable } from "./authz.js";
import {
  calculateDaysLeft,
  decimalToNumber,
  type ProjectOpsCalendarDay,
  type ProjectOpsDeadlineItem,
  type ProjectOpsFinancialSummary,
  type ProjectOpsMeetingListItem,
  type ProjectOpsSubscriptionItem
} from "./read-models.js";

type MeetingRangeQuery = {
  from?: string;
  to?: string;
  limit?: number;
};

type DeadlineRangeQuery = {
  from?: string;
  to?: string;
  limit?: number;
};

export type ProjectOpsProjectSummary = {
  meetings: {
    upcoming: ProjectOpsMeetingListItem[];
    todayCount: number;
    thisWeekCount: number;
  };
  deadlines: {
    upcoming: ProjectOpsDeadlineItem[];
    urgentCount: number;
    criticalCount: number;
    completedCount: number;
  };
  financials: ProjectOpsFinancialSummary;
  subscriptions: {
    activeCount: number;
    monthlyCost: number;
    annualCost: number;
    items: ProjectOpsSubscriptionItem[];
  };
};

export type ProjectOpsGeneralSummary = {
  meetings: {
    upcoming: ProjectOpsMeetingListItem[];
    upcomingCount: number;
    todayCount: number;
    thisWeekCount: number;
  };
  deadlines: {
    upcoming: ProjectOpsDeadlineItem[];
    urgentCount: number;
    criticalCount: number;
  };
};

export class ProjectOpsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly jobs: JobDispatcher
  ) {}

  async listMeetings(projectId: string, actorUserId: string, query: MeetingRangeQuery = {}) {
    await this.ensureReadableProject(projectId, actorUserId);
    const range = this.resolveRange(query);
    const meetings = await this.prisma.projectEvent.findMany({
      where: {
        projectId,
        startsAt: {
          gte: range.from,
          lte: range.to
        }
      },
      include: {
        project: {
          select: { id: true, name: true }
        }
      },
      orderBy: [{ startsAt: "asc" }],
      take: query.limit ?? 50
    });

    return meetings.map((meeting) => this.toMeetingListItem(meeting));
  }

  async getMeeting(projectId: string, meetingId: string, actorUserId: string) {
    await this.ensureReadableProject(projectId, actorUserId);
    const meeting = await this.prisma.projectEvent.findFirst({
      where: { id: meetingId, projectId },
      include: {
        project: { select: { id: true, name: true } }
      }
    });
    if (!meeting) {
      throw new AppError(404, "Meeting not found", "project_event_not_found");
    }
    return this.toMeetingListItem(meeting);
  }

  async createMeeting(
    projectId: string,
    actorUserId: string,
    input: {
      title: string;
      description?: string | null;
      eventType: ProjectEventType;
      startsAt: string;
      endsAt?: string | null;
      timezone?: string | null;
      linkedRefType?: string | null;
      linkedRefId?: string | null;
      isAllDay?: boolean;
      source?: ProjectEventSource;
    }
  ) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, orgId: true, name: true }
    });
    const startsAt = new Date(input.startsAt);
    const endsAt = input.endsAt ? new Date(input.endsAt) : null;
    this.assertMeetingBounds(startsAt, endsAt);

    const meeting = await this.prisma.projectEvent.create({
      data: {
        orgId: project.orgId,
        projectId,
        title: input.title,
        description: input.description ?? null,
        eventType: input.eventType,
        source: input.source ?? "manual",
        startsAt,
        endsAt,
        timezone: input.timezone ?? null,
        createdBy: actorUserId,
        linkedRefType: input.linkedRefType ?? null,
        linkedRefId: input.linkedRefId ?? null,
        isAllDay: input.isAllDay ?? false
      },
      include: {
        project: { select: { id: true, name: true } }
      }
    });

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "project_event_created",
      entityType: "project_event",
      entityId: meeting.id,
      payload: {
        title: meeting.title,
        eventType: meeting.eventType
      }
    });

    await this.refreshDashboards(projectId, "project_event_created");
    return this.toMeetingListItem(meeting);
  }

  async createMeetingFromSocratesAction(
    projectId: string,
    actorUserId: string,
    input: {
      title: string;
      description?: string | null;
      eventType: ProjectEventType;
      startsAt: string;
      endsAt?: string | null;
      timezone?: string | null;
      linkedRefType?: string | null;
      linkedRefId?: string | null;
      isAllDay?: boolean;
      source?: ProjectEventSource;
    }
  ) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, orgId: true, name: true }
    });
    const startsAt = new Date(input.startsAt);
    const endsAt = input.endsAt ? new Date(input.endsAt) : null;
    this.assertMeetingBounds(startsAt, endsAt);

    const meeting = await this.prisma.projectEvent.create({
      data: {
        orgId: project.orgId,
        projectId,
        title: input.title,
        description: input.description ?? null,
        eventType: input.eventType,
        source: input.source ?? "manual",
        startsAt,
        endsAt,
        timezone: input.timezone ?? null,
        createdBy: actorUserId,
        linkedRefType: input.linkedRefType ?? null,
        linkedRefId: input.linkedRefId ?? null,
        isAllDay: input.isAllDay ?? false
      },
      include: {
        project: { select: { id: true, name: true } }
      }
    });

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "project_event_created",
      entityType: "project_event",
      entityId: meeting.id,
      payload: {
        title: meeting.title,
        eventType: meeting.eventType,
        sourceLabel: "socrates_action"
      }
    });

    await this.refreshDashboards(projectId, "project_event_created");
    return this.toMeetingListItem(meeting);
  }

  async updateMeeting(
    projectId: string,
    meetingId: string,
    actorUserId: string,
    input: {
      title?: string;
      description?: string | null;
      eventType?: ProjectEventType;
      startsAt?: string;
      endsAt?: string | null;
      timezone?: string | null;
      linkedRefType?: string | null;
      linkedRefId?: string | null;
      isAllDay?: boolean;
    }
  ) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const existing = await this.prisma.projectEvent.findFirst({
      where: { id: meetingId, projectId },
      include: {
        project: { select: { id: true, name: true, orgId: true } }
      }
    });
    if (!existing) {
      throw new AppError(404, "Meeting not found", "project_event_not_found");
    }

    const nextStartsAt = input.startsAt ? new Date(input.startsAt) : existing.startsAt;
    const nextEndsAt =
      input.endsAt !== undefined ? (input.endsAt ? new Date(input.endsAt) : null) : existing.endsAt;
    this.assertMeetingBounds(nextStartsAt, nextEndsAt);

    const meeting = await this.prisma.projectEvent.update({
      where: { id: meetingId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.eventType !== undefined ? { eventType: input.eventType } : {}),
        ...(input.startsAt !== undefined ? { startsAt: nextStartsAt } : {}),
        ...(input.endsAt !== undefined ? { endsAt: nextEndsAt } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone ?? null } : {}),
        ...(input.linkedRefType !== undefined ? { linkedRefType: input.linkedRefType ?? null } : {}),
        ...(input.linkedRefId !== undefined ? { linkedRefId: input.linkedRefId ?? null } : {}),
        ...(input.isAllDay !== undefined ? { isAllDay: input.isAllDay } : {})
      },
      include: {
        project: { select: { id: true, name: true } }
      }
    });

    await this.auditService.record({
      orgId: existing.project.orgId,
      projectId,
      actorUserId,
      eventType: "project_event_updated",
      entityType: "project_event",
      entityId: meeting.id,
      payload: {
        title: meeting.title,
        eventType: meeting.eventType
      }
    });

    await this.refreshDashboards(projectId, "project_event_updated");
    return this.toMeetingListItem(meeting);
  }

  async deleteMeeting(projectId: string, meetingId: string, actorUserId: string) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const existing = await this.prisma.projectEvent.findFirst({
      where: { id: meetingId, projectId },
      include: {
        project: { select: { orgId: true } }
      }
    });
    if (!existing) {
      throw new AppError(404, "Meeting not found", "project_event_not_found");
    }

    await this.prisma.projectEvent.delete({
      where: { id: meetingId }
    });

    await this.auditService.record({
      orgId: existing.project.orgId,
      projectId,
      actorUserId,
      eventType: "project_event_deleted",
      entityType: "project_event",
      entityId: meetingId,
      payload: { title: existing.title, eventType: existing.eventType }
    });

    await this.refreshDashboards(projectId, "project_event_deleted");
    return { ok: true };
  }

  async listDeadlines(projectId: string, actorUserId: string, query: DeadlineRangeQuery = {}) {
    await this.ensureReadableProject(projectId, actorUserId);
    const range = this.resolveRange(query);
    const deadlines = await this.prisma.projectDeadline.findMany({
      where: {
        projectId,
        dueAt: {
          gte: range.from,
          lte: range.to
        }
      },
      include: {
        project: { select: { id: true, name: true } }
      },
      orderBy: [{ dueAt: "asc" }],
      take: query.limit ?? 50
    });

    return deadlines.map((deadline) => this.toDeadlineItem(deadline));
  }

  async getDeadline(projectId: string, deadlineId: string, actorUserId: string) {
    await this.ensureReadableProject(projectId, actorUserId);
    const deadline = await this.prisma.projectDeadline.findFirst({
      where: { id: deadlineId, projectId },
      include: {
        project: { select: { id: true, name: true } }
      }
    });
    if (!deadline) {
      throw new AppError(404, "Deadline not found", "project_deadline_not_found");
    }
    return this.toDeadlineItem(deadline);
  }

  async createDeadline(
    projectId: string,
    actorUserId: string,
    input: {
      title: string;
      description?: string | null;
      dueAt: string;
      status: DeadlineStatus;
      linkedRefType?: string | null;
      linkedRefId?: string | null;
    }
  ) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, orgId: true, name: true }
    });

    const deadline = await this.prisma.projectDeadline.create({
      data: {
        orgId: project.orgId,
        projectId,
        title: input.title,
        description: input.description ?? null,
        dueAt: new Date(input.dueAt),
        status: input.status,
        linkedRefType: input.linkedRefType ?? null,
        linkedRefId: input.linkedRefId ?? null,
        createdBy: actorUserId,
        completedAt: input.status === "completed" ? new Date() : null
      },
      include: {
        project: { select: { id: true, name: true } }
      }
    });

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "project_deadline_created",
      entityType: "project_deadline",
      entityId: deadline.id,
      payload: {
        title: deadline.title,
        status: deadline.status
      }
    });

    await this.refreshDashboards(projectId, "project_deadline_created");
    return this.toDeadlineItem(deadline);
  }

  async updateDeadline(
    projectId: string,
    deadlineId: string,
    actorUserId: string,
    input: {
      title?: string;
      description?: string | null;
      dueAt?: string;
      status?: DeadlineStatus;
      linkedRefType?: string | null;
      linkedRefId?: string | null;
    }
  ) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const existing = await this.prisma.projectDeadline.findFirst({
      where: { id: deadlineId, projectId },
      include: {
        project: { select: { orgId: true } }
      }
    });
    if (!existing) {
      throw new AppError(404, "Deadline not found", "project_deadline_not_found");
    }

    const nextStatus = input.status ?? existing.status;
    const deadline = await this.prisma.projectDeadline.update({
      where: { id: deadlineId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.dueAt !== undefined ? { dueAt: new Date(input.dueAt) } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.linkedRefType !== undefined ? { linkedRefType: input.linkedRefType ?? null } : {}),
        ...(input.linkedRefId !== undefined ? { linkedRefId: input.linkedRefId ?? null } : {}),
        completedAt:
          nextStatus === "completed"
            ? existing.completedAt ?? new Date()
            : null
      },
      include: {
        project: { select: { id: true, name: true } }
      }
    });

    await this.auditService.record({
      orgId: existing.project.orgId,
      projectId,
      actorUserId,
      eventType: "project_deadline_updated",
      entityType: "project_deadline",
      entityId: deadline.id,
      payload: {
        title: deadline.title,
        status: deadline.status
      }
    });

    await this.refreshDashboards(projectId, "project_deadline_updated");
    return this.toDeadlineItem(deadline);
  }

  async deleteDeadline(projectId: string, deadlineId: string, actorUserId: string) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const existing = await this.prisma.projectDeadline.findFirst({
      where: { id: deadlineId, projectId },
      include: {
        project: { select: { orgId: true } }
      }
    });
    if (!existing) {
      throw new AppError(404, "Deadline not found", "project_deadline_not_found");
    }

    await this.prisma.projectDeadline.delete({
      where: { id: deadlineId }
    });

    await this.auditService.record({
      orgId: existing.project.orgId,
      projectId,
      actorUserId,
      eventType: "project_deadline_deleted",
      entityType: "project_deadline",
      entityId: deadlineId,
      payload: { title: existing.title, status: existing.status }
    });

    await this.refreshDashboards(projectId, "project_deadline_deleted");
    return { ok: true };
  }

  async getFinancialSummary(projectId: string, actorUserId: string): Promise<ProjectOpsFinancialSummary> {
    await this.ensureReadableProject(projectId, actorUserId);
    const summary = await this.prisma.projectFinancialSummary.findUnique({
      where: { projectId }
    });

    if (!summary) {
      return {
        projectId,
        currency: "USD",
        budgetAmount: null,
        spentAmount: 0,
        remainingAmount: null,
        notes: null,
        updatedAt: null
      };
    }

    return this.toFinancialSummary(summary);
  }

  async updateFinancialSummary(
    projectId: string,
    actorUserId: string,
    input: {
      currency?: string;
      budgetAmount?: number | null;
      spentAmount?: number;
      notes?: string | null;
    }
  ) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { orgId: true }
    });

    const summary = await this.prisma.projectFinancialSummary.upsert({
      where: { projectId },
      update: {
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.budgetAmount !== undefined
          ? { budgetAmount: input.budgetAmount == null ? null : new Prisma.Decimal(input.budgetAmount.toFixed(2)) }
          : {}),
        ...(input.spentAmount !== undefined ? { spentAmount: new Prisma.Decimal(input.spentAmount.toFixed(2)) } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
        updatedBy: actorUserId
      },
      create: {
        orgId: project.orgId,
        projectId,
        currency: input.currency ?? "USD",
        budgetAmount:
          input.budgetAmount == null ? null : new Prisma.Decimal(input.budgetAmount.toFixed(2)),
        spentAmount: new Prisma.Decimal((input.spentAmount ?? 0).toFixed(2)),
        notes: input.notes ?? null,
        updatedBy: actorUserId
      }
    });

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "project_financial_summary_updated",
      entityType: "project_financial_summary",
      entityId: summary.id,
      payload: {
        currency: summary.currency,
        budgetAmount: decimalToNumber(summary.budgetAmount),
        spentAmount: decimalToNumber(summary.spentAmount)
      }
    });

    await this.refreshDashboards(projectId, "project_financial_summary_updated");
    return this.toFinancialSummary(summary);
  }

  async listSubscriptions(projectId: string, actorUserId: string) {
    await this.ensureReadableProject(projectId, actorUserId);
    const subscriptions = await this.prisma.projectSubscription.findMany({
      where: { projectId },
      orderBy: [{ status: "asc" }, { name: "asc" }]
    });

    return subscriptions.map((subscription) => this.toSubscriptionItem(subscription));
  }

  async getSubscription(projectId: string, subscriptionId: string, actorUserId: string) {
    await this.ensureReadableProject(projectId, actorUserId);
    const subscription = await this.prisma.projectSubscription.findFirst({
      where: { id: subscriptionId, projectId }
    });
    if (!subscription) {
      throw new AppError(404, "Subscription not found", "project_subscription_not_found");
    }
    return this.toSubscriptionItem(subscription);
  }

  async createSubscription(
    projectId: string,
    actorUserId: string,
    input: {
      name: string;
      category: string;
      cost: number;
      billingType: BillingType;
      status: SubscriptionStatus;
      provider?: string | null;
      externalRef?: string | null;
      renewsAt?: string | null;
    }
  ) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { orgId: true }
    });

    const subscription = await this.prisma.projectSubscription.create({
      data: {
        orgId: project.orgId,
        projectId,
        name: input.name,
        category: input.category,
        cost: new Prisma.Decimal(input.cost.toFixed(2)),
        billingType: input.billingType,
        status: input.status,
        provider: input.provider ?? null,
        externalRef: input.externalRef ?? null,
        renewsAt: input.renewsAt ? new Date(input.renewsAt) : null,
        createdBy: actorUserId
      }
    });

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "project_subscription_created",
      entityType: "project_subscription",
      entityId: subscription.id,
      payload: {
        name: subscription.name,
        billingType: subscription.billingType,
        status: subscription.status
      }
    });

    await this.refreshDashboards(projectId, "project_subscription_created");
    return this.toSubscriptionItem(subscription);
  }

  async updateSubscription(
    projectId: string,
    subscriptionId: string,
    actorUserId: string,
    input: {
      name?: string;
      category?: string;
      cost?: number;
      billingType?: BillingType;
      status?: SubscriptionStatus;
      provider?: string | null;
      externalRef?: string | null;
      renewsAt?: string | null;
    }
  ) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const existing = await this.prisma.projectSubscription.findFirst({
      where: { id: subscriptionId, projectId },
      include: {
        organization: { select: { id: true } }
      }
    });
    if (!existing) {
      throw new AppError(404, "Subscription not found", "project_subscription_not_found");
    }

    const subscription = await this.prisma.projectSubscription.update({
      where: { id: subscriptionId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.cost !== undefined ? { cost: new Prisma.Decimal(input.cost.toFixed(2)) } : {}),
        ...(input.billingType !== undefined ? { billingType: input.billingType } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.provider !== undefined ? { provider: input.provider ?? null } : {}),
        ...(input.externalRef !== undefined ? { externalRef: input.externalRef ?? null } : {}),
        ...(input.renewsAt !== undefined ? { renewsAt: input.renewsAt ? new Date(input.renewsAt) : null } : {})
      }
    });

    await this.auditService.record({
      orgId: existing.orgId,
      projectId,
      actorUserId,
      eventType: "project_subscription_updated",
      entityType: "project_subscription",
      entityId: subscription.id,
      payload: {
        name: subscription.name,
        billingType: subscription.billingType,
        status: subscription.status
      }
    });

    await this.refreshDashboards(projectId, "project_subscription_updated");
    return this.toSubscriptionItem(subscription);
  }

  async deleteSubscription(projectId: string, subscriptionId: string, actorUserId: string) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const existing = await this.prisma.projectSubscription.findFirst({
      where: { id: subscriptionId, projectId }
    });
    if (!existing) {
      throw new AppError(404, "Subscription not found", "project_subscription_not_found");
    }

    await this.prisma.projectSubscription.delete({
      where: { id: subscriptionId }
    });

    await this.auditService.record({
      orgId: existing.orgId,
      projectId,
      actorUserId,
      eventType: "project_subscription_deleted",
      entityType: "project_subscription",
      entityId: subscriptionId,
      payload: {
        name: existing.name,
        billingType: existing.billingType,
        status: existing.status
      }
    });

    await this.refreshDashboards(projectId, "project_subscription_deleted");
    return { ok: true };
  }

  async getCalendar(
    input: {
      actorUserId: string;
      orgId: string;
      projectId?: string;
      from?: string;
      to?: string;
      month?: string;
    }
  ) {
    const range = this.resolveCalendarRange(input);

    if (input.projectId) {
      await this.ensureReadableProject(input.projectId, input.actorUserId);
    }

    const meetingWhere = input.projectId
      ? {
          projectId: input.projectId,
          startsAt: { gte: range.from, lte: range.to }
        }
      : {
          orgId: input.orgId,
          startsAt: { gte: range.from, lte: range.to }
        };

    const deadlineWhere = input.projectId
      ? {
          projectId: input.projectId,
          dueAt: { gte: range.from, lte: range.to }
        }
      : {
          orgId: input.orgId,
          dueAt: { gte: range.from, lte: range.to }
        };

    const [meetings, deadlines] = await Promise.all([
      this.prisma.projectEvent.findMany({
        where: meetingWhere,
        include: {
          project: { select: { id: true, name: true } }
        },
        orderBy: [{ startsAt: "asc" }]
      }),
      this.prisma.projectDeadline.findMany({
        where: deadlineWhere,
        include: {
          project: { select: { id: true, name: true } }
        },
        orderBy: [{ dueAt: "asc" }]
      })
    ]);

    const dayMap = new Map<string, ProjectOpsCalendarDay>();
    const pushDay = (date: string) => {
      if (!dayMap.has(date)) {
        dayMap.set(date, { date, meetings: [], deadlines: [] });
      }
      return dayMap.get(date)!;
    };

    for (const meeting of meetings) {
      pushDay(meeting.startsAt.toISOString().slice(0, 10)).meetings.push(this.toMeetingListItem(meeting));
    }
    for (const deadline of deadlines) {
      pushDay(deadline.dueAt.toISOString().slice(0, 10)).deadlines.push(this.toDeadlineItem(deadline));
    }

    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      days: Array.from(dayMap.values()).sort((left, right) => left.date.localeCompare(right.date))
    };
  }

  async buildProjectSummary(projectId: string): Promise<ProjectOpsProjectSummary> {
    const now = new Date();
    const upcomingTo = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const weekTo = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const deadlineWindowStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const [meetings, deadlines, financialSummary, subscriptions] = await Promise.all([
      this.prisma.projectEvent.findMany({
        where: {
          projectId,
          startsAt: { gte: now, lte: upcomingTo }
        },
        include: {
          project: { select: { id: true, name: true } }
        },
        orderBy: [{ startsAt: "asc" }]
      }),
      this.prisma.projectDeadline.findMany({
        where: {
          projectId,
          dueAt: { gte: deadlineWindowStart, lte: upcomingTo }
        },
        include: {
          project: { select: { id: true, name: true } }
        },
        orderBy: [{ dueAt: "asc" }]
      }),
      this.prisma.projectFinancialSummary.findUnique({
        where: { projectId }
      }),
      this.prisma.projectSubscription.findMany({
        where: { projectId },
        orderBy: [{ status: "asc" }, { renewsAt: "asc" }, { name: "asc" }],
        take: 6
      })
    ]);

    const meetingItems = meetings.map((meeting) => this.toMeetingListItem(meeting));
    const deadlineItems = deadlines.map((deadline) => this.toDeadlineItem(deadline, now));
    const openDeadlineItems = deadlineItems.filter((deadline) => deadline.status !== "completed");

    return {
      meetings: {
        upcoming: meetingItems.slice(0, 6),
        todayCount: meetings.filter((meeting) => this.isSameUtcDay(meeting.startsAt, now)).length,
        thisWeekCount: meetings.filter((meeting) => meeting.startsAt <= weekTo).length
      },
      deadlines: {
        upcoming: openDeadlineItems.slice(0, 6),
        urgentCount: openDeadlineItems.filter((deadline) => deadline.status === "at_risk" || deadline.status === "critical").length,
        criticalCount: openDeadlineItems.filter((deadline) => deadline.status === "critical").length,
        completedCount: deadlineItems.filter((deadline) => deadline.status === "completed").length
      },
      financials: financialSummary
        ? this.toFinancialSummary(financialSummary)
        : {
            projectId,
            currency: "USD",
            budgetAmount: null,
            spentAmount: 0,
            remainingAmount: null,
            notes: null,
            updatedAt: null
          },
      subscriptions: {
        activeCount: subscriptions.filter((subscription) => subscription.status === "active").length,
        monthlyCost: subscriptions
          .filter((subscription) => subscription.status === "active" && subscription.billingType === "monthly")
          .reduce((sum, subscription) => sum + (decimalToNumber(subscription.cost) ?? 0), 0),
        annualCost: subscriptions
          .filter((subscription) => subscription.status === "active" && subscription.billingType === "annual")
          .reduce((sum, subscription) => sum + (decimalToNumber(subscription.cost) ?? 0), 0),
        items: subscriptions.map((subscription) => this.toSubscriptionItem(subscription))
      }
    };
  }

  async buildGeneralSummary(orgId: string): Promise<ProjectOpsGeneralSummary> {
    const now = new Date();
    const upcomingTo = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const weekTo = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const deadlineWindowStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const [meetings, deadlines] = await Promise.all([
      this.prisma.projectEvent.findMany({
        where: {
          orgId,
          startsAt: { gte: now, lte: upcomingTo },
          project: { status: "active" }
        },
        include: {
          project: { select: { id: true, name: true } }
        },
        orderBy: [{ startsAt: "asc" }]
      }),
      this.prisma.projectDeadline.findMany({
        where: {
          orgId,
          dueAt: { gte: deadlineWindowStart, lte: upcomingTo },
          project: { status: "active" }
        },
        include: {
          project: { select: { id: true, name: true } }
        },
        orderBy: [{ dueAt: "asc" }]
      })
    ]);

    const deadlineItems = deadlines.map((deadline) => this.toDeadlineItem(deadline, now));
    const openDeadlineItems = deadlineItems.filter((deadline) => deadline.status !== "completed");
    return {
      meetings: {
        upcoming: meetings.map((meeting) => this.toMeetingListItem(meeting)).slice(0, 10),
        upcomingCount: meetings.length,
        todayCount: meetings.filter((meeting) => this.isSameUtcDay(meeting.startsAt, now)).length,
        thisWeekCount: meetings.filter((meeting) => meeting.startsAt <= weekTo).length
      },
      deadlines: {
        upcoming: openDeadlineItems.slice(0, 10),
        urgentCount: openDeadlineItems.filter((deadline) => deadline.status === "at_risk" || deadline.status === "critical").length,
        criticalCount: openDeadlineItems.filter((deadline) => deadline.status === "critical").length
      }
    };
  }

  private async ensureReadableProject(projectId: string, actorUserId: string) {
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    assertProjectOpsReadable(member.projectRole);
    return member;
  }

  private resolveRange(query: MeetingRangeQuery | DeadlineRangeQuery) {
    const from = query.from ? new Date(query.from) : new Date();
    const to = query.to ? new Date(query.to) : new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (to.getTime() < from.getTime()) {
      throw new AppError(400, "to must be after from", "project_ops_invalid_range");
    }
    return { from, to };
  }

  private resolveCalendarRange(input: { from?: string; to?: string; month?: string }) {
    if (input.month) {
      const [yearString, monthString] = input.month.split("-");
      const year = Number(yearString);
      const month = Number(monthString) - 1;
      if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) {
        throw new AppError(400, "month must be in YYYY-MM format", "project_ops_invalid_month");
      }
      const from = new Date(Date.UTC(year, month, 1, 0, 0, 0));
      const to = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
      return { from, to };
    }
    return this.resolveRange(input);
  }

  private toMeetingListItem(
    meeting: {
      id: string;
      title: string;
      description: string | null;
      startsAt: Date;
      endsAt: Date | null;
      eventType: ProjectEventType;
      projectId: string;
      isAllDay: boolean;
      timezone: string | null;
      source: ProjectEventSource;
      linkedRefType: string | null;
      linkedRefId: string | null;
      project: { id: string; name: string };
    }
  ): ProjectOpsMeetingListItem {
    return {
      id: meeting.id,
      title: meeting.title,
      description: meeting.description,
      startsAt: meeting.startsAt.toISOString(),
      endsAt: meeting.endsAt?.toISOString() ?? null,
      eventType: meeting.eventType,
      projectId: meeting.project.id,
      projectName: meeting.project.name,
      isAllDay: meeting.isAllDay,
      timezone: meeting.timezone,
      source: meeting.source,
      linkedRefType: meeting.linkedRefType,
      linkedRefId: meeting.linkedRefId
    };
  }

  private toDeadlineItem(
    deadline: {
      id: string;
      title: string;
      description: string | null;
      dueAt: Date;
      status: DeadlineStatus;
      linkedRefType: string | null;
      linkedRefId: string | null;
      completedAt: Date | null;
      project: { id: string; name: string };
    },
    now = new Date()
  ): ProjectOpsDeadlineItem {
    return {
      id: deadline.id,
      title: deadline.title,
      description: deadline.description,
      projectId: deadline.project.id,
      projectName: deadline.project.name,
      dueAt: deadline.dueAt.toISOString(),
      status: deadline.status,
      linkedRefType: deadline.linkedRefType,
      linkedRefId: deadline.linkedRefId,
      completedAt: deadline.completedAt?.toISOString() ?? null,
      daysLeft: deadline.status === "completed" ? 0 : calculateDaysLeft(deadline.dueAt, now)
    };
  }

  private toFinancialSummary(
    summary: {
      projectId: string;
      currency: string;
      budgetAmount: Prisma.Decimal | null;
      spentAmount: Prisma.Decimal;
      notes: string | null;
      updatedAt: Date;
    }
  ): ProjectOpsFinancialSummary {
    const budgetAmount = decimalToNumber(summary.budgetAmount);
    const spentAmount = decimalToNumber(summary.spentAmount) ?? 0;
    return {
      projectId: summary.projectId,
      currency: summary.currency,
      budgetAmount,
      spentAmount,
      remainingAmount: budgetAmount == null ? null : Number((budgetAmount - spentAmount).toFixed(2)),
      notes: summary.notes ?? null,
      updatedAt: summary.updatedAt.toISOString()
    };
  }

  private toSubscriptionItem(subscription: {
    id: string;
    name: string;
    category: string;
    cost: Prisma.Decimal;
    billingType: BillingType;
    status: SubscriptionStatus;
    provider: string | null;
    externalRef: string | null;
    renewsAt: Date | null;
  }): ProjectOpsSubscriptionItem {
    return {
      id: subscription.id,
      name: subscription.name,
      category: subscription.category,
      cost: decimalToNumber(subscription.cost) ?? 0,
      billingType: subscription.billingType,
      status: subscription.status,
      provider: subscription.provider ?? null,
      externalRef: subscription.externalRef ?? null,
      renewsAt: subscription.renewsAt?.toISOString() ?? null
    };
  }

  private isSameUtcDay(left: Date, right: Date) {
    return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
  }

  private assertMeetingBounds(startsAt: Date, endsAt: Date | null) {
    if (endsAt && endsAt.getTime() < startsAt.getTime()) {
      throw new AppError(400, "Meeting end time must be after start time", "project_event_invalid_time_range");
    }
  }

  private async refreshDashboards(projectId: string, reason: string) {
    if (process.env.MVP_BETA_MODE === "true" || process.env.ORCHESTRA_PROFILE === "mvp_beta") {
      return;
    }
    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, reason);
  }
}
