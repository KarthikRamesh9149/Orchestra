import { Prisma, type PrismaClient } from "@prisma/client";
import { assertProjectOpsReadable } from "./authz.js";
import { decimalToNumber } from "./read-models.js";
import { ProjectService } from "../projects/service.js";

export type FinancialBreakdownSeries = {
  bucket: string;
  amount: number;
};

export type FinancialBreakdown = {
  projectId: string;
  currency: string;
  groupBy: "month" | "category";
  series: FinancialBreakdownSeries[];
};

export type RenewalItem = {
  subscriptionId: string;
  name: string;
  provider: string | null;
  renewsAt: string;
  daysUntilRenewal: number;
  cost: number;
  currency: string;
  billingType: string;
  status: string;
};

export type OpsSummary = {
  projectId: string;
  upcomingRecurringMeetingsCount: number;
  upcomingImportedMeetingsCount: number;
  upcomingDeadlinesCount: number;
  urgentRenewalsCount: number;
  financials: {
    currency: string;
    budgetAmount: number | null;
    spentAmount: number;
    remainingAmount: number | null;
    ledgerTotal: number;
  };
  spendTrend: FinancialBreakdownSeries[];
};

export class RollupsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly projectService: ProjectService
  ) {}

  async getFinancialBreakdown(
    projectId: string,
    actorUserId: string,
    groupBy: "month" | "category"
  ): Promise<FinancialBreakdown> {
    await this.ensureReadableProject(projectId, actorUserId);

    // Get currency from financial summary or default
    const summary = await this.prisma.projectFinancialSummary.findUnique({
      where: { projectId },
      select: { currency: true }
    });
    const currency = summary?.currency ?? "USD";

    let series: FinancialBreakdownSeries[];

    if (groupBy === "month") {
      series = await this.getMonthlyBreakdown(projectId);
    } else {
      series = await this.getCategoryBreakdown(projectId);
    }

    return { projectId, currency, groupBy, series };
  }

  private async getMonthlyBreakdown(projectId: string): Promise<FinancialBreakdownSeries[]> {
    // Use raw SQL for grouping by month
    const rows = await this.prisma.$queryRaw<{ bucket: string; amount: Prisma.Decimal }[]>`
      SELECT
        to_char(occurred_at, 'YYYY-MM') AS bucket,
        SUM(amount)::numeric AS amount
      FROM project_cost_entries
      WHERE project_id = ${projectId}::uuid
      GROUP BY bucket
      ORDER BY bucket ASC
    `;
    return rows.map((r) => ({
      bucket: r.bucket,
      amount: Number(decimalToNumber(r.amount) ?? 0)
    }));
  }

  private async getCategoryBreakdown(projectId: string): Promise<FinancialBreakdownSeries[]> {
    const rows = await this.prisma.$queryRaw<{ bucket: string; amount: Prisma.Decimal }[]>`
      SELECT
        category::text AS bucket,
        SUM(amount)::numeric AS amount
      FROM project_cost_entries
      WHERE project_id = ${projectId}::uuid
      GROUP BY category
      ORDER BY amount DESC
    `;
    return rows.map((r) => ({
      bucket: r.bucket,
      amount: Number(decimalToNumber(r.amount) ?? 0)
    }));
  }

  async getRenewals(
    projectId: string,
    actorUserId: string,
    windowDays = 30
  ): Promise<RenewalItem[]> {
    await this.ensureReadableProject(projectId, actorUserId);

    const now = new Date();
    const windowEnd = new Date(now.getTime() + Math.min(windowDays, 365) * 24 * 60 * 60 * 1000);

    const [subs, financialSummary] = await Promise.all([
      this.prisma.projectSubscription.findMany({
        where: {
          projectId,
          status: "active",
          renewsAt: { gte: now, lte: windowEnd }
        },
        orderBy: [{ renewsAt: "asc" }]
      }),
      this.prisma.projectFinancialSummary.findUnique({
        where: { projectId },
        select: { currency: true }
      })
    ]);

    const defaultCurrency = financialSummary?.currency ?? "USD";

    return subs.map((sub) => ({
      subscriptionId: sub.id,
      name: sub.name,
      provider: sub.provider ?? null,
      renewsAt: sub.renewsAt!.toISOString(),
      daysUntilRenewal: Math.ceil((sub.renewsAt!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      cost: decimalToNumber(sub.cost) ?? 0,
      currency: defaultCurrency,
      billingType: sub.billingType,
      status: sub.status
    }));
  }

  async getOpsSummary(projectId: string, actorUserId: string): Promise<OpsSummary> {
    await this.ensureReadableProject(projectId, actorUserId);

    const now = new Date();
    const upcomingTo = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const urgentRenewalTo = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const [
      recurringMeetings,
      importedMeetings,
      openDeadlines,
      urgentRenewals,
      financialSummary,
      ledgerTotal
    ] = await Promise.all([
      this.prisma.projectEvent.count({
        where: {
          projectId,
          isGeneratedOccurrence: true,
          startsAt: { gte: now, lte: upcomingTo }
        }
      }),
      this.prisma.projectEvent.count({
        where: {
          projectId,
          source: "imported",
          startsAt: { gte: now, lte: upcomingTo }
        }
      }),
      this.prisma.projectDeadline.count({
        where: {
          projectId,
          status: { not: "completed" },
          dueAt: { lte: upcomingTo }
        }
      }),
      this.prisma.projectSubscription.count({
        where: {
          projectId,
          status: "active",
          renewsAt: { gte: now, lte: urgentRenewalTo }
        }
      }),
      this.prisma.projectFinancialSummary.findUnique({ where: { projectId } }),
      this.prisma.projectCostEntry.aggregate({
        where: { projectId },
        _sum: { amount: true }
      })
    ]);

    const ledgerTotalNum = decimalToNumber(ledgerTotal._sum.amount) ?? 0;
    const currency = financialSummary?.currency ?? "USD";
    const budgetAmount = financialSummary ? (decimalToNumber(financialSummary.budgetAmount) ?? null) : null;
    const spentAmount = financialSummary ? (decimalToNumber(financialSummary.spentAmount) ?? 0) : 0;
    const finalSpent = Math.max(spentAmount, ledgerTotalNum);
    const remainingAmount = budgetAmount != null ? Number((budgetAmount - finalSpent).toFixed(2)) : null;

    // Recent 6-month spend trend
    const trendRows = await this.prisma.$queryRaw<{ bucket: string; amount: Prisma.Decimal }[]>`
      SELECT
        to_char(occurred_at, 'YYYY-MM') AS bucket,
        SUM(amount)::numeric AS amount
      FROM project_cost_entries
      WHERE project_id = ${projectId}::uuid
        AND occurred_at >= now() - interval '6 months'
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    return {
      projectId,
      upcomingRecurringMeetingsCount: recurringMeetings,
      upcomingImportedMeetingsCount: importedMeetings,
      upcomingDeadlinesCount: openDeadlines,
      urgentRenewalsCount: urgentRenewals,
      financials: {
        currency,
        budgetAmount,
        spentAmount: finalSpent,
        remainingAmount,
        ledgerTotal: ledgerTotalNum
      },
      spendTrend: trendRows.map((r) => ({ bucket: r.bucket, amount: Number(decimalToNumber(r.amount) ?? 0) }))
    };
  }

  // Derives spent amount from ledger for syncing to financial summary
  async derivedLedgerTotal(projectId: string): Promise<{ total: number; currency: string }> {
    const result = await this.prisma.projectCostEntry.aggregate({
      where: { projectId },
      _sum: { amount: true }
    });
    const summary = await this.prisma.projectFinancialSummary.findUnique({
      where: { projectId },
      select: { currency: true }
    });
    return {
      total: decimalToNumber(result._sum.amount) ?? 0,
      currency: summary?.currency ?? "USD"
    };
  }

  private async ensureReadableProject(projectId: string, actorUserId: string) {
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    assertProjectOpsReadable(member.projectRole);
    return member;
  }
}
