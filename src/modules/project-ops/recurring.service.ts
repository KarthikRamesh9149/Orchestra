import {
  Prisma,
  type EventRecurrenceFrequency,
  type EventRecurrenceStatus,
  type PrismaClient,
  type ProjectEventType,
  type ProjectEventSource
} from "@prisma/client";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import { AppError } from "../../app/errors.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";
import type { JobDispatcher } from "../../lib/jobs/types.js";
import { AuditService } from "../audit/service.js";
import { ProjectService } from "../projects/service.js";
import { assertProjectOpsReadable } from "./authz.js";

// Maximum future window (days) for materialising occurrences
const OCCURRENCE_WINDOW_DAYS = 90;
// Maximum occurrences to materialise per series in one pass
const MAX_MATERIALISE = 200;

export type EventSeriesItem = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  eventType: string;
  timezone: string;
  isAllDay: boolean;
  frequency: string;
  interval: number;
  byWeekday: string[] | null;
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
  maxOccurrences: number | null;
  status: string;
  source: string;
  nextOccurrenceAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export class RecurringService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly jobs: JobDispatcher
  ) {}

  async listSeries(projectId: string, actorUserId: string): Promise<EventSeriesItem[]> {
    await this.ensureReadableProject(projectId, actorUserId);
    const rows = await this.prisma.projectEventSeries.findMany({
      where: { projectId },
      orderBy: [{ startDate: "asc" }]
    });
    const now = new Date();
    return rows.map((row) => this.toSeriesItem(row, now));
  }

  async getSeries(projectId: string, seriesId: string, actorUserId: string): Promise<EventSeriesItem> {
    await this.ensureReadableProject(projectId, actorUserId);
    const row = await this.prisma.projectEventSeries.findFirst({
      where: { id: seriesId, projectId }
    });
    if (!row) throw new AppError(404, "Event series not found", "event_series_not_found");
    return this.toSeriesItem(row, new Date());
  }

  async createSeries(
    projectId: string,
    actorUserId: string,
    input: {
      title: string;
      description?: string | null;
      eventType: ProjectEventType;
      timezone: string;
      isAllDay?: boolean;
      frequency: EventRecurrenceFrequency;
      interval?: number;
      byWeekday?: string[] | null;
      dayOfMonth?: number | null;
      startDate: string;
      endDate?: string | null;
      maxOccurrences?: number | null;
    }
  ): Promise<EventSeriesItem> {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { orgId: true }
    });

    this.validateSeriesInput(input);

    const series = await this.prisma.projectEventSeries.create({
      data: {
        orgId: project.orgId,
        projectId,
        title: input.title,
        description: input.description ?? null,
        eventType: input.eventType,
        timezone: input.timezone,
        isAllDay: input.isAllDay ?? false,
        frequency: input.frequency,
        interval: input.interval ?? 1,
        byWeekdayJson: (input.byWeekday ?? Prisma.JsonNull) as InputJsonValue,
        dayOfMonth: input.dayOfMonth ?? null,
        startDate: new Date(input.startDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        maxOccurrences: input.maxOccurrences ?? null,
        status: "active",
        source: "manual",
        createdBy: actorUserId
      }
    });

    await this.materialiseOccurrences(series, project.orgId, actorUserId);

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "event_series_created",
      entityType: "project_event_series",
      entityId: series.id,
      payload: { title: series.title, frequency: series.frequency }
    });

    await this.refreshDashboards(projectId, "event_series_created");
    return this.toSeriesItem(series, new Date());
  }

  async updateSeries(
    projectId: string,
    seriesId: string,
    actorUserId: string,
    input: {
      title?: string;
      description?: string | null;
      eventType?: ProjectEventType;
      timezone?: string;
      isAllDay?: boolean;
      frequency?: EventRecurrenceFrequency;
      interval?: number;
      byWeekday?: string[] | null;
      dayOfMonth?: number | null;
      endDate?: string | null;
      maxOccurrences?: number | null;
      status?: EventRecurrenceStatus;
    }
  ): Promise<EventSeriesItem> {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const existing = await this.prisma.projectEventSeries.findFirst({
      where: { id: seriesId, projectId }
    });
    if (!existing) throw new AppError(404, "Event series not found", "event_series_not_found");

    // Validate rule fields using merged (existing + incoming) values
    const mergedInterval = input.interval ?? existing.interval;
    const mergedFrequency = input.frequency ?? existing.frequency;
    const mergedTimezone = input.timezone ?? existing.timezone;
    const mergedEndDate = input.endDate !== undefined ? input.endDate : existing.endDate?.toISOString() ?? null;
    const mergedMaxOccurrences = input.maxOccurrences !== undefined ? input.maxOccurrences : existing.maxOccurrences;
    this.validateSeriesInput({
      interval: mergedInterval,
      frequency: mergedFrequency,
      timezone: mergedTimezone,
      startDate: existing.startDate.toISOString(),
      endDate: mergedEndDate,
      maxOccurrences: mergedMaxOccurrences
    });

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { orgId: true }
    });

    const series = await this.prisma.projectEventSeries.update({
      where: { id: seriesId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.eventType !== undefined ? { eventType: input.eventType } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.isAllDay !== undefined ? { isAllDay: input.isAllDay } : {}),
        ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
        ...(input.interval !== undefined ? { interval: input.interval } : {}),
        ...(input.byWeekday !== undefined ? { byWeekdayJson: (input.byWeekday ?? Prisma.JsonNull) as InputJsonValue } : {}),
        ...(input.dayOfMonth !== undefined ? { dayOfMonth: input.dayOfMonth ?? null } : {}),
        ...(input.endDate !== undefined ? { endDate: input.endDate ? new Date(input.endDate) : null } : {}),
        ...(input.maxOccurrences !== undefined ? { maxOccurrences: input.maxOccurrences ?? null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {})
      }
    });

    // Regenerate future occurrences when rule fields change
    const ruleChanged =
      input.frequency !== undefined ||
      input.interval !== undefined ||
      input.byWeekday !== undefined ||
      input.dayOfMonth !== undefined ||
      input.endDate !== undefined ||
      input.maxOccurrences !== undefined ||
      input.timezone !== undefined;

    if (ruleChanged) {
      await this.pruneFutureOccurrences(seriesId);
      if (series.status === "active") {
        await this.materialiseOccurrences(series, project.orgId, actorUserId);
      }
    }

    // Prune future occurrences when paused or ended
    if (input.status === "paused" || input.status === "ended") {
      await this.pruneFutureOccurrences(seriesId);
    }
    // Re-materialise when re-activated
    if (input.status === "active" && existing.status !== "active") {
      await this.materialiseOccurrences(series, project.orgId, actorUserId);
    }

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "event_series_updated",
      entityType: "project_event_series",
      entityId: series.id,
      payload: { title: series.title, status: series.status }
    });

    await this.refreshDashboards(projectId, "event_series_updated");
    return this.toSeriesItem(series, new Date());
  }

  async deleteSeries(projectId: string, seriesId: string, actorUserId: string): Promise<{ ok: boolean }> {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const existing = await this.prisma.projectEventSeries.findFirst({
      where: { id: seriesId, projectId },
      include: { project: { select: { orgId: true } } }
    });
    if (!existing) throw new AppError(404, "Event series not found", "event_series_not_found");

    // Detach all occurrences (set seriesId=null so events stay but lose series link)
    await this.prisma.projectEvent.updateMany({
      where: { seriesId, isGeneratedOccurrence: true },
      data: { seriesId: null }
    });
    await this.prisma.projectEventSeries.delete({ where: { id: seriesId } });

    await this.auditService.record({
      orgId: existing.project.orgId,
      projectId,
      actorUserId,
      eventType: "event_series_deleted",
      entityType: "project_event_series",
      entityId: seriesId,
      payload: { title: existing.title }
    });

    await this.refreshDashboards(projectId, "event_series_deleted");
    return { ok: true };
  }

  // Materialise concrete ProjectEvent rows for a series within the upcoming window.
  // Called after create/update. Safe to call multiple times (idempotent by date).
  async materialiseOccurrences(
    series: {
      id: string;
      orgId: string;
      projectId: string;
      title: string;
      description: string | null;
      eventType: ProjectEventType;
      timezone: string;
      isAllDay: boolean;
      frequency: EventRecurrenceFrequency;
      interval: number;
      byWeekdayJson: Prisma.JsonValue | null;
      dayOfMonth: number | null;
      startDate: Date;
      endDate: Date | null;
      maxOccurrences: number | null;
      source: ProjectEventSource;
    },
    orgId: string,
    createdBy: string
  ) {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + OCCURRENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Find the latest already-generated occurrence to resume from
    const latestOccurrence = await this.prisma.projectEvent.findFirst({
      where: { seriesId: series.id, isGeneratedOccurrence: true },
      orderBy: { startsAt: "desc" }
    });

    const generateFrom = latestOccurrence
      ? new Date(latestOccurrence.startsAt.getTime() + 1)
      : (series.startDate > now ? series.startDate : now);

    const dates = this.computeOccurrenceDates(series, generateFrom, windowEnd);
    if (dates.length === 0) return;

    // Get existing occurrence dates to avoid duplicates
    const existing = await this.prisma.projectEvent.findMany({
      where: {
        seriesId: series.id,
        isGeneratedOccurrence: true,
        startsAt: { gte: generateFrom, lte: windowEnd }
      },
      select: { startsAt: true }
    });
    const existingSet = new Set(existing.map((e) => e.startsAt.toISOString().slice(0, 16)));

    const toCreate = dates.filter((d) => !existingSet.has(d.toISOString().slice(0, 16)));

    if (toCreate.length === 0) return;

    await this.prisma.projectEvent.createMany({
      data: toCreate.map((date) => ({
        orgId,
        projectId: series.projectId,
        title: series.title,
        description: series.description,
        eventType: series.eventType,
        source: series.source,
        startsAt: date,
        endsAt: null,
        timezone: series.timezone,
        isAllDay: series.isAllDay,
        seriesId: series.id,
        isGeneratedOccurrence: true,
        createdBy
      }))
    });
  }

  private async pruneFutureOccurrences(seriesId: string) {
    const now = new Date();
    await this.prisma.projectEvent.deleteMany({
      where: {
        seriesId,
        isGeneratedOccurrence: true,
        startsAt: { gt: now }
      }
    });
  }

  private computeOccurrenceDates(
    series: {
      frequency: EventRecurrenceFrequency;
      interval: number;
      byWeekdayJson: Prisma.JsonValue | null;
      dayOfMonth: number | null;
      startDate: Date;
      endDate: Date | null;
      maxOccurrences: number | null;
    },
    from: Date,
    to: Date
  ): Date[] {
    const results: Date[] = [];
    const hardEnd = series.endDate && series.endDate < to ? series.endDate : to;
    const maxCount = Math.min(series.maxOccurrences ?? MAX_MATERIALISE, MAX_MATERIALISE);

    // Start candidate from series.startDate or from
    let cursor = new Date(series.startDate > from ? series.startDate : from);
    // Align cursor to startDate's time-of-day
    cursor.setUTCHours(
      series.startDate.getUTCHours(),
      series.startDate.getUTCMinutes(),
      0,
      0
    );

    const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const byWeekday = Array.isArray(series.byWeekdayJson)
      ? (series.byWeekdayJson as string[]).map((d) => weekdayNames.indexOf(d.toLowerCase())).filter((d) => d >= 0)
      : null;

    let safety = 0;
    while (cursor <= hardEnd && results.length < maxCount && safety < 5000) {
      safety++;
      if (cursor >= from) {
        const valid = this.matchesRule(cursor, series.frequency, byWeekday, series.dayOfMonth);
        if (valid) results.push(new Date(cursor));
      }
      cursor = this.advanceCursor(cursor, series.frequency, series.interval);
    }

    return results;
  }

  private matchesRule(
    date: Date,
    frequency: EventRecurrenceFrequency,
    byWeekday: number[] | null,
    dayOfMonth: number | null
  ): boolean {
    if (frequency === "weekly" && byWeekday && byWeekday.length > 0) {
      return byWeekday.includes(date.getUTCDay());
    }
    if (frequency === "monthly" && dayOfMonth !== null) {
      return date.getUTCDate() === dayOfMonth;
    }
    return true;
  }

  private advanceCursor(date: Date, frequency: EventRecurrenceFrequency, interval: number): Date {
    const next = new Date(date);
    switch (frequency) {
      case "daily":
        next.setUTCDate(next.getUTCDate() + interval);
        break;
      case "weekly":
        next.setUTCDate(next.getUTCDate() + interval * 7);
        break;
      case "monthly":
        next.setUTCMonth(next.getUTCMonth() + interval);
        break;
      case "yearly":
        next.setUTCFullYear(next.getUTCFullYear() + interval);
        break;
    }
    return next;
  }

  private validateSeriesInput(input: {
    interval?: number;
    startDate: string;
    endDate?: string | null;
    maxOccurrences?: number | null;
    timezone: string;
    frequency: EventRecurrenceFrequency;
  }) {
    if (!input.timezone) {
      throw new AppError(400, "timezone is required for recurring events", "event_series_timezone_required");
    }
    const interval = input.interval ?? 1;
    if (interval < 1 || interval > 365) {
      throw new AppError(400, "interval must be between 1 and 365", "event_series_invalid_interval");
    }
    const start = new Date(input.startDate);
    if (input.endDate) {
      const end = new Date(input.endDate);
      if (end <= start) {
        throw new AppError(400, "endDate must be after startDate", "event_series_invalid_dates");
      }
    }
    if (input.maxOccurrences !== undefined && input.maxOccurrences !== null && input.maxOccurrences < 1) {
      throw new AppError(400, "maxOccurrences must be at least 1", "event_series_invalid_max_occurrences");
    }
  }

  private async ensureReadableProject(projectId: string, actorUserId: string) {
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    assertProjectOpsReadable(member.projectRole);
    return member;
  }

  private async refreshDashboards(projectId: string, reason: string) {
    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, reason);
  }

  private toSeriesItem(
    row: {
      id: string;
      projectId: string;
      title: string;
      description: string | null;
      eventType: ProjectEventType;
      timezone: string;
      isAllDay: boolean;
      frequency: EventRecurrenceFrequency;
      interval: number;
      byWeekdayJson: Prisma.JsonValue | null;
      dayOfMonth: number | null;
      startDate: Date;
      endDate: Date | null;
      maxOccurrences: number | null;
      status: EventRecurrenceStatus;
      source: ProjectEventSource;
      createdAt: Date;
      updatedAt: Date;
    },
    now: Date
  ): EventSeriesItem {
    const nextOccurrenceAt = this.computeNextOccurrence(row, now);
    return {
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      description: row.description,
      eventType: row.eventType,
      timezone: row.timezone,
      isAllDay: row.isAllDay,
      frequency: row.frequency,
      interval: row.interval,
      byWeekday: Array.isArray(row.byWeekdayJson) ? (row.byWeekdayJson as string[]) : null,
      dayOfMonth: row.dayOfMonth,
      startDate: row.startDate.toISOString(),
      endDate: row.endDate?.toISOString() ?? null,
      maxOccurrences: row.maxOccurrences,
      status: row.status,
      source: row.source,
      nextOccurrenceAt,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private computeNextOccurrence(
    series: {
      status: EventRecurrenceStatus;
      frequency: EventRecurrenceFrequency;
      interval: number;
      byWeekdayJson: Prisma.JsonValue | null;
      dayOfMonth: number | null;
      startDate: Date;
      endDate: Date | null;
      maxOccurrences: number | null;
    },
    now: Date
  ): string | null {
    if (series.status !== "active") return null;
    const dates = this.computeOccurrenceDates(series, now, new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000));
    return dates.length > 0 ? dates[0].toISOString() : null;
  }
}
