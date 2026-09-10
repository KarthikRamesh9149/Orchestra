import type {
  Prisma,
  PrismaClient,
  ProjectResponsibilityArea,
  ProjectResponsibilitySource,
  ProjectResponsibilityStatus
} from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";
import type { JobDispatcher } from "../../lib/jobs/types.js";
import { AuditService } from "../audit/service.js";
import { ProjectService } from "./service.js";
import type {
  CreateResponsibilityInput,
  ListResponsibilitiesQuery,
  UpdateResponsibilityInput
} from "./responsibilities.schemas.js";

const activeResponsibilityStatuses = new Set<ProjectResponsibilityStatus>(["open", "in_progress", "blocked"]);

type ResponsibilityWithAssignee = Prisma.ProjectResponsibilityGetPayload<{
  include: {
    member: {
      include: {
        user: {
          select: {
            id: true;
            email: true;
            displayName: true;
          };
        };
      };
    };
  };
}>;

export class ProjectResponsibilitiesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly jobs: JobDispatcher
  ) {}

  async listResponsibilities(projectId: string, actorUserId: string, query: ListResponsibilitiesQuery) {
    await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? 25, 100);
    const where = this.buildListWhere(projectId, query);
    const [totalCount, rows] = await Promise.all([
      this.prisma.projectResponsibility.count({ where }),
      this.prisma.projectResponsibility.findMany({
        where,
        include: this.assigneeInclude(),
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);

    return {
      items: rows.map((row) => this.toDto(row)),
      meta: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize))
      }
    };
  }

  async getResponsibility(projectId: string, responsibilityId: string, actorUserId: string) {
    await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    const row = await this.prisma.projectResponsibility.findFirst({
      where: { id: responsibilityId, projectId },
      include: this.assigneeInclude()
    });
    if (!row) {
      throw new AppError(404, "Responsibility not found", "responsibility_not_found");
    }
    return this.toDto(row);
  }

  async createResponsibility(projectId: string, actorUserId: string, input: CreateResponsibilityInput) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    const member = input.memberId ? await this.ensureAssignableMember(projectId, input.memberId) : null;

    const created = await this.withTransaction(async (tx) => {
      const row = await tx.projectResponsibility.create({
        data: {
          orgId: project.orgId,
          projectId,
          memberId: member?.id ?? null,
          assigneeName: input.assigneeName ?? null,
          title: input.title,
          description: input.description ?? null,
          area: input.area,
          status: input.status,
          source: input.source,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId
        },
        include: this.assigneeInclude()
      });

      await this.recordAudit(tx, {
        orgId: project.orgId,
        projectId,
        actorUserId,
        eventType: "responsibility_created",
        entityType: "project_responsibility",
        entityId: row.id,
        payload: {
          responsibilityId: row.id,
          title: row.title,
          area: row.area,
          status: row.status,
          memberId: row.memberId,
          assigneeName: row.assigneeName,
          source: row.source
        }
      });
      return row;
    });
    await this.enqueueDashboardRefresh(projectId, "responsibility_created");

    return this.toDto(created);
  }

  async updateResponsibility(
    projectId: string,
    responsibilityId: string,
    actorUserId: string,
    input: UpdateResponsibilityInput
  ) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    const existing = await this.prisma.projectResponsibility.findFirst({
      where: { id: responsibilityId, projectId },
      include: this.assigneeInclude()
    });
    if (!existing) {
      throw new AppError(404, "Responsibility not found", "responsibility_not_found");
    }

    const member = Object.prototype.hasOwnProperty.call(input, "memberId") && input.memberId
      ? await this.ensureAssignableMember(projectId, input.memberId)
      : null;
    this.assertResponsiblePartyRemains(existing, input);
    const data: Prisma.ProjectResponsibilityUpdateInput = {
      updatedBy: { connect: { id: actorUserId } }
    };
    if (Object.prototype.hasOwnProperty.call(input, "memberId")) {
      data.member = input.memberId ? { connect: { id: member!.id } } : { disconnect: true };
    }
    if (Object.prototype.hasOwnProperty.call(input, "assigneeName")) data.assigneeName = input.assigneeName ?? null;
    if (input.title !== undefined) data.title = input.title;
    if (Object.prototype.hasOwnProperty.call(input, "description")) data.description = input.description ?? null;
    if (input.area !== undefined) data.area = input.area;
    if (input.status !== undefined) data.status = input.status;

    const updated = await this.withTransaction(async (tx) => {
      const row = await tx.projectResponsibility.update({
        where: { id: existing.id },
        data,
        include: this.assigneeInclude()
      });

      await this.recordAudit(tx, {
        orgId: existing.orgId,
        projectId,
        actorUserId,
        eventType: "responsibility_updated",
        entityType: "project_responsibility",
        entityId: row.id,
        payload: {
          responsibilityId: row.id,
          before: this.auditSnapshot(existing),
          after: this.auditSnapshot(row)
        }
      });
      return row;
    });
    await this.enqueueDashboardRefresh(projectId, "responsibility_updated");

    return this.toDto(updated);
  }

  async deleteResponsibility(projectId: string, responsibilityId: string, actorUserId: string) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    const existing = await this.prisma.projectResponsibility.findFirst({
      where: { id: responsibilityId, projectId },
      include: this.assigneeInclude()
    });
    if (!existing) {
      throw new AppError(404, "Responsibility not found", "responsibility_not_found");
    }

    await this.withTransaction(async (tx) => {
      await tx.projectResponsibility.delete({ where: { id: existing.id } });
      await this.recordAudit(tx, {
        orgId: existing.orgId,
        projectId,
        actorUserId,
        eventType: "responsibility_deleted",
        entityType: "project_responsibility",
        entityId: existing.id,
        payload: {
          responsibilityId: existing.id,
          deleted: this.auditSnapshot(existing)
        }
      });
    });
    await this.enqueueDashboardRefresh(projectId, "responsibility_deleted");

    return { ok: true, deletedId: existing.id };
  }

  async buildProjectResponsibilitySummary(projectId: string) {
    const rows = await this.prisma.projectResponsibility.findMany({
      where: { projectId },
      include: this.assigneeInclude(),
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }]
    });
    return buildResponsibilitySummary(projectId, rows.map((row) => this.toDto(row)));
  }

  async getResponsibilitiesForRetrieval(projectId: string, query: string, limit = 8) {
    const tokens = tokenize(query);
    const rows = await this.prisma.projectResponsibility.findMany({
      where: { projectId },
      include: this.assigneeInclude(),
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 100
    });

    return rows
      .map((row) => ({ row, score: scoreResponsibility(row, tokens) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((item) => this.toDto(item.row));
  }

  private buildListWhere(projectId: string, query: ListResponsibilitiesQuery): Prisma.ProjectResponsibilityWhereInput {
    return {
      projectId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.area ? { area: query.area } : {}),
      ...(query.memberId ? { memberId: query.memberId } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: "insensitive" } },
              { description: { contains: query.q, mode: "insensitive" } },
              { assigneeName: { contains: query.q, mode: "insensitive" } },
              { member: { user: { displayName: { contains: query.q, mode: "insensitive" } } } }
            ]
          }
        : {})
    };
  }

  private async loadProject(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, orgId: true }
    });
    if (!project) {
      throw new AppError(404, "Project not found", "project_not_found");
    }
    return project;
  }

  private async ensureAssignableMember(projectId: string, memberId: string) {
    const member = await this.prisma.projectMember.findFirst({
      where: { id: memberId, projectId, isActive: true },
      include: {
        user: {
          select: { id: true, displayName: true, email: true }
        }
      }
    });
    if (!member) {
      throw new AppError(422, "Responsibility member must be an active member of this project", "invalid_responsibility_member");
    }
    return member;
  }

  private async enqueueDashboardRefresh(projectId: string, reason: string) {
    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, reason);
  }

  private async withTransaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) {
    if (typeof this.prisma.$transaction === "function") {
      return this.prisma.$transaction(callback);
    }
    return callback(this.prisma as unknown as Prisma.TransactionClient);
  }

  private async recordAudit(
    tx: Prisma.TransactionClient,
    input: {
      orgId: string;
      eventType: string;
      entityType: string;
      entityId?: string | null;
      projectId?: string | null;
      actorUserId?: string | null;
      payload: unknown;
    }
  ) {
    if (typeof this.auditService.recordWithClient === "function") {
      await this.auditService.recordWithClient(tx as unknown as Pick<PrismaClient, "auditEvent">, input);
      return;
    }
    await this.auditService.record(input);
  }

  private assertResponsiblePartyRemains(existing: ResponsibilityWithAssignee, input: UpdateResponsibilityInput) {
    const nextMemberId = Object.prototype.hasOwnProperty.call(input, "memberId")
      ? input.memberId ?? null
      : existing.memberId;
    const nextAssigneeName = Object.prototype.hasOwnProperty.call(input, "assigneeName")
      ? input.assigneeName ?? null
      : existing.assigneeName;

    if (!nextMemberId && !nextAssigneeName) {
      throw new AppError(422, "Responsibility requires an assignee member or assigneeName", "responsibility_assignee_required");
    }
  }

  private assigneeInclude() {
    return {
      member: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              displayName: true
            }
          }
        }
      }
    } satisfies Prisma.ProjectResponsibilityInclude;
  }

  private auditSnapshot(row: ResponsibilityWithAssignee) {
    return {
      responsibilityId: row.id,
      title: row.title,
      description: row.description,
      area: row.area,
      status: row.status,
      memberId: row.memberId,
      assigneeName: row.assigneeName,
      source: row.source,
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private toDto(row: ResponsibilityWithAssignee) {
    return {
      id: row.id,
      projectId: row.projectId,
      memberId: row.memberId,
      assigneeName: row.assigneeName,
      title: row.title,
      description: row.description,
      area: row.area,
      status: row.status,
      source: row.source,
      assignee: row.member
        ? {
            memberId: row.member.id,
            userId: row.member.userId,
            displayName: row.member.user.displayName,
            email: row.member.user.email,
            roleInProject: row.member.roleInProject
          }
        : null,
      createdByUserId: row.createdByUserId,
      updatedByUserId: row.updatedByUserId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }
}

export type ResponsibilityDto = {
  id: string;
  projectId: string;
  memberId: string | null;
  assigneeName: string | null;
  title: string;
  description: string | null;
  area: ProjectResponsibilityArea;
  status: ProjectResponsibilityStatus;
  source: ProjectResponsibilitySource;
  assignee: {
    memberId: string;
    userId: string;
    displayName: string;
    email: string;
    roleInProject: string | null;
  } | null;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export function buildResponsibilitySummary(projectId: string, responsibilities: ResponsibilityDto[]) {
  const active = responsibilities.filter((responsibility) => activeResponsibilityStatuses.has(responsibility.status));
  const blocked = responsibilities.filter((responsibility) => responsibility.status === "blocked");
  const byStatus = countBy(responsibilities, (responsibility) => responsibility.status);
  const byArea = countBy(active, (responsibility) => responsibility.area);
  const memberHighlights = Array.from(groupBy(active.filter((item) => item.memberId), (item) => item.memberId!).entries())
    .map(([memberId, items]) => {
      const assignee = items[0]?.assignee;
      return {
        memberId,
        displayName: assignee?.displayName ?? items[0]?.assigneeName ?? "Unassigned",
        activeCount: items.length,
        blockedCount: items.filter((item) => item.status === "blocked").length,
        primaryAreas: topAreas(items)
      };
    })
    .sort((left, right) => right.blockedCount - left.blockedCount || right.activeCount - left.activeCount)
    .slice(0, 8);

  return {
    activeCount: active.length,
    blockedCount: blocked.length,
    byArea,
    byStatus,
    memberHighlights,
    quickLinks: {
      responsibilitiesPath: `/projects/${projectId}/responsibilities`
    }
  };
}

function countBy<T, K extends string>(items: T[], key: (item: T) => K) {
  return items.reduce<Record<K, number>>((accumulator, item) => {
    const value = key(item);
    accumulator[value] = (accumulator[value] ?? 0) + 1;
    return accumulator;
  }, {} as Record<K, number>);
}

function groupBy<T, K extends string>(items: T[], key: (item: T) => K) {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const value = key(item);
    groups.set(value, [...(groups.get(value) ?? []), item]);
  }
  return groups;
}

function topAreas(items: Array<{ area: ProjectResponsibilityArea }>) {
  return Object.entries(countBy(items, (item) => item.area))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([area]) => area);
}

function tokenize(query: string) {
  return Array.from(new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? []));
}

function scoreResponsibility(row: ResponsibilityWithAssignee, tokens: string[]) {
  if (tokens.length === 0) return 0.1;
  const haystack = [
    row.title,
    row.description ?? "",
    row.area,
    row.status,
    row.assigneeName ?? "",
    row.member?.user.displayName ?? "",
    row.member?.user.email ?? ""
  ].join(" ").toLowerCase();
  const matches = tokens.filter((token) => haystack.includes(token)).length;
  const exactStatusBoost = tokens.includes("blocked") && row.status === "blocked" ? 2 : 0;
  return matches + exactStatusBoost;
}
