import { Prisma, type CostEntryCategory, type PrismaClient } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";
import type { JobDispatcher } from "../../lib/jobs/types.js";
import { AuditService } from "../audit/service.js";
import { ProjectService } from "../projects/service.js";
import { assertProjectOpsReadable } from "./authz.js";
import { decimalToNumber } from "./read-models.js";

export type CostEntryItem = {
  id: string;
  projectId: string;
  category: string;
  title: string;
  description: string | null;
  amount: number;
  currency: string;
  occurredAt: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};

type CostEntryListQuery = {
  from?: string;
  to?: string;
  category?: CostEntryCategory;
  limit?: number;
  cursor?: string;
};

const COST_ENTRY_CATEGORIES: CostEntryCategory[] = [
  "infrastructure",
  "software",
  "contractor",
  "tools",
  "cloud",
  "communication",
  "design",
  "misc"
];

export class CostEntriesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly jobs: JobDispatcher
  ) {}

  async listEntries(
    projectId: string,
    actorUserId: string,
    query: CostEntryListQuery = {}
  ): Promise<{ items: CostEntryItem[]; nextCursor: string | null }> {
    await this.ensureReadableProject(projectId, actorUserId);

    const limit = Math.min(query.limit ?? 50, 100);
    const where: Prisma.ProjectCostEntryWhereInput = { projectId };

    if (query.from || query.to) {
      where.occurredAt = {};
      if (query.from) where.occurredAt.gte = new Date(query.from);
      if (query.to) where.occurredAt.lte = new Date(query.to);
    }
    if (query.category) where.category = query.category;
    if (query.cursor) {
      where.occurredAt = {
        ...((where.occurredAt as Prisma.DateTimeFilter) ?? {}),
        lt: new Date(Buffer.from(query.cursor, "base64url").toString())
      };
    }

    const rows = await this.prisma.projectCostEntry.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }],
      take: limit + 1
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? Buffer.from(items[items.length - 1].occurredAt.toISOString()).toString("base64url")
      : null;

    return { items: items.map((r) => this.toCostEntryItem(r)), nextCursor };
  }

  async getEntry(projectId: string, entryId: string, actorUserId: string): Promise<CostEntryItem> {
    await this.ensureReadableProject(projectId, actorUserId);
    const row = await this.prisma.projectCostEntry.findFirst({
      where: { id: entryId, projectId }
    });
    if (!row) throw new AppError(404, "Cost entry not found", "cost_entry_not_found");
    return this.toCostEntryItem(row);
  }

  async createEntry(
    projectId: string,
    actorUserId: string,
    input: {
      category: CostEntryCategory;
      title: string;
      description?: string | null;
      amount: number;
      currency: string;
      occurredAt: string;
    }
  ): Promise<CostEntryItem> {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    this.validateEntryInput(input);

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { orgId: true }
    });

    const row = await this.prisma.projectCostEntry.create({
      data: {
        orgId: project.orgId,
        projectId,
        category: input.category,
        title: input.title,
        description: input.description ?? null,
        amount: new Prisma.Decimal(input.amount.toFixed(2)),
        currency: input.currency.toUpperCase(),
        occurredAt: new Date(input.occurredAt),
        source: "manual",
        createdBy: actorUserId
      }
    });

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "cost_entry_created",
      entityType: "project_cost_entry",
      entityId: row.id,
      payload: { title: row.title, category: row.category, amount: decimalToNumber(row.amount), currency: row.currency }
    });

    await this.refreshDashboards(projectId, "cost_entry_created");
    return this.toCostEntryItem(row);
  }

  async updateEntry(
    projectId: string,
    entryId: string,
    actorUserId: string,
    input: {
      category?: CostEntryCategory;
      title?: string;
      description?: string | null;
      amount?: number;
      currency?: string;
      occurredAt?: string;
    }
  ): Promise<CostEntryItem> {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const existing = await this.prisma.projectCostEntry.findFirst({
      where: { id: entryId, projectId }
    });
    if (!existing) throw new AppError(404, "Cost entry not found", "cost_entry_not_found");

    if (input.amount !== undefined && input.amount < 0) {
      throw new AppError(400, "amount must be non-negative", "cost_entry_invalid_amount");
    }
    if (input.currency !== undefined && !/^[A-Z]{3}$/.test(input.currency)) {
      throw new AppError(400, "currency must be a 3-letter uppercase ISO code", "cost_entry_invalid_currency");
    }

    const row = await this.prisma.projectCostEntry.update({
      where: { id: entryId },
      data: {
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.amount !== undefined ? { amount: new Prisma.Decimal(input.amount.toFixed(2)) } : {}),
        ...(input.currency !== undefined ? { currency: input.currency.toUpperCase() } : {}),
        ...(input.occurredAt !== undefined ? { occurredAt: new Date(input.occurredAt) } : {})
      }
    });

    await this.auditService.record({
      orgId: existing.orgId,
      projectId,
      actorUserId,
      eventType: "cost_entry_updated",
      entityType: "project_cost_entry",
      entityId: row.id,
      payload: { title: row.title, category: row.category, amount: decimalToNumber(row.amount) }
    });

    await this.refreshDashboards(projectId, "cost_entry_updated");
    return this.toCostEntryItem(row);
  }

  async deleteEntry(projectId: string, entryId: string, actorUserId: string): Promise<{ ok: boolean }> {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const existing = await this.prisma.projectCostEntry.findFirst({
      where: { id: entryId, projectId }
    });
    if (!existing) throw new AppError(404, "Cost entry not found", "cost_entry_not_found");

    await this.prisma.projectCostEntry.delete({ where: { id: entryId } });

    await this.auditService.record({
      orgId: existing.orgId,
      projectId,
      actorUserId,
      eventType: "cost_entry_deleted",
      entityType: "project_cost_entry",
      entityId: entryId,
      payload: { title: existing.title, category: existing.category }
    });

    await this.refreshDashboards(projectId, "cost_entry_deleted");
    return { ok: true };
  }

  // Returns the valid categories list for validation/UI
  static get validCategories(): CostEntryCategory[] {
    return COST_ENTRY_CATEGORIES;
  }

  private validateEntryInput(input: { amount: number; currency: string; category: CostEntryCategory }) {
    if (input.amount < 0) {
      throw new AppError(400, "amount must be non-negative", "cost_entry_invalid_amount");
    }
    const rounded = Number(input.amount.toFixed(2));
    if (Math.abs(rounded - input.amount) > 0.001) {
      throw new AppError(400, "amount must have at most 2 decimal places", "cost_entry_invalid_amount_precision");
    }
    if (!/^[A-Z]{3}$/.test(input.currency)) {
      throw new AppError(400, "currency must be a 3-letter uppercase ISO code (e.g. USD)", "cost_entry_invalid_currency");
    }
    if (!COST_ENTRY_CATEGORIES.includes(input.category)) {
      throw new AppError(400, `category must be one of: ${COST_ENTRY_CATEGORIES.join(", ")}`, "cost_entry_invalid_category");
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

  private toCostEntryItem(row: {
    id: string;
    projectId: string;
    category: CostEntryCategory;
    title: string;
    description: string | null;
    amount: Prisma.Decimal;
    currency: string;
    occurredAt: Date;
    source: string;
    createdAt: Date;
    updatedAt: Date;
  }): CostEntryItem {
    return {
      id: row.id,
      projectId: row.projectId,
      category: row.category,
      title: row.title,
      description: row.description,
      amount: decimalToNumber(row.amount) ?? 0,
      currency: row.currency,
      occurredAt: row.occurredAt.toISOString(),
      source: row.source,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }
}
